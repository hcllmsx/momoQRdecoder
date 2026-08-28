// offscreen.js —— background 与沙箱引擎之间的消息桥
// 背景:OpencvQr.js(OpenCV.js)的 Embind 绑定层会在运行期用 new Function
// 动态生成胶水代码，而 MV3 扩展页面的 CSP 禁止 unsafe-eval(且无法在
// manifest 的 extension_pages 中放开)。因此把引擎放进沙箱 iframe
// (manifest 中 content_security_policy.sandbox 允许 unsafe-eval)运行：
//   background ⇄ offscreen(chrome.runtime 消息) ⇄ sandbox iframe(postMessage)
// 沙箱页面没有 chrome API、跨源 fetch 也拿不到扩展资源，所以模型文件由
// 本页面(非沙箱、同源)预取后转成 data: URL 注入，OpencvQr 内部 fetch
// 该 data: URL 完成加载。
// 对 background 的消息协议保持不变：
//   请求  {type: 'wechatDecode', dataUrl: <data:image/...>}
//   响应  {data: string} | {multi: string[]} | {error: string}

// 本地化辅助（offscreen 页面可用 chrome.i18n）
function t(key, subs) { return chrome.i18n.getMessage(key, subs) || key; }

const SANDBOX_URL = chrome.runtime.getURL('src/sandbox.html');
const MODEL_DETECT = chrome.runtime.getURL('src/models/detect.caffemodel');
const MODEL_SR = chrome.runtime.getURL('src/models/sr.caffemodel');

let sandboxFrame = null;
let sandboxReady = false;
let sandboxError = null;
const pendingRequests = []; // 引擎就绪前暂存的请求
const callbacks = new Map(); // 请求 id -> {respond, timer}
let nextId = 1;

createSandbox();

function createSandbox() {
  const iframe = document.createElement('iframe');
  iframe.src = SANDBOX_URL;
  iframe.style.display = 'none';
  document.body.appendChild(iframe);
  sandboxFrame = iframe;
}

// blob -> data URL
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(new Error(t('modelReadFail')));
    fr.readAsDataURL(blob);
  });
}

async function fetchModelAsDataUrl(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('HTTP ' + resp.status + ' ' + url);
  return blobToDataUrl(await resp.blob());
}

function sendModelsToSandbox() {
  (async () => {
    const dw = await fetchModelAsDataUrl(MODEL_DETECT);
    const sw = await fetchModelAsDataUrl(MODEL_SR);
    sandboxFrame.contentWindow.postMessage({ type: 'models', dw: dw, sw: sw }, '*');
  })().catch((e) => {
    setSandboxError(t('modelLoadFail', [e && e.message || e]));
  });
}

// 记录致命错误，并把排队中的请求全部以该错误结束
function setSandboxError(message) {
  if (sandboxError) return;
  sandboxError = message;
  while (pendingRequests.length) {
    const item = pendingRequests.shift();
    const entry = callbacks.get(item.id);
    if (entry) {
      callbacks.delete(item.id);
      clearTimeout(entry.timer);
      entry.respond({ error: sandboxError });
    }
  }
}

window.addEventListener('message', (e) => {
  const msg = e.data;
  if (!msg) return;
  if (msg.type === 'hello') {
    // 沙箱脚本已运行，注入模型数据
    sendModelsToSandbox();
  } else if (msg.type === 'sandboxReady') {
    sandboxReady = true;
    while (pendingRequests.length) postToSandbox(pendingRequests.shift());
  } else if (msg.type === 'sandboxError') {
    setSandboxError(t('wechatInitFailed', [msg.error || t('unknownError')]));
  } else if (msg.type === 'decodeResult') {
    const entry = callbacks.get(msg.id);
    if (entry) {
      callbacks.delete(msg.id);
      clearTimeout(entry.timer);
      entry.respond(msg.result);
    }
  }
});

function postToSandbox(payload) {
  sandboxFrame.contentWindow.postMessage(payload, '*');
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'wechatDecode') return;
  if (sandboxError) {
    sendResponse({ error: sandboxError });
    return;
  }
  const id = nextId++;
  const entry = { respond: sendResponse, timer: null };
  // 兜底超时：防止沙箱异常导致 background 永久挂起
  entry.timer = setTimeout(() => {
    if (callbacks.has(id)) {
      callbacks.delete(id);
      entry.respond({ error: t('wechatTimeout') });
    }
  }, 60000);
  callbacks.set(id, entry);
  const payload = { type: 'decode', id: id, dataUrl: msg.dataUrl };
  if (sandboxReady) postToSandbox(payload);
  else pendingRequests.push(payload);
  return true; // 异步 sendResponse
});
