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
  const c = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    const set = res.headers.get('set-cookie'); if (set?.startsWith('sid=')) cookie = set.split(';')[0];
    return { status: res.status, body: (res.headers.get('content-type') || '').includes('json') ? await res.json() : await res.text() };
  };
  c.cookie = () => cookie;
  return c;
}
// A browser request: forms, a cookie, no redirects followed.
const raw = async (method, path, { form, cookie, accept } = {}) => {
  const res = await fetch(base + path, { method, redirect: 'manual', headers: { ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}), ...(cookie ? { cookie } : {}), ...(accept ? { accept } : {}) }, body: form && new URLSearchParams(form) });
  return { status: res.status, location: res.headers.get('location'), cookie: (res.headers.get('set-cookie') || '').split(';')[0], text: await res.text() };
};
const mails = async (c, email) => (await c('GET', '/api/outbox')).body.filter((m) => m.to_email === email);
const linkIn = (body, re) => body.match(re)[0].replace(/^https?:\/\/[^/]+/, '');
const jobs = (c, now) => c('POST', '/api/jobs/run', now ? { now: now.toISOString() } : {});

let n = 0;
async function owner(name) {
  const c = client();
  await c('POST', '/api/auth/signup', { name, email: `${name.toLowerCase()}${++n}@example.com`, password: 'password123', workspace: `${name} Studio`, business_type: 'coach' });
  const me = (await c('GET', '/api/me')).body;
  c.acct = me.account.id;
  return c;
}
async function startCommunity(c, settings) {
  const made = await c('POST', '/api/community', { name: 'Clay Club' });
  assert.equal(made.status, 201);
  if (settings) assert.equal((await c('PUT', '/api/community', settings)).status, 200);
  return (await c('GET', '/api/community')).body;
}
// Joins through the public form and the emailed link; returns the member's cookie.
async function joinByEmail(c, email, name = 'Mia Maker') {
  const r = await raw('POST', `/my/${c.acct}/community/join`, { form: { email, name } });
  assert.equal(r.status, 200);
  const mail = (await mails(c, email)).find((m) => /\/my\/\d+\/enter\//.test(m.body));
  if (!mail) return null;
  const enter = await raw('GET', linkIn(mail.body, /https?:\/\/\S+\/my\/\d+\/enter\/\S+/));
  assert.equal(enter.status, 303);
  assert.equal(enter.location, `/my/${c.acct}/community`);
  const page = await raw('GET', enter.location, { cookie: enter.cookie });
  return { cookie: enter.cookie, page };
}
const post = (c, cookie, form) => raw('POST', `/my/${c.acct}/community/posts`, { cookie, form });

test('open community: anyone with an email joins by link, logs a join event and starts a follow-up', async () => {
  const c = await owner('Olga');
  const comm = await startCommunity(c);
  assert.equal(comm.spaces.length, 4);
  assert.equal(comm.community.join_rule, 'open');
  // A follow-up that starts when someone joins.
  const wf = await c('POST', '/api/workflows', { name: 'Welcome to the club' });
  assert.equal(wf.status, 201, JSON.stringify(wf.body));
  const saved = await c('PUT', `/api/workflows/${wf.body.id}`, { graph: { root: 't', nodes: {
    t: { type: 'trigger', config: { event: 'community_join' }, next: 'e' },
    e: { type: 'email', config: { subject: 'Glad you joined', body: 'Hi {{first_name}}' }, next: null } } } });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal((await c('PUT', `/api/workflows/${wf.body.id}/status`, { status: 'active' })).status, 200);

  const anon = await raw('GET', `/my/${c.acct}/community`);
  assert.equal(anon.status, 401);
  assert.match(anon.text, /Join the community/);
  const { cookie, page } = await joinByEmail(c, 'mia@example.com');
  assert.equal(page.status, 200);
  assert.match(page.text, /All posts/);
  assert.match(page.text, /Introductions/);
  assert.match(page.text, /Welcome in!/);
  const list = (await c('GET', '/api/community')).body;
  assert.equal(list.stats.members, 1);
  assert.equal(list.members[0].email, 'mia@example.com');
  const person = (await c('GET', `/api/people/${list.members[0].contact_id}`)).body;
  assert.ok(JSON.stringify(person).includes('community_join'));
  await jobs(c);
  assert.ok((await mails(c, 'mia@example.com')).some((m) => m.subject === 'Glad you joined'));
  // The customer area shows the community.
  const portal = await raw('GET', `/my/${c.acct}`, { cookie });
  assert.match(portal.text, /Clay Club/);
  assert.match(portal.text, /\/community/);
});

test('buyers-only community: buyers get in, others are told why, removed people are blocked', async () => {
  const c = await owner('Bea');
  const db = app.getDb();
  const prod = await db.get("INSERT INTO products (account_id, name, price_cents) VALUES (?, 'Wheel Course', 9900) RETURNING id", c.acct);
  await startCommunity(c, { join_rule: 'buyers', join_products: [prod.id] });
  // Someone who didn't buy gets no link.
  assert.equal(await joinByEmail(c, 'nobuy@example.com'), null);
  // A buyer is let in.
  const contact = await db.get("INSERT INTO contacts (account_id, email, first_name) VALUES (?, 'buyer@example.com', 'Ben') RETURNING id", c.acct);
  await db.run("INSERT INTO orders (account_id, product_id, product_name, contact_id, email, amount_cents, currency, status, mode, paid_at) VALUES (?, ?, 'Wheel Course', ?, 'buyer@example.com', 9900, 'usd', 'paid', 'test', now())", c.acct, prod.id, contact.id);
  const buyer = await joinByEmail(c, 'buyer@example.com');
  assert.equal(buyer.page.status, 200);
  // A customer who bought something else signs in to the customer area, but the community says no.
  const other = await db.get("INSERT INTO contacts (account_id, email) VALUES (?, 'other@example.com') RETURNING id", c.acct);
  const p2 = await db.get("INSERT INTO products (account_id, name, price_cents) VALUES (?, 'Mug', 2000) RETURNING id", c.acct);
  await db.run("INSERT INTO orders (account_id, product_id, product_name, contact_id, email, amount_cents, currency, status, mode, paid_at) VALUES (?, ?, 'Mug', ?, 'other@example.com', 2000, 'usd', 'paid', 'test', now())", c.acct, p2.id, other.id);
  await raw('POST', `/my/${c.acct}/login`, { form: { email: 'other@example.com' } });
  const pm = (await mails(c, 'other@example.com')).find((m) => /\/enter\//.test(m.body));
  const otherCookie = (await raw('GET', linkIn(pm.body, /https?:\/\/\S+\/my\/\d+\/enter\/\S+/))).cookie;
  const no = await raw('GET', `/my/${c.acct}/community`, { cookie: otherCookie });
  assert.equal(no.status, 403);
  assert.match(no.text, /only open to some customers/);
  assert.match(no.text, /Wheel Course/);
  // Removed: blocked, even though they bought.
  const m = (await c('GET', '/api/community')).body.members.find((x) => x.email === 'buyer@example.com');
  assert.equal((await c('DELETE', `/api/community/members/${m.id}`)).status, 200);
  const blocked = await raw('GET', `/my/${c.acct}/community`, { cookie: buyer.cookie });
  assert.equal(blocked.status, 403);
  assert.match(blocked.text, /don’t have access/);
  await c('POST', `/api/community/members/${m.id}/restore`);
  assert.equal((await raw('GET', `/my/${c.acct}/community`, { cookie: buyer.cookie })).status, 200);
});

test('posts, likes, comments and replies; reply emails are batched to one an hour', async () => {
  const c = await owner('Pat');
  const comm = await startCommunity(c);
  const intro = comm.spaces.find((s) => s.name === 'Introductions');
  const ann = comm.spaces.find((s) => s.name === 'Announcements');
  const a = await joinByEmail(c, 'ann@example.com', 'Ann Author');
  const b = await joinByEmail(c, 'bob@example.com', 'Bob Reader');

  // Members can't post in an announcements-only space.
  const refused = await post(c, a.cookie, { space_id: ann.id, body: 'Hi all' });
  assert.equal(refused.status, 403);
  assert.match(refused.text, /Only/);

  const made = await post(c, a.cookie, { space_id: intro.id, title: 'Hello from Ann', body: 'I make **mugs** <script>alert(1)</script>', link_url: 'javascript:alert(1)' });
  assert.equal(made.status, 303);
  const feed = await raw('GET', `/my/${c.acct}/community`, { cookie: b.cookie });
  assert.match(feed.text, /Hello from Ann/);
  assert.match(feed.text, /<b>mugs<\/b>/);
  assert.ok(!feed.text.includes('<script>alert(1)'), 'escaped');
  assert.ok(!feed.text.includes('javascript:alert'), 'bad links dropped');
  const postId = Number(feed.text.match(/id="p(\d+)"/)[1]);

  // Like (JSON for the page script), and unlike.
  const like = await raw('POST', `/my/${c.acct}/community/p/${postId}/like`, { cookie: b.cookie, form: {}, accept: 'application/json' });
  assert.deepEqual(JSON.parse(like.text), { liked: true, likes: 1 });
  assert.deepEqual(JSON.parse((await raw('POST', `/my/${c.acct}/community/p/${postId}/like`, { cookie: b.cookie, form: {}, accept: 'application/json' })).text), { liked: false, likes: 0 });

  // Bob comments: Ann hears about it.
  const c1 = await raw('POST', `/my/${c.acct}/community/p/${postId}/comments`, { cookie: b.cookie, form: { body: 'Welcome Ann!' } });
  assert.equal(c1.status, 303);
  const commentId = Number(c1.location.match(/#c(\d+)/)[1]);
  const now = new Date();
  await jobs(c, now);
  let annMail = (await mails(c, 'ann@example.com')).filter((m) => /replied to you|new replies/.test(m.subject));
  assert.equal(annMail.length, 1);
  assert.match(annMail[0].subject, /Bob Reader replied to you/);
  assert.match(annMail[0].body, /Welcome Ann!/);
  assert.match(annMail[0].body, /Stop these emails: \S+\/community\/stop\//);

  // Two more comments within the hour: no new email yet.
  await raw('POST', `/my/${c.acct}/community/p/${postId}/comments`, { cookie: b.cookie, form: { body: 'Love the glaze' } });
  // Ann replies to Bob's comment: Bob hears about it (but not Ann herself).
  const reply = await raw('POST', `/my/${c.acct}/community/p/${postId}/comments`, { cookie: a.cookie, form: { body: 'Thanks Bob', parent_id: commentId } });
  assert.equal(reply.status, 303);
  await raw('POST', `/my/${c.acct}/community/p/${postId}/comments`, { cookie: b.cookie, form: { body: 'Any time' } });
  await jobs(c, new Date(now.getTime() + 20 * 60e3));
  annMail = (await mails(c, 'ann@example.com')).filter((m) => /replied to you|new replies/.test(m.subject));
  assert.equal(annMail.length, 1, 'still one email within the hour');
  const bobMail = (await mails(c, 'bob@example.com')).filter((m) => /replied to you|new replies/.test(m.subject));
  assert.equal(bobMail.length, 1);
  assert.match(bobMail[0].body, /replied to your comment/);
  // After the hour: one email with both new comments.
  await jobs(c, new Date(now.getTime() + 61 * 60e3));
  annMail = (await mails(c, 'ann@example.com')).filter((m) => /replied to you|new replies/.test(m.subject));
  assert.equal(annMail.length, 2);
  assert.match(annMail[0].subject, /2 new replies/);

  // The post page shows the thread, replies under their comment.
  const page = await raw('GET', `/my/${c.acct}/community/p/${postId}`, { cookie: a.cookie });
  assert.match(page.text, /Thanks Bob/);
  assert.match(page.text, /3 comments|4 comments/);

  // Only the author can edit or delete their post.
  const steal = await raw('POST', `/my/${c.acct}/community/p/${postId}/edit`, { cookie: b.cookie, form: { body: 'hacked' } });
  assert.equal(steal.status, 403);
  assert.equal((await raw('POST', `/my/${c.acct}/community/p/${postId}/delete`, { cookie: b.cookie, form: {} })).status, 403);
  assert.equal((await raw('POST', `/my/${c.acct}/community/p/${postId}/edit`, { cookie: a.cookie, form: { title: 'Hello again', body: 'Edited' } })).status, 303);
  const del = await raw('POST', `/my/${c.acct}/community/p/${postId}/delete`, { cookie: a.cookie, form: {} });
  assert.match(del.location, /deleted=/);
  assert.ok(!(await raw('GET', `/my/${c.acct}/community`, { cookie: b.cookie })).text.includes('Hello again'));
  await raw('POST', `/my/${c.acct}/community/p/${postId}/restore`, { cookie: a.cookie, form: {} });
  assert.match((await raw('GET', `/my/${c.acct}/community`, { cookie: b.cookie })).text, /Hello again/);
});

test('posting is rate limited', async () => {
  const c = await owner('Rae');
  const comm = await startCommunity(c);
  const wins = comm.spaces.find((s) => s.name === 'Wins');
  const m = await joinByEmail(c, 'busy@example.com');
  for (let i = 0; i < 20; i++) assert.equal((await post(c, m.cookie, { space_id: wins.id, body: `Win ${i}` })).status, 303);
  const r = await post(c, m.cookie, { space_id: wins.id, body: 'One more' });
  assert.equal(r.status, 429);
});

test('the owner hosts: posts announcements, pins, deletes any post or comment, manages spaces', async () => {
  const c = await owner('Hana');
  const comm = await startCommunity(c);
  const ann = comm.spaces.find((s) => s.name === 'Announcements');
  const q = comm.spaces.find((s) => s.name === 'Questions');
  const m = await joinByEmail(c, 'mem@example.com', 'Max Member');
  const host = c.cookie();
  // Viewing while signed in to the app: the host.
  const page = await raw('GET', `/my/${c.acct}/community`, { cookie: host });
  assert.match(page.text, /You’re the host/);
  assert.equal((await post(c, host, { space_id: ann.id, title: 'Live call Friday', body: 'Bring questions' })).status, 303);
  await post(c, m.cookie, { space_id: q.id, title: 'Spam spam', body: 'buy now' });
  const feed = await raw('GET', `/my/${c.acct}/community`, { cookie: m.cookie });
  assert.match(feed.text, /Live call Friday[\s\S]*Spam spam|Spam spam[\s\S]*Live call Friday/);
  assert.match(feed.text, /Hana Studio<\/a><span class="cm-badge">Host<\/span>/);
  const data = (await c('GET', '/api/community')).body;
  const spam = data.posts.find((p) => p.title === 'Spam spam');
  const hostPost = data.posts.find((p) => p.title === 'Live call Friday');
  // Pin the host post: it shows first.
  await c('PUT', `/api/community/posts/${hostPost.id}/pin`, { pinned: true });
  const pinned = await raw('GET', `/my/${c.acct}/community`, { cookie: m.cookie });
  assert.ok(pinned.text.indexOf('Live call Friday') < pinned.text.indexOf('Spam spam'));
  assert.match(pinned.text, /Pinned/);
  // Delete a member's post (and undo), and a comment from the public page.
  assert.equal((await c('DELETE', `/api/community/posts/${spam.id}`)).status, 200);
  assert.ok(!(await raw('GET', `/my/${c.acct}/community`, { cookie: m.cookie })).text.includes('Spam spam'));
  await c('POST', `/api/community/posts/${spam.id}/restore`);
  assert.match((await raw('GET', `/my/${c.acct}/community`, { cookie: m.cookie })).text, /Spam spam/);
  const cm = await raw('POST', `/my/${c.acct}/community/p/${hostPost.id}/comments`, { cookie: m.cookie, form: { body: 'rude words' } });
  const cid = Number(cm.location.match(/#c(\d+)/)[1]);
  assert.equal((await raw('POST', `/my/${c.acct}/community/c/${cid}/delete`, { cookie: host, form: {} })).status, 303);
  assert.ok(!(await raw('GET', `/my/${c.acct}/community/p/${hostPost.id}`, { cookie: m.cookie })).text.includes('rude words'));
  // Members can't pin.
  assert.equal((await raw('POST', `/my/${c.acct}/community/p/${spam.id}/pin`, { cookie: m.cookie, form: {} })).status, 403);
  // Spaces: add, rename, reorder, delete (hides its posts), restore.
  const s = (await c('POST', '/api/community/spaces', { name: 'Show and tell' })).body;
  await c('PUT', `/api/community/spaces/${s.id}`, { name: 'Show & tell', owner_only: true });
  const ids = [s.id, ...data.spaces.map((x) => x.id)];
  await c('PUT', '/api/community/spaces/order', { ids });
  const after = (await c('GET', '/api/community')).body;
  assert.equal(after.spaces[0].name, 'Show & tell');
  assert.equal(after.spaces[0].owner_only, 1);
  await c('DELETE', `/api/community/spaces/${q.id}`);
  assert.ok(!(await raw('GET', `/my/${c.acct}/community`, { cookie: m.cookie })).text.includes('Spam spam'));
  await c('POST', `/api/community/spaces/${q.id}/restore`);
  assert.equal(after.stats.members, 1);
  assert.ok(after.stats.posts_week >= 2);
});

test('account isolation: another business cannot see or touch this community', async () => {
  const a = await owner('Ada');
  const b = await owner('Ben');
  const comm = await startCommunity(a);
  await startCommunity(b);
  const m = await joinByEmail(a, 'iso@example.com');
  await post(a, m.cookie, { space_id: comm.spaces[1].id, title: 'Private to Ada', body: 'x' });
  const p = (await a('GET', '/api/community')).body.posts[0];
  // Ben's API can't moderate Ada's things.
  assert.equal((await b('DELETE', `/api/community/posts/${p.id}`)).status, 404);
  assert.equal((await b('PUT', `/api/community/spaces/${comm.spaces[0].id}`, { name: 'Mine' })).status, 404);
  assert.equal((await b('DELETE', `/api/community/members/${(await a('GET', '/api/community')).body.members[0].id}`)).status, 404);
  assert.equal((await b('GET', '/api/community')).body.posts.length, 0);
  // Ben signed in to the app is not the host of Ada's community.
  assert.equal((await raw('GET', `/my/${a.acct}/community`, { cookie: b.cookie() })).status, 401);
  // Ada's member cookie doesn't open Ben's community, and Ada's post id doesn't show there.
  assert.equal((await raw('GET', `/my/${b.acct}/community`, { cookie: m.cookie })).status, 401);
  assert.equal((await raw('GET', `/my/${b.acct}/community/p/${p.id}`, { cookie: b.cookie() })).status, 404);
  // Posting into another business's space id fails.
  const bSpace = (await b('GET', '/api/community')).body.spaces[1].id;
  assert.equal((await post(a, m.cookie, { space_id: bSpace, body: 'sneaky' })).status, 400);
});

test('events: RSVP, a reminder an hour before; the stop link works', async () => {
  const c = await owner('Eve');
  const comm = await startCommunity(c);
  const host = c.cookie();
  const m = await joinByEmail(c, 'rsvp@example.com', 'Rita');
  const skip = await joinByEmail(c, 'norsvp@example.com', 'Nora');
  const at = new Date(Date.now() + 3 * 3600e3);
  const local = at.toISOString().slice(0, 16);
  const made = await raw('POST', `/my/${c.acct}/community/posts`, { cookie: host, form: { kind: 'event', title: 'Glaze Q&A', event_at: local, tz: '0', event_url: 'https://zoom.us/j/123', space_id: comm.spaces[0].id, body: 'Ask anything' } });
  assert.equal(made.status, 303);
  const eventId = Number(made.location.match(/\/p\/(\d+)/)[1]);
  const events = await raw('GET', `/my/${c.acct}/community/events`, { cookie: m.cookie });
  assert.match(events.text, /Glaze Q&amp;A/);
  assert.match(events.text, /Upcoming/);
  assert.equal((await raw('POST', `/my/${c.acct}/community/p/${eventId}/rsvp`, { cookie: m.cookie, form: {} })).status, 303);
  assert.match((await raw('GET', `/my/${c.acct}/community/p/${eventId}`, { cookie: m.cookie })).text, /1 going/);
  // Too early: nothing.
  await jobs(c, new Date(at.getTime() - 2 * 3600e3));
  assert.equal((await mails(c, 'rsvp@example.com')).filter((x) => /Starting soon/.test(x.subject)).length, 0);
  // An hour before: Rita (who RSVP'd) gets one; Nora doesn't.
  await jobs(c, new Date(at.getTime() - 55 * 60e3));
  await jobs(c, new Date(at.getTime() - 50 * 60e3));
  const sent = (await mails(c, 'rsvp@example.com')).filter((x) => /Starting soon/.test(x.subject));
  assert.equal(sent.length, 1);
  assert.match(sent[0].body, /zoom\.us\/j\/123/);
  assert.equal((await mails(c, 'norsvp@example.com')).filter((x) => /Starting soon/.test(x.subject)).length, 0);
  assert.ok(skip);

  // The stop link: one click, and a forged one fails.
  const stop = linkIn(sent[0].body, /https?:\/\/\S+\/community\/stop\/\S+/);
  const forged = stop.replace(/\.events\./, '.digest.');
  assert.equal((await raw('GET', forged)).status, 400);
  const ok = await raw('GET', stop);
  assert.equal(ok.status, 200);
  assert.match(ok.text, /won’t get event reminders/);
  const row = await app.getDb().get("SELECT notify_events FROM community_members WHERE account_id = ? AND name = 'Rita'", c.acct);
  assert.equal(row.notify_events, 0);
});

test('weekly digest goes to people who have not visited, with a working stop link', async () => {
  const c = await owner('Dee');
  const comm = await startCommunity(c);
  const host = c.cookie();
  const away = await joinByEmail(c, 'away@example.com', 'Al Away');
  const here = await joinByEmail(c, 'here@example.com', 'Hal Here');
  await post(c, host, { space_id: comm.spaces[0].id, title: 'Big news this week', body: 'New kiln!' });
  await post(c, here.cookie, { space_id: comm.spaces[2].id, title: 'My first bowl', body: 'Look' });
  // Al hasn't been in for 8 days.
  await app.getDb().run("UPDATE community_members SET last_seen_at = now() - interval '8 days' WHERE account_id = ? AND name = 'Al Away'", c.acct);
  await jobs(c);
  const d = (await mails(c, 'away@example.com')).filter((x) => /This week in/.test(x.subject));
  assert.equal(d.length, 1);
  assert.match(d[0].body, /Big news this week/);
  assert.match(d[0].body, /My first bowl/);
  assert.equal((await mails(c, 'here@example.com')).filter((x) => /This week in/.test(x.subject)).length, 0);
  // Not again the same week.
  await jobs(c);
  assert.equal((await mails(c, 'away@example.com')).filter((x) => /This week in/.test(x.subject)).length, 1);
  // Stop link turns it off.
  const stop = linkIn(d[0].body, /https?:\/\/\S+\/community\/stop\/\S+/);
  const r = await raw('GET', stop);
  assert.equal(r.status, 200);
  assert.match(r.text, /weekly highlights/);
  await app.getDb().run("UPDATE community_members SET digest_sent_at = now() - interval '8 days' WHERE account_id = ?", c.acct);
  await jobs(c);
  assert.equal((await mails(c, 'away@example.com')).filter((x) => /This week in/.test(x.subject)).length, 1);
  assert.ok(away);
});

test('profiles, the directory and member pictures', async () => {
  const c = await owner('Pia');
  await startCommunity(c);
  const m = await joinByEmail(c, 'pro@example.com', 'Pro File');
  // A tiny PNG as the photo.
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000100e221bc330000000049454e44ae426082', 'hex');
  const up = await fetch(`${base}/my/${c.acct}/community/upload`, { method: 'POST', headers: { cookie: m.cookie, accept: 'application/json' }, body: png });
  assert.equal(up.status, 201);
  const { url } = await up.json();
  assert.match(url, /^\/u\/\S+\.png$/);
  // Not an image: refused.
  const bad = await fetch(`${base}/my/${c.acct}/community/upload`, { method: 'POST', headers: { cookie: m.cookie, accept: 'application/json' }, body: Buffer.from('%PDF-1.4 nope') });
  assert.equal(bad.status, 415);
  // Not signed in: refused.
  assert.equal((await fetch(`${base}/my/${c.acct}/community/upload`, { method: 'POST', body: png })).status, 401);
  assert.equal((await raw('POST', `/my/${c.acct}/community/me`, { cookie: m.cookie, form: { name: 'Pro Potter', bio: 'Wheel thrower <b>x</b>', photo_url: url, notify_replies: '1' } })).status, 303);
  const dir = await raw('GET', `/my/${c.acct}/community/people`, { cookie: m.cookie });
  assert.match(dir.text, /Pro Potter/);
  assert.match(dir.text, /Wheel thrower &lt;b&gt;x&lt;\/b&gt;/);
  assert.ok(dir.text.includes(`src="${url}"`));
  const row = await app.getDb().get('SELECT notify_digest, notify_replies FROM community_members WHERE account_id = ?', c.acct);
  assert.deepEqual([row.notify_replies, row.notify_digest], [1, 0]);
});
