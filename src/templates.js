// Starter funnels a user can pick when creating a new funnel.
// Steps link to each other by `key`: `next` is the "yes" exit (form submit,
// purchase, Next button) and `no` the "No thanks" exit. If `next` is left out,
// the step leads to the one listed after it.
const id = () => Math.random().toString(36).slice(2, 10);

const TEMPLATES = {
  optin: {
    label: 'Lead magnet',
    description: 'Trade a free guide or sample for an email, then welcome them with a 3-email series.',
    workflows: ['welcome'],
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
    label: 'Product sale',
    description: 'A sales page with video and a call to action, then care tips after they buy.',
    workflows: ['care'],
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
    label: 'Pricing page + checkout',
    description: 'One offer card with Stripe checkout and a thank-you page, then care tips after they buy.',
    workflows: ['care'],
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
    label: 'Sale with upsell / downsell',
    description: 'Sales page, a one-time upgrade offer, a lighter fallback offer, and care tips after.',
    workflows: ['care'],
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
  newsletter: {
    label: 'Newsletter signup',
    description: 'A simple page that subscribes people to your newsletter and sends a welcome email.',
    workflows: ['newsletter'],
    steps: () => [
      {
        name: 'Subscribe', slug: 'subscribe', settings: { accent: '#10b981' },
        blocks: [
          { id: id(), type: 'heading', text: 'A short letter worth opening', align: 'center' },
          { id: id(), type: 'text', text: 'Stories, new work and the occasional subscriber-only offer. About twice a month.', align: 'center' },
          { id: id(), type: 'form', buttonLabel: 'Subscribe', collectName: true, collectPhone: false, purpose: 'Newsletter', newsletter: 'Newsletter', tag: 'newsletter' },
          { id: id(), type: 'text', text: 'Unsubscribe anytime with one click.', align: 'center' },
        ],
      },
      {
        name: 'Welcome', slug: 'welcome', settings: { accent: '#10b981' },
        blocks: [{ id: id(), type: 'heading', text: 'You’re on the list! 📬', align: 'center' }, { id: id(), type: 'text', text: 'Your first letter is on its way.', align: 'center' }],
      },
    ],
  },
  consult: {
    label: 'Consultation request',
    description: 'A request form for services. Sends an instant reply, tells you right away, and nudges you if there’s no sale in 2 days.',
    workflows: ['inquiry'],
    steps: () => [
      {
        name: 'Request', slug: 'request', settings: { accent: '#0f766e' },
        blocks: [
          { id: id(), type: 'heading', text: 'Book a free 20-minute consultation', align: 'center' },
          { id: id(), type: 'text', text: 'Tell us a little about what you need and we’ll get back to you within one business day.', align: 'center' },
          { id: id(), type: 'form', buttonLabel: 'Request my consultation', collectName: true, collectPhone: true, collectMessage: true, purpose: 'Inquiry', tag: 'consult-request' },
        ],
      },
      {
        name: 'Thanks', slug: 'thanks', settings: { accent: '#0f766e' },
        blocks: [{ id: id(), type: 'heading', text: 'Thanks! We’ll be in touch soon.', align: 'center' }, { id: id(), type: 'text', text: 'Check your inbox for a confirmation.', align: 'center' }],
      },
    ],
  },
  blank: {
    label: 'Blank',
    description: 'One empty page to build from scratch.',
    workflows: [],
    steps: () => [{ name: 'Page 1', slug: 'page-1', settings: {}, blocks: [] }],
  },
};

module.exports = { TEMPLATES };
