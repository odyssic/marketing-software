// Website templates: multi-page sites with a menu and footer, one per kind of
// business. A website is stored like a funnel (kind = 'website'); its pages
// are steps, shown in menu order. Buttons can link to another page with
// "page:<slug>". Contact forms log inquiries (and bring the inquiry workflow).
//
// Every home page follows the same proven shape: a bold banner that says what
// you do and for whom, with one clear button; what you offer; why people pick
// you; real reviews (hidden until there are some); and the ask again on a dark
// band. Inner pages open with a matching banner and end with a clear next step.
const id = () => Math.random().toString(36).slice(2, 10);

const h = (text, size = 'medium', align = 'center') => ({ id: id(), type: 'heading', text, size, align });
const p = (text, align = 'center') => ({ id: id(), type: 'text', text, align });
const btn = (label, url, o = {}) => ({ id: id(), type: 'button', label, url, align: 'center', big: true, ...o });
const cards = (items, o = {}) => ({ id: id(), type: 'cards', items: items.map(([t, d]) => `${t} | ${d}`).join('\n'), ...o });
// Social proof comes only from real, approved testimonials (hidden until there are some).
const reviews = (limit = 3, o = {}) => ({ id: id(), type: 'reviews', limit, ...o });
// Asks happy customers for a review; it becomes a testimonial only with their permission and your approval.
const reviewForm = (o = {}) => ({ id: id(), type: 'form', buttonLabel: 'Share my review', collectName: true, purpose: 'Review', tag: 'reviewer', ...o });
const info = (o) => ({ id: id(), type: 'info', ...o });
const contactForm = (label = 'Send message', o = {}) => ({ id: id(), type: 'form', buttonLabel: label, collectName: true, collectPhone: false, collectMessage: true, purpose: 'Inquiry', tag: 'website-inquiry', ...o });
const cover = (o) => ({ id: id(), type: 'hero', style: 'cover', textColor: '#ffffff', image: '', mockup: 'none', ...o });
const feature = (o) => ({ id: id(), type: 'feature', ...o });
const faq = (items, o = {}) => ({ id: id(), type: 'faq', title: 'Questions, answered', items: items.map((x) => x.join(' | ')).join('\n'), ...o });
const bio = (o = {}) => ({ id: id(), type: 'bio', eyebrow: 'Hello', name: '', role: '', text: 'A few warm sentences about who you are, why you do this and who you help.', ...o });
const cta = (o) => ({ id: id(), type: 'cta', band: 'dark', ...o });
const guarantee = (o) => ({ id: id(), type: 'guarantee', days: 0, ...o });

// Looks: a warm editorial serif, a bold modern sans, and calm colour sets per trade.
const look = (name, slug, blocks, settings) => ({ name, slug, blocks, settings: { ...settings } });
const ELEGANT = (accent, background = '#fbf9f6', textColor = '#1f1b16') => ({ font: 'elegant', background, textColor, accent, width: 1080 });
const BOLD = (accent, background = '#ffffff', textColor = '#0b1220') => ({ font: 'modern', background, textColor, accent, width: 1080 });

const GENERIC_FOLLOWUP = {
  reply_subject: 'Thanks, {{first_name|there}}! We’ll be in touch',
  reply_body: 'Hi {{first_name|there}},\n\nThanks for getting in touch with {{business}}. We’ve got your message and will reply within one business day.\n\n{{business}}',
  checkin_subject: 'Still interested, {{first_name|there}}?',
  checkin_body: 'Hi {{first_name|there}},\n\nJust following up on your message. Reply any time and we’ll take it from there.\n\n{{business}}',
  notify: 'New inquiry from your website. Reply while it’s fresh.',
};

const SITE_TEMPLATES = {
  studio: {
    followup: GENERIC_FOLLOWUP,
    label: 'Studio (elegant)', description: 'A calm, editorial site with serif headings: Home, About, Work, and Contact.', accent: '#7a4e24', workflows: ['site_followup'],
    steps: () => {
      const L = ELEGANT('#7a4e24'), band = '#3b2414';
      return [
        look('Home', 'home', [cover({ eyebrow: '[Your town] · Since [year]', text: '[Your business], *made with care*', subtext: 'One sentence on what you do and who it’s for.', button: 'Get in touch', url: 'page:contact', background: band }),
          h('What we do'), cards([['[Offering one]', 'A sentence on what it is and why people love it.'], ['[Offering two]', 'A sentence on what it is and why people love it.'], ['[Offering three]', 'A sentence on what it is and why people love it.']]),
          feature({ band: 'soft', eyebrow: 'Our way', title: 'Small, careful and *personal*', text: 'Two sentences on how you work and what people notice when they work with you.', items: '[What makes you different]\n[A promise you keep]\n[Something people always mention]', button: 'Our story', url: 'page:about' }),
          reviews(3),
          cta({ title: 'Let’s make *something good*', text: 'Tell us what you have in mind. We reply within one business day.', button: 'Start a conversation', url: 'page:contact' })], L),
        look('About', 'about', [cover({ eyebrow: 'About', text: 'The story behind *[business]*', subtext: 'Who you are, why you started, and what you believe in.', background: band }),
          bio({ eyebrow: 'Hello', text: 'Write two or three short paragraphs here. Keep it warm and personal: the moment you started, what you care about, and who you most love working with.', signature: '' }),
          cta({ title: 'Like what you see?', button: 'Get in touch', url: 'page:contact' })], L),
        look('Work', 'work', [cover({ eyebrow: 'Portfolio', text: 'Selected *work*', subtext: 'A few things we’re proud of.', background: band }),
          cards([['[Project]', 'What it was and the result.'], ['[Project]', 'What it was and the result.'], ['[Project]', 'What it was and the result.'], ['[Project]', 'What it was and the result.']]), reviews(3, { band: 'soft' }),
          cta({ title: 'Have a project in mind?', button: 'Tell us about it', url: 'page:contact' })], L),
        look('Contact', 'contact', [cover({ eyebrow: 'Contact', text: 'Let’s *talk*', subtext: 'Tell us a little about what you have in mind. We reply within one business day.', background: band }),
          contactForm('Send message', { band: 'soft' }), info({ email: 'hello@yourbusiness.com', phone: '', address: '[Street], [Town]', hours: 'Mon–Fri, 9am–5pm' })], L),
      ];
    },
  },
  modern: {
    followup: GENERIC_FOLLOWUP,
    label: 'Modern business', description: 'Bold, clean and confident: Home, Services, About, and Contact, with a band hero and rounded buttons.', accent: '#111827', workflows: ['site_followup'],
    steps: () => {
      const L = BOLD('#4338ca'), band = '#111827';
      return [
        look('Home', 'home', [cover({ eyebrow: '[Your town]', text: '[What you do], *done right*', subtext: 'One clear line on the result you deliver and who it’s for.', items: '[Your strongest promise]\n[Why people pick you]\n[A fact that builds trust]', button: 'Get started', buttonSub: 'Free first chat · No obligation', url: 'page:contact', background: band }),
          h('What we do'), cards([['[Service one]', 'What’s included and who it’s for.'], ['[Service two]', 'What’s included and who it’s for.'], ['[Service three]', 'What’s included and who it’s for.']]),
          feature({ band: 'soft', eyebrow: 'Why us', title: 'Fast, clear and *guaranteed*', text: 'Two sentences on how you work and what clients notice.', items: 'Fast: a line about speed or responsiveness\nClear pricing: no surprises\nGuaranteed: a line about your promise', mockup: 'phone', mockupTitle: 'Your project', mockupLabel: 'Progress' }),
          reviews(3),
          cta({ title: 'Ready when *you are*', text: 'Tell us what you need. We reply within one business day.', button: 'Talk to us', url: 'page:contact' })], L),
        look('Services', 'services', [cover({ eyebrow: 'What we do', text: '*Services*', subtext: 'Everything we offer, with honest starting prices.', background: band }),
          cards([['[Service one]', 'From $[price]. What’s included.'], ['[Service two]', 'From $[price]. What’s included.'], ['[Service three]', 'From $[price]. What’s included.'], ['[Service four]', 'From $[price]. What’s included.']]),
          faq([['How soon can you start?', 'Say honestly how soon you can usually begin.'], ['How do you price?', 'Explain how a quote works, and that there are no surprises.'], ['What if I’m not happy?', 'Your promise, in one or two sentences.']], { band: 'soft' }),
          cta({ title: 'Not sure what you need?', button: 'Ask a question', url: 'page:contact' })], L),
        look('About', 'about', [cover({ eyebrow: 'Our story', text: 'About *us*', subtext: 'Who we are and how we work.', background: band }),
          bio({ eyebrow: 'Who we are', text: 'A few short paragraphs about your team, your experience and what you stand for.' }),
          cta({ title: 'Let’s work together', button: 'Get in touch', url: 'page:contact' })], L),
        look('Contact', 'contact', [cover({ eyebrow: 'Contact', text: 'Get in *touch*', subtext: 'Tell us what you need. We reply within one business day.', background: band }),
          contactForm('Send message', { band: 'soft' }), info({ email: 'hello@yourbusiness.com', phone: '(555) 555-0100', address: '', hours: 'Mon–Fri, 9am–6pm' })], L),
      ];
    },
  },
  coach: {
    followup: {
      reply_subject: 'Thanks, {{first_name|there}}! Let’s find a time to talk',
      reply_body: 'Hi {{first_name|there}},\n\nThanks for reaching out. I read every request myself and I’ll reply within one business day with a few times for your free call.\n\nIn the meantime, think about one thing you’d most like to change in the next 90 days. That’s where we’ll start.\n\nTalk soon,\n{{business}}',
      checkin_subject: 'Still up for a quick call, {{first_name|there}}?',
      checkin_body: 'Hi {{first_name|there}},\n\nJust checking in on your call request. If the timing isn’t right, no problem at all. If it is, reply with two or three times that suit you and I’ll send an invite.\n\n{{business}}',
      notify: 'New coaching call request from your website. Offer a few times today.',
    },
    label: 'Coach or consultant', description: 'Home, About, Services, Results and a booking request page.', accent: '#4f46e5', workflows: ['site_followup'],
    steps: () => {
      const L = BOLD('#4f46e5'), band = '#1e1b4b';
      return [
        look('Home', 'home', [cover({ eyebrow: 'Coaching', text: 'Clarity for your *next big move*', subtext: 'One-to-one coaching for founders who are ready to grow without burning out.', items: 'A clear plan for the next 90 days\nSomeone in your corner every week\nRoom to think, not just do', button: 'Book a free call', buttonSub: '20 minutes · No obligation', url: 'page:contact', mockup: 'video', mockupTitle: 'Your 90-day plan', mockupLabel: 'Coaching', background: band }),
          h('How we can work together'), cards([['1:1 coaching', 'Weekly sessions focused on your goals.'], ['Strategy days', 'A full day to map the next 12 months.'], ['Group program', 'Six weeks with a small cohort.']]),
          { id: id(), type: 'compare', band: 'soft', title: 'What *changes*', leftTitle: 'Before', left: 'Busy every day, but not moving forward\nDecisions made alone at midnight\nGrowth that costs you your evenings', rightTitle: 'After', right: 'A plan you trust and follow\nA thinking partner every week\nGrowth with room for a life' },
          bio({ eyebrow: 'Your coach', text: 'Tell your story in a few lines: who you help, why you do this work, and what makes your approach different.' }),
          reviews(3, { band: 'soft' }),
          cta({ title: 'Ready to get *unstuck*?', text: 'Start with a free 20-minute call. No pressure, just clarity.', button: 'Book a free call', url: 'page:contact' })], L),
        look('About', 'about', [cover({ eyebrow: 'About', text: 'Hi, I’m *[your name]*', subtext: 'Who I help, and why I do this work.', background: band }),
          bio({ eyebrow: 'My story', text: 'Tell your story: who you help, why you do this work, and what makes your approach different.' }),
          cta({ title: 'Let’s talk', button: 'Work with me', url: 'page:services' })], L),
        look('Services', 'services', [cover({ eyebrow: 'Work with me', text: 'How we can *work together*', subtext: 'Three ways in, depending on what you need right now.', background: band }),
          cards([['1:1 coaching', '[Price] per month. Weekly calls, messages between sessions.'], ['Strategy day', '[Price]. Leave with a written plan.'], ['Group program', '[Price]. Next cohort starts [date].']]),
          faq([['How do I know if coaching is right for me?', 'That’s what the free call is for. If it isn’t a fit, I’ll say so.'], ['How long do people work with you?', 'Most clients start with three months.'], ['Can I pause?', 'Yes. Life happens; just let me know.']], { band: 'soft' }),
          cta({ title: 'Questions first?', button: 'Ask me anything', url: 'page:contact' })], L),
        look('Results', 'results', [cover({ eyebrow: 'Results', text: 'What *clients* say', subtext: 'In their own words.', background: band }), reviews(6), h('Worked with me?', 'small'), p('I’d love to hear how it went.'), reviewForm({ band: 'soft' })], L),
        look('Contact', 'contact', [cover({ eyebrow: 'Free, 20 minutes', text: 'Book a *free* call', subtext: 'Tell me a little about where you are and where you want to be.', background: band }),
          contactForm('Request my call', { band: 'soft' }), info({ email: 'you@yourbusiness.com', phone: '', address: '', hours: 'Mon–Thu, 9am–5pm' })], L),
      ];
    },
  },
  services: {
    followup: {
      reply_subject: 'Got your quote request, {{first_name|there}}',
      reply_body: 'Hi {{first_name|there}},\n\nThanks for contacting {{business}}. We’ve got your request and will get back to you with a quote within one business day. If it helps, reply with a photo or two of the job.\n\nFor anything urgent, just call us.\n\n{{business}}',
      checkin_subject: 'Any questions about your quote?',
      checkin_body: 'Hi {{first_name|there}},\n\nJust following up on your quote. Happy to answer any questions or adjust anything. When you’re ready, reply and we’ll get you on the schedule.\n\nThanks,\n{{business}}',
      notify: 'New quote request from your website. Quick replies win most jobs.',
    },
    label: 'Local service business', description: 'For trades and home services: Home, Services, About, Reviews and a quote request.', accent: '#0f766e', workflows: ['site_followup'],
    steps: () => {
      const L = BOLD('#0f766e'), band = '#0f3d38';
      return [
        look('Home', 'home', [cover({ eyebrow: 'Family owned since [year]', text: 'Reliable [service] in *[your town]*', subtext: 'Licensed, insured and on time. Free quotes within one business day.', items: 'Licensed and insured\nFree, no-obligation quotes\nWe turn up when we say we will', button: 'Get a free quote', buttonSub: 'Reply within one business day', url: 'page:quote', background: band }),
          h('What we do'), cards([['[Service one]', 'Short description of what you do.'], ['[Service two]', 'Short description of what you do.'], ['[Service three]', 'Short description of what you do.']]),
          { id: id(), type: 'cards', band: 'soft', numbered: true, items: 'Tell us about the job | A few lines and a photo if you have one.\nGet a clear quote | Within one business day, no surprises.\nWe do the work | On time, and we tidy up after.' },
          guarantee({ title: 'Our promise', text: 'If something we did isn’t right, we come back and fix it. Simple as that.' }),
          reviews(3, { band: 'soft' }),
          cta({ title: 'Need it done *right*?', text: 'Free quotes within one business day.', button: 'Get a free quote', url: 'page:quote' })], L),
        look('Services', 'services', [cover({ eyebrow: 'What we do', text: 'Our *services*', subtext: 'What’s included, how long it takes, and starting prices.', background: band }),
          cards([['[Service one]', 'What’s included, typical timeline, starting price.'], ['[Service two]', 'What’s included, typical timeline, starting price.'], ['[Service three]', 'What’s included, typical timeline, starting price.'], ['Emergencies', 'Call [phone] for same-day help.']]),
          faq([['Do you give free quotes?', 'Yes, always, with no obligation.'], ['Are you insured?', 'Yes: licensed and fully insured.'], ['How soon can you come?', 'Usually within [days]. Emergencies the same day.']], { band: 'soft' }),
          cta({ title: 'Get your *free quote*', button: 'Request a quote', url: 'page:quote' })], L),
        look('About', 'about', [cover({ eyebrow: 'About', text: 'About *[business name]*', subtext: 'Local, licensed and proud of our work.', background: band }),
          bio({ eyebrow: 'Who we are', text: 'Who you are, how long you’ve served the area, licenses and guarantees.' }),
          cta({ title: 'Let’s get it sorted', button: 'Get a free quote', url: 'page:quote' })], L),
        look('Reviews', 'reviews', [cover({ eyebrow: 'Reviews', text: 'What *neighbors* say', subtext: 'Real reviews from real customers.', background: band }), reviews(6), h('Worked with us?', 'small'), p('We’d love to hear how it went.'), reviewForm({ band: 'soft' })], L),
        look('Get a quote', 'quote', [cover({ eyebrow: 'Free, no obligation', text: 'Get a *free* quote', subtext: 'Tell us what you need and we’ll get back to you within one business day.', background: band }),
          contactForm('Request my quote', { band: 'soft' }), info({ phone: '(555) 555-0100', email: 'hello@yourbusiness.com', address: 'Serving [town] and nearby', hours: 'Mon–Fri 7am–6pm, Sat 8am–2pm' })], L),
      ];
    },
  },
  restaurant: {
    followup: {
      reply_subject: 'Thanks for getting in touch, {{first_name|there}}',
      reply_body: 'Hi {{first_name|there}},\n\nThanks for your message about an event at {{business}}. We’ll get back to you within one business day with availability and options.\n\nSee you soon,\n{{business}}',
      checkin_subject: 'Still planning your event?',
      checkin_body: 'Hi {{first_name|there}},\n\nJust checking in on your event. Dates fill up, so reply whenever you’re ready and we’ll hold a spot for you.\n\n{{business}}',
      notify: 'New private event or catering request from your website.',
    },
    label: 'Restaurant or café', description: 'Home, Menu, About, and Visit us with hours, address and a private events form.', accent: '#b45309', workflows: ['site_followup'],
    steps: () => {
      const L = ELEGANT('#b45309', '#fffaf3', '#2a1a10'), band = '#5a2d0c';
      return [
        look('Home', 'home', [cover({ eyebrow: 'Open daily', text: '*[Restaurant name]*', subtext: 'Seasonal food, good coffee and a table waiting for you.', button: 'See the menu', url: 'page:menu', note: 'Mon–Sun 7am–3pm · [Street], [Town]', background: band }),
          cards([['Breakfast', 'Served until 11am.'], ['Lunch', 'Fresh, local, made to order.'], ['Coffee & pastries', 'Baked in-house every morning.']]),
          feature({ band: 'soft', eyebrow: 'Our kitchen', title: 'Made here, *every morning*', text: 'Two sentences on where your ingredients come from and what you’re known for.', items: '[A dish people come back for]\n[Where your ingredients come from]\n[Something that makes you special]', button: 'Our story', url: 'page:about' }),
          reviews(3),
          info({ hours: 'Mon–Sun 7am–3pm', address: '[Street], [Town]', phone: '(555) 555-0100' }),
          cta({ title: 'Planning a *get-together*?', text: 'Private events and catering for groups of all sizes.', button: 'Ask about an event', url: 'page:visit' })], L),
        look('Menu', 'menu', [cover({ eyebrow: 'Menu', text: 'What’s *cooking*', subtext: 'Ask about vegetarian and gluten-free options.', background: band }),
          cards([['[Dish]  $[price]', 'Short description.'], ['[Dish]  $[price]', 'Short description.'], ['[Dish]  $[price]', 'Short description.'], ['[Dish]  $[price]', 'Short description.'], ['[Dish]  $[price]', 'Short description.'], ['[Dish]  $[price]', 'Short description.']]),
          cta({ title: 'Hungry?', button: 'Find us', url: 'page:visit' })], L),
        look('About', 'about', [cover({ eyebrow: 'Our story', text: 'How it *started*', subtext: 'The people behind the counter.', background: band }),
          bio({ eyebrow: 'Our story', text: 'How the place started, where your ingredients come from, the people behind the counter.' })], L),
        look('Visit us', 'visit', [cover({ eyebrow: 'Visit', text: 'Come and *say hello*', subtext: 'We’d love to see you.', background: band }),
          info({ hours: 'Mon–Sun 7am–3pm', address: '[Street], [Town]', phone: '(555) 555-0100', email: 'hello@yourrestaurant.com' }),
          h('Private events & catering', 'medium', 'center'), p('Planning something? Tell us about it.'), contactForm('Ask about an event', { band: 'soft' })], L),
      ];
    },
  },
  shop: {
    followup: {
      reply_subject: 'Thanks for your message, {{first_name|there}}',
      reply_body: 'Hi {{first_name|there}},\n\nThanks for getting in touch with {{business}}. I’ll reply personally within a day or two.\n\nWith thanks,\n{{business}}',
      checkin_subject: 'Following up on your message',
      checkin_body: 'Hi {{first_name|there}},\n\nJust making sure my reply reached you. If you have any other questions about a custom order or anything else, reply here.\n\n{{business}}',
      notify: 'New message from your shop website.',
    },
    label: 'Maker or online shop', description: 'Home, Shop, About, Journal and Contact, with a newsletter signup.', accent: '#be185d', workflows: ['newsletter', 'site_followup'],
    steps: () => {
      const L = ELEGANT('#9d174d', '#fffafb', '#2a1517'), band = '#4a0f2a';
      return [
        look('Home', 'home', [cover({ eyebrow: 'New collection', text: 'Handmade [things] for *everyday life*', subtext: 'Small batches, made by hand in [town].', button: 'Visit the shop', url: 'https://yourshop.example.com', background: band }),
          h('Customer favourites'), cards([['[Product]', '$[price]: one line on why people love it.'], ['[Product]', '$[price]: one line on why people love it.'], ['[Product]', '$[price]: one line on why people love it.']]),
          feature({ band: 'soft', eyebrow: 'From the studio', title: 'Made slowly, *made to last*', text: 'Two sentences on your process and materials.', items: '[Your materials]\n[How it’s made]\n[How long it lasts]', button: 'About the studio', url: 'page:about' }),
          reviews(3),
          h('Get the letter', 'medium'), p('New pieces, studio notes and the occasional subscriber-only sale.'),
          { id: id(), type: 'form', band: 'soft', buttonLabel: 'Subscribe', collectName: true, collectPhone: false, purpose: 'Newsletter', newsletter: 'Newsletter', tag: 'newsletter' }], L),
        look('Shop', 'shop', [cover({ eyebrow: 'Shop', text: 'The *collections*', subtext: 'Link each collection to your store (Squarespace, Shopify, Etsy) or add buy buttons from Products.', background: band }),
          cards([['[Collection]', 'Short description.'], ['[Collection]', 'Short description.'], ['[Collection]', 'Short description.']]), btn('Open the full store', 'https://yourshop.example.com')], L),
        look('About', 'about', [cover({ eyebrow: 'About', text: 'About the *studio*', subtext: 'Your story, your process and your materials.', background: band }), bio({ eyebrow: 'The maker', text: 'Your story, your process and your materials.' })], L),
        look('Journal', 'journal', [cover({ eyebrow: 'Journal', text: 'Notes from the *studio*', subtext: 'New work, process and behind-the-scenes.', background: band }),
          p('Short posts on new work, process and behind-the-scenes. Paste your latest essay here, or turn it into an email with Email → Repurpose.')], L),
        look('Contact', 'contact', [cover({ eyebrow: 'Contact', text: 'Say *hello*', subtext: 'Custom orders, wholesale and questions are all welcome.', background: band }), contactForm('Send message', { band: 'soft' }), info({ email: 'hello@yourshop.com', address: '', phone: '', hours: '' })], L),
      ];
    },
  },
  wellness: {
    followup: {
      reply_subject: 'We got your booking request, {{first_name|there}}',
      reply_body: 'Hi {{first_name|there}},\n\nThanks for your booking request at {{business}}. We’ll confirm your appointment by email or text within one business day.\n\nSee you soon,\n{{business}}',
      checkin_subject: 'Still want to book, {{first_name|there}}?',
      checkin_body: 'Hi {{first_name|there}},\n\nJust checking in on your booking. Reply with a couple of times that work and we’ll get you in.\n\n{{business}}',
      notify: 'New booking request from your website. Confirm a time today.',
    },
    label: 'Salon, studio or wellness', description: 'Home, Services & prices, Team, and Book with hours and a booking request.', accent: '#0e7490', workflows: ['site_followup'],
    steps: () => {
      const L = ELEGANT('#0e7490', '#f8fcfc', '#10262b'), band = '#0c3a44';
      return [
        look('Home', 'home', [cover({ eyebrow: 'Now booking', text: 'Feel good in *[town]*', subtext: '[Massage / hair / yoga]: an hour that’s just for you.', items: 'Easy online booking requests\nFriendly, experienced team\nA calm space to unwind', button: 'Request a booking', url: 'page:book', background: band }),
          h('Our services'), cards([['[Service]', 'From $[price], [length] minutes.'], ['[Service]', 'From $[price], [length] minutes.'], ['[Service]', 'From $[price], [length] minutes.']]),
          feature({ band: 'soft', eyebrow: 'Your visit', title: 'An hour that’s *just for you*', text: 'Two sentences on what a visit feels like, from the moment they walk in.', items: '[What happens first]\n[What makes your space special]\n[How they’ll feel after]', button: 'Services & prices', url: 'page:services' }),
          reviews(3),
          cta({ title: 'Ready to *unwind*?', text: 'Tell us a few times that work and we’ll confirm.', button: 'Request a booking', url: 'page:book' })], L),
        look('Services', 'services', [cover({ eyebrow: 'Menu', text: 'Services & *prices*', subtext: 'Clear prices, no surprises.', background: band }),
          cards([['[Service]', '$[price] · [length] min · what’s included'], ['[Service]', '$[price] · [length] min · what’s included'], ['[Service]', '$[price] · [length] min · what’s included'], ['Gift cards', 'Available in any amount.']]),
          faq([['How do I book?', 'Send a request with a few times that work, and we’ll confirm by email or text.'], ['What if I need to cancel?', 'Just let us know [24 hours] ahead.'], ['Do you sell gift cards?', 'Yes, in any amount.']], { band: 'soft' }),
          cta({ title: 'Found the one?', button: 'Book now', url: 'page:book' })], L),
        look('Team', 'team', [cover({ eyebrow: 'Team', text: 'Meet the *team*', subtext: 'The people who’ll look after you.', background: band }), cards([['[Name]', 'Specialty and a line about them.'], ['[Name]', 'Specialty and a line about them.']])], L),
        look('Book', 'book', [cover({ eyebrow: 'Book', text: 'Request a *booking*', subtext: 'Tell us the service and a few times that work. We’ll confirm by email or text.', background: band }),
          contactForm('Request booking', { band: 'soft' }), info({ hours: 'Tue–Sat 9am–7pm', address: '[Street], [Town]', phone: '(555) 555-0100', email: 'hello@yourstudio.com' })], L),
      ];
    },
  },
};

module.exports = { SITE_TEMPLATES };
