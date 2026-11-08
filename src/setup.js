// First-run setup: "What kind of business?" → a ready page, booking hours and
// follow-ups in one go. The page starts as a draft so the owner previews it
// before anything goes out; the setup screen then publishes it and turns on
// the follow-ups they keep ticked.
const business = require('./business');
const { cleanSettings, settingsOf } = require('./bookings');
const { problems } = require('./workflows');

// What the first page should do, and the template that does it.
const GOALS = {
  booked: { template: 'booking', label: 'Get booked', purpose: 'bookings' },
  inquiries: { template: 'consult', label: 'Get inquiries and quote requests', purpose: 'leads' },
  list: { template: 'list_page', label: 'Grow my list', purpose: 'leads' },
  sell: { template: 'pricing', label: 'Sell something', purpose: 'sales' },
};
const DEFAULT_GOAL = { services: 'inquiries', coach: 'booked', local: 'list', shop: 'list', nonprofit: 'list', other: 'inquiries' };

// Plain starting copy when AI isn't connected (or fails): specific to the business, never lorem.
function fallbackCopy(goal, name, offer) {
  const sub = offer ? offer.replace(/\s+/g, ' ').trim().replace(/([^.!?])$/, '$1.') : '';
  return {
    booked: { headline: `Book a time with ${name}`, subheadline: sub || 'Pick a time that suits you. You’ll get a confirmation straight away.', button: 'Confirm my booking', thank_you: 'You’re booked. See you soon!' },
    inquiries: { headline: `Get a free quote from ${name}`, subheadline: sub ? `${sub} Tell us what you need and we’ll reply within one business day.` : 'Tell us what you need and we’ll reply within one business day.', button: 'Request my quote', thank_you: 'Thanks! We’ll be in touch soon.' },
    list: { headline: `Join the ${name} list`, subheadline: sub ? `${sub} Get news and offers first.` : 'Get news, offers and the occasional tip. No spam.', button: 'Count me in', thank_you: 'You’re on the list. Welcome!' },
    sell: { headline: offer || name, subheadline: '', button: 'Buy now', thank_you: 'Payment received. Thank you!' },
  }[goal];
}

// What people get for joining the list, and the words for each. Never placeholders:
// this page can go live as it is.
const INCENTIVES = ['discount', 'guide', 'news'];
const DEFAULT_INCENTIVE = { shop: 'discount', local: 'discount' };
function listPage({ incentive, name, offer, guide, pct }) {
  const about = offer ? `${offer.replace(/\s+/g, ' ').trim().replace(/([^.!?])$/, '$1.')}` : '';
  if (incentive === 'discount') {
    return {
      eyebrow: 'Welcome offer', headline: `${pct}% off your first order`,
      subheadline: `Join the ${name} list and your code arrives straight away.`,
      button: `Get my ${pct}% off`, bullets: [`${pct}% off your first order, sent right now`, 'First look at new arrivals and restocks', 'Stories and tips worth reading. Never spam.'],
      thank_you: 'You’re in! Here’s your code', thank_text: `Use code WELCOME${pct} at checkout for ${pct}% off your first order.`, about,
    };
  }
  if (incentive === 'guide') {
    return {
      eyebrow: 'Free guide', headline: guide, subheadline: `${about ? `${about} ` : ''}Free, straight to your inbox.`.trim(),
      button: 'Send me the guide', bullets: ['Clear, practical advice you can use straight away', `Written by ${name}, from real experience`, 'Free. Unsubscribe any time with one click.'],
      thank_you: 'It’s on its way', thank_text: 'Check your inbox in the next few minutes. If it’s not there, look in Promotions or Spam.', about: '',
    };
  }
  return {
    eyebrow: 'Members list', headline: `Hear from ${name} first`,
    subheadline: `${about ? `${about} ` : ''}New arrivals, offers and tips, about twice a month.`.trim(),
    button: 'Keep me posted', bullets: ['New arrivals and news before anyone else', 'Members-only offers and early access', 'A short, useful note about twice a month'],
    thank_you: 'You’re on the list', thank_text: 'Welcome! Your first email is on its way.', about,
  };
}

// A pricing page without the software-sounding sample features.
function plainPricing(TEMPLATES, offer) {
  const base = TEMPLATES.pricing;
  return {
    ...TEMPLATES,
    pricing: {
      ...base,
      steps: () => base.steps().map((st, i) => (i ? st : {
        ...st,
        blocks: st.blocks.map((b) => (b.type === 'hero' ? { ...b, eyebrow: '', text: offer || b.text }
          : b.type === 'pricing' ? { ...b, badge: '', compareText: '', note: '', featuresTitle: '', features: '', buttonLabel: 'Buy now', buttonSubtext: 'Secure checkout' } : b)),
      })),
    },
  };
}

function registerSetup(api, { getDb, HttpError, createFunnel, TEMPLATES, getAccount }) {
  const db = () => getDb();

  api.get('/setup/goals', (req, res) => res.json({ goals: Object.entries(GOALS).map(([key, g]) => ({ key, label: g.label })), defaults: DEFAULT_GOAL }));

  api.post('/setup/build', async (req, res) => {
    const b = req.body || {};
    const type = business.cleanType(b.business_type) || 'other';
    const goal = GOALS[b.goal] ? b.goal : DEFAULT_GOAL[type];
    const name = String(b.name || '').trim().slice(0, 80);
    const offer = String(b.offer || '').trim().slice(0, 300);
    if (!name) throw new HttpError(400, 'What’s your business called?');
    // Growing a list: what people get for joining.
    const guide = String(b.guide || '').trim().slice(0, 120);
    let incentive = INCENTIVES.includes(b.incentive) ? b.incentive : DEFAULT_INCENTIVE[type] || 'news';
    if (incentive === 'guide' && !guide) throw new HttpError(400, 'What’s the free guide called?');
    const pct = Math.min(50, Math.max(5, Math.round(Number(b.percent) || 10)));
    const list = goal === 'list' ? listPage({ incentive, name, offer, guide, pct }) : null;

    // Booking hours, if they take bookings (checked before anything is created).
    let booking = null;
    if (goal === 'booked') {
      try { booking = cleanSettings({ tz: b.tz, days: b.days?.length ? b.days : [1, 2, 3, 4, 5], start: b.start || '09:00', end: b.end || '17:00', length: b.length || 30, title: b.booking_title || `Call with ${name}` }); } catch (e) { throw new HttpError(400, e.message); }
      if (!booking.days.length) throw new HttpError(400, 'Pick at least one day');
    }
    let productId = null;
    if (goal === 'sell') {
      const price = Math.round(Number(b.price) * 100);
      if (!offer) throw new HttpError(400, 'What are you selling?');
      if (!Number.isFinite(price) || price < 50) throw new HttpError(400, 'Add a price (at least 0.50)');
      productId = (await db().get("INSERT INTO products (account_id, name, description, price_cents, currency, billing, tag, image_url) VALUES (?, ?, '', ?, 'usd', 'one_time', '', '') RETURNING id",
        req.accountId, offer.slice(0, 120), price)).id;
    }

    // The kind of business: name, type, and its sections (unless already customised).
    const before = await getAccount(req.accountId);
    const lastWf = (await db().get('SELECT COALESCE(MAX(id), 0)::int AS n FROM workflows WHERE account_id = ?', req.accountId)).n;
    await db().run('UPDATE accounts SET name = ?, business_type = ? WHERE id = ?', name, type, req.accountId);
    // Their logo, and a brand colour from it unless they already chose one.
    const logo = String(b.logo || '').trim().slice(0, 500);
    if (/^(https?:\/\/|\/u\/)/.test(logo)) await db().run('UPDATE accounts SET logo_url = ? WHERE id = ?', logo, req.accountId);
    if (/^#[0-9a-f]{6}$/i.test(b.color || '')) await db().run("UPDATE accounts SET brand_color = ? WHERE id = ? AND brand_color = ''", String(b.color).toLowerCase(), req.accountId);
    if (booking) {
      const prev = settingsOf(before);
      await db().run('UPDATE accounts SET booking = ? WHERE id = ?', JSON.stringify({ ...booking, busy: prev.busy || [] }), req.accountId);
    }

    // AI writes the page in their words; plain copy if AI isn't connected.
    const account = await getAccount(req.accountId);
    const tpl = GOALS[goal].template;
    let copy = list || fallbackCopy(goal, name, offer), drafted = false;
    if (offer && goal !== 'sell' && goal !== 'list') {
      try {
        const plan = await require('./ai').describeFunnel({
          account, sentence: `${name}: ${offer}. The page should: ${GOALS[goal].label.toLowerCase()}.`,
          options: [{ key: tpl, label: TEMPLATES[tpl].label, description: TEMPLATES[tpl].description }],
        });
        if (!plan.template_only) { copy = plan; drafted = true; }
      } catch (e) { console.error('setup copy:', e.message); }
    }
    const pageName = `${name.slice(0, 40)} ${goal === 'booked' ? 'booking' : goal === 'inquiries' ? 'quotes' : goal === 'sell' ? 'shop' : 'list'}`;
    const f = await createFunnel(req.accountId, pageName, tpl, copy, { templates: goal === 'sell' ? plainPricing(TEMPLATES, offer) : TEMPLATES });
    await db().run('UPDATE funnels SET purpose = ? WHERE id = ?', GOALS[goal].purpose, f.id);
    if (list) {
      // The parts the general copy step doesn't touch: eyebrow, what they get, who's behind it, the thank-you.
      const steps = await db().all('SELECT id, blocks, settings FROM funnel_steps WHERE funnel_id = ? ORDER BY position, id', f.id);
      const brand = /^#[0-9a-f]{6}$/i.test(account.brand_color || '') ? account.brand_color : '';
      for (const [i, s] of steps.entries()) {
        const blocks = JSON.parse(s.blocks).flatMap((x) => {
          if (i === 0 && x.type === 'hero') return [{ ...x, eyebrow: list.eyebrow, ...(brand ? { background: brand } : {}) }];
          if (i === 0 && x.type === 'bullets') return [{ ...x, items: list.bullets.join('\n') }];
          if (i === 0 && x.type === 'form' && incentive === 'guide') return [{ ...x, deliverName: guide }];
          if (i === 0 && x.type === 'text' && !x.text) return list.about ? [{ ...x, text: `About ${name}: ${list.about}` }] : [];
          if (i > 0 && x.type === 'text') return [{ ...x, text: list.thank_text }];
          return [x];
        });
        const st = { ...JSON.parse(s.settings || '{}'), ...(brand ? { accent: brand } : {}) };
        await db().run('UPDATE funnel_steps SET blocks = ?, settings = ? WHERE id = ?', JSON.stringify(blocks), JSON.stringify(st), s.id);
      }
      // A real code for the welcome offer.
      if (incentive === 'discount') {
        await db().run("INSERT INTO coupons (account_id, code, percent_off) VALUES (?, ?, ?) ON CONFLICT (account_id, code) DO NOTHING", req.accountId, `WELCOME${pct}`, pct);
      }
    }
    if (productId) {
      for (const s of await db().all('SELECT id, blocks FROM funnel_steps WHERE funnel_id = ?', f.id)) {
        const blocks = JSON.parse(s.blocks).map((x) => (x.type === 'pricing' ? { ...x, productId } : x));
        await db().run('UPDATE funnel_steps SET blocks = ? WHERE id = ?', JSON.stringify(blocks), s.id);
      }
    }
    // A workspace with no home page yet gets this one at its own domain.
    if (!before.home_funnel_id) await db().run('UPDATE accounts SET home_funnel_id = ? WHERE id = ?', f.id, req.accountId);

    // Follow-ups: only the ones this page brought with it (not every follow-up in the workspace).
    // Ready ones are ticked; ones that still need something from the owner (a link, a review URL) say what.
    const wfs = await db().all("SELECT id, name, graph, template, status, funnel_id FROM workflows WHERE account_id = ? AND status <> 'archived' AND (funnel_id = ? OR id > ?) ORDER BY id", req.accountId, f.id, lastWf);
    const followups = wfs.map((w) => {
      const g = JSON.parse(w.graph);
      const emails = Object.values(g.nodes || {}).filter((n) => n.type === 'email');
      const missing = emails.flatMap((n) => `${n.config.subject} ${n.config.body}`.match(/\[[^\]]+\]/g) || []);
      return {
        id: w.id, name: w.name.replace(/^.*?: /, ''), status: w.status, emails: emails.length,
        first: emails[0]?.config.subject || '', ready: !problems(g).length && !missing.length, needs: [...new Set(missing)].map((m) => m.slice(1, -1)),
      };
    });
    res.status(201).json({ funnel_id: f.id, goal, drafted, booking: Boolean(booking), followups, incentive: list ? incentive : null, coupon: list && incentive === 'discount' ? `WELCOME${pct}` : null, guide_needs_file: list && incentive === 'guide' });
  });
}

module.exports = { registerSetup, GOALS, DEFAULT_GOAL, fallbackCopy, listPage };
