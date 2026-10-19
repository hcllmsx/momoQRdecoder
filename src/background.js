// background.js —— 截图、消息分发与结果通知
// Chromium：作为 service worker 运行，用 importScripts 加载同目录依赖
// （相对路径以本文件所在 src/ 为基准，勿加 src/ 前缀）。
// Firefox：作为后台事件页运行，依赖由 manifest 的 background.scripts
// 按顺序预加载；事件页里没有 importScripts，跳过即可。
if (typeof importScripts === 'function') {
  importScripts('jsQR.js', 'cropAndDecodeQRCode.js');
}

// ---------- 本地化辅助 ----------
// service worker 中可直接使用 chrome.i18n；取不到翻译时回退 key
function t(key, subs) { return chrome.i18n.getMessage(key, subs) || key; }

// 沙箱(sandbox.js)内没有 chrome.* API，无法本地化，因此它只返回
// 纯英文错误码；这些码在这里统一翻译成当前语言。offscreen 已本地化
// 的文本不含冒号前缀，会原样透传。
const ERR_MAP = {
  'ENGINE_NO_RESPONSE': 'engineNoResponse',
  'NO_QR_DETECTED': 'noQrDetected',
  'IMAGE_LOAD_FAILED': 'imageLoadFailed',
  'WECHAT_DECODE_FAILED': 'wechatDecodeFailed',
  'WECHAT_ENGINE_UNREACHABLE': 'wechatEngineUnavailable'
};

function localizeError(err) {
  if (typeof err !== 'string') return err;
  const m = err.match(/^(WECHAT_DECODE_FAILED|WECHAT_ENGINE_UNREACHABLE): ([\s\S]*)$/);
  if (m) {
    const detail = ERR_MAP[m[2]] ? t(ERR_MAP[m[2]]) : m[2];
    return t(ERR_MAP[m[1]], [detail]);
  }
  return ERR_MAP[err] ? t(ERR_MAP[err]) : err;
}

// 判断微信引擎是否"不可用/无响应"（含浏览器语言下的本地化文本，兼容判断）
function isWechatUnreachable(err) {
  if (typeof err !== 'string') return false;
  return err === 'ENGINE_NO_RESPONSE'
    || err.indexOf('WECHAT_ENGINE_UNREACHABLE') === 0
    || /无响应|不可用|Receiving end|unavailable|not responding/i.test(err);
}

// captureVisibleTab 包装：Firefox 对可选参数校验更严格，
// windowId 为空时不传该参数（Chrome 同样支持省略）。
function captureVisibleTab(windowId, callback) {
  const options = {format: 'png'};
  if (typeof windowId === 'number') {
    chrome.tabs.captureVisibleTab(windowId, options, callback);
  } else {
    chrome.tabs.captureVisibleTab(options, callback);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // 注入区域截图脚本（popup 发起）
  if (msg.action === 'injectRegionScript') {
    chrome.scripting.executeScript({
      target: {tabId: msg.tabId},
      files: ['src/regionOverlay.js']
    }, () => {
      if (chrome.runtime.lastError) {
        sendResponse({error: t('regionShotFail', [chrome.runtime.lastError.message])});
      } else {
        sendResponse({ok: true});
      }
    });
    return true; // 异步 sendResponse
  }

  // 区域截图：regionOverlay 请求"冻结"当前视口截图。
  // 冻结后 overlay 在静态画面上框选，保证"悬停才显示二维码"这类
  // 页面在框选期间画面不因鼠标移动而消失。
  if (msg.action === 'qr_capture_for_select') {
    const tabId = sender.tab && sender.tab.id;
    if (typeof tabId !== 'number') return;
    captureVisibleTab(sender.tab.windowId, (dataUrl) => {
      if (!dataUrl || chrome.runtime.lastError) {
        chrome.tabs.sendMessage(tabId, {
          __momoqrdecoder_select_screenshot: null,
          __momoqrdecoder_select_screenshot_error: t('screenshotFailedPage')
        });
        return;
      }
      chrome.tabs.sendMessage(tabId, {__momoqrdecoder_select_screenshot: dataUrl});
    });
    return;
  }

  // 区域截图识别（regionOverlay 发起）
  if (msg.action === 'qr_region_selected') {
    const tabId = sender.tab && sender.tab.id;
    if (typeof tabId !== 'number') return;
    const {x, y, w, h} = msg.region;
    const done = (result) => notifyTab(tabId, result);
    // 冻结画面模式：overlay 会把截图 dataUrl 一并带过来，
    // 直接用它裁剪，避免二次截屏与冻结画面不一致。
    if (msg.dataUrl) {
      cropAndDecodeQRCode(msg.dataUrl, x, y, w, h)
        .then(result => result.error ? decodeWithFallback(msg.dataUrl) : result)
        .then(done);
      return;
    }
    // 兼容旧协议（未携带 dataUrl）：重新截屏后裁剪
    captureVisibleTab(sender.tab.windowId, (dataUrl) => {
      if (!dataUrl || chrome.runtime.lastError) {
        done({error: t('screenshotFailedPage')});
        return;
      }
      cropAndDecodeQRCode(dataUrl, x, y, w, h)
        .then(result => result.error ? decodeWithFallback(dataUrl) : result)
        .then(done);
    });
    return;
  }

  // 全页截图解码（popup 立即/延迟扫描）
  if (msg.action === 'decodeScreenshot') {
    captureVisibleTab(null, (dataUrl) => {
      if (!dataUrl || chrome.runtime.lastError) {
        sendResponse({error: t('screenshotFail', [chrome.runtime.lastError ? chrome.runtime.lastError.message : t('unknownError')])});
        return;
      }
      decodeWithFallback(dataUrl).then(sendResponse);
    });
    return true;
  }

  // 图片解码（popup 上传文件/剪贴板）
  if (msg.action === 'decodeImageDataUrl') {
    if (!msg.dataUrl || typeof msg.dataUrl !== 'string') {
      sendResponse({error: t('noImageData')});
      return;
    }
    decodeWithFallback(msg.dataUrl).then(sendResponse);
    return true;
  }
});

// 向标签页发送识别结果通知；qrNotify 未注入时先注入再重发
function notifyTab(tabId, result) {
  chrome.tabs.sendMessage(tabId, {__momoqrdecoder_notify: result}, () => {
    if (!chrome.runtime.lastError) return;
    chrome.scripting.executeScript({
      target: {tabId: tabId},
      files: ['src/qrNotify.js']
    }, () => {
      if (chrome.runtime.lastError) return; // 受限页面，无法显示通知
      chrome.tabs.sendMessage(tabId, {__momoqrdecoder_notify: result});
    });
  });
}

// ================= 解码回退链 =================
// jsQR 是轻量标准解码器，速度快但无法识别"艺术化/美化"二维码
// （如小红书/微信的圆点、心形模块二维码）。当 jsQR 失败时，
// 回退到微信 WeChatQRCode 引擎（OpenCV WASM，运行于 offscreen
// document，识别率高但体积大、首启慢）。

let offscreenReady = null; // offscreen 页面的初始化 Promise
const OFFSCREEN_FRAME_ID = 'momoqrdecoder-offscreen-frame';

// 确保承载 offscreen 页面的上下文已就绪。
// Chromium 使用 chrome.offscreen API；Firefox 没有该 API（后台是事件页，
// 本身拥有 DOM），改为在后台页里嵌入一个隐藏 iframe，消息协议保持一致。
function ensureOffscreen() {
  if (offscreenReady) return offscreenReady;
  offscreenReady = (async () => {
    if (typeof chrome.offscreen === 'object' && chrome.offscreen.createDocument) {
      await createChromeOffscreen();
    } else {
      await createFirefoxOffscreenFrame();
    }
  })().catch((e) => {
    offscreenReady = null; // 允许下次重试
    throw e;
  });
  return offscreenReady;
}

// Chromium：创建 offscreen document
async function createChromeOffscreen() {
  // Chrome 116+ 有 hasDocument()；旧版本直接尝试创建，
  // 若已存在会报错，此时当作已就绪处理。
  let hasDoc = false;
  if (typeof chrome.offscreen.hasDocument === 'function') {
    try {
      hasDoc = await chrome.offscreen.hasDocument();
    } catch (e) {
      hasDoc = false;
    }
  }
  if (hasDoc) return;
  try {
    await chrome.offscreen.createDocument({
      url: 'src/offscreen.html',
      reasons: ['BLOBS'],
      justification: t('offscreenJustification')
    });
  } catch (e) {
    // "文档已存在"等场景：若创建失败因文档已在，视为就绪
    if (!(e && /already|exists/i.test(String(e.message || e)))) throw e;
  }
}

// Firefox：在后台事件页内嵌入隐藏 iframe 承载 offscreen.html。
// iframe 里的 offscreen.js 注册 runtime.onMessage 监听，
// background 仍用 runtime.sendMessage 与它通信（不同 frame，可正常送达）。
function createFirefoxOffscreenFrame() {
  return new Promise((resolve, reject) => {
    const existing = document.getElementById(OFFSCREEN_FRAME_ID);
    const frame = existing || document.createElement('iframe');
    let timer = null;

    const cleanup = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      frame.removeEventListener('load', onLoad);
      frame.removeEventListener('error', onError);
    };
    const onLoad = () => {
      cleanup();
      frame.dataset.momoqrReady = '1';
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(t('offscreenUnsupported')));
    };

    // 已加载完成的 iframe 直接复用（重试时不会再次触发 load）
    if (existing && (existing.dataset.momoqrReady === '1' ||
        (existing.contentDocument && existing.contentDocument.readyState === 'complete'))) {
      existing.dataset.momoqrReady = '1';
      resolve();
      return;
    }

    frame.addEventListener('load', onLoad, {once: true});
    frame.addEventListener('error', onError, {once: true});
    timer = setTimeout(onError, 10000);

    if (!existing) {
      frame.id = OFFSCREEN_FRAME_ID;
      frame.style.display = 'none';
      frame.src = chrome.runtime.getURL('src/offscreen.html');
      (document.body || document.documentElement).appendChild(frame);
    }
  });
}

// 向 offscreen 发送解码请求并等待响应。
// 首次调用时 offscreen 需要下载/解析约 5MB 引擎脚本并加载模型，
// 消息可能在监听器注册前被丢弃，因此做若干次重试。
function sendWechatDecode(dataUrl, retries) {
  return new Promise((resolve) => {
    const attempt = (left) => {
      chrome.runtime.sendMessage({type: 'wechatDecode', dataUrl: dataUrl}, (resp) => {
        if (chrome.runtime.lastError) {
          if (left > 0) {
            setTimeout(() => attempt(left - 1), 1500);
            return;
          }
          // offscreen 可能被回收/不可达：用错误码，最后由 localizeError 统一翻译
          resolve({error: 'WECHAT_ENGINE_UNREACHABLE: ' + chrome.runtime.lastError.message});
          return;
        }
        if (!resp) { resolve({error: 'ENGINE_NO_RESPONSE'}); return; }
        if (resp.error) { resolve({error: resp.error}); return; }
        if (resp.data) { resolve({data: resp.data}); return; }
        if (resp.multi) { resolve({multi: resp.multi}); return; }
        resolve({error: 'NO_QR_DETECTED'});
      });
    };
    attempt(retries);
  });
}

// 调用 offscreen 中的微信引擎解码
function decodeWithWechatEngine(dataUrl) {
  return (async () => {
    await ensureOffscreen();
    let resp = await sendWechatDecode(dataUrl, 3);
    // offscreen 文档可能已被 Chrome 闲置回收（Receiving end does not exist），
    // 重建文档后重试一次。
    if (resp.error && isWechatUnreachable(resp.error)) {
      offscreenReady = null;
      await ensureOffscreen();
      resp = await sendWechatDecode(dataUrl, 2);
    }
    return resp;
  })().catch((e) => ({error: t('wechatEngineStartFailed', [e && e.message || e])}));
}

// 统一解码入口：jsQR 失败时自动回退微信引擎
async function decodeWithFallback(dataUrl) {
  const result = await decodeImageDataUrl(dataUrl);
  if (!result.error) return result;
  const wechatResult = await decodeWithWechatEngine(dataUrl);
  if (!wechatResult.error) return wechatResult;
  // 微信引擎明确报"未检测到二维码"时保留 jsQR 的提示；
  // 若微信引擎本身启动失败/不可用，则透传其真实原因（含错误码翻译），便于定位。
  if (wechatResult.error === 'NO_QR_DETECTED' || /未检测到二维码/.test(wechatResult.error)) return result;
  return {error: localizeError(wechatResult.error)};
}
