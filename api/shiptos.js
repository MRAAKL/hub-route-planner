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


// ---------- place lookup (postal code or address -> map position), from OneMap open data ----------
// Contains information from OneMap, Singapore Land Authority (Open Data Licence). Data is a 2020 copy, so new buildings may be missing.
const ABBR = { AVE: 'AVENUE', RD: 'ROAD', ST: 'STREET', DR: 'DRIVE', JLN: 'JALAN', TG: 'TANJONG', UPP: 'UPPER', NTH: 'NORTH', STH: 'SOUTH',
  CRES: 'CRESCENT', PL: 'PLACE', CL: 'CLOSE', CTL: 'CENTRAL', CTRL: 'CENTRAL', BT: 'BUKIT', BLVD: 'BOULEVARD', GDNS: 'GARDENS', LOR: 'LORONG',
  KG: 'KAMPONG', PK: 'PARK', TER: 'TERRACE', SQ: 'SQUARE', HTS: 'HEIGHTS', MT: 'MOUNT', CTR: 'CENTRE' };
const normTxt = (s) => String(s || '').toUpperCase().replace(/'/g, '').replace(/[^A-Z0-9 ]/g, ' ').split(' ').filter(Boolean).map((w) => ABBR[w] || w).join(' ');
let DATA = null;
function geoLookup(item) {
  if (!DATA) DATA = require('../sg-postal.json');
  const P = DATA.p, R = DATA.r, B = DATA.b;
  const hit = (v, src, label) => ({ lat: v[0], lng: v[1], src, label: label || '' });
  let p = String(item.postal || '').replace(/\D/g, '');
  if (p.length === 5) p = '0' + p;
  if (p.length === 6 && P[p]) return hit(P[p], 'postal');
  const text = String(item.text || '');
  for (const m of text.match(/\b\d{6}\b/g) || []) if (P[m]) return hit(P[m], 'postal');
  const w = normTxt(text).split(' ');
  let road = null;
  for (let i = 0; i < w.length; i++) {
    if (!/^\d+[A-Z]?$/.test(w[i])) continue;
    for (let n = 6; n >= 1; n--) {
      const name = w.slice(i + 1, i + 1 + n).join(' ');
      const list = R[name];
      if (!list) continue;
      const ex = list.find((x) => x[0] === w[i]);
      if (ex) return hit([ex[1], ex[2]], 'address', name);
      if (!road) road = { name, list };
      break;
    }
  }
  const GEN = new Set(['SHOPPING', 'CENTRE', 'MALL', 'SINGAPORE', 'PTE', 'LTD', 'PRIVATE', 'LIMITED', 'CO', 'THE', 'AND', 'DELIVER', 'TO', 'BLK', 'LEVEL', 'UNIT', 'STREET', 'ROAD', 'AVENUE', 'CENTRAL']);
  const grams = [];
  for (let n = 6; n >= 1; n--) for (let i = 0; i + n <= w.length; i++) {
    const g = w.slice(i, i + n);
    if (g.every((x) => GEN.has(x) || /^\d+$/.test(x))) continue;
    if (n === 1 && g[0].length < 5) continue;
    grams.push(g.join(' '));
  }
  for (const g of grams) if (B[g]) return hit(B[g], 'building', g);
  if (!road) for (const g of grams) if (g.split(' ').length >= 2 && R[g]) { road = { name: g, list: R[g] }; break; }
  if (road) {
    const a = road.list;
    return hit([a.reduce((s, x) => s + x[1], 0) / a.length, a.reduce((s, x) => s + x[2], 0) / a.length], 'road', road.name);
  }
  const keys = Object.keys(B);
  for (const g of grams) {
    if (g.split(' ').length < 2) continue;
    let best = null;
    for (const k of keys) if (k.includes(g) && (!best || k.length < best.length)) best = k;
    if (best) return hit(B[best], 'building', g);
  }
  if (road) {
    const a = road.list;
    return hit([a.reduce((s, x) => s + x[1], 0) / a.length, a.reduce((s, x) => s + x[2], 0) / a.length], 'road', road.name);
  }
  return null;
}

const num = (v, lo, hi) => { const x = Number(v); return isFinite(x) && x > lo && x < hi ? Math.round(x * 1e5) / 1e5 : undefined; };

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!URL_ || !TOKEN || !CODE) return res.status(500).json({ error: 'not_configured' });
  if (!sameCode(req.headers['x-access-code'], CODE)) return res.status(401).json({ error: 'bad_code' });
  try {
    if (req.method === 'POST' && req.query && req.query.op === 'geocode') {
      const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const out = {};
      for (const it of (Array.isArray(b.items) ? b.items : []).slice(0, 300)) {
        if (!it || !it.id) continue;
        const r = geoLookup(it);
        if (r) out[String(it.id).slice(0, 40)] = r;
      }
      return res.status(200).json({ results: out });
    }
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
          lat: num(e.lat, 1, 2), lng: num(e.lng, 103, 105), locsrc: clip(e.locsrc, 12),
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

module.exports.geoLookup = geoLookup;
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
