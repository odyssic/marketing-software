process.env.ALLOW_SIGNUPS = '1';
process.env.ALLOW_TIME_TRAVEL = '1';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');

let app, server, base;
before(async () => {
  app = createApp(process.env.TEST_DATABASE_URL ? {} : { dbPath: ':memory:' });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
  process.env.PUBLIC_URL = base;
});
after(async () => { server.close(); await app.close(); });
function client() {
  let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    const set = res.headers.get('set-cookie'); if (set?.startsWith('sid=')) cookie = set.split(';')[0]; // the owner's session
    return { status: res.status, body: (res.headers.get('content-type') || '').includes('json') ? await res.json() : await res.text() };
  };
}
const raw = async (method, path, { form, cookie } = {}) => {
  const res = await fetch(base + path, { method, redirect: 'manual', headers: { ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}), ...(cookie ? { cookie } : {}) }, body: form && new URLSearchParams(form) });
  return { status: res.status, location: res.headers.get('location'), cookie: (res.headers.get('set-cookie') || '').split(';')[0], text: await res.text() };
};
const mails = async (c, email) => (await c('GET', '/api/outbox')).body.filter((m) => m.to_email === email);
const linkIn = (mail, re) => mail && mail.body.match(re)[0].replace(/^https?:\/\/[^/]+/, '');

async function owner(name) {
  const c = client();
  await c('POST', '/api/auth/signup', { name, email: `${name.toLowerCase()}@example.com`, password: 'password123', workspace: `${name} School`, business_type: 'coach' });
  return c;
}
async function course(c, name) {
  const { id } = (await c('POST', '/api/members-areas', { name })).body;
  const area = (await c('GET', `/api/funnels/${id}`)).body;
  const step = (n) => area.steps.find((s) => s.name === n);
  return { id, area, step };
}
async function join(c, areaId, email) {
  await c('POST', `/api/members-areas/${areaId}/members`, { email, name: 'Mia Member' });
  const all = await mails(c, email);
  const link = linkIn(all.find((m) => /\/m\/.+\/enter\//.test(m.body)), /https?:\/\/\S+\/m\/\S+\/enter\/\S+/);
  return (await raw('GET', link)).cookie;
}

test('lessons open on a schedule; locked lessons show when they open, never their content', async () => {
  const c = await owner('Dora');
  const { id, area, step } = await course(c, 'Clay Course');
  const l2 = step('Lesson 2');
  await c('PUT', `/api/steps/${l2.id}`, { settings: { ...l2.settings, module: 'Week 2', dripDays: 7 } });
  const l1 = step('Lesson 1');
  await c('PUT', `/api/steps/${l1.id}`, { settings: { ...l1.settings, module: 'Week 1' } });
  // A secret line only in Lesson 2.
  await c('PUT', `/api/steps/${l2.id}`, { blocks: [{ id: 'x', type: 'text', text: 'SECRET-GLAZE-RECIPE' }] });
  await c('POST', `/api/funnels/${id}/publish`);
  const cookie = await join(c, id, 'mia@example.com');

  const locked = await raw('GET', `/f/${area.slug}/lesson-2`, { cookie });
  assert.equal(locked.status, 200);
  assert.match(locked.text, /This lesson opens on/);
  assert.doesNotMatch(locked.text, /SECRET-GLAZE-RECIPE/);
  assert.doesNotMatch(locked.text, /Mark complete/);
  // The embed view can't be used to peek either.
  assert.doesNotMatch((await raw('GET', `/f/${area.slug}/lesson-2?embed=1`, { cookie })).text, /SECRET-GLAZE-RECIPE/);
  // The course menu shows modules, the lock, and the current lesson.
  const home = await raw('GET', `/f/${area.slug}`, { cookie });
  assert.match(home.text, /class="crs-mod">Week 1</);
  assert.match(home.text, /class="crs-mod">Week 2</);
  assert.match(home.text, /crs-l locked[^"]*" href="\/f\/[^"]+\/lesson-2"/);
  assert.match(home.text, /0 of 2 lessons done/); // Downloads is a page, not a lesson
  assert.match(home.text, /Start: Lesson 1/);
  // The owner sees the content, with a note about when members get it.
  const own = await c('GET', `/f/${area.slug}/lesson-2`);
  assert.match(own.body, /SECRET-GLAZE-RECIPE/);
  assert.match(own.body, /7 days after they join/);
  // Can't mark a locked lesson done.
  await raw('POST', `/m/${area.slug}/done/lesson-2`, { form: {}, cookie });
  assert.deepEqual((await c('GET', `/api/members-areas/${id}/course`)).body.progress, {});

  // A week later (they joined 8 days ago) it opens.
  await app.getDb().run("UPDATE member_access SET granted_at = now() - interval '8 days' WHERE funnel_id = ?", id);
  const open = await raw('GET', `/f/${area.slug}/lesson-2`, { cookie });
  assert.match(open.text, /SECRET-GLAZE-RECIPE/);
  assert.match(open.text, /Mark complete/);

  // A lesson set to open on a date far ahead stays locked for everyone until then.
  await c('PUT', `/api/steps/${l1.id}`, { settings: { ...l1.settings, dripDate: '2099-01-01' } });
  assert.match((await raw('GET', `/f/${area.slug}/lesson-1`, { cookie })).text, /opens on Thursday, January 1, 2099/);
});

test('members mark lessons complete; progress shows to them and to the owner', async () => {
  const c = await owner('Ezra');
  const { id, area } = await course(c, 'Wheel Course');
  await c('POST', `/api/funnels/${id}/publish`);
  const cookie = await join(c, id, 'max@example.com');
  const other = await join(c, id, 'ned@example.com');

  const l1 = await raw('GET', `/f/${area.slug}/lesson-1`, { cookie });
  assert.match(l1.text, /Mark complete &amp; continue/);
  assert.match(l1.text, /Lesson 2 &rarr;/); // next
  assert.match(l1.text, /&larr; Course home/); // previous
  const done = await raw('POST', `/m/${area.slug}/done/lesson-1`, { form: {}, cookie });
  assert.equal(done.status, 303);
  assert.equal(done.location, `/f/${area.slug}/lesson-2`);
  // Marking twice counts once.
  await raw('POST', `/m/${area.slug}/done/lesson-1`, { form: {}, cookie });
  const home = await raw('GET', `/f/${area.slug}`, { cookie });
  assert.match(home.text, /1 of 2 lessons done/);
  assert.match(home.text, /Continue: Lesson 2/);
  assert.match((await raw('GET', `/f/${area.slug}/lesson-1`, { cookie })).text, /You finished this lesson/);

  const course1 = (await c('GET', `/api/members-areas/${id}/course`)).body;
  assert.equal(course1.lessons, 2);
  const members = (await c('GET', `/api/members-areas/${id}/members`)).body.members;
  const max = members.find((m) => m.email === 'max@example.com');
  const ned = members.find((m) => m.email === 'ned@example.com');
  assert.equal(course1.progress[max.id], 1);
  assert.equal(course1.progress[ned.id], undefined);

  // Finish, then undo one.
  await raw('POST', `/m/${area.slug}/done/lesson-2`, { form: {}, cookie });
  assert.match((await raw('GET', `/f/${area.slug}`, { cookie })).text, /You finished the course/);
  await raw('POST', `/m/${area.slug}/done/lesson-2`, { form: { undo: '1' }, cookie });
  assert.equal((await c('GET', `/api/members-areas/${id}/course`)).body.progress[max.id], 1);
  // Pages that aren't lessons can't be marked done; strangers can't mark anything.
  await raw('POST', `/m/${area.slug}/done/downloads`, { form: {}, cookie });
  await raw('POST', `/m/${area.slug}/done/lesson-2`, { form: {} });
  assert.equal((await c('GET', `/api/members-areas/${id}/course`)).body.progress[max.id], 1);
  assert.match((await raw('GET', `/f/${area.slug}`, { cookie: other })).text, /0 of 2 lessons done/);
});

test('"lesson is ready" emails go out once when a dripped lesson opens, unless turned off', async () => {
  const c = await owner('Fay');
  const { id, area, step } = await course(c, 'Drip Course');
  const l2 = step('Lesson 2');
  await c('PUT', `/api/steps/${l2.id}`, { settings: { ...l2.settings, dripDays: 3 } });
  await c('POST', `/api/funnels/${id}/publish`);
  await join(c, id, 'gus@example.com');
  const ready = async () => (await mails(c, 'gus@example.com')).filter((m) => m.subject === 'Lesson 2 is ready');

  await c('POST', '/api/jobs/run', { now: new Date(Date.now() + 86400e3).toISOString() });
  assert.equal((await ready()).length, 0);
  const in4 = new Date(Date.now() + 4 * 86400e3).toISOString();
  await c('POST', '/api/jobs/run', { now: in4 });
  await c('POST', '/api/jobs/run', { now: in4 });
  const sent = await ready();
  assert.equal(sent.length, 1);
  assert.match(sent[0].body, new RegExp(`/m/${area.slug}/enter/\\S+\\?to=lesson-2`));
  // The emailed link lands on the lesson.
  const enter = await raw('GET', linkIn(sent[0], /https?:\/\/\S+\/m\/\S+\/enter\/\S+/));
  assert.equal(enter.location, `/f/${area.slug}/lesson-2`);

  // Turned off: a new member gets nothing.
  await c('PUT', `/api/members-areas/${id}/course`, { drip_emails: false });
  assert.equal((await c('GET', `/api/members-areas/${id}/course`)).body.drip_emails, false);
  await join(c, id, 'hal@example.com');
  await c('POST', '/api/jobs/run', { now: in4 });
  assert.equal((await mails(c, 'hal@example.com')).filter((m) => /is ready/.test(m.subject)).length, 0);
});

test('one customer login lists every course and order for that email, and only theirs', async () => {
  const c = await owner('Gil');
  const a = await course(c, 'Course A');
  const b = await course(c, 'Course B');
  const hidden = await course(c, 'Course C');
  for (const x of [a, b, hidden]) await c('POST', `/api/funnels/${x.id}/publish`);
  await c('POST', `/api/members-areas/${a.id}/members`, { email: 'ivy@example.com', name: 'Ivy' });
  await c('POST', `/api/members-areas/${b.id}/members`, { email: 'ivy@example.com', name: 'Ivy' });
  await c('POST', `/api/members-areas/${hidden.id}/members`, { email: 'joe@example.com', name: 'Joe' });
  // Another business with the same buyer: not part of this login.
  const other = await owner('Hana');
  const o = await course(other, 'Other Biz Course');
  await other('POST', `/api/funnels/${o.id}/publish`);
  await other('POST', `/api/members-areas/${o.id}/members`, { email: 'ivy@example.com', name: 'Ivy' });

  const { portal_url: portal } = (await c('GET', `/api/members-areas/${a.id}/course`)).body;
  const path = portal.replace(base, '');
  assert.match(path, /^\/my\/\d+$/);
  const login = await raw('GET', path);
  assert.match(login.text, /Email me a sign-in link/);
  // Unknown email: same answer, no email.
  assert.match((await raw('POST', `${path}/login`, { form: { email: 'nobody@example.com' } })).text, /If that email/);
  assert.equal((await mails(c, 'nobody@example.com')).length, 0);
  await raw('POST', `${path}/login`, { form: { email: 'IVY@example.com' } });
  const mail = (await mails(c, 'ivy@example.com')).find((m) => /^Your sign-in link/.test(m.subject));
  assert.ok(mail);
  const enter = await raw('GET', linkIn(mail, /https?:\/\/\S+\/my\/\d+\/enter\/\S+/));
  assert.equal(enter.status, 303);
  const cookie = enter.cookie;
  const page = await raw('GET', path, { cookie });
  assert.match(page.text, /Course A/);
  assert.match(page.text, /Course B/);
  assert.doesNotMatch(page.text, /Course C/);
  assert.doesNotMatch(page.text, /Other Biz Course/);
  assert.match(page.text, /0 of 2 lessons done/);
  // The same sign-in opens every course.
  assert.equal((await raw('GET', `/f/${b.area.slug}/lesson-1`, { cookie })).status, 200);
  assert.equal((await raw('GET', `/f/${hidden.area.slug}/lesson-1`, { cookie })).status, 401);
  // A tampered link gets nowhere; the cookie doesn't work for the other business.
  const bad = linkIn(mail, /https?:\/\/\S+\/my\/\d+\/enter\/\S+/).replace(/.$/, (ch) => (ch === 'a' ? 'b' : 'a'));
  assert.equal((await raw('GET', bad)).status, 401);
  assert.equal((await raw('GET', `/f/${o.area.slug}/lesson-1`, { cookie })).status, 401);
  // Sign out.
  const out = await raw('GET', `${path}/logout`, { cookie });
  assert.match(out.cookie, /=$/);
});

test('the customer login shows paid orders with a receipt only the buyer can open', async () => {
  const c = await owner('Ivo');
  const { id } = await course(c, 'Paid Course');
  await c('POST', `/api/funnels/${id}/publish`);
  const prod = (await c('POST', '/api/products', { name: 'Glaze Masterclass', price: 49 })).body;
  await c('PUT', `/api/members-areas/${id}/products`, { product_ids: [prod.id] });
  const f = (await c('POST', '/api/funnels', { name: 'Sale', template: 'pricing' })).body;
  const funnel = (await c('GET', `/api/funnels/${f.id}`)).body;
  await c('POST', `/api/funnels/${f.id}/publish`);
  const buy = await raw('POST', `/f/${funnel.slug}/${funnel.steps[0].slug}/buy`, { form: { product: String(prod.id), email: 'kim@example.com' } });
  await raw('POST', buy.location, { form: { email: 'kim@example.com', name: 'Kim' } });
  const { portal_url: portal } = (await c('GET', `/api/members-areas/${id}/course`)).body;
  const path = portal.replace(base, '');
  // The access email points to the customer login too.
  const access = (await mails(c, 'kim@example.com')).find((m) => /You’re in/.test(m.subject));
  assert.match(access.body, new RegExp(`${path}\\b`));

  await raw('POST', `${path}/login`, { form: { email: 'kim@example.com' } });
  const mail = (await mails(c, 'kim@example.com')).find((m) => /^Your sign-in link/.test(m.subject));
  const { cookie } = await raw('GET', linkIn(mail, /https?:\/\/\S+\/my\/\d+\/enter\/\S+/));
  const page = await raw('GET', path, { cookie });
  assert.match(page.text, /Paid Course/);
  assert.match(page.text, /Glaze Masterclass/);
  const receiptPath = page.text.match(/href="(\/my\/\d+\/receipt\/\d+)"/)[1];
  const receipt = await raw('GET', receiptPath, { cookie });
  assert.equal(receipt.status, 200);
  assert.match(receipt.text, /Total paid/);
  assert.match(receipt.text, /\$49/);
  // Not signed in: no receipt.
  assert.equal((await raw('GET', receiptPath)).status, 401);
});
