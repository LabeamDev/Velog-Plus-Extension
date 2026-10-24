const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function bridge(stored = {}) {
  const messages = [];
  const listeners = [];
  let storageChanged;
  const window = {
    addEventListener(type, listener) { if (type === 'message') listeners.push(listener); },
    postMessage(message) { messages.push(JSON.parse(JSON.stringify(message))); },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/bridge.js'), 'utf8'), {
    window, location: { origin: 'https://velog.io' },
    chrome: { storage: {
      local: { get(defaults, callback) { callback({ ...defaults, ...stored }); } },
      onChanged: { addListener(listener) { storageChanged = listener; } },
    } },
  });
  return {
    messages,
    change(patch, area = 'local') { if (area === 'local') Object.assign(stored, patch); storageChanged(patch, area); },
    request(source = window, requestId) {
      for (const listener of listeners) listener({ source, data: { source: 'velog-plus', type: 'get-highlight-style', requestId } });
    },
    save(patch) { Object.assign(stored, patch); },
  };
}

test('기존 설정에는 굵게·기울임·밑줄을 기본으로 추가하지 않는다', () => {
  const { messages } = bridge();
  assert.deepEqual(messages[0].styles, { color: '#eb5757', 'background-color': 'rgba(135, 131, 120, 0.15)' });
  assert.deepEqual(messages[0].formats, { bold: false, italic: false });
});

test('단축키 요청은 변경 알림 없이도 최신 저장값을 읽고 요청 번호를 돌려준다', () => {
  const b = bridge({ hlBold: true, hlItalic: true });
  b.save({ hlItalic: false });
  b.request(undefined, 7);
  assert.deepEqual(b.messages.at(-1).formats, { bold: true, italic: false });
  assert.equal(b.messages.at(-1).requestId, 7);
});

test('굵게·기울임·밑줄만 선택한 설정도 초기 전달과 변경에 반영한다', () => {
  const b = bridge({ hlColorOn: false, hlBgOn: false, hlBold: true, hlItalic: true, hlUnderline: true });
  assert.deepEqual(b.messages[0].styles, { 'border-bottom-width': '1px', 'border-style': 'none none solid' });
  assert.deepEqual(b.messages[0].formats, { bold: true, italic: true });
  b.change({ hlBold: false, hlItalic: false, hlUnderline: false, hlBgOn: true, hlBg: '#ffff00', hlBgAlpha: 30 });
  assert.deepEqual(b.messages.at(-1).styles, { 'background-color': 'rgba(255, 255, 0, 0.3)' });
  assert.deepEqual(b.messages.at(-1).formats, { bold: false, italic: false });
});

test('폭 변경·다른 저장 영역·다른 창 요청은 무시하고 본문 요청에 응답한다', () => {
  const b = bridge();
  b.change({ width: 1600 });
  b.change({ hlBold: true }, 'sync');
  b.request({});
  assert.equal(b.messages.length, 1);
  b.request();
  assert.equal(b.messages.length, 2);
});
