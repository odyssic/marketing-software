// Starter funnels a user can pick when creating a new funnel.
// Steps link to each other by `key`: `next` is the "yes" exit (form submit,
// purchase, Next button) and `no` the "No thanks" exit. If `next` is left out,
// the step leads to the one listed after it.
const id = () => Math.random().toString(36).slice(2, 10);

// Contemporary looks: a warm, editorial serif and a clean modern sans.
const ELEGANT = { font: 'elegant', background: '#fbf9f6', textColor: '#1f1b16', accent: '#7a4e24', width: 1040 };
const MODERN = { font: 'modern', background: '#ffffff', textColor: '#0b1220', accent: '#111827', width: 1040 };

const TEMPLATES = {
  list_page: {
    label: 'Join my list',
    description: 'A sign-up page with a reason to join (a discount, a free guide or early news), what they get, and a welcome series.',
    workflows: ['welcome'],
    steps: () => [
      {
        name: 'Join the list', slug: 'join', settings: { width: 760, accent: '#0f766e' },
        blocks: [
          { id: id(), type: 'hero', style: 'wave', eyebrow: 'Welcome offer', text: 'Get 10% off your first order', subtext: 'Join the list and your code arrives straight away.' },
          { id: id(), type: 'form', buttonLabel: 'Get my code', collectName: true, collectPhone: false, purpose: 'Sign up', tag: 'lead' },
          { id: id(), type: 'text', text: 'No spam. One click to unsubscribe, any time.', align: 'center' },
          { id: id(), type: 'bullets', title: 'What you’ll get', items: '10% off your first order\nFirst look at new arrivals\nShort, useful tips', style: 'check', align: 'center' },
          { id: id(), type: 'reviews', limit: 2 },
          { id: id(), type: 'text', text: '', align: 'center' },
        ],
      },
      {
        name: 'Thank you', slug: 'thank-you', settings: { width: 760, accent: '#0f766e' },
        blocks: [
          { id: id(), type: 'heading', text: 'You’re in!', align: 'center' },
          { id: id(), type: 'text', text: 'Check your inbox in the next few minutes.', align: 'center' },
        ],
      },
    ],
  },
  elegant_guide: {
    label: 'Elegant free guide',
    description: 'A refined page for a free PDF or guide: photo beside the headline, what’s inside, and a welcome series.',
    workflows: ['welcome'],
    steps: () => [
      {
        name: 'Free guide', slug: 'guide', settings: { ...ELEGANT },
        blocks: [
          { id: id(), type: 'hero', style: 'split', eyebrow: 'Free guide', text: 'The [number] [things] every [reader] should know', subtext: 'A short, beautifully made guide to [the topic]. Yours free, straight to your inbox.', image: '', imageAlt: 'The guide', background: '#7a4e24', textColor: '#ffffff' },
          { id: id(), type: 'form', buttonLabel: 'Send me the guide', collectName: true, collectPhone: false, purpose: 'Sign up', tag: 'lead', deliverName: 'the free guide' },
          { id: id(), type: 'text', text: 'One email with the guide, then an occasional note. Unsubscribe anytime.', align: 'center' },
          { id: id(), type: 'divider' },
          { id: id(), type: 'bullets', title: 'Inside the guide', items: '[First thing they’ll learn]\n[Second thing they’ll learn]\n[Third thing they’ll learn]\n[A bonus they won’t expect]', style: 'check', align: 'center' },
          { id: id(), type: 'reviews', limit: 1 },
        ],
      },
      {
        name: 'Thank you', slug: 'thank-you', settings: { ...ELEGANT },
        blocks: [
          { id: id(), type: 'hero', style: 'minimal', eyebrow: 'Thank you', text: 'It’s on its way', subtext: 'Check your inbox in the next few minutes. If it’s not there, look in Promotions or Spam.', background: '#7a4e24', textColor: '#ffffff' },
        ],
      },
    ],
  },
  modern_sales: {
    label: 'Modern sales page',
    description: 'A clean, confident sales page with an offer stack, then checkout and a thank-you, with care tips after they buy.',
    workflows: ['care'],
    steps: () => [
      {
        name: 'Sales page', slug: 'offer', settings: { ...MODERN },
        blocks: [
          { id: id(), type: 'hero', style: 'minimal', eyebrow: 'New', text: '[The result they want], without [the thing they dread]', subtext: '[Product name] is the simplest way to [outcome]. Built for [who it’s for].', button: 'See what’s included', url: '#next', background: '#111827', textColor: '#ffffff' },
          { id: id(), type: 'image', url: '', alt: '[Product] preview', align: 'center' },
          { id: id(), type: 'cards', items: '[Benefit one] | One line on why it matters.\n[Benefit two] | One line on why it matters.\n[Benefit three] | One line on why it matters.' },
          { id: id(), type: 'reviews', limit: 3 },
          { id: id(), type: 'offer', title: 'Everything you get', items: '[Main product] | $[value]\n[Bonus one] | $[value]\n[Bonus two] | $[value]', showTotal: true, priceLabel: 'Today', price: '$[price]', buttonLabel: 'Get it now', url: '#next', note: '30-day money-back guarantee' },
        ],
      },
      {
        name: 'Checkout', slug: 'checkout', settings: { ...MODERN, width: 860 },
        blocks: [
          { id: id(), type: 'hero', style: 'minimal', eyebrow: 'Checkout', text: 'You’re one step away', subtext: '', background: '#111827', textColor: '#ffffff' },
          { id: id(), type: 'pricing', productId: null, badge: '', compareText: '', billingText: '', note: '', featuresTitle: 'Included:', features: '[Main product]\n[Bonus one]\n[Bonus two]\nLifetime updates', buttonLabel: 'Complete my order', buttonSubtext: '30-day money-back guarantee', buttonColor: '#111827' },
        ],
      },
      {
        name: 'Thank you', slug: 'thank-you', settings: { ...MODERN },
        blocks: [
          { id: id(), type: 'hero', style: 'minimal', eyebrow: 'Order confirmed', text: 'Welcome aboard', subtext: 'Your receipt and everything you need are on their way to your inbox.', background: '#111827', textColor: '#ffffff' },
        ],
      },
    ],
  },
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
          { id: id(), type: 'text', text: '', align: 'center' },
          {
            id: id(), type: 'pricing', productId: null,
            badge: 'LIMITED TIME OFFER', compareText: '$190 per year', billingText: '',
            note: '🔥 Pay once. No monthly fees.',
            featuresTitle: 'Everything you need to get started.',
            features: 'Drag-and-drop page editor\nReady-made templates\nUnlimited funnels\nLead capture forms\nEmail broadcasts\nContact management\nSales & checkout pages\nPriority support',
            buttonLabel: 'Get Instant Access Now', buttonSubtext: '14-day money-back guarantee', buttonColor: '#ff7849',
          },
          { id: id(), type: 'cards', numbered: false, items: 'Secure checkout | Pay by card, Apple Pay or Google Pay.\nReceipt straight away | Your order details arrive by email.\nReal people | Questions? Just reply to your receipt.' },
        ],
      },
      {
        name: 'Thank you',
        slug: 'thank-you',
        settings: { accent: '#14b8a6', width: 880 },
        blocks: [
          { id: id(), type: 'hero', style: 'wave', eyebrow: 'Thank you', text: 'Payment received. Welcome aboard!', subtext: 'A receipt is on its way to your inbox.' },
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
        name: 'Request', slug: 'request', settings: { accent: '#0f766e', width: 880 },
        blocks: [
          { id: id(), type: 'hero', style: 'wave', eyebrow: 'Free, no obligation', text: 'Book a free 20-minute consultation', subtext: 'Tell us a little about what you need and we’ll get back to you within one business day.' },
          { id: id(), type: 'cards', numbered: true, items: 'Tell us what you need | A few lines is plenty.\nWe reply within a day | With questions or a first idea.\nYou decide | A clear price, and no pressure.' },
          { id: id(), type: 'form', buttonLabel: 'Request my consultation', collectName: true, collectPhone: false, collectMessage: true, purpose: 'Inquiry', tag: 'consult-request' },
          { id: id(), type: 'text', text: '', align: 'center' },
        ],
      },
      {
        name: 'Thanks', slug: 'thanks', settings: { accent: '#0f766e', width: 880 },
        blocks: [{ id: id(), type: 'hero', style: 'wave', eyebrow: 'Request sent', text: 'Thanks! We’ll be in touch soon.', subtext: 'Check your inbox for a confirmation.' }],
      },
    ],
  },
  // Visitors pick a time from the owner's calendar (Calendar → your hours).
  booking: {
    label: 'Book a call',
    description: 'Visitors pick an open time from your calendar and book. They get a confirmation and a reminder; you get a notice.',
    workflows: [],
    steps: () => [
      {
        name: 'Book', slug: 'book', settings: { accent: '#1f7f78', width: 880 },
        blocks: [
          { id: id(), type: 'hero', style: 'wave', eyebrow: 'Book online', text: 'Book a free call', subtext: 'Pick a time that suits you. You’ll get a confirmation straight away and a reminder the day before.' },
          { id: id(), type: 'cards', numbered: true, items: 'Pick a time | Open times are shown in your own time zone.\nGet a confirmation | Straight to your inbox, with a link to change it.\nWe talk | A reminder arrives the day before.' },
          { id: id(), type: 'booking', heading: 'Choose a time', buttonLabel: 'Confirm my call', collectPhone: true, askNote: true, tag: 'booked' },
          { id: id(), type: 'text', text: '', align: 'center' },
        ],
      },
      {
        name: 'Booked', slug: 'booked', settings: { accent: '#1f7f78', width: 880 },
        blocks: [{ id: id(), type: 'hero', style: 'wave', eyebrow: 'Booked', text: 'You’re booked. Talk soon!', subtext: 'Your confirmation is in your inbox, with a link to change the time if you need to.' }],
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
