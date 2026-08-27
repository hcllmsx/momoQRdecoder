// 区域截图内容脚本
if (window.__momoqrdecoder_overlay) { /* 已有遮罩，避免重复 */ } else {
const overlay = document.createElement('div');
overlay.style = 'position:fixed;z-index:999999;background:rgba(0,0,0,0.3);top:0;left:0;right:0;bottom:0;cursor:crosshair;';
overlay.id = '__momoqrdecoder_overlay';
document.body.appendChild(overlay);
window.__momoqrdecoder_overlay = overlay;

let startX, startY, endX, endY, selecting = false, rect;
overlay.addEventListener('mousedown', function(e) {
  selecting = true;
  startX = e.clientX; startY = e.clientY;
  if (!rect) {
    rect = document.createElement('div');
    rect.style = 'position:absolute;border:2px dashed #2196f3;background:rgba(33,150,243,0.15);pointer-events:none;';
    overlay.appendChild(rect);
  }
  rect.style.display = 'block';
  rect.style.left = startX + 'px';
  rect.style.top = startY + 'px';
  rect.style.width = '0px';
  rect.style.height = '0px';
});
overlay.addEventListener('mousemove', function(e) {
  if (!selecting) return;
  endX = e.clientX; endY = e.clientY;
  const x = Math.min(startX, endX), y = Math.min(startY, endY);
  const w = Math.abs(endX - startX), h = Math.abs(endY - startY);
  rect.style.left = x + 'px';
  rect.style.top = y + 'px';
  rect.style.width = w + 'px';
  rect.style.height = h + 'px';
});
overlay.addEventListener('mouseup', function(e) {
  selecting = false;
  endX = e.clientX; endY = e.clientY;
  const x = Math.min(startX, endX), y = Math.min(startY, endY);
  const w = Math.abs(endX - startX), h = Math.abs(endY - startY);
  rect.style.display = 'none';
  // 坐标换算：加上滚动并乘以DPR
  const dpr = window.devicePixelRatio || 1;
  const scrollX = window.scrollX, scrollY = window.scrollY;
  chrome.runtime.sendMessage({
    action: 'qr_region_selected',
    region: {
      x: Math.round((x + scrollX) * dpr),
      y: Math.round((y + scrollY) * dpr),
      w: Math.round(w * dpr),
      h: Math.round(h * dpr)
    }
  });
  setTimeout(()=>{
    overlay.remove();
    window.__momoqrdecoder_overlay = null;
  }, 100);
});
}
