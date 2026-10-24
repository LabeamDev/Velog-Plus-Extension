// 마크다운 텍스트의 색상·밑줄(span)과 굵게·기울임(strong·em)을 다루는 순수 함수 모음.
// velog 새니타이저는 span 의 color, background-color, border-bottom-width, border-style 스타일과
// strong·em·b·i 태그를 허용한다. span 의 font-weight·font-style·text-decoration 은 지운다.
(function (root) {
  const SINGLE_SPAN = /^<span style="([^"]*)">((?:(?!<\/?span\b)[\s\S])*)<\/span>$/;
  const SPAN_TOKEN = /<span(?: style="([^"]*)")?>|<\/span>/g;
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
  function removeProp(text, prop, clearBlack = false) {
    const tokens = [];
    const stack = [];
    for (const m of text.matchAll(SPAN_TOKEN)) {
      const token = { index: m.index, raw: m[0], style: m[1] || '', open: m[0] !== '</span>', pair: -1 };
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
        // 배경 지우기 때 남은 기본 검정색도 벗겨 테마의 글자색으로 돌아간다.
        if (clearBlack && /^(?:#000(?:000)?|black|rgb\(0,0,0\))$/i.test((map.get('color') || '').replace(/\s+/g, ''))) map.delete('color');
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

  // 코드 블록(``` ~~~) 밖의 연속된 줄 묶음에만 fn 을 적용한다. 닫히지 않은 블록은 끝까지 코드로 본다.
  function mapOutsideFences(text, fn) {
    const out = [];
    let chunk = [];
    let fence = null;
    const flush = () => {
      if (chunk.length) out.push(fn(chunk.join('\n')));
      chunk = [];
    };
    for (const line of text.split('\n')) {
      const m = line.match(FENCE);
      if (fence) {
        out.push(line);
        if (m && m[1] === fence) fence = null;
      } else if (m) {
        flush();
        fence = m[1];
        out.push(line);
      } else chunk.push(line);
    }
    flush();
    return out.join('\n');
  }

  // 코드 블록 밖의 내용 있는 줄마다 접두 기호·뒤 여백을 뺀 본문에 fn 을 적용한다.
  function mapLines(text, fn) {
    return mapOutsideFences(text, (chunk) => chunk
      .split('\n')
      .map((line) => {
        const prefix = line.match(LINE_PREFIX)[0];
        const body = line.slice(prefix.length);
        if (!body.trim()) return line;
        const trailing = body.match(/\s*$/)[0];
        return prefix + fn(body.slice(0, body.length - trailing.length)) + trailing;
      })
      .join('\n'));
  }

  // value 가 null 이면 해당 스타일 제거, 아니면 줄마다 span 으로 감싼다.
  function applyStyle(text, prop, value) {
    if (value == null) return mapOutsideFences(text, (t) => removeProp(t, prop, prop === 'background-color'));
    if (text === '') return wrap('', new Map([[prop, value]]));
    return mapLines(text, (core) => styleSegment(core, prop, value));
  }

  // ---------- 인라인 서식 해석 ----------
  // shortcut: CommonMark 전체 파서는 아니다. 복잡한 중첩 링크·강조 기호까지 지원할 때 파서로 교체한다.
  // span·strong·b·em·i 태그 짝과 *·_ 강조(CommonMark 유사 규칙)를 찾고,
  // 백슬래시 이스케이프·인라인 코드·링크 주소·이미지·주소 글자는 서식 기호로 보지 않는다.
  const PUNCT = /[!-/:-@[-`{-~\p{P}\p{S}]/u;
  const SPACE = /\s/;
  const at = (re, line, i) => {
    re.lastIndex = i;
    return re.exec(line);
  };
  const SPAN_OPEN = /<span(?: style="([^"]*)")?>/y;
  const SPAN_CLOSE = /<\/span>/y;
  const FORMAT_TAG = /<(\/?)(strong|b|em|i)>/iy;
  const AUTOLINK = /<[a-z][a-z\d+.-]*:[^\s<>]*>/iy;
  const HTML_TAG = /<\/?[a-z][a-z\d-]*(?:\s[^<>]*)?\/?>/iy;
  const IMAGE = /!\[[^\]]*\]\([^)]*\)/y;
  const LINK = /\[((?:[^[\]\\]|\\.)*)\]\([^)]*\)/y;
  const URL_TEXT = /(?:https?:\/\/|www\.)[^\s<>]*/iy;
  const ESCAPE = /\\[!-/:-@[-`{-~]/y;

  // wrappers: { kind: 'span'|'bold'|'italic', openStart, openEnd, closeStart, closeEnd, open, close, md?, style? }
  // hidden: 서식 기호 등 보이는 글자가 아닌 위치. atoms: 중간을 자르면 안 되는 구간. broken: 짝 없는 태그.
  function scanInline(line) {
    const hidden = new Uint8Array(line.length);
    const wrappers = [];
    const atoms = [];
    const tags = {};
    const delims = [];
    const links = new Map();
    let broken = false;
    let i = 0;
    const atom = (end, hide = false) => {
      atoms.push([i, end]);
      if (hide) hidden.fill(1, i, end);
      i = end;
    };
    while (i < line.length) {
      const ch = line[i];
      let m;
      if (links.has(i)) atom(links.get(i), true);
      else if (ch === '\\' && (m = at(ESCAPE, line, i))) atom(i + 2);
      else if (ch === '`') {
        let e = i;
        while (line[e] === '`') e++;
        let close = -1;
        for (let k = line.indexOf('`', e); k >= 0; k = line.indexOf('`', k)) {
          let ke = k;
          while (line[ke] === '`') ke++;
          if (ke - k === e - i) {
            close = ke;
            break;
          }
          k = ke;
        }
        if (close < 0) i = e;
        else atom(close);
      } else if (ch === '!' && (m = at(IMAGE, line, i))) atom(i + m[0].length);
      else if (ch === '[' && (m = at(LINK, line, i))) {
        links.set(i + 1 + m[1].length, i + m[0].length);
        atom(i + 1, true);
      } else if (ch === '<' && ((m = at(SPAN_OPEN, line, i)) || (m = at(SPAN_CLOSE, line, i)) || (m = at(FORMAT_TAG, line, i)))) {
        const closing = m[0][1] === '/';
        const name = m[2] ? m[2].toLowerCase() : 'span';
        const stack = (tags[name] ||= []);
        const token = { start: i, end: i + m[0].length, raw: m[0], style: name === 'span' ? m[1] || '' : '' };
        if (!closing) stack.push(token);
        else if (stack.length) {
          const o = stack.pop();
          wrappers.push({
            kind: name === 'span' ? 'span' : /^(?:strong|b)$/.test(name) ? 'bold' : 'italic',
            openStart: o.start, openEnd: o.end, closeStart: token.start, closeEnd: token.end, open: o.raw, close: token.raw, style: o.style,
          });
        } else broken = true;
        atom(token.end, true);
      } else if (ch === '<' && (m = at(AUTOLINK, line, i))) atom(i + m[0].length);
      else if (ch === '<' && (m = at(HTML_TAG, line, i))) atom(i + m[0].length, !/^<img\b/i.test(m[0]));
      else if (/[hw]/i.test(ch) && !/[\p{L}\p{N}]/u.test(line[i - 1] || '') && (m = at(URL_TEXT, line, i))) atom(i + m[0].length);
      else if (ch === '*' || ch === '_') {
        let e = i;
        while (line[e] === ch) e++;
        const prev = line[i - 1] || ' ';
        const next = line[e] || ' ';
        const left = !SPACE.test(next) && (!PUNCT.test(next) || SPACE.test(prev) || PUNCT.test(prev));
        const right = !SPACE.test(prev) && (!PUNCT.test(prev) || SPACE.test(next) || PUNCT.test(next));
        const canOpen = ch === '*' ? left : left && (!right || PUNCT.test(prev));
        const canClose = ch === '*' ? right : right && (!left || PUNCT.test(next));
        let s = i;
        // 가장 가까운 같은 기호의 여는 묶음과 2개(굵게)·1개(기울임)씩 짝짓는다. 사이의 여는 기호는 글자로 남는다.
        for (let j = delims.length - 1; canClose && j >= 0 && s < e; j--) {
          const o = delims[j];
          if (o.ch !== ch) continue;
          while (s < e && o.end > o.start) {
            const use = e - s >= 2 && o.end - o.start >= 2 ? 2 : 1;
            o.end -= use;
            const raw = ch.repeat(use);
            wrappers.push({ kind: use === 2 ? 'bold' : 'italic', md: ch, openStart: o.end, openEnd: o.end + use, closeStart: s, closeEnd: s + use, open: raw, close: raw });
            s += use;
          }
          delims.length = o.end > o.start ? j + 1 : j;
        }
        if (s < e && canOpen) delims.push({ ch, start: s, end: e });
        i = e;
      } else i++;
    }
    for (const stack of Object.values(tags)) if (stack.length) broken = true;
    for (const w of wrappers) {
      if (!w.md) continue;
      hidden.fill(1, w.openStart, w.openEnd);
      hidden.fill(1, w.closeStart, w.closeEnd);
      atoms.push([w.openStart, w.openEnd], [w.closeStart, w.closeEnd]);
    }
    return { wrappers, hidden, atoms, broken };
  }

  // kind('bold'|'italic') 서식의 짝 맞는 태그·마크다운 기호를 지운다. 글자와 다른 서식은 남긴다.
  function removeFormat(line, kind) {
    const cuts = scanInline(line).wrappers
      .filter((w) => w.kind === kind)
      .flatMap((w) => [[w.openStart, w.openEnd], [w.closeStart, w.closeEnd]])
      .sort((a, b) => b[0] - a[0]);
    return cuts.reduce((out, [s, e]) => out.slice(0, s) + out.slice(e), line);
  }

  const normalize = (value) => String(value).replace(/\s+/g, '').toLowerCase();

  // 본문의 보이는 글자가 모두 지정 스타일·서식이면 true, 하나라도 아니면 false, 보이는 글자가 없으면 null.
  function lineHighlighted(body, entries, bold, italic, resetFormats) {
    const { wrappers, hidden, broken } = scanInline(body);
    if (broken) return false;
    const spans = wrappers.filter((w) => w.kind === 'span').sort((a, b) => a.openStart - b.openStart);
    const inside = (w, p) => w.openEnd <= p && p < w.closeStart;
    const underlineOn = entries.some(([prop]) => prop === 'border-bottom-width');
    let seen = null;
    for (let p = 0; p < body.length; p++) {
      if (hidden[p] || SPACE.test(body[p])) continue;
      seen = true;
      if ((bold || resetFormats) && bold !== wrappers.some((w) => w.kind === 'bold' && inside(w, p))) return false;
      if ((italic || resetFormats) && italic !== wrappers.some((w) => w.kind === 'italic' && inside(w, p))) return false;
      if (!entries.length && !resetFormats) continue;
      const style = new Map(spans.filter((w) => inside(w, p)).flatMap((w) => [...parseStyle(w.style)]));
      if (resetFormats && !underlineOn && (style.has('border-bottom-width') || style.has('border-style'))) return false;
      if (!entries.every(([prop, value]) => normalize(style.get(prop) || '') === normalize(value))) return false;
    }
    return seen;
  }

  // 선택 전체의 보이는 글자에 켠 스타일·서식이 모두 있는지. 코드 블록·접두 기호·여백은 판정에서 뺀다.
  function isHighlighted(text, styles, formats = {}) {
    const entries = Object.entries(styles || {});
    const bold = formats?.bold === true;
    const italic = formats?.italic === true;
    const resetFormats = typeof formats?.bold === 'boolean' || typeof formats?.italic === 'boolean';
    let seen = null;
    mapOutsideFences(text, (chunk) => {
      const core = chunk.split('\n').map((line) => line.slice(line.match(LINE_PREFIX)[0].length)).join('\n');
      const r = seen === false ? null : lineHighlighted(core, entries, bold, italic, resetFormats);
      if (r !== null) seen = r;
      return chunk;
    });
    return seen;
  }

  function formatSegment(core, entries, bold, italic) {
    let text = core;
    if (bold) text = removeFormat(text, 'bold');
    if (italic) text = removeFormat(text, 'italic');
    const open = (bold ? '<strong>' : '') + (italic ? '<em>' : '');
    const close = (italic ? '</em>' : '') + (bold ? '</strong>' : '');
    const m = text.match(SINGLE_SPAN);
    if (m) {
      const map = parseStyle(m[1]);
      for (const [prop, value] of entries) {
        map.delete(prop);
        map.set(prop, value);
      }
      return wrap(open + m[2] + close, map);
    }
    for (const [prop] of entries) text = removeProp(text, prop);
    return wrap(open + text + close, new Map(entries));
  }

  // 강조 단축키: 켠 스타일(span)과 굵게·기울임(strong·em)을 한 번에 켜고 끈다.
  // 선택 전체가 설정과 같으면 해제, 다르면 적용한다. 굵게·기울임 옵션을 받으면 꺼진 B·I·U도 지운다.
  // on 을 주면 판정 없이 적용(true)·해제(false)한다. 여러 선택을 함께 판정할 때 쓴다.
  // velog 는 span 의 font-weight·font-style 을 지우므로 굵게·기울임은 태그로 넣는다.
  function toggleHighlight(text, styles, formats = {}, on) {
    const entries = Object.entries(styles || {});
    const bold = formats?.bold === true;
    const italic = formats?.italic === true;
    if ((!entries.length && !bold && !italic) || !text.trim()) return text;
    if (on === undefined) on = !isHighlighted(text, styles, formats);
    if (typeof formats?.bold === 'boolean' || typeof formats?.italic === 'boolean') {
      text = mapOutsideFences(text, (chunk) => {
        if (!bold) chunk = removeFormat(chunk, 'bold');
        if (!italic) chunk = removeFormat(chunk, 'italic');
        if (!entries.some(([prop]) => prop === 'border-bottom-width')) {
          chunk = removeProp(removeProp(chunk, 'border-bottom-width'), 'border-style');
        }
        return chunk;
      });
    }
    if (on && !bold && !italic) return entries.reduce((out, [prop, value]) => applyStyle(out, prop, value), text);
    if (on) return mapOutsideFences(text, (chunk) => {
      if (bold) chunk = removeFormat(chunk, 'bold');
      if (italic) chunk = removeFormat(chunk, 'italic');
      return mapLines(chunk, (core) => formatSegment(core, entries, bold, italic));
    });
    const out = entries.reduce((acc, [prop]) => mapOutsideFences(acc, (t) => removeProp(t, prop)), text);
    if (!bold && !italic) return out;
    return mapOutsideFences(out, (chunk) => {
      if (bold) chunk = removeFormat(chunk, 'bold');
      return italic ? removeFormat(chunk, 'italic') : chunk;
    });
  }

  // 개별 밑줄 단축키는 formats 를 생략해 기존 굵게·기울임을 보존한다.
  function toggleStyles(text, styles) {
    return toggleHighlight(text, styles);
  }

  // 결과 문자열에서 바깥 서식(span·strong·em·** 등)을 벗긴 안쪽 글자의 [시작, 끝] 오프셋.
  // 한 줄 결과가 서식 하나로 통째로 감싸였을 때만 값을 준다.
  function innerRange(out) {
    if (out.includes('\n')) return null;
    let s = out.match(LINE_PREFIX)[0].length;
    let e = out.length - out.match(/\s*$/)[0].length;
    const { wrappers } = scanInline(out);
    let found = false;
    for (let w; (w = wrappers.find((x) => x.openStart === s && x.closeEnd === e));) {
      [s, e, found] = [w.openEnd, w.closeStart, true];
    }
    return found ? [s, e] : null;
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
    toggleHighlight,
    isHighlighted,
    scanInline,
    innerRange,
    findImages,
    findImageBySrc,
    buildImage,
    sameSrc,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.__velogPlusMarkup = api;
})(typeof window !== 'undefined' ? window : globalThis);
