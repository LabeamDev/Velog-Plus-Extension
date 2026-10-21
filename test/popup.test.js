const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function popup() {
  const elements = new Map();
  const stored = { enabled: true, width: 1024 };
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
        fire(type) { listeners[type](); },
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
  return { number: element('number'), range: element('range'), stored };
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
