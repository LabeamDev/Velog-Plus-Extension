// 마크다운 텍스트에 <span style="..."> 를 씌우거나 벗기는 순수 함수 모음.
// velog 새니타이저는 span 의 color, background-color 스타일을 허용한다.
(function (root) {
  const SINGLE_SPAN = /^<span style="([^"]*)">((?:(?!<\/?span\b)[\s\S])*)<\/span>$/;
  const SPAN_TOKEN = /<span style="([^"]*)">|<\/span>/g;
  // 줄 앞의 마크다운 기호(제목, 인용, 목록, 체크박스)는 span 밖에 둔다.
  const LINE_PREFIX = /^\s*(?:(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+))*/;
  const FENCE = /^\s*(```|~~~)/;

  function parseStyle(style) {
    const map = new Map();
    for (const decl of style.split(';')) {
      const i = decl.indexOf(':');
      if (i < 0) continue;
      const prop = decl.slice(0, i).trim().toLowerCase();
      const value = decl.slice(i + 1).trim();
      if (prop && value) map.set(prop, value);
    }
    return map;
  }

  function serializeStyle(map) {
    return [...map].map(([p, v]) => `${p}: ${v}`).join('; ');
  }

  function wrap(inner, map) {
    return map.size ? `<span style="${serializeStyle(map)}">${inner}</span>` : inner;
  }

  // 텍스트 안의 모든 짝 맞는 span 에서 prop 을 지운다. 스타일이 비면 span 자체를 벗긴다.
  function removeProp(text, prop) {
    const tokens = [];
    const stack = [];
    for (const m of text.matchAll(SPAN_TOKEN)) {
      const token = { index: m.index, raw: m[0], style: m[1], open: m[1] !== undefined, pair: -1 };
      tokens.push(token);
      if (token.open) stack.push(tokens.length - 1);
      else if (stack.length) {
        const o = stack.pop();
        tokens[o].pair = tokens.length - 1;
        token.pair = o;
      }
    }
    let out = '';
    let last = 0;
    for (const t of tokens) {
      out += text.slice(last, t.index);
      last = t.index + t.raw.length;
      if (t.pair < 0) {
        out += t.raw;
      } else if (t.open) {
        const map = parseStyle(t.style);
        map.delete(prop);
        t.empty = map.size === 0;
        out += t.empty ? '' : `<span style="${serializeStyle(map)}">`;
      } else {
        out += tokens[t.pair].empty ? '' : t.raw;
      }
    }
    return out + text.slice(last);
  }

  function styleSegment(text, prop, value) {
    const m = text.match(SINGLE_SPAN);
    if (m) {
      const map = parseStyle(m[1]);
      map.delete(prop);
      map.set(prop, value);
      return wrap(m[2], map);
    }
    return wrap(removeProp(text, prop), new Map([[prop, value]]));
  }

  // value 가 null 이면 해당 스타일 제거, 아니면 줄마다 span 으로 감싼다.
  function applyStyle(text, prop, value) {
    if (value == null) return removeProp(text, prop);
    if (text === '') return wrap('', new Map([[prop, value]]));
    return text
      .split('\n')
      .map((line) => {
        if (FENCE.test(line)) return line;
        const prefix = line.match(LINE_PREFIX)[0];
        const body = line.slice(prefix.length);
        if (!body.trim()) return line;
        const trailing = body.match(/\s*$/)[0];
        const core = body.slice(0, body.length - trailing.length);
        return prefix + styleSegment(core, prop, value) + trailing;
      })
      .join('\n');
  }

  const normalize = (value) => String(value).replace(/\s+/g, '').toLowerCase();

  function hasStyles(text, entries) {
    const stack = [new Map()];
    const matches = (part) => !part.trim() || entries.every(([prop, value]) => normalize(stack.at(-1).get(prop) || '') === normalize(value));
    let end = 0;
    for (const token of text.matchAll(SPAN_TOKEN)) {
      if (!matches(text.slice(end, token.index))) return false;
      if (token[1] !== undefined) stack.push(new Map([...stack.at(-1), ...parseStyle(token[1])]));
      else if (stack.length > 1) stack.pop();
      else return false;
      end = token.index + token[0].length;
    }
    return stack.length === 1 && matches(text.slice(end));
  }

  // 여러 스타일을 한 번에 켜고 끈다. (강조 단축키용)
  // 내용이 있는 모든 줄이 지정 스타일이면 해제한다. 마크다운 접두 기호와 여백은 판정에서 뺀다.
  function toggleStyles(text, styles) {
    const entries = Object.entries(styles);
    if (!entries.length || !text.trim()) return text;
    const lines = text.split('\n').filter((line) => !FENCE.test(line) && line.slice(line.match(LINE_PREFIX)[0].length).trim());
    const active = lines.length && lines.every((line) => hasStyles(line.slice(line.match(LINE_PREFIX)[0].length), entries));
    if (active) return entries.reduce((out, [prop]) => removeProp(out, prop), text);
    return entries.reduce((out, [prop, value]) => applyStyle(out, prop, value), text);
  }

  // 결과 문자열에서 span 안쪽 글자의 [시작, 끝] 오프셋. 한 줄짜리 결과에만 쓴다.
  function innerRange(out) {
    const m = out.match(/^([^<]*)(<span style="[^"]*">)((?:(?!<\/?span\b)[\s\S])*)<\/span>(\s*)$/);
    if (!m) return null;
    const start = m[1].length + m[2].length;
    return [start, start + m[3].length];
  }

  // ---------- 이미지 ----------
  // ![alt](src) 또는 <img src="..." ...> 를 찾는다. 코드 블록 안은 건너뛴다.
  // <p><img></p> 는 하나로 본다. velog 는 문단(p) 안의 이미지만 가운데 정렬한다.
  const IMAGE_TOKEN = /!\[([^\]]*)\]\((\S+?)(?:\s+"[^"]*")?\)|<p>[ \t]*<img\b[^>]*>[ \t]*<\/p>|<img\b[^>]*>/g;
  const ATTR = /([\w-]+)\s*=\s*"([^"]*)"/g;

  function fencedRanges(text) {
    const ranges = [];
    const re = /^[ \t]*(```|~~~).*$/gm;
    let open = null;
    for (const m of text.matchAll(re)) {
      if (open === null) open = m.index;
      else {
        ranges.push([open, m.index + m[0].length]);
        open = null;
      }
    }
    if (open !== null) ranges.push([open, text.length]);
    return ranges;
  }

  function findImages(text) {
    const fences = fencedRanges(text);
    const images = [];
    for (const m of text.matchAll(IMAGE_TOKEN)) {
      if (fences.some(([s, e]) => m.index >= s && m.index < e)) continue;
      const start = m.index;
      const end = start + m[0].length;
      const lineStart = text.lastIndexOf('\n', start - 1) + 1;
      const lineEnd = text.indexOf('\n', end) === -1 ? text.length : text.indexOf('\n', end);
      // 한 줄에 이미지만 있으면 블록 이미지다. 글자와 같은 줄이면 이미 문단 안이라 감쌀 필요가 없다.
      const block = !text.slice(lineStart, start).trim() && !text.slice(end, lineEnd).trim();
      const image = { start, end, block, html: m[1] === undefined };
      if (image.html) {
        const attrs = Object.fromEntries([...m[0].matchAll(ATTR)].map((a) => [a[1].toLowerCase(), a[2]]));
        if (!attrs.src) continue;
        Object.assign(image, { src: attrs.src, alt: attrs.alt || '', width: attrs.width || null });
      } else {
        Object.assign(image, { src: m[2], alt: m[1], width: null });
      }
      images.push(image);
    }
    return images;
  }

  // 폭이 있으면 velog 가 허용하는 <img width> 로, 없으면 마크다운 이미지로 만든다.
  // 블록 이미지는 <p> 로 감싸야 velog 기본처럼 가운데 정렬된다.
  function buildImage({ src, alt, width, block }) {
    if (!width) return `![${alt || ''}](${src})`;
    const altAttr = alt ? ` alt="${alt.replace(/"/g, '&quot;')}"` : '';
    const tag = `<img src="${src}"${altAttr} width="${width}">`;
    return block ? `<p>${tag}</p>` : tag;
  }

  function sameSrc(a, b) {
    if (a === b) return true;
    try {
      return decodeURI(a) === decodeURI(b);
    } catch {
      return false;
    }
  }

  // 미리보기의 n 번째(같은 주소 기준) 이미지에 해당하는 원문 토큰을 찾는다.
  function findImageBySrc(text, src, nth) {
    return findImages(text).filter((img) => sameSrc(img.src, src))[nth] || null;
  }

  // 여러 이미지 중 원문에서 가장 앞의 것을 replacement 로 바꾸고 나머지는 지운다.
  // 지운 이미지만 있던 줄은 줄째로 없애고, 빈 줄이 겹치면 하나로 줄인다.
  function mergeImagesInText(text, targets, replacement) {
    const tokens = targets.map(({ src, nth }) => findImageBySrc(text, src, nth));
    if (tokens.some((t) => !t)) return null;
    tokens.sort((a, b) => a.start - b.start);
    const [first, ...rest] = tokens;
    let out = text;
    for (const t of rest.reverse()) {
      const lineStart = out.lastIndexOf('\n', t.start - 1) + 1;
      const nl = out.indexOf('\n', t.end);
      const lineEnd = nl === -1 ? out.length : nl;
      if (t.block) {
        out = out.slice(0, lineStart) + out.slice(Math.min(out.length, lineEnd + 1));
        if (lineStart >= 2 && out.slice(lineStart - 2, lineStart + 1) === '\n\n\n') {
          out = out.slice(0, lineStart) + out.slice(lineStart + 1);
        }
      } else {
        out = out.slice(0, t.start) + out.slice(t.end);
      }
    }
    const built = buildImage({ src: replacement, alt: '', width: first.width, block: first.block });
    return out.slice(0, first.start) + built + out.slice(first.end);
  }

  const api = {
    mergeImagesInText,
    parseStyle,
    serializeStyle,
    removeProp,
    applyStyle,
    toggleStyles,
    innerRange,
    findImages,
    findImageBySrc,
    buildImage,
    sameSrc,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.__velogPlusMarkup = api;
})(typeof window !== 'undefined' ? window : globalThis);
