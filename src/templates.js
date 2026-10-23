// Starter funnels a user can pick when creating a new funnel.
// Steps link to each other by `key`: `next` is the "yes" exit (form submit,
// purchase, Next button) and `no` the "No thanks" exit. If `next` is left out,
// the step leads to the one listed after it.
const id = () => Math.random().toString(36).slice(2, 10);

const TEMPLATES = {
  optin: {
    label: 'Lead magnet (opt-in + thank you)',
    steps: () => [
      {
        name: 'Opt-in page',
        slug: 'optin',
        settings: { accent: '#4f46e5' },
        blocks: [
          { id: id(), type: 'heading', text: 'Get the free guide: 7 steps to your first 100 customers', align: 'center' },
          { id: id(), type: 'text', text: 'Enter your email below and we will send it straight to your inbox.', align: 'center' },
          { id: id(), type: 'form', buttonLabel: 'Send me the guide', collectName: true, collectPhone: false, tag: 'lead' },
          { id: id(), type: 'text', text: 'We respect your privacy. Unsubscribe anytime.', align: 'center' },
        ],
      },
      {
        name: 'Thank you page',
        slug: 'thank-you',
        settings: { accent: '#4f46e5' },
        blocks: [
          { id: id(), type: 'heading', text: 'You are in! 🎉', align: 'center' },
          { id: id(), type: 'text', text: 'Check your inbox in the next few minutes.', align: 'center' },
        ],
      },
    ],
  },
  sales: {
    label: 'Sales page (video + call to action)',
    steps: () => [
      {
        name: 'Sales page',
        slug: 'offer',
        settings: { accent: '#16a34a' },
        blocks: [
          { id: id(), type: 'heading', text: 'The course that finally makes it click', align: 'center' },
          { id: id(), type: 'video', url: '' },
          { id: id(), type: 'text', text: 'Explain the problem, your solution, and why now.', align: 'center' },
          { id: id(), type: 'button', label: 'Yes, I want in', url: '#next', align: 'center' },
        ],
      },
      {
        name: 'Order confirmation',
        slug: 'confirmed',
        settings: { accent: '#16a34a' },
        blocks: [{ id: id(), type: 'heading', text: 'Thanks for your order!', align: 'center' }],
      },
    ],
  },
  pricing: {
    label: 'Pricing page (offer card + checkout)',
    steps: () => [
      {
        name: 'Pricing',
        slug: 'pricing',
        settings: { accent: '#14b8a6', background: '#ffffff', width: 960 },
        blocks: [
          { id: id(), type: 'hero', eyebrow: 'Pricing', text: 'Simple pricing.\nEverything included.', background: '#0d9488', textColor: '#ffffff' },
          {
            id: id(), type: 'pricing', productId: null,
            badge: 'LIMITED TIME OFFER', compareText: '$190 per year', billingText: '',
            note: '🔥 Pay once. No monthly fees.',
            featuresTitle: 'Everything you need to get started.',
            features: 'Drag-and-drop page editor\nReady-made templates\nUnlimited funnels\nLead capture forms\nEmail broadcasts\nContact management\nSales & checkout pages\nPriority support',
            buttonLabel: 'Get Instant Access Now', buttonSubtext: '14-day money-back guarantee', buttonColor: '#ff7849',
          },
        ],
      },
      {
        name: 'Thank you',
        slug: 'thank-you',
        settings: { accent: '#14b8a6' },
        blocks: [
          { id: id(), type: 'heading', text: 'Payment received. Welcome aboard! 🎉', align: 'center' },
          { id: id(), type: 'text', text: 'A receipt is on its way to your inbox.', align: 'center' },
        ],
      },
    ],
  },
  upsell: {
    label: 'Sales + upsell / downsell (branching)',
    steps: () => [
      {
        key: 'sales', name: 'Sales page', slug: 'offer', next: 'upsell',
        settings: { accent: '#4f46e5', width: 960 },
        blocks: [
          { id: id(), type: 'hero', eyebrow: 'New', text: 'The main offer', subtext: 'Describe the result your buyer gets.', background: '#4338ca', textColor: '#ffffff' },
          { id: id(), type: 'pricing', productId: null, badge: 'TODAY ONLY', compareText: '', billingText: '', note: '',
            featuresTitle: 'What you get:', features: 'Benefit one\nBenefit two\nBenefit three\nBenefit four',
            buttonLabel: 'Buy now', buttonSubtext: '30-day money-back guarantee', buttonColor: '#f97316' },
        ],
      },
      {
        key: 'upsell', name: 'Upsell', slug: 'upgrade', next: 'thanks', no: 'downsell',
        settings: { accent: '#16a34a' },
        blocks: [
          { id: id(), type: 'heading', text: 'Wait! Add the VIP upgrade?', align: 'center' },
          { id: id(), type: 'text', text: 'One-time offer, only on this page.', align: 'center' },
          { id: id(), type: 'pricing', productId: null, badge: 'ONE-TIME OFFER', compareText: '', billingText: '', note: '',
            featuresTitle: '', features: '', buttonLabel: 'Yes, upgrade me', buttonSubtext: '', buttonColor: '#16a34a' },
          { id: id(), type: 'button', label: 'No thanks, I’ll skip this', url: '#no', align: 'center' },
        ],
      },
      {
        key: 'downsell', name: 'Downsell', slug: 'lite', next: 'thanks', no: 'thanks',
        settings: { accent: '#0ea5e9' },
        blocks: [
          { id: id(), type: 'heading', text: 'How about the lite version instead?', align: 'center' },
          { id: id(), type: 'pricing', productId: null, badge: 'LAST CHANCE', compareText: '', billingText: '', note: '',
            featuresTitle: '', features: '', buttonLabel: 'Yes, add the lite version', buttonSubtext: '', buttonColor: '#0ea5e9' },
          { id: id(), type: 'button', label: 'No thanks', url: '#no', align: 'center' },
        ],
      },
      {
        key: 'thanks', name: 'Thank you', slug: 'thank-you', next: null,
        settings: {},
        blocks: [{ id: id(), type: 'heading', text: 'Thanks for your order! 🎉', align: 'center' }],
      },
    ],
  },
  blank: {
    label: 'Blank (one empty page)',
    steps: () => [{ name: 'Page 1', slug: 'page-1', settings: {}, blocks: [] }],
  },
};

module.exports = { TEMPLATES };
