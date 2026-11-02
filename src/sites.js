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
const quote = (q, name, detail = '') => ({ id: id(), type: 'testimonial', quote: q, name, detail, photo: '' });
const info = (o) => ({ id: id(), type: 'info', ...o });
const contactForm = (label = 'Send message') => ({ id: id(), type: 'form', buttonLabel: label, collectName: true, collectPhone: true, collectMessage: true, purpose: 'Inquiry', tag: 'website-inquiry' });
const page = (name, slug, blocks, accent) => ({ name, slug, blocks, settings: { accent, width: 960 } });

const SITE_TEMPLATES = {
  coach: {
    label: 'Coach or consultant', description: 'Home, About, Services, Results and a booking request page.', accent: '#4f46e5', workflows: ['inquiry'],
    steps: () => {
      const a = '#4f46e5';
      return [
        page('Home', 'home', [hero('Clarity for your next big move', 'One-to-one coaching for founders who are ready to grow without burning out.', '#4338ca', 'Coaching'),
          cards([['1:1 coaching', 'Weekly sessions focused on your goals.'], ['Strategy days', 'A full day to map the next 12 months.'], ['Group program', 'Six weeks with a small cohort.']]),
          quote('I finally have a plan I believe in.', 'Client name', 'Founder'), btn('Book a free call', 'page:contact')], a),
        page('About', 'about', [h('Hi, I’m [your name]', 'large'), p('Tell your story: who you help, why you do this work, and what makes your approach different.'), btn('Work with me', 'page:services')], a),
        page('Services', 'services', [h('How we can work together', 'large'), cards([['1:1 coaching', '[Price] per month. Weekly calls, messages between sessions.'], ['Strategy day', '[Price]. Leave with a written plan.'], ['Group program', '[Price]. Next cohort starts [date].']]), btn('Ask a question', 'page:contact')], a),
        page('Results', 'results', [h('What clients say', 'large'), quote('Replace with a real client quote.', 'Client name', 'Role'), quote('Another short, specific result.', 'Client name', 'Role')], a),
        page('Contact', 'contact', [h('Book a free 20-minute call', 'large'), p('Tell me a little about where you are and where you want to be.'), contactForm('Request my call'), info({ email: 'you@yourbusiness.com', phone: '', address: '', hours: 'Mon–Thu, 9am–5pm' })], a),
      ];
    },
  },
  services: {
    label: 'Local service business', description: 'For trades and home services: Home, Services, About, Reviews and a quote request.', accent: '#0f766e', workflows: ['inquiry'],
    steps: () => {
      const a = '#0f766e';
      return [
        page('Home', 'home', [hero('Reliable [service] in [your town]', 'Licensed, insured and on time. Free quotes within one business day.', '#0f766e', 'Family owned since [year]'),
          cards([['[Service one]', 'Short description of what you do.'], ['[Service two]', 'Short description of what you do.'], ['[Service three]', 'Short description of what you do.']]),
          quote('They showed up when they said they would and did beautiful work.', 'Customer name', '[Town]'), btn('Get a free quote', 'page:quote')], a),
        page('Services', 'services', [h('What we do', 'large'), cards([['[Service one]', 'What’s included, typical timeline, starting price.'], ['[Service two]', 'What’s included, typical timeline, starting price.'], ['[Service three]', 'What’s included, typical timeline, starting price.'], ['Emergencies', 'Call [phone] for same-day help.']]), btn('Request a quote', 'page:quote')], a),
        page('About', 'about', [h('About [business name]', 'large'), p('Who you are, how long you’ve served the area, licenses and guarantees.')], a),
        page('Reviews', 'reviews', [h('What neighbors say', 'large'), quote('Replace with a real review.', 'Customer name', '[Town]'), quote('Replace with a real review.', 'Customer name', '[Town]'), quote('Replace with a real review.', 'Customer name', '[Town]')], a),
        page('Get a quote', 'quote', [h('Get a free quote', 'large'), p('Tell us what you need and we’ll get back to you within one business day.'), contactForm('Request my quote'), info({ phone: '(555) 555-0100', email: 'hello@yourbusiness.com', address: 'Serving [town] and nearby', hours: 'Mon–Fri 7am–6pm, Sat 8am–2pm' })], a),
      ];
    },
  },
  restaurant: {
    label: 'Restaurant or café', description: 'Home, Menu, About, and Visit us with hours, address and a private events form.', accent: '#b45309', workflows: ['inquiry'],
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
    label: 'Maker or online shop', description: 'Home, Shop, About, Journal and Contact, with a newsletter signup.', accent: '#be185d', workflows: ['newsletter', 'inquiry'],
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
    label: 'Salon, studio or wellness', description: 'Home, Services & prices, Team, and Book with hours and a booking request.', accent: '#0e7490', workflows: ['inquiry'],
    steps: () => {
      const a = '#0e7490';
      return [
        page('Home', 'home', [hero('Feel good in [town]', '[Massage / hair / yoga]: an hour that’s just for you.', '#155e75', 'Now booking'),
          cards([['[Service]', 'From $[price], [length] minutes.'], ['[Service]', 'From $[price], [length] minutes.'], ['[Service]', 'From $[price], [length] minutes.']]),
          quote('The calmest hour of my week.', 'Client name'), btn('Request a booking', 'page:book')], a),
        page('Services', 'services', [h('Services & prices', 'large'), cards([['[Service]', '$[price] · [length] min · what’s included'], ['[Service]', '$[price] · [length] min · what’s included'], ['[Service]', '$[price] · [length] min · what’s included'], ['Gift cards', 'Available in any amount.']]), btn('Book now', 'page:book')], a),
        page('Team', 'team', [h('Meet the team', 'large'), cards([['[Name]', 'Specialty and a line about them.'], ['[Name]', 'Specialty and a line about them.']])], a),
        page('Book', 'book', [h('Request a booking', 'large'), p('Tell us the service and a few times that work. We’ll confirm by email or text.'), contactForm('Request booking'), info({ hours: 'Tue–Sat 9am–7pm', address: '[Street], [Town]', phone: '(555) 555-0100', email: 'hello@yourstudio.com' })], a),
      ];
    },
  },
};

module.exports = { SITE_TEMPLATES };
