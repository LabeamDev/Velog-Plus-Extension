// velog 글 페이지의 본문 폭(기본 768px)을 바꾼다.
// 제목·본문·댓글 컨테이너에 data-vp-wide 를 달고 CSS 변수 --vp-width 로 폭을 정한다.
(function () {
  const DEFAULTS = { enabled: true, width: 1024 };
  const ORIGINAL_WIDTH = 768;
  const MIN_WIDTH = 480;
  const MAX_WIDTH = 2400;
  const html = document.documentElement;
  let settings = { ...DEFAULTS };

  function render() {
    html.style.setProperty('--vp-width', `${settings.width}px`);
    html.toggleAttribute('data-vp-off', !settings.enabled);
    placeTagList();
    fitSidePanels();
  }

  // 블로그 홈의 태그 목록은 글 목록 왼쪽 바깥(216px)에 붙는다. 본문을 넓혀 그 자리가 화면 밖이면 안쪽으로 넣는다.
  const TAG_LIST_SPACE = 216 + 16;

  function placeTagList() {
    const layout = document.querySelector("[class*='VelogLayout_block__']");
    const tags = layout && layout.querySelector("[class*='VelogTagVerticalList_block__']");
    let inside = false;
    // 좁은 화면(1200px 이하)에서는 velog 가 태그 목록을 숨긴다.
    if (tags && settings.enabled && getComputedStyle(tags).display !== 'none') {
      inside = layout.getBoundingClientRect().left < TAG_LIST_SPACE;
    }
    if (html.hasAttribute('data-vp-tags-inside') !== inside) html.toggleAttribute('data-vp-tags-inside', inside);
  }

  // 글 페이지의 좌우 사이드(좋아요·공유 버튼, 목차)는 본문 바깥에 붙어 있어 본문을 넓히면 화면 밖으로 밀려난다.
  // 화면 안으로 당겨 오고, 당겨도 본문과 겹치면 숨긴다. 왼쪽 고정 광고는 본문과 겹칠 때만 숨긴다.
  const EDGE = 8;

  function sideTargets() {
    const targets = [];
    const head = document.querySelector('.head-wrapper');
    const holder = head && [...head.children].find((el) => getComputedStyle(el).position === 'relative');
    if (holder) {
      for (const panel of holder.children) {
        if (getComputedStyle(panel).position === 'absolute') targets.push({ el: panel.firstElementChild || panel, ad: false });
      }
    }
    for (const el of document.querySelectorAll('#fuse-sidebar > *')) targets.push({ el, ad: true });
    return targets;
  }

  function fitSidePanels() {
    const body = document.querySelector('[data-vp-body]');
    const targets = sideTargets();
    for (const { el } of targets) {
      el.style.removeProperty('translate');
      el.removeAttribute('data-vp-hidden');
    }
    if (!body || !settings.enabled) return;
    const b = body.getBoundingClientRect();
    const overlaps = (left, right) => left < b.right && right > b.left;
    for (const { el, ad } of targets) {
      const r = el.getBoundingClientRect();
      if (!r.width) continue;
      if (ad) {
        if (overlaps(r.left, r.right)) el.setAttribute('data-vp-hidden', '');
        continue;
      }
      let dx = 0;
      if (r.right > window.innerWidth - EDGE) dx = window.innerWidth - EDGE - r.right;
      if (r.left + dx < EDGE) dx = EDGE - r.left;
      if (overlaps(r.left + dx, r.right + dx)) el.setAttribute('data-vp-hidden', '');
      else if (dx) el.style.setProperty('translate', `${Math.round(dx)}px 0`);
    }
  }

  function clamp(width) {
    return Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width)));
  }

  // 원래 768px 고정 폭인 컨테이너만 넓힌다. 화면 전체 폭 영역(관심 있을 만한 포스트 등)은 제외.
  function isNarrow(el) {
    return el.hasAttribute('data-vp-wide') || getComputedStyle(el).width === `${ORIGINAL_WIDTH}px`;
  }

  // 본문(.atom-one)을 감싸는 최상위 컨테이너와, 같은 부모 아래의 제목·댓글 컨테이너를 찾는다.
  function findContainers() {
    const article = [...document.querySelectorAll('.atom-one')].find((el) => !el.closest('#preview'));
    if (!article) return null;
    const head = document.querySelector('.head-wrapper');
    if (head) {
      let body = article;
      while (body.parentElement && !body.parentElement.contains(head)) body = body.parentElement;
      const parent = body.parentElement;
      if (!parent) return null;
      const children = [...parent.children];
      const headIndex = children.findIndex((el) => el.contains(head));
      const bodyIndex = children.indexOf(body);
      const start = headIndex < 0 ? bodyIndex : Math.min(headIndex, bodyIndex);
      if (!isNarrow(body)) return null;
      return { body, wide: children.slice(start).filter(isNarrow) };
    }
    // 제목 영역이 없는 페이지(소개 등)는 768px 조상 하나만 넓힌다.
    for (let el = article; el && el !== document.body; el = el.parentElement) {
      if (isNarrow(el)) {
        return { body: el, wide: [el] };
      }
    }
    return null;
  }

  function mark() {
    const found = findContainers();
    if (!found) return;
    for (const el of found.wide) {
      if (!el.hasAttribute('data-vp-wide')) el.setAttribute('data-vp-wide', '');
    }
    if (!found.body.hasAttribute('data-vp-body')) found.body.setAttribute('data-vp-body', '');
    if (!found.body.querySelector(':scope > .vp-handle')) addHandles(found.body);
  }

  // ---------- 본문 양옆 드래그 핸들 ----------

  let badge = null;

  function showBadge(text) {
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'vp-badge';
      document.body.append(badge);
    }
    badge.textContent = text;
    badge.hidden = false;
  }

  function addHandles(body) {
    for (const side of ['left', 'right']) {
      const handle = document.createElement('div');
      handle.className = `vp-handle vp-handle-${side}`;
      handle.title = '드래그: 본문 폭 조절 / 더블클릭: 원래 폭(768px)';
      handle.addEventListener('pointerdown', (e) => startDrag(e, body, handle));
      handle.addEventListener('dblclick', () => save({ width: ORIGINAL_WIDTH }));
      body.append(handle);
    }
  }

  function startDrag(e, body, handle) {
    if (!settings.enabled) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const rect = body.getBoundingClientRect();
    const center = rect.left + rect.width / 2;
    html.classList.add('vp-dragging');

    const onMove = (ev) => {
      settings.width = clamp(Math.abs(ev.clientX - center) * 2);
      render();
      showBadge(`${settings.width}px`);
    };
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      html.classList.remove('vp-dragging');
      if (badge) badge.hidden = true;
      save({ width: settings.width });
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  }

  // ---------- 설정 저장·동기화 ----------

  function save(patch) {
    settings = { ...settings, ...patch };
    render();
    chrome.storage.local.set(patch);
  }

  chrome.storage.local.get(DEFAULTS, (stored) => {
    settings = { ...DEFAULTS, ...stored };
    render();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const key of Object.keys(DEFAULTS)) {
      if (changes[key]) settings[key] = changes[key].newValue ?? DEFAULTS[key];
    }
    render();
  });

  render();

  // velog 는 SPA 라 페이지 이동 시 DOM 이 바뀌므로 계속 다시 표시한다.
  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      mark();
      placeTagList();
      fitSidePanels();
    });
  }).observe(document.body, { childList: true, subtree: true });
  // 좁은 창(768px 미만)에서는 폭이 100% 라 표시하지 못하므로 창을 키우면 다시 시도한다.
  // 목차는 스크롤하면 고정 위치로 바뀌므로 스크롤 때도 다시 맞춘다.
  let scrollScheduled = false;
  window.addEventListener(
    'scroll',
    () => {
      if (scrollScheduled) return;
      scrollScheduled = true;
      requestAnimationFrame(() => {
        scrollScheduled = false;
        fitSidePanels();
      });
    },
    { passive: true },
  );

  window.addEventListener('resize', () => {
    mark();
    placeTagList();
    fitSidePanels();
  });
  mark();
})();
