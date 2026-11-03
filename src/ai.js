// Drafting with Claude, always in the owner's voice and always approved by a
// person before anything is sent. Without ANTHROPIC_API_KEY the app still
// works: it returns plain template drafts, clearly labelled as such.
const Anthropic = require('@anthropic-ai/sdk').default;
const { zodOutputFormat } = require('@anthropic-ai/sdk/helpers/zod');
const { z } = require('zod');

const MODEL = process.env.AI_MODEL || 'claude-opus-5-5';
let client = null;
const isLive = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const getClient = () => (client ??= new Anthropic());

class AIError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

// The voice profile: sample texts the owner pasted, plus tone notes.
function voiceSystem(account) {
  const samples = JSON.parse(account.voice_samples || '[]').filter((s) => String(s).trim());
  return [
    `You write marketing copy for ${account.name}, a small business run by one person. Write as the owner, in the first person, in their own voice.`,
    samples.length
      ? `Match the voice in these samples of the owner's writing: sentence length, warmth, vocabulary, punctuation habits. Don't copy their content.\n\n${samples.map((s, i) => `<sample ${i + 1}>\n${String(s).slice(0, 4000)}\n</sample ${i + 1}>`).join('\n\n')}`
      : 'No writing samples yet: write plainly and warmly, like a person, not a brand.',
    account.voice_notes ? `Tone notes from the owner: ${account.voice_notes}` : '',
    'Rules: plain text only (no markdown, no emoji unless the samples use them). Keep it short and specific. Never invent facts, prices, discounts, dates or links, and never write testimonials, reviews, customer quotes, ratings, star counts or customer numbers (social proof only ever comes from the owner’s real records): where the owner must fill something in, write a [short placeholder in square brackets]. In emails, greet with {{first_name|there}}; the app fills in the name. Don\'t add an unsubscribe line; the app adds it.',
  ].filter(Boolean).join('\n\n');
}

// One request with a JSON schema as the output format. Refusals are checked
// before reading the text, then the JSON is validated against the schema.
async function structured({ account, prompt, schema, effort = 'medium', system, content }) {
  let r;
  try {
    r = await getClient().messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: system || voiceSystem(account),
      output_config: { format: { type: 'json_schema', schema: zodOutputFormat(schema).schema }, effort },
      messages: [{ role: 'user', content: content || prompt }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new AIError('The AI key isn’t valid. Check ANTHROPIC_API_KEY.', 502);
    if (e instanceof Anthropic.RateLimitError) throw new AIError('The AI is busy right now. Try again in a minute.', 503);
    if (e instanceof Anthropic.APIError) throw new AIError(`The AI couldn’t write a draft (${e.status}). Try again.`, 502);
    throw new AIError('Couldn’t reach the AI. Try again.', 502);
  }
  if (r.stop_reason === 'refusal') throw new AIError('The AI declined to write this one. Try rewording it.', 422);
  if (r.stop_reason === 'max_tokens') throw new AIError('The draft came out too long. Try again.', 502);
  const text = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let parsed;
  try { parsed = schema.safeParse(JSON.parse(text)); } catch { parsed = { success: false }; }
  if (!parsed.success) throw new AIError('The AI didn’t return a usable draft. Try again.', 502);
  return parsed.data;
}

const EmailDraft = z.object({ subject: z.string(), body: z.string() });

// A campaign email for a weekly move.
async function draftEmail({ account, move, audience }) {
  if (!isLive()) return { ...templateEmail(move, account), template: true };
  const out = await structured({
    account,
    prompt: `Write one email for this week's marketing move.\n\nMove: ${move.title}\nWhy: ${move.reason}\nGoal (growth lever): ${move.lever}\nWho receives it: ${audience}\n\nReturn a subject line (under 60 characters) and the email body (under 180 words).`,
    schema: EmailDraft,
  });
  return { ...out, template: false };
}

// One essay or episode transcript → drafts for several channels.
const Repurposed = z.object({
  email: z.object({ subject: z.string(), body: z.string() }),
  product_listing: z.object({ title: z.string(), description: z.string() }),
  social_posts: z.array(z.string()),
  show_notes: z.string(),
});
async function repurpose({ account, text, kind = 'essay' }) {
  if (!isLive()) return { ...templateRepurpose(text), template: true };
  const out = await structured({
    account,
    prompt: `Here is a ${kind === 'episode' ? 'podcast episode transcript' : 'piece of writing'} by the owner. Turn it into drafts for other channels, keeping their voice and only using what's in the text.\n\n<source>\n${text}\n</source>\n\nReturn: an email to subscribers (subject under 60 characters, body under 200 words); a product listing (title and a 2-3 sentence description) for whatever product the piece relates to, with [placeholders] if no product is named; exactly two short social posts (under 280 characters each); and podcast/show notes (a short summary plus 3-5 bullet points).`,
    schema: Repurposed,
  });
  return { ...out, social_posts: out.social_posts.slice(0, 2), template: false };
}

// Describe-to-build: picks a funnel template and writes the main page's words.
async function describeFunnel({ account, sentence, options }) {
  const keys = options.map((o) => o.key);
  if (!isLive()) return { ...guessTemplate(sentence, keys), template_only: true };
  const Plan = z.object({
    template: z.string().describe(`One of: ${keys.join(', ')}`), name: z.string(), headline: z.string(), subheadline: z.string(), button: z.string(), thank_you: z.string(),
  });
  const out = await structured({
    account,
    prompt: `The owner described a funnel they want: "${sentence}"\n\nPick the best starting template:\n${options.map((o) => `- ${o.key}: ${o.label}. ${o.description}`).join('\n')}\n\nThen write: a short funnel name (under 40 characters); the main page's headline (under 12 words, promising one specific result); a one- or two-sentence subheadline; the button text (2-5 words); and the thank-you page headline (under 10 words). No prices or claims that aren't in the description.`,
    schema: Plan,
  });
  // The schema can't force the choice, so an unknown template falls back to a keyword guess.
  const template = keys.includes(out.template) ? out.template : guessTemplate(sentence, keys).template;
  return { ...out, template, name: out.name.slice(0, 60) };
}
const guessTemplate = (sentence, keys) => {
  const s = sentence.toLowerCase();
  const pick = /newsletter|letter|subscribe/.test(s) ? 'newsletter' : /consult|book|call|appointment|quote|session/.test(s) ? 'consult'
    : /upsell|upgrade|one-time offer|downsell/.test(s) ? 'upsell' : /free|guide|download|checklist|sample|lead magnet|ebook/.test(s) ? 'optin'
      : /sell|buy|launch|course|product|kit|\$\d/.test(s) ? 'sales' : 'optin';
  // A short name from the sentence, cut at a whole word.
  const first = sentence.replace(/[.!?].*$/, '').trim();
  const name = first.length <= 40 ? first : first.slice(0, 41).replace(/\s+\S*$/, '');
  return { template: keys.includes(pick) ? pick : keys[0], name: name || 'New funnel' };
};

// ---------- Leads from anything ----------
// Pasted text (an email thread, a sign-up sheet, notes, cells copied from a
// spreadsheet) or a photo (business cards, a paper sign-up sheet) → people.
// Only people actually in the source; unknown fields stay empty.
const LEAD_FIELDS = ['first_name', 'last_name', 'email', 'phone', 'city', 'region', 'country', 'note'];
const Leads = z.object({ people: z.array(z.object(Object.fromEntries(LEAD_FIELDS.map((f) => [f, z.string()])))) });
const LEADS_SYSTEM = 'You pull contact details out of material a small-business owner gives you, so they can add the people to their contact list. Extract only people who actually appear in the material. Never invent, guess or complete an email address, phone number or name: copy exactly what is there, and use an empty string for anything not shown. Skip the owner themself and obvious no-reply or system addresses. Put a person’s company, role or anything useful said about them (what they asked for, where you met) in note, in a few plain words.';
async function extractLeads({ account, text = '', images = [] }) {
  if (!isLive()) {
    if (images.length) throw new AIError('Reading photos needs the AI. Add an ANTHROPIC_API_KEY, or paste the text instead.', 422);
    return { people: plainLeads(text), template: true };
  }
  const content = [
    ...images.map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } })),
    { type: 'text', text: `${text ? `<material>\n${text}\n</material>\n\n` : ''}List every person in ${images.length ? 'the image' : 'the material'}${images.length && text ? 's and the material' : ''} with these fields: ${LEAD_FIELDS.join(', ')}.` },
  ];
  const out = await structured({ account, system: LEADS_SYSTEM, content, schema: Leads, effort: 'low' });
  return { people: out.people.map(cleanLead).filter((p) => p.email || p.first_name || p.last_name || p.phone), template: false };
}
const EMAIL_G = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_RE = /\+?\(?\d[\d\s().-]{7,}\d/;
const cleanLead = (p) => Object.fromEntries(LEAD_FIELDS.map((f) => [f, String(p[f] || '').trim().slice(0, f === 'note' ? 500 : 120)]));
// Without the AI: find every email address and take a name from the same line
// ("Ann Lee <ann@x.com>", "Ann Lee, ann@x.com, 555-0100").
function plainLeads(text) {
  const seen = new Set(), out = [];
  for (const line of String(text).split(/\r?\n/)) {
    for (const email of line.match(EMAIL_G) || []) {
      const key = email.toLowerCase();
      if (seen.has(key) || /no-?reply|mailer-daemon/i.test(email)) continue;
      seen.add(key);
      const rest = line.replace(EMAIL_G, ' ').replace(PHONE_RE, ' ');
      const name = (rest.split(/[\t,;|<>()"]+/).map((x) => x.trim()).find((x) => /^[\p{L}][\p{L}' .-]{1,60}$/u.test(x) && !/^(mailto|email|e-mail|name|phone)$/i.test(x)) || '').replace(/\s+/g, ' ');
      const [first_name = '', ...last] = name.split(' ');
      out.push(cleanLead({ first_name, last_name: last.join(' '), email, phone: (line.match(PHONE_RE) || [''])[0] }));
    }
  }
  return out;
}

// ---------- Template fallbacks (no AI key) ----------
const TEMPLATE_EMAILS = {
  stale_inquiries: ['Following up on your question', 'Hi {{first_name|there}},\n\nYou asked me about [what they asked about] a little while ago and I wanted to make sure you got what you needed.\n\n[A helpful, specific answer]\n\nIf you’d like to go ahead, just reply and I’ll take care of it.\n\n'],
  first_order: ['A little welcome gift', 'Hi {{first_name|there}},\n\nThanks for being here. If you’ve been thinking about your first order, here’s [your offer] to make it easy:\n\n[Product and link]\n\nAny questions, just reply.\n\n'],
  referral: ['Know someone who’d love this?', 'Hi {{first_name|there}},\n\nThank you for your recent order. If a friend would enjoy it too, share this link and you’ll both get [your thank-you]:\n\n[Referral link]\n\n'],
  audience_invite: ['Something free for you', 'Hi {{first_name|there}},\n\nI put together [free guide or sample] and thought of you. You can get it here:\n\n[Link]\n\n'],
  addon: ['Pairs well with your order', 'Hi {{first_name|there}},\n\nIf you’re enjoying your [recent purchase], [matching add-on] is the natural next piece:\n\n[Product and link]\n\n'],
  bundle: ['A set you might like', 'Hi {{first_name|there}},\n\nA lot of people who bought what you did end up getting [the companion piece]. I’ve put them together as a set: [bundle and price].\n\n[Link]\n\n'],
  winback: ['It’s been a while', 'Hi {{first_name|there}},\n\nIt’s been a little while and I wanted to say hello. Here’s what’s new:\n\n[What’s new]\n\nIf anything catches your eye, just reply.\n\n'],
  newsletter_invite: ['Want the letter?', 'Hi {{first_name|there}},\n\nI send a short letter [how often] with [what’s inside]. Since you’ve bought from me before, I thought you might like it:\n\n[Subscribe link]\n\n'],
};
function templateEmail(move, account) {
  const [subject, body] = TEMPLATE_EMAILS[move.key] || ['A quick note', 'Hi {{first_name|there}},\n\n[Your message]\n\n'];
  return { subject, body: `${body}${account.from_name || account.name}` };
}
function templateRepurpose(text) {
  const first = String(text).trim().split(/(?<=[.!?])\s+/).slice(0, 2).join(' ');
  return {
    email: { subject: '[Subject from your piece]', body: `Hi {{first_name|there}},\n\n${first}\n\n[Two or three sentences from the piece]\n\n[Link to the full piece]` },
    product_listing: { title: '[Product name]', description: `${first} [How the product relates]` },
    social_posts: [`${first.slice(0, 200)} [link]`, '[A second angle on the same idea] [link]'],
    show_notes: `${first}\n\n• [Point one]\n• [Point two]\n• [Point three]`,
  };
}

module.exports = { isLive, draftEmail, repurpose, describeFunnel, guessTemplate, extractLeads, plainLeads, voiceSystem, AIError, MODEL };
