// 区域截图内容脚本（由 background.js 按需注入）
// 工作方式：
//  1. 注入后立即请求后台"冻结"当前视口截图（captureVisibleTab）；
//  2. 在冻结的静态画面上让用户拖动框选，画面不会随鼠标移动而变化，
//     因此"鼠标悬停才显示二维码"这类页面，二维码在框选期间不会消失；
//  3. 松开后把冻结截图 + 选区坐标交给后台裁剪解码。
// 坐标说明：captureVisibleTab 截取的是视口（viewport），clientX/Y 本身就是
// 视口坐标，只需乘 devicePixelRatio 换算为截图像素，不需要加滚动偏移。
(function () {
  if (window.__momoqrdecoder_overlay) return; // 已有遮罩，避免重复注入

  // 本地化辅助（content script 可直接使用 chrome.i18n）
  function t(key, subs) { return chrome.i18n.getMessage(key, subs) || key; }

  const overlay = document.createElement('div'); // 视觉暗化遮罩：不拦截任何鼠标事件
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:999999;background:rgba(0,0,0,0.08);pointer-events:none;';
  overlay.id = '__momoqrdecoder_overlay';

  const tip = document.createElement('div');
  tip.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:1000002;background:rgba(33,150,243,0.95);color:#fff;padding:8px 16px;border-radius:6px;font:14px/1.4 system-ui,sans-serif;box-shadow:0 2px 12px rgba(0,0,0,0.25);pointer-events:none;white-space:nowrap;';
  tip.textContent = t('fetchingView');

  // 冻结画面：全屏覆盖视口。img 不拦截事件（事件由 document 捕获阶段处理）
  const shot = document.createElement('img');
  shot.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:999998;pointer-events:none;user-select:none;-webkit-user-drag:none;';

  // 选区矩形
  const rect = document.createElement('div');
  rect.style.cssText = 'position:fixed;z-index:1000001;border:2px dashed #2196f3;background:rgba(33,150,243,0.15);pointer-events:none;display:none;';

  // 层叠顺序（后插入的在上）：shot(z-999998) < overlay(z-999999) < rect < tip
  document.body.appendChild(shot);
  document.body.appendChild(overlay);
  document.body.appendChild(rect);
  document.body.appendChild(tip);

  // 光标临时改为十字准线（提示正在框选状态）
  const prevCursor = document.documentElement.style.cursor;
  document.documentElement.style.cursor = 'crosshair';

  let startX = 0, startY = 0, selecting = false;
  let alive = true;

  function cleanup() {
    alive = false;
    document.documentElement.style.cursor = prevCursor;
    document.removeEventListener('keydown', onKeydown, true);
    document.removeEventListener('mousedown', onMouseDown, true);
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('mouseup', onMouseUp, true);
    if (chrome.runtime.onMessage) {
      try { chrome.runtime.onMessage.removeListener(onRuntimeMessage); } catch (e) {}
    }
    [shot, overlay, rect, tip].forEach(el => { if (el.parentNode) el.parentNode.removeChild(el); });
    window.__momoqrdecoder_overlay = null;
  }

  // Esc 取消框选
  function onKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cleanup();
    }
  }

  // 左键按下：开始框选。拦截本次点击，避免触发页面元素交互。
  function onMouseDown(e) {
    if (!alive || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    selecting = true;
    startX = e.clientX;
    startY = e.clientY;
    rect.style.display = 'block';
    rect.style.left = startX + 'px';
    rect.style.top = startY + 'px';
    rect.style.width = '0px';
    rect.style.height = '0px';
  }

  function onMouseMove(e) {
    if (!selecting) return;
    e.preventDefault();
    e.stopPropagation();
    const x = Math.min(startX, e.clientX), y = Math.min(startY, e.clientY);
    const w = Math.abs(e.clientX - startX), h = Math.abs(e.clientY - startY);
    rect.style.left = x + 'px';
    rect.style.top = y + 'px';
    rect.style.width = w + 'px';
    rect.style.height = h + 'px';
  }

  function onMouseUp(e) {
    if (!alive || !selecting) return;
    if (e.button !== 0) return;
    selecting = false;
    const x = Math.min(startX, e.clientX), y = Math.min(startY, e.clientY);
    const w = Math.abs(e.clientX - startX), h = Math.abs(e.clientY - startY);
    // 过滤误拖出的过小选区
    if (w < 5 || h < 5) { cleanup(); return; }
    const dpr = window.devicePixelRatio || 1;
    const dataUrl = shot.getAttribute('src') || '';
    // 关键：先移除遮罩并等页面重新渲染，再通知后台截图，
    // 否则半透明遮罩会被截进截图，降低识别率
    cleanup();
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        try {
          chrome.runtime.sendMessage({
            action: 'qr_region_selected',
            dataUrl: dataUrl,
            region: {
              x: Math.round(x * dpr),
              y: Math.round(y * dpr),
              w: Math.round(w * dpr),
              h: Math.round(h * dpr)
            }
          });
        } catch (err) {
          // 扩展上下文失效（如扩展被重载）时静默失败
        }
      });
    });
  }

  // 后台回传冻结截图（background 通过 tabs.sendMessage 下发）
  function onRuntimeMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (typeof msg.__momoqrdecoder_select_screenshot === 'string' && msg.__momoqrdecoder_select_screenshot) {
      shot.src = msg.__momoqrdecoder_select_screenshot;
      tip.textContent = t('dragSelect');
      return;
    }
    if (msg.__momoqrdecoder_select_screenshot === null || msg.__momoqrdecoder_select_screenshot_error) {
      tip.textContent = msg.__momoqrdecoder_select_screenshot_error || t('screenshotFailedQuit');
      setTimeout(cleanup, 1800);
    }
  }

  // 注入后立即请求冻结画面
  function requestShot() {
    try {
      chrome.runtime.sendMessage({action: 'qr_capture_for_select'});
    } catch (err) {
      tip.textContent = t('commFailed');
      setTimeout(cleanup, 1500);
    }
  }

  document.addEventListener('keydown', onKeydown, true);
  document.addEventListener('mousedown', onMouseDown, true);
  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('mouseup', onMouseUp, true);
  chrome.runtime.onMessage.addListener(onRuntimeMessage);

  requestShot();
})();
