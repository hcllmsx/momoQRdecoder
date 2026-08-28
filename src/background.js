// background.js —— 截图、消息分发与结果通知
// 依赖 jsQR.js 与 cropAndDecodeQRCode.js（同目录，经 importScripts 加载，
// 相对路径以本文件所在 src/ 为基准，勿加 src/ 前缀）
importScripts('jsQR.js', 'cropAndDecodeQRCode.js');

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // 注入区域截图脚本（popup 发起）
  if (msg.action === 'injectRegionScript') {
    chrome.scripting.executeScript({
      target: {tabId: msg.tabId},
      files: ['src/regionOverlay.js']
    }, () => {
      if (chrome.runtime.lastError) {
        sendResponse({error: '无法在当前页面进行区域截图：' + chrome.runtime.lastError.message});
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
    chrome.tabs.captureVisibleTab(sender.tab.windowId, {format: 'png'}, (dataUrl) => {
      if (!dataUrl || chrome.runtime.lastError) {
        chrome.tabs.sendMessage(tabId, {
          __momoqrdecoder_select_screenshot: null,
          __momoqrdecoder_select_screenshot_error: '截图失败，无法获取页面内容。'
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
    chrome.tabs.captureVisibleTab(sender.tab.windowId, {format: 'png'}, (dataUrl) => {
      if (!dataUrl || chrome.runtime.lastError) {
        done({error: '截图失败，无法获取页面内容。'});
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
    chrome.tabs.captureVisibleTab(null, {format: 'png'}, (dataUrl) => {
      if (!dataUrl || chrome.runtime.lastError) {
        sendResponse({error: '截图失败: ' + (chrome.runtime.lastError ? chrome.runtime.lastError.message : '未知错误')});
        return;
      }
      decodeWithFallback(dataUrl).then(sendResponse);
    });
    return true;
  }

  // 图片解码（popup 上传文件/剪贴板）
  if (msg.action === 'decodeImageDataUrl') {
    if (!msg.dataUrl || typeof msg.dataUrl !== 'string') {
      sendResponse({error: '未收到图片数据'});
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

let offscreenReady = null; // offscreen document 的初始化 Promise

// 确保 offscreen document 已创建
function ensureOffscreen() {
  if (offscreenReady) return offscreenReady;
  offscreenReady = (async () => {
    if (typeof chrome.offscreen !== 'object' || !chrome.offscreen.createDocument) {
      throw new Error('当前浏览器不支持 offscreen API');
    }
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
    if (!hasDoc) {
      try {
        await chrome.offscreen.createDocument({
          url: 'src/offscreen.html',
          reasons: ['BLOBS'],
          justification: '使用微信 QR 引擎解码美化二维码'
        });
      } catch (e) {
        // "文档已存在"等场景：若创建失败因文档已在，视为就绪
        if (e && /already|exists/i.test(String(e.message || e))) {
          // 已就绪
        } else {
          offscreenReady = null; // 允许下次重试
          throw e;
        }
      }
    }
  })();
  return offscreenReady;
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
          resolve({error: '微信引擎不可用: ' + chrome.runtime.lastError.message});
          return;
        }
        if (!resp) { resolve({error: '微信引擎无响应'}); return; }
        if (resp.error) { resolve({error: resp.error}); return; }
        if (resp.data) { resolve({data: resp.data}); return; }
        if (resp.multi) { resolve({multi: resp.multi}); return; }
        resolve({error: '未检测到二维码'});
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
    if (resp.error && /不可用|无响应/i.test(resp.error)) {
      offscreenReady = null;
      await ensureOffscreen();
      resp = await sendWechatDecode(dataUrl, 2);
    }
    return resp;
  })().catch((e) => ({error: '微信引擎启动失败: ' + (e && e.message || e)}));
}

// 统一解码入口：jsQR 失败时自动回退微信引擎
async function decodeWithFallback(dataUrl) {
  const result = await decodeImageDataUrl(dataUrl);
  if (!result.error) return result;
  const wechatResult = await decodeWithWechatEngine(dataUrl);
  if (!wechatResult.error) return wechatResult;
  // 微信引擎明确报"未检测到二维码"时保留 jsQR 的提示；
  // 若微信引擎本身启动失败/不可用，则透传其真实原因，便于定位。
  if (/未检测到二维码/.test(wechatResult.error)) return result;
  return {error: wechatResult.error};
}
