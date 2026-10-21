const test = require('node:test');
const assert = require('node:assert');
const { parseMarkdownDoc, localImageSources, resolveFile, replaceImageSources } = require('../src/md-import.js');

test('머리말의 제목과 태그(배열·쉼표·목록)를 읽는다', () => {
  assert.deepStrictEqual(parseMarkdownDoc('---\ntitle: "안녕"\ntags: [a, "b c"]\n---\n\n본문'), {
    title: '안녕',
    tags: ['a', 'b c'],
    body: '본문',
  });
  assert.deepStrictEqual(parseMarkdownDoc('---\ntitle: t\ntags: x, y\n---\nb').tags, ['x', 'y']);
  assert.deepStrictEqual(parseMarkdownDoc('---\ntags:\n  - x\n  - y\n---\n# 제목\nb'), {
    title: '제목',
    tags: ['x', 'y'],
    body: 'b',
  });
});

test('머리말이 없으면 첫 줄 # 제목, 그것도 없으면 파일 이름', () => {
  assert.deepStrictEqual(parseMarkdownDoc('# 첫 제목\n\n## 소제목\n내용'), {
    title: '첫 제목',
    tags: [],
    body: '## 소제목\n내용',
  });
  assert.strictEqual(parseMarkdownDoc('## 소제목만', 'notes/my-post.md').title, 'my-post');
  assert.strictEqual(parseMarkdownDoc('## 소제목만', 'notes/my-post.md').body, '## 소제목만');
});

test('로컬 이미지만 고르고 중복을 없앤다', () => {
  const text = '![](images/a.png)\n![](https://x/b.png)\n<img src="./images/c%20d.jpg" width="50%">\n![](images/a.png)';
  assert.deepStrictEqual(localImageSources(text), ['images/a.png', './images/c%20d.jpg']);
});

test('경로 짝짓기: 상대 경로, 인코딩, 파일 이름 순', () => {
  const files = [{ path: 'post/images/a.png' }, { path: 'post/images/c d.jpg' }, { path: 'other/z.gif' }];
  assert.strictEqual(resolveFile('images/a.png', files, 'post').path, 'post/images/a.png');
  assert.strictEqual(resolveFile('./images/c%20d.jpg', files, 'post').path, 'post/images/c d.jpg');
  assert.strictEqual(resolveFile('../assets/z.gif', files, 'post').path, 'other/z.gif');
  assert.strictEqual(resolveFile('nope.png', files, 'post'), null);
});

test('주소만 바꾸고 alt·width 는 유지한다', () => {
  const text = '![고양이](images/a.png)\n<img src="images/a.png" alt="x" width="50%">\n![](https://keep/b.png)';
  const out = replaceImageSources(text, new Map([['images/a.png', 'https://velog/a.png']]));
  assert.strictEqual(
    out,
    '![고양이](https://velog/a.png)\n<img src="https://velog/a.png" alt="x" width="50%">\n![](https://keep/b.png)',
  );
});
