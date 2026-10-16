// Driver page backend for the Hub Route Planner pilot.
// A driver opens a link that carries a long random code for ONE route. The code is the only key: there is no login.
// Photos of the signed paper PODs are kept for POD_DAYS days, then removed automatically.
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const KEEP_DAYS = 14;
const MAX_PHOTO = 450000; // characters of base64 text, about 330 KB
const MAX_PHOTOS_PER_STOP = 4;

async function redis(cmd) {
  const r = await fetch(URL_, { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || 'storage error');
  return j.result;
}
const clip = (v, n) => String(v == null ? '' : v).slice(0, n);

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!URL_ || !TOKEN) return res.status(500).json({ error: 'not_configured' });
  const t = String((req.query && req.query.t) || '');
  if (!/^[a-f0-9]{32}$/.test(t)) return res.status(404).json({ error: 'not_found' });
  try {
    const raw = await redis(['GET', 'hub:trip:' + t]);
    if (!raw) return res.status(404).json({ error: 'not_found' });
    const trip = JSON.parse(raw);
    if (Date.now() > (trip.validUntil || 0)) return res.status(410).json({ error: 'expired' });
    if (req.method === 'GET') return res.status(200).json({ trip });
    if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const idx = Number(b.idx);
    const stop = trip.stops[idx];
    if (!stop) return res.status(400).json({ error: 'bad_stop' });
    const cid = clip(b.cid, 40);
    trip.done = trip.done || [];
    if (cid && trip.done.includes(cid)) return res.status(200).json({ ok: true, trip, dup: true });
    const now = new Date().toISOString();
    const kind = String(b.kind || '');
    if (kind === 'photo') {
      const p = String(b.photo || '');
      if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(p) || p.length > MAX_PHOTO) return res.status(400).json({ error: 'bad_photo' });
      const k = stop.photos || 0;
      if (k >= MAX_PHOTOS_PER_STOP) return res.status(400).json({ error: 'too_many_photos' });
      await redis(['SET', 'hub:pod:' + t + ':' + idx + ':' + k, p, 'EX', KEEP_DAYS * 86400]);
      stop.photos = k + 1;
      stop.state = 'delivered';
      stop.at = stop.at || clip(b.at, 30) || now;
      stop.serverAt = now;
      if (b.receivedBy) stop.receivedBy = clip(b.receivedBy, 80);
      if (b.note) stop.note = clip(b.note, 300);
    } else if (kind === 'delivered') {
      stop.state = 'delivered'; stop.at = clip(b.at, 30) || now; stop.serverAt = now;
      if (b.receivedBy) stop.receivedBy = clip(b.receivedBy, 80);
      if (b.note) stop.note = clip(b.note, 300);
    } else if (kind === 'problem') {
      stop.state = 'problem'; stop.at = clip(b.at, 30) || now; stop.serverAt = now; stop.note = clip(b.note, 300);
    } else if (kind === 'reset') {
      stop.state = 'pending'; delete stop.note; delete stop.at;
    } else return res.status(400).json({ error: 'bad_kind' });
    if (cid) { trip.done.push(cid); trip.done = trip.done.slice(-60); }
    trip.updatedAt = now;
    await redis(['SET', 'hub:trip:' + t, JSON.stringify(trip), 'EX', KEEP_DAYS * 86400]);
    return res.status(200).json({ ok: true, trip });
  } catch (e) {
    return res.status(502).json({ error: 'storage_failed' });
  }
};
