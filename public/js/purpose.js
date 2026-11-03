'use strict';

// What a funnel or website is for. Shown as a tag you can tap to change.
const PURPOSES = {
  leads: { label: 'Collect leads', icon: 'magnet', hint: 'Get names and emails, e.g. a free guide' },
  sales: { label: 'Sell a product', icon: 'card', hint: 'Take payment for something' },
  bookings: { label: 'Book calls', icon: 'clock', hint: 'Consultations, appointments, quotes' },
  newsletter: { label: 'Grow newsletter', icon: 'inbox', hint: 'Subscribers for your letter or podcast' },
  upsell: { label: 'Upsell buyers', icon: 'trend', hint: 'Offer more to people who just bought' },
  info: { label: 'Inform', icon: 'info', hint: 'Show who you are and what you do' },
};
// Until one is chosen, guess from the pages: a pricing card means sales, a form means leads.
function guessPurpose(g) {
  if (g.purpose) return { key: g.purpose, guessed: false };
  const blocks = (g.pages || g.steps || []).flatMap((p) => p.blocks || []);
  const key = g.kind === 'website' ? 'info' : blocks.some((b) => b.type === 'pricing') ? 'sales' : blocks.some((b) => b.type === 'form') ? 'leads' : '';
  return { key, guessed: true };
}
function purposeTag(g) {
  const { key, guessed } = guessPurpose(g);
  const p = PURPOSES[key];
  return `<button type="button" class="purpose ${p ? '' : 'unset'}" data-purpose="${g.id}" title="${p ? `${guessed ? 'Our guess: ' : ''}${p.hint}. Tap to change` : 'Tap to say what this is for'}">
    ${p ? `${icon(p.icon)} ${esc(p.label)}` : `${icon('plus')} Purpose`}</button>`;
}
// Tap a tag → choose → saved. `after` re-renders the page.
function bindPurposeTags(groups, after) {
  $$('[data-purpose]').forEach((b) => { b.onclick = async (e) => {
    e.preventDefault(); e.stopPropagation();
    const g = groups.find((x) => String(x.id) === b.dataset.purpose);
    const cur = guessPurpose(g).key;
    const v = await modal(`What is “${g.name}” for?`, `<div class="choices">${Object.entries(PURPOSES).map(([k, p]) => `
      <label class="choice"><input type="radio" name="purpose" value="${k}" ${k === cur ? 'checked' : ''} hidden><span class="ci">${icon(p.icon)}</span><span><b>${p.label}</b><small>${p.hint}</small></span></label>`).join('')}</div>`, { submit: 'Save' });
    if (!v?.purpose) return;
    await api('PUT', `/api/funnels/${g.id}`, { purpose: v.purpose });
    g.purpose = v.purpose;
    toast(`Marked as “${PURPOSES[v.purpose].label}”`);
    after?.();
  }; });
}
