// 页面右上角二维码识别结果悬浮通知（由 background.js 按需注入）
// 注意：所有动态内容一律使用 textContent 渲染，禁止拼进 innerHTML（防 XSS）
(function () {
  if (window.__momoqrdecoder_notify_installed) return;
  window.__momoqrdecoder_notify_installed = true;

  const BTN_STYLE = 'background:#2196f3;color:#fff;border:none;padding:5px 14px;border-radius:4px;cursor:pointer;font-size:14px;';

  // 复制文本：优先 Clipboard API，失败时回退 execCommand（content script 中常见）
  function copyText(text, onDone, onFail) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(onDone).catch(function () {
        fallbackCopy(text, onDone, onFail);
      });
    } else {
      fallbackCopy(text, onDone, onFail);
    }
  }

  function fallbackCopy(text, onDone, onFail) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      if (ok) { onDone(); } else { onFail(); }
    } catch (e) {
      onFail();
    }
  }

  function flashBtn(btn, okText) {
    btn.textContent = okText;
    setTimeout(function () { btn.textContent = '复制内容'; }, 1200);
  }

  function showQRNotify(payload) {
    // 清理旧通知
    if (window.__momoqrdecoder_notify) window.__momoqrdecoder_notify.remove();

    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;top:20px;right:24px;z-index:999999;font-size:15px;background:#fff;box-shadow:0 2px 16px rgba(0,0,0,0.16);border-radius:8px;padding:16px 18px 14px 18px;min-width:260px;max-width:420px;color:#222;line-height:1.7;opacity:0;transition:opacity 0.25s;';
    box.id = '__momoqrdecoder_notify';

    // 标题
    const title = document.createElement('div');
    title.style.cssText = 'font-weight:bold;font-size:16px;margin-bottom:6px;';
    if (payload.error) {
      title.textContent = '二维码识别失败';
      title.style.color = '#e53935';
      const body = document.createElement('div');
      body.textContent = payload.error;
      box.appendChild(title);
      box.appendChild(body);
    } else if (payload.multi) {
      title.textContent = '识别到多个二维码';
      title.style.color = '#2196f3';
      box.appendChild(title);
      payload.multi.forEach(function (text, idx) {
        const row = document.createElement('div');
        row.style.cssText = 'margin-bottom:7px;';
        const label = document.createElement('span');
        label.style.cssText = 'color:#666;font-size:13px;';
        label.textContent = '二维码' + (idx + 1) + '：';
        const content = document.createElement('span');
        content.style.color = '#222';
        content.textContent = text;
        row.appendChild(label);
        row.appendChild(content);
        box.appendChild(row);
      });
    } else {
      title.textContent = '二维码内容';
      title.style.color = '#4caf50';
      const body = document.createElement('div');
      body.style.cssText = 'word-break:break-all;';
      body.textContent = payload.data || '';
      box.appendChild(title);
      box.appendChild(body);
    }

    // 操作按钮
    const btns = document.createElement('div');
    btns.style.cssText = 'margin-top:10px;text-align:right;';

    const btnCopy = document.createElement('button');
    btnCopy.textContent = '复制内容';
    btnCopy.style.cssText = 'margin-right:10px;' + BTN_STYLE;
    btnCopy.onclick = function () {
      const txt = payload.multi ? payload.multi.join('\n') : (payload.data || payload.error || '');
      copyText(txt, function () { flashBtn(btnCopy, '已复制!'); }, function () { flashBtn(btnCopy, '复制失败'); });
    };
    btns.appendChild(btnCopy);

    // 新标签页打开（仅单个结果且为 http(s) 网址）
    const url = payload.data;
    if (url && /^https?:\/\//i.test(url)) {
      const btnOpen = document.createElement('button');
      btnOpen.textContent = '新标签页打开';
      btnOpen.style.cssText = 'background:#4caf50;color:#fff;border:none;padding:5px 14px;border-radius:4px;cursor:pointer;font-size:14px;';
      btnOpen.onclick = function () { window.open(url, '_blank'); };
      btns.appendChild(btnOpen);
    }
    box.appendChild(btns);

    // 关闭按钮
    const btnClose = document.createElement('span');
    btnClose.textContent = '×';
    btnClose.style.cssText = 'position:absolute;top:7px;right:12px;font-size:21px;color:#888;cursor:pointer;';
    btnClose.onclick = function () { box.remove(); };
    box.appendChild(btnClose);

    document.body.appendChild(box);
    window.__momoqrdecoder_notify = box;
    // 淡入
    requestAnimationFrame(function () { box.style.opacity = '1'; });
    // 自动淡出消失
    setTimeout(function () {
      if (window.__momoqrdecoder_notify === box) {
        box.style.opacity = '0';
        setTimeout(function () { box.remove(); }, 300);
      }
    }, 12000);
  }

  // 接收 background.js 的消息
  chrome.runtime.onMessage.addListener(function (msg) {
    if (msg && msg.__momoqrdecoder_notify) {
      showQRNotify(msg.__momoqrdecoder_notify);
    }
  });
})();
