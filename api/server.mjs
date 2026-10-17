#!/usr/bin/env node
// Paid one-pager API: send a document and the hash of a DigiByte transaction that paid at least MIN_DGB to
// our address; get back a one-pager whose picture our own image model drew from the document. No API key —
// the transaction is the ticket, and it is burned once its one-pager is made.
//
//   POST /v1/onepage   body: the PDF (application/pdf) or text (text/plain, text/markdown)
//                      header X-DGB-Tx: <transaction hash>   optional: ?title=…
//     → 202 { job, status_url }   402 payment not (yet) sufficient   409 hash already used
//   GET  /v1/jobs/<id>[?wait=60]  → 202 while it runs, 200 application/pdf when done, 500 if it failed
//   GET  /                        → how to pay (address, price, confirmations)
//
// Cloudflare ends requests after 100 s, an image plus the layout take longer — hence job + poll.
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { TXID, evaluatePayment, fetchTransaction } from './dgb.mjs';
import { openStore } from './store.mjs';
import { runJob } from './pipeline.mjs';

const env = process.env;
const CFG = {
  port: Number(env.PORT || 8080),
  dataDir: env.DATA_DIR || '/data',
  address: env.RECEIVE_ADDRESS || 'DMYWvZ9r7cNa5xAWVvHxQ7SdHNbU9HMciU',
  minDgb: Number(env.MIN_DGB || 10),
  minConfirmations: Number(env.MIN_CONFIRMATIONS || 2),
  maxBytes: Number(env.MAX_UPLOAD_MB || 20) * 1048576,
  dgb: { url: env.DGB_RPC_URL || 'http://digibyte.astrion-core.svc.cluster.local:12025', user: env.DGB_RPC_USER, password: env.DGB_RPC_PASS },
  llm: { url: env.LLM_URL || 'http://vllm-chat.astrion-ai.svc.cluster.local:8009', apiKey: env.LLM_API_KEY, model: env.LLM_MODEL || undefined },
  image: { url: env.IMAGE_URL || 'http://imagegen-james.astrion-ai.svc.cluster.local:7860', model: env.IMAGE_MODEL || 'Qwen/Qwen-Image-2.1' },
};
mkdirSync(join(CFG.dataDir, 'jobs'), { recursive: true });
const store = openStore(join(CFG.dataDir, 'api.sqlite'));
store.recover();

const send = (res, status, body, headers = {}) => {
  const json = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, { 'content-type': json ? 'application/json' : 'application/pdf', 'cache-control': 'no-store', ...headers });
  res.end(json ? JSON.stringify(body, null, 2) + '\n' : body);
};
const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = []; let n = 0;
  req.on('data', (c) => { n += c.length; if (n > CFG.maxBytes) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});
const jobDir = (id) => join(CFG.dataDir, 'jobs', id);
const publicJob = (j) => ({ job: j.id, status: j.status, title: j.title, error: j.error || undefined, created: j.created_at, finished: j.finished_at || undefined });

async function createJob(req, res, url) {
  const txid = String(req.headers['x-dgb-tx'] || url.searchParams.get('tx') || '').trim().toLowerCase();
  if (!TXID.test(txid)) return send(res, 400, { error: 'missing_or_invalid_tx', detail: 'Send the transaction hash (64 hex characters) in the X-DGB-Tx header.' });
  const type = String(req.headers['content-type'] || '').split(';')[0].trim();
  const ext = type === 'application/pdf' ? 'pdf' : type === 'text/markdown' ? 'md' : type === 'text/plain' ? 'txt' : null;
  if (!ext) return send(res, 415, { error: 'unsupported_type', detail: 'Send application/pdf, text/plain or text/markdown.' });
  const body = await readBody(req);
  if (!body.length) return send(res, 400, { error: 'empty_body' });

  const used = store.payment(txid);
  if (used && used.status !== 'released') return send(res, 409, { error: 'tx_already_used', status: used.status, job: used.job_id });
  let tx;
  try {
    tx = await fetchTransaction(txid, CFG.dgb);
  } catch (e) {
    console.error(`[payment check] ${e.message}`);
    return send(res, 503, { error: 'payment_check_unavailable', detail: 'Our DigiByte node cannot be reached right now. Your transaction is not used; try again later.' });
  }
  if (!tx) return send(res, 402, { error: 'tx_not_found', detail: 'Our node does not know this transaction yet. Wait a minute and try again.' });
  const pay = evaluatePayment(tx, CFG);
  if (!pay.ok) {
    return send(res, 402, { error: pay.reason, paid_dgb: pay.paidDgb, confirmations: pay.confirmations, required_dgb: CFG.minDgb, required_confirmations: CFG.minConfirmations, address: CFG.address });
  }
  const id = randomUUID();
  if (!store.reserve(txid, pay.paidDgb, pay.confirmations, id)) return send(res, 409, { error: 'tx_already_used' });
  mkdirSync(jobDir(id), { recursive: true });
  const input = join(jobDir(id), `input.${ext}`);
  writeFileSync(input, body);
  const title = (url.searchParams.get('title') || '').slice(0, 80) || null;
  store.addJob(id, txid, title, input);
  queueMicrotask(work);
  return send(res, 202, { job: id, status: 'queued', status_url: `/v1/jobs/${id}`, paid_dgb: pay.paidDgb, confirmations: pay.confirmations });
}

async function getJob(res, id, url) {
  const wait = Math.min(Number(url.searchParams.get('wait') || 0), 90) * 1000, t0 = Date.now();
  let j = store.job(id);
  while (j && (j.status === 'queued' || j.status === 'running') && Date.now() - t0 < wait) {
    await new Promise((r) => setTimeout(r, 2000));
    j = store.job(id);
  }
  if (!j) return send(res, 404, { error: 'unknown_job' });
  if (j.status === 'done' && j.result && existsSync(j.result)) {
    return send(res, 200, readFileSync(j.result), { 'content-disposition': `attachment; filename="onepage-${id.slice(0, 8)}.pdf"` });
  }
  return send(res, j.status === 'failed' ? 500 : 202, publicJob(j));
}

// One job at a time: the image model and Chrome are the bottleneck, and order is fair.
let working = false;
async function work() {
  if (working) return;
  working = true;
  try {
    for (let j = store.nextQueued(); j; j = store.nextQueued()) {
      store.setJob(j.id, { status: 'running' });
      const pdf = join(jobDir(j.id), 'onepage.pdf');
      try {
        const r = await runJob({ inputFile: j.input, title: j.title, pdfOut: pdf, previewOut: join(jobDir(j.id), 'preview.jpg') }, CFG);
        store.setJob(j.id, { status: 'done', result: pdf, finished_at: new Date().toISOString() });
        store.burn(j.txid, { job: j.id, prompt: r.prompt, characters: r.characters, pdfBytes: r.pdfBytes, imageModel: CFG.image.model });
        console.log(`[job ${j.id}] done: ${r.characters} characters, ${r.pdfBytes} bytes`);
      } catch (e) {
        store.setJob(j.id, { status: 'failed', error: String(e.message || e).slice(0, 300), finished_at: new Date().toISOString() });
        store.release(j.txid, String(e.message || e).slice(0, 300));
        console.error(`[job ${j.id}] failed, transaction released: ${e.message}`);
      } finally {
        rmSync(j.input, { force: true });
      }
    }
  } finally {
    working = false;
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true });
    if (req.method === 'GET' && url.pathname === '/') {
      return send(res, 200, {
        service: 'Typographics Art one-pager API', docs: 'https://github.com/typ0graphic5/tg-art/blob/main/api/README.md',
        pay: { address: CFG.address, amount_dgb: CFG.minDgb, confirmations: CFG.minConfirmations, currency: 'DGB (DigiByte)' },
        usage: 'POST /v1/onepage with the document as body and the transaction hash in X-DGB-Tx; then GET the status_url.',
      });
    }
    if (req.method === 'POST' && url.pathname === '/v1/onepage') return await createJob(req, res, url);
    const m = url.pathname.match(/^\/v1\/jobs\/([0-9a-f-]{36})$/);
    if (req.method === 'GET' && m) return await getJob(res, m[1], url);
    return send(res, 404, { error: 'not_found' });
  } catch (e) {
    console.error(`[${req.method} ${url.pathname}]`, e.message);
    if (!res.headersSent) send(res, e.status || 500, { error: e.status === 413 ? 'too_large' : 'internal_error' });
  }
}).listen(CFG.port, () => {
  console.log(`typographics-art api on :${CFG.port}, address ${CFG.address}, ${CFG.minDgb} DGB, ${CFG.minConfirmations} confirmations`);
  work();
});
