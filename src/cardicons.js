// Icons for card blocks: a small hand-picked set, matched to each card's words
// ("Fast delivery" gets a truck, "Free consultation" a chat bubble). A card can
// also name its icon: "Title | description | heart".
const P = {
  check: '<path d="M5 12.5l4.2 4.2L19 7"/>',
  star: '<path d="M12 3.5l2.6 5.5 6 .7-4.4 4.1 1.2 5.9L12 16.8l-5.4 2.9 1.2-5.9-4.4-4.1 6-.7z"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="14.5" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
  mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M4 7l8 6 8-6"/>',
  phone: '<path d="M6.5 3.5h3l1.5 4.5-2 1.5a11 11 0 0 0 5.5 5.5l1.5-2 4.5 1.5v3a2 2 0 0 1-2 2A15.5 15.5 0 0 1 4.5 5.5a2 2 0 0 1 2-2z"/>',
  chat: '<path d="M20 11.5a7.5 7 0 0 1-10.6 6.4L4 19.5l1.6-4.3A7 7 0 0 1 4.5 11.5 7.5 7 0 0 1 20 11.5z"/>',
  people: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9.5" r="2.5"/><path d="M15.8 14.2A4.5 4.5 0 0 1 21 18.5"/>',
  shield: '<path d="M12 3.5l7 2.8v5.2c0 4.4-3 7.7-7 9-4-1.3-7-4.6-7-9V6.3z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  bolt: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>',
  leaf: '<path d="M5 19c0-8 5-13.5 14-14-.5 9-6 14-14 14z"/><path d="M5 19l7-7"/>',
  home: '<path d="M4 11l8-6.5 8 6.5"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>',
  pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
  truck: '<path d="M3 6.5h11v10H3zM14 10h4l3 3.2v3.3h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17.5" cy="17.5" r="1.8"/>',
  gift: '<rect x="4" y="9" width="16" height="11" rx="1.5"/><path d="M3 9h18M12 9v11M12 9c-1.5-3.5-5.5-4-5.5-1.5S12 9 12 9zM12 9c1.5-3.5 5.5-4 5.5-1.5S12 9 12 9z"/>',
  tag: '<path d="M3.5 12.5V4.5h8l9 9-8 8z"/><circle cx="8" cy="9" r="1.4"/>',
  dollar: '<circle cx="12" cy="12" r="8.5"/><path d="M14.8 9.2c-.5-1-1.6-1.5-2.8-1.5-1.6 0-2.8.8-2.8 2.1 0 3 5.8 1.6 5.8 4.4 0 1.3-1.3 2.1-3 2.1-1.3 0-2.5-.6-3-1.6M12 6v1.7M12 16.3V18"/>',
  chart: '<path d="M4 20V4M4 20h16"/><path d="M8 15l3.5-4 3 2.5L20 7"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
  trophy: '<path d="M7.5 4h9v5a4.5 4.5 0 0 1-9 0z"/><path d="M7.5 6H4.5a3 3 0 0 0 3 4M16.5 6h3a3 3 0 0 1-3 4M12 13.5V17M8.5 20h7M9.5 17h5v3h-5z"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10.5l5-3v9l-5-3z"/>',
  camera: '<path d="M4 8h3.5L9 5.5h6L16.5 8H20v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  coffee: '<path d="M5 9h11v5.5a4.5 4.5 0 0 1-4.5 4.5h-2A4.5 4.5 0 0 1 5 14.5z"/><path d="M16 10.5h1.5a2.5 2.5 0 0 1 0 5H16M8.5 3.5v2.5M12 3.5v2.5"/>',
  food: '<path d="M7 3.5v17M4.5 3.5v5a2.5 2.5 0 0 0 5 0v-5M17 20.5v-17c-2.5 1-4 3.5-4 7h4"/>',
  sparkle: '<path d="M12 3.5l1.8 5.2L19 10.5l-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8z"/><path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
  smile: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14a4.2 4.2 0 0 0 7 0"/><path d="M9 9.5h.01M15 9.5h.01" stroke-width="2.6"/>',
  wrench: '<path d="M14.5 4a4.5 4.5 0 0 0-4.2 6.1L4 16.4 7.6 20l6.3-6.3A4.5 4.5 0 0 0 20 9.5l-2.8 2.8-3.5-1-1-3.5L15.5 5z"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.5 3.5 5.5 3.5 8.5s-1 6-3.5 8.5C9.5 18 8.5 15 8.5 12s1-6 3.5-8.5z"/>',
  rocket: '<path d="M12 15.5L8.5 12c1.5-4.5 4.5-7.5 11-8.5-1 6.5-4 9.5-7.5 12z"/><path d="M8.5 12l-3 .5-2 2.5 4 1M12 15.5l-.5 3-2.5 2-1-4"/><circle cx="15" cy="9" r="1.5"/>',
  bulb: '<path d="M9 17.5h6M10 20.5h4"/><path d="M12 3.5a6 6 0 0 0-3.5 10.9c.4.3.5.7.5 1.1v2h6v-2c0-.4.1-.8.5-1.1A6 6 0 0 0 12 3.5z"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12.2L19.5 3.5M16 7l2.5 2.5M14 9l2 2"/>',
  brush: '<path d="M14.5 4.5l5 5-7.5 7.5-5-5z"/><path d="M7 12c-2.5 0-3.5 2-3.5 4.5 0 1.5-.5 2.5-1 3 3 .5 7-.5 7.5-3.5"/>',
  fitness: '<path d="M6.5 8v8M17.5 8v8M3.5 10v4M20.5 10v4M6.5 12h11"/>',
  paw: '<circle cx="7" cy="10" r="1.8"/><circle cx="17" cy="10" r="1.8"/><circle cx="10" cy="6.5" r="1.8"/><circle cx="14" cy="6.5" r="1.8"/><path d="M12 12.5c-2.5 0-5 3.5-5 5.5 0 1.5 1.5 2 2.5 2 1 0 1.5-.5 2.5-.5s1.5.5 2.5.5c1 0 2.5-.5 2.5-2 0-2-2.5-5.5-5-5.5z"/>',
  car: '<path d="M4 16.5V12l2-5h12l2 5v4.5z"/><path d="M4 12h16"/><circle cx="7.5" cy="16.5" r="1.8"/><circle cx="16.5" cy="16.5" r="1.8"/>',
  cart: '<path d="M3 4h2.5l2.2 11h10.6l2-8H6.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/>',
  refresh: '<path d="M20 12a8 8 0 0 1-14.2 5M4 12a8 8 0 0 1 14.2-5"/><path d="M18.5 3v4.5H14M5.5 21v-4.5H10"/>',
  compass: '<circle cx="12" cy="12" r="8.5"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  music: '<path d="M9 18V5.5l11-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  doc: '<path d="M6 3.5h8l4 4V20.5H6z"/><path d="M14 3.5v4h4M9 12h6M9 15.5h6"/>',
  hand: '<path d="M7.5 12.5V6a1.5 1.5 0 0 1 3 0v5M10.5 11V4.5a1.5 1.5 0 0 1 3 0V11M13.5 11V5.5a1.5 1.5 0 0 1 3 0V12M16.5 9.5a1.5 1.5 0 0 1 3 0v4.5a7 7 0 0 1-7 7h-.5a6.5 6.5 0 0 1-5.4-2.9L4 14.5a1.5 1.5 0 0 1 2.5-1.7l1 1.2"/>',
};

// Words that suggest each icon, checked in order (the first match wins).
const WORDS = [
  ['truck', /deliver|ship|shipping|dispatch|courier|moving|removal/],
  ['dollar', /price|pricing|cost|afford|money|save|saving|budget|cheap|value|pay|refund|discount|fee/],
  ['clock', /fast|quick|minute|hour|time|on time|same.day|speed|instant|24\/7|prompt/],
  ['calendar', /book|schedule|appointment|calendar|\bdates?\b|week|month|\bday/],
  ['shield', /safe|secure|guarantee|insured|insurance|protect|trust|warrant|privacy|licen[cs]ed/],
  ['chat', /talk|chat|consult|call|conversation|support|advice|question|\bask|repl/],
  ['mail', /email|inbox|newsletter|letter|mail/],
  ['phone', /phone|\btext|sms|mobile/],
  ['people', /team|community|family|people|group|together|client|member|everyone|friend/],
  ['heart', /care|love|kind|gentle|wellness|health|heart|passion|favou?rite/],
  ['star', /review|rated|best|quality|premium|expert|award|five.star|\btop\b/],
  ['trophy', /result|\bwin\b|winn|success|achieve|goal|proven|champion/],
  ['chart', /grow|growth|increase|sales|revenue|track|report|progress|scale|more customers/],
  ['target', /focus|\baim|target|\bplan\b|planning|strategy|clarity|precise/],
  ['leaf', /natural|organic|\beco|green|garden|plant|fresh|sustainab|clean/],
  ['home', /home|house|local|neighbo|property|room|stay|kitchen/],
  ['pin', /location|visit|near|address|map|area|town|city|where/],
  ['gift', /free|bonus|gift|reward|perk|extra/],
  ['book', /learn|course|lesson|guide|class|teach|train|\bread\b|module|study/],
  ['video', /video|watch|film|stream/],
  ['camera', /photo|picture|portrait|shoot|camera/],
  ['coffee', /coffee|cafe|café|\btea\b|drink|brunch/],
  ['food', /food|menu|\beat\b|dinner|lunch|meal|chef|cook|recipe|restaurant|bake/],
  ['sparkle', /\bnew\b|magic|beautiful|design|style|clean|shine|polish|transform/],
  ['wrench', /fix|repair|install|maintain|service|plumb|electric|build|tool/],
  ['bolt', /energy|power|boost|easy|simple|effortless/],
  ['bulb', /idea|insight|creative|\btips?\b|smart|think|understand/],
  ['rocket', /launch|start|begin|kick|go live|get started/],
  ['globe', /online|anywhere|world|global|remote|web|website/],
  ['lock', /private|confidential|member|exclusive|access/],
  ['smile', /happy|\bfun\b|joy|friendly|relax|enjoy|stress.free|no stress/],
  ['brush', /paint|\bart\b|artwork|decor|makeup|hair|beauty|salon/],
  ['fitness', /\bfit\b|fitness|gym|workout|strength|train|exercise|yoga|pilates/],
  ['paw', /\bpets?\b|\bdogs?\b|\bcats?\b|\bvet|groom/],
  ['car', /\bcars?\b|vehicle|drive|auto|mot\b|detail/],
  ['cart', /shop|store|\border|\bbuy|product|cart/],
  ['refresh', /again|repeat|ongoing|monthly|subscription|renew|reorder/],
  ['compass', /journey|explore|direction|path|guidance|find your way/],
  ['music', /music|song|sound|audio|podcast|listen/],
  ['doc', /contract|paperwork|document|\bforms?\b|quote|estimate|invoice/],
  ['hand', /help|hands.on|personal|handmade|craft/],
  ['check', /./],
];

const pick = (title, desc) => {
  const words = `${title} ${desc || ''}`.toLowerCase();
  return (WORDS.find(([, re]) => re.test(words)) || ['check'])[0];
};
// The icon for one card: the one it names (third part) or a match for its words.
function cardIcon(title, desc, named) {
  const n = String(named || '').trim().toLowerCase();
  const key = P[n] ? n : pick(title, desc);
  return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[key]}</svg>`;
}
const ICON_NAMES = Object.keys(P);

module.exports = { cardIcon, ICON_NAMES, pickCardIcon: pick };
