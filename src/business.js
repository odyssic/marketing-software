// Kinds of business Rilly is set up for. The type only changes starting
// points and what's shown: which follow-ups a new workspace gets, whether it
// starts with a deals board (and its stages), which sections are visible,
// and what people are called. Everything stays available in Settings.
const BUSINESS_TYPES = {
  shop: {
    label: 'Shop or maker', hint: 'Sells products online or at markets',
    people: 'customers', hide: ['pipelines', 'calendar', 'members', 'community', 'invoices'],
    workflows: ['care', 'review', 'referral', 'winback'],
  },
  services: {
    label: 'Services', hint: 'Trades, consulting, agencies, freelancers: quotes and jobs',
    people: 'clients', hide: ['members', 'community', 'coupons', 'partners', 'files'],
    workflows: ['inquiry', 'review', 'referral', 'winback'],
    pipeline: { name: 'Jobs', stages: ['New inquiry', 'Quote sent', 'Booked', 'Done'] },
  },
  coach: {
    label: 'Coach, course or creator', hint: 'Coaching, courses, memberships, newsletters, podcasts',
    people: 'clients', hide: [],
    workflows: ['welcome', 'newsletter', 'review', 'referral'],
    pipeline: { name: 'Clients', stages: ['New lead', 'Discovery call', 'Proposal', 'Enrolled'] },
  },
  local: {
    label: 'Local business', hint: 'Restaurant, salon, studio, clinic, gym: people who visit',
    people: 'guests', hide: ['pipelines', 'products', 'members', 'community', 'partners', 'files', 'invoices'],
    workflows: ['welcome', 'review', 'referral', 'winback'],
  },
  nonprofit: {
    label: 'Nonprofit or community', hint: 'Supporters, members, donors, volunteers',
    people: 'supporters', hide: ['pipelines', 'calendar', 'coupons', 'partners', 'invoices', 'files'],
    workflows: ['welcome', 'newsletter', 'winback'],
  },
  other: {
    label: 'Something else', hint: 'Start with everything and turn off what you don’t use',
    people: 'people', hide: ['members', 'community', 'partners'],
    workflows: ['welcome', 'review', 'referral', 'winback'],
    pipeline: { name: 'Sales', stages: ['New lead', 'Contacted', 'Proposal sent', 'Won'] },
  },
};
// Menu sections and features that can be switched off, with a plain line on what each is for.
const OPTIONAL_SECTIONS = {
  calendar: 'Calendar', pipelines: 'Deals', products: 'Products', email: 'Email',
  websites: 'Websites', members: 'Courses and members areas', blog: 'Blog', community: 'Community',
  coupons: 'Coupons', partners: 'Partners and referrals', invoices: 'Invoices and payment links', files: 'Files and downloads',
};
const SECTION_HINTS = {
  calendar: 'people book calls or appointments from your pages', pipelines: 'a board for quotes, jobs or clients you win one at a time',
  products: 'things you sell with checkout', email: 'newsletters and broadcasts', websites: 'a full website with a menu and several pages',
  members: 'courses or members-only pages behind a login', blog: 'articles that help people find you on Google', community: 'a members’ space for posts, comments and events',
  coupons: 'discount codes at checkout', partners: 'pay people for sending customers', invoices: 'bill a client or send a payment link', files: 'PDFs and downloads you give away or sell',
};
// Features already in use never hide, whatever the settings say.
async function usedSections(db, accountId) {
  const n = async (sql) => Number((await db.get(sql, accountId).catch(() => null))?.n || 0);
  const used = {
    websites: await n("SELECT COUNT(*)::int AS n FROM funnels WHERE account_id = ? AND kind = 'website'"),
    members: await n("SELECT COUNT(*)::int AS n FROM funnels WHERE account_id = ? AND kind = 'members'"),
    blog: await n('SELECT COUNT(*)::int AS n FROM blog_posts WHERE account_id = ?'),
    community: await n('SELECT COUNT(*)::int AS n FROM communities WHERE account_id = ?'),
    coupons: await n('SELECT COUNT(*)::int AS n FROM coupons WHERE account_id = ?'),
    partners: await n('SELECT COUNT(*)::int AS n FROM affiliates WHERE account_id = ?'),
    invoices: await n('SELECT COUNT(*)::int AS n FROM invoices WHERE account_id = ?'),
    files: await n('SELECT COUNT(*)::int AS n FROM uploads WHERE account_id = ? AND in_library = 1'),
  };
  return Object.keys(used).filter((k) => used[k] > 0);
}
const typeOf = (key) => BUSINESS_TYPES[key] || BUSINESS_TYPES.other;
const cleanType = (key) => (BUSINESS_TYPES[key] ? key : '');
// Hidden sections as stored; falls back to the type's defaults until changed.
function hiddenSections(account, used = []) {
  let hidden = account.business_type ? typeOf(account.business_type).hide : [];
  try {
    if (account.hidden_sections) {
      const saved = JSON.parse(account.hidden_sections);
      // Saved before the newer features existed: their choices for the old sections, everything new shown.
      hidden = Array.isArray(saved) ? saved : saved.hidden || [];
    }
  } catch { /* the type's defaults */ }
  return hidden.filter((s) => OPTIONAL_SECTIONS[s] && !used.includes(s));
}
const publicTypes = () => Object.entries(BUSINESS_TYPES).map(([key, t]) => ({ key, label: t.label, hint: t.hint, people: t.people, hide: t.hide }));

module.exports = { BUSINESS_TYPES, OPTIONAL_SECTIONS, SECTION_HINTS, typeOf, cleanType, hiddenSections, usedSections, publicTypes };
