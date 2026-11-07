/* Rilly website chat. Add to any page:
   <script src="https://<rilly>/chat.js" data-rilly-chat="<business number>" defer></script> */
(function () {
  'use strict';
  var me = document.currentScript || document.querySelector('script[data-rilly-chat]');
  if (!me || window.__rillyChat) return;
  window.__rillyChat = 1;
  var acct = me.getAttribute('data-rilly-chat');
  var api = new URL(me.src).origin + '/chat/' + encodeURIComponent(acct);
  var KEY = 'rillyChat:' + acct;
  var store = { get: function () { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } },
    set: function (v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* private mode */ } } };

  function req(method, path, body) {
    return fetch(api + path, { method: method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Something went wrong'); return j; }); });
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  req('GET', '/config').then(function (cfg) {
    if (!cfg.on) return;
    var host = document.createElement('div');
    host.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483000';
    document.body.appendChild(host);
    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    var c = cfg.color;
    root.innerHTML = '<style>' +
      '*{box-sizing:border-box;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}' +
      '.bub{width:58px;height:58px;border-radius:50%;background:' + c + ';border:0;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.2);display:grid;place-items:center;transition:transform .15s}' +
      '.bub:hover{transform:scale(1.06)}.bub svg{width:28px;height:28px;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}' +
      '.dot{position:absolute;top:2px;right:2px;width:14px;height:14px;border-radius:50%;background:#ef4444;border:2px solid #fff;display:none}' +
      '.win{position:absolute;right:0;bottom:72px;width:360px;max-width:calc(100vw - 36px);height:520px;max-height:calc(100vh - 110px);background:#fff;border-radius:18px;box-shadow:0 18px 50px rgba(0,0,0,.22);display:none;flex-direction:column;overflow:hidden}' +
      '.win.open{display:flex}.hd{background:' + c + ';color:#fff;padding:16px 18px}.hd b{display:block;font-size:16px}.hd span{display:block;font-size:13px;line-height:1.4;margin-top:3px;opacity:.9}' +
      '.x{float:right;background:none;border:0;color:#fff;font-size:22px;line-height:1;cursor:pointer;opacity:.85}' +
      '.body{flex:1;overflow:auto;padding:14px;background:#f6f7f9;display:flex;flex-direction:column;gap:8px}' +
      '.m{max-width:82%;padding:9px 12px;border-radius:14px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}' +
      '.m.in{align-self:flex-end;background:' + c + ';color:#fff;border-bottom-right-radius:4px}.m.out{align-self:flex-start;background:#fff;color:#1f2328;border:1px solid #e5e7eb;border-bottom-left-radius:4px}' +
      '.note{font-size:12px;color:#6b7280;text-align:center;margin:4px 0}' +
      'form{padding:10px;border-top:1px solid #eee;display:grid;gap:8px;background:#fff}input,textarea{width:100%;border:1px solid #d6d9de;border-radius:10px;padding:9px 11px;font-size:14px;outline:none}' +
      'input:focus,textarea:focus{border-color:' + c + '}textarea{resize:none;height:64px}.row{display:flex;gap:8px}.row textarea{height:42px}' +
      '.send{background:' + c + ';color:#fff;border:0;border-radius:10px;padding:0 16px;font-weight:600;font-size:14px;cursor:pointer;min-height:42px}.err{color:#b91c1c;font-size:12px;min-height:0}' +
      '</style>' +
      '<div class="win" role="dialog" aria-label="Chat with ' + esc(cfg.name) + '"><div class="hd"><button class="x" aria-label="Close">×</button><b>' + esc(cfg.name) + '</b><span>' + esc(cfg.greeting) + '</span></div>' +
      '<div class="body"></div><form></form></div>' +
      '<button class="bub" aria-label="Chat with ' + esc(cfg.name) + '"><svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z"/></svg></button><span class="dot"></span>';
    var $ = function (s) { return root.querySelector(s); };
    var win = $('.win'), body = $('.body'), form = $('form'), dot = $('.dot');
    var st = store.get(), last = 0, timer = null, seen = st.seen || 0;

    function draw(list) {
      list.forEach(function (m) {
        if (m.id <= last) return;
        last = m.id;
        var d = document.createElement('div');
        d.className = 'm ' + m.direction;
        d.textContent = m.body;
        body.appendChild(d);
      });
      body.scrollTop = body.scrollHeight;
    }
    function startForm() {
      form.innerHTML = '<input name="name" placeholder="Your name" autocomplete="name"><input name="email" type="email" required placeholder="Your email (so we can reply)" autocomplete="email">' +
        '<textarea name="message" required placeholder="How can we help?"></textarea><div class="err"></div><button class="send">Start chat</button>';
      body.innerHTML = '<div class="note">We’ll reply here, or by email if you’ve gone.</div>';
    }
    function chatForm() {
      form.innerHTML = '<div class="row"><textarea name="message" required placeholder="Write a message…" aria-label="Message"></textarea><button class="send">Send</button></div><div class="err"></div>';
      var ta = form.querySelector('textarea');
      ta.onkeydown = function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit ? form.requestSubmit() : form.onsubmit(e); } };
    }
    function poll() {
      if (!st.token) return;
      req('GET', '/poll?token=' + encodeURIComponent(st.token) + '&after=' + last).then(function (r) {
        draw(r.messages);
        var replies = r.messages.filter(function (m) { return m.direction === 'out'; });
        if (replies.length && !win.classList.contains('open')) dot.style.display = 'block';
      }).catch(function (e) { if (/new chat/.test(e.message)) { st = {}; store.set(st); startForm(); } });
    }
    function open(on) {
      win.classList.toggle('open', on);
      if (on) { dot.style.display = 'none'; var f = form.querySelector('textarea, input'); if (f) f.focus(); }
      clearInterval(timer);
      timer = setInterval(poll, on ? 4000 : 30000);
    }
    form.onsubmit = function (e) {
      e.preventDefault();
      var v = {}; Array.prototype.forEach.call(form.elements, function (el) { if (el.name) v[el.name] = el.value; });
      var btn = form.querySelector('.send'); btn.disabled = true;
      var p = st.token ? req('POST', '/send', { token: st.token, message: v.message, after: last })
        : req('POST', '/start', { name: v.name, email: v.email, message: v.message, page: location.href });
      p.then(function (r) {
        if (r.token) { st = { token: r.token }; store.set(st); body.innerHTML = ''; chatForm(); }
        else form.querySelector('textarea').value = '';
        draw(r.messages);
      }).catch(function (err) { form.querySelector('.err').textContent = err.message; })
        .then(function () { btn.disabled = false; var t = form.querySelector('textarea'); if (t) t.focus(); });
    };
    $('.bub').onclick = function () { open(!win.classList.contains('open')); };
    $('.x').onclick = function () { open(false); };
    if (st.token) { chatForm(); poll(); } else startForm();
    timer = setInterval(poll, 30000);
    void seen;
  }).catch(function () { /* chat unavailable: show nothing */ });
})();
