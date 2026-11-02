// The analog bridge: the print newsletter's mailing list (CSV and a PDF of
// mailing labels), and trackable short links / QR codes for printed pieces.
const crypto = require('node:crypto');
const QRCode = require('qrcode');

// ---------- Mailing labels: a small PDF writer, no dependency ----------
// Avery 5160 / 30 per sheet on US Letter: 3 columns x 10 rows, 2.625" x 1".
const SHEET = { w: 612, h: 792, cols: 3, rows: 10, left: 13.5, top: 36, pitchX: 198, pitchY: 72, padX: 12, font: 10, lead: 12 };

// PDF strings use WinAnsi; anything outside Latin-1 becomes "?".
const pdfText = (s) => Array.from(String(s)).map((ch) => {
  const c = ch.codePointAt(0);
  if (ch === '(' || ch === ')' || ch === '\\') return `\\${ch}`;
  if (c < 32) return ' ';
  if (c < 127) return ch;
  if (c >= 160 && c <= 255) return `\\${c.toString(8).padStart(3, '0')}`;
  return '?';
}).join('');

// labels: [[line1, line2, ...], ...] → Buffer
function labelsPdf(labels) {
  const perPage = SHEET.cols * SHEET.rows;
  const pages = [];
  for (let i = 0; i < Math.max(labels.length, 1); i += perPage) pages.push(labels.slice(i, i + perPage));
  const objs = [];
  const add = (body) => { objs.push(body); return objs.length; };
  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const pagesId = add(null); // filled in below
  const pageIds = [];
  for (const page of pages) {
    const ops = [];
    page.forEach((lines, i) => {
      const col = i % SHEET.cols, row = Math.floor(i / SHEET.cols);
      const x = SHEET.left + col * SHEET.pitchX + SHEET.padX;
      const shown = lines.filter(Boolean).slice(0, 5);
      // Vertically centre the block inside the 1" label.
      const blockH = shown.length * SHEET.lead;
      let y = SHEET.h - SHEET.top - row * SHEET.pitchY - (SHEET.pitchY - blockH) / 2 - SHEET.font + 2;
      for (const line of shown) {
        ops.push(`BT /F1 ${SHEET.font} Tf ${x.toFixed(1)} ${y.toFixed(1)} Td (${pdfText(String(line).slice(0, 38))}) Tj ET`);
        y -= SHEET.lead;
      }
    });
    const stream = ops.join('\n');
    const contentId = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${SHEET.w} ${SHEET.h}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`));
  }
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((p) => `${p} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  const catalogId = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((body, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const addressLines = (p) => [
  [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email,
  p.address1, p.address2,
  `${[p.city, p.region].filter(Boolean).join(', ')}${p.postal ? ` ${p.postal}` : ''}`.trim(),
  p.country && !/^(us|usa|united states)$/i.test(p.country) ? p.country : '',
].filter((x) => x && String(x).trim());

function registerPrint(api, app, { getDb, HttpError, id, logEvent, publicBase, toCsv }) {
  const db = () => getDb();
  const printSubscribers = (accountId, product) => db().all(`SELECT c.*, s.product FROM subscriptions s JOIN contacts c ON c.id = s.person_id
    WHERE s.account_id = ? AND s.format = 'print' AND s.status = 'active' AND (? = '' OR s.product = ?)
    ORDER BY c.last_name, c.first_name, c.id`, accountId, product, product);

  api.get('/print/lists', async (req, res) => {
    res.json(await db().all(`SELECT s.product, COUNT(*)::int AS subscribers,
        COUNT(*) FILTER (WHERE c.address1 = '' OR c.postal = '')::int AS missing_address
      FROM subscriptions s JOIN contacts c ON c.id = s.person_id
      WHERE s.account_id = ? AND s.format = 'print' AND s.status = 'active' GROUP BY s.product ORDER BY s.product`, req.accountId));
  });

  api.get('/print/subscribers.csv', async (req, res) => {
    const rows = (await printSubscribers(req.accountId, String(req.query.product || ''))).map((p) => ({
      name: [p.first_name, p.last_name].filter(Boolean).join(' '), email: p.email, address1: p.address1, address2: p.address2,
      city: p.city, region: p.region, postal: p.postal, country: p.country, newsletter: p.product,
    }));
    res.attachment('print-subscribers.csv').type('text/csv').send(toCsv(rows.length ? rows : [{ name: '', email: '', address1: '', address2: '', city: '', region: '', postal: '', country: '', newsletter: '' }]));
  });

  // People without a street address or ZIP are left off (listed in the header).
  api.get('/print/labels.pdf', async (req, res) => {
    const people = await printSubscribers(req.accountId, String(req.query.product || ''));
    const ok = people.filter((p) => p.address1 && p.postal);
    res.set('X-Skipped-Missing-Address', String(people.length - ok.length));
    res.attachment('mailing-labels.pdf').type('application/pdf').send(labelsPdf(ok.map(addressLines)));
  });

  // ---------- Short links and QR codes ----------
  const code = () => crypto.randomBytes(5).toString('base64url').replace(/[-_]/g, '').slice(0, 6) || crypto.randomBytes(3).toString('hex');
  const linkOut = (l) => ({ ...l, short_url: `${publicBase()}/s/${l.code}` });

  api.get('/links', async (req, res) => {
    const rows = await db().all(`SELECT l.*, c.title AS campaign_title,
        (SELECT COUNT(*)::int FROM events e WHERE e.account_id = l.account_id AND e.type = 'scan' AND e.meta::jsonb->>'link_id' = l.id::text) AS scans,
        (SELECT COUNT(*)::int FROM events e WHERE e.account_id = l.account_id AND e.type = 'visit' AND e.meta::jsonb->>'link_id' = l.id::text) AS visits
      FROM links l LEFT JOIN campaigns c ON c.id = l.campaign_id WHERE l.account_id = ? ORDER BY l.id DESC`, req.accountId);
    res.json(rows.map(linkOut));
  });

  api.post('/links', async (req, res) => {
    const url = String(req.body?.url || '').trim();
    if (!/^https?:\/\/\S+\.\S+/i.test(url)) throw new HttpError(400, 'Enter the full web address, starting with https://');
    const label = String(req.body?.label || '').trim().slice(0, 100) || url.replace(/^https?:\/\//, '').slice(0, 60);
    let campaignId = null;
    if (req.body?.campaign_id) {
      const c = await db().get('SELECT id FROM campaigns WHERE id = ? AND account_id = ?', id(req.body.campaign_id), req.accountId);
      if (!c) throw new HttpError(400, 'Campaign not found');
      campaignId = c.id;
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const l = await db().get('INSERT INTO links (account_id, code, url, label, campaign_id) VALUES (?, ?, ?, ?, ?) RETURNING *', req.accountId, code(), url, label, campaignId);
        return res.status(201).json(linkOut(l));
      } catch (e) { if (e?.code !== '23505') throw e; }
    }
    throw new HttpError(500, 'Couldn’t create a short code, try again');
  });

  api.delete('/links/:id', async (req, res) => {
    await db().run('DELETE FROM links WHERE id = ? AND account_id = ?', id(req.params.id), req.accountId);
    res.json({ ok: true });
  });

  // QR code (SVG) for printing; the code points at /s/<code>?q=1 so scans and visits are told apart.
  api.get('/links/:id/qr.svg', async (req, res) => {
    const l = await db().get('SELECT * FROM links WHERE id = ? AND account_id = ?', id(req.params.id), req.accountId);
    if (!l) throw new HttpError(404, 'Link not found');
    const svg = await QRCode.toString(`${publicBase()}/s/${l.code}?q=1`, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' });
    if (req.query.download) res.attachment(`qr-${l.code}.svg`);
    res.type('image/svg+xml').send(svg);
  });

  // Public redirect: logs a scan (from the QR) or a visit (typed / clicked link).
  app.get('/s/:code', async (req, res) => {
    const l = await db().get('SELECT * FROM links WHERE code = ?', String(req.params.code));
    if (!l) return res.status(404).type('text').send('This link doesn’t exist.');
    await logEvent(db(), l.account_id, {
      type: req.query.q ? 'scan' : 'visit', source: 'print', campaign_id: l.campaign_id,
      meta: { link_id: l.id, label: l.label, url: l.url, campaign_id: l.campaign_id },
    }).catch((e) => console.error('link tracking:', e.message));
    res.redirect(302, l.url);
  });
}

module.exports = { registerPrint, labelsPdf, addressLines, pdfText, SHEET };
