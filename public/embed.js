/* Rilly embed: put a Rilly sign-up page on any website, inline or as a popup.
 *
 * Inline:  <iframe data-rilly src="https://getrilly.com/f/your-page?embed=1" style="width:100%;border:0" title="Sign up"></iframe>
 *          <script src="https://getrilly.com/embed.js" async></script>
 * Popup:   <script src="https://getrilly.com/embed.js" data-popup="https://getrilly.com/f/your-page" data-delay="8" async></script>
 *          data-delay: seconds before it opens (default 8); data-trigger="exit" opens it when the visitor moves to leave;
 *          data-every: days before showing it again to someone who closed it (default 7).
 */
(function () {
  var script = document.currentScript;
  if (!script) return;
  var origin;
  try { origin = new URL(script.src).origin; } catch (e) { return; }

  // Inline frames grow to fit their content.
  window.addEventListener('message', function (e) {
    if (e.origin !== origin || !e.data || typeof e.data.rillyEmbed !== 'number') return;
    var frames = document.querySelectorAll('iframe[data-rilly], iframe.rilly-popup-frame');
    for (var i = 0; i < frames.length; i++) {
      if (frames[i].contentWindow === e.source) frames[i].style.height = Math.min(Math.max(120, e.data.rillyEmbed), 4000) + 'px';
    }
  });

  var popup = script.getAttribute('data-popup');
  if (!popup) return;
  var url;
  try { url = new URL(popup, origin); } catch (e) { return; }
  if (url.origin !== origin) return;
  url.searchParams.set('embed', '1');
  var key = 'rillyPopup:' + url.pathname;
  var every = Math.max(0, Number(script.getAttribute('data-every') || 7));
  try { var last = Number(localStorage.getItem(key) || 0); if (last && Date.now() - last < every * 864e5) return; } catch (e) { /* show it */ }

  var shown = false;
  function show() {
    if (shown) return; shown = true;
    var wrap = document.createElement('div');
    wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true'); wrap.setAttribute('aria-label', 'Sign up');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:16px;opacity:0;transition:opacity .2s';
    var box = document.createElement('div');
    box.style.cssText = 'position:relative;width:100%;max-width:520px;max-height:90vh;overflow:auto;background:#fff;border-radius:16px;box-shadow:0 24px 70px rgba(0,0,0,.3)';
    var close = document.createElement('button');
    close.type = 'button'; close.setAttribute('aria-label', 'Close'); close.innerHTML = '&times;';
    close.style.cssText = 'position:absolute;top:8px;right:10px;z-index:2;width:36px;height:36px;border:0;border-radius:50%;background:rgba(255,255,255,.9);font:28px/1 system-ui;cursor:pointer;color:#334155';
    var frame = document.createElement('iframe');
    frame.className = 'rilly-popup-frame'; frame.title = 'Sign up'; frame.src = url.href;
    frame.style.cssText = 'display:block;width:100%;height:420px;border:0;border-radius:16px';
    function done() {
      try { localStorage.setItem(key, String(Date.now())); } catch (e) { /* fine */ }
      wrap.remove(); document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') done(); }
    close.onclick = done;
    wrap.addEventListener('click', function (e) { if (e.target === wrap) done(); });
    document.addEventListener('keydown', onKey);
    box.appendChild(close); box.appendChild(frame); wrap.appendChild(box); document.body.appendChild(wrap);
    requestAnimationFrame(function () { wrap.style.opacity = '1'; close.focus(); });
  }
  if (script.getAttribute('data-trigger') === 'exit') {
    document.addEventListener('mouseout', function (e) { if (!e.relatedTarget && e.clientY <= 0) show(); });
    setTimeout(show, 45000); // phones have no "leaving" signal: show after a while instead
  } else {
    setTimeout(show, Math.max(0, Number(script.getAttribute('data-delay') || 8)) * 1000);
  }
})();
