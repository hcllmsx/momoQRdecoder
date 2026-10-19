// offscreenChrome.js —— Chromium 专属的 offscreen document 创建逻辑。
// 单独成文件的原因：chrome.offscreen 是 Chromium 专有 API，Firefox 未实现。
// 若把调用直接写在 background.js 里，Firefox 包会被 AMO 静态扫描出
// "offscreen.xxx is not supported" 警告。因此：
//   - Chromium 包：保留本文件，background.js 启动时 importScripts 加载；
//   - Firefox 包：打包阶段由 tools/prepare-release.js 删除本文件，
//     background.js 检测不到 self.__momoCreateChromeOffscreen，自动改用
//     后台事件页内的隐藏 iframe（见 createFirefoxOffscreenFrame）。
// 由于只在 Chromium 包中存在，本文件可以放心直接使用 chrome.offscreen。
self.__momoCreateChromeOffscreen = async function (justification) {
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
      justification: justification
    });
  } catch (e) {
    // "文档已存在"等场景：若创建失败因文档已在，视为就绪
    if (!(e && /already|exists/i.test(String(e.message || e)))) throw e;
  }
};
