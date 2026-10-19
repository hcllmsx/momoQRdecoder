#!/usr/bin/env node
/**
 * 发布前统一处理脚本
 *
 * 本地打包（build.ps1）与 CI 打包（.github/workflows/release.yml）都调用本脚本，
 * 保证两条打包路径行为完全一致。新增或修改发布前规则时，只改下面的 TRANSFORMS，
 * 不要在各自的打包脚本里重复实现。
 *
 * 用法：
 *   node tools/prepare-release.js <目标根目录> [--target chromium|firefox]
 *   node tools/prepare-release.js               # 省略则处理当前目录
 *
 * --target 区分打包平台：只在特定平台生效的规则（如从 Firefox 包中移除
 * Chromium 专属脚本）带 targets 字段；不带 targets 的规则两版都执行。
 * 省略 --target 时仅执行通用规则，不会动平台专属文件。
 *
 * 退出码：0=成功；非 0=存在未生效的必需规则，调用方应中止打包。
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ---------- 规则定义（唯一来源） ----------
// files:         相对目标根目录的路径，支持单级通配 *
// removeFiles:   要删除的文件（相对目标根目录），用于剔除平台专属文件
// pattern:       正则，需带 g；跨行匹配加 s
// replacement:   替换串，捕获组用 $1 $2
// targets:       仅在指定平台生效（chromium / firefox）；省略则两版都执行
// requireChange: true 表示内容/文件必须发生变化，否则视为异常并中止
//                （用于防止 DIAG 标记被误删后，静默发布出带诊断区的包）
const TRANSFORMS = [
  {
    name: '去除扩展名 dev 后缀',
    files: '_locales/*/messages.json',
    pattern: /("(?:extName|extTitle)"\s*:\s*\{\s*"message"\s*:\s*"[^"]*) dev(")/g,
    replacement: '$1$2',
    requireChange: false,
  },
  {
    name: '移除上传页环境诊断区',
    files: 'src/upload.html',
    pattern: /[ \t]*<!--\s*DIAG-BEGIN\s*-->.*?<!--\s*DIAG-END\s*-->[ \t]*\r?\n?/gs,
    replacement: '',
    requireChange: true,
  },
  {
    // chrome.offscreen 是 Chromium 专有 API，Firefox 未实现。
    // 该文件只被 Chromium 包的 background.js 通过 importScripts 加载；
    // 从 Firefox 包移除后，AMO 扫描不会再报 offscreen API 不支持的警告。
    name: '移除 Chromium 专属 offscreen 脚本',
    targets: ['firefox'],
    removeFiles: ['src/offscreenChrome.js'],
    requireChange: true,
  },
];

// ---------- 简易 glob（支持单级 *，避免引入 minimatch 依赖） ----------
function expandGlob(root, pattern) {
  let paths = [root];
  for (const seg of pattern.split('/')) {
    const next = [];
    for (const p of paths) {
      if (seg.includes('*')) {
        if (!fs.existsSync(p)) continue;
        const re = new RegExp('^' + seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$');
        for (const entry of fs.readdirSync(p)) {
          if (re.test(entry)) next.push(path.join(p, entry));
        }
      } else {
        next.push(path.join(p, seg));
      }
    }
    paths = next;
  }
  return paths.filter((p) => fs.existsSync(p) && fs.statSync(p).isFile());
}

// ---------- 主流程 ----------
const argv = process.argv.slice(2);
let target = 'all';
const positional = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--target') {
    target = argv[++i] || '';
  } else if (argv[i].startsWith('--target=')) {
    target = argv[i].slice('--target='.length);
  } else {
    positional.push(argv[i]);
  }
}
if (!['all', 'chromium', 'firefox'].includes(target)) {
  console.error('[错误] --target 仅支持 chromium / firefox，当前值: ' + target);
  process.exit(1);
}

const root = path.resolve(positional[0] || process.cwd());
if (!fs.existsSync(root)) {
  console.error('[错误] 目标根目录不存在: ' + root);
  process.exit(1);
}

let failed = false;
let changed = 0;

for (const t of TRANSFORMS) {
  // 平台专属规则：--target 省略（all）时跳过，避免误删另一版的文件
  if (t.targets && (target === 'all' || !t.targets.includes(target))) {
    console.log('[跳过] ' + t.name + '（不适用于 ' + target + '）');
    continue;
  }

  if (t.removeFiles) {
    for (const rel of t.removeFiles) {
      const file = path.join(root, rel);
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
        changed++;
        console.log('[OK] ' + t.name + '：' + rel);
      } else if (t.requireChange) {
        console.error('[错误] ' + t.name + '：' + rel + ' 不存在，请检查文件名/规则是否仍然匹配');
        failed = true;
      } else {
        console.log('[跳过] ' + t.name + '：' + rel + '（不存在）');
      }
    }
    continue;
  }

  const files = expandGlob(root, t.files);
  if (files.length === 0) {
    console.error('[错误] ' + t.name + '：未匹配到任何文件 (' + t.files + ')');
    failed = true;
    continue;
  }
  for (const file of files) {
    const rel = path.relative(root, file);
    const before = fs.readFileSync(file, 'utf8');
    const after = before.replace(t.pattern, t.replacement);
    if (after === before) {
      if (t.requireChange) {
        console.error('[错误] ' + t.name + '：' + rel + ' 内容未变化，请检查标记/规则是否仍然匹配');
        failed = true;
      } else {
        console.log('[跳过] ' + t.name + '：' + rel + '（无变化）');
      }
      continue;
    }
    fs.writeFileSync(file, after, 'utf8');
    changed++;
    console.log('[OK] ' + t.name + '：' + rel);
  }
}

if (failed) {
  console.error('[错误] 存在未生效的必需规则，已中止。请修复后重新打包。');
  process.exit(1);
}

console.log('发布前处理完成，共修改 ' + changed + ' 个文件。');
