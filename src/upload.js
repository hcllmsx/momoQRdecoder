// upload.js —— 独立上传页逻辑（popup 无法唤起文件选择器时的兜底入口）
// 解码同样交给 background 完成，本页只负责取图与展示

function t(key, subs) { return chrome.i18n.getMessage(key, subs) || key; }

document.querySelectorAll('[data-i18n]').forEach(el => {
  const msg = chrome.i18n.getMessage(el.dataset.i18n);
  if (msg) el.textContent = msg;
});
document.title = t('uploadPageTitle');

const pickBtn = document.getElementById('pickBtn');
const fileInput = document.getElementById('fileInput');
const loading = document.getElementById('loading');
const resultDiv = document.getElementById('result');
const errorDiv = document.getElementById('error');
const diagBody = document.getElementById('diagBody');

// 网址判定：支持省略协议、端口、路径/查询/锚点、Unicode 域名
const URL_PATTERN = /^(https?:\/\/)?([\p{L}\p{N}-]+\.)+\p{L}{2,}(:\d+)?(\/[^\s]*)?$/iu;

// ---------- 页内诊断 ----------
// 手机端没有 DevTools，把关键步骤写到页面上，便于直接查看/截图反馈
const diagLines = [];
function log(msg) {
  const stamp = new Date().toTimeString().slice(0, 8);
  diagLines.push(stamp + ' ' + msg);
  if (diagLines.length > 40) diagLines.shift();
  if (diagBody) diagBody.textContent = diagLines.join('\n');
}

function isMobileEnv() {
  const uaMobile = /Android|iPhone|iPad|iPod|IEMobile|Opera Mini|Mobile/i.test(navigator.userAgent || '');
  try {
    if (navigator.userAgentData && typeof navigator.userAgentData.mobile === 'boolean') {
      return navigator.userAgentData.mobile || uaMobile;
    }
  } catch (e) { /* 忽略：部分浏览器无 userAgentData */ }
  return uaMobile;
}

log('UA: ' + navigator.userAgent);
log('mobile: ' + (navigator.userAgentData ? navigator.userAgentData.mobile : 'n/a') + ' / isMobile: ' + isMobileEnv());
log('showPicker: ' + (typeof HTMLInputElement.prototype.showPicker === 'function'));

function showLoading(show) { loading.style.display = show ? 'block' : 'none'; }

function showError(msg) {
  log('error: ' + msg);
  resultDiv.style.display = 'none';
  errorDiv.textContent = msg; // textContent 防注入
  errorDiv.style.display = 'block';
  appendCopy(errorDiv, msg, t('copyContent'));
}

function appendCopy(target, text, label) {
  const actions = document.createElement('div');
  actions.className = 'actions';
  const btn = document.createElement('button');
  btn.className = 'btn';
  btn.style.padding = '8px 16px';
  btn.textContent = label;
  btn.onclick = () => {
    navigator.clipboard.writeText(text).then(() => {
      btn.textContent = t('copied');
      setTimeout(() => { btn.textContent = label; }, 1200);
    }).catch(() => {
      btn.textContent = t('copyFailed');
      setTimeout(() => { btn.textContent = label; }, 1200);
    });
  };
  actions.appendChild(btn);
  target.appendChild(actions);
}

// 单条结果：内容 + 复制（网址额外给"新标签页打开"）
function renderItem(target, text, label) {
  const box = document.createElement('div');
  box.className = 'qr-box';
  if (label) {
    const lab = document.createElement('div');
    lab.className = 'qr-label';
    lab.textContent = label;
    box.appendChild(lab);
  }
  const content = document.createElement('div');
  content.textContent = text;
  box.appendChild(content);
  const actions = document.createElement('div');
  actions.className = 'actions';
  const btnCopy = document.createElement('button');
  btnCopy.className = 'btn';
  btnCopy.style.padding = '8px 16px';
  btnCopy.style.marginRight = '8px';
  btnCopy.textContent = t('copyAll');
  btnCopy.onclick = () => {
    navigator.clipboard.writeText(text).then(() => {
      btnCopy.textContent = t('copied');
      setTimeout(() => { btnCopy.textContent = t('copyAll'); }, 1200);
    }).catch(() => {
      btnCopy.textContent = t('copyFailed');
      setTimeout(() => { btnCopy.textContent = t('copyAll'); }, 1200);
    });
  };
  actions.appendChild(btnCopy);
  if (URL_PATTERN.test(text)) {
    const btnOpen = document.createElement('button');
    btnOpen.className = 'btn ghost';
    btnOpen.style.padding = '8px 16px';
    btnOpen.textContent = t('openNewTab');
    btnOpen.onclick = () => {
      let url = text;
      if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
      chrome.tabs.create({url: url}, () => {
        if (chrome.runtime.lastError) showError(t('openNewTabFailed', [chrome.runtime.lastError.message]));
      });
    };
    actions.appendChild(btnOpen);
  }
  box.appendChild(actions);
  target.appendChild(box);
}

function handleDecodeResult(result) {
  showLoading(false);
  if (!result) { log('result: empty (background no response)'); showError(t('backendNoResponse')); return; }
  if (result.error) { showError(result.error); return; }
  log('result: ok');

  errorDiv.style.display = 'none';
  resultDiv.innerHTML = '';
  resultDiv.style.display = 'block';

  if (result.multi) {
    const uniq = Array.from(new Set(result.multi));
    if (uniq.length === 1) {
      const head = document.createElement('div');
      head.className = 'head';
      head.textContent = result.multi.length > 1 ? t('multiSame') : '';
      if (head.textContent) resultDiv.appendChild(head);
      renderItem(resultDiv, uniq[0]);
      return;
    }
    const head = document.createElement('div');
    head.className = 'head';
    head.textContent = t('multiList');
    resultDiv.appendChild(head);
    uniq.forEach((text, idx) => renderItem(resultDiv, text, t('qrN', [idx + 1])));
    return;
  }
  renderItem(resultDiv, result.data);
}

function decodeImage(dataUrl) {
  errorDiv.style.display = 'none';
  resultDiv.style.display = 'none';
  showLoading(true);
  log('decode: ' + (dataUrl ? Math.round(dataUrl.length / 1024) + 'KB dataUrl' : 'empty'));
  chrome.runtime.sendMessage({action: 'decodeImageDataUrl', dataUrl: dataUrl}, (result) => {
    if (chrome.runtime.lastError) {
      log('sendMessage error: ' + chrome.runtime.lastError.message);
      showError(t('backendNoResponse'));
      return;
    }
    handleDecodeResult(result);
  });
}

function readBlob(blob) {
  if (!blob) { showError(t('noImageData')); return; }
  const reader = new FileReader();
  reader.onload = e => decodeImage(e.target.result);
  reader.onerror = () => showError(t('fileReadFail'));
  reader.readAsDataURL(blob);
}

// ---------- 选择文件 ----------
// 注意：这里刻意不做"点击后 N 秒无响应"的提示。用户挑照片可能耗时数十秒，
// 定时判定只会误报并打断操作；取而代之的是页面上常驻的一行灰色说明。
pickBtn.onclick = () => {
  fileInput.value = ''; // 允许重复选择同一文件
  try {
    if (typeof fileInput.showPicker === 'function') {
      fileInput.showPicker();
      log('showPicker() called');
    } else {
      fileInput.click();
      log('click() called');
    }
  } catch (e) {
    log('showPicker failed: ' + (e && e.name) + ' ' + (e && e.message));
    try { fileInput.click(); log('fallback click()'); }
    catch (e2) { log('click failed: ' + (e2 && e2.message)); }
  }
};

fileInput.addEventListener('change', () => {
  const file = fileInput.files && fileInput.files[0];
  log('change: ' + (file ? (file.name + ' | ' + file.type + ' | ' + file.size + 'B') : 'none'));
  if (!file) return;
  if (file.type && !/^image\//.test(file.type)) { showError(t('noImageFile')); return; }
  readBlob(file);
});

// ---------- 版本号（仅用于诊断区） ----------
const manifest = chrome.runtime.getManifest();
// 版本号只在诊断区出现，反馈问题时一并截图即可
log('version: ' + (manifest.version || ''));

