'use strict';

// Fill-in fields for emails: a drop-down that inserts at the cursor, and
// suggestions that pop up when you type "{{". Each field has a fallback for
// people we don't have the detail for ("there" when there's no first name).
const MERGE_FIELDS = [
  { code: '{{first_name|there}}', label: 'First name', hint: '“there” if unknown' },
  { code: '{{name|there}}', label: 'Full name', hint: '“there” if unknown' },
  { code: '{{last_name}}', label: 'Last name', hint: '' },
  { code: '{{email}}', label: 'Email address', hint: '' },
  { code: '{{business}}', label: 'Business name', hint: 'your business' },
  { code: '{{referral_link}}', label: 'Their referral link', hint: 'their own link to share' },
  { code: '{{referral_reward}}', label: 'Referral reward', hint: 'e.g. “They get 10% off…”' },
];

const fieldSelect = (target) => `<select class="ins-field" data-insfor="${target}" aria-label="Insert a fill-in field">
  <option value="">Insert field</option>${MERGE_FIELDS.map((f) => `<option value="${esc(f.code)}">${esc(f.label)}</option>`).join('')}</select>`;

// Put text at the cursor of an input/textarea (replacing `back` characters before it).
function insertAtCursor(el, text, back = 0) {
  const at = el.selectionStart ?? el.value.length, end = el.selectionEnd ?? at;
  el.value = el.value.slice(0, at - back) + text + el.value.slice(end);
  const pos = at - back + text.length;
  el.focus(); el.setSelectionRange(pos, pos);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

// Wire up the drop-downs and the "{{" suggestions inside `root`.
function bindFieldInserts(root) {
  $$('[data-insfor]', root).forEach((sel) => { sel.onchange = () => {
    const el = $(`[name="${sel.dataset.insfor}"]`, root);
    if (sel.value && el) insertAtCursor(el, sel.value);
    sel.value = '';
  }; });
  let pop = null, active = 0, target = null;
  const close = () => { pop?.remove(); pop = null; target = null; };
  const typed = (el) => { const m = el.value.slice(0, el.selectionStart).match(/\{\{\s*([a-z_]*)$/i); return m ? m : null; };
  const choose = (f) => { const m = typed(target); if (m) insertAtCursor(target, f.code, m[0].length); close(); };
  const show = (el) => {
    const m = typed(el);
    if (!m) return close();
    const q = m[1].toLowerCase();
    const list = MERGE_FIELDS.filter((f) => !q || f.label.toLowerCase().replace(/ /g, '_').includes(q) || f.code.includes(q));
    if (!list.length) return close();
    target = el; active = Math.min(active, list.length - 1);
    if (!pop) { pop = document.createElement('div'); pop.className = 'ins-pop'; pop.setAttribute('role', 'listbox'); el.parentNode.append(pop); }
    pop.style.top = `${el.offsetTop + el.offsetHeight + 4}px`; pop.style.left = `${el.offsetLeft}px`;
    pop.innerHTML = list.map((f, i) => `<button type="button" role="option" class="${i === active ? 'on' : ''}" data-i="${i}"><b>${esc(f.label)}</b>${f.hint ? `<span>${esc(f.hint)}</span>` : ''}</button>`).join('');
    $$('button', pop).forEach((b) => { b.onmousedown = (e) => { e.preventDefault(); choose(list[b.dataset.i]); }; });
    pop._list = list;
  };
  $$('input[name], textarea[name]', root).forEach((el) => {
    if (el.type !== 'text' && el.tagName !== 'TEXTAREA' && el.type !== '') return;
    el.addEventListener('input', () => show(el));
    el.addEventListener('blur', () => setTimeout(close, 120));
    el.addEventListener('keydown', (e) => {
      if (!pop || target !== el) return;
      const n = pop._list.length;
      if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % n; show(el); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + n) % n; show(el); }
      else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(pop._list[active]); }
      else if (e.key === 'Escape') close();
    });
  });
}
