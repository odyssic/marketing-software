// Starter funnels a user can pick when creating a new funnel.
// Steps link to each other by `key`: `next` is the "yes" exit (form submit,
// purchase, Next button) and `no` the "No thanks" exit. If `next` is left out,
// the step leads to the one listed after it.
//
// Each page follows the shape that converts: a bold cover banner with the
// offer drawn as a mockup (or a photo) and the form or button right there;
// then what they get, who it's from, proof, answers to doubts, and the ask
// again at the end. Every section sits on its own band of colour. Proof is
// only ever the owner's real, approved testimonials; there are no countdowns
// or made-up numbers.
const id = () => Math.random().toString(36).slice(2, 10);

// Contemporary looks: a warm, editorial serif and a clean modern sans.
const ELEGANT = { font: 'elegant', background: '#fbf9f6', textColor: '#1f1b16', accent: '#8a5a2b', width: 1080 };
const MODERN = { font: 'modern', background: '#ffffff', textColor: '#0b1220', accent: '#4338ca', width: 1080 };
const FRESH = { font: 'modern', background: '#ffffff', textColor: '#10231f', accent: '#0f766e', width: 1080 };

// Small builders so each template reads like the page it makes.
const cover = (o) => ({ id: id(), type: 'hero', style: 'cover', textColor: '#ffffff', ...o });
const form = (o) => ({ id: id(), type: 'form', collectName: true, collectPhone: false, purpose: 'Sign up', tag: 'lead', ...o });
const feature = (o) => ({ id: id(), type: 'feature', ...o });
const cards = (items, o = {}) => ({ id: id(), type: 'cards', items: items.map((x) => x.join(' | ')).join('\n'), ...o });
const head = (text, o = {}) => ({ id: id(), type: 'heading', text, size: 'medium', align: 'center', ...o });
const faq = (items, o = {}) => ({ id: id(), type: 'faq', title: 'Questions, answered', items: items.map((x) => x.join(' | ')).join('\n'), ...o });
const bio = (o = {}) => ({ id: id(), type: 'bio', eyebrow: 'Who’s behind it', name: '', role: '', text: 'A few warm sentences about who you are, why you do this and who you help. People buy from people.', ...o });
const reviews = (limit = 3, o = {}) => ({ id: id(), type: 'reviews', limit, ...o });
const cta = (o) => ({ id: id(), type: 'cta', band: 'dark', ...o });
const guarantee = (o = {}) => ({ id: id(), type: 'guarantee', days: 30, title: 'Try it for 30 days, on us', text: 'If it isn’t right for you, email within 30 days for a full refund. No forms, no hard feelings.', ...o });
const compare = (o) => ({ id: id(), type: 'compare', ...o });
// A thank-you page that tells people exactly what happens next.
const thanks = (eyebrow, text, subtext, steps, settings, { bg = '#0f3d38', ...o } = {}) => ({
  name: 'Thank you', slug: 'thank-you', settings, ...o,
  blocks: [
    cover({ eyebrow, text, subtext, background: bg, mockup: 'none' }),
    head('What happens next'),
    cards(steps, { numbered: true }),
  ],
});
const NEXT_EMAIL = [['Check your inbox', 'It arrives within a few minutes. Not there? Look in Promotions or Spam.'], ['Save our address', 'Add us to your contacts so the next emails reach you.'], ['Hit reply', 'Tell us what you’re hoping for. A real person reads every reply.']];

const TEMPLATES = {
  list_page: {
    label: 'Join my list',
    description: 'A bold sign-up page with a reason to join (a discount, a free guide or early news), what they get, and a welcome series.',
    workflows: ['welcome'],
    steps: () => [
      {
        name: 'Join the list', slug: 'join', settings: { ...FRESH, width: 1040 },
        blocks: [
          cover({ eyebrow: 'Welcome offer', text: 'Get *10% off* your first order', subtext: 'Join the list and your code arrives straight away.', items: '10% off your first order, sent right now\nFirst look at new arrivals\nShort, useful tips. Never spam.', formHere: true, mockup: 'coupon', mockupLabel: '10% OFF', mockupTitle: 'your first order', note: 'One click to unsubscribe, any time.', background: '#0f3d38' }),
          form({ buttonLabel: 'Get my code' }),
          { id: id(), type: 'text', text: '', align: 'center' },
          reviews(3, { band: 'soft' }),
        ],
      },
      thanks('You’re in', 'You’re on the list', 'Welcome! Your first email is on its way.', NEXT_EMAIL, { ...FRESH, width: 1040 }),
    ],
  },
  elegant_guide: {
    label: 'Free guide',
    description: 'The classic lead magnet: your guide drawn as a book cover beside the sign-up form, what’s inside, who it’s from, and a welcome series.',
    workflows: ['welcome'],
    steps: () => [
      {
        name: 'Free guide', slug: 'guide', settings: { ...ELEGANT },
        blocks: [
          cover({ eyebrow: 'Free guide', text: 'The *[7 things]* every [reader] should know', subtext: 'A short, beautifully made guide to [the topic]. Yours free, straight to your inbox.', formHere: true, mockup: 'book', mockupLabel: 'Free guide', background: '#3b2414' }),
          form({ buttonLabel: 'Send me the free guide', deliverName: 'the free guide' }),
          feature({ band: 'soft', eyebrow: 'Inside the guide', title: 'Everything you need to *[get the result]*', text: 'No fluff and no jargon: just the things that make the biggest difference, in the order you need them.', items: '[The first thing they’ll learn]\n[The second thing they’ll learn]\n[The third thing they’ll learn]\n[A bonus they won’t expect]', mockup: 'workbook', mockupTitle: 'Your checklist', mockupLabel: 'Bonus checklist' }),
          head('How it works'),
          cards([['Enter your email', 'Takes ten seconds. Free, and no card.'], ['Open the guide', 'It lands in your inbox a minute later.'], ['Start today', 'Pick one idea and try it this week.']], { numbered: true }),
          bio({ band: 'soft' }),
          reviews(3),
          faq([['Is it really free?', 'Yes. No card and no catch: just your email so I can send it.'], ['How do I get it?', 'It arrives in your inbox a minute after you sign up, as a link you can open on any device.'], ['Will you email me?', 'An occasional short note with ideas and news. One click to unsubscribe, any time.']]),
          cta({ title: 'Get your *free copy*', text: 'It takes ten seconds, and it’s yours to keep.', button: 'Send me the guide', buttonSub: 'Free · Instant download', url: '#form' }),
        ],
      },
      thanks('Thank you', 'It’s on its way', 'Check your inbox in the next few minutes. If it’s not there, look in Promotions or Spam.', NEXT_EMAIL, { ...ELEGANT }, { bg: '#3b2414' }),
    ],
  },
  modern_sales: {
    label: 'Long sales page',
    description: 'A full sales page that answers every doubt: bold promise, before and after, what’s included, who it’s from, offer stack, guarantee, FAQ. Then checkout and a thank-you, with care tips after they buy.',
    workflows: ['care'],
    steps: () => [
      {
        name: 'Sales page', slug: 'offer', settings: { ...MODERN },
        blocks: [
          cover({ eyebrow: 'New', text: '[The result they want], *without [the thing they dread]*', subtext: '[Product name] is the simplest way to [outcome]. Built for [who it’s for].', items: '[Biggest benefit]\n[Second benefit]\n[Third benefit]', button: 'Get [product name]', buttonSub: '30-day money-back guarantee', url: '#next', mockup: 'video', mockupLabel: 'Start here', background: '#1e1b4b' }),
          compare({ band: 'soft', title: 'Sound *familiar*?', leftTitle: 'Right now', left: '[A frustration they feel]\n[Something they’ve tried that didn’t work]\n[What it’s costing them]', rightTitle: 'With [product name]', right: '[The first change they’ll notice]\n[What gets easier]\n[The result they’ve wanted]' }),
          feature({ eyebrow: 'How it works', title: 'A clear path from *[start]* to *[finish]*', text: 'Explain in two sentences how it works and why it works when other things haven’t.', items: '[Step or module one]\n[Step or module two]\n[Step or module three]', mockup: 'phone', mockupTitle: 'Your plan', mockupLabel: 'Inside' }),
          feature({ flip: true, eyebrow: 'Made for you', title: 'Perfect if you’re *[who it’s for]*', text: 'Describe the person this is for, so the right people feel seen and the wrong ones don’t buy.', items: '[They want this]\n[They’re tired of that]\n[They have about this much time]', mockup: 'workbook', mockupTitle: 'Your workbook', mockupLabel: 'Included' }),
          reviews(3, { band: 'soft' }),
          bio(),
          { id: id(), type: 'offer', band: 'dark', title: 'Everything you get', items: '[Main product] | $[value]\n[Bonus one] | $[value]\n[Bonus two] | $[value]', showTotal: true, priceLabel: 'Today', price: '$[price]', buttonLabel: 'Get it now', url: '#next', note: 'Secure checkout · 30-day money-back guarantee' },
          guarantee(),
          faq([['How long do I have access?', 'For as long as you like, including every future update.'], ['What if it’s not for me?', 'Email within 30 days for a full refund.'], ['How quickly will I see results?', 'Say honestly what a typical customer can expect, and how soon.'], ['Do I need anything else?', 'List anything they need, or say “Nothing else: everything is included.”']]),
          cta({ title: 'Ready to *[get the result]*?', text: 'Join today and start in the next five minutes.', button: 'Get [product name]', buttonSub: '30-day money-back guarantee', url: '#next' }),
        ],
      },
      {
        name: 'Checkout', slug: 'checkout', settings: { ...MODERN, width: 880 },
        blocks: [
          cover({ eyebrow: 'Checkout', text: 'You’re *one step* away', subtext: 'Secure payment. Your receipt and access arrive by email straight away.', mockup: 'none', background: '#1e1b4b' }),
          { id: id(), type: 'pricing', productId: null, badge: '', compareText: '', billingText: '', note: '', featuresTitle: 'Included:', features: '[Main product]\n[Bonus one]\n[Bonus two]\nLifetime updates', buttonLabel: 'Complete my order', buttonSubtext: '30-day money-back guarantee', buttonColor: '#4338ca' },
          guarantee({ band: 'soft' }),
        ],
      },
      thanks('Order confirmed', 'Welcome aboard!', 'Your receipt and everything you need are on their way to your inbox.', [['Check your inbox', 'Your receipt and access link are there now.'], ['Start with step one', 'It takes about ten minutes.'], ['Questions?', 'Just reply to your receipt. We’re happy to help.']], { ...MODERN }, { bg: '#1e1b4b' }),
    ],
  },
  optin: {
    label: 'Lead magnet',
    description: 'Trade a free guide, checklist or sample for an email, then welcome them with a 3-email series.',
    workflows: ['welcome'],
    steps: () => [
      {
        name: 'Sign-up page', slug: 'optin', settings: { ...FRESH },
        blocks: [
          cover({ eyebrow: 'Free checklist', text: 'Get the free guide: *7 steps* to your first 100 customers', subtext: 'Enter your email below and we’ll send it straight to your inbox.', formHere: true, mockup: 'workbook', mockupLabel: 'Free checklist', mockupTitle: '7 steps to your first 100 customers', note: 'We respect your privacy. Unsubscribe anytime.', background: '#0f3d38' }),
          form({ buttonLabel: 'Send me the guide' }),
          { id: id(), type: 'bullets', band: 'soft', title: 'What you’ll get', items: 'A one-page checklist you can print\nThe exact order to do things in\nIdeas you can use the same day', style: 'check', align: 'center' },
          reviews(3),
        ],
      },
      thanks('You’re in', 'You are in!', 'Check your inbox in the next few minutes.', NEXT_EMAIL, { ...FRESH }, { name: 'Thank you page' }),
    ],
  },
  sales: {
    label: 'Product sale (video)',
    description: 'A short sales page led by a video, with the button right under it, then care tips after they buy.',
    workflows: ['care'],
    steps: () => [
      {
        name: 'Sales page', slug: 'offer', settings: { ...MODERN, width: 960 },
        blocks: [
          cover({ eyebrow: 'Watch the 2-minute video', text: 'The course that finally makes it *click*', subtext: 'Explain the problem, your solution, and why now, in one or two lines.', mockup: 'none', background: '#1e1b4b' }),
          { id: id(), type: 'video', url: '' },
          { id: id(), type: 'button', label: 'Yes, I want in', sub: 'Instant access · 30-day money-back guarantee', big: true, url: '#next', align: 'center' },
          cards([['[Benefit one]', 'One line on why it matters.'], ['[Benefit two]', 'One line on why it matters.'], ['[Benefit three]', 'One line on why it matters.']], { band: 'soft' }),
          reviews(3),
        ],
      },
      thanks('Order confirmed', 'Thanks for your order!', 'Your receipt and access are on their way to your inbox.', [['Check your inbox', 'Your receipt and access link are there now.'], ['Start with lesson one', 'It takes about ten minutes.'], ['Questions?', 'Just reply to your receipt.']], { ...MODERN, width: 960 }, { name: 'Order confirmation', slug: 'confirmed', bg: '#1e1b4b' }),
    ],
  },
  pricing: {
    label: 'Pricing page + checkout',
    description: 'One clear offer card with Stripe checkout, reasons to trust you, a guarantee and answers. Then a thank-you page and care tips after they buy.',
    workflows: ['care'],
    steps: () => [
      {
        name: 'Pricing', slug: 'pricing', settings: { ...FRESH, width: 1000 },
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
          cards([['Secure checkout', 'Pay by card, Apple Pay or Google Pay.'], ['Receipt straight away', 'Your order details arrive by email.'], ['Real people', 'Questions? Just reply to your receipt.']], { band: 'soft' }),
          guarantee({ days: 14, title: '14 days to decide', text: 'If it isn’t right for you, email within 14 days for a full refund.' }),
          faq([['Is payment secure?', 'Yes. Payments are handled by Stripe; we never see your card number.'], ['Can I get a refund?', 'Yes, within 14 days, no questions asked.'], ['How do I get access?', 'Straight after payment, by email.']]),
        ],
      },
      thanks('Thank you', 'Payment received. Welcome aboard!', 'A receipt is on its way to your inbox.', [['Check your inbox', 'Your receipt and next steps are there now.'], ['Get started', 'Follow the first step in the email.'], ['Questions?', 'Just reply to your receipt.']], { ...FRESH, width: 1000 }),
    ],
  },
  upsell: {
    label: 'Sale with upsell / downsell',
    description: 'Sales page, a one-time upgrade offer, a lighter fallback offer, and care tips after.',
    workflows: ['care'],
    steps: () => [
      {
        key: 'sales', name: 'Sales page', slug: 'offer', next: 'upsell',
        settings: { ...MODERN, width: 1000 },
        blocks: [
          cover({ eyebrow: 'New', text: 'The *main offer*', subtext: 'Describe the result your buyer gets.', items: 'Benefit one\nBenefit two\nBenefit three', mockup: 'book', mockupLabel: 'The main offer', background: '#312e81' }),
          { id: id(), type: 'pricing', productId: null, badge: 'TODAY ONLY', compareText: '', billingText: '', note: '',
            featuresTitle: 'What you get:', features: 'Benefit one\nBenefit two\nBenefit three\nBenefit four',
            buttonLabel: 'Buy now', buttonSubtext: '30-day money-back guarantee', buttonColor: '#f97316' },
          guarantee({ band: 'soft' }),
        ],
      },
      {
        key: 'upsell', name: 'Upsell', slug: 'upgrade', next: 'thanks', no: 'downsell',
        settings: { ...MODERN, accent: '#15803d', width: 900 },
        blocks: [
          { id: id(), type: 'notice', text: '✓ Your order is confirmed. One more thing before you go…' },
          head('Wait! Add the *VIP upgrade*?', { size: 'large' }),
          { id: id(), type: 'text', text: 'One-time offer, only on this page.', align: 'center' },
          { id: id(), type: 'pricing', productId: null, badge: 'ONE-TIME OFFER', compareText: '', billingText: '', note: '',
            featuresTitle: '', features: '', buttonLabel: 'Yes, upgrade me', buttonSubtext: '', buttonColor: '#16a34a' },
          { id: id(), type: 'button', label: 'No thanks, I’ll skip this', url: '#no', align: 'center' },
        ],
      },
      {
        key: 'downsell', name: 'Downsell', slug: 'lite', next: 'thanks', no: 'thanks',
        settings: { ...MODERN, accent: '#0369a1', width: 900 },
        blocks: [
          head('How about the *lite version* instead?', { size: 'large' }),
          { id: id(), type: 'pricing', productId: null, badge: 'LAST CHANCE', compareText: '', billingText: '', note: '',
            featuresTitle: '', features: '', buttonLabel: 'Yes, add the lite version', buttonSubtext: '', buttonColor: '#0ea5e9' },
          { id: id(), type: 'button', label: 'No thanks', url: '#no', align: 'center' },
        ],
      },
      thanks('Order confirmed', 'Thanks for your order! 🎉', 'Your receipt is on its way to your inbox.', [['Check your inbox', 'Your receipt and access are there now.'], ['Get started', 'Follow the first step in the email.'], ['Questions?', 'Just reply to your receipt.']], { ...MODERN }, { key: 'thanks', next: null, bg: '#312e81' }),
    ],
  },
  newsletter: {
    label: 'Newsletter signup',
    description: 'A warm page that subscribes people to your newsletter and sends a welcome email.',
    workflows: ['newsletter'],
    steps: () => [
      {
        name: 'Subscribe', slug: 'subscribe', settings: { ...ELEGANT, width: 1000 },
        blocks: [
          cover({ eyebrow: 'The newsletter', text: 'A short letter *worth opening*', subtext: 'Stories, new work and the occasional subscriber-only offer. About twice a month.', formHere: true, mockup: 'phone', mockupLabel: 'This month', mockupTitle: 'Notes from the studio', note: 'Unsubscribe anytime with one click.', background: '#3b2414' }),
          form({ buttonLabel: 'Subscribe', purpose: 'Newsletter', newsletter: 'Newsletter', tag: 'newsletter' }),
          cards([['Stories', 'What we’re making, and the people behind it.'], ['First look', 'New work before anyone else sees it.'], ['Subscriber offers', 'Now and then, just for you.']], { band: 'soft' }),
          reviews(2),
        ],
      },
      thanks('Welcome', 'You’re on the list! 📬', 'Your first letter is on its way.', NEXT_EMAIL, { ...ELEGANT, width: 1000 }, { name: 'Welcome', slug: 'welcome', bg: '#3b2414' }),
    ],
  },
  consult: {
    label: 'Consultation request',
    description: 'A request form for services. Sends an instant reply, tells you right away, and nudges you if there’s no sale in 2 days.',
    workflows: ['inquiry'],
    steps: () => [
      {
        name: 'Request', slug: 'request', settings: { ...FRESH, width: 1040 },
        blocks: [
          cover({ eyebrow: 'Free, no obligation', text: 'Book a free *20-minute* consultation', subtext: 'Tell us a little about what you need and we’ll get back to you within one business day.', items: 'A clear plan for your next step\nAn honest price, with no pressure\nA reply within one business day', button: 'Request my consultation', url: '#form', mockup: 'none', background: '#0f3d38' }),
          head('How it works'),
          cards([['Tell us what you need', 'A few lines is plenty.'], ['We reply within a day', 'With questions or a first idea.'], ['You decide', 'A clear price, and no pressure.']], { numbered: true }),
          form({ band: 'soft', buttonLabel: 'Request my consultation', collectMessage: true, purpose: 'Inquiry', tag: 'consult-request' }),
          { id: id(), type: 'text', text: '', align: 'center' },
          reviews(3),
          faq([['Is the consultation really free?', 'Yes. It’s a chance to see if we’re a good fit, with no obligation.'], ['How soon will you reply?', 'Within one business day, usually sooner.'], ['What should I tell you?', 'Just what you need and roughly when. We’ll ask the rest.']]),
        ],
      },
      thanks('Request sent', 'Thanks! We’ll be in touch soon.', 'Check your inbox for a confirmation.', [['Check your inbox', 'A confirmation is on its way.'], ['We read your request', 'And reply within one business day.'], ['We talk', 'With a clear plan and an honest price.']], { ...FRESH, width: 1040 }, { name: 'Thanks', slug: 'thanks' }),
    ],
  },
  // Visitors pick a time from the owner's calendar (Calendar → your hours).
  booking: {
    label: 'Book a call',
    description: 'Visitors pick an open time from your calendar and book. They get a confirmation and a reminder; you get a notice.',
    workflows: [],
    steps: () => [
      {
        name: 'Book', slug: 'book', settings: { ...FRESH, width: 1000 },
        blocks: [
          cover({ eyebrow: 'Book online', text: 'Book a *free* call', subtext: 'Pick a time that suits you. You’ll get a confirmation straight away and a reminder the day before.', button: 'See open times', url: '#book', mockup: 'none', background: '#0f3d38' }),
          cards([['Pick a time', 'Open times are shown in your own time zone.'], ['Get a confirmation', 'Straight to your inbox, with a link to change it.'], ['We talk', 'A reminder arrives the day before.']], { numbered: true }),
          { id: id(), type: 'booking', band: 'soft', heading: 'Choose a time', buttonLabel: 'Confirm my call', collectPhone: true, askNote: true, tag: 'booked' },
          { id: id(), type: 'text', text: '', align: 'center' },
          bio(),
        ],
      },
      thanks('Booked', 'You’re booked. Talk soon!', 'Your confirmation is in your inbox, with a link to change the time if you need to.', [['Check your inbox', 'Your confirmation and a calendar link are there.'], ['Get ready', 'Jot down anything you’d like to cover.'], ['We talk', 'A reminder arrives the day before.']], { ...FRESH, width: 1000 }, { name: 'Booked', slug: 'booked' }),
    ],
  },
  free_class: {
    label: 'Free class sign-up',
    description: 'Sign-ups for a free online class or workshop: the class drawn on a laptop beside the form, what they’ll learn, who’s teaching, and a welcome series.',
    workflows: ['welcome'],
    steps: () => [
      {
        name: 'Free class', slug: 'class', settings: { ...MODERN },
        blocks: [
          cover({ eyebrow: 'Free online class', text: 'How to *[get the result]* in [time], even if [their worry]', subtext: 'A free [45-minute] class you can watch from anywhere. Save your seat and the link comes straight to your inbox.', formHere: true, mockup: 'video', mockupLabel: 'Free class', background: '#1e1b4b' }),
          form({ buttonLabel: 'Save my free seat', tag: 'class' }),
          head('In this class you’ll learn'),
          cards([['[Lesson one]', 'What they’ll be able to do afterwards.'], ['[Lesson two]', 'What they’ll be able to do afterwards.'], ['[Lesson three]', 'What they’ll be able to do afterwards.']], { numbered: true }),
          bio({ band: 'soft', eyebrow: 'Your teacher' }),
          reviews(3),
          faq([['What does it cost?', 'Nothing. The class is free.'], ['What if I can’t make it live?', 'Sign up anyway and we’ll send you the recording.'], ['What do I need?', 'Just a phone or computer and somewhere comfortable to watch.']]),
          cta({ title: 'Save your *free seat*', text: 'It takes ten seconds.', button: 'Save my seat', buttonSub: 'Free · Watch from anywhere', url: '#form' }),
        ],
      },
      thanks('You’re registered', 'Your seat is saved', 'The class link is on its way to your inbox.', [['Check your inbox', 'Your link and the class time are there.'], ['Put it in your calendar', 'So you don’t miss it.'], ['Bring a question', 'There’s time to ask at the end.']], { ...MODERN }, { bg: '#1e1b4b' }),
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
