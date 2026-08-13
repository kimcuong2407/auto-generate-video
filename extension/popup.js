const DEFAULT_ENDPOINT = 'http://localhost:3000/api/shopee/ingest';

const endpointInput = document.getElementById('endpoint');
const sendBtn = document.getElementById('send');
const statusEl = document.getElementById('status');

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = cls || '';
}

// Nạp endpoint đã lưu (hoặc mặc định).
chrome.storage.local.get(['endpoint'], (res) => {
  endpointInput.value = res.endpoint || DEFAULT_ENDPOINT;
});

// Lưu lại mỗi khi user sửa endpoint.
endpointInput.addEventListener('change', () => {
  chrome.storage.local.set({ endpoint: endpointInput.value.trim() });
});

sendBtn.addEventListener('click', async () => {
  const endpoint = endpointInput.value.trim() || DEFAULT_ENDPOINT;
  chrome.storage.local.set({ endpoint });

  sendBtn.disabled = true;
  setStatus('Đang đọc data từ tab...', '');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !/^https:\/\/([a-z0-9-]+\.)?shopee\.vn\//i.test(tab.url || '')) {
      setStatus('Tab hiện tại không phải trang Shopee. Hãy mở 1 trang sản phẩm Shopee rồi thử lại.', 'err');
      return;
    }

    // Đảm bảo content script đã có mặt trong tab (tránh lỗi "Receiving end does not exist"
    // khi trang được mở TRƯỚC lúc cài/reload extension). Inject là idempotent — nạp lại vẫn ok.
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    } catch (injectErr) {
      setStatus(
        'Không inject được content script vào tab. Thử tải lại trang Shopee rồi bấm lại.\n' +
          String(injectErr && injectErr.message ? injectErr.message : injectErr),
        'err'
      );
      return;
    }

    const data = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PRODUCT' });

    if (!data) {
      setStatus('Không nhận được phản hồi từ trang. Thử tải lại trang Shopee rồi bấm lại.', 'err');
      return;
    }
    // initialState có thể null nếu SPA điều hướng chưa F5 (thẻ <script> là của sản phẩm cũ nên
    // bị loại). Vẫn gửi được bằng domData thuần (DOM luôn đúng sản phẩm hiện tại).
    if (!data.initialState && !data.domData) {
      setStatus(
        'Không đọc được data từ trang. Thử tải lại (F5) trang Shopee rồi bấm lại. ' +
          'itemId=' + (data.itemId || '?'),
        'err'
      );
      return;
    }

    setStatus('Đang gửi về app...', '');
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itemId: data.itemId,
        shopId: data.shopId,
        initialState: data.initialState || null,
        domData: data.domData || null,
      }),
    });
    const json = await res.json();
    if (json.ok && json.product) {
      setStatus('✅ Đã gửi: ' + json.product.name, 'ok');
    } else {
      setStatus('❌ App báo lỗi: ' + (json.error || res.status), 'err');
    }
  } catch (err) {
    setStatus('❌ Lỗi: ' + String(err && err.message ? err.message : err), 'err');
  } finally {
    sendBtn.disabled = false;
  }
});
