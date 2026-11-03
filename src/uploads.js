// Photo uploads for pages. The browser shrinks pictures before sending, so
// they arrive small; they are kept in the database and served at /u/<id>
// with a long cache, from the app's own address (works on custom domains).
const crypto = require('node:crypto');
const express = require('express');

const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf' }; // no SVG: it can carry scripts
const MAX = 4 * 1024 * 1024;

// The first bytes of each format, so a file can't claim to be an image it isn't.
const sniff = (b) => (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? 'image/jpeg'
  : b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? 'image/png'
    : b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' ? 'image/webp'
      : b.subarray(0, 4).toString('latin1') === 'GIF8' ? 'image/gif' : b.subarray(0, 5).toString('latin1') === '%PDF-' ? 'application/pdf' : null);

function registerUploads(app, api, { getDb, HttpError, baseUrl }) {
  const db = () => getDb();

  api.post('/uploads', express.raw({ type: () => true, limit: MAX }), async (req, res) => {
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!body.length) throw new HttpError(400, 'Choose a picture to upload');
    const type = sniff(body);
    if (!type) throw new HttpError(415, 'That file isn’t one we can use. Try a PDF, JPG, PNG, WebP or GIF.');
    const id = `${crypto.randomBytes(12).toString('base64url')}.${TYPES[type]}`;
    await db().run('INSERT INTO uploads (id, account_id, content_type, size, data) VALUES (?, ?, ?, ?, ?)', id, req.accountId, type, body.length, body);
    res.status(201).json({ id, url: `${baseUrl(req)}/u/${id}`, size: body.length });
  });

  app.get('/u/:id', async (req, res) => {
    const row = await db().get('SELECT content_type, data FROM uploads WHERE id = ?', String(req.params.id).slice(0, 40));
    if (!row) return res.status(404).type('text/plain').send('Not found');
    res.set({ 'Content-Type': row.content_type, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff',
      ...(row.content_type === 'application/pdf' ? { 'Content-Disposition': 'inline', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" } : {}) });
    res.send(Buffer.from(row.data));
  });
}

module.exports = { registerUploads, sniff };
