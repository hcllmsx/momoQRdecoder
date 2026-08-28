// sandbox.js —— 微信 QR 引擎宿主(运行在沙箱 iframe 中)
// 本页面由 manifest 的 content_security_policy.sandbox 声明为沙箱页面，
// 允许 unsafe-eval(OpenCV.js 的 Embind 绑定层运行期依赖 new Function)。
// 沙箱里没有 chrome.* API，也无法跨源 fetch 扩展资源，因此模型数据由
// offscreen 页面预取后以 data: URL 注入(OpencvQr 内部会 fetch 该 URL)。
// 消息协议(postMessage，targetOrigin 均为 '*'，沙箱 origin 为 opaque)：
//   ← {type:'models', dw, sw}             注入模型(收到后初始化引擎)
//   → {type:'hello'}                      脚本已就绪，请求注入模型
//   → {type:'sandboxReady'}               引擎初始化完成
//   → {type:'sandboxError', error}        引擎初始化失败
//   ← {type:'decode', id, dataUrl}        解码请求
//   → {type:'decodeResult', id, result}   解码结果 {data|multi|error}

let cvQr = null;
let initPromise = null;

window.addEventListener('message', (e) => {
  const msg = e.data;
  if (!msg) return;
  if (msg.type === 'models') {
    initEngine(msg.dw, msg.sw);
  } else if (msg.type === 'decode') {
    handleDecode(msg);
  }
});

// 初始化引擎(只做一次)。失败时通知父页面，后续请求直接报错；
// 恢复途径是 offscreen document 被 background 重建(整条链路重来)。
function initEngine(dwUrl, swUrl) {
  if (initPromise) return initPromise;
  initPromise = new Promise((resolve, reject) => {
    const fail = (e) => {
      window.parent.postMessage({ type: 'sandboxError', error: String(e && e.message || e) }, '*');
      reject(e);
    };
    try {
      const qr = new OpencvQr({ dw: dwUrl, sw: swUrl });
      qr.ready.then(() => {
        cvQr = qr;
        window.parent.postMessage({ type: 'sandboxReady' }, '*');
        resolve(qr);
      }).catch(fail);
    } catch (e) {
      fail(e);
    }
  });
  // 吸收未被消费的 rejection，避免 unhandledrejection 噪音
  initPromise.catch(() => {});
  return initPromise;
}

async function handleDecode(msg) {
  const reply = (result) => window.parent.postMessage({ type: 'decodeResult', id: msg.id, result: result }, '*');
  let result;
  try {
    const qr = await initPromise;
    const imageData = await dataUrlToImageData(msg.dataUrl);
    qr.clear();
    const res = qr.load(imageData);
    if (!res) {
      result = { error: '引擎无响应' };
    } else {
      const infos = res.getInfos();
      const sizes = res.getSizes();
      res.clear();
      if (infos.length === 0) {
        result = { error: '未检测到二维码' };
      } else {
        const uniq = Array.from(new Set(infos));
        result = uniq.length === 1 ? { data: uniq[0], sizes: sizes } : { multi: uniq, sizes: sizes };
      }
    }
  } catch (e) {
    result = { error: '微信引擎解码失败: ' + (e && e.message || e) };
  }
  reply(result);
}

// dataUrl -> ImageData
function dataUrlToImageData(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = dataUrl;
  });
}

// 沙箱脚本已运行，向 offscreen 请求模型注入
window.parent.postMessage({ type: 'hello' }, '*');
