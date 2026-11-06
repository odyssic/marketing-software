// Website templates: multi-page sites with a menu and footer, one per kind of
// business. A website is stored like a funnel (kind = 'website'); its pages
// are steps, shown in menu order. Buttons can link to another page with
// "page:<slug>". Contact forms log inquiries (and bring the inquiry workflow).
const id = () => Math.random().toString(36).slice(2, 10);

const hero = (text, subtext, background, eyebrow = '') => ({ id: id(), type: 'hero', eyebrow, text, subtext, background, textColor: '#ffffff' });
const h = (text, size = 'medium', align = 'center') => ({ id: id(), type: 'heading', text, size, align });
const p = (text, align = 'center') => ({ id: id(), type: 'text', text, align });
const btn = (label, url, align = 'center') => ({ id: id(), type: 'button', label, url, align });
const cards = (items) => ({ id: id(), type: 'cards', items: items.map(([t, d]) => `${t} | ${d}`).join('\n') });
// Social proof comes only from real, approved testimonials (hidden until there are some).
const reviews = (limit = 3) => ({ id: id(), type: 'reviews', limit });
// Asks happy customers for a review; it becomes a testimonial only with their permission and your approval.
const reviewForm = () => ({ id: id(), type: 'form', buttonLabel: 'Share my review', collectName: true, purpose: 'Review', tag: 'reviewer' });
const info = (o) => ({ id: id(), type: 'info', ...o });
const contactForm = (label = 'Send message') => ({ id: id(), type: 'form', buttonLabel: label, collectName: true, collectPhone: false, collectMessage: true, purpose: 'Inquiry', tag: 'website-inquiry' });
const page = (name, slug, blocks, accent) => ({ name, slug, blocks, settings: { accent, width: 960 } });

// Contemporary looks (see templates.js).
const look = (name, slug, blocks, settings) => ({ name, slug, blocks, settings: { ...settings } });
const STUDIO = { font: 'elegant', background: '#fbf9f6', textColor: '#1f1b16', accent: '#7a4e24', width: 1040 };
const MODERN = { font: 'modern', background: '#ffffff', textColor: '#0b1220', accent: '#111827', width: 1040 };
const heroOf = (style, text, subtext, eyebrow, button, url, background) => ({ id: id(), type: 'hero', style, eyebrow, text, subtext, button, url, background, textColor: '#ffffff', image: '' });
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
    steps: () => [
      look('Home', 'home', [heroOf('split', '[Your business], made with care', 'One sentence on what you do and who it’s for.', '[Your town] · Since [year]', 'Get in touch', 'page:contact', '#7a4e24'),
        h('What we do', 'medium'), cards([['[Offering one]', 'A sentence on what it is and why people love it.'], ['[Offering two]', 'A sentence on what it is and why people love it.'], ['[Offering three]', 'A sentence on what it is and why people love it.']]),
        reviews(1), btn('Start a conversation', 'page:contact')], STUDIO),
      look('About', 'about', [heroOf('minimal', 'The story behind [business]', 'Who you are, why you started, and what you believe in.', 'About', '', '', '#7a4e24'),
        p('Write two or three short paragraphs here. Keep it warm and personal: the moment you started, what you care about, and who you most love working with.')], STUDIO),
      look('Work', 'work', [heroOf('minimal', 'Selected work', 'A few things we’re proud of.', 'Portfolio', '', '', '#7a4e24'),
        cards([['[Project]', 'What it was and the result.'], ['[Project]', 'What it was and the result.'], ['[Project]', 'What it was and the result.'], ['[Project]', 'What it was and the result.']]), reviews(3)], STUDIO),
      look('Contact', 'contact', [heroOf('minimal', 'Let’s talk', 'Tell us a little about what you have in mind. We reply within one business day.', 'Contact', '', '', '#7a4e24'),
        contactForm('Send message'), info({ email: 'hello@yourbusiness.com', phone: '', address: '[Street], [Town]', hours: 'Mon–Fri, 9am–5pm' })], STUDIO),
    ],
  },
  modern: {
    followup: GENERIC_FOLLOWUP,
    label: 'Modern business', description: 'Bold, clean and confident: Home, Services, About, and Contact, with a band hero and rounded buttons.', accent: '#111827', workflows: ['site_followup'],
    steps: () => [
      look('Home', 'home', [heroOf('flat', '[What you do], done right', 'One clear line on the result you deliver and who it’s for.', '[Your town]', 'Get started', 'page:contact', '#111827'),
        cards([['[Service one]', 'What’s included and who it’s for.'], ['[Service two]', 'What’s included and who it’s for.'], ['[Service three]', 'What’s included and who it’s for.']]),
        h('Why people choose us', 'medium'), cards([['Fast', 'A line about speed or responsiveness.'], ['Clear pricing', 'A line about no surprises.'], ['Guaranteed', 'A line about your promise.']]),
        reviews(3), btn('Talk to us', 'page:contact')], MODERN),
      look('Services', 'services', [heroOf('minimal', 'Services', 'Everything we offer, with honest starting prices.', 'What we do', '', '', '#111827'),
        cards([['[Service one]', 'From $[price]. What’s included.'], ['[Service two]', 'From $[price]. What’s included.'], ['[Service three]', 'From $[price]. What’s included.'], ['[Service four]', 'From $[price]. What’s included.']]), btn('Ask a question', 'page:contact')], MODERN),
      look('About', 'about', [heroOf('minimal', 'About us', 'Who we are and how we work.', 'Our story', '', '', '#111827'), p('A few short paragraphs about your team, your experience and what you stand for.')], MODERN),
      look('Contact', 'contact', [heroOf('minimal', 'Get in touch', 'Tell us what you need. We reply within one business day.', 'Contact', '', '', '#111827'),
        contactForm('Send message'), info({ email: 'hello@yourbusiness.com', phone: '(555) 555-0100', address: '', hours: 'Mon–Fri, 9am–6pm' })], MODERN),
    ],
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
      const a = '#4f46e5';
      return [
        page('Home', 'home', [hero('Clarity for your next big move', 'One-to-one coaching for founders who are ready to grow without burning out.', '#4338ca', 'Coaching'),
          cards([['1:1 coaching', 'Weekly sessions focused on your goals.'], ['Strategy days', 'A full day to map the next 12 months.'], ['Group program', 'Six weeks with a small cohort.']]),
          reviews(1), btn('Book a free call', 'page:contact')], a),
        page('About', 'about', [h('Hi, I’m [your name]', 'large'), p('Tell your story: who you help, why you do this work, and what makes your approach different.'), btn('Work with me', 'page:services')], a),
        page('Services', 'services', [h('How we can work together', 'large'), cards([['1:1 coaching', '[Price] per month. Weekly calls, messages between sessions.'], ['Strategy day', '[Price]. Leave with a written plan.'], ['Group program', '[Price]. Next cohort starts [date].']]), btn('Ask a question', 'page:contact')], a),
        page('Results', 'results', [h('What clients say', 'large'), reviews(6), h('Worked with us?', 'small'), p('We’d love to hear how it went.'), reviewForm()], a),
        page('Contact', 'contact', [h('Book a free 20-minute call', 'large'), p('Tell me a little about where you are and where you want to be.'), contactForm('Request my call'), info({ email: 'you@yourbusiness.com', phone: '', address: '', hours: 'Mon–Thu, 9am–5pm' })], a),
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
      const a = '#0f766e';
      return [
        page('Home', 'home', [hero('Reliable [service] in [your town]', 'Licensed, insured and on time. Free quotes within one business day.', '#0f766e', 'Family owned since [year]'),
          cards([['[Service one]', 'Short description of what you do.'], ['[Service two]', 'Short description of what you do.'], ['[Service three]', 'Short description of what you do.']]),
          reviews(1), btn('Get a free quote', 'page:quote')], a),
        page('Services', 'services', [h('What we do', 'large'), cards([['[Service one]', 'What’s included, typical timeline, starting price.'], ['[Service two]', 'What’s included, typical timeline, starting price.'], ['[Service three]', 'What’s included, typical timeline, starting price.'], ['Emergencies', 'Call [phone] for same-day help.']]), btn('Request a quote', 'page:quote')], a),
        page('About', 'about', [h('About [business name]', 'large'), p('Who you are, how long you’ve served the area, licenses and guarantees.')], a),
        page('Reviews', 'reviews', [h('What neighbors say', 'large'), reviews(6), h('Worked with us?', 'small'), p('We’d love to hear how it went.'), reviewForm()], a),
        page('Get a quote', 'quote', [h('Get a free quote', 'large'), p('Tell us what you need and we’ll get back to you within one business day.'), contactForm('Request my quote'), info({ phone: '(555) 555-0100', email: 'hello@yourbusiness.com', address: 'Serving [town] and nearby', hours: 'Mon–Fri 7am–6pm, Sat 8am–2pm' })], a),
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
      const a = '#b45309';
      return [
        page('Home', 'home', [hero('[Restaurant name]', 'Seasonal food, good coffee and a table waiting for you.', '#92400e', 'Open daily'),
          cards([['Breakfast', 'Served until 11am.'], ['Lunch', 'Fresh, local, made to order.'], ['Coffee & pastries', 'Baked in-house every morning.']]),
          btn('See the menu', 'page:menu'), info({ hours: 'Mon–Sun 7am–3pm', address: '[Street], [Town]', phone: '(555) 555-0100' })], a),
        page('Menu', 'menu', [h('Menu', 'large'), cards([['[Dish]  $[price]', 'Short description.'], ['[Dish]  $[price]', 'Short description.'], ['[Dish]  $[price]', 'Short description.'], ['[Dish]  $[price]', 'Short description.'], ['[Dish]  $[price]', 'Short description.'], ['[Dish]  $[price]', 'Short description.']]), p('Ask about vegetarian and gluten-free options.')], a),
        page('About', 'about', [h('Our story', 'large'), p('How the place started, where your ingredients come from, the people behind the counter.')], a),
        page('Visit us', 'visit', [h('Visit us', 'large'), info({ hours: 'Mon–Sun 7am–3pm', address: '[Street], [Town]', phone: '(555) 555-0100', email: 'hello@yourrestaurant.com' }),
          h('Private events & catering', 'small'), p('Planning something? Tell us about it.'), contactForm('Ask about an event')], a),
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
      const a = '#be185d';
      return [
        page('Home', 'home', [hero('Handmade [things] for everyday life', 'Small batches, made by hand in [town].', '#9d174d', 'New collection'),
          cards([['[Product]', '$[price]: one line on why people love it.'], ['[Product]', '$[price]: one line on why people love it.'], ['[Product]', '$[price]: one line on why people love it.']]),
          btn('Visit the shop', 'https://yourshop.example.com'),
          h('Get the letter', 'small'), p('New pieces, studio notes and the occasional subscriber-only sale.'),
          { id: id(), type: 'form', buttonLabel: 'Subscribe', collectName: true, collectPhone: false, purpose: 'Newsletter', newsletter: 'Newsletter', tag: 'newsletter' }], a),
        page('Shop', 'shop', [h('Shop', 'large'), p('Link each collection to your store (Squarespace, Shopify, Etsy) or add buy buttons from Products.'), cards([['[Collection]', 'Short description.'], ['[Collection]', 'Short description.'], ['[Collection]', 'Short description.']]), btn('Open the full store', 'https://yourshop.example.com')], a),
        page('About', 'about', [h('About the studio', 'large'), p('Your story, your process and your materials.')], a),
        page('Journal', 'journal', [h('Journal', 'large'), p('Short posts on new work, process and behind-the-scenes. Paste your latest essay here, or turn it into an email with Email → Repurpose.')], a),
        page('Contact', 'contact', [h('Say hello', 'large'), p('Custom orders, wholesale and questions are all welcome.'), contactForm(), info({ email: 'hello@yourshop.com', address: '', phone: '', hours: '' })], a),
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
      const a = '#0e7490';
      return [
        page('Home', 'home', [hero('Feel good in [town]', '[Massage / hair / yoga]: an hour that’s just for you.', '#155e75', 'Now booking'),
          cards([['[Service]', 'From $[price], [length] minutes.'], ['[Service]', 'From $[price], [length] minutes.'], ['[Service]', 'From $[price], [length] minutes.']]),
          reviews(1), btn('Request a booking', 'page:book')], a),
        page('Services', 'services', [h('Services & prices', 'large'), cards([['[Service]', '$[price] · [length] min · what’s included'], ['[Service]', '$[price] · [length] min · what’s included'], ['[Service]', '$[price] · [length] min · what’s included'], ['Gift cards', 'Available in any amount.']]), btn('Book now', 'page:book')], a),
        page('Team', 'team', [h('Meet the team', 'large'), cards([['[Name]', 'Specialty and a line about them.'], ['[Name]', 'Specialty and a line about them.']])], a),
        page('Book', 'book', [h('Request a booking', 'large'), p('Tell us the service and a few times that work. We’ll confirm by email or text.'), contactForm('Request booking'), info({ hours: 'Tue–Sat 9am–7pm', address: '[Street], [Town]', phone: '(555) 555-0100', email: 'hello@yourstudio.com' })], a),
      ];
    },
  },
};

module.exports = { SITE_TEMPLATES };
