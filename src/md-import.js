// 마크다운 불러오기용 순수 함수. 제목·태그 추출, 로컬 이미지 경로 찾기·교체.
(function (root) {
  const markup =
    typeof module === 'object' && module.exports ? require('./markup.js') : root.__velogPlusMarkup;

  function unquote(value) {
    const v = value.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
    return v;
  }

  // --- 로 감싼 머리말에서 title, tags 만 읽는다. (tags: [a, b] / tags: a, b / 목록 형식)
  function parseFrontMatter(text) {
    const m = text.match(/^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
    if (!m) return { data: {}, body: text };
    const data = {};
    const lines = m[1].split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const kv = lines[i].match(/^([\w-]+):\s*(.*)$/);
      if (!kv) continue;
      const key = kv[1].toLowerCase();
      let value = kv[2].trim();
      if (key === 'tags') {
        let tags = [];
        if (value.startsWith('[')) tags = value.replace(/^\[|\]$/g, '').split(',');
        else if (value) tags = value.split(',');
        else {
          while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) tags.push(lines[++i].replace(/^\s*-\s+/, ''));
        }
        data.tags = tags.map(unquote).filter(Boolean);
      } else {
        data[key] = unquote(value);
      }
    }
    return { data, body: text.slice(m[0].length) };
  }

  // 제목은 머리말 title → 본문 첫 줄의 "# 제목" → 파일 이름 순으로 정한다. 첫 줄 제목은 본문에서 뺀다.
  function parseMarkdownDoc(text, fileName = '') {
    const { data, body } = parseFrontMatter(text.replace(/\r\n/g, '\n'));
    let title = data.title || '';
    let content = body;
    if (!title) {
      const h1 = content.match(/^\s*#[ \t]+(.+?)[ \t#]*(?:\n|$)/);
      if (h1) {
        title = h1[1].trim();
        content = content.slice(h1[0].length);
      }
    }
    if (!title) title = fileName.replace(/^.*\//, '').replace(/\.(md|markdown)$/i, '');
    return { title, tags: data.tags || [], body: content.replace(/^\n+/, '') };
  }

  function isLocal(src) {
    return !/^(https?:|data:|blob:|\/\/)/i.test(src);
  }

  function normalizePath(path) {
    let p = path.split(/[?#]/)[0];
    try {
      p = decodeURIComponent(p);
    } catch {
      // 잘못된 % 인코딩은 그대로 둔다.
    }
    return p
      .replace(/\\/g, '/')
      .split('/')
      .filter((part) => part && part !== '.')
      .join('/')
      .toLowerCase();
  }

  // 본문의 로컬 이미지 경로(중복 제거). 인터넷 주소는 그대로 쓰므로 뺀다.
  function localImageSources(text) {
    return [...new Set(markup.findImages(text).map((img) => img.src).filter(isLocal))];
  }

  // 이미지 경로를 고른 파일과 짝짓는다. 마크다운 파일 기준 상대 경로 → 끝 경로 일치 → 파일 이름 순.
  // files: [{ path: 'post/images/a.png', ... }], mdDir: 'post'
  function resolveFile(src, files, mdDir = '') {
    const wanted = normalizePath(mdDir ? `${mdDir}/${src}` : src);
    const plain = normalizePath(src);
    const byPath = (f) => normalizePath(f.path);
    return (
      files.find((f) => byPath(f) === wanted) ||
      files.find((f) => byPath(f).endsWith(`/${plain}`) || byPath(f) === plain) ||
      files.find((f) => byPath(f).split('/').pop() === plain.split('/').pop()) ||
      null
    );
  }

  // 이미지 토큰 안의 주소만 바꾼다. alt, width 등 나머지는 그대로 둔다.
  function replaceImageSources(text, map) {
    const images = markup.findImages(text).filter((img) => map.has(img.src));
    let out = text;
    for (const img of images.reverse()) {
      const raw = out.slice(img.start, img.end);
      out = out.slice(0, img.start) + raw.replace(img.src, map.get(img.src)) + out.slice(img.end);
    }
    return out;
  }

  const api = { parseFrontMatter, parseMarkdownDoc, localImageSources, resolveFile, replaceImageSources, isLocal };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.__velogPlusImport = api;
})(typeof window !== 'undefined' ? window : globalThis);
