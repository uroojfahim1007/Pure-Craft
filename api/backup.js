// PHASE 1 - Safety net: admin-only full export + safe restore.
// Uses the existing admin check from _lib.js (no auth changes).
// Export is read-only. Restore is add-only for images/orders; the catalogue
// (products + settings) is replaced ONLY when explicitly requested, after a
// safety copy of the current one is saved under a NEW key. Nothing is deleted.
const { redis, isAdmin } = require('./_lib');

const U0 = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const T0 = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

// Several small commands in one round-trip (Upstash /pipeline endpoint).
async function pipe(cmds) {
  if (!U0 || !T0) throw new Error('Database not connected');
  const out = [];
  for (let i = 0; i < cmds.length; i += 200) {
    const r = await fetch(U0.replace(/\/$/, '') + '/pipeline', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + T0 },
      body: JSON.stringify(cmds.slice(i, i + 200))
    });
    const j = await r.json();
    if (!Array.isArray(j)) throw new Error((j && j.error) || 'Database error');
    for (const x of j) { if (x.error) throw new Error(x.error); out.push(x.result); }
  }
  return out;
}

const ID = /^[a-z0-9]{1,40}$/;
const IMG = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const str = v => typeof v === 'string';

function vImage(id, d) {
  if (!ID.test(String(id))) return 'Bad image id';
  if (!str(d) || d.length > 900000 || !IMG.test(d)) return 'Image "' + id + '" is invalid or too large';
  return '';
}
function vOrder(o) {
  if (!isObj(o)) return 'An order is not an object';
  if (!ID.test(String(o.id))) return 'An order has a bad id';
  if (!str(o.name) || !str(o.phone) || !str(o.addr) || !Array.isArray(o.items) || !str(o.status || '')) return 'Order ' + o.id + ' is missing required fields';
  return '';
}
function vStore(products, settings) {
  if (!Array.isArray(products) || !products.length || products.length > 500) return 'Catalogue must contain 1-500 products';
  if (settings != null && !isObj(settings)) return 'Settings are invalid';
  const seen = new Set();
  for (const p of products) {
    if (!isObj(p) || (!str(p.id) && typeof p.id !== 'number') || String(p.id) === '' || !str(p.name) || !Array.isArray(p.imgs) || !p.imgs.every(str) || !isObj(p.st)) return 'A product is missing id, name, images or stock';
    if (seen.has(String(p.id))) return 'Duplicate product id ' + p.id;
    seen.add(String(p.id));
    if (p.price != null && p.price !== '' && !Number.isFinite(+p.price)) return 'Product ' + p.id + ' has an invalid price';
    for (const k of Object.keys(p.st)) if (!Number.isFinite(+p.st[k]) || +p.st[k] < 0) return 'Product ' + p.id + ' has invalid stock';
  }
  if (JSON.stringify({ products, settings }).length > 900000) return 'Catalogue is too large';
  return '';
}

async function scan(match) {
  const keys = new Set();
  let cur = '0';
  do {
    const r = await redis('SCAN', cur, 'MATCH', match, 'COUNT', '1000');
    cur = String(r[0]);
    r[1].forEach(k => keys.add(k));
  } while (cur !== '0');
  return [...keys];
}

module.exports = async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
    res.setHeader('Cache-Control', 'no-store');

    // ---------- EXPORT (read-only) ----------
    if (req.method === 'GET') {
      const part = String(req.query.part || '');

      if (part === 'manifest') {
        const keys = await scan('pc:*');
        const raw = await redis('GET', 'pc:store');
        let store = null, storeRaw = null;
        if (raw) { try { store = JSON.parse(raw); } catch (e) { storeRaw = raw; } }
        const imageIds = [], other = [], safety = [];
        for (const k of keys) {
          if (k === 'pc:store' || k === 'pc:orders') continue;
          if (k.startsWith('pc:img:')) imageIds.push(k.slice(7));
          else if (k.startsWith('pc:store:backup:')) safety.push(k);
          else other.push(k);
        }
        const types = other.length ? await pipe(other.map(k => ['TYPE', k])) : [];
        const orderCount = +(await redis('HLEN', 'pc:orders')) || 0;
        return res.json({ store, storeRaw, imageIds, other: other.map((k, i) => ({ key: k, type: types[i] })), safety, orderCount });
      }

      if (part === 'orders') {
        const r = await redis('HSCAN', 'pc:orders', String(req.query.cursor || '0'), 'COUNT', '200');
        const orders = []; let bad = 0;
        for (let i = 0; i < r[1].length; i += 2) {
          try { orders.push(JSON.parse(r[1][i + 1])); } catch (e) { bad++; }
        }
        return res.json({ cursor: String(r[0]), orders, bad });
      }

      if (part === 'img') {
        const id = String(req.query.id || '').replace(/[^a-z0-9]/g, '');
        const d = id && await redis('GET', 'pc:img:' + id);
        if (!d) return res.status(404).json({ error: 'Image not found' });
        return res.json({ id, data: d });
      }

      if (part === 'other') {
        const key = String(req.query.key || '');
        if (!key.startsWith('pc:') || key === 'pc:store' || key === 'pc:orders' || key.startsWith('pc:img:')) return res.status(400).json({ error: 'Bad key' });
        const type = await redis('TYPE', key);
        if (type === 'string') return res.json({ key, type, value: await redis('GET', key) });
        if (type === 'hash') {
          const a = await redis('HGETALL', key), value = {};
          for (let i = 0; i < a.length; i += 2) value[a[i]] = a[i + 1];
          return res.json({ key, type, value });
        }
        return res.json({ key, type, skipped: true });
      }
      return res.status(400).json({ error: 'Bad request' });
    }

    // ---------- RESTORE (validated, add-only except opt-in catalogue) ----------
    if (req.method === 'POST') {
      const b = req.body || {};

      // Read-only: what already exists?
      if (b.op === 'check') {
        const imageIds = Array.isArray(b.imageIds) ? b.imageIds : [], orderIds = Array.isArray(b.orderIds) ? b.orderIds : [];
        if (imageIds.length > 5000 || orderIds.length > 20000 || ![...imageIds, ...orderIds].every(x => ID.test(String(x)))) return res.status(400).json({ error: 'Bad ids' });
        const ir = imageIds.length ? await pipe(imageIds.map(i => ['EXISTS', 'pc:img:' + i])) : [];
        const or = orderIds.length ? await pipe(orderIds.map(i => ['HEXISTS', 'pc:orders', i])) : [];
        let products = 0;
        const raw = await redis('GET', 'pc:store');
        if (raw) { try { products = (JSON.parse(raw).products || []).length; } catch (e) { products = -1; } }
        return res.json({
          imagesExisting: imageIds.filter((_, i) => +ir[i] === 1),
          ordersExisting: orderIds.filter((_, i) => +or[i] === 1),
          store: { exists: !!raw, products }
        });
      }

      // Add images that do not exist yet (SET NX: never overwrites)
      if (b.op === 'images') {
        const items = b.items;
        if (!Array.isArray(items) || items.length > 40) return res.status(400).json({ error: 'Bad batch' });
        for (const it of items) { const e = vImage(it && it.id, it && it.data); if (e) return res.status(400).json({ error: e }); }
        let added = 0, skipped = 0, i = 0;
        const work = async () => {
          while (i < items.length) {
            const it = items[i++];
            const r = await redis('SET', 'pc:img:' + it.id, it.data, 'NX');
            if (r === 'OK') added++; else skipped++;
          }
        };
        await Promise.all([work(), work(), work()]);
        return res.json({ added, skipped });
      }

      // Add orders that do not exist yet (HSETNX: never overwrites)
      if (b.op === 'orders') {
        const orders = b.orders;
        if (!Array.isArray(orders) || orders.length > 500) return res.status(400).json({ error: 'Bad batch' });
        const seen = new Set();
        for (const o of orders) {
          const e = vOrder(o); if (e) return res.status(400).json({ error: e });
          if (seen.has(o.id)) return res.status(400).json({ error: 'Duplicate order ' + o.id });
          seen.add(o.id);
        }
        const r = orders.length ? await pipe(orders.map(o => ['HSETNX', 'pc:orders', o.id, JSON.stringify(o)])) : [];
        const added = r.filter(x => +x === 1).length;
        return res.json({ added, skipped: orders.length - added });
      }

      // Replace catalogue + settings (only when the admin ticked the box).
      // A safety copy of the current value is written to a NEW key first.
      if (b.op === 'store') {
        const { products, settings } = b;
        const e = vStore(products, settings); if (e) return res.status(400).json({ error: e });
        const cur = await redis('GET', 'pc:store');
        let safetyKey = null;
        if (cur) {
          safetyKey = 'pc:store:backup:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
          const ok = await redis('SET', safetyKey, cur, 'NX');
          if (ok !== 'OK') return res.status(500).json({ error: 'Could not save a safety copy, nothing was changed' });
        }
        await redis('SET', 'pc:store', JSON.stringify({ products, settings }));
        const refs = [...new Set(products.flatMap(p => p.imgs).map(u => (/^\/api\/img\?id=([a-z0-9]+)$/.exec(u) || [])[1]).filter(Boolean))];
        const ex = refs.length ? await pipe(refs.map(i => ['EXISTS', 'pc:img:' + i])) : [];
        return res.json({ ok: 1, safetyKey, missingImages: refs.filter((_, i) => +ex[i] !== 1) });
      }
      return res.status(400).json({ error: 'Bad request' });
    }
    res.status(405).end();
  } catch (e) { res.status(500).json({ error: e.message }); }
};
