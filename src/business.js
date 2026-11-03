// Kinds of business Fourfold is set up for. The type only changes starting
// points and what's shown: which follow-ups a new workspace gets, whether it
// starts with a deals board (and its stages), which sections are visible,
// and what people are called. Everything stays available in Settings.
const BUSINESS_TYPES = {
  shop: {
    label: 'Shop or maker', hint: 'Sells products online or at markets',
    people: 'customers', hide: ['pipelines'],
    workflows: ['care', 'review', 'referral', 'winback'],
  },
  services: {
    label: 'Services', hint: 'Trades, consulting, agencies, freelancers: quotes and jobs',
    people: 'clients', hide: [],
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
    people: 'guests', hide: ['pipelines', 'products'],
    workflows: ['welcome', 'review', 'referral', 'winback'],
  },
  nonprofit: {
    label: 'Nonprofit or community', hint: 'Supporters, members, donors, volunteers',
    people: 'supporters', hide: ['pipelines'],
    workflows: ['welcome', 'newsletter', 'winback'],
  },
  other: {
    label: 'Something else', hint: 'Start with everything and turn off what you don’t use',
    people: 'people', hide: [],
    workflows: ['welcome', 'review', 'referral', 'winback'],
    pipeline: { name: 'Sales', stages: ['New lead', 'Contacted', 'Proposal sent', 'Won'] },
  },
};
const OPTIONAL_SECTIONS = { pipelines: 'Deals', products: 'Products', email: 'Email' };
const typeOf = (key) => BUSINESS_TYPES[key] || BUSINESS_TYPES.other;
const cleanType = (key) => (BUSINESS_TYPES[key] ? key : '');
// Hidden sections as stored; falls back to the type's defaults until changed.
function hiddenSections(account) {
  try { if (account.hidden_sections) return JSON.parse(account.hidden_sections).filter((s) => OPTIONAL_SECTIONS[s]); } catch { /* fall through */ }
  return account.business_type ? typeOf(account.business_type).hide : [];
}
const publicTypes = () => Object.entries(BUSINESS_TYPES).map(([key, t]) => ({ key, label: t.label, hint: t.hint, people: t.people, hide: t.hide }));

module.exports = { BUSINESS_TYPES, OPTIONAL_SECTIONS, typeOf, cleanType, hiddenSections, publicTypes };
