// popup.js —— 弹窗逻辑：下发扫描指令、展示识别结果
// 所有解码均由 background 统一完成，popup 只负责指令与展示

// 本地化辅助：取翻译文本，缺失时回退 key（键存在才替换，避免误清空元素）
function t(key, subs) { return chrome.i18n.getMessage(key, subs) || key; }

// 渲染 HTML 中带 data-i18n 的元素文本（按钮、提示等）
document.querySelectorAll('[data-i18n]').forEach(el => {
  const msg = chrome.i18n.getMessage(el.dataset.i18n);
  if (msg) el.textContent = msg;
});

const scanBtn = document.getElementById('scanBtn');
const delayBtn = document.getElementById('delayBtn');
const regionBtn = document.getElementById('regionBtn');
const uploadBtn = document.getElementById('uploadBtn');
const countdown = document.getElementById('countdown');
const loading = document.getElementById('loading');
const resultDiv = document.getElementById('result');
const errorDiv = document.getElementById('error');

let countdownTimer = null;
let regionTimer = null;

// 网址判定：支持省略协议、端口、路径/查询/锚点、Unicode 域名
const URL_PATTERN = /^(https?:\/\/)?([\p{L}\p{N}-]+\.)+\p{L}{2,}(:\d+)?(\/[^\s]*)?$/iu;

function clearTimers() {
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  if (regionTimer) { clearInterval(regionTimer); regionTimer = null; }
}

function showLoading(show) {
  loading.style.display = show ? 'block' : 'none';
}

function showError(msg) {
  errorDiv.innerHTML = '';
  // textContent 渲染，防注入
  const textEl = document.createElement('div');
  textEl.textContent = msg;
  errorDiv.appendChild(textEl);

  // 复制按钮（与区域截图悬浮通知保持一致）
  const btnGroup = document.createElement('div');
  btnGroup.style.cssText = 'text-align:center;margin-top:8px;';
  const btnCopy = document.createElement('button');
  btnCopy.textContent = t('copyContent');
  btnCopy.className = 'btn blue';
  btnCopy.onclick = () => {
    navigator.clipboard.writeText(msg).then(() => {
      btnCopy.textContent = t('copied');
      setTimeout(() => { btnCopy.textContent = t('copyContent'); }, 1200);
    }).catch(() => {
      btnCopy.textContent = t('copyFailed');
      setTimeout(() => { btnCopy.textContent = t('copyContent'); }, 1200);
    });
  };
  btnGroup.appendChild(btnCopy);
  errorDiv.appendChild(btnGroup);
  errorDiv.style.display = 'block';
}

function hideError() {
  errorDiv.style.display = 'none';
}

function hideResult() {
  resultDiv.style.display = 'none';
  resultDiv.innerHTML = '';
}

// 在目标容器内渲染单条识别结果（内容 + 操作按钮）
function appendResult(target, text) {
  const contentDiv = document.createElement('div');
  contentDiv.textContent = text; // textContent 防注入
  target.appendChild(contentDiv);

  const btnGroup = document.createElement('div');
  btnGroup.style.cssText = 'text-align:center;margin-top:10px;';

  const btnCopy = document.createElement('button');
  btnCopy.textContent = t('copyAll');
  btnCopy.className = 'btn blue';
  btnCopy.onclick = () => {
    navigator.clipboard.writeText(text).then(() => {
      btnCopy.textContent = t('copied');
      setTimeout(() => { btnCopy.textContent = t('copyAll'); }, 1200);
    }).catch(() => {
      btnCopy.textContent = t('copyFailed');
      setTimeout(() => { btnCopy.textContent = t('copyAll'); }, 1200);
    });
  };
  btnGroup.appendChild(btnCopy);

  if (URL_PATTERN.test(text)) {
    const btnOpen = document.createElement('button');
    btnOpen.textContent = t('openNewTab');
    btnOpen.className = 'btn blue';
    btnOpen.onclick = () => {
      let url = text;
      if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
      // 使用回调形式：部分浏览器(如夸克)的 tabs.create 在返回 Promise
      // 时可能因内部读取 undefined 报错，回调形式可避免未处理的
      // Promise rejection 污染插件错误日志。
      chrome.tabs.create({url: url}, () => {
        if (chrome.runtime.lastError) {
          showError(t('openNewTabFailed', [chrome.runtime.lastError.message]));
        }
      });
    };
    btnGroup.appendChild(btnOpen);
  }
  target.appendChild(btnGroup);
}

// 主结果区展示单条结果，可带灰色提示前缀
function showResult(text, notice) {
  resultDiv.innerHTML = '';
  if (notice) {
    const head = document.createElement('div');
    head.style.cssText = 'color:#888;font-size:13px;margin-bottom:8px;';
    head.textContent = notice;
    resultDiv.appendChild(head);
  }
  appendResult(resultDiv, text);
  resultDiv.style.display = 'block';
}

// 多二维码结果展示（每个结果独立成块，各带操作按钮）
function showMultiResult(arr) {
  const uniq = Array.from(new Set(arr));
  if (uniq.length === 1) {
    showResult(uniq[0], arr.length > 1 ? t('multiSame') : null);
    return;
  }
  resultDiv.innerHTML = '';
  const head = document.createElement('div');
  head.style.cssText = 'color:#888;font-size:13px;margin-bottom:8px;';
  head.textContent = t('multiList');
  resultDiv.appendChild(head);
  uniq.forEach((text, idx) => {
    const box = document.createElement('div');
    box.style.cssText = 'margin-bottom:10px;padding:7px 8px;background:#f8f8fa;border-radius:4px;';
    const label = document.createElement('div');
    label.style.cssText = 'font-size:13px;color:#333;margin-bottom:4px;';
    label.textContent = t('qrN', [idx + 1]);
    box.appendChild(label);
    appendResult(box, text);
    resultDiv.appendChild(box);
  });
  resultDiv.style.display = 'block';
}

// 统一处理后台返回的识别结果
function handleDecodeResult(result) {
  showLoading(false);
  if (!result) { showError(t('backendNoResponse')); return; }
  if (result.error) { showError(result.error); }
  else if (result.multi) { showMultiResult(result.multi); }
  else { showResult(result.data); }
}

// ---------- 立即/延迟扫描 ----------
function doScan(delay) {
  clearTimers();
  hideResult();
  hideError();
  showLoading(false);
  if (delay > 0) {
    let sec = delay;
    countdown.textContent = t('secondsLeft', [sec]);
    countdown.style.display = 'block';
    countdownTimer = setInterval(() => {
      sec--;
      if (sec <= 0) {
        clearInterval(countdownTimer);
        countdownTimer = null;
        countdown.style.display = 'none';
        realScan();
      } else {
        countdown.textContent = t('secondsLeft', [sec]);
      }
    }, 1000);
  } else {
    realScan();
  }
}

function realScan() {
  showLoading(true);
  chrome.runtime.sendMessage({action: 'decodeScreenshot'}, handleDecodeResult);
}

// ---------- 手动上传 ----------
// 图片（上传文件/剪贴板）交给后台统一解码
function decodeImage(dataUrl) {
  showLoading(true);
  chrome.runtime.sendMessage({action: 'decodeImageDataUrl', dataUrl: dataUrl}, handleDecodeResult);
}

function showUploadBtns() {
  clearTimers();
  hideResult();
  hideError();
  hideUploadBtns();
  const uploadGroup = document.createElement('div');
  uploadGroup.id = 'qr-upload-group';
  uploadGroup.style.textAlign = 'center';

  // 读取剪贴板
  const btnClipboard = document.createElement('button');
  btnClipboard.textContent = t('readClipboard');
  btnClipboard.className = 'btn blue';
  btnClipboard.style.marginRight = '12px';
  btnClipboard.onclick = async () => {
    btnClipboard.disabled = true;
    try {
      if (navigator.clipboard && navigator.clipboard.read) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          for (const type of item.types) {
            if (type.startsWith('image/')) {
              const blob = await item.getType(type);
              const reader = new FileReader();
              reader.onload = e => decodeImage(e.target.result);
              reader.onerror = () => showError(t('clipboardReadFail'));
              reader.readAsDataURL(blob);
              return;
            }
          }
        }
        showError(t('clipboardNoImage'));
      } else {
        showError(t('clipboardUnsupported'));
      }
    } catch (e) {
      showError(t('clipboardFail', [e.message]));
    } finally {
      btnClipboard.disabled = false;
    }
  };
  uploadGroup.appendChild(btnClipboard);

  // 上传文件
  const btnFile = document.createElement('button');
  btnFile.textContent = t('uploadFile');
  btnFile.className = 'btn blue';
  btnFile.onclick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = e => decodeImage(e.target.result);
        reader.onerror = () => showError(t('fileReadFail'));
        reader.readAsDataURL(input.files[0]);
      }
    };
    input.click();
  };
  uploadGroup.appendChild(btnFile);

  countdown.innerHTML = '';
  countdown.appendChild(uploadGroup);
  countdown.style.display = 'block';
}

function hideUploadBtns() {
  const uploadGroup = document.getElementById('qr-upload-group');
  if (uploadGroup && uploadGroup.parentNode) uploadGroup.parentNode.removeChild(uploadGroup);
  if (!countdown.textContent.trim()) countdown.style.display = 'none';
}

// ---------- 区域截图 ----------
function regionScanDelay(delay) {
  clearTimers();
  hideResult();
  hideError();
  showLoading(false);
  let sec = delay;
  countdown.textContent = t('regionSecondsLeft', [sec]);
  countdown.style.display = 'block';
  regionTimer = setInterval(() => {
    sec--;
    if (sec <= 0) {
      clearInterval(regionTimer);
      regionTimer = null;
      countdown.style.display = 'none';
      startRegionSelect();
    } else {
      countdown.textContent = t('regionSecondsLeft', [sec]);
    }
  }, 1000);
}

function startRegionSelect() {
  chrome.tabs.query({active: true, currentWindow: true}, tabs => {
    const tab = tabs && tabs[0];
    if (!tab || typeof tab.id !== 'number') { showError(t('noActiveTab')); return; }
    chrome.runtime.sendMessage({action: 'injectRegionScript', tabId: tab.id}, resp => {
      if (chrome.runtime.lastError) {
        showError(t('injectFail', [chrome.runtime.lastError.message]));
        return;
      }
      if (!resp) { showError(t('backendNoResponse')); return; }
      if (resp.error) { showError(resp.error); return; }
      countdown.textContent = t('dragHint');
      countdown.style.display = 'block';
    });
  });
}

// ---------- 事件绑定 ----------
scanBtn.onclick = () => doScan(0);
delayBtn.onclick = () => doScan(3);
regionBtn.onclick = () => regionScanDelay(3);
uploadBtn.onclick = showUploadBtns;

// ---------- 扩展名与版本号（从 manifest 动态读取） ----------
const manifest = chrome.runtime.getManifest();
// 左上角标题：getManifest 返回的 name 已是按浏览器语言本地化后的值
const extNameEl = document.getElementById('extName');
if (extNameEl) extNameEl.textContent = manifest.name || 'momoQRdecoder';
// 右上角版本号标签（英文名已移至底部页脚）
document.getElementById('version').textContent = 'v' + (manifest.version || '');
