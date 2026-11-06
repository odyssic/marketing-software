// Welcome emails for new Rilly users: day 0, day 2 and day 5 after sign-up.
// Each one points at the next useful step, and skips what they've already done.
const mailer = require('./mailer');
const { rillyEmail } = require('./emailhtml');
const { planOf } = require('./billing');

const SCHEDULE = [0, 2, 5]; // days after sign-up

function createOnboarding({ getDb, publicBase }) {
  const db = () => getDb();

  // What this person has done so far, in their first workspace.
  async function progress(userId) {
    const m = await db().get('SELECT account_id FROM memberships WHERE user_id = ? ORDER BY account_id LIMIT 1', userId);
    if (!m) return null;
    const a = m.account_id;
    const one = async (sql) => Boolean(await db().get(sql, a));
    return {
      accountId: a,
      published: await one("SELECT 1 FROM funnels WHERE account_id = ? AND status = 'live' LIMIT 1"),
      people: (await db().get('SELECT COUNT(*)::int AS n FROM contacts WHERE account_id = ?', a)).n,
      followups: await one("SELECT 1 FROM workflows WHERE account_id = ? AND status = 'active' LIMIT 1"),
    };
  }

  function message(step, u, p) {
    const base = publicBase();
    const first = u.name.split(' ')[0];
    const plan = planOf(u);
    const trialLine = plan.enabled && plan.status === 'trialing' && plan.daysLeft > 0 ? `You have ${plan.daysLeft} days left in your free trial.` : '';
    if (step === 0) {
      return {
        subject: 'Welcome to Rilly',
        preheader: 'Three things to do first, about ten minutes in all.',
        blocks: [
          { p: `Hi ${first}, welcome to Rilly. Here’s the quickest way to get going:` },
          { list: [
            ['Answer three questions and Rilly builds your first page with its follow-ups', `${base}/#/setup`],
            ['Bring in the people you already know (paste a list or upload a spreadsheet)', `${base}/#/people`],
            ['Look at the follow-ups waiting for you and switch on the ones you like', `${base}/#/flows?show=followups`],
          ] },
          { button: [p?.published ? 'Open Rilly' : 'Build my first page', `${base}/#/${p?.published ? '' : 'setup'}`] },
          { small: 'Stuck on anything? Just reply to this email.' },
        ],
      };
    }
    if (step === 1) {
      if (!p?.published) {
        return {
          subject: 'Your first page is a few clicks away',
          preheader: 'Pick what you want (bookings, inquiries, a list or sales) and Rilly builds it.',
          blocks: [
            { p: `Hi ${first}, you haven’t published a page yet. It only takes a few minutes: tell Rilly what you want, and it writes the page and the emails that follow it, in your words.` },
            { button: ['Build my first page', `${base}/#/setup`] },
            { small: 'Nothing goes live until you press Publish.' },
          ],
        };
      }
      if (p.people < 5) {
        return {
          subject: 'Bring your people into Rilly',
          preheader: 'Paste a list, upload a spreadsheet, or snap a photo of a sign-up sheet.',
          blocks: [
            { p: `Hi ${first}, your page is live. Nice work. Next: bring in the people you already know, so your emails reach them too.` },
            { p: 'Paste a list of emails, upload a spreadsheet, or take a photo of a paper sign-up sheet. Rilly sorts it out.' },
            { button: ['Add my people', `${base}/#/people`] },
          ],
        };
      }
      return null; // already going: skip this one
    }
    if (!p?.followups) {
      return {
        subject: 'Let Rilly do the follow-up for you',
        preheader: 'Emails that go out on their own after someone signs up, books or buys.',
        blocks: [
          { p: `Hi ${first}, one thing that makes the biggest difference: follow-ups. They send themselves after someone signs up, books or buys, so nobody falls through the cracks.` },
          { p: 'A few are ready and waiting, switched off. Have a look, change the words if you like, and switch them on.' },
          { button: ['See my follow-ups', `${base}/#/flows?show=followups`] },
          ...(trialLine ? [{ small: trialLine }] : []),
        ],
      };
    }
    return {
      subject: 'Your week in Rilly',
      preheader: 'Where your people came from, and one suggested move.',
      blocks: [
        { p: `Hi ${first}, you’re all set up: a live page, your people, and follow-ups running. Every Monday Rilly emails you a short summary and one small move to try.` },
        { button: ['Open my dashboard', `${base}/#/`] },
        ...(trialLine ? [{ small: trialLine }] : []),
      ],
    };
  }

  async function sendDue(now = new Date()) {
    const users = await db().all(`SELECT id, email, name, created_at, plan_status, trial_ends_at, onboarding_step FROM users
      WHERE onboarding_step < ? ORDER BY id LIMIT 200`, SCHEDULE.length);
    let sent = 0;
    for (const u of users) {
      const step = u.onboarding_step;
      if (new Date(u.created_at).getTime() + SCHEDULE[step] * 864e5 > now.getTime()) continue;
      // Claim the step first, so two runs never send the same email.
      const claimed = await db().get('UPDATE users SET onboarding_step = ? WHERE id = ? AND onboarding_step = ? RETURNING id', step + 1, u.id, step);
      if (!claimed) continue;
      const m = message(step, u, await progress(u.id));
      if (!m) continue;
      await mailer.sendEmail({
        ...mailer.senderFor({ name: 'Rilly' }), to: u.email, subject: m.subject,
        text: m.blocks.map((b) => b.p || b.small || (b.list ? b.list.map(([t, url]) => `- ${t}: ${url}`).join('\n') : b.button ? `${b.button[0]}: ${b.button[1]}` : '')).filter(Boolean).join('\n\n'),
        html: rillyEmail({ base: publicBase(), title: m.subject, preheader: m.preheader, blocks: m.blocks }),
      }).catch((e) => console.error('welcome email:', e.message));
      sent++;
    }
    return { welcomeEmails: sent };
  }

  return { sendDue, message };
}

module.exports = { createOnboarding };
