// 글쓰기 화면 미리보기의 이미지에 크기 조절·자르기 도구를 붙인다.
// 크기는 본문 폭 대비 % 로 <img width="N%"> 에 저장해, 미리보기·출간 글·넓힌 글에서 비율이 같다.
(function () {
  if (window.__velogPlusImage) return;
  window.__velogPlusImage = true;

  const { findImageBySrc, buildImage, sameSrc, mergeImagesInText } = window.__velogPlusMarkup;
  const { gridLayout, defaultGrid } = window.__velogPlusGrid;
  const { getCM, upload, toast } = window.__velogPlusApi;
  const PRESETS = [25, 50, 75, 100];


  function previewImages() {
    return [...document.querySelectorAll('#preview .atom-one img')];
  }

  // 미리보기 이미지 → 원문 위치를 찾기 위한 (주소, 같은 주소 중 순번)
  function locate(img) {
    const src = img.getAttribute('src');
    const nth = previewImages()
      .filter((el) => sameSrc(el.getAttribute('src'), src))
      .indexOf(img);
    return { src, nth };
  }

  function replaceImage({ src, nth }, patch) {
    const cm = getCM();
    if (!cm) return false;
    const doc = cm.getDoc();
    const token = findImageBySrc(doc.getValue(), src, nth);
    if (!token) {
      toast('원문에서 이 이미지를 찾지 못했습니다.');
      return false;
    }
    const next = buildImage({ ...token, ...patch });
    doc.replaceRange(next, doc.posFromIndex(token.start), doc.posFromIndex(token.end));
    return true;
  }

  function contentWidth(img) {
    const parent = img.parentElement;
    const cs = getComputedStyle(parent);
    return parent.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  }

  function currentPercent(img) {
    const attr = img.getAttribute('width');
    if (attr && attr.endsWith('%')) return parseFloat(attr);
    return Math.round((img.getBoundingClientRect().width / contentWidth(img)) * 100);
  }

  // ---------- 이미지 위 도구(크기 버튼, 드래그 핸들) ----------

  const frame = document.createElement('div');
  frame.className = 'vp-img-frame';
  frame.hidden = true;
  frame.innerHTML = `
    <div class="vp-img-bar">
      ${PRESETS.map((p) => `<button type="button" data-percent="${p}">${p}%</button>`).join('')}
      <button type="button" data-percent="">원본</button>
      <span class="vp-img-sep"></span>
      <button type="button" data-action="crop">자르기</button>
      <button type="button" data-action="merge">합치기</button>
    </div>
    <div class="vp-img-handle" title="드래그해서 크기 조절"></div>
    <div class="vp-img-size"></div>`;
  const sizeLabel = frame.querySelector('.vp-img-size');
  const handle = frame.querySelector('.vp-img-handle');
  let current = null;
  let busy = false;

  function place() {
    if (!current) return;
    if (!current.isConnected) return hide();
    const r = current.getBoundingClientRect();
    Object.assign(frame.style, {
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
  }

  function show(img) {
    if (!frame.isConnected) document.body.append(frame);
    current = img;
    frame.hidden = false;
    sizeLabel.textContent = `본문의 ${currentPercent(img)}%`;
    place();
  }

  function hide() {
    current = null;
    frame.hidden = true;
  }

  document.addEventListener('mouseover', (e) => {
    if (busy) return;
    const img = e.target.closest && e.target.closest('#preview .atom-one img');
    if (img && img !== current) show(img);
  });

  document.addEventListener('mousemove', (e) => {
    if (busy || !current) return;
    if (frame.contains(e.target)) return;
    const r = current.getBoundingClientRect();
    const pad = 16;
    const inside =
      e.clientX >= r.left - pad && e.clientX <= r.right + pad && e.clientY >= r.top - 48 && e.clientY <= r.bottom + pad;
    if (!inside) hide();
  });

  function relayout() {
    place();
    renderMarks();
  }
  document.addEventListener('scroll', relayout, { capture: true, passive: true });
  window.addEventListener('resize', relayout);

  frame.addEventListener('mousedown', (e) => e.preventDefault());
  frame.addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (!button || !current) return;
    const target = locate(current);
    if (button.dataset.action === 'crop') {
      openCrop(current.getAttribute('src'), target);
      return;
    }
    if (button.dataset.action === 'merge') {
      startSelect(target);
      return;
    }
    const percent = button.dataset.percent;
    if (replaceImage(target, { width: percent ? `${percent}%` : null })) {
      current.style.removeProperty('width');
      hide();
    }
  });

  handle.addEventListener('pointerdown', (e) => {
    if (!current || busy) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    busy = true;
    const img = current;
    const previousWidth = img.style.width;
    const target = locate(img);
    const startX = e.clientX;
    const startWidth = img.getBoundingClientRect().width;
    const full = contentWidth(img);
    let percent = currentPercent(img);

    const onMove = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      let p = ((startWidth + ev.clientX - startX) / full) * 100;
      p = Math.min(100, Math.max(5, p));
      const snap = PRESETS.find((s) => Math.abs(s - p) < 2);
      percent = Math.round(snap ?? p);
      img.style.width = `${percent}%`;
      sizeLabel.textContent = `본문의 ${percent}%`;
      place();
    };
    const onUp = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      handle.removeEventListener('lostpointercapture', onUp);
      busy = false;
      // React가 재사용하는 img에 임시 width가 남으면 원문·Undo의 width 속성을 가린다.
      img.style.width = previousWidth;
      if (ev.type === 'pointerup' && replaceImage(target, { width: `${percent}%` })) img.style.removeProperty('width');
      if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
      hide();
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    handle.addEventListener('lostpointercapture', onUp);
  });

  // ---------- 이미지 받기 ----------

  let requestId = 0;

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  // velog 이미지 서버는 CORS 를 막아, 확장 백그라운드(bridge.js → background.js)를 거쳐 받는다.
  function loadImageData(src) {
    if (/^(blob|data):/.test(src)) {
      return fetch(src).then((r) => r.blob()).then(blobToDataUrl);
    }
    return new Promise((resolve, reject) => {
      const id = ++requestId;
      const timer = setTimeout(() => {
        window.removeEventListener('message', onMessage);
        reject(new Error('이미지를 받는 데 시간이 너무 오래 걸립니다.'));
      }, 20000);
      function onMessage(event) {
        const data = event.data;
        if (event.source !== window || data?.source !== 'velog-plus' || data.type !== 'fetch-image-result') return;
        if (data.id !== id) return;
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        if (data.error) reject(new Error(data.error));
        else resolve(data.dataUrl);
      }
      window.addEventListener('message', onMessage);
      window.postMessage({ source: 'velog-plus', type: 'fetch-image', id, url: src }, location.origin);
    });
  }

  // ---------- 자르기 창 ----------

  const RATIOS = [
    ['자유', 0],
    ['1:1', 1],
    ['4:3', 4 / 3],
    ['16:9', 16 / 9],
  ];

  async function openCrop(src, target) {
    busy = true;
    hide();
    const backdrop = document.createElement('div');
    backdrop.className = 'vp-crop-backdrop';
    backdrop.innerHTML = `
      <div class="vp-crop-dialog">
        <div class="vp-crop-title">이미지 자르기</div>
        <div class="vp-crop-stage"><div class="vp-crop-loading">이미지를 불러오는 중…</div></div>
        <div class="vp-crop-footer">
          <div class="vp-crop-ratios">
            ${RATIOS.map(([label], i) => `<button type="button" data-ratio="${i}"${i ? '' : ' class="active"'}>${label}</button>`).join('')}
          </div>
          <span class="vp-crop-info"></span>
          <div class="vp-crop-actions">
            <button type="button" data-action="cancel">취소</button>
            <button type="button" data-action="apply" class="primary" disabled>자르기 적용</button>
          </div>
        </div>
      </div>`;
    document.body.append(backdrop);
    const stage = backdrop.querySelector('.vp-crop-stage');
    const info = backdrop.querySelector('.vp-crop-info');
    const applyButton = backdrop.querySelector('[data-action="apply"]');

    const close = () => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey, true);
      busy = false;
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey, true);
    backdrop.querySelector('[data-action="cancel"]').addEventListener('click', close);

    let dataUrl;
    let image;
    try {
      dataUrl = await loadImageData(src);
      image = new Image();
      image.src = dataUrl;
      await image.decode();
    } catch (error) {
      stage.innerHTML = `<div class="vp-crop-loading">${error.message}</div>`;
      return;
    }
    if (!backdrop.isConnected) return;

    // 화면에 맞춰 보여 주고, 자르기 영역은 화면 좌표(px)로 다룬 뒤 적용 시 원본 픽셀로 환산한다.
    const maxW = Math.min(window.innerWidth * 0.8, 1200);
    const maxH = window.innerHeight * 0.65;
    const fit = Math.min(1, maxW / image.naturalWidth, maxH / image.naturalHeight);
    const W = Math.round(image.naturalWidth * fit);
    const H = Math.round(image.naturalHeight * fit);
    stage.innerHTML = '';
    stage.style.width = `${W}px`;
    stage.style.height = `${H}px`;
    image.className = 'vp-crop-image';
    image.draggable = false;
    const box = document.createElement('div');
    box.className = 'vp-crop-box';
    box.innerHTML = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']
      .map((d) => `<span class="vp-crop-h" data-dir="${d}"></span>`)
      .join('');
    stage.append(image, box);
    applyButton.disabled = false;

    let ratio = 0;
    let rect = { x: 0, y: 0, w: W, h: H };
    const MIN = 16;

    function render() {
      Object.assign(box.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` });
      info.textContent = `${Math.round(rect.w / fit)} × ${Math.round(rect.h / fit)}px`;
    }

    // 비율을 고정하면 가운데를 기준으로 가능한 가장 큰 영역으로 맞춘다.
    function fitRatio() {
      if (!ratio) return;
      const cx = rect.x + rect.w / 2;
      const cy = rect.y + rect.h / 2;
      let w = rect.w;
      let h = w / ratio;
      if (h > rect.h) {
        h = rect.h;
        w = h * ratio;
      }
      rect = { x: cx - w / 2, y: cy - h / 2, w, h };
    }

    function resize(dir, dx, dy, start) {
      let { x, y, w, h } = start;
      if (dir.includes('e')) w = Math.min(W - x, Math.max(MIN, start.w + dx));
      if (dir.includes('s')) h = Math.min(H - y, Math.max(MIN, start.h + dy));
      if (dir.includes('w')) {
        const nx = Math.min(start.x + start.w - MIN, Math.max(0, start.x + dx));
        w = start.x + start.w - nx;
        x = nx;
      }
      if (dir.includes('n')) {
        const ny = Math.min(start.y + start.h - MIN, Math.max(0, start.y + dy));
        h = start.y + start.h - ny;
        y = ny;
      }
      if (ratio) {
        // 가로 변화가 있으면 가로 기준, 위·아래만 움직이면 세로 기준으로 맞춘다.
        if (dir.includes('e') || dir.includes('w')) h = w / ratio;
        else w = h * ratio;
        const maxW = dir.includes('w') ? start.x + start.w : W - x;
        const maxH = dir.includes('n') ? start.y + start.h : H - y;
        const scale = Math.min(1, maxW / w, maxH / h);
        w *= scale;
        h *= scale;
        if (dir.includes('w')) x = start.x + start.w - w;
        if (dir.includes('n')) y = start.y + start.h - h;
      }
      return { x, y, w, h };
    }

    box.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      box.setPointerCapture(e.pointerId);
      const dir = e.target.dataset.dir || '';
      const start = { ...rect };
      const sx = e.clientX;
      const sy = e.clientY;
      const onMove = (ev) => {
        const dx = ev.clientX - sx;
        const dy = ev.clientY - sy;
        if (dir) rect = resize(dir, dx, dy, start);
        else {
          rect = {
            ...start,
            x: Math.min(W - start.w, Math.max(0, start.x + dx)),
            y: Math.min(H - start.h, Math.max(0, start.y + dy)),
          };
        }
        render();
      };
      const onUp = () => {
        box.removeEventListener('pointermove', onMove);
        box.removeEventListener('pointerup', onUp);
        box.removeEventListener('pointercancel', onUp);
      };
      box.addEventListener('pointermove', onMove);
      box.addEventListener('pointerup', onUp);
      box.addEventListener('pointercancel', onUp);
    });

    backdrop.querySelector('.vp-crop-ratios').addEventListener('click', (e) => {
      const button = e.target.closest('button');
      if (!button) return;
      backdrop.querySelectorAll('.vp-crop-ratios button').forEach((b) => b.classList.toggle('active', b === button));
      ratio = RATIOS[button.dataset.ratio][1];
      rect = { x: 0, y: 0, w: W, h: H };
      fitRatio();
      render();
    });

    applyButton.addEventListener('click', async () => {
      applyButton.disabled = true;
      const sx = Math.round(rect.x / fit);
      const sy = Math.round(rect.y / fit);
      const sw = Math.max(1, Math.round(rect.w / fit));
      const sh = Math.max(1, Math.round(rect.h / fit));
      const canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      canvas.getContext('2d').drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
      const sourceType = dataUrl.slice(5, dataUrl.indexOf(';'));
      // GIF 등은 캔버스로 다시 만들 수 없어 PNG 로 저장한다. (움직이는 GIF 는 첫 장면만 남는다)
      const type = ['image/jpeg', 'image/png', 'image/webp'].includes(sourceType) ? sourceType : 'image/png';
      const extension = type.split('/')[1].replace('jpeg', 'jpg');
      try {
        info.textContent = '업로드 중…';
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.92));
        const path = await upload(blob, `cropped.${extension}`);
        if (replaceImage(target, { src: encodeURI(path) })) toast('잘라낸 이미지로 바꿨습니다.');
        close();
      } catch (error) {
        info.textContent = error.message;
        applyButton.disabled = false;
      }
    });

    fitRatio();
    render();
  }

  // ---------- 합치기: 이미지 고르기 ----------

  let selecting = null; // { items: [{ src, nth }], panel, marks: [] }

  function findPreviewImage({ src, nth }) {
    return previewImages().filter((el) => sameSrc(el.getAttribute('src'), src))[nth] || null;
  }

  function renderMarks() {
    if (!selecting) return;
    selecting.marks.forEach((m) => m.remove());
    selecting.marks = selecting.items.map((item, i) => {
      const mark = document.createElement('div');
      mark.className = 'vp-merge-mark';
      mark.innerHTML = `<span>${i + 1}</span>`;
      const img = findPreviewImage(item);
      if (img) {
        const r = img.getBoundingClientRect();
        Object.assign(mark.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
      } else {
        mark.hidden = true;
      }
      document.body.append(mark);
      return mark;
    });
    const count = selecting.items.length;
    selecting.panel.querySelector('.vp-merge-count').textContent = `${count}장 선택`;
    selecting.panel.querySelector('[data-action="next"]').disabled = count < 2;
  }

  function startSelect(target) {
    busy = true;
    hide();
    const panel = document.createElement('div');
    panel.className = 'vp-merge-panel';
    panel.innerHTML = `
      <span>합칠 이미지를 미리보기에서 클릭하세요.</span>
      <b class="vp-merge-count"></b>
      <button type="button" data-action="cancel">취소</button>
      <button type="button" data-action="next" class="primary">다음</button>`;
    panel.addEventListener('mousedown', (e) => e.preventDefault());
    panel.querySelector('[data-action="cancel"]').addEventListener('click', endSelect);
    panel.querySelector('[data-action="next"]').addEventListener('click', () => {
      const items = selecting.items;
      endSelect();
      openMerge(items);
    });
    document.body.append(panel);
    selecting = { items: [target], panel, marks: [] };
    document.addEventListener('click', onSelectClick, true);
    document.addEventListener('keydown', onSelectKey, true);
    renderMarks();
  }

  function endSelect() {
    if (!selecting) return;
    selecting.marks.forEach((m) => m.remove());
    selecting.panel.remove();
    selecting = null;
    busy = false;
    document.removeEventListener('click', onSelectClick, true);
    document.removeEventListener('keydown', onSelectKey, true);
  }

  function onSelectKey(e) {
    if (e.key === 'Escape') endSelect();
  }

  function onSelectClick(e) {
    const img = e.target.closest && e.target.closest('#preview .atom-one img');
    if (!img) return;
    e.preventDefault();
    e.stopPropagation();
    const target = locate(img);
    const i = selecting.items.findIndex((it) => sameSrc(it.src, target.src) && it.nth === target.nth);
    if (i >= 0) selecting.items.splice(i, 1);
    else selecting.items.push(target);
    renderMarks();
  }

  // ---------- 합치기 창 ----------

  const MAX_SIDE = 4000;
  const MAX_CELLS = 10;
  const BACKGROUNDS = [
    ['투명', null],
    ['흰색', '#ffffff'],
    ['검정', '#000000'],
  ];
  const FITS = [
    ['original', '원본 비율', '잘림 없음 · 행마다 높이를 맞춤'],
    ['fill', '채우기', '칸 크기 같음 · 가장자리가 잘림'],
    ['fit', '맞추기', '칸 크기 같음 · 잘림 없이 여백'],
  ];

  function layoutOf(slots, options) {
    const sizes = slots.map((im) => im && { w: im.naturalWidth, h: im.naturalHeight });
    return gridLayout(sizes, { ...options, maxSide: MAX_SIDE });
  }

  function draw(canvas, slots, options, zoom = 1) {
    const { width, height, parts } = layoutOf(slots, options);
    canvas.width = Math.max(1, Math.round(width * zoom));
    canvas.height = Math.max(1, Math.round(height * zoom));
    const ctx = canvas.getContext('2d');
    if (options.background) {
      ctx.fillStyle = options.background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    for (const p of parts) {
      ctx.drawImage(slots[p.index], p.sx, p.sy, p.sw, p.sh, p.dx * zoom, p.dy * zoom, p.dw * zoom, p.dh * zoom);
    }
    return { width, height };
  }

  async function openMerge(targets) {
    busy = true;
    const backdrop = document.createElement('div');
    backdrop.className = 'vp-crop-backdrop';
    backdrop.innerHTML = `
      <div class="vp-crop-dialog vp-merge-dialog">
        <div class="vp-crop-title">이미지 합치기</div>
        <div class="vp-merge-body">
          <div class="vp-merge-preview"><div class="vp-crop-loading">이미지를 불러오는 중…</div></div>
          <div class="vp-merge-side">
            <div class="vp-merge-label">배치</div>
            <div class="vp-crop-ratios" data-group="preset">
              <button type="button" data-value="row">가로 한 줄</button>
              <button type="button" data-value="column">세로 한 줄</button>
              <button type="button" data-value="grid">격자</button>
            </div>
            <div class="vp-merge-steppers">
              <span>열</span>
              <button type="button" data-step="cols" data-delta="-1">−</button>
              <b data-value="cols"></b>
              <button type="button" data-step="cols" data-delta="1">+</button>
              <span>행</span>
              <button type="button" data-step="rows" data-delta="-1">−</button>
              <b data-value="rows"></b>
              <button type="button" data-step="rows" data-delta="1">+</button>
            </div>
            <div class="vp-merge-label">칸 배치 <small>칸 두 개를 차례로 누르면 자리를 바꿉니다</small></div>
            <div class="vp-merge-grid"></div>
            <div class="vp-merge-label">맞춤</div>
            <div class="vp-crop-ratios" data-group="fit">
              ${FITS.map(([value, label, hint]) => `<button type="button" data-value="${value}" title="${hint}">${label}</button>`).join('')}
            </div>
            <div class="vp-merge-label">간격 · 배경</div>
            <div class="vp-merge-row">
              <label class="vp-merge-gap"><input type="number" min="0" max="200" value="8"> px</label>
              <div class="vp-crop-ratios" data-group="background">
                ${BACKGROUNDS.map(([label], i) => `<button type="button" data-value="${i}">${label}</button>`).join('')}
              </div>
            </div>
          </div>
        </div>
        <div class="vp-crop-footer">
          <span class="vp-crop-info"></span>
          <div class="vp-crop-actions">
            <button type="button" data-action="cancel">취소</button>
            <button type="button" data-action="apply" class="primary" disabled>합치기 적용</button>
          </div>
        </div>
      </div>`;
    document.body.append(backdrop);
    const preview = backdrop.querySelector('.vp-merge-preview');
    const grid = backdrop.querySelector('.vp-merge-grid');
    const info = backdrop.querySelector('.vp-crop-info');
    const gapInput = backdrop.querySelector('.vp-merge-gap input');
    const applyButton = backdrop.querySelector('[data-action="apply"]');

    const close = () => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey, true);
      busy = false;
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey, true);
    backdrop.querySelector('[data-action="cancel"]').addEventListener('click', close);

    let images;
    try {
      images = await Promise.all(
        targets.map(async (target) => {
          const im = new Image();
          im.src = await loadImageData(target.src);
          await im.decode();
          return im;
        }),
      );
    } catch (error) {
      preview.innerHTML = `<div class="vp-crop-loading">${error.message}</div>`;
      return;
    }
    if (!backdrop.isConnected) return;

    const count = images.length;
    const options = { ...defaultGrid(count), fit: 'original', gap: 8, background: BACKGROUNDS[1][1] };
    // slots: 행 우선 순서의 칸. 이미지 또는 null(빈 칸)
    let slots = [];
    let picked = null;
    const canvas = document.createElement('canvas');
    preview.innerHTML = '';
    preview.append(canvas);

    // 칸 수가 바뀌면 지금 순서를 유지한 채 앞에서부터 다시 채운다.
    function resize(cols, rows) {
      const order = slots.length ? slots.filter(Boolean) : images;
      options.cols = cols;
      options.rows = Math.max(rows, Math.ceil(count / cols));
      slots = Array.from({ length: options.cols * options.rows }, (_, i) => order[i] || null);
      picked = null;
    }

    function setActive(group, value) {
      backdrop
        .querySelectorAll(`[data-group="${group}"] button`)
        .forEach((b) => b.classList.toggle('active', b.dataset.value === String(value)));
    }

    function render() {
      const { cols, rows } = options;
      const full = layoutOf(slots, options);
      const maxW = Math.min(window.innerWidth * 0.55, 760);
      const maxH = window.innerHeight * 0.6;
      const zoom = Math.min(1, maxW / full.width, maxH / full.height);
      draw(canvas, slots, options, zoom);
      info.textContent = `${count}장 · ${cols}열 × ${rows}행 · ${full.width} × ${full.height}px`;

      setActive('preset', rows === 1 ? 'row' : cols === 1 ? 'column' : 'grid');
      setActive('fit', options.fit);
      setActive('background', BACKGROUNDS.findIndex(([, color]) => color === options.background));
      backdrop.querySelector('[data-value="cols"]').textContent = cols;
      backdrop.querySelector('[data-value="rows"]').textContent = rows;
      backdrop.querySelector('[data-step="cols"][data-delta="-1"]').disabled = cols <= 1;
      backdrop.querySelector('[data-step="cols"][data-delta="1"]').disabled = cols >= MAX_CELLS;
      backdrop.querySelector('[data-step="rows"][data-delta="-1"]').disabled = (rows - 1) * cols < count;
      backdrop.querySelector('[data-step="rows"][data-delta="1"]').disabled = rows >= MAX_CELLS;

      grid.style.gridTemplateColumns = `repeat(${cols}, 56px)`;
      grid.innerHTML = slots
        .map((im, i) => {
          const cls = `vp-merge-cell${picked === i ? ' picked' : ''}${im ? '' : ' empty'}`;
          return `<button type="button" class="${cls}" data-slot="${i}">${im ? `<img src="${im.src}" alt="">` : '빈 칸'}</button>`;
        })
        .join('');
    }

    grid.addEventListener('click', (e) => {
      const cell = e.target.closest('[data-slot]');
      if (!cell) return;
      const i = Number(cell.dataset.slot);
      if (picked === null) {
        if (slots[i]) picked = i;
      } else {
        [slots[picked], slots[i]] = [slots[i], slots[picked]];
        picked = null;
      }
      render();
    });

    backdrop.querySelector('[data-group="preset"]').addEventListener('click', (e) => {
      const value = e.target.closest('button')?.dataset.value;
      if (value === 'row') resize(count, 1);
      else if (value === 'column') resize(1, count);
      else if (value === 'grid') resize(count <= 4 ? 2 : 3, 1);
      else return;
      render();
    });

    for (const button of backdrop.querySelectorAll('[data-step]')) {
      button.addEventListener('click', () => {
        const delta = Number(button.dataset.delta);
        if (button.dataset.step === 'cols') resize(options.cols + delta, options.rows);
        else {
          const order = slots;
          options.rows += delta;
          // 행만 늘리거나 줄일 때는 칸 위치를 유지하고 끝을 늘이거나 자른다.
          slots = Array.from({ length: options.cols * options.rows }, (_, i) => order[i] || null);
          const missing = images.filter((im) => !slots.includes(im));
          for (const im of missing) slots[slots.indexOf(null)] = im;
          picked = null;
        }
        render();
      });
    }

    for (const group of backdrop.querySelectorAll('[data-group="fit"], [data-group="background"]')) {
      group.addEventListener('click', (e) => {
        const button = e.target.closest('button');
        if (!button) return;
        if (group.dataset.group === 'fit') options.fit = button.dataset.value;
        else options.background = BACKGROUNDS[button.dataset.value][1];
        render();
      });
    }
    gapInput.addEventListener('input', () => {
      options.gap = Math.min(200, Math.max(0, Number(gapInput.value) || 0));
      render();
    });

    applyButton.disabled = false;
    applyButton.addEventListener('click', async () => {
      applyButton.disabled = true;
      try {
        info.textContent = '업로드 중…';
        const out = document.createElement('canvas');
        draw(out, slots, options);
        // 투명 배경은 PNG, 아니면 용량이 작은 JPEG 로 저장한다.
        const type = options.background ? 'image/jpeg' : 'image/png';
        const blob = await new Promise((resolve) => out.toBlob(resolve, type, 0.92));
        const path = await upload(blob, `merged.${type === 'image/png' ? 'png' : 'jpg'}`);
        const doc = getCM().getDoc();
        const before = doc.getValue();
        // 원문 위치는 화면 순서가 아니라 고른 이미지들 중 원문에서 가장 앞의 자리다.
        const after = mergeImagesInText(before, targets, encodeURI(path));
        if (after === null) throw new Error('원문에서 이미지를 찾지 못했습니다.');
        replaceChanged(doc, before, after);
        toast('합친 이미지로 바꿨습니다.');
        close();
      } catch (error) {
        info.textContent = error.message;
        applyButton.disabled = false;
      }
    });

    resize(options.cols, options.rows);
    render();
  }

  // 바뀐 구간만 교체해 실행 취소(Ctrl+Z) 한 번으로 되돌릴 수 있게 한다.
  function replaceChanged(doc, before, after) {
    let head = 0;
    while (head < before.length && head < after.length && before[head] === after[head]) head++;
    let tail = 0;
    while (
      tail < before.length - head &&
      tail < after.length - head &&
      before[before.length - 1 - tail] === after[after.length - 1 - tail]
    ) {
      tail++;
    }
    doc.replaceRange(
      after.slice(head, after.length - tail),
      doc.posFromIndex(head),
      doc.posFromIndex(before.length - tail),
    );
  }
})();
