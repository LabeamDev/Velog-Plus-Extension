const test = require('node:test');
const assert = require('node:assert');
const { gridLayout, defaultGrid } = require('../src/grid.js');

const close = (a, b) => assert.ok(Math.abs(a - b) < 0.01, `${a} != ${b}`);

test('기본 격자: 3장까지 한 줄, 4장 2×2, 5장 이상 3열', () => {
  assert.deepStrictEqual(defaultGrid(2), { cols: 2, rows: 1 });
  assert.deepStrictEqual(defaultGrid(3), { cols: 3, rows: 1 });
  assert.deepStrictEqual(defaultGrid(4), { cols: 2, rows: 2 });
  assert.deepStrictEqual(defaultGrid(7), { cols: 3, rows: 3 });
});

test('원본 비율: 꽉 찬 행은 높이가 같고 폭에 딱 맞는다', () => {
  const slots = [{ w: 400, h: 300 }, { w: 300, h: 300 }];
  const { width, height, parts } = gridLayout(slots, { cols: 2, rows: 1, fit: 'original', gap: 10 });
  close(parts[0].dh, parts[1].dh);
  close(parts[1].dx + parts[1].dw, width);
  close(parts[0].dw + 10 + parts[1].dw, width);
  assert.strictEqual(height, Math.round(parts[0].dh));
});

test('원본 비율: 덜 찬 행은 가운데 정렬되고 행 사이에 간격이 들어간다', () => {
  const sq = { w: 100, h: 100 };
  const { width, parts } = gridLayout([sq, sq, sq, null], { cols: 2, rows: 2, fit: 'original', gap: 10 });
  const last = parts[2];
  close(last.dw, parts[0].dw);
  close(last.dx, (width - last.dw) / 2);
  close(last.dy, parts[0].dh + 10);
});

test('채우기: 모든 칸이 같은 크기이고 원본 가운데를 잘라 온다', () => {
  const slots = [{ w: 200, h: 100 }, { w: 100, h: 100 }, null, { w: 100, h: 200 }];
  const { parts } = gridLayout(slots, { cols: 2, rows: 2, fit: 'fill', gap: 0 });
  for (const p of parts) {
    close(p.dw, parts[0].dw);
    close(p.dh, parts[0].dh);
    close(p.sw / p.sh, p.dw / p.dh);
  }
  assert.deepStrictEqual(parts.map((p) => p.index), [0, 1, 3]);
  close(parts[2].dx, parts[0].dw);
  close(parts[2].dy, parts[0].dh);
});

test('맞추기: 원본 전체를 칸 안에 비율 유지로 넣는다', () => {
  const { parts } = gridLayout([{ w: 200, h: 100 }, { w: 100, h: 200 }], { cols: 2, rows: 1, fit: 'fit' });
  for (const p of parts) {
    close(p.dw / p.dh, p.sw / p.sh);
    assert.strictEqual(p.sx, 0);
  }
});

test('결과가 maxSide 를 넘으면 전체를 줄인다', () => {
  const big = { w: 3000, h: 2000 };
  const { width, height } = gridLayout([big, big, big], { cols: 3, rows: 1, fit: 'original', maxSide: 4000 });
  assert.ok(width <= 4000 && height <= 4000);
  assert.strictEqual(width, 4000);
});
