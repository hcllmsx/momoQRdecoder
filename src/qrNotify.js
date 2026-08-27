// 页面右上角二维码识别结果悬浮通知
(function(){
  if (window.__momoqrdecoder_notify) return;
  function showQRNotify(payload) {
    // 清理旧的
    if (window.__momoqrdecoder_notify) window.__momoqrdecoder_notify.remove();
    const box = document.createElement('div');
    box.style = 'position:fixed;top:20px;right:24px;z-index:999999;font-size:15px;background:#fff;box-shadow:0 2px 16px rgba(0,0,0,0.16);border-radius:8px;padding:16px 18px 14px 18px;min-width:260px;max-width:420px;color:#222;line-height:1.7;';
    box.style.transition = 'opacity 0.25s';
    box.id = '__momoqrdecoder_notify';
    let html = '';
    if (payload.error) {
      html += `<div style='font-weight:bold;color:#e53935;font-size:16px;margin-bottom:6px;'>二维码识别失败</div>`;
      html += `<div>${payload.error}</div>`;
    } else if (payload.multi) {
      html += `<div style='font-weight:bold;color:#2196f3;font-size:16px;margin-bottom:6px;'>识别到多个二维码</div>`;
      payload.multi.forEach((text,idx)=>{
        html += `<div style='margin-bottom:7px;'><span style='color:#666;font-size:13px;'>二维码${idx+1}：</span><span style='color:#222;'>${text}</span></div>`;
      });
    } else {
      html += `<div style='font-weight:bold;color:#4caf50;font-size:16px;margin-bottom:6px;'>二维码内容</div>`;
      html += `<div style='word-break:break-all;'>${payload.data}</div>`;
    }
    box.innerHTML = html;
    // 操作按钮
    let btns = document.createElement('div');
    btns.style = 'margin-top:10px;text-align:right;';
    // 复制按钮
    let btnCopy = document.createElement('button');
    btnCopy.textContent = '复制内容';
    btnCopy.className = 'btn';
    btnCopy.style = 'margin-right:10px;background:#2196f3;color:#fff;border:none;padding:5px 14px;border-radius:4px;cursor:pointer;';
    btnCopy.onclick = ()=>{
      let txt = payload.multi ? payload.multi.join('\n') : (payload.data||payload.error||'');
      navigator.clipboard.writeText(txt);
      btnCopy.textContent = '已复制!';
      setTimeout(()=>btnCopy.textContent='复制内容', 1200);
    };
    btns.appendChild(btnCopy);
    // 新标签页打开按钮（只对单个二维码且内容为网址时）
    let url = payload.data;
    if (url && /^https?:\/\//i.test(url)) {
      let btnOpen = document.createElement('button');
      btnOpen.textContent = '新标签页打开';
      btnOpen.className = 'btn';
      btnOpen.style = 'background:#4caf50;color:#fff;border:none;padding:5px 14px;border-radius:4px;cursor:pointer;';
      btnOpen.onclick = ()=>window.open(url, '_blank');
      btns.appendChild(btnOpen);
    }
    box.appendChild(btns);
    // 关闭按钮
    let btnClose = document.createElement('span');
    btnClose.textContent = '×';
    btnClose.style = 'position:absolute;top:7px;right:12px;font-size:21px;color:#888;cursor:pointer;';
    btnClose.onclick = ()=>box.remove();
    box.appendChild(btnClose);
    document.body.appendChild(box);
    window.__momoqrdecoder_notify = box;
    setTimeout(()=>{
      if (window.__momoqrdecoder_notify) window.__momoqrdecoder_notify.style.opacity = '1';
    }, 50);
    // 自动消失
    setTimeout(()=>{
      if (window.__momoqrdecoder_notify) window.__momoqrdecoder_notify.remove();
    }, 12000);
  }
  // 允许 background.js 直接发消息
  chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
    if (msg && msg.__momoqrdecoder_notify) {
      showQRNotify(msg.__momoqrdecoder_notify);
    }
  });
  window.addEventListener('message', function(e) {
    if (e.data && e.data.__momoqrdecoder_notify) {
      showQRNotify(e.data.__momoqrdecoder_notify);
    }
  });
})();
