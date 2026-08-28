# momoQRdecoder · 默默二维码解码器

Chrome / Edge 浏览器二维码自动识别扩展（Manifest V3）。

> [!IMPORTANT]
> 本扩展最初名为 **QRdecoder**（仓库：https://github.com/hcllmsx/qrdecoder ），现更名为 **momoQRdecoder · 默默二维码解码器**，仓库迁移至 https://github.com/hcllmsx/momoQRdecoder 。

## 功能

- 一键截图识别当前网页二维码
- 延迟 3 秒扫描，适配悬停后才出现的二维码
- 手动框选任意区域识别
- 同屏多二维码分别识别，自动提示重复内容
- 结果一键复制，网址可直接新标签页打开
- 双引擎识别：jsQR + 微信 WeChatQRCode，支持美化/艺术二维码

## 使用

1. 安装后点击浏览器工具栏图标
2. 选择「立即扫描」「延迟扫描(3秒)」或「区域截图」
3. 结果展示在弹窗或网页右上角悬浮窗，支持复制、新标签页打开

## 开发者说明：版本号更新

版本号**唯一来源**是仓库根目录的 `VERSION` 文件（格式：`x.y.z` 或 `x.y.z.w`，如 `1.2.0`）。

> [!IMPORTANT]
> 修改了根目录 `VERSION` 文件中的版本号后，**必须运行一次 `build.cmd`**，它会自动把新版本号同步到 `manifest.json` 并完成打包。只有完成这一步，版本号才一致，**才能提交并推送到 GitHub**；否则推送后仓库内 `manifest.json` 的版本号仍是旧值。

## 常见问题

- **美化二维码识别失败？** 微信引擎首次加载约 5MB WASM 与模型，稍慢属正常；浏览器低于 Chrome 109 时自动降级为仅 jsQR。
- **悬浮二维码扫不到？** 使用「延迟扫描」，确保倒计时内二维码已完全显示。

## 致谢

- [jsQR](https://github.com/cozmo/jsQR) — 标准二维码识别库
- [OpenCV.js](https://opencv.org/) — 图像处理与 WASM 运行环境
- [WeChatQRCode](https://github.com/opencv/opencv_contrib/tree/master/modules/wechat_qrcode)（OpenCV contrib）— 美化/艺术二维码识别引擎
