// 이미지 합치기의 격자 배치 계산. 화면·캔버스와 무관한 순수 함수라 node 로 테스트한다.
(function (root) {
  function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  // slots: 행 우선 순서의 칸 목록. 이미지 칸은 { w, h }, 빈 칸은 null.
  // fit: 'original' 원본 비율(잘림 없음, 행마다 높이 맞춤) | 'fill' 같은 칸에 꽉 채움(가장자리 잘림) | 'fit' 같은 칸 안에 맞춤(여백)
  // 반환 parts 의 s* 는 원본에서 잘라 올 영역, d* 는 결과 캔버스에 그릴 영역이다.
  function gridLayout(slots, { cols, rows, fit = 'original', gap = 0, maxSide = 4000 }) {
    const images = slots.filter(Boolean);
    if (!images.length) return { width: 0, height: 0, parts: [] };
    const baseWidth = median(images.map((im) => im.w));
    const parts = [];
    let width;
    let height;

    if (fit === 'original') {
      width = cols * baseWidth + gap * (cols - 1);
      const meanAspect = images.reduce((sum, im) => sum + im.w / im.h, 0) / images.length;
      let y = 0;
      let usedRows = 0;
      for (let r = 0; r < rows; r++) {
        const row = [];
        for (let c = 0; c < cols; c++) {
          const index = r * cols + c;
          if (slots[index]) row.push({ index, im: slots[index] });
        }
        if (!row.length) continue;
        const sumAspect = row.reduce((sum, { im }) => sum + im.w / im.h, 0);
        // 꽉 찬 행은 폭에 딱 맞추고, 덜 찬 행은 비슷한 이미지로 찼을 때의 높이를 써서 지나치게 커지지 않게 한다.
        const rowHeight =
          row.length === cols
            ? (width - gap * (cols - 1)) / sumAspect
            : (width - gap * (cols - 1)) / (cols * Math.max(meanAspect, sumAspect / row.length));
        const rowWidth = sumAspect * rowHeight + gap * (row.length - 1);
        let x = (width - rowWidth) / 2;
        if (usedRows) y += gap;
        for (const { index, im } of row) {
          const dw = (im.w / im.h) * rowHeight;
          parts.push({ index, sx: 0, sy: 0, sw: im.w, sh: im.h, dx: x, dy: y, dw, dh: rowHeight });
          x += dw + gap;
        }
        y += rowHeight;
        usedRows++;
      }
      height = y;
    } else {
      const meanAspect = images.reduce((sum, im) => sum + im.w / im.h, 0) / images.length;
      const cellW = baseWidth;
      const cellH = cellW / meanAspect;
      width = cols * cellW + gap * (cols - 1);
      height = rows * cellH + gap * (rows - 1);
      slots.forEach((im, index) => {
        if (!im) return;
        const x = (index % cols) * (cellW + gap);
        const y = Math.floor(index / cols) * (cellH + gap);
        if (fit === 'fill') {
          const cellAspect = cellW / cellH;
          const sw = Math.min(im.w, im.h * cellAspect);
          const sh = Math.min(im.h, im.w / cellAspect);
          parts.push({ index, sx: (im.w - sw) / 2, sy: (im.h - sh) / 2, sw, sh, dx: x, dy: y, dw: cellW, dh: cellH });
        } else {
          const k = Math.min(cellW / im.w, cellH / im.h);
          const dw = im.w * k;
          const dh = im.h * k;
          parts.push({ index, sx: 0, sy: 0, sw: im.w, sh: im.h, dx: x + (cellW - dw) / 2, dy: y + (cellH - dh) / 2, dw, dh });
        }
      });
    }

    // 결과가 너무 크면 전체를 같은 비율로 줄인다.
    const scale = Math.min(1, maxSide / width, maxSide / height);
    for (const p of parts) {
      p.dx *= scale;
      p.dy *= scale;
      p.dw *= scale;
      p.dh *= scale;
    }
    return { width: Math.round(width * scale), height: Math.round(height * scale), parts };
  }

  // 이미지 수에 맞는 기본 격자. 3장까지 한 줄, 4장은 2×2, 그 이상은 3열.
  function defaultGrid(count) {
    const cols = count <= 3 ? count : count === 4 ? 2 : 3;
    return { cols, rows: Math.ceil(count / cols) };
  }

  const api = { gridLayout, defaultGrid };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.__velogPlusGrid = api;
})(typeof window !== 'undefined' ? window : globalThis);
