// 글쓰기 툴바의 "불러오기": 마크다운(+이미지 파일 또는 zip)을 제목·태그·본문으로 채우고,
// 로컬 이미지는 velog 에 올려 주소를 바꾼다. 출간·임시저장은 사용자가 직접 누른다.
(function () {
  if (window.__velogPlusImporter) return;
  window.__velogPlusImporter = true;

  const { parseMarkdownDoc, localImageSources, resolveFile, replaceImageSources } = window.__velogPlusImport;
  const { getCM, postId, upload, toast } = window.__velogPlusApi;
  const IMAGE_TYPES = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
  };
  const isMarkdown = (path) => /\.(md|markdown)$/i.test(path);
  const extension = (path) => (path.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || '';
  const isImage = (path) => extension(path) in IMAGE_TYPES;

  // ---------- zip 풀기 (저장·deflate 방식만. 일반 zip 은 모두 이 둘이다) ----------

  async function readZip(file) {
    const buffer = await file.arrayBuffer();
    const view = new DataView(buffer);
    let eocd = -1;
    for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('zip 파일을 읽지 못했습니다.');
    const count = view.getUint16(eocd + 10, true);
    let p = view.getUint32(eocd + 16, true);
    const decoder = new TextDecoder();
    const entries = [];
    for (let n = 0; n < count; n++) {
      if (view.getUint32(p, true) !== 0x02014b50) break;
      const method = view.getUint16(p + 10, true);
      const size = view.getUint32(p + 20, true);
      const nameLength = view.getUint16(p + 28, true);
      const extraLength = view.getUint16(p + 30, true);
      const commentLength = view.getUint16(p + 32, true);
      const local = view.getUint32(p + 42, true);
      const path = decoder.decode(new Uint8Array(buffer, p + 46, nameLength));
      p += 46 + nameLength + extraLength + commentLength;
      if (path.endsWith('/') || path.includes('__MACOSX/')) continue;
      if (!isMarkdown(path) && !isImage(path)) continue;
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const raw = new Blob([buffer.slice(start, start + size)]);
      let data;
      if (method === 0) data = raw;
      else if (method === 8) data = await new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
      else continue;
      const type = isImage(path) ? IMAGE_TYPES[extension(path)] : 'text/markdown';
      entries.push({ path, file: new File([data], path.split('/').pop(), { type }) });
    }
    return entries;
  }

  async function collect(fileList) {
    const items = [];
    for (const file of fileList) {
      const path = file.webkitRelativePath || file.name;
      if (/\.zip$/i.test(path)) items.push(...(await readZip(file)));
      else if (isMarkdown(path) || isImage(path)) items.push({ path, file });
    }
    return items;
  }

  // ---------- velog 입력칸 채우기 ----------

  // React 가 관리하는 입력칸은 value 를 직접 바꾸면 무시되므로 원래 setter 로 바꾸고 input 이벤트를 보낸다.
  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function titleInput() {
    return document.querySelector('textarea[placeholder="제목을 입력하세요"]');
  }

  function tagInput() {
    return document.querySelector('input[placeholder="태그를 입력하세요"]');
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // velog 태그 입력칸은 Enter 로 추가하고, 비어 있을 때 Backspace 로 마지막 태그를 지운다.
  // 태그 목록은 비동기로 갱신되므로 한 번 누를 때마다 기다려야 이전 목록에 덮이지 않는다.
  async function setTags(tags) {
    const input = tagInput();
    if (!input) return;
    const key = (k) => input.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    setNativeValue(input, '');
    for (let n = input.parentElement.children.length - 1; n > 0; n--) {
      key('Backspace');
      await sleep(30);
    }
    for (const tag of tags) {
      setNativeValue(input, tag);
      await sleep(30);
      key('Enter');
      await sleep(30);
    }
    setNativeValue(input, '');
  }

  function findTempSaveButton() {
    return [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '임시저장');
  }

  // 이미지를 올리려면 글 번호가 필요하다. 없으면 velog 의 임시저장을 눌러 새 글을 만든다.
  async function ensurePostId() {
    if (postId()) return postId();
    const button = findTempSaveButton();
    if (!button) throw new Error('임시저장 버튼을 찾지 못했습니다.');
    button.click();
    for (let i = 0; i < 50; i++) {
      await sleep(200);
      if (postId()) return postId();
    }
    throw new Error('임시저장에 실패했습니다. 로그인 상태를 확인하세요.');
  }

  // ---------- 불러오기 창 ----------

  function escapeHtml(text) {
    return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  }

  function openImporter() {
    const backdrop = document.createElement('div');
    backdrop.className = 'vp-crop-backdrop';
    backdrop.innerHTML = `
      <div class="vp-crop-dialog vp-import-dialog">
        <div class="vp-crop-title">마크다운 불러오기</div>
        <div class="vp-import-drop">
          <p>.md 파일과 이미지 파일, 또는 zip 을 끌어다 놓으세요.</p>
          <div class="vp-crop-actions">
            <button type="button" data-pick="files">파일 선택</button>
            <button type="button" data-pick="folder">폴더 선택</button>
          </div>
          <input type="file" data-input="files" multiple accept=".md,.markdown,.zip,image/*" hidden>
          <input type="file" data-input="folder" webkitdirectory hidden>
        </div>
        <div class="vp-import-summary" hidden>
          <label class="vp-import-field" data-field="md">마크다운 <select></select></label>
          <label class="vp-import-field">제목 <input data-field="title"></label>
          <label class="vp-import-field">태그 <input data-field="tags" placeholder="쉼표로 구분"></label>
          <div class="vp-import-images"></div>
        </div>
        <div class="vp-crop-footer">
          <span class="vp-crop-info"></span>
          <div class="vp-crop-actions">
            <button type="button" data-action="cancel">취소</button>
            <button type="button" data-action="apply" class="primary" disabled>에디터에 넣기</button>
          </div>
        </div>
      </div>`;
    document.body.append(backdrop);
    const $ = (sel) => backdrop.querySelector(sel);
    const info = $('.vp-crop-info');
    const summary = $('.vp-import-summary');
    const select = $('[data-field="md"] select');
    const titleField = $('[data-field="title"]');
    const tagsField = $('[data-field="tags"]');
    const imagesBox = $('.vp-import-images');
    const applyButton = $('[data-action="apply"]');
    let items = [];
    let doc = null;
    let running = false;

    const close = () => {
      if (running) return;
      backdrop.remove();
      document.removeEventListener('keydown', onKey, true);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey, true);
    $('[data-action="cancel"]').addEventListener('click', close);

    for (const kind of ['files', 'folder']) {
      $(`[data-pick="${kind}"]`).addEventListener('click', () => $(`[data-input="${kind}"]`).click());
      $(`[data-input="${kind}"]`).addEventListener('change', (e) => load(e.target.files));
    }
    const drop = $('.vp-import-drop');
    drop.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      drop.classList.add('over');
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => {
      // velog 의 이미지 드롭 업로드가 가로채지 않도록 막는다.
      e.preventDefault();
      e.stopPropagation();
      drop.classList.remove('over');
      load(e.dataTransfer.files);
    });

    async function load(fileList) {
      try {
        info.textContent = '파일을 읽는 중…';
        items = await collect([...fileList]);
      } catch (error) {
        info.textContent = error.message;
        return;
      }
      const markdowns = items.filter((it) => isMarkdown(it.path));
      if (!markdowns.length) {
        info.textContent = '.md 파일이 없습니다.';
        return;
      }
      select.innerHTML = markdowns.map((it, i) => `<option value="${i}">${escapeHtml(it.path)}</option>`).join('');
      $('[data-field="md"]').hidden = markdowns.length < 2;
      select.onchange = () => pick(markdowns[select.value]);
      await pick(markdowns[0]);
    }

    async function pick(item) {
      const parsed = parseMarkdownDoc(await item.file.text(), item.path);
      const dir = item.path.includes('/') ? item.path.slice(0, item.path.lastIndexOf('/')) : '';
      const images = items.filter((it) => isImage(it.path));
      const sources = localImageSources(parsed.body);
      const matches = sources.map((src) => ({ src, item: resolveFile(src, images, dir) }));
      doc = { ...parsed, matches };
      titleField.value = parsed.title;
      tagsField.value = parsed.tags.join(', ');
      const found = matches.filter((m) => m.item).length;
      const missing = matches.filter((m) => !m.item);
      imagesBox.innerHTML = `
        <div>로컬 이미지 ${sources.length}개 중 <b>${found}개</b>를 찾았습니다.</div>
        ${missing.length ? `<div class="vp-import-missing">못 찾음: ${missing.map((m) => escapeHtml(m.src)).join(', ')}</div>` : ''}
        ${found && !postId() ? '<div class="vp-import-note">이미지를 올리려고 먼저 임시저장을 한 번 합니다.</div>' : ''}`;
      summary.hidden = false;
      info.textContent = '';
      applyButton.disabled = false;
    }

    applyButton.addEventListener('click', async () => {
      const cm = getCM();
      if (!cm || !doc) return;
      const title = titleInput();
      const hasContent = cm.getValue().trim() || (title && title.value.trim());
      if (hasContent && !window.confirm('지금 작성 중인 제목·본문을 덮어씁니다. 계속할까요?')) return;

      running = true;
      applyButton.disabled = true;
      const failures = [];
      try {
        if (title) setNativeValue(title, titleField.value.trim());
        await setTags(tagsField.value.split(',').map((t) => t.trim()).filter(Boolean));
        cm.setValue(doc.body);

        const uploads = doc.matches.filter((m) => m.item);
        if (uploads.length) {
          info.textContent = '임시저장 중…';
          await ensurePostId();
          const map = new Map();
          for (const [i, m] of uploads.entries()) {
            info.textContent = `이미지 업로드 중… (${i + 1}/${uploads.length})`;
            try {
              map.set(m.src, encodeURI(await upload(m.item.file, m.item.file.name)));
            } catch (error) {
              failures.push(`${m.src}: ${error.message}`);
            }
          }
          cm.setValue(replaceImageSources(cm.getValue(), map));
        }
      } catch (error) {
        failures.push(error.message);
      } finally {
        running = false;
      }

      if (failures.length) {
        info.textContent = `실패: ${failures.join(' / ')}`;
        applyButton.disabled = false;
        return;
      }
      close();
      const missing = doc.matches.filter((m) => !m.item).length;
      toast(
        missing
          ? `불러왔습니다. 못 찾은 이미지 ${missing}개는 경로 그대로 남았습니다.`
          : '불러왔습니다. 확인 후 임시저장 또는 출간하세요.',
      );
    });
  }

  // ---------- 툴바 버튼 ----------

  function ensureButton() {
    const toolbar = document.getElementById('toolbar');
    if (!toolbar || toolbar.querySelector('.vp-import')) return;
    const base = toolbar.querySelector('.ql-code-block');
    if (!base) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `${base.className.replace(/\bql-[\w-]+/g, '').trim()} vp-import`;
    button.title = '마크다운 불러오기';
    button.innerHTML =
      '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 3l5 5h-3.5v6h-3V8H7l5-5zM5 17h14v3H5v-3z"/></svg>';
    button.addEventListener('mousedown', (e) => e.preventDefault());
    button.addEventListener('click', openImporter);
    const last = toolbar.querySelector('.vp-tool[data-kind="bg"]') || base;
    last.after(button);
  }

  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      ensureButton();
    });
  }).observe(document.body, { childList: true, subtree: true });
  ensureButton();
})();
