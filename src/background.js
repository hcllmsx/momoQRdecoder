// background.js
importScripts('jsQR.js', 'cropAndDecodeQRCode.js');
// background.js
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'injectRegionScript') {
    chrome.scripting.executeScript({
      target: {tabId: msg.tabId},
      files: ['src/regionOverlay.js']
    });
    sendResponse({ok: true});
    return;
  }
  // 区域截图识别
  if (msg.action === 'qr_region_selected') {
    const {x, y, w, h} = msg.region;
    chrome.tabs.captureVisibleTab(null, {format: 'png'}, (dataUrl) => {
      if (!dataUrl) {
        chrome.tabs.sendMessage(sender.tab.id, {__momoqrdecoder_notify: {error: '截图失败，无法获取页面内容。'}});
        return;
      }
      cropAndDecodeQRCode(dataUrl, x, y, w, h).then(result => {
        chrome.tabs.sendMessage(sender.tab.id, {__momoqrdecoder_notify: result}, (resp) => {
          if (chrome.runtime.lastError) {
            // 可能 content script 尚未注入，尝试主动注入后用 window.postMessage
            chrome.scripting.executeScript({
              target: {tabId: sender.tab.id},
              files: ['src/qrNotify.js']
            }, () => {
              chrome.tabs.sendMessage(sender.tab.id, {__momoqrdecoder_notify: result});
            });
          }
        });
      });
    });
    return;
  }
  if (msg.action === 'captureScreenshot') {
    chrome.tabs.captureVisibleTab(null, {format: 'png'}, (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({error: '截图失败: ' + chrome.runtime.lastError.message});
      } else {
        sendResponse({dataUrl});
      }
    });
    return true;
  }
});
