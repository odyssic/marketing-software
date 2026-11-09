// Files: PDFs and other downloads kept in Rilly, delivered with a personal link
// per person (/dl/<token>) so every download is logged on their record, and a
// link passed on still says who it came from.
const crypto = require('node:crypto');

function registerFiles(app, api, { getDb, HttpError, getSecret, publicBase, logEvent }) {
  const db = () => getDb();
  const sig = (contactId, fileId) => crypto.createHmac('sha256', getSecret()).update(`dl:${contactId}:${fileId}`).digest('base64url').slice(0, 22);
  const tokenFor = (contactId, fileId) => `${contactId}.${fileId}.${sig(contactId, fileId)}`;
  // Personal link for one person and one file.
  const linkFor = (contactId, fileId) => `${publicBase()}/dl/${tokenFor(contactId, fileId)}`;
  // A form's "send them something" that points at one of this business's own uploads.
  const ownFileId = (url) => (String(url || '').match(/\/u\/([A-Za-z0-9_-]{8,30}\.(?:pdf|jpg|png|webp|gif))$/) || [])[1] || null;

  api.get('/files', async (req, res) => {
    const rows = await db().all(`SELECT u.id, u.name, u.content_type, u.size, u.created_at,
        (SELECT COUNT(*)::int FROM events e WHERE e.account_id = u.account_id AND e.type = 'download' AND e.meta LIKE '%"file":"' || u.id || '"%') AS downloads
      FROM uploads u WHERE u.account_id = ? AND (u.in_library = 1 OR u.content_type = 'application/pdf') ORDER BY u.created_at DESC`, req.accountId);
    res.json(rows.map((r) => ({ ...r, url: `${publicBase()}/u/${r.id}` })));
  });
  api.put('/files/:id', async (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 120);
    const r = await db().get('UPDATE uploads SET name = ?, in_library = 1 WHERE id = ? AND account_id = ? RETURNING id', name, String(req.params.id), req.accountId);
    if (!r) throw new HttpError(404, 'File not found');
    res.json({ ok: true });
  });
  api.delete('/files/:id', async (req, res) => {
    await db().run('DELETE FROM uploads WHERE id = ? AND account_id = ?', String(req.params.id), req.accountId);
    res.json({ ok: true });
  });

  // The download: checked, logged on the person's record, then the file.
  app.get('/dl/:token', async (req, res) => {
    // <contact>.<file id, which has its own dot>.<signature>
    const parts = String(req.params.token).split('.');
    const [cid, s, fileId] = [parts[0], parts.at(-1), parts.slice(1, -1).join('.')];
    const contactId = Number(cid);
    const expected = contactId && fileId ? sig(contactId, fileId) : '';
    if (!expected || !s || s.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected))) {
      return res.status(404).type('text/plain').send('This download link isn’t valid.');
    }
    const file = await db().get('SELECT u.id, u.account_id, u.name, u.content_type, u.data, u.storage_url FROM uploads u JOIN contacts c ON c.id = ? AND c.account_id = u.account_id WHERE u.id = ?', contactId, fileId);
    if (!file) return res.status(404).type('text/plain').send('This file is no longer available.');
    await logEvent(db(), file.account_id, { person_id: contactId, type: 'download', source: 'email', meta: { file: file.id, name: file.name || 'a file' } }).catch(() => {});
    // Large files live in file storage; the person is sent there, already counted.
    if (file.storage_url) return res.set({ 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' }).redirect(302, file.storage_url);
    const ext = file.id.split('.').pop();
    const filename = `${(file.name || 'download').replace(/[^\w .()-]+/g, '').trim().slice(0, 80) || 'download'}.${ext}`;
    res.set({ 'Content-Type': file.content_type, 'Content-Disposition': `inline; filename="${filename}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex', ...(file.content_type === 'application/pdf' ? { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" } : {}) });
    res.send(Buffer.from(file.data));
  });

  return { linkFor, ownFileId };
}

module.exports = { registerFiles };
