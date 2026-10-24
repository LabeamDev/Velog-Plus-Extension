const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function popup(stored = { enabled: true, width: 1024 }) {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) {
      let value = '';
      const listeners = {};
      elements.set(id, {
        get value() { return value; },
        set value(next) { value = String(next); },
        get valueAsNumber() { return value === '' ? NaN : Number(value); },
        style: {},
        addEventListener(type, fn) { listeners[type] = fn; },
        fire(type) { listeners[type]?.(); },
      });
    }
    return elements.get(id);
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../popup/popup.js'), 'utf8'), {
    document: {
      getElementById: element,
      querySelectorAll: () => [],
      body: { classList: { toggle() {} } },
    },
    navigator: { platform: 'MacIntel' },
    chrome: { storage: { local: {
      get(defaults, callback) { callback({ ...defaults, ...stored }); },
      set(patch) { Object.assign(stored, patch); },
    } } },
  });
  return { number: element('number'), range: element('range'), element, stored };
}

test('폭 숫자는 blur·Enter 없이 입력 즉시 저장한다', () => {
  const { number, range, stored } = popup();
  number.value = '1280';
  number.fire('input');
  assert.equal(stored.width, 1280);
  assert.equal(range.value, '1280');
});

test('1600을 입력하는 도중의 짧은 숫자를 강제로 바꾸지 않는다', () => {
  const { number, stored } = popup();
  for (const value of ['1', '16', '160']) {
    number.value = value;
    number.fire('input');
    assert.equal(number.value, value);
    assert.equal(stored.width, 1024);
  }
  number.value = '1600';
  number.fire('input');
  assert.equal(stored.width, 1600);
});

test('빈 값이나 범위 밖 숫자는 입력 중 기존 저장값을 덮어쓰지 않는다', () => {
  const { number, stored } = popup();
  for (const value of ['', '0', '2401']) {
    number.value = value;
    number.fire('input');
    assert.equal(stored.width, 1024);
  }
});

test('입력을 마치면 범위 밖 숫자를 보정한다', () => {
  const { number, stored } = popup();
  number.value = '9999';
  number.fire('change');
  assert.equal(stored.width, 2400);
  assert.equal(number.value, '2400');
});

for (const event of ['input', 'change']) {
  test(`강조 설정은 ${event} 후 팝업을 다시 열어도 유지한다`, () => {
    const { element, stored } = popup();
    for (const [id, value] of [['hlColor', '#123456'], ['hlBg', '#abcdef'], ['hlBgAlpha', '65']]) {
      element(id).value = value;
      element(id).fire(event);
      assert.equal(stored[id], id === 'hlBgAlpha' ? Number(value) : value);
    }
    element('hlColorOn').checked = false;
    element('hlColorOn').fire(event);

    assert.equal(stored.hlColor, '#123456');
    assert.equal(stored.hlBg, '#abcdef');
    assert.equal(stored.hlBgAlpha, 65);
    assert.equal(stored.hlColorOn, false);
    assert.equal(stored.hlBgOn, true);

    const reopened = popup(stored).element;
    assert.equal(reopened('hlColor').value, '#123456');
    assert.equal(reopened('hlBg').value, '#abcdef');
    assert.equal(reopened('hlBgAlpha').value, '65');
    assert.equal(reopened('hlBgAlphaValue').textContent, '65%');
    assert.equal(reopened('hlColorOn').checked, false);
    assert.equal(reopened('hlColor').disabled, true);
    assert.equal(reopened('hlPreview').style.backgroundColor, 'rgba(171, 205, 239, 0.65)');
    assert.equal(reopened('hlPreview').style.color, '');
  });
}

test('변경 확정으로 마지막 강조 스타일을 끄면 기존 스타일을 유지한다', () => {
  const { element, stored } = popup();
  element('hlColorOn').checked = false;
  element('hlColorOn').fire('change');
  element('hlBgOn').checked = false;
  element('hlBgOn').fire('change');
  assert.equal(stored.hlColorOn, false);
  assert.equal(stored.hlBgOn, true);
  assert.equal(element('hlBgOn').checked, true);
});

for (const event of ['input', 'change']) {
  test(`굵게·기울임·밑줄은 ${event}로 저장되고 색상 없이도 사용할 수 있다`, () => {
    const { element, stored } = popup();
    for (const key of ['hlBold', 'hlItalic', 'hlUnderline']) {
      assert.equal(element(key).checked, false);
      element(key).checked = true;
      element(key).fire(event);
    }
    for (const key of ['hlColorOn', 'hlBgOn']) {
      element(key).checked = false;
      element(key).fire(event);
    }
    const reopened = popup(stored).element;
    for (const key of ['hlBold', 'hlItalic', 'hlUnderline']) assert.equal(reopened(key).checked, true);
    for (const key of ['hlColorOn', 'hlBgOn']) assert.equal(reopened(key).checked, false);
    assert.equal(reopened('hlPreview').style.fontWeight, 'bold');
    assert.equal(reopened('hlPreview').style.fontStyle, 'italic');
    assert.equal(reopened('hlPreview').style.borderBottomWidth, '1px');
    assert.equal(reopened('hlPreview').style.borderStyle, 'none none solid');
    assert.equal(reopened('hlPreview').style.color, '');
    assert.equal(reopened('hlPreview').style.backgroundColor, '');
  });
}

test('굵게·기울임·밑줄 중 마지막 옵션은 끌 수 없고 꺼진 옵션은 미리보기에서 빠진다', () => {
  for (const key of ['hlBold', 'hlItalic', 'hlUnderline']) {
    const { element, stored } = popup({ hlColorOn: false, hlBgOn: false, [key]: true });
    element(key).checked = false;
    element(key).fire('change');
    assert.equal(element(key).checked, true);
    assert.equal(stored[key], true);
    element('hlColorOn').checked = true;
    element('hlColorOn').fire('change');
    element(key).checked = false;
    element(key).fire('change');
    const style = element('hlPreview').style;
    assert.equal(style.fontWeight, '');
    assert.equal(style.fontStyle, '');
    assert.equal(style.borderBottomWidth, '');
    assert.equal(style.borderStyle, '');
  }
});
