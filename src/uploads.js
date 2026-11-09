// Photo uploads for pages. The browser shrinks pictures before sending, so
// they arrive small; they are kept in the database and served at /u/<id>
// with a long cache, from the app's own address (works on custom domains).
const crypto = require('node:crypto');
const express = require('express');

const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf',
  'application/zip': 'zip', 'audio/mpeg': 'mp3', 'video/mp4': 'mp4' }; // no SVG or HTML: they can carry scripts
const MAX = 4 * 1024 * 1024;
// Bigger files (up to 500 MB) skip the app: the browser sends them straight to file
// storage (Supabase Storage, bucket "files") through a one-time upload slot, so the
// size limit on requests to the app doesn't apply. STORAGE_URL is the project's address.
const LARGE_MAX = 500 * 1024 * 1024;
const BUCKET = 'files';
const storageBase = () => String(process.env.STORAGE_URL || '').replace(/\/+$/, '');

// The first bytes of each format, so a file can't claim to be an image it isn't.
const sniff = (b) => (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? 'image/jpeg'
  : b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? 'image/png'
    : b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' ? 'image/webp'
      : b.subarray(0, 4).toString('latin1') === 'GIF8' ? 'image/gif' : b.subarray(0, 5).toString('latin1') === '%PDF-' ? 'application/pdf'
        : b.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) ? 'application/zip'
          : b.subarray(0, 3).toString('latin1') === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) ? 'audio/mpeg'
            : b.subarray(4, 8).toString('latin1') === 'ftyp' ? 'video/mp4' : null);

function registerUploads(app, api, { getDb, HttpError, baseUrl }) {
  const db = () => getDb();

  api.post('/uploads', express.raw({ type: () => true, limit: MAX }), async (req, res) => {
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!body.length) throw new HttpError(400, 'Choose a picture to upload');
    const type = sniff(body);
    if (!type) throw new HttpError(415, 'That file isn’t one we can use. Try a PDF, picture (JPG, PNG, WebP, GIF), ZIP, MP3 or MP4.');
    const id = `${crypto.randomBytes(12).toString('base64url')}.${TYPES[type]}`;
    await db().run('INSERT INTO uploads (id, account_id, content_type, size, data) VALUES (?, ?, ?, ?, ?)', id, req.accountId, type, body.length, body);
    res.status(201).json({ id, url: `${baseUrl(req)}/u/${id}`, size: body.length });
  });

  // A slot for one large file: the browser trades the token for a signed upload address.
  api.post('/uploads/large', async (req, res) => {
    const base = storageBase();
    if (!base) throw new HttpError(503, 'Large files aren’t set up yet. Use a file under 4 MB, or paste a link to it instead.');
    const type = String(req.body?.type || '');
    const size = Number(req.body?.size) || 0;
    if (!TYPES[type]) throw new HttpError(415, 'That file isn’t one we can use. Try a PDF, picture (JPG, PNG, WebP, GIF), ZIP, MP3 or MP4.');
    if (size > LARGE_MAX) throw new HttpError(413, 'That file is over 500 MB. Paste a link to it instead (Google Drive, Dropbox, YouTube…).');
    const id = `${crypto.randomBytes(12).toString('base64url')}.${TYPES[type]}`;
    const token = crypto.randomBytes(24).toString('base64url');
    await db().run('INSERT INTO upload_slots (token, account_id, upload_id, path, content_type, size) VALUES (?, ?, ?, ?, ?, ?)', token, req.accountId, id, `${req.accountId}/${id}`, type, size);
    res.status(201).json({ token, id, slot: `${base}/functions/v1/upload-slot` });
  });
  // After the browser has sent the file: check it's really there and really what it says.
  api.post('/uploads/large/:token/done', async (req, res) => {
    const slot = await db().get('SELECT * FROM upload_slots WHERE token = ? AND account_id = ?', String(req.params.token), req.accountId);
    if (!slot) throw new HttpError(404, 'That upload has expired. Try again.');
    const publicUrl = `${storageBase()}/storage/v1/object/public/${BUCKET}/${slot.path}`;
    const head = await fetch(publicUrl, { headers: { Range: 'bytes=0-15' } }).catch(() => null);
    const first = head && head.ok ? Buffer.from(await head.arrayBuffer()) : null;
    if (!first || sniff(first) !== slot.content_type) throw new HttpError(422, 'The file didn’t arrive, or isn’t the kind of file it said it was. Try again.');
    const size = Number(String(head.headers.get('content-range') || '').split('/')[1]) || slot.size;
    await db().run('INSERT INTO uploads (id, account_id, content_type, size, data, storage_url) VALUES (?, ?, ?, ?, NULL, ?)', slot.upload_id, req.accountId, slot.content_type, size, publicUrl);
    await db().run('DELETE FROM upload_slots WHERE token = ?', slot.token);
    res.status(201).json({ id: slot.upload_id, url: `${baseUrl(req)}/u/${slot.upload_id}`, size });
  });

  app.get('/u/:id', async (req, res) => {
    const row = await db().get('SELECT content_type, data, storage_url FROM uploads WHERE id = ?', String(req.params.id).slice(0, 40));
    if (!row) return res.status(404).type('text/plain').send('Not found');
    if (row.storage_url) return res.set('Cache-Control', 'public, max-age=86400').redirect(302, row.storage_url);
    res.set({ 'Content-Type': row.content_type, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff',
      ...(row.content_type === 'application/pdf' ? { 'Content-Disposition': 'inline', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" } : {}),
      ...(row.content_type === 'application/zip' ? { 'Content-Disposition': 'attachment' } : {}) });
    res.send(Buffer.from(row.data));
  });
}

module.exports = { registerUploads, sniff, LARGE_MAX };
