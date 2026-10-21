// velog 에디터(/write) 툴바에 글자색·배경색 버튼을 붙이고, 강조 단축키(⌘E / Ctrl+E)를 연결한다.
// CodeMirror 인스턴스(.CodeMirror 요소의 CodeMirror 속성)에 접근해야 해서 MAIN world 에서 실행된다.
(function () {
  if (window.__velogPlusEditor) return;
  window.__velogPlusEditor = true;

  const { applyStyle, toggleStyles, innerRange } = window.__velogPlusMarkup;

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

  function getCM() {
    const el = document.querySelector('.CodeMirror');
    return el && el.CodeMirror;
  }

  function loadRecent(kind) {
    try {
      return JSON.parse(localStorage.getItem(RECENT_KEY))[kind] || [];
    } catch {
      return [];
    }
  }

  function pushRecent(kind, value) {
    let all;
    try {
      all = JSON.parse(localStorage.getItem(RECENT_KEY)) || {};
    } catch {
      all = {};
    }
    all[kind] = [value, ...(all[kind] || []).filter((v) => v !== value)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(all));
  }

  // span 안의 일부만 선택해도 나머지 글자의 스타일은 보존한다.
  function expandToSpan(doc, from, to, partial) {
    if (from.line !== to.line) return null;
    const line = doc.getLine(from.line);
    for (const m of line.matchAll(/(<span style="[^"]*">)((?:(?!<\/?span\b).)*)<\/span>/g)) {
      const start = m.index + m[1].length;
      const end = start + m[2].length;
      if (from.ch < start || to.ch > end) continue;
      if (!partial && (from.ch !== start || to.ch !== end)) continue;
      const wrap = (s) => s ? m[1] + s + '</span>' : '';
      return {
        from: { line: from.line, ch: m.index },
        to: { line: to.line, ch: m.index + m[0].length },
        before: wrap(line.slice(start, from.ch)),
        after: wrap(line.slice(to.ch, end)),
        text: m[1] + line.slice(from.ch, to.ch) + '</span>',
      };
    }
    return null;
  }

  // 한 줄은 span 안쪽을, 여러 줄은 바뀐 전체를 선택해 반복 단축키가 같은 글에 적용되게 한다.
  function transformSelections(transform, selectedOnly = false) {
    const cm = getCM();
    if (!cm) return;
    const doc = cm.getDoc();
    const selections = doc.listSelections();
    const ranges = selections.map((r) => {
      const [from, to] = sortPos(r.anchor, r.head);
      if (selectedOnly && from.line === to.line && from.ch === to.ch) return null;
      return expandToSpan(doc, from, to, selections.length === 1) || { from, to };
    }).filter(Boolean);
    const nextSelections = [];
    cm.operation(() => {
      // 뒤에서부터 바꿔야 앞쪽 위치가 밀리지 않는다.
      for (const { from, to, before = '', after = '', text = doc.getRange(from, to) } of [...ranges].reverse()) {
        const out = transform(text);
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
    transformSelections((text) => applyStyle(text, prop, value));
    if (value) pushRecent(kind, value);
  }

  // ---------- 강조 단축키 ----------
  // 스타일은 확장 팝업에서 정하고 bridge.js 가 chrome.storage 값을 메시지로 보내 준다.

  let highlight = { color: '#eb5757', 'background-color': 'rgba(135, 131, 120, 0.15)' };

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (event.source !== window || data?.source !== 'velog-plus' || data.type !== 'highlight-style') return;
    if (!data.styles || typeof data.styles !== 'object') return;
    const entries = Object.entries(data.styles);
    if (entries.some(([prop, value]) => !['color', 'background-color'].includes(prop) || typeof value !== 'string' || /["<>;]/.test(value) || !CSS.supports(prop, value))) return;
    highlight = Object.fromEntries(entries);
  });
  window.postMessage({ source: 'velog-plus', type: 'get-highlight-style' }, location.origin);

  function toggleHighlight() {
    if (!Object.keys(highlight).length) return;
    transformSelections((text) => toggleStyles(text, highlight), true);
  }

  const SHORTCUT = /Mac|iPhone|iPad/.test(navigator.platform) ? 'Cmd-E' : 'Ctrl-E';

  function ensureShortcut() {
    const cm = getCM();
    if (!cm || cm.__velogPlusShortcut) return;
    cm.__velogPlusShortcut = true;
    cm.addKeyMap({ [SHORTCUT]: () => toggleHighlight() });
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

  function swatch(kind, name, value) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'vp-swatch';
    b.title = `${name} ${value}`;
    b.style.setProperty('--vp-swatch', value);
    if (kind === 'color') b.textContent = 'A';
    b.addEventListener('click', () => {
      apply(kind, value);
      closePopover();
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
    // 팝오버 클릭이 에디터 포커스·선택을 빼앗지 않게 한다. (색상 입력칸은 예외)
    popover.addEventListener('mousedown', (e) => {
      if (!e.target.matches('input')) e.preventDefault();
    });

    const title = document.createElement('div');
    title.className = 'vp-popover-title';
    title.textContent = tool.title;
    popover.append(title);

    const grid = document.createElement('div');
    grid.className = 'vp-swatches';
    for (const [name, value] of tool.colors) grid.append(swatch(kind, name, value));
    popover.append(grid);

    const recent = loadRecent(kind).filter((v) => !tool.colors.some(([, c]) => c === v));
    if (recent.length) {
      const label = document.createElement('div');
      label.className = 'vp-popover-label';
      label.textContent = '최근 사용';
      const row = document.createElement('div');
      row.className = 'vp-swatches';
      for (const value of recent) row.append(swatch(kind, '최근', value));
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
    popover.append(footer);

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
