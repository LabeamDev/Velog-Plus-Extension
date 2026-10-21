// MAIN world 기능들이 함께 쓰는 velog 에디터 접근·업로드·알림 도우미.
(function () {
  if (window.__velogPlusApi) return;
  const UPLOAD_URL = 'https://v2.velog.io/api/v2/files/upload';

  function getCM() {
    const el = document.querySelector('.CodeMirror');
    return el && el.CodeMirror;
  }

  function postId() {
    return new URLSearchParams(location.search).get('id');
  }

  // velog 에디터와 같은 API 로 올린다. 응답의 path 가 새 이미지 주소다.
  async function upload(blob, fileName) {
    const id = postId();
    if (!id) throw new Error('먼저 임시저장한 뒤 다시 시도하세요.');
    const form = new FormData();
    form.append('image', blob instanceof File ? blob : new File([blob], fileName, { type: blob.type }));
    form.append('type', 'post');
    form.append('ref_id', id);
    const res = await fetch(UPLOAD_URL, { method: 'POST', body: form, credentials: 'include' });
    if (!res.ok) throw new Error(`업로드에 실패했습니다. (${res.status})`);
    const { path } = await res.json();
    if (!path) throw new Error('업로드 응답에 이미지 주소가 없습니다.');
    return path;
  }

  let toastEl = null;
  let toastTimer = 0;

  function toast(text, sticky = false) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'vp-toast';
      document.body.append(toastEl);
    }
    toastEl.textContent = text;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    if (!sticky) toastTimer = setTimeout(() => (toastEl.hidden = true), 2500);
  }

  window.__velogPlusApi = { getCM, postId, upload, toast };
})();
