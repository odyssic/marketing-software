'use strict';

// ---------------- Courses (members areas) ----------------
// Lesson options on a members-area page (module, when it opens), and the
// course bits of the members panel (progress, "lesson is ready" emails, the
// customer login page). Used by websites.js.

function courseIsLesson(p, isEntry) { return !isEntry && p.settings.lesson !== false; }

function courseOpensText(st) {
  if (st.dripDate) return `opens ${fmtDate(`${st.dripDate}T12:00:00Z`)}`;
  if (Number(st.dripDays) > 0) return `opens day ${Number(st.dripDays)}`;
  return '';
}

// Little labels for the pages table.
function coursePagePills(p, isEntry) {
  if (isEntry) return '';
  if (!courseIsLesson(p, false)) return ' <span class="pill">page</span>';
  const opens = courseOpensText(p.settings);
  return `${p.settings.module ? ` <span class="pill">${esc(p.settings.module)}</span>` : ''}${opens ? ` <span class="pill warn">${icon('clock')} ${esc(opens)}</span>` : ''}`;
}

// Extra fields in a page's settings box.
function courseLessonFieldsHtml(p, isEntry) {
  if (isEntry) return '<p class="hint">This is the course home. Members see their progress and a “Continue” button here.</p>';
  const st = p.settings;
  const when = st.dripDate ? 'date' : Number(st.dripDays) > 0 ? 'days' : 'now';
  return `<label class="check"><input type="checkbox" name="lesson" ${st.lesson !== false ? 'checked' : ''}> This is a lesson <span class="hint">(members tick it off when they finish)</span></label>
    <div data-lessonopts>
      <label class="f">Module <span class="hint">optional, groups lessons in the course menu, e.g. “Week 1”</span><input name="module" value="${esc(st.module || '')}" maxlength="80"></label>
      <label class="f">Opens<select name="opens">
        <option value="now" ${when === 'now' ? 'selected' : ''}>Right away</option>
        <option value="days" ${when === 'days' ? 'selected' : ''}>Some days after they join</option>
        <option value="date" ${when === 'date' ? 'selected' : ''}>On a date</option></select></label>
      <label class="f" data-opens="days">Days after they join<input name="dripDays" type="number" min="1" max="3650" value="${esc(Number(st.dripDays) || 7)}"></label>
      <label class="f" data-opens="date">Date<input name="dripDate" type="date" value="${esc(st.dripDate || '')}"></label>
    </div>`;
}

// Show only the fields that apply (call once the box is open).
function courseBindLessonFields() {
  const box = $('.modal-bg [data-lessonopts]');
  if (!box) return;
  const lesson = $('.modal-bg input[name=lesson]');
  const opens = $('select[name=opens]', box);
  const sync = () => {
    box.style.display = lesson.checked ? '' : 'none';
    $$('[data-opens]', box).forEach((el) => { el.style.display = el.dataset.opens === opens.value ? '' : 'none'; });
  };
  lesson.onchange = sync; opens.onchange = sync; sync();
}

// The saved settings from the box's values.
function courseLessonSettings(v, settings, isEntry) {
  if (isEntry) return settings;
  const next = { ...settings, lesson: Boolean(v.lesson), module: String(v.module || '').trim().slice(0, 80) };
  delete next.dripDays; delete next.dripDate;
  if (v.lesson && v.opens === 'days' && Number(v.dripDays) > 0) next.dripDays = Math.min(3650, Math.floor(Number(v.dripDays)));
  if (v.lesson && v.opens === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(v.dripDate || '')) next.dripDate = v.dripDate;
  return next;
}

// "4 of 12 lessons" for one member.
function courseMemberProgress(course, memberId) {
  if (!course?.lessons) return '';
  const done = course.progress[memberId] || 0;
  return `<div class="crs-mini" title="${done} of ${course.lessons} lessons done"><span><i style="width:${Math.round((done / course.lessons) * 100)}%"></i></span>${done} of ${course.lessons}</div>`;
}

// Course settings card under the members list.
function courseSettingsCardHtml(course) {
  return `<section class="card" style="margin-top:16px"><h2 style="margin:0 0 4px">Course</h2>
    <label class="check"><input type="checkbox" data-dripmail ${course.drip_emails ? 'checked' : ''}> Email members when a lesson opens <span class="hint">(for lessons that open later)</span></label>
    ${course.dripped ? '' : '<p class="muted small" style="margin:4px 0 0">All lessons open right away. To release one later, open a lesson’s ⋯ menu and choose when it opens.</p>'}
    <div class="row" style="margin-top:14px;gap:10px;align-items:center;flex-wrap:wrap"><div style="flex:1;min-width:200px"><b>Customer login page</b>
      <div class="muted small">Buyers sign in here to see all their courses and receipts: <a href="${esc(course.portal_url)}" target="_blank" rel="noopener">${esc(course.portal_url)}</a></div></div>
      <button class="btn sm" data-copyportal>${icon('copy')} Copy link</button></div></section>`;
}

function courseBindSettingsCard(f, box, course) {
  const t = $('[data-dripmail]', box);
  if (t) t.onchange = async () => {
    await api('PUT', `/api/members-areas/${f.id}/course`, { drip_emails: t.checked });
    toast(t.checked ? 'Members get an email when a lesson opens' : 'No more “lesson is ready” emails');
  };
  const cp = $('[data-copyportal]', box);
  if (cp) cp.onclick = async () => { try { await navigator.clipboard.writeText(course.portal_url); toast('Link copied'); } catch { toast(course.portal_url); } };
}
