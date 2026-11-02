// Workflows: a trigger, then steps (wait, email, condition, tag, subscribe,
// notify, deal) on one map. Email sequences are just email + wait steps.
//
// The graph is a tree: { root: 'n1', nodes: { n1: { type: 'trigger', config, next }, ... } }.
// Conditions have `yes` and `no` instead of `next`. A run is one person
// moving through a workflow; the runner advances runs whose wake time is due.
const crypto = require('node:crypto');
const { LEVER_KEYS } = require('./levers');

const STEP_TYPES = ['wait', 'email', 'condition', 'tag', 'subscribe', 'notify', 'deal'];
const TRIGGERS = {
  signup: 'Signs up (any form or funnel)',
  purchase: 'Buys something',
  tag_added: 'Gets a tag',
  subscribe: 'Subscribes to a newsletter',
  inquiry: 'Sends an inquiry',
  silent: 'Goes quiet (no activity for a while)',
  manual: 'Added by hand',
};
const CONDITIONS = {
  has_tag: 'Has the tag', purchased: 'Has bought anything', purchased_since: 'Bought since entering this workflow',
  opened: 'Opened an email from this workflow', clicked: 'Clicked an email from this workflow', stage_is: 'Stage is', has_email: 'Has an email address',
};
// Events this old or older (e.g. last year's orders in an import) never start a workflow.
const FRESH_MS = 2 * 864e5;
const MAX_STEPS_PER_TICK = 30;

const nid = () => `n${crypto.randomBytes(4).toString('hex')}`;
const str = (v, max = 5000) => String(v ?? '').slice(0, max);
const int = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };

// ---------- Graph validation ----------
// Returns a clean copy (known types, trimmed config, links that exist, a strict tree).
function normalizeGraph(graph, HttpError) {
  const nodes = graph?.nodes && typeof graph.nodes === 'object' ? graph.nodes : {};
  const root = graph?.root;
  if (!root || nodes[root]?.type !== 'trigger') throw new HttpError(400, 'A workflow starts with a trigger');
  const out = {};
  const seen = new Set();
  const walk = (key) => {
    if (key === null || key === undefined || key === '') return null;
    const n = nodes[key];
    if (!n) return null;
    if (seen.has(key)) throw new HttpError(400, 'A step can only be in one place on the map');
    seen.add(key);
    const type = key === root ? 'trigger' : n.type;
    if (type !== 'trigger' && !STEP_TYPES.includes(type)) throw new HttpError(400, `Unknown step type: ${type}`);
    const node = { type, config: cleanConfig(type, n.config || {}) };
    out[key] = node;
    if (type === 'condition') { node.yes = walk(n.yes); node.no = walk(n.no); } else node.next = walk(n.next);
    return key;
  };
  walk(root);
  return { root, nodes: out };
}

function cleanConfig(type, c) {
  switch (type) {
    case 'trigger': return {
      event: TRIGGERS[c.event] ? c.event : 'manual', tag: str(c.tag, 60).trim().toLowerCase(),
      funnel_id: c.funnel_id ? int(c.funnel_id, 1, 1e9, null) : null, product: str(c.product, 100).trim(),
      days: int(c.days, 1, 3650, 180), repeat: Boolean(c.repeat),
    };
    case 'wait': return { days: int(c.days, 0, 3650, 1), hours: int(c.hours, 0, 23, 0) };
    case 'email': return { subject: str(c.subject, 300), body: str(c.body, 20000) };
    case 'condition': return { check: CONDITIONS[c.check] ? c.check : 'purchased', value: str(c.value, 60).trim().toLowerCase() };
    case 'tag': return { add: str(c.add, 300), remove: str(c.remove, 300) };
    case 'subscribe': return { product: str(c.product, 100).trim() || 'Newsletter' };
    case 'notify': return { message: str(c.message, 2000) };
    case 'deal': return { pipeline_id: c.pipeline_id ? int(c.pipeline_id, 1, 1e9, null) : null, title: str(c.title, 200), value: Number(c.value) > 0 ? Math.min(Number(c.value), 2e7) : 0 };
    default: return {};
  }
}

// Problems that stop a workflow from being switched on, in plain words.
function problems(graph) {
  const out = [];
  const t = graph.nodes[graph.root];
  if (t.config.event === 'tag_added' && !t.config.tag) out.push('Pick the tag that starts this workflow.');
  if (!t.next) out.push('Add at least one step after the trigger.');
  for (const n of Object.values(graph.nodes)) {
    if (n.type === 'email' && (!n.config.subject.trim() || !n.config.body.trim())) out.push('Every email needs a subject and a message.');
    if (n.type === 'condition' && ['has_tag', 'stage_is'].includes(n.config.check) && !n.config.value) out.push('A condition is missing what to check for.');
    if (n.type === 'deal' && !n.config.pipeline_id) out.push('Pick a pipeline for the “Create deal” step.');
    if (n.type === 'tag' && !n.config.add.trim() && !n.config.remove.trim()) out.push('A “Tag” step needs a tag to add or remove.');
  }
  return [...new Set(out)];
}

// ---------- Starter templates ----------
// Small builder so templates read top to bottom.
function chain(trigger, steps) {
  const nodes = {};
  const root = nid();
  nodes[root] = { type: 'trigger', config: trigger, next: null };
  const attach = (parentKey, port, list) => {
    let prev = parentKey, p = port;
    for (const s of list) {
      const key = nid();
      if (s.type === 'condition') {
        nodes[key] = { type: 'condition', config: s.config, yes: null, no: null };
        nodes[prev][p] = key;
        attach(key, 'yes', s.yes || []);
        attach(key, 'no', s.no || []);
        return;
      }
      nodes[key] = { type: s.type, config: s.config, next: null };
      nodes[prev][p] = key;
      prev = key; p = 'next';
    }
  };
  attach(root, 'next', steps);
  return { root, nodes };
}
const wait = (days) => ({ type: 'wait', config: { days, hours: 0 } });
const email = (subject, body) => ({ type: 'email', config: { subject, body } });

const TEMPLATES = {
  blank: { name: 'New workflow', lever: 'lead', description: 'Start from a trigger and add your own steps.', graph: () => chain({ event: 'signup' }, []) },
  welcome: {
    name: 'New lead welcome series', lever: 'conversion', description: 'Three emails over a week for new signups, ending with an offer if they haven’t bought.',
    graph: (o = {}) => chain({ event: 'signup', funnel_id: o.funnel_id || null }, [
      email('Welcome, {{first_name|friend}}! Here’s what you asked for', 'Hi {{first_name|there}},\n\nThanks for signing up. Here’s the link to what you asked for:\n[Link to your download]\n\nOver the next week I’ll send two short notes on how to get the most out of it.\n\nTalk soon,\n{{business}}'),
      wait(2),
      email('The story behind {{business}}', 'Hi {{first_name|there}},\n\nA quick story about why I started {{business}}, and what I care about getting right for you.\n\n[Tell your story here in a few honest sentences.]\n\nReply any time. I read every email.'),
      wait(3),
      { type: 'condition', config: { check: 'purchased_since' }, yes: [{ type: 'tag', config: { add: 'welcomed-buyer', remove: '' } }],
        no: [email('A little thank-you for you', 'Hi {{first_name|there}},\n\nAs a thank-you for being here, here’s 10% off your first order this week:\n\n[Your offer and link]\n\nIf you have any questions, just reply.')] },
    ]),
  },
  care: {
    name: 'Post-purchase care tips', lever: 'continuity', description: '7 days after an order, send care tips so the purchase keeps delighting.',
    graph: () => chain({ event: 'purchase', repeat: true }, [wait(7), email('Getting the most from your {{business}} order', 'Hi {{first_name|there}},\n\nYour order should have settled in by now. A few tips to keep it at its best:\n\n• [Tip one]\n• [Tip two]\n• [Tip three]\n\nAny questions, just reply.\n\n{{business}}')]),
  },
  review: {
    name: 'Review request', lever: 'lead', description: '21 days after an order, ask for a review (reviews bring new leads).',
    graph: () => chain({ event: 'purchase', repeat: true }, [wait(21), email('Quick favor, {{first_name|friend}}?', 'Hi {{first_name|there}},\n\nIf you’re enjoying your order, would you leave a short review? It helps a small business like mine more than you’d think.\n\n[Review link]\n\nThank you!\n{{business}}')]),
  },
  referral: {
    name: 'Referral ask', lever: 'lead', description: '60 days after an order, invite happy customers to share with a friend.',
    graph: () => chain({ event: 'purchase', repeat: false }, [wait(60), email('Know someone who’d love this?', 'Hi {{first_name|there}},\n\nIf a friend would enjoy {{business}} too, forward them this link and you’ll both get [your thank-you]:\n\n[Referral link]\n\nThanks for spreading the word.')]),
  },
  winback: {
    name: 'Win-back', lever: 'continuity', description: 'After 180 days of silence, send a warm note; if they don’t respond, remind you to reach out personally.',
    graph: () => chain({ event: 'silent', days: 180 }, [
      email('It’s been a while, {{first_name|friend}}', 'Hi {{first_name|there}},\n\nIt’s been a little while and I wanted to say hello. Here’s what’s new at {{business}}:\n\n[What’s new]\n\nIf there’s anything you’d like, just reply.'),
      wait(14),
      { type: 'condition', config: { check: 'clicked' }, yes: [{ type: 'tag', config: { add: 'won-back', remove: '' } }],
        no: [{ type: 'notify', config: { message: 'No response to the win-back email. A short personal note might bring them back.' } }] },
    ]),
  },
  inquiry: {
    name: 'Inquiry follow-up', lever: 'conversion', description: 'If someone asks a question and hasn’t bought within 2 days, remind you to follow up.',
    graph: () => chain({ event: 'inquiry', repeat: true }, [wait(2), { type: 'condition', config: { check: 'purchased_since' }, yes: [],
      no: [{ type: 'notify', config: { message: 'This inquiry is 2 days old with no purchase yet. A quick personal reply usually wins it.' } }] }]),
  },
  newsletter: {
    name: 'Newsletter welcome', lever: 'continuity', description: 'Welcome new newsletter subscribers and invite them to buy after a week.',
    graph: () => chain({ event: 'subscribe' }, [
      email('You’re on the list!', 'Hi {{first_name|there}},\n\nWelcome to the {{business}} newsletter. Here’s what to expect: [how often, what’s inside].\n\nHit reply and tell me what you’d like to hear about.'),
      wait(7),
      { type: 'condition', config: { check: 'purchased' }, yes: [], no: [email('A favorite to start with', 'Hi {{first_name|there}},\n\nIf you’re curious where to start, here’s our most loved piece:\n\n[Product and link]')] },
    ]),
  },
};
const DEFAULT_SET = ['care', 'review', 'referral', 'winback']; // seeded (off) in every new workspace

function createWorkflows({ getDb, HttpError, id, people, messaging, getAccount }) {
  const parse = (w) => ({ ...w, graph: JSON.parse(w.graph || '{}') });
  const getWorkflow = async (accountId, workflowId) => {
    const w = await getDb().get('SELECT * FROM workflows WHERE id = ? AND account_id = ?', id(workflowId), accountId);
    if (!w) throw new HttpError(404, 'Workflow not found');
    return parse(w);
  };

  async function create(accountId, { template = 'blank', name, funnel_id = null, status = 'draft' } = {}) {
    const t = TEMPLATES[template] || TEMPLATES.blank;
    const graph = normalizeGraph(t.graph({ funnel_id }), HttpError);
    const r = await getDb().get(`INSERT INTO workflows (account_id, name, lever, status, template, funnel_id, graph)
      VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`, accountId, str(name || t.name, 120), t.lever, status, template, funnel_id, JSON.stringify(graph));
    return r.id;
  }

  // Every workspace starts with the four standard follow-ups, switched off.
  async function seedDefaults(accountId) {
    const db = getDb();
    const claimed = await db.get('UPDATE accounts SET workflows_seeded = 1 WHERE id = ? AND workflows_seeded = 0 RETURNING id', accountId);
    if (!claimed) return;
    for (const key of DEFAULT_SET) await create(accountId, { template: key });
  }

  // ---------- Enrolment ----------
  async function enroll(w, personId, key = '', now = new Date()) {
    const first = w.graph.nodes[w.graph.root]?.next;
    if (!first) return false;
    const r = await getDb().get(`INSERT INTO workflow_runs (workflow_id, account_id, person_id, trigger_key, node_id, wake_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (workflow_id, person_id, trigger_key) DO NOTHING RETURNING id`,
    w.id, w.account_id, personId, key, first, now.toISOString());
    return Boolean(r);
  }

  const activeWithTrigger = async (accountId, event) => (await getDb().all(
    "SELECT * FROM workflows WHERE account_id = ? AND status = 'active'", accountId)).map(parse)
    .filter((w) => w.graph.nodes?.[w.graph.root]?.config?.event === event);

  // Called for every logged event. Only fresh events start workflows.
  async function onEvent(accountId, e) {
    if (!e.person_id || !['signup', 'purchase', 'subscribe', 'inquiry'].includes(e.type)) return;
    if (e.occurred_at && Date.now() - new Date(e.occurred_at).getTime() > FRESH_MS) return;
    for (const w of await activeWithTrigger(accountId, e.type)) {
      const t = w.graph.nodes[w.graph.root].config;
      if (e.type === 'signup' && t.funnel_id && Number(e.meta?.funnel_id) !== t.funnel_id) continue;
      if (e.type === 'purchase' && t.product && !`${e.meta?.product || ''} ${e.meta?.items || ''}`.toLowerCase().includes(t.product.toLowerCase())) continue;
      await enroll(w, e.person_id, t.repeat ? `${e.type}:${e.id}` : '');
    }
  }

  async function onTagsAdded(accountId, personId, tags) {
    if (!tags.length) return;
    for (const w of await activeWithTrigger(accountId, 'tag_added')) {
      const t = w.graph.nodes[w.graph.root].config;
      if (tags.includes(t.tag)) await enroll(w, personId, t.repeat ? `tag:${Date.now()}` : '');
    }
  }

  // "Goes quiet": people who have bought before and have had no activity for N days.
  let lastSilentScan = 0;
  async function scanSilent(now) {
    if (now.getTime() - lastSilentScan < 10 * 60e3 && !process.env.ALLOW_TIME_TRAVEL) return;
    lastSilentScan = now.getTime();
    const db = getDb();
    const flows = (await db.all("SELECT * FROM workflows WHERE status = 'active'")).map(parse)
      .filter((w) => w.graph.nodes?.[w.graph.root]?.config?.event === 'silent');
    for (const w of flows) {
      const days = w.graph.nodes[w.graph.root].config.days;
      const quiet = await db.all(`SELECT e.person_id, MAX(e.occurred_at) AS last FROM events e
        WHERE e.account_id = ? AND e.person_id IS NOT NULL
        GROUP BY e.person_id
        HAVING MAX(e.occurred_at) < ?::timestamptz - (? || ' days')::interval
          AND COUNT(*) FILTER (WHERE e.type = 'purchase') > 0
        LIMIT 500`, w.account_id, now.toISOString(), String(days));
      for (const q of quiet) await enroll(w, q.person_id, `silent:${new Date(q.last).toISOString().slice(0, 10)}`, now);
    }
  }

  // ---------- Runner ----------
  async function evaluate(check, value, run, person) {
    const db = getDb();
    switch (check) {
      case 'has_tag': return JSON.parse(person.tags).includes(value);
      case 'stage_is': return person.stage === value;
      case 'has_email': return Boolean(person.email) && !person.unsubscribed;
      case 'purchased': return Boolean(await db.get("SELECT 1 FROM events WHERE person_id = ? AND type = 'purchase' LIMIT 1", person.id));
      case 'purchased_since': return Boolean(await db.get("SELECT 1 FROM events WHERE person_id = ? AND type = 'purchase' AND occurred_at >= ? LIMIT 1", person.id, run.created_at));
      case 'opened': return Boolean(await db.get('SELECT 1 FROM email_log WHERE contact_id = ? AND workflow_id = ? AND created_at >= ? AND opened_at IS NOT NULL LIMIT 1', person.id, run.workflow_id, run.created_at));
      case 'clicked': return Boolean(await db.get('SELECT 1 FROM email_log WHERE contact_id = ? AND workflow_id = ? AND created_at >= ? AND clicked_at IS NOT NULL LIMIT 1', person.id, run.workflow_id, run.created_at));
      default: return false;
    }
  }

  async function addTags(accountId, person, add, remove) {
    const current = JSON.parse(person.tags);
    const plus = add.filter((t) => !current.includes(t));
    const next = [...current.filter((t) => !remove.includes(t)), ...plus];
    await getDb().run('UPDATE contacts SET tags = ? WHERE id = ?', JSON.stringify([...new Set(next)]), person.id);
    await onTagsAdded(accountId, person.id, plus);
    return plus;
  }
  const tagList = (s) => String(s || '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);

  async function step(run, w, node, person, account, now) {
    const db = getDb();
    const c = node.config;
    switch (node.type) {
      case 'wait': {
        if (run.waiting_on !== run.node_id) {
          const wake = new Date(now.getTime() + (c.days * 24 + c.hours) * 3600e3);
          return { stay: true, wake, waiting_on: run.node_id, outcome: 'waiting', detail: `until ${wake.toISOString().slice(0, 16).replace('T', ' ')}` };
        }
        return { next: node.next, outcome: 'waited' };
      }
      case 'email': {
        const r = await messaging.sendToPerson({ account, person, subject: c.subject, body: c.body, workflowId: w.id });
        return { next: node.next, outcome: r.status === 'skipped' ? 'skipped' : r.status === 'failed' ? 'failed' : 'sent', detail: r.reason || '' };
      }
      case 'condition': {
        const yes = await evaluate(c.check, c.value, run, person);
        return { next: yes ? node.yes : node.no, outcome: yes ? 'yes' : 'no' };
      }
      case 'tag': {
        const plus = await addTags(account.id, person, tagList(c.add), tagList(c.remove));
        return { next: node.next, outcome: 'tagged', detail: [plus.length && `+${plus.join(', +')}`, c.remove && `-${tagList(c.remove).join(', -')}`].filter(Boolean).join(' ') };
      }
      case 'subscribe': {
        const exists = await db.get("SELECT 1 FROM subscriptions WHERE person_id = ? AND product = ? AND status = 'active'", person.id, c.product);
        if (!exists) {
          await db.run('INSERT INTO subscriptions (account_id, person_id, product, format) VALUES (?, ?, ?, ?)', account.id, person.id, c.product, 'email');
          await people.logEvent(db, account.id, { person_id: person.id, type: 'subscribe', source: 'workflow', meta: { product: c.product, format: 'email', workflow_id: w.id } });
        }
        return { next: node.next, outcome: exists ? 'already subscribed' : 'subscribed' };
      }
      case 'notify': {
        const who = [person.first_name, person.last_name].filter(Boolean).join(' ') || person.email || `person #${person.id}`;
        await messaging.sendToOwner({ account, subject: `Follow up with ${who} (${w.name})`, body: `${c.message || 'A workflow flagged this person for a personal follow-up.'}\n\n${who}${person.email ? ` <${person.email}>` : ''}\nWorkflow: ${w.name}` });
        return { next: node.next, outcome: 'notified' };
      }
      case 'deal': {
        const p = c.pipeline_id && await db.get('SELECT id FROM pipelines WHERE id = ? AND account_id = ?', c.pipeline_id, account.id);
        if (!p) return { next: node.next, outcome: 'skipped', detail: 'pipeline not found' };
        const stage = await db.get('SELECT id FROM pipeline_stages WHERE pipeline_id = ? ORDER BY position LIMIT 1', p.id);
        const title = messaging.merge(c.title || '{{name}}', person, account).trim() || `Deal for ${person.email}`;
        await db.run(`INSERT INTO deals (account_id, pipeline_id, stage_id, contact_id, title, value_cents, position)
          VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM deals WHERE stage_id = ?))`,
        account.id, p.id, stage.id, person.id, title, Math.round((c.value || 0) * 100), stage.id);
        return { next: node.next, outcome: 'deal created', detail: title };
      }
      default: return { next: null, outcome: 'unknown step' };
    }
  }

  async function processRun(run, w, now) {
    const db = getDb();
    const account = await getAccount(run.account_id);
    let cur = { ...run };
    for (let i = 0; i < MAX_STEPS_PER_TICK; i++) {
      const node = cur.node_id && w.graph.nodes[cur.node_id];
      if (!node) { cur.status = 'done'; break; }
      const person = await db.get('SELECT * FROM contacts WHERE id = ?', cur.person_id);
      if (!person) { cur.status = 'exited'; break; }
      let r;
      try { r = await step(cur, w, node, person, account, now); } catch (e) {
        console.error(`workflow ${w.id} run ${cur.id}:`, e);
        r = { stay: true, wake: new Date(now.getTime() + 3600e3), outcome: 'error', detail: e.message.slice(0, 300) };
      }
      await db.run('INSERT INTO workflow_log (run_id, workflow_id, node_id, outcome, detail, at) VALUES (?, ?, ?, ?, ?, ?)',
        cur.id, w.id, cur.node_id, r.outcome, r.detail || '', now.toISOString());
      if (r.stay) { cur.wake_at = r.wake.toISOString(); cur.waiting_on = r.waiting_on ?? cur.waiting_on; break; }
      cur.node_id = r.next || null;
      cur.waiting_on = null;
      if (!cur.node_id) { cur.status = 'done'; break; }
    }
    await db.run('UPDATE workflow_runs SET node_id = ?, status = ?, wake_at = ?, waiting_on = ?, updated_at = ? WHERE id = ?',
      cur.node_id, cur.status, cur.wake_at instanceof Date ? cur.wake_at.toISOString() : cur.wake_at, cur.waiting_on, now.toISOString(), cur.id);
  }

  // Advances every due run (all workspaces). Safe to call often.
  async function processDue({ now = new Date(), limit = 200 } = {}) {
    await scanSilent(now);
    const due = await getDb().all(`SELECT r.* FROM workflow_runs r JOIN workflows w ON w.id = r.workflow_id
      WHERE r.status = 'active' AND w.status = 'active' AND r.wake_at <= ? ORDER BY r.wake_at LIMIT ?`, now.toISOString(), limit);
    const cache = new Map();
    for (const run of due) {
      if (!cache.has(run.workflow_id)) cache.set(run.workflow_id, parse(await getDb().get('SELECT * FROM workflows WHERE id = ?', run.workflow_id)));
      await processRun(run, cache.get(run.workflow_id), now);
    }
    return { processed: due.length };
  }

  // ---------- Routes ----------
  function register(api) {
    const db = () => getDb();
    const summary = (w) => {
      const t = w.graph.nodes?.[w.graph.root]?.config || {};
      const steps = Object.values(w.graph.nodes || {});
      return { trigger: t.event, triggerLabel: TRIGGERS[t.event], emails: steps.filter((n) => n.type === 'email').length, steps: steps.length - 1 };
    };

    api.get('/workflows', async (req, res) => {
      await seedDefaults(req.accountId);
      const rows = (await db().all(`SELECT w.*,
          (SELECT COUNT(*)::int FROM workflow_runs r WHERE r.workflow_id = w.id AND r.status = 'active') AS active_runs,
          (SELECT COUNT(*)::int FROM workflow_runs r WHERE r.workflow_id = w.id) AS total_runs,
          (SELECT COUNT(*)::int FROM email_log e WHERE e.workflow_id = w.id) AS emails_sent
        FROM workflows w WHERE w.account_id = ? ORDER BY w.status = 'active' DESC, w.id`, req.accountId)).map(parse);
      res.json(rows.map((w) => ({ ...w, graph: undefined, ...summary(w) })));
    });

    api.get('/workflow-templates', (req, res) => {
      res.json(Object.entries(TEMPLATES).map(([key, t]) => {
        const g = t.graph();
        return { key, name: t.name, lever: t.lever, description: t.description, ...summary({ graph: g }) };
      }));
    });

    api.post('/workflows', async (req, res) => {
      const b = req.body || {};
      if (b.funnel_id && !await db().get('SELECT 1 FROM funnels WHERE id = ? AND account_id = ?', id(b.funnel_id), req.accountId)) throw new HttpError(400, 'Funnel not found');
      res.status(201).json({ id: await create(req.accountId, { template: b.template, name: b.name, funnel_id: b.funnel_id ? id(b.funnel_id) : null }) });
    });

    api.get('/workflows/:id', async (req, res) => {
      const w = await getWorkflow(req.accountId, req.params.id);
      const [at, passed] = await Promise.all([
        db().all("SELECT node_id, COUNT(*)::int AS n FROM workflow_runs WHERE workflow_id = ? AND status = 'active' GROUP BY node_id", w.id),
        db().all('SELECT node_id, outcome, COUNT(*)::int AS n FROM workflow_log WHERE workflow_id = ? GROUP BY node_id, outcome', w.id),
      ]);
      const stats = {};
      for (const r of at) (stats[r.node_id] ??= { at: 0, outcomes: {} }).at = r.n;
      for (const r of passed) ((stats[r.node_id] ??= { at: 0, outcomes: {} }).outcomes[r.outcome] = r.n);
      res.json({ ...w, stats, problems: problems(w.graph), triggers: TRIGGERS, conditions: CONDITIONS });
    });

    api.put('/workflows/:id', async (req, res) => {
      const w = await getWorkflow(req.accountId, req.params.id);
      const b = req.body || {};
      const graph = b.graph !== undefined ? normalizeGraph(b.graph, HttpError) : w.graph;
      // Runs sitting on a step that was deleted finish quietly.
      const name = str(b.name ?? w.name, 120).trim() || w.name;
      const lever = LEVER_KEYS.includes(b.lever) ? b.lever : w.lever;
      const p = problems(graph);
      if (w.status === 'active' && p.length) throw new HttpError(400, `Can’t save while live: ${p[0]} Pause the workflow to make bigger changes.`);
      await db().run('UPDATE workflows SET name = ?, lever = ?, graph = ?, updated_at = now() WHERE id = ?', name, lever, JSON.stringify(graph), w.id);
      res.json({ ok: true, graph, problems: p });
    });

    api.put('/workflows/:id/status', async (req, res) => {
      const w = await getWorkflow(req.accountId, req.params.id);
      const status = String(req.body?.status || '');
      if (!['active', 'paused', 'draft'].includes(status)) throw new HttpError(400, 'Status must be active, paused or draft');
      if (status === 'active') {
        const p = problems(w.graph);
        if (p.length) throw new HttpError(400, p.join(' '));
      }
      await db().run('UPDATE workflows SET status = ?, updated_at = now() WHERE id = ?', status, w.id);
      res.json({ ok: true, status });
    });

    // Add people by hand: specific people, everyone with a tag, or everyone at a stage.
    api.post('/workflows/:id/enroll', async (req, res) => {
      const w = await getWorkflow(req.accountId, req.params.id);
      const b = req.body || {};
      let ids = [];
      if (Array.isArray(b.person_ids)) {
        ids = (await db().all('SELECT id FROM contacts WHERE account_id = ? AND id IN (SELECT (jsonb_array_elements_text(?::jsonb))::int)',
          req.accountId, JSON.stringify(b.person_ids.map(Number).filter(Number.isFinite)))).map((r) => r.id);
      } else if (b.tag) {
        ids = (await db().all('SELECT id, tags FROM contacts WHERE account_id = ?', req.accountId)).filter((c) => JSON.parse(c.tags).includes(String(b.tag).toLowerCase())).map((c) => c.id);
      } else if (b.stage) {
        ids = (await db().all('SELECT id FROM contacts WHERE account_id = ? AND stage = ?', req.accountId, String(b.stage))).map((r) => r.id);
      }
      let added = 0;
      for (const pid of ids) if (await enroll(w, pid, `manual:${new Date().toISOString().slice(0, 10)}`)) added++;
      res.json({ added, matched: ids.length, live: w.status === 'active' });
    });

    api.get('/workflows/:id/runs', async (req, res) => {
      const w = await getWorkflow(req.accountId, req.params.id);
      res.json(await db().all(`SELECT r.id, r.person_id, r.node_id, r.status, r.wake_at, r.created_at,
          TRIM(c.first_name || ' ' || c.last_name) AS name, c.email
        FROM workflow_runs r JOIN contacts c ON c.id = r.person_id WHERE r.workflow_id = ? ORDER BY r.id DESC LIMIT 200`, w.id));
    });

    // Sends an email step to the owner, filled in as if they were the recipient.
    api.post('/workflows/:id/test-email', async (req, res) => {
      await getWorkflow(req.accountId, req.params.id);
      const account = await getAccount(req.accountId);
      const [first = '', ...rest] = String(req.user.name || '').split(' ');
      const me = { first_name: first, last_name: rest.join(' '), email: req.user.email };
      const subject = `[Test] ${messaging.merge(str(req.body?.subject, 300), me, account)}`;
      const body = messaging.merge(str(req.body?.body, 20000), me, account);
      if (!body.trim()) throw new HttpError(400, 'Write the email first');
      const mailer = require('./mailer');
      const r = await mailer.sendEmail({ from: process.env.SMTP_FROM || 'no-reply@localhost', to: req.user.email, subject, text: body });
      await getDb().run('INSERT INTO email_log (account_id, to_email, subject, body, status, workflow_id) VALUES (?, ?, ?, ?, ?, ?)',
        req.accountId, req.user.email, subject, body, r.status, null);
      res.json({ ok: true, to: req.user.email, status: r.status });
    });

    api.delete('/workflows/:id', async (req, res) => {
      const w = await getWorkflow(req.accountId, req.params.id);
      await db().run('DELETE FROM workflows WHERE id = ?', w.id);
      res.json({ ok: true });
    });

    // Runs the job queue now. Tests may pass a future `now` to skip waits.
    api.post('/jobs/run', async (req, res) => {
      const now = process.env.ALLOW_TIME_TRAVEL === '1' && req.body?.now ? new Date(req.body.now) : new Date();
      res.json(await processDue({ now }));
    });
  }

  return { register, processDue, onEvent, onTagsAdded, enroll, create, seedDefaults, TEMPLATES, getWorkflow };
}

module.exports = { createWorkflows, normalizeGraph, problems, TEMPLATES, TRIGGERS, CONDITIONS, STEP_TYPES, chain };
