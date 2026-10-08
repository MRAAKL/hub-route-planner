// Shared Ship-to list for the Hub Route Planner pilot.
// Stores entries in an Upstash Redis database (added from the Vercel Storage / Marketplace tab).
// Protected by one shared access code (ACCESS_CODE environment variable). This is NOT a user login.
const crypto = require('crypto');

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const CODE = process.env.ACCESS_CODE;
const HASH = 'hub:shiptos';
const LOG = 'hub:shiptos:log';

async function redis(cmd) {
  const r = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || 'storage error');
  return j.result;
}

async function pipeline(cmds) {
  const r = await fetch(URL_.replace(/\/+$/, '') + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
  });
  const j = await r.json();
  if (!r.ok || !Array.isArray(j) || j.some(x => x && x.error)) throw new Error('storage error');
  return j;
}

function sameCode(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
const clip = (v, n) => String(v == null ? '' : v).slice(0, n);

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!URL_ || !TOKEN || !CODE) return res.status(500).json({ error: 'not_configured' });
  if (!sameCode(req.headers['x-access-code'], CODE)) return res.status(401).json({ error: 'bad_code' });
  try {
    if (req.method === 'GET') {
      const flat = (await redis(['HGETALL', HASH])) || [];
      const entries = {};
      for (let i = 0; i < flat.length; i += 2) { try { entries[flat[i]] = JSON.parse(flat[i + 1]); } catch (e) {} }
      return res.status(200).json({ entries });
    }
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const by = clip(body.by, 60) || 'unknown';
    if (req.method === 'POST') {
      const list = Array.isArray(body.items) ? body.items.slice(0, 200) : [{ key: body.key, entry: body.entry }];
      const cmds = [];
      let n = 0;
      for (const it of list) {
        if (!it || !it.key || !it.entry) continue;
        const e = it.entry;
        const entry = {
          cust: clip(e.cust, 80), name: clip(e.name, 160), addr: clip(e.addr, 300), postal: clip(e.postal, 12),
          code: clip(e.code, 20), method: clip(e.method, 500), pod: clip(e.pod, 500),
          saved: new Date().toISOString().slice(0, 10), by,
        };
        if (!entry.cust || !entry.name || (!entry.addr && !entry.postal)) continue;
        cmds.push(['HSET', HASH, clip(it.key, 260), JSON.stringify(entry)]);
        n++;
      }
      if (cmds.length) {
        // one log line per batch, not per entry, so a large import stays quick
        cmds.push(['LPUSH', LOG, JSON.stringify({ at: new Date().toISOString(), by, act: 'set', count: n, first: list[0] && list[0].key })]);
        cmds.push(['LTRIM', LOG, 0, 999]);
        await pipeline(cmds);
      }
      return res.status(200).json({ ok: true, saved: n });
    }
    if (req.method === 'DELETE') {
      const key = clip(req.query && req.query.key, 260);
      if (!key) return res.status(400).json({ error: 'no_key' });
      await redis(['HDEL', HASH, key]);
      await redis(['LPUSH', LOG, JSON.stringify({ at: new Date().toISOString(), by, act: 'delete', key })]);
      await redis(['LTRIM', LOG, 0, 999]);
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'method' });
  } catch (e) {
    return res.status(502).json({ error: 'storage_failed' });
  }
};
