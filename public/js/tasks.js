'use strict';

// Today (top of the dashboard) and tasks (on each person's page): one short
// list of what needs you now, with a quick way to add a to-do.

const todayTime = (s) => new Date(s).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const taskDueText = (t) => {
  const d = new Date(t.due_at), now = new Date();
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(now)) / 864e5);
  return diff < 0 ? `<span class="late">${diff === -1 ? 'yesterday' : `${-diff} days late`}</span>` : diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : fmtDate(t.due_at);
};
const taskRowHtml = (t, withPerson = true) => `<li class="task ${t.done ? 'done' : ''}" data-task="${t.id}">
  <button type="button" class="tick" data-tick aria-label="${t.done ? 'Mark as not done' : 'Mark as done'}">${t.done ? icon('check') : ''}</button>
  <span class="tt">${esc(t.title)}${withPerson && t.person && !t.title.includes(t.person.name) ? ` · <a href="#/people/${t.person.id}">${esc(t.person.name)}</a>` : ''}${withPerson && t.person && t.title.includes(t.person.name) ? ` <a href="#/people/${t.person.id}" class="small">open</a>` : ''}</span>
  <span class="muted small">${t.done ? 'done' : taskDueText(t)}</span>
  <button type="button" class="x" data-taskdel aria-label="Delete task">${icon('x')}</button></li>`;
const taskAddHtml = (placeholder = 'Add a task, e.g. Call Sam about the quote', narrow = false) => `<form class="task-add${narrow ? ' narrow' : ''}" data-taskadd>
  <input name="title" placeholder="${esc(placeholder)}" aria-label="New task" required maxlength="300">
  <input name="due" type="date" aria-label="Due" title="When (empty = today)">
  <button class="btn sm">Add</button></form>`;

// Ticking, deleting (with undo) and adding, for any list of tasks inside `root`.
function bindTaskList(root, { contactId = null, reload }) {
  $$('[data-tick]', root).forEach((b) => { b.onclick = async () => {
    const li = b.closest('[data-task]'), done = !li.classList.contains('done');
    li.classList.toggle('done', done);
    await api('PUT', `/api/tasks/${li.dataset.task}`, { done });
    if (done) undoToast('Done', async () => { await api('PUT', `/api/tasks/${li.dataset.task}`, { done: false }); reload(); });
    setTimeout(reload, done ? 600 : 0);
  }; });
  $$('[data-taskdel]', root).forEach((b) => { b.onclick = () => {
    const li = b.closest('[data-task]');
    deleteWithUndo('Task deleted', { url: `/api/tasks/${li.dataset.task}`, hide: () => { li.hidden = true; return () => { li.hidden = false; }; }, done: () => {} });
  }; });
  const add = $('[data-taskadd]', root);
  if (add) add.onsubmit = async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(add));
    try { await api('POST', '/api/tasks', { title: v.title, due: v.due, contact_id: contactId }); reload(); } catch (err) { toast(err.message, true); }
  };
}

async function loadTodayCard() {
  const box = $('[data-today]');
  if (!box) return;
  let t;
  try { t = await api('GET', '/api/today'); } catch { box.hidden = true; return; }
  const items = [];
  if (t.unread) items.push(`<a class="today-chip" href="#/inbox">${icon('mail')} ${t.unread} conversation${t.unread === 1 ? '' : 's'} waiting for a reply</a>`);
  if (t.reviews) items.push(`<a class="today-chip" href="#/people/testimonials">${icon('quote')} ${t.reviews} new review${t.reviews === 1 ? '' : 's'} to approve for your pages</a>`);
  t.bookings.forEach((b) => items.push(`<a class="today-chip" href="#/calendar">${icon('calendar')} ${esc(todayTime(b.starts_at))} call with ${esc(b.name)}</a>`));
  t.invoices.forEach((i) => items.push(`<a class="today-chip warn" href="#/products/invoices">${icon('alert')} Invoice ${esc(i.number || '')} ${i.who ? `for ${esc(i.who)} ` : ''}is overdue (${esc(fmtMoney(i.total_cents, i.currency))})</a>`));
  if (t.leads.length) items.push(`<span class="today-chip">${icon('people')} <span>New in the last day: ${t.leads.slice(0, 4).map((p) => `<a href="#/people/${p.id}">${esc(p.name)}</a>`).join(', ')}${t.leads.length > 4 ? ` and ${t.leads.length - 4} more` : ''}</span></span>`);
  box.hidden = false;
  box.innerHTML = `<div class="row" style="justify-content:space-between"><h2 style="margin:0">Today</h2>${t.later ? `<span class="muted small">${t.later} more task${t.later === 1 ? '' : 's'} coming up</span>` : ''}</div>
    ${items.length ? `<div class="today-chips">${items.join('')}</div>` : ''}
    ${t.tasks.length ? `<ul class="tasks">${t.tasks.map((x) => taskRowHtml(x)).join('')}</ul>` : items.length ? '' : '<p class="muted small" style="margin:8px 0">Nothing needs you right now.</p>'}
    ${taskAddHtml()}`;
  bindTaskList(box, { reload: loadTodayCard });
}

// The tasks card on a person's page.
async function loadPersonTasks(personId) {
  const box = $('[data-persontasks]');
  if (!box) return;
  const list = await api('GET', `/api/tasks?contact_id=${personId}`).catch(() => []);
  box.innerHTML = `<h2>Tasks</h2>${list.length ? `<ul class="tasks">${list.map((x) => taskRowHtml(x, false)).join('')}</ul>` : ''}${taskAddHtml('Add a task for this person', true)}`;
  bindTaskList(box, { contactId: Number(personId), reload: () => loadPersonTasks(personId) });
}
