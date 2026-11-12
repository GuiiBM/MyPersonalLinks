// Lista de links com área pessoal.
//
// GET  /links.json (ou /api/links)      → só os projetos públicos
// POST /api/links { password }          → todos, cada um com `pessoal: true|false`
// POST /api/links { password, pessoal } → grava o que fica escondido e devolve todos
// POST /api/links { password, order }   → grava a ordem (lista de ids) e devolve todos
//
// O que fica escondido começa pelo campo `pessoal` do links.json, e a ordem pela ordem
// do arquivo; o que for mudado no menu do site fica guardado no Netlify Blobs e vale
// para todo mundo.

import { createHash, timingSafeEqual } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import links from '../../links.json' with { type: 'json' };

// sha256 da senha ("Guii"). Para trocar, defina PERSONAL_PASSWORD nas variáveis
// de ambiente da Netlify; ela tem prioridade sobre este hash.
const PASSWORD_HASH = 'a3775faaae162e13e3e090a6e0cf58b62db6fd3bd974c166341a3407131fab77';
const KEY = 'pessoal';
const ORDER = 'ordem';

const sha = s => createHash('sha256').update(s).digest();
const passwordOk = given => {
  if (typeof given !== 'string') return false;
  const expected = process.env.PERSONAL_PASSWORD
    ? sha(process.env.PERSONAL_PASSWORD)
    : Buffer.from(PASSWORD_HASH, 'hex');
  return timingSafeEqual(sha(given.trim()), expected);
};

const idOf = url => url.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');

const known = new Set(links.map(l => idOf(l.url)));

// aplica a ordem salva; projeto novo no links.json entra logo depois do que vem
// antes dele no arquivo
const sortBy = (rows, order) => {
  const byId = new Map(rows.map(r => [r.id, r]));
  const out = order.filter(id => byId.has(id)).map(id => byId.get(id));
  const placed = new Set(out.map(r => r.id));
  rows.forEach((r, i) => {
    if (placed.has(r.id)) return;
    const prev = rows.slice(0, i).reverse().find(p => placed.has(p.id));
    out.splice(prev ? out.indexOf(prev) + 1 : 0, 0, r);
    placed.add(r.id);
  });
  return out;
};

const resolve = (overrides, order) => sortBy(links.map(({ pessoal, ...l }) => {
  const id = idOf(l.url);
  return { ...l, url: l.url.trim(), id, pessoal: id in overrides ? overrides[id] === true : pessoal === true };
}), order);

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

export default async req => {
  const store = getStore({ name: 'links', consistency: 'strong' });
  const [savedOverrides, savedOrder] = await Promise.all([
    store.get(KEY, { type: 'json' }),
    store.get(ORDER, { type: 'json' })
  ]);
  let overrides = savedOverrides || {};
  let order = Array.isArray(savedOrder) ? savedOrder : [];

  if (req.method === 'GET' || req.method === 'HEAD') {
    return json(resolve(overrides, order).filter(l => !l.pessoal).map(({ pessoal, ...l }) => l));
  }
  if (req.method !== 'POST') return json({ error: 'método não permitido' }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'pedido inválido' }, 400); }
  if (!passwordOk(body && body.password)) return json({ error: 'senha incorreta' }, 401);

  if (body.pessoal && typeof body.pessoal === 'object') {
    overrides = {};
    for (const [id, v] of Object.entries(body.pessoal)) if (known.has(id)) overrides[id] = v === true;
    await store.setJSON(KEY, overrides);
  }

  if (Array.isArray(body.order)) {
    order = [...new Set(body.order.filter(id => typeof id === 'string' && known.has(id)))];
    await store.setJSON(ORDER, order);
  }

  return json(resolve(overrides, order));
};

// a função responde também por /links.json, então a lista completa nunca é pública
export const config = { path: ['/api/links', '/links.json'] };
