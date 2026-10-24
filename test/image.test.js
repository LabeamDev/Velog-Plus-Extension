const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const markup = require('../src/markup.js');

function imageEditor(text = '<p><img src="https://example.com/a.png" width="100%"></p>') {
  function element() {
    const listeners = new Map();
    return {
      style: { width: '', removeProperty(key) { this[key] = ''; } }, isConnected: true,
      addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
      removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
      fire(type, extra = {}) { for (const fn of [...(listeners.get(type) || [])]) fn({ type, target: this, pointerId: 1, clientX: 1000, preventDefault() {}, ...extra }); },
      contains: () => false,
      setPointerCapture(id) { this.capture = id; },
      hasPointerCapture(id) { return this.capture === id; },
      releasePointerCapture() { this.capture = null; },
    };
  }
  let value = text;
  let writes = 0;
  const toasts = [];
  const label = element();
  const handle = element();
  const frame = element();
  frame.querySelector = (selector) => selector === '.vp-img-handle' ? handle : label;
  const images = markup.findImages(text).map((token) => {
    const img = element();
    img.attrs = { src: token.src, width: token.width };
    img.parentElement = { clientWidth: 1000 };
    img.getAttribute = (key) => img.attrs[key];
    img.closest = () => img;
    img.getBoundingClientRect = () => {
      const width = parseFloat(img.style.width || img.attrs.width || '100%') * 10;
      return { left: 0, top: 0, right: width, bottom: width / 2, width, height: width / 2 };
    };
    return img;
  });
  const doc = {
    getValue: () => value, posFromIndex: (n) => n,
    replaceRange(next, from, to) {
      value = value.slice(0, from) + next + value.slice(to); writes++;
      // React는 이미지 노드를 재사용하며 바뀐 원문의 속성만 갱신한다.
      markup.findImages(value).forEach((token, i) => { images[i].attrs.width = token.width; });
    },
  };
  const document = Object.assign(element(), {
    createElement: () => frame, body: { append() {} }, querySelectorAll: () => images,
  });
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/image.js'), 'utf8'), {
    document,
    window: { __velogPlusMarkup: markup, __velogPlusGrid: {}, __velogPlusApi: { getCM: () => ({ getDoc: () => doc }), toast: (s) => toasts.push(s) }, addEventListener() {} },
    getComputedStyle: () => ({ paddingLeft: '0', paddingRight: '0' }),
  });
  return {
    images, handle, document, toasts, value: () => value, writes: () => writes,
    show(i = 0) { document.fire('mouseover', { target: images[i] }); },
    preset(percent) { frame.fire('click', { target: { closest: () => ({ dataset: { percent: String(percent) } }) } }); },
    start(i = 0) { this.show(i); handle.fire('pointerdown'); },
    move(clientX) { document.fire('pointermove', { clientX }); },
    end(type = 'pointerup') { (type === 'lostpointercapture' ? handle : document).fire(type); },
    edit(next) { value = next; },
  };
}

test('드래그 완료는 원문에 비율을 저장하고 임시 너비를 지워 후속 버튼·Undo 표시를 가리지 않는다', () => {
  const e = imageEditor();
  e.start(); e.move(750);
  assert.equal(e.images[0].style.width, '75%');
  assert.match(e.value(), /width="100%"/);
  e.end();
  assert.match(e.value(), /width="75%"/);
  assert.equal(e.images[0].style.width, '');
  assert.equal(e.images[0].getBoundingClientRect().width, 750);
  for (const percent of [25, 50, 75, 100, '']) {
    e.show(); e.preset(percent);
    assert.equal(markup.findImages(e.value())[0].width, percent ? `${percent}%` : null);
    assert.equal(e.images[0].style.width, '');
    assert.equal(e.images[0].getBoundingClientRect().width, percent ? percent * 10 : 1000);
  }
  e.images[0].attrs.width = '50%';
  assert.equal(e.images[0].getBoundingClientRect().width, 500);
});

test('기존 임시 너비가 남아 있어도 비율 버튼은 원문의 크기로 맞춘다', () => {
  const e = imageEditor();
  e.images[0].style.width = '75%';
  e.show(); e.preset(25);
  assert.match(e.value(), /width="25%"/);
  assert.equal(e.images[0].getBoundingClientRect().width, 250);
});

test('드래그 중단·포인터 캡처 해제는 원문을 보존하고 임시 크기를 되돌리며 다음 조절을 허용한다', () => {
  for (const type of ['pointercancel', 'lostpointercapture']) {
    const e = imageEditor();
    e.start(); e.move(600); e.end(type);
    assert.equal(e.writes(), 0);
    assert.equal(e.images[0].getBoundingClientRect().width, 1000);
    e.start(); e.move(500); e.end();
    assert.match(e.value(), /width="50%"/);
    assert.equal(e.writes(), 1);
  }
});

test('드래그 도중 원문의 이미지가 사라지면 화면 크기만 바뀐 상태를 남기지 않는다', () => {
  const e = imageEditor();
  e.start(); e.move(500); e.edit('바뀐 본문'); e.end();
  assert.equal(e.value(), '바뀐 본문');
  assert.equal(e.images[0].style.width, '');
  assert.equal(e.writes(), 0);
  assert.equal(e.toasts.length, 1);
});

test('같은 주소의 두 번째 이미지를 드래그하면 해당 원문만 바꾸고 다른 포인터 입력은 무시한다', () => {
  const e = imageEditor('![](https://example.com/a.png)\n\n![](https://example.com/a.png)');
  e.start(1); e.move(500);
  e.document.fire('pointermove', { clientX: 200, pointerId: 2 });
  e.document.fire('pointerup', { pointerId: 2 });
  assert.equal(e.writes(), 0);
  e.end();
  assert.deepEqual(markup.findImages(e.value()).map((t) => t.width), [null, '50%']);
});
