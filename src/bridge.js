// MAIN world 스크립트는 chrome.* 를 못 쓰므로 여기서 중계한다.
// - image.js 의 이미지 요청 → 백그라운드
// - 팝업에서 정한 강조 단축키 스타일 → editor.js
window.addEventListener('message', (event) => {
  const data = event.data;
  if (event.source !== window || data?.source !== 'velog-plus' || data.type !== 'fetch-image') return;
  chrome.runtime.sendMessage({ type: 'fetch-image', url: data.url }, (response) => {
    const result = response || { error: chrome.runtime.lastError?.message || '이미지를 받지 못했습니다.' };
    window.postMessage({ source: 'velog-plus', type: 'fetch-image-result', id: data.id, ...result }, location.origin);
  });
});

const HIGHLIGHT_DEFAULTS = {
  hlColorOn: true,
  hlColor: '#eb5757',
  hlBgOn: true,
  hlBg: '#878378',
  hlBgAlpha: 15,
};

function hexToRgba(hex, alphaPercent) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alphaPercent / 100})`;
}

function sendHighlightStyle() {
  chrome.storage.local.get(HIGHLIGHT_DEFAULTS, (s) => {
    const styles = {};
    if (s.hlColorOn) styles.color = s.hlColor;
    if (s.hlBgOn) styles['background-color'] = hexToRgba(s.hlBg, s.hlBgAlpha);
    window.postMessage({ source: 'velog-plus', type: 'highlight-style', styles }, location.origin);
  });
}

window.addEventListener('message', (event) => {
  const data = event.data;
  if (event.source === window && data?.source === 'velog-plus' && data.type === 'get-highlight-style') sendHighlightStyle();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && Object.keys(changes).some((key) => key in HIGHLIGHT_DEFAULTS)) sendHighlightStyle();
});
sendHighlightStyle();
