// Starter funnels a user can pick when creating a new funnel.
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
  blank: {
    label: 'Blank (one empty page)',
    steps: () => [{ name: 'Page 1', slug: 'page-1', settings: {}, blocks: [] }],
  },
};

module.exports = { TEMPLATES };
