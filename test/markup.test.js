const test = require('node:test');
const assert = require('node:assert');
const { applyStyle, removeProp, innerRange } = require('../src/markup.js');

test('선택 글자를 span 으로 감싼다', () => {
  assert.strictEqual(applyStyle('hello', 'color', '#e03131'), '<span style="color: #e03131">hello</span>');
});

test('이미 감싼 span 에 다른 스타일을 합친다', () => {
  const once = applyStyle('hi', 'color', '#e03131');
  assert.strictEqual(
    applyStyle(once, 'background-color', 'rgba(255, 212, 59, 0.4)'),
    '<span style="color: #e03131; background-color: rgba(255, 212, 59, 0.4)">hi</span>',
  );
});

test('같은 스타일은 덮어쓴다', () => {
  const once = applyStyle('hi', 'color', '#e03131');
  assert.strictEqual(applyStyle(once, 'color', '#1c7ed6'), '<span style="color: #1c7ed6">hi</span>');
});

test('여러 줄은 줄마다 감싸고 마크다운 기호는 밖에 둔다', () => {
  const out = applyStyle('# 제목\n\n- 항목\n> 인용  ', 'color', '#2f9e44');
  assert.strictEqual(
    out,
    '# <span style="color: #2f9e44">제목</span>\n\n- <span style="color: #2f9e44">항목</span>\n> <span style="color: #2f9e44">인용</span>  ',
  );
});

test('코드 펜스 줄은 건드리지 않는다', () => {
  assert.strictEqual(applyStyle('```js', 'color', '#000000'), '```js');
});

test('지우기: 스타일이 비면 span 을 벗긴다', () => {
  const both = '<span style="color: #e03131; background-color: #fff">a</span> b <span style="color: #000">c</span>';
  assert.strictEqual(removeProp(both, 'color'), '<span style="background-color: #fff">a</span> b c');
});

test('지우기: 짝이 선택 밖에 있는 태그는 그대로 둔다', () => {
  assert.strictEqual(removeProp('<span style="color: red">ab', 'color'), '<span style="color: red">ab');
});

test('배경 지우기: 검정색 잔여 스타일과 빈 span도 벗긴다', () => {
  for (const color of ['#000000', '#000', 'black', 'rgb(0, 0, 0)']) {
    assert.strictEqual(applyStyle(`<span style="color: ${color}; background-color: #ffff00">글</span>`, 'background-color', null), '글');
    assert.strictEqual(applyStyle(`<span style="color: ${color}">글</span>`, 'background-color', null), '글');
  }
  assert.strictEqual(applyStyle('<span>글</span>', 'background-color', null), '글');
  assert.strictEqual(removeProp('<span>글</span>', 'color'), '글');
});

test('배경 지우기: 다른 글자색과 나머지 스타일은 보존한다', () => {
  assert.strictEqual(applyStyle('<span style="color: #e03131; background-color: #ffff00">글</span>', 'background-color', null), '<span style="color: #e03131">글</span>');
  assert.strictEqual(applyStyle('<span style="color: #000000; background-color: #ffff00; font-weight: bold">글</span>', 'background-color', null), '<span style="font-weight: bold">글</span>');
  assert.strictEqual(applyStyle('<span style="color: #000000">글</span>', 'background-color', '#ffff00'), '<span style="color: #000000; background-color: #ffff00">글</span>');
});

test('지우기: 중첩된 빈 span도 올바른 짝을 유지하며 정리한다', () => {
  assert.strictEqual(applyStyle('<span style="background-color: #ffff00">앞<span>안</span>뒤</span>', 'background-color', null), '앞안뒤');
  assert.strictEqual(removeProp('<span>앞<span style="color: red">안</span>뒤</span>', 'color'), '앞안뒤');
  assert.strictEqual(removeProp('<span>짝 없음', 'color'), '<span>짝 없음');
});

test('내부에 같은 스타일 span 이 있으면 정리 후 감싼다', () => {
  assert.strictEqual(
    applyStyle('a <span style="color: red">b</span> c', 'color', '#1c7ed6'),
    '<span style="color: #1c7ed6">a b c</span>',
  );
});

test('빈 선택은 빈 span 을 넣고 커서 위치를 준다', () => {
  const out = applyStyle('', 'color', '#e03131');
  assert.strictEqual(out, '<span style="color: #e03131"></span>');
  const [s, e] = innerRange(out);
  assert.strictEqual(s, e);
  assert.strictEqual(out.slice(0, s), '<span style="color: #e03131">');
});

test('innerRange 는 접두 기호를 고려한다', () => {
  const out = '- <span style="color: #e03131">항목</span>';
  const [s, e] = innerRange(out);
  assert.strictEqual(out.slice(s, e), '항목');
});

test('innerRange 는 span 이 여러 개면 null', () => {
  assert.strictEqual(innerRange('<span style="color: red">a</span> b <span style="color: red">c</span>'), null);
});

const { findImages, findImageBySrc, buildImage } = require('../src/markup.js');

test('마크다운·HTML 이미지를 찾고 코드 블록 안은 건너뛴다', () => {
  const text = '![a](https://x/1.png)\n```\n![b](https://x/2.png)\n```\n<img src="https://x/3.png" alt="c" width="50%">';
  const images = findImages(text);
  assert.deepStrictEqual(
    images.map(({ src, alt, width, html, block }) => ({ src, alt, width, html, block })),
    [
      { src: 'https://x/1.png', alt: 'a', width: null, html: false, block: true },
      { src: 'https://x/3.png', alt: 'c', width: '50%', html: true, block: true },
    ],
  );
  assert.strictEqual(text.slice(images[1].start, images[1].end), '<img src="https://x/3.png" alt="c" width="50%">');
});

test('같은 주소 이미지는 순번으로 구분하고 인코딩 차이는 무시한다', () => {
  const text = '![](https://x/%EA%B0%80.png) ![](https://x/가.png)';
  assert.strictEqual(findImageBySrc(text, 'https://x/가.png', 1).start, text.lastIndexOf('!['));
});

test('폭이 있으면 img 태그, 없으면 마크다운', () => {
  assert.strictEqual(buildImage({ src: 'u', alt: '', width: '50%' }), '<img src="u" width="50%">');
  assert.strictEqual(buildImage({ src: 'u', alt: 'a"b', width: '30%' }), '<img src="u" alt="a&quot;b" width="30%">');
  assert.strictEqual(buildImage({ src: 'u', alt: 'a', width: null }), '![a](u)');
});

test('블록 이미지는 <p> 로 감싸 가운데 정렬, 글자 사이 이미지는 그대로', () => {
  assert.strictEqual(buildImage({ src: 'u', width: '50%', block: true }), '<p><img src="u" width="50%"></p>');
  assert.strictEqual(buildImage({ src: 'u', width: null, block: true }), '![](u)');
  const text = '<p><img src="u" width="30%"></p>\n글 ![](v) 끝';
  const [a, b] = findImages(text);
  assert.deepStrictEqual([a.block, a.width, a.end], [true, '30%', text.indexOf('\n')]);
  assert.strictEqual(b.block, false);
  assert.strictEqual(buildImage({ ...b, width: '20%' }), '<img src="v" width="20%">');
});

const { mergeImagesInText } = require('../src/markup.js');

test('합치기: 첫 이미지 자리에 새 이미지, 나머지 줄은 지우고 빈 줄 정리', () => {
  const text = '앞\n\n![a](A)\n\n<p><img src="B" width="50%"></p>\n\n중간\n\n![c](C)\n\n끝';
  const out = mergeImagesInText(text, [{ src: 'C', nth: 0 }, { src: 'A', nth: 0 }, { src: 'B', nth: 0 }], 'M');
  assert.strictEqual(out, '앞\n\n![](M)\n\n중간\n\n끝');
});

test('합치기: 첫 이미지의 폭을 이어받는다', () => {
  const text = '<p><img src="A" width="80%"></p>\n![](B)';
  assert.strictEqual(mergeImagesInText(text, [{ src: 'A', nth: 0 }, { src: 'B', nth: 0 }], 'M'), '<p><img src="M" width="80%"></p>\n');
});

test('합치기: 원문에서 못 찾으면 null', () => {
  assert.strictEqual(mergeImagesInText('![](A)', [{ src: 'A', nth: 0 }, { src: 'X', nth: 0 }], 'M'), null);
});

const { toggleStyles } = require('../src/markup.js');
const HL = { color: '#eb5757', 'background-color': 'rgba(135, 131, 120, 0.15)' };

test('강조 토글: 글자색+배경색을 한 번에 넣고, 다시 누르면 뺀다', () => {
  const on = toggleStyles('중요', HL);
  assert.strictEqual(on, '<span style="color: #eb5757; background-color: rgba(135, 131, 120, 0.15)">중요</span>');
  assert.strictEqual(toggleStyles(on, HL), '중요');
});

test('강조 토글: 다른 스타일은 남기고 강조 스타일만 뺀다', () => {
  const text = '<span style="color: #eb5757; background-color: rgba(135,131,120,0.15); text-align: center">a</span>';
  assert.strictEqual(toggleStyles(text, HL), '<span style="text-align: center">a</span>');
});

test('강조 토글: 일부만 같으면 강조를 덮어써 적용한다', () => {
  const text = '<span style="color: #1c7ed6">a</span>';
  assert.strictEqual(toggleStyles(text, HL), '<span style="color: #eb5757; background-color: rgba(135, 131, 120, 0.15)">a</span>');
});

test('강조 토글: 글자색 하나만 지정해도 동작한다', () => {
  const on = toggleStyles('a', { color: '#e03131' });
  assert.strictEqual(on, '<span style="color: #e03131">a</span>');
  assert.strictEqual(toggleStyles(on, { color: '#e03131' }), 'a');
});

test('강조 토글: 배경색만 바꾸고 기존 글자색은 보존한다', () => {
  const before = '<span style="color: #1c7ed6">중요</span>';
  const bg = { 'background-color': HL['background-color'] };
  const on = toggleStyles(before, bg);
  assert.match(on, /color: #1c7ed6; background-color:/);
  assert.strictEqual(toggleStyles(on, bg), before);
});

test('강조 토글: 여러 줄과 마크다운 기호·빈 줄·여백을 유지하며 해제한다', () => {
  const before = '# 제목\n\n- 첫 항목  \n> 인용\n  - [x] 체크\n';
  const on = toggleStyles(before, HL);
  assert.match(on, /^# <span/);
  assert.strictEqual(toggleStyles(on, HL), before);
});

test('강조 토글: 강조된 줄과 일반 줄이 섞이면 모두 적용한다', () => {
  const before = toggleStyles('첫 줄', HL) + '\n둘째 줄';
  const on = toggleStyles(before, HL);
  assert.strictEqual(toggleStyles(on, HL), '첫 줄\n둘째 줄');
});

test('강조 토글: 빈 선택·여백·빈 스타일은 그대로 둔다', () => {
  for (const text of ['', '  \n\t', '# 제목']) {
    assert.strictEqual(toggleStyles(text, {}), text);
  }
  assert.strictEqual(toggleStyles('', HL), '');
  assert.strictEqual(toggleStyles('  \n\t', HL), '  \n\t');
});

test('강조 토글: 안쪽의 다른 span 스타일을 보존하며 반복 해제한다', () => {
  const before = '앞 <span style="font-weight: bold">중요</span> 뒤';
  const on = toggleStyles(before, HL);
  assert.strictEqual(toggleStyles(on, HL), before);
});

test('강조 토글: 안쪽 글자의 색이 다르면 해제 대신 현재 강조를 적용한다', () => {
  const before = '<span style="color: #eb5757">앞 <span style="color: #000000">중요</span></span>';
  const on = toggleStyles(before, { color: HL.color });
  assert.strictEqual(on, '<span style="color: #eb5757">앞 중요</span>');
});
