// 后台二维码识别模块，依赖全局 jsQR（由 background.js 通过 importScripts('jsQR.js') 加载）
// 提供两个入口：
//   decodeImageDataUrl(dataUrl)              —— 整图识别
//   cropAndDecodeQRCode(dataUrl, x, y, w, h) —— 指定区域识别

function dataURLToBlob(dataurl) {
  const arr = dataurl.split(',');
  const mime = (arr[0].match(/:(.*?);/) || [null, 'image/png'])[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) { u8arr[n] = bstr.charCodeAt(n); }
  return new Blob([u8arr], {type: mime});
}

// 将 dataUrl 加载为 2D 上下文，返回 {ctx, width, height}
function loadImageToCtx(dataUrl) {
  return createImageBitmap(dataURLToBlob(dataUrl)).then(bitmap => {
    // 先记录尺寸：bitmap.close() 后 width/height 会归零
    const width = bitmap.width, height = bitmap.height;
    let canvas;
    if (typeof OffscreenCanvas !== 'undefined') {
      canvas = new OffscreenCanvas(width, height);
    } else {
      canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext('2d', {willReadFrequently: true});
    ctx.drawImage(bitmap, 0, 0);
    if (bitmap.close) bitmap.close();
    return {ctx: ctx, width: width, height: height};
  });
}

// 在 ctx 的 (ox,oy) 起始的 width×height 区域内识别：先整体扫描，再滑窗找多个
function scanForQRCodes(ctx, ox, oy, width, height) {
  const full = ctx.getImageData(ox, oy, width, height);
  const first = jsQR(full.data, width, height);
  if (first && first.data) return {data: first.data};

  // 滑窗扫描（窗口自适应，步进为窗口一半，窗口上限 480 保证速度）
  const results = [];
  const step = Math.min(480, Math.max(120, Math.floor(Math.min(width, height) / 3)));
  const stride = Math.max(60, Math.floor(step / 2));
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const w = Math.min(step, width - x);
      const h = Math.min(step, height - y);
      if (w === width && h === height) continue; // 与整体扫描相同，跳过
      if (w < 60 || h < 60) continue;
      const sub = ctx.getImageData(ox + x, oy + y, w, h);
      const code = jsQR(sub.data, w, h);
      if (code && code.data) results.push(code.data);
    }
  }
  const uniq = Array.from(new Set(results));
  if (uniq.length === 0) return {error: '未检测到二维码'};
  if (uniq.length === 1) return {data: uniq[0]};
  return {multi: uniq};
}

// 整图解码
async function decodeImageDataUrl(dataUrl) {
  try {
    const {ctx, width, height} = await loadImageToCtx(dataUrl);
    return scanForQRCodes(ctx, 0, 0, width, height);
  } catch (e) {
    return {error: '图片加载失败'};
  }
}

// 区域裁剪解码（坐标为图片像素坐标，自动与图片边界求交集）
async function cropAndDecodeQRCode(dataUrl, x, y, w, h) {
  try {
    const {ctx, width, height} = await loadImageToCtx(dataUrl);
    const cx = Math.max(0, Math.min(Math.round(x), width));
    const cy = Math.max(0, Math.min(Math.round(y), height));
    const cw = Math.min(Math.round(w), width - cx);
    const ch = Math.min(Math.round(h), height - cy);
    if (cw <= 0 || ch <= 0) return {error: '未检测到二维码'};
    return scanForQRCodes(ctx, cx, cy, cw, ch);
  } catch (e) {
    return {error: '图片加载失败'};
  }
}
