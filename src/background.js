// velog 이미지 서버는 CORS 헤더를 주지 않아 페이지에서 픽셀을 읽을 수 없다.
// 확장 권한으로 이미지를 받아 data URL 로 넘겨, 에디터에서 자를 수 있게 한다.
const ALLOWED_HOSTS = ['velog.velcdn.com', 'images.velog.io', 'media.vlpt.us'];

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

async function fetchImage(url) {
  const { protocol, hostname } = new URL(url);
  if (protocol !== 'https:' || !ALLOWED_HOSTS.includes(hostname)) {
    throw new Error('velog 에 올린 이미지만 자를 수 있습니다.');
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`이미지를 받지 못했습니다. (${res.status})`);
  const type = res.headers.get('content-type') || 'image/png';
  return `data:${type};base64,${toBase64(await res.arrayBuffer())}`;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'fetch-image') return false;
  fetchImage(message.url)
    .then((dataUrl) => sendResponse({ dataUrl }))
    .catch((error) => sendResponse({ error: error.message }));
  return true;
});
