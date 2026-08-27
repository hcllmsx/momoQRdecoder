// popup.js
const scanBtn = document.getElementById('scanBtn');
const delayBtn = document.getElementById('delayBtn');
const countdown = document.getElementById('countdown');
const loading = document.getElementById('loading');
const resultDiv = document.getElementById('result');
const errorDiv = document.getElementById('error');

let countdownTimer = null;

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
function showResult(text) {
  // 移除旧按钮组
  const oldGroup = document.getElementById('qr-btn-group');
  if (oldGroup && oldGroup.parentNode) oldGroup.parentNode.removeChild(oldGroup);
  resultDiv.innerHTML = '';
  if (!text) return;
  // 判断是否网址
  const urlPattern = /^(https?:\/\/)?([\w-]+\.)+[\w-]+(\/[\w- .\/\?%&=]*)?$/i;
  // 内容单独div
  const contentDiv = document.createElement('div');
  contentDiv.textContent = text;
  resultDiv.appendChild(contentDiv);
  resultDiv.style.display = 'block';
  // 创建按钮组
  const btnGroup = document.createElement('div');
  btnGroup.id = 'qr-btn-group';
  btnGroup.style.textAlign = 'center';
  btnGroup.style.marginTop = '14px';
  const btnCopy = document.createElement('button');
  btnCopy.textContent = '一键复制';
  btnCopy.className = 'btn blue';
  btnCopy.onclick = () => {
    navigator.clipboard.writeText(text).then(() => {
      btnCopy.textContent = '已复制!';
      setTimeout(()=>btnCopy.textContent='一键复制', 1200);
    });
  };
  btnGroup.appendChild(btnCopy);
  if (urlPattern.test(text)) {
    const btnOpen = document.createElement('button');
    btnOpen.textContent = '新标签页打开';
    btnOpen.className = 'btn blue';
    btnOpen.onclick = () => {
      let url = text;
      if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
      window.open(url, '_blank');
    };
    btnGroup.appendChild(btnOpen);
  }
  // 将按钮组插入到 resultDiv 后面
  resultDiv.parentNode && resultDiv.parentNode.insertBefore(btnGroup, resultDiv.nextSibling);
}

function hideResult() {
  resultDiv.style.display = 'none';
  // 移除按钮组
  const oldGroup = document.getElementById('qr-btn-group');
  if (oldGroup && oldGroup.parentNode) oldGroup.parentNode.removeChild(oldGroup);
  hideUploadBtns();
}

function doScan(delay = 0) {
  hideResult();
  hideError();
  showLoading(false);
  if (delay > 0) {
    let sec = delay;
    countdown.textContent = sec + ' 秒';
    countdown.style.display = 'block';
    countdownTimer = setInterval(() => {
      sec--;
      countdown.textContent = sec > 0 ? sec + ' 秒' : '';
      countdown.style.display = countdown.textContent ? 'block' : 'none';
      if (sec <= 0) {
        clearInterval(countdownTimer);
        countdown.style.display = 'none';
        realScan();
      }
    }, 1000);
  } else {
    realScan();
  }
}

function realScan() {
  showLoading(true);
  chrome.runtime.sendMessage({action: 'captureScreenshot'}, (response) => {
    if (!response || response.error) {
      showLoading(false);
      showError(response ? response.error : '插件后台无响应');
      return;
    }
    // 用canvas和jsQR解码
    decodeQRCodeFromDataUrl(response.dataUrl).then(result => {
      showLoading(false);
      if (result.error) {
        showError(result.error);
      } else if (result.multi) {
        showMultiResult(result.multi);
      } else {
        showResult(result.data);
      }
    });
  });
}

// 多二维码内容展示
function showMultiResult(arr) {
  resultDiv.innerHTML = '';
  const uniq = Array.from(new Set(arr));
  if (uniq.length === 1 && arr.length > 1) {
    // 多个二维码内容相同
    resultDiv.innerHTML = `<div style='color:#888;font-size:13px;margin-bottom:8px;'>检测到多个二维码，内容均相同：</div>`;
    showResult(uniq[0]);
  } else if (uniq.length > 1) {
    resultDiv.innerHTML = `<div style='color:#888;font-size:13px;margin-bottom:8px;'>检测到多个二维码，内容如下：</div>`;
    uniq.forEach((text, idx) => {
      const box = document.createElement('div');
      box.style = 'margin-bottom:10px;padding:7px 8px;background:#f8f8fa;border-radius:4px;';
      box.innerHTML = `<div style='font-size:13px;color:#333;margin-bottom:4px;'>二维码${idx+1}：</div>`;
      // 复用showResult逻辑
      let tmp = document.createElement('div');
      resultDiv.appendChild(box);
      showResult.call({resultDiv:box}, text);
    });
    resultDiv.style.display = 'block';
  } else {
    showResult(arr[0]);
  }
}

// 多二维码检测
function decodeQRCodeFromDataUrl(dataUrl) {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = function() {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, img.width, img.height);
      try {
        // 1. 先整体全图扫描
        const first = window.jsQR(imageData.data, img.width, img.height);
        if (first && first.data) {
          resolve({ data: first.data });
          return;
        }
        // 2. 多区域滑窗扫描
        const results = [];
        const step = Math.max(120, Math.floor(Math.min(img.width, img.height) / 3)); // 自适应窗口
        for(let y=0; y<=img.height-step; y+=step/2) {
          for(let x=0; x<=img.width-step; x+=step/2) {
            const sub = ctx.getImageData(x, y, step, step);
            const code = window.jsQR(sub.data, step, step);
            if (code && code.data) {
              results.push({data: code.data, x: x+code.location.topLeftCorner.x, y: y+code.location.topLeftCorner.y});
            }
          }
        }
        // 去重（内容+位置）
        const uniq = [];
        results.forEach(r => {
          if (!uniq.some(u => u.data === r.data && Math.abs(u.x-r.x)<10 && Math.abs(u.y-r.y)<10)) {
            uniq.push(r);
          }
        });
        if (uniq.length === 0) {
          resolve({error: '未检测到二维码'});
        } else if (uniq.length === 1) {
          resolve({data: uniq[0].data});
        } else {
          resolve({multi: uniq.map(u=>u.data)});
        }
      } catch (e) {
        resolve({error: '解码异常: ' + e.message});
      }
    };
    img.onerror = function() {
      resolve({error: '图片加载失败'});
    };
    img.src = dataUrl;
  });
}




scanBtn.onclick = () => doScan(0);
delayBtn.onclick = () => doScan(3);
regionBtn.onclick = () => { hideUploadBtns(); regionScanDelay(3); };
// 手动上传按钮
const uploadBtn = document.getElementById('uploadBtn');
uploadBtn.onclick = showUploadBtns;

function showUploadBtns() {
  hideResult();
  hideError();
  hideUploadBtns();
  // 创建操作按钮组
  const uploadGroup = document.createElement('div');
  uploadGroup.id = 'qr-upload-group';
  uploadGroup.style.textAlign = 'center';
  // 读取剪切板按钮
  const btnClipboard = document.createElement('button');
  btnClipboard.textContent = '读取剪切板';
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
              reader.onload = e => {
                decodeQRCodeFromDataUrl(e.target.result).then(result => {
                  if (result.error) showError(result.error);
                  else if (result.multi) showMultiResult(result.multi);
                  else showResult(result.data);
                });
              };
              reader.readAsDataURL(blob);
              return;
            }
          }
        }
        showError('剪切板中没有图片');
      } else {
        showError('当前浏览器不支持图片剪切板读取');
      }
    } catch (e) {
      showError('读取剪切板失败: ' + e.message);
    } finally {
      btnClipboard.disabled = false;
    }
  };
  uploadGroup.appendChild(btnClipboard);
  // 上传文件按钮
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
        reader.onload = e => {
          decodeQRCodeFromDataUrl(e.target.result).then(result => {
            if (result.error) showError(result.error);
            else if (result.multi) showMultiResult(result.multi);
            else showResult(result.data);
          });
        };
        reader.readAsDataURL(input.files[0]);
      }
    };
    input.click();
  };
  uploadGroup.appendChild(btnFile);
  // 显示到倒计时区域
  const countdown = document.getElementById('countdown');
  countdown.innerHTML = '';
  countdown.appendChild(uploadGroup);
  countdown.style.display = 'block';
}
function hideUploadBtns() {
  const countdown = document.getElementById('countdown');
  const uploadGroup = document.getElementById('qr-upload-group');
  if (uploadGroup && uploadGroup.parentNode) uploadGroup.parentNode.removeChild(uploadGroup);
  if (!countdown.textContent.trim()) countdown.style.display = 'none';
}

// 区域截图识别模式
function regionScanDelay(delay = 3) {
  hideResult();
  hideError();
  showLoading(false);
  let sec = delay;
  countdown.textContent = sec + ' 秒后可框选区域';
  countdown.style.display = 'block';
  if (window._regionTimer) clearInterval(window._regionTimer);
  window._regionTimer = setInterval(() => {
    sec--;
    countdown.textContent = sec > 0 ? sec + ' 秒后可框选区域' : '';
    countdown.style.display = countdown.textContent ? 'block' : 'none';
    if (sec <= 0) {
      clearInterval(window._regionTimer);
      countdown.style.display = 'none';
      startRegionSelect();
    }
  }, 1000);
}

function startRegionSelect() {
  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    chrome.runtime.sendMessage({
      action: 'injectRegionScript',
      tabId: tabs[0].id
    });
  });
}

// 监听内容脚本的区域坐标，后台截图并裁剪
window.addEventListener('message', function(e) {
  if (!e.data || !e.data.momoqrdecoder_region) return;
  const {x, y, w, h} = e.data.momoqrdecoder_region;
  // 通知popup后台截图
  chrome.runtime.sendMessage({action: 'captureScreenshot'}, (response) => {
    if (!response || response.error) {
      showLoading(false);
      showError(response ? response.error : '插件后台无响应');
      return;
    }
    cropAndDecode(response.dataUrl, x, y, w, h);
  });
});

function cropAndDecode(dataUrl, x, y, w, h) {
  showLoading(true);
  const img = new window.Image();
  img.onload = function() {
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
    const croppedDataUrl = canvas.toDataURL('image/png');
    decodeQRCodeFromDataUrl(croppedDataUrl).then(result => {
      showLoading(false);
      if (result.error) {
        showError(result.error);
      } else if (result.multi) {
        showMultiResult(result.multi);
      } else {
        showResult(result.data);
      }
    });
  };
  img.onerror = function() {
    showError('图片加载失败');
  };
  img.src = dataUrl;
}
