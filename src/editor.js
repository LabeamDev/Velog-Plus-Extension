// velog 에디터(/write) 툴바에 글자색·배경색 버튼과 서식 단축키를 연결한다.
// CodeMirror 인스턴스(.CodeMirror 요소의 CodeMirror 속성)에 접근해야 해서 MAIN world 에서 실행된다.
(function () {
  if (window.__velogPlusEditor) return;
  window.__velogPlusEditor = true;

  const { applyStyle, toggleStyles, toggleHighlight, isHighlighted, innerRange, scanInline } = window.__velogPlusMarkup;

  const TOOLS = {
    color: {
      prop: 'color',
      title: '글자색',
      colors: [
        ['빨강', '#e03131'], ['주황', '#f76707'], ['노랑', '#f59f00'], ['초록', '#2f9e44'],
        ['청록', '#0c8599'], ['파랑', '#1c7ed6'], ['보라', '#7048e8'], ['분홍', '#d6336c'],
        ['회색', '#868e96'], ['갈색', '#a0522d'],
      ],
    },
    bg: {
      prop: 'background-color',
      title: '배경색',
      // 반투명이라 라이트·다크 테마 모두에서 글자가 읽힌다.
      colors: [
        ['빨강', 'rgba(255, 107, 107, 0.3)'], ['주황', 'rgba(255, 146, 43, 0.3)'],
        ['노랑', 'rgba(255, 212, 59, 0.4)'], ['초록', 'rgba(81, 207, 102, 0.3)'],
        ['청록', 'rgba(34, 184, 207, 0.3)'], ['파랑', 'rgba(77, 171, 247, 0.3)'],
        ['보라', 'rgba(151, 117, 250, 0.3)'], ['분홍', 'rgba(240, 101, 149, 0.3)'],
        ['회색', 'rgba(134, 142, 150, 0.3)'], ['갈색', 'rgba(160, 82, 45, 0.3)'],
      ],
    },
  };
  const RECENT_KEY = 'velog-plus:recent';
  const RECENT_MAX = 8;

  function parseColor(value) {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (/^#[\da-f]{6}$/i.test(text)) {
      return { rgb: [1, 3, 5].map((i) => parseInt(text.slice(i, i + 2), 16)) };
    }
    const wrapped = text.match(/^(rgb|rgba)?\((.*)\)$/i);
    const parts = (wrapped ? wrapped[2] : text).split(',').map((p) => p.trim());
    const rgba = wrapped?.[1]?.toLowerCase() === 'rgba';
    if (parts.length !== (rgba ? 4 : 3)) return null;
    const rgb = parts.slice(0, 3);
    if (rgb.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return null;
    if (rgba && !/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(parts[3])) return null;
    return { rgb: rgb.map(Number), alpha: rgba ? Number(parts[3]) : undefined };
  }

  function getCM() {
    const el = document.querySelector('.CodeMirror');
    return el && el.CodeMirror;
  }

  function loadRecent(kind) {
    try {
      const values = JSON.parse(localStorage.getItem(RECENT_KEY))?.[kind];
      return Array.isArray(values) ? values.filter((v) => parseColor(v) && CSS.supports(TOOLS[kind].prop, v)).slice(0, RECENT_MAX) : [];
    } catch {
      return [];
    }
  }

  function pushRecent(kind, value) {
    try {
      const all = { color: loadRecent('color'), bg: loadRecent('bg') };
      all[kind] = [value, ...all[kind].filter((v) => v !== value)].slice(0, RECENT_MAX);
      localStorage.setItem(RECENT_KEY, JSON.stringify(all));
    } catch { /* 저장이 차단돼도 본문 색 적용은 유지한다. */ }
  }

  // 선택 경계에 걸친 서식(span·strong·em·** 등)을 경계에서 나눈다. 선택 밖 글자에는 원래 서식을 다시 씌워
  // 보존하고, 선택 쪽에도 씌워 토글이 현재 상태를 알게 한다. 각 서식은 한 줄 안에서만 짝을 찾는다.
  // partial 이 아니면 선택이 서식 안쪽 전체와 정확히 같을 때만 넓힌다.
  function splitRange(doc, from, to, partial) {
    const same = from.line === to.line;
    const first = doc.getLine(from.line);
    const last = same ? first : doc.getLine(to.line);
    const a = scanInline(first);
    const b = same ? a : scanInline(last);
    let f = from.ch;
    let t = to.ch;
    const empty = same && f === t;
    if (empty && a.atoms.some(([s, e]) => s < f && f < e)) return null;
    // 앞뒤 여백은 빼고, 기호 중간은 기호 전체로, 닫는·여는 기호에 붙은 경계는 기호 밖으로 옮긴다.
    for (let n = 0; !empty && n < 8; n++) {
      const [pf, pt] = [f, t];
      while (/\s/.test(first[f] || '') && (!same || f < t)) f++;
      while (/\s/.test(last[t - 1] || '') && (!same || t > f)) t--;
      for (const [s, e] of a.atoms) if (s < f && f < e) f = s;
      for (const [s, e] of b.atoms) if (s < t && t < e) t = e;
      for (const w of a.wrappers) if (f === w.closeStart) f = w.closeEnd;
      for (const w of b.wrappers) if (t === w.openEnd) t = w.openStart;
      if (f === pf && t === pt) break;
    }
    if (same && f > t) return null;
    if (same && f === t && !empty) return null;
    const byOpen = (x, y) => x.openStart - y.openStart;
    const A = a.wrappers.filter((w) => w.openEnd <= f && (empty ? f <= w.closeStart : f < w.closeStart)).sort(byOpen);
    const B = b.wrappers.filter((w) => (empty ? w.openEnd <= t : w.openEnd < t) && t <= w.closeStart).sort(byOpen);
    // 빈 선택은 span 만 나눈다. 빈 ** 같은 기호가 글자로 남지 않게 한다.
    if (empty && A.some((w) => w.kind !== 'span')) return null;
    // 나뉜 _ 강조는 단어 중간에서도 짝이 맞는 * 로 바꾼다.
    const star = (line, list) => {
      const chars = line.split('');
      for (const w of list) if (w.md === '_') for (const [s, e] of [[w.openStart, w.openEnd], [w.closeStart, w.closeEnd]]) chars.fill('*', s, e);
      return chars.join('');
    };
    const open = (w) => w.md ? '*'.repeat(w.open.length) : w.open;
    const close = (w) => w.md ? '*'.repeat(w.close.length) : w.close;
    const head = star(first, same ? [...A, ...B] : A);
    const tail = same ? head : star(last, B);

    const X = A.length ? A[0].openStart : f;
    let pos = f;
    let k = A.length;
    while (k && A[k - 1].openEnd === pos) pos = A[--k].openStart;
    let lead = head.slice(X, pos);
    // 마크다운 닫는 기호 앞에 여백이 오면 강조가 깨지므로 여백을 기호 밖으로 뺀다.
    const gapBefore = A.slice(0, k).some((w) => w.md) ? lead.match(/\s*$/)[0] : '';
    lead = lead.slice(0, lead.length - gapBefore.length);
    const before = lead + A.slice(0, k).reverse().map(close).join('') + gapBefore;

    const Y = B.length ? Math.max(...B.map((w) => w.closeEnd)) : t;
    let end = t;
    let j = B.length;
    while (j && B[j - 1].closeStart === end) end = B[--j].closeEnd;
    let trail = tail.slice(end, Y);
    const gapAfter = B.slice(0, j).some((w) => w.md) ? trail.match(/^\s*/)[0] : '';
    trail = trail.slice(gapAfter.length);
    const after = gapAfter + B.slice(0, j).map(open).join('') + trail;

    if (!partial && (before || after)) return null;
    const middle = same
      ? head.slice(f, t)
      : head.slice(f) + '\n' + doc.getRange({ line: from.line + 1, ch: 0 }, { line: to.line, ch: 0 }) + tail.slice(0, t);
    return {
      from: { line: from.line, ch: X },
      to: { line: to.line, ch: Y },
      before,
      after,
      text: A.map(open).join('') + middle + [...B].reverse().map(close).join(''),
    };
  }

  // 한 줄은 서식 안쪽 글자를, 여러 줄은 바뀐 전체를 선택해 반복 단축키가 같은 글에 적용되게 한다.
  // transform 은 선택별 글 목록을 받아 같은 순서의 결과 목록을 돌려준다.
  function transformSelections(transform, selectedOnly = false) {
    const cm = getCM();
    if (!cm) return;
    const doc = cm.getDoc();
    const selections = doc.listSelections();
    const ranges = selections.map((r) => {
      const [from, to] = sortPos(r.anchor, r.head);
      if (selectedOnly && from.line === to.line && from.ch === to.ch) return null;
      return splitRange(doc, from, to, selections.length === 1) || { from, to, text: doc.getRange(from, to) };
    }).filter(Boolean);
    const outs = transform(ranges.map((r) => r.text));
    const nextSelections = [];
    cm.operation(() => {
      // 뒤에서부터 바꿔야 앞쪽 위치가 밀리지 않는다.
      for (let i = ranges.length - 1; i >= 0; i--) {
        const { from, to, before = '', after = '' } = ranges[i];
        const out = outs[i];
        doc.replaceRange(before + out + after, from, to, 'velog-plus');
        const start = doc.indexFromPos(from) + before.length;
        const inner = innerRange(out) || [0, out.length];
        nextSelections.push({
          anchor: doc.posFromIndex(start + inner[0]),
          head: doc.posFromIndex(start + inner[1]),
        });
      }
      if (ranges.length === 1 && nextSelections.length === 1) doc.setSelections(nextSelections);
    });
    cm.focus();
  }

  function apply(kind, value) {
    const { prop } = TOOLS[kind];
    transformSelections((texts) => texts.map((text) => applyStyle(text, prop, value)));
    if (value) pushRecent(kind, value);
  }

  // ---------- 강조 단축키 ----------
  // 스타일은 확장 팝업에서 정하고 bridge.js 가 chrome.storage 값을 메시지로 보내 준다.
  // styles: 켠 글자색·배경색·밑줄 span 스타일, formats: { bold, italic } 불리언. formats 가 없는 이전 메시지는 둘 다 끔.

  // velog는 u 태그·text-decoration을 제거하므로 허용된 span 테두리로 밑줄을 표시한다.
  const UNDERLINE = { 'border-bottom-width': '1px', 'border-style': 'none none solid' };
  let highlight = { styles: { color: '#eb5757', 'background-color': 'rgba(135, 131, 120, 0.15)' }, formats: { bold: false, italic: false } };
  let nextHighlightRequest = 0;
  let pendingHighlight = null;

  function validFormats(formats) {
    if (!formats || typeof formats !== 'object' || Array.isArray(formats)) return false;
    const keys = Object.keys(formats);
    return keys.length === 2 && ['bold', 'italic'].every((k) => keys.includes(k) && typeof formats[k] === 'boolean');
  }

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (event.source !== window || data?.source !== 'velog-plus' || data.type !== 'highlight-style') return;
    if (!data.styles || typeof data.styles !== 'object') return;
    const formats = data.formats === undefined ? { bold: false, italic: false } : data.formats;
    if (!validFormats(formats)) return;
    const entries = Object.entries(data.styles);
    const underline = entries.filter(([prop]) => Object.hasOwn(UNDERLINE, prop));
    // 밑줄은 두 속성이 정해진 값으로 함께 와야 한다.
    if (underline.length && (underline.length !== 2 || underline.some(([prop, value]) => value !== UNDERLINE[prop]))) return;
    if (entries.some(([prop, value]) => !Object.hasOwn(UNDERLINE, prop) && (!['color', 'background-color'].includes(prop) || typeof value !== 'string' || /["<>;]/.test(value) || !CSS.supports(prop, value)))) return;
    highlight = { styles: Object.fromEntries(entries), formats: { bold: formats.bold, italic: formats.italic } };
    if (!pendingHighlight || data.requestId !== pendingHighlight.id) return;
    const pending = pendingHighlight;
    clearTimeout(pending.timer);
    pendingHighlight = null;
    // 조회를 기다리는 동안 문서나 선택이 바뀌었으면 다른 글자에 적용하지 않는다.
    if (getCM() !== pending.cm || pending.cm.getDoc() !== pending.doc || pending.doc.getValue() !== pending.text || JSON.stringify(pending.doc.listSelections()) !== pending.selection) return;
    applyHighlight();
  });
  window.postMessage({ source: 'velog-plus', type: 'get-highlight-style' }, location.origin);

  function runHighlight() {
    const cm = getCM();
    if (!cm) return;
    const doc = cm.getDoc();
    const selections = doc.listSelections();
    if (selections.every(({ anchor, head }) => anchor.line === head.line && anchor.ch === head.ch)) return;
    if (pendingHighlight) clearTimeout(pendingHighlight.timer);
    const id = ++nextHighlightRequest;
    pendingHighlight = { id, cm, doc, text: doc.getValue(), selection: JSON.stringify(selections) };
    pendingHighlight.timer = setTimeout(() => {
      if (pendingHighlight?.id !== id) return;
      pendingHighlight = null;
      window.__velogPlusApi?.toast('강조 설정을 받지 못했습니다. 작성 내용을 보관하고 확장과 velog 탭을 새로고침하세요.');
    }, 1500);
    window.postMessage({ source: 'velog-plus', type: 'get-highlight-style', requestId: id }, location.origin);
  }

  function applyHighlight() {
    const { styles, formats } = highlight;
    if (!Object.keys(styles).length && !formats.bold && !formats.italic) return;
    transformSelections((texts) => {
      // 여러 선택도 함께 판정한다. 보이는 글자가 있는 모든 선택에 켠 항목이 다 있을 때만 해제한다.
      const on = texts.some((text) => isHighlighted(text, styles, formats) === false);
      return texts.map((text) => toggleHighlight(text, styles, formats, on));
    }, true);
  }

  const MODIFIER = /Mac|iPhone|iPad/.test(navigator.platform) ? 'Cmd' : 'Ctrl';

  function ensureShortcut() {
    const cm = getCM();
    if (!cm || cm.__velogPlusShortcut) return;
    cm.__velogPlusShortcut = true;
    cm.addKeyMap({
      [`${MODIFIER}-E`]: () => runHighlight(),
      [`${MODIFIER}-B`]: () => document.querySelector('#toolbar .ql-bold')?.click(),
      [`${MODIFIER}-I`]: () => document.querySelector('#toolbar .ql-italic')?.click(),
      [`${MODIFIER}-U`]: () => transformSelections((texts) => texts.map((text) => toggleStyles(text, UNDERLINE)), true),
    });
  }

  function sortPos(a, b) {
    return a.line < b.line || (a.line === b.line && a.ch <= b.ch) ? [a, b] : [b, a];
  }

  // ---------- 팔레트 팝오버 ----------

  let popover = null;

  function closePopover() {
    if (!popover) return;
    popover.remove();
    popover = null;
    document.removeEventListener('mousedown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
  }

  function onOutside(e) {
    if (popover && !popover.contains(e.target) && !e.target.closest('.vp-tool')) closePopover();
  }

  function onKey(e) {
    if (e.key === 'Escape') closePopover();
  }

  function swatch(kind, name, value, hint) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'vp-swatch';
    const tuple = `(${parseColor(value).rgb.join(', ')})`;
    b.title = `${name} ${tuple} · 우클릭으로 RGB 복사`;
    b.setAttribute('aria-label', b.title);
    b.style.setProperty('--vp-swatch', value);
    if (kind === 'color') b.textContent = 'A';
    b.addEventListener('click', () => {
      apply(kind, value);
      closePopover();
    });
    const showRGB = () => { hint.textContent = `${tuple} · 우클릭으로 복사`; };
    b.addEventListener('mouseenter', showRGB);
    b.addEventListener('focus', showRGB);
    b.addEventListener('contextmenu', async (e) => {
      e.preventDefault();
      try {
        await navigator.clipboard.writeText(tuple);
        hint.textContent = `${tuple} 복사됨`;
      } catch {
        hint.textContent = `${tuple} 복사 실패. 이 안내의 RGB 값을 선택해 직접 복사하세요.`;
      }
    });
    return b;
  }

  function openPopover(kind, anchor) {
    const wasOpen = popover && popover.dataset.kind === kind;
    closePopover();
    if (wasOpen) return;

    const tool = TOOLS[kind];
    popover = document.createElement('div');
    popover.className = 'vp-popover';
    popover.dataset.kind = kind;
    // 색상 선택과 안내의 수동 복사는 기본 동작을 허용한다.
    popover.addEventListener('mousedown', (e) => {
      if (!e.target.matches('input, .vp-color-hint')) e.preventDefault();
    });

    const title = document.createElement('div');
    title.className = 'vp-popover-title';
    title.textContent = tool.title;
    popover.append(title);

    const hint = document.createElement('div');
    hint.className = 'vp-color-hint';
    hint.setAttribute('aria-live', 'polite');
    hint.textContent = '색상에 마우스를 올리면 RGB · 우클릭으로 복사';

    const grid = document.createElement('div');
    grid.className = 'vp-swatches';
    for (const [name, value] of tool.colors) grid.append(swatch(kind, name, value, hint));
    popover.append(grid);

    const recent = loadRecent(kind);
    if (recent.length) {
      const label = document.createElement('div');
      label.className = 'vp-popover-label';
      label.textContent = '최근 사용';
      const row = document.createElement('div');
      row.className = 'vp-swatches';
      for (const value of recent) row.append(swatch(kind, '최근', value, hint));
      popover.append(label, row);
    }

    const footer = document.createElement('div');
    footer.className = 'vp-popover-footer';
    const picker = document.createElement('label');
    picker.className = 'vp-custom';
    picker.textContent = '직접 선택';
    const input = document.createElement('input');
    input.type = 'color';
    input.value = '#e03131';
    input.addEventListener('change', () => {
      apply(kind, input.value);
      closePopover();
    });
    picker.append(input);
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'vp-clear';
    clear.textContent = `${tool.title} 지우기`;
    clear.addEventListener('click', () => {
      apply(kind, null);
      closePopover();
    });
    footer.append(picker, clear);
    popover.append(footer, hint);

    document.body.append(popover);
    const rect = anchor.getBoundingClientRect();
    const left = Math.min(rect.left, window.innerWidth - popover.offsetWidth - 8);
    popover.style.left = `${Math.max(8, left)}px`;
    popover.style.top = `${rect.bottom + 6}px`;
    document.addEventListener('mousedown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
  }

  // ---------- 툴바 버튼 ----------

  const ICONS = {
    color:
      '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M10.6 3h2.8l5.4 14h-2.6l-1.3-3.6H9.1L7.8 17H5.2L10.6 3zm-.7 8.2h4.2L12 5.6l-2.1 5.6z"/><rect x="4" y="19" width="16" height="3" rx="1" fill="var(--vp-icon-bar, #e03131)"/></svg>',
    bg:
      '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M15.2 2.6l4.2 4.2-8.5 8.5-4.2-4.2 8.5-8.5zM5.9 12.5l3.6 3.6-1.4 1.4H4.5v-1.5l1.4-3.5z"/><rect x="4" y="19" width="16" height="3" rx="1" fill="var(--vp-icon-bar, rgba(255, 212, 59, 0.8))"/></svg>',
  };

  function makeButton(kind, base) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `${base.className.replace(/\bql-[\w-]+/g, '').trim()} vp-tool`;
    b.dataset.kind = kind;
    b.title = TOOLS[kind].title;
    b.innerHTML = ICONS[kind];
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => openPopover(kind, b));
    return b;
  }

  function ensureToolbar() {
    const toolbar = document.getElementById('toolbar');
    if (!toolbar || toolbar.querySelector('.vp-tool')) return;
    const codeButton = toolbar.querySelector('.ql-code-block');
    if (!codeButton) return;
    const divider = [...codeButton.parentElement.children].find((el) => el.tagName === 'DIV');
    const nodes = [];
    if (divider) {
      const d = divider.cloneNode(false);
      d.classList.add('vp-divider');
      nodes.push(d);
    }
    nodes.push(makeButton('color', codeButton), makeButton('bg', codeButton));
    codeButton.after(...nodes);
  }

  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      ensureToolbar();
      ensureShortcut();
      if (popover && !document.querySelector('#toolbar .vp-tool')) closePopover();
    });
  }).observe(document.body, { childList: true, subtree: true });
  ensureToolbar();
  ensureShortcut();
})();
