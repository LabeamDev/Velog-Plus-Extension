const DEFAULTS = { enabled: true, width: 1024 };
const enabled = document.getElementById('enabled');
const range = document.getElementById('range');
const number = document.getElementById('number');

function show({ enabled: on, width }) {
  enabled.checked = on;
  range.value = width;
  number.value = width;
  document.body.classList.toggle('off', !on);
}

function setWidth(value) {
  const width = Math.min(2400, Math.max(480, Math.round(Number(value) || DEFAULTS.width)));
  range.value = width;
  number.value = width;
  chrome.storage.local.set({ width });
}

chrome.storage.local.get(DEFAULTS, show);

enabled.addEventListener('change', () => {
  chrome.storage.local.set({ enabled: enabled.checked });
  document.body.classList.toggle('off', !enabled.checked);
});
range.addEventListener('input', () => setWidth(range.value));
number.addEventListener('input', () => {
  const width = number.valueAsNumber;
  // 입력 중인 빈 값·짧은 숫자를 보정하면 다음 숫자를 이어 쓸 수 없다.
  if (Number.isFinite(width) && width >= 480 && width <= 2400) setWidth(width);
});
number.addEventListener('change', () => setWidth(number.value));
for (const button of document.querySelectorAll('[data-width]')) {
  button.addEventListener('click', () => setWidth(button.dataset.width));
}

// 기능 설명은 확장 안의 사용법 페이지에 있다.
document.getElementById('help').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('help/help.html') });
});

// ---------- 강조 단축키 스타일 ----------

const HIGHLIGHT_DEFAULTS = { hlColorOn: true, hlColor: '#eb5757', hlBgOn: true, hlBg: '#878378', hlBgAlpha: 15, hlBold: false, hlItalic: false, hlUnderline: false };
const hl = Object.fromEntries(Object.keys(HIGHLIGHT_DEFAULTS).map((key) => [key, document.getElementById(key)]));
const preview = document.getElementById('hlPreview');
const alphaValue = document.getElementById('hlBgAlphaValue');

if (!/Mac|iPhone|iPad/.test(navigator.platform)) document.getElementById('shortcut').textContent = 'Ctrl+E';

function hexToRgba(hex, alphaPercent) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alphaPercent / 100})`;
}

function readHighlight() {
  return {
    hlColorOn: hl.hlColorOn.checked,
    hlColor: hl.hlColor.value,
    hlBgOn: hl.hlBgOn.checked,
    hlBg: hl.hlBg.value,
    hlBgAlpha: Number(hl.hlBgAlpha.value),
    hlBold: hl.hlBold.checked,
    hlItalic: hl.hlItalic.checked,
    hlUnderline: hl.hlUnderline.checked,
  };
}

function showHighlight(s) {
  hl.hlColorOn.checked = s.hlColorOn;
  hl.hlColor.value = s.hlColor;
  hl.hlBgOn.checked = s.hlBgOn;
  hl.hlBg.value = s.hlBg;
  hl.hlBgAlpha.value = s.hlBgAlpha;
  hl.hlBold.checked = s.hlBold;
  hl.hlItalic.checked = s.hlItalic;
  hl.hlUnderline.checked = s.hlUnderline;
  alphaValue.textContent = `${s.hlBgAlpha}%`;
  hl.hlColor.disabled = !s.hlColorOn;
  hl.hlBg.disabled = !s.hlBgOn;
  hl.hlBgAlpha.disabled = !s.hlBgOn;
  preview.style.color = s.hlColorOn ? s.hlColor : '';
  preview.style.backgroundColor = s.hlBgOn ? hexToRgba(s.hlBg, s.hlBgAlpha) : '';
  preview.style.fontWeight = s.hlBold ? 'bold' : '';
  preview.style.fontStyle = s.hlItalic ? 'italic' : '';
  preview.style.borderBottomWidth = s.hlUnderline ? '1px' : '';
  preview.style.borderStyle = s.hlUnderline ? 'none none solid' : '';
}

chrome.storage.local.get(HIGHLIGHT_DEFAULTS, showHighlight);

for (const el of Object.values(hl)) {
  const saveHighlight = () => {
    let s = readHighlight();
    // 마지막 스타일은 켜 두어 단축키가 할 일 없는 설정을 막는다.
    if (![s.hlColorOn, s.hlBgOn, s.hlBold, s.hlItalic, s.hlUnderline].some(Boolean)) {
      el.checked = true;
      s = readHighlight();
    }
    showHighlight(s);
    chrome.storage.local.set(s);
  };
  el.addEventListener('input', saveHighlight);
  el.addEventListener('change', saveHighlight);
}
