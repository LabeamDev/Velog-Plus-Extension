const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const markup = require('../src/markup.js');

function editor({ recent = null, clipboardFails = false, storageFails = false, text = 'hello', platform = 'MacIntel', boldAvailable = true, italicAvailable = true } = {}) {
  function element(tag) {
    return {
      tagName: tag.toUpperCase(), children: [], dataset: {}, className: '', value: '', attributes: {}, listeners: {},
      style: { setProperty() {} },
      append(...nodes) { for (const n of nodes) { this.children.push(n); n.parentElement = this; } },
      after(...nodes) { this.parentElement.append(...nodes); },
      remove() { this.parentElement.children = this.parentElement.children.filter((n) => n !== this); },
      setAttribute(k, v) { this.attributes[k] = v; },
      removeAttribute(k) { delete this.attributes[k]; },
      setCustomValidity(value) { this.validationMessage = value; },
      reportValidity() { this.validityReported = true; },
      matches(selector) { return selector === 'input' && tag === 'input'; },
      getBoundingClientRect() { return { left: 100, bottom: 40 }; },
      offsetWidth: 262,
      addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
      async fire(type, extra = {}) {
        const event = { target: this, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...extra };
        for (const fn of this.listeners[type] || []) await fn(event);
        return event;
      },
    };
  }
  let value = text;
  let selection = [{ anchor: { line: 0, ch: 0 }, head: { line: 0, ch: text.length } }];
  let writes = 0;
  const doc = {
    listSelections: () => selection,
    getLine: () => value,
    getRange: (from, to) => value.slice(from.ch, to.ch),
    replaceRange(next, from, to) { value = value.slice(0, from.ch) + next + value.slice(to.ch); writes++; },
    indexFromPos: (p) => p.ch,
    posFromIndex: (ch) => ({ line: 0, ch }),
    setSelections(next) { selection = next; },
  };
  const keyMap = {};
  let boldClicks = 0;
  let italicClicks = 0;
  const bold = { click() { boldClicks++; } };
  const italic = { click() { italicClicks++; } };
  const cm = { getDoc: () => doc, operation: (fn) => fn(), focus() {}, addKeyMap(map) { Object.assign(keyMap, map); } };
  const toolbar = element('div');
  const code = element('button');
  code.className = 'ql-code-block';
  toolbar.append(code);
  toolbar.querySelector = (selector) => selector === '.ql-code-block' ? code : toolbar.children.find((n) => n.className.includes('vp-tool'));
  const body = element('body');
  const copied = [];
  const stored = { value: recent };
  const window = { __velogPlusMarkup: markup, addEventListener() {}, postMessage() {}, innerWidth: 1200 };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/editor.js'), 'utf8'), {
    window, location: { origin: 'https://velog.io' },
    navigator: { platform, clipboard: { async writeText(next) { if (clipboardFails) throw Error('denied'); copied.push(next); } } },
    localStorage: {
      getItem() { return stored.value; },
      setItem(key, next) { if (storageFails) throw Error('blocked'); stored.value = next; },
    },
    CSS: { supports: () => true },
    MutationObserver: class { observe() {} },
    document: {
      body, createElement: element, addEventListener() {}, removeEventListener() {},
      getElementById: () => toolbar,
      querySelector: (selector) => {
        if (selector === '.CodeMirror') return { CodeMirror: cm };
        if (selector === '#toolbar .ql-bold') return boldAvailable ? bold : null;
        if (selector === '#toolbar .ql-italic') return italicAvailable ? italic : null;
        return toolbar.children.find((n) => n.dataset.kind);
      },
    },
  });
  return {
    copied, stored, keyMap, boldClicks: () => boldClicks, italicClicks: () => italicClicks, text: () => value, writes: () => writes,
    select(from, to) { selection = [{ anchor: { line: 0, ch: from }, head: { line: 0, ch: to } }]; },
    async open(kind) {
      await toolbar.children.find((n) => n.dataset.kind === kind).fire('click');
      const popover = body.children.find((n) => n.className === 'vp-popover');
      const grids = popover.children.filter((n) => n.className === 'vp-swatches');
      const form = popover.children.find((n) => n.className === 'vp-rgb-form');
      const footer = popover.children.find((n) => n.className === 'vp-popover-footer');
      return { popover, grids, form, rgb: form.children[0], picker: footer.children[0].children[0], clear: footer.children[1], hint: popover.children.at(-1) };
    },
  };
}

test('Mac Cmd-B·Windows Ctrl-B는 기존 굵게 버튼을 한 번씩 실행한다', () => {
  for (const [platform, modifier] of [['MacIntel', 'Cmd'], ['Win32', 'Ctrl']]) {
    const e = editor({ platform });
    assert.equal(typeof e.keyMap[`${modifier}-E`], 'function');
    e.keyMap[`${modifier}-B`]();
    e.keyMap[`${modifier}-B`]();
    assert.equal(e.boldClicks(), 2);
    assert.equal(e.writes(), 0);
    assert.equal(e.keyMap[`${modifier === 'Cmd' ? 'Ctrl' : 'Cmd'}-B`], undefined);
    e.keyMap[`${modifier}-E`]();
    assert.match(e.text(), /color: #eb5757/);
  }
});

test('굵게 버튼이 없을 때 단축키가 오류나 본문 변경을 만들지 않는다', () => {
  const e = editor({ boldAvailable: false });
  assert.doesNotThrow(() => e.keyMap['Cmd-B']());
  assert.equal(e.writes(), 0);
});

test('Mac Cmd-I·Windows Ctrl-I는 기존 기울임 버튼을 한 번씩 실행한다', () => {
  for (const [platform, modifier] of [['MacIntel', 'Cmd'], ['Win32', 'Ctrl']]) {
    const e = editor({ platform });
    e.keyMap[`${modifier}-I`]();
    e.keyMap[`${modifier}-I`]();
    assert.equal(e.italicClicks(), 2);
    assert.equal(e.boldClicks(), 0);
    assert.equal(e.writes(), 0);
    assert.equal(e.keyMap[`${modifier === 'Cmd' ? 'Ctrl' : 'Cmd'}-I`], undefined);
  }
});

test('기울임 버튼이 없을 때 오류나 본문 변경을 만들지 않는다', () => {
  const e = editor({ italicAvailable: false });
  assert.doesNotThrow(() => e.keyMap['Cmd-I']());
  assert.equal(e.writes(), 0);
});

test('Mac Cmd-U·Windows Ctrl-U는 밑줄을 적용하고 같은 선택에서 해제한다', () => {
  for (const [platform, modifier] of [['MacIntel', 'Cmd'], ['Win32', 'Ctrl']]) {
    const e = editor({ platform });
    e.keyMap[`${modifier}-U`]();
    assert.equal(e.text(), '<span style="border-bottom-width: 1px; border-style: none none solid">hello</span>');
    e.keyMap[`${modifier}-U`]();
    assert.equal(e.text(), 'hello');
    assert.equal(e.keyMap[`${modifier === 'Cmd' ? 'Ctrl' : 'Cmd'}-U`], undefined);
  }
});

test('밑줄은 빈 선택을 바꾸지 않는다', () => {
  const e = editor();
  e.select(2, 2);
  e.keyMap['Cmd-U']();
  assert.equal(e.writes(), 0);
});

test('밑줄은 기존 색상과 선택 밖 글자를 보존하며 적용·해제한다', () => {
  const text = '<span style="color: #e03131; background-color: #ffff00">앞중요뒤</span>';
  const e = editor({ text });
  const start = text.indexOf('중요');
  e.select(start, start + 2);
  e.keyMap['Cmd-U']();
  const outsideBefore = '<span style="color: #e03131; background-color: #ffff00">앞</span>';
  const outsideAfter = '<span style="color: #e03131; background-color: #ffff00">뒤</span>';
  assert.equal(e.text(), outsideBefore + '<span style="color: #e03131; background-color: #ffff00; border-bottom-width: 1px; border-style: none none solid">중요</span>' + outsideAfter);
  e.keyMap['Cmd-U']();
  assert.equal(e.text(), outsideBefore + '<span style="color: #e03131; background-color: #ffff00">중요</span>' + outsideAfter);
});

test('기본 배경색도 최근 사용에 보이고 기존 rgba 불투명도를 보존한다', async () => {
  const e = editor();
  const first = await e.open('bg');
  await first.grids[0].children[0].fire('click');
  assert.match(e.text(), /background-color: rgba\(255, 107, 107, 0.3\)/);
  const reopened = await e.open('bg');
  assert.equal(reopened.grids.length, 2);
  assert.equal(reopened.grids[1].children.length, 1);
  assert.match(reopened.grids[1].children[0].title, /\(255, 107, 107\)/);
});

test('글자색·배경색 hover RGB 표시와 우클릭 복사는 본문을 바꾸지 않는다', async () => {
  for (const [kind, tuple] of [['color', '(224, 49, 49)'], ['bg', '(255, 107, 107)']]) {
    const e = editor();
    const p = await e.open(kind);
    const swatch = p.grids[0].children[0];
    assert.ok(swatch.title.includes(tuple));
    await swatch.fire('mouseenter');
    assert.ok(p.hint.textContent.includes(tuple));
    const event = await swatch.fire('contextmenu');
    assert.equal(event.defaultPrevented, true);
    assert.deepEqual(e.copied, [tuple]);
    assert.equal(e.writes(), 0);
    assert.match(p.hint.textContent, /복사됨/);
  }
});

test('복사 거절은 성공으로 표시하지 않고 직접 복사할 RGB 값을 제공한다', async () => {
  const e = editor({ clipboardFails: true });
  const p = await e.open('bg');
  await p.grids[0].children[0].fire('contextmenu');
  assert.match(p.hint.textContent, /복사 실패/);
  assert.equal(p.rgb.value, '(255, 107, 107)');
  assert.equal(e.writes(), 0);
});

test('직접 선택은 RGB 붙여넣기 후 적용할 때만 본문을 바꾼다', async () => {
  for (const input of ['(12, 34, 56)', '12, 34, 56', 'rgb(12, 34, 56)', '#0c2238']) {
    const e = editor();
    const p = await e.open('color');
    p.rgb.value = input;
    await p.rgb.fire('input');
    assert.equal(e.writes(), 0);
    assert.equal(p.picker.value, '#0c2238');
    await p.form.fire('submit');
    assert.equal(e.text(), '<span style="color: #0c2238">hello</span>');
  }
});

test('잘못된 RGB 입력은 거절하고 입력 수정 뒤 정상 적용한다', async () => {
  const e = editor();
  const p = await e.open('bg');
  for (const input of ['', '(256, 0, 0)', '(-1, 0, 0)', '(1.5, 2, 3)', '(1, 2)', 'rgb(1, 2, 3', '(1, 2, 3); color:red', 'rgba(1, 2, 3, 0.3)']) {
    p.rgb.value = input;
    await p.rgb.fire('input');
    await p.form.fire('submit');
    assert.equal(e.writes(), 0);
    assert.equal(p.rgb.attributes['aria-invalid'], 'true');
  }
  p.rgb.value = '(0, 255, 0)';
  await p.rgb.fire('input');
  assert.equal(p.rgb.validationMessage, '');
  await p.form.fire('submit');
  assert.equal(e.text(), '<span style="background-color: #00ff00">hello</span>');
});

test('기존 직접 선택 색상 입력도 적용된다', async () => {
  const e = editor();
  const p = await e.open('bg');
  p.picker.value = '#123456';
  await p.picker.fire('change');
  assert.equal(e.text(), '<span style="background-color: #123456">hello</span>');
});

test('깨지거나 잘못된 최근 저장값은 무시하고 유효한 값만 표시한다', async () => {
  for (const recent of ['{', 'null', '{"bg":{}}', '{"bg":[null,42,"url(x)","rgba(300, 0, 0, 0.3)"]}']) {
    const p = await editor({ recent }).open('bg');
    assert.equal(p.grids.length, 1);
  }
  const p = await editor({ recent: JSON.stringify({ bg: ['#123456', 'rgba(1, 2, 3, 0.3)', 'bad'] }) }).open('bg');
  assert.equal(p.grids[1].children.length, 2);
});

test('최근 저장이 차단돼도 본문 색 적용은 완료한다', async () => {
  const e = editor({ storageFails: true });
  const p = await e.open('color');
  await p.grids[0].children[0].fire('click');
  assert.equal(e.text(), '<span style="color: #e03131">hello</span>');
});

test('배경색 지우기는 선택 밖 스타일을 보존하고 검정색 잔여 span을 벗긴다', async () => {
  const text = '<span style="color: #000000; background-color: #ffff00">앞중요뒤</span>';
  const e = editor({ text });
  const start = text.indexOf('중요');
  e.select(start, start + 2);
  const p = await e.open('bg');
  await p.clear.fire('click');
  assert.equal(e.text(), '<span style="color: #000000; background-color: #ffff00">앞</span>중요<span style="color: #000000; background-color: #ffff00">뒤</span>');
});
