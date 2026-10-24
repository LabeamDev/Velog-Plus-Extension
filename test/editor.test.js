const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const markup = require('../src/markup.js');

function editor({ recent = null, clipboardFails = false, storageFails = false, text = 'hello', platform = 'MacIntel', boldAvailable = true, italicAvailable = true, deferStyles = false } = {}) {
  function element(tag) {
    return {
      tagName: tag.toUpperCase(), children: [], dataset: {}, className: '', value: '', attributes: {}, listeners: {},
      style: { setProperty() {} },
      append(...nodes) { for (const n of nodes) { this.children.push(n); n.parentElement = this; } },
      after(...nodes) { this.parentElement.append(...nodes); },
      remove() { this.parentElement.children = this.parentElement.children.filter((n) => n !== this); },
      setAttribute(k, v) { this.attributes[k] = v; },
      matches(selector) { return selector.split(', ').some((part) => part === 'input' ? tag === 'input' : part === '.' + this.className); },
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
  let writes = 0;
  // 여러 줄 위치를 글 전체 오프셋과 바꾸는 모의 CodeMirror 문서.
  const indexFromPos = (p) => value.split('\n').slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.ch;
  const posFromIndex = (index) => {
    const before = value.slice(0, index).split('\n');
    return { line: before.length - 1, ch: before.at(-1).length };
  };
  let selection = [{ anchor: posFromIndex(0), head: posFromIndex(text.length) }];
  const doc = {
    getValue: () => value,
    listSelections: () => selection,
    getLine: (n) => value.split('\n')[n],
    getRange: (from, to) => value.slice(indexFromPos(from), indexFromPos(to)),
    replaceRange(next, from, to) { value = value.slice(0, indexFromPos(from)) + next + value.slice(indexFromPos(to)); writes++; },
    indexFromPos,
    posFromIndex,
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
  const messageListeners = [];
  const requests = [];
  const timers = new Map();
  const toasts = [];
  let timerId = 0;
  let savedHighlight = { styles: { color: '#eb5757', 'background-color': 'rgba(135, 131, 120, 0.15)' }, formats: { bold: false, italic: false } };
  const deliver = (data, source = window) => {
    for (const fn of messageListeners) fn({ source, data: { source: 'velog-plus', type: 'highlight-style', ...data } });
  };
  const window = {
    __velogPlusMarkup: markup, innerWidth: 1200,
    __velogPlusApi: { toast(text) { toasts.push(text); } },
    addEventListener(type, fn) { if (type === 'message') messageListeners.push(fn); },
    postMessage(data) {
      if (data.type !== 'get-highlight-style') return;
      if (data.requestId !== undefined) requests.push(data.requestId);
      if (!deferStyles || data.requestId === undefined) deliver({ ...savedHighlight, requestId: data.requestId });
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/editor.js'), 'utf8'), {
    window, location: { origin: 'https://velog.io' },
    navigator: { platform, clipboard: { async writeText(next) { if (clipboardFails) throw Error('denied'); copied.push(next); } } },
    localStorage: {
      getItem() { return stored.value; },
      setItem(key, next) { if (storageFails) throw Error('blocked'); stored.value = next; },
    },
    CSS: { supports: () => true },
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); },
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
    copied, stored, keyMap, requests, toasts, boldClicks: () => boldClicks, italicClicks: () => italicClicks, text: () => value, writes: () => writes,
    highlight(styles, source = window, formats) {
      const data = { styles };
      if (formats !== undefined) data.formats = formats;
      savedHighlight = data;
      deliver(data, source);
    },
    message(styles, source = window, formats) { deliver({ styles, formats }, source); },
    saveHighlight(styles, formats) { savedHighlight = { styles, formats }; },
    respond(id = requests.at(-1)) { deliver({ ...savedHighlight, requestId: id }); },
    expire() { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } },
    edit(next) { value = next; },
    select(from, to) { selection = [{ anchor: posFromIndex(from), head: posFromIndex(to) }]; },
    selectMany(pairs) { selection = pairs.map(([from, to]) => ({ anchor: posFromIndex(from), head: posFromIndex(to) })); },
    selected: () => Array.from(selection, (r) => value.slice(indexFromPos(r.anchor), indexFromPos(r.head))),
    async open(kind) {
      await toolbar.children.find((n) => n.dataset.kind === kind).fire('click');
      const popover = body.children.find((n) => n.className === 'vp-popover');
      const grids = popover.children.filter((n) => n.className === 'vp-swatches');
      const footer = popover.children.find((n) => n.className === 'vp-popover-footer');
      return { popover, grids, picker: footer.children[0].children[0], clear: footer.children[1], hint: popover.children.at(-1) };
    },
  };
}

test('전달된 강조 설정을 사용하고 변경된 색·불투명도도 반영한다', () => {
  const e = editor();
  e.highlight({ color: '#000000', 'background-color': 'rgba(255, 217, 59, 0.3)' });
  e.keyMap['Cmd-E']();
  assert.equal(e.text(), '<span style="color: #000000; background-color: rgba(255, 217, 59, 0.3)">hello</span>');
  e.highlight({ color: '#123456', 'background-color': 'rgba(0, 255, 0, 0.65)' });
  e.keyMap['Cmd-E']();
  assert.equal(e.text(), '<span style="color: #123456; background-color: rgba(0, 255, 0, 0.65)">hello</span>');
  e.keyMap['Cmd-E']();
  assert.equal(e.text(), 'hello');
});

test('다른 창이나 허용되지 않은 스타일 메시지는 강조 설정을 바꾸지 않는다', () => {
  const e = editor();
  e.highlight({ color: '#000000' });
  e.message({ color: '#123456' }, {});
  for (const styles of [{ position: 'fixed' }, { color: 'red; display: none' }, { color: 42 }, null]) e.message(styles);
  e.keyMap['Cmd-E']();
  assert.equal(e.text(), '<span style="color: #000000">hello</span>');
});

const UL = { 'border-bottom-width': '1px', 'border-style': 'none none solid' };
const BI = { bold: true, italic: true };

test('기울임 해제 알림이 오지 않아도 단축키는 최신 저장값으로 새 글자에 적용한다', () => {
  const e = editor();
  e.highlight({ color: '#000000' }, undefined, BI);
  e.saveHighlight({ color: '#000000' }, { bold: true, italic: false });
  e.keyMap['Cmd-E']();
  assert.equal(e.text(), '<span style="color: #000000"><strong>hello</strong></span>');
  assert.equal(e.requests.length, 1);
});

test('설정 응답 전에 문서·선택이 바뀌면 다른 글자에 강조하지 않는다', () => {
  for (const change of [(e) => e.select(1, 4), (e) => e.edit('changed')]) {
    const e = editor({ deferStyles: true });
    e.keyMap['Cmd-E']();
    assert.equal(e.writes(), 0);
    change(e);
    e.respond();
    assert.equal(e.writes(), 0);
  }
});

test('지난 요청 응답과 변경 알림으로 실행하지 않고 현재 요청 응답에만 적용한다', () => {
  const e = editor({ deferStyles: true });
  e.keyMap['Cmd-E']();
  const first = e.requests.at(-1);
  e.keyMap['Cmd-E']();
  e.highlight({ color: '#000000' }, undefined, { bold: true, italic: false });
  e.respond(first);
  assert.equal(e.writes(), 0);
  e.respond();
  assert.equal(e.text(), '<span style="color: #000000"><strong>hello</strong></span>');
});

test('설정 연결이 끊기면 이전 값으로 강조하지 않고 새로고침을 안내한다', () => {
  const e = editor({ deferStyles: true });
  e.keyMap['Cmd-E']();
  e.expire();
  e.respond();
  assert.equal(e.writes(), 0);
  assert.match(e.toasts[0], /확장과 velog 탭을 새로고침/);
});

test('강조 메시지의 formats·밑줄을 받고 주입된 값이나 잘못된 형식은 무시한다', () => {
  const e = editor();
  e.highlight({ color: '#000000', ...UL }, undefined, BI);
  for (const [styles, formats] of [
    [{ color: '#123456' }, { bold: 'true', italic: false }],
    [{ color: '#123456' }, { bold: true }],
    [{ color: '#123456' }, { bold: true, italic: false, weight: true }],
    [{ color: '#123456' }, null],
    [{ color: '#123456' }, [true, true]],
    [{ 'border-bottom-width': '1px' }, BI],
    [{ ...UL, 'border-style': 'none none solid; color: red' }, BI],
    [{ ...UL, 'border-bottom-width': '9px' }, BI],
    [{ 'font-weight': 'bold' }, BI],
    [{ toString: '#123456' }, BI],
  ]) e.message(styles, undefined, formats);
  e.keyMap['Cmd-E']();
  assert.equal(e.text(), '<span style="color: #000000; border-bottom-width: 1px; border-style: none none solid"><strong><em>hello</em></strong></span>');
  assert.deepEqual(e.selected(), ['hello']);
  e.keyMap['Cmd-E']();
  assert.equal(e.text(), 'hello');
});

test('색을 모두 끄고 굵게만 켜도 강조 단축키가 동작하고 빈 선택은 바꾸지 않는다', () => {
  const e = editor({ text: '앞 **굵게** 뒤' });
  e.highlight({}, undefined, { bold: true, italic: false });
  e.keyMap['Cmd-E']();
  assert.equal(e.text(), '<strong>앞 굵게 뒤</strong>');
  e.select(3, 3);
  e.keyMap['Cmd-E']();
  assert.equal(e.writes(), 1);
});

test('강조 부분 선택은 생성된 span·strong·em 바깥 글자의 서식을 보존하고 반복 시 다시 적용한다', () => {
  const span = '<span style="color: #eb5757; border-bottom-width: 1px; border-style: none none solid">';
  const text = `${span}<strong><em>앞중요뒤</em></strong></span>`;
  const e = editor({ text });
  e.highlight({ color: '#eb5757', ...UL }, undefined, BI);
  const start = text.indexOf('중요');
  e.select(start, start + 2);
  e.keyMap['Cmd-E']();
  const wrapped = (s) => `${span}<strong><em>${s}</em></strong></span>`;
  assert.equal(e.text(), wrapped('앞') + '중요' + wrapped('뒤'));
  assert.deepEqual(e.selected(), ['중요']);
  e.keyMap['Cmd-E']();
  assert.equal(e.text(), wrapped('앞') + wrapped('중요') + wrapped('뒤'));
  assert.deepEqual(e.selected(), ['중요']);
});

test('강조 부분 선택은 기존 마크다운 굵게를 나눠 바깥 글자의 굵게를 유지한다', () => {
  for (const [text, out] of [['**앞중요뒤**', '**앞**중요**뒤**'], ['__앞중요뒤__', '**앞**중요**뒤**'], ['**앞 중요 뒤**', '**앞** 중요 **뒤**']]) {
    const e = editor({ text });
    e.highlight({}, undefined, { bold: true, italic: false });
    const start = text.indexOf('중요');
    e.select(start, start + 2);
    e.keyMap['Cmd-E']();
    assert.equal(e.text(), out);
  }
  // 굵게를 끈 기울임 강조는 선택 부분의 굵게를 지우고 선택 밖은 보존한다.
  const e = editor({ text: '**앞중요뒤**' });
  e.highlight({}, undefined, { bold: false, italic: true });
  e.select(3, 5);
  e.keyMap['Cmd-E']();
  assert.equal(e.text(), '**앞**<em>중요</em>**뒤**');
});

test('강조 옵션에서 끈 기울임·밑줄은 선택 안에서 지우고 선택 밖은 보존한다', () => {
  const beforeSpan = '<span style="color: #000000; border-bottom-width: 1px; border-style: none none solid">';
  const wrap = (s) => `${beforeSpan}<strong><em>${s}</em></strong></span>`;
  const text = wrap('앞중요뒤');
  const e = editor({ text });
  e.highlight({ color: '#000000' }, undefined, { bold: true, italic: false });
  const start = text.indexOf('중요');
  e.select(start, start + 2);
  e.keyMap['Cmd-E']();
  assert.equal(e.text(), wrap('앞') + '<span style="color: #000000"><strong>중요</strong></span>' + wrap('뒤'));
  assert.deepEqual(e.selected(), ['중요']);
  e.keyMap['Cmd-E']();
  assert.equal(e.text(), wrap('앞') + '중요' + wrap('뒤'));
});

test('강조 선택이 서식 경계에 걸쳐도 태그 짝이 맞는다', () => {
  const text = '<strong>앞굵</strong>보통';
  const e = editor({ text });
  e.highlight({}, undefined, { bold: true, italic: false });
  e.select(text.indexOf('굵'), text.indexOf('통'));
  e.keyMap['Cmd-E']();
  assert.equal(e.text(), '<strong>앞</strong><strong>굵보</strong>통');
});

test('여러 줄 강조는 첫 줄 span 안 부분 선택의 바깥 글자를 보존한다', () => {
  const span = '<span style="color: #1c7ed6">';
  const text = `${span}앞중요</span>\n**둘째** 줄`;
  const e = editor({ text });
  e.highlight({ color: '#eb5757' }, undefined, { bold: true, italic: false });
  e.select(text.indexOf('중요'), text.length);
  e.keyMap['Cmd-E']();
  assert.equal(e.text(), `${span}앞</span><span style="color: #eb5757"><strong>중요</strong></span>\n<span style="color: #eb5757"><strong>둘째 줄</strong></span>`);
  e.keyMap['Cmd-E']();
  assert.equal(e.text(), `${span}앞</span>중요\n둘째 줄`);
});

test('여러 선택은 함께 판정해 하나라도 빠지면 모두 적용하고 모두 있으면 모두 해제한다', () => {
  const text = '<strong>가</strong> 나';
  const e = editor({ text });
  e.highlight({}, undefined, { bold: true, italic: false });
  e.selectMany([[text.indexOf('가'), text.indexOf('가') + 1], [text.length - 1, text.length]]);
  e.keyMap['Cmd-E']();
  assert.equal(e.text(), '<strong>가</strong> <strong>나</strong>');
  e.selectMany([[8, 9], [text.length + 8 - 1, text.length + 8]]);
  assert.deepEqual(e.selected(), ['가', '나']);
  e.keyMap['Cmd-E']();
  assert.equal(e.text(), '가 나');
});

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
  assert.match(p.hint.textContent, /\(255, 107, 107\)/);
  const event = await p.popover.fire('mousedown', { target: p.hint });
  assert.notEqual(event.defaultPrevented, true);
  assert.equal(e.writes(), 0);
});

test('팔레트는 별도 RGB 입력칸·적용 버튼 없이 직접 선택을 제공한다', async () => {
  const p = await editor().open('color');
  assert.equal(p.popover.children.some((n) => n.tagName === 'FORM'), false);
  assert.equal(p.picker.type, 'color');
  const event = await p.popover.fire('mousedown', { target: p.picker });
  assert.notEqual(event.defaultPrevented, true);
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

test('빈 커서에서 팔레트 색은 기존 span 을 나눠 빈 span 안에 커서를 둔다', async () => {
  const text = '<span style="background-color: #ffff00">앞뒤</span>';
  const e = editor({ text });
  const at = text.indexOf('뒤');
  e.select(at, at);
  const p = await e.open('color');
  await p.grids[0].children[0].fire('click');
  assert.equal(e.text(), '<span style="background-color: #ffff00">앞</span><span style="background-color: #ffff00; color: #e03131"></span><span style="background-color: #ffff00">뒤</span>');
  assert.deepEqual(e.selected(), ['']);
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
