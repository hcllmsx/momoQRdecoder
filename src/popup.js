// popup.js —— 弹窗逻辑：下发扫描指令、展示识别结果
// 所有解码均由 background 统一完成，popup 只负责指令与展示
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
  errorDiv.textContent = msg;
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
  btnCopy.textContent = '一键复制';
  btnCopy.className = 'btn blue';
  btnCopy.onclick = () => {
    navigator.clipboard.writeText(text).then(() => {
      btnCopy.textContent = '已复制!';
      setTimeout(() => { btnCopy.textContent = '一键复制'; }, 1200);
    }).catch(() => {
      btnCopy.textContent = '复制失败';
      setTimeout(() => { btnCopy.textContent = '一键复制'; }, 1200);
    });
  };
  btnGroup.appendChild(btnCopy);

  if (URL_PATTERN.test(text)) {
    const btnOpen = document.createElement('button');
    btnOpen.textContent = '新标签页打开';
    btnOpen.className = 'btn blue';
    btnOpen.onclick = () => {
      let url = text;
      if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
      chrome.tabs.create({url: url});
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
    showResult(uniq[0], arr.length > 1 ? '检测到多个二维码，内容均相同：' : null);
    return;
  }
  resultDiv.innerHTML = '';
  const head = document.createElement('div');
  head.style.cssText = 'color:#888;font-size:13px;margin-bottom:8px;';
  head.textContent = '检测到多个二维码，内容如下：';
  resultDiv.appendChild(head);
  uniq.forEach((text, idx) => {
    const box = document.createElement('div');
    box.style.cssText = 'margin-bottom:10px;padding:7px 8px;background:#f8f8fa;border-radius:4px;';
    const label = document.createElement('div');
    label.style.cssText = 'font-size:13px;color:#333;margin-bottom:4px;';
    label.textContent = '二维码' + (idx + 1) + '：';
    box.appendChild(label);
    appendResult(box, text);
    resultDiv.appendChild(box);
  });
  resultDiv.style.display = 'block';
}

// 统一处理后台返回的识别结果
function handleDecodeResult(result) {
  showLoading(false);
  if (!result) { showError('插件后台无响应'); return; }
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
    countdown.textContent = sec + ' 秒';
    countdown.style.display = 'block';
    countdownTimer = setInterval(() => {
      sec--;
      if (sec <= 0) {
        clearInterval(countdownTimer);
        countdownTimer = null;
        countdown.style.display = 'none';
        realScan();
      } else {
        countdown.textContent = sec + ' 秒';
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
  btnClipboard.textContent = '读取剪贴板';
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
              reader.onerror = () => showError('读取剪贴板图片失败');
              reader.readAsDataURL(blob);
              return;
            }
          }
        }
        showError('剪贴板中没有图片');
      } else {
        showError('当前浏览器不支持图片剪贴板读取');
      }
    } catch (e) {
      showError('读取剪贴板失败: ' + e.message);
    } finally {
      btnClipboard.disabled = false;
    }
  };
  uploadGroup.appendChild(btnClipboard);

  // 上传文件
  const btnFile = document.createElement('button');
  btnFile.textContent = '上传文件';
  btnFile.className = 'btn blue';
  btnFile.onclick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = e => decodeImage(e.target.result);
        reader.onerror = () => showError('读取文件失败');
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
  countdown.textContent = sec + ' 秒后可框选区域';
  countdown.style.display = 'block';
  regionTimer = setInterval(() => {
    sec--;
    if (sec <= 0) {
      clearInterval(regionTimer);
      regionTimer = null;
      countdown.style.display = 'none';
      startRegionSelect();
    } else {
      countdown.textContent = sec + ' 秒后可框选区域';
    }
  }, 1000);
}

function startRegionSelect() {
  chrome.tabs.query({active: true, currentWindow: true}, tabs => {
    if (!tabs || !tabs.length) { showError('未找到活动标签页'); return; }
    chrome.runtime.sendMessage({action: 'injectRegionScript', tabId: tabs[0].id}, resp => {
      if (chrome.runtime.lastError) {
        showError('注入脚本失败: ' + chrome.runtime.lastError.message);
        return;
      }
      if (!resp) { showError('插件后台无响应'); return; }
      if (resp.error) { showError(resp.error); return; }
      countdown.textContent = '请在网页上拖动框选区域';
      countdown.style.display = 'block';
    });
  });
}

// ---------- 事件绑定 ----------
scanBtn.onclick = () => doScan(0);
delayBtn.onclick = () => doScan(3);
regionBtn.onclick = () => regionScanDelay(3);
uploadBtn.onclick = showUploadBtns;

// ---------- 版本号（从 manifest 动态读取） ----------
const manifest = chrome.runtime.getManifest();
document.getElementById('version').textContent = 'v' + (manifest.version || '');
