#!/usr/bin/env node
// Paid one-pager API: send a document and the hash of a DigiByte transaction that paid at least MIN_DGB to
// our address; get back a one-pager whose picture our own image model drew from the document. No API key —
// the transaction is the ticket, and it is burned once its one-pager is made.
//
//   POST /v1/onepage   body: the PDF (application/pdf) or text (text/plain, text/markdown)
//                      header X-DGB-Tx: <transaction hash>   optional: ?title=…
//     → 202 { job, status_url }   402 payment not (yet) sufficient   409 hash already used   413 too large   429 slow down
//   GET  /v1/jobs/<id>[?wait=60]  → 202 while it runs, 200 application/pdf when done, 500 if it failed, 410 once the result was removed
//   GET  /                        → how to pay (address, price, confirmations)
//
// Cloudflare ends requests after 100 s, an image plus the layout take longer — hence job + poll.
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { randomUUID, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { TXID, evaluatePayment, fetchTransaction } from './dgb.mjs';
import { numberFrom } from './config.mjs';
import { createLimiter, clientAddress, trustedHeader } from './limit.mjs';
import { openStore } from './store.mjs';
import { runJob } from './pipeline.mjs';

const env = process.env;
// Everything that identifies a deployment is required: there are no defaults pointing at anybody's
// infrastructure, and the receive address must be the operator's own.
const need = (name) => {
  if (!env[name]) { console.error(`Missing required environment variable ${name} (see api/README.md, "Configuration").`); process.exit(1); }
  return env[name];
};
let CFG;
try {
  CFG = {
    port: numberFrom(env, 'PORT', 8080, { min: 1, max: 65535, integer: true }),
    dataDir: env.DATA_DIR || '/data',
    address: need('RECEIVE_ADDRESS'),
    minDgb: numberFrom(env, 'MIN_DGB', 10, { min: 0, minExclusive: true }),
    minConfirmations: numberFrom(env, 'MIN_CONFIRMATIONS', 2, { min: 0, integer: true }),
    maxBytes: numberFrom(env, 'MAX_UPLOAD_MB', 20, { min: 0, minExclusive: true }) * 1048576,
    jobTimeoutMs: numberFrom(env, 'JOB_TIMEOUT_MINUTES', 20, { min: 1 }) * 60000,
    keepDays: numberFrom(env, 'KEEP_RESULTS_DAYS', 7, { min: 1 }),
    checksPerMinute: numberFrom(env, 'PAYMENT_CHECKS_PER_MINUTE', 30, { min: 1, integer: true }),
    globalChecksPerMinute: numberFrom(env, 'PAYMENT_CHECKS_PER_MINUTE_ALL', 300, { min: 1, integer: true }),
    trustProxy: trustedHeader(env.TRUST_PROXY),
    maxCharacters: numberFrom(env, 'MAX_CHARACTERS', 700000, { min: 1000, integer: true }),
    dgb: { url: need('DGB_RPC_URL'), user: env.DGB_RPC_USER, password: env.DGB_RPC_PASS },
    llm: { url: need('LLM_URL'), apiKey: env.LLM_API_KEY, model: env.LLM_MODEL || undefined },
    image: { url: need('IMAGE_URL'), model: env.IMAGE_MODEL || 'Qwen/Qwen-Image-2.1' },
  };
} catch (e) { console.error(e.message); process.exit(1); }
process.on('unhandledRejection', (e) => console.error('[unhandled rejection]', e?.message || e));
mkdirSync(join(CFG.dataDir, 'jobs'), { recursive: true });
const store = openStore(join(CFG.dataDir, 'api.sqlite'));
store.recover();

const send = (res, status, body, headers = {}) => {
  const json = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, { 'content-type': json ? 'application/json' : 'application/pdf', 'cache-control': 'no-store', ...headers });
  res.end(json ? JSON.stringify(body, null, 2) + '\n' : body);
};
// Reads the body up to the limit. Past the limit it stops storing but keeps draining (up to 4 times the limit),
// so the client gets a proper 413 instead of a reset connection.
const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = []; let n = 0, over = false;
  req.on('data', (c) => {
    n += c.length;
    if (n > CFG.maxBytes) { over = true; if (n > CFG.maxBytes * 4) req.destroy(); } else if (!over) chunks.push(c);
  });
  req.on('end', () => (over ? reject(Object.assign(new Error('too large'), { status: 413 })) : resolve(Buffer.concat(chunks))));
  req.on('error', reject);
  req.on('close', () => { if (!req.complete) reject(Object.assign(new Error('upload aborted'), { status: 400 })); });
});
// Payment checks cost a call to the node: a limit per client and one for everybody (api/limit.mjs).
const limiter = createLimiter({ perClient: CFG.checksPerMinute, global: CFG.globalChecksPerMinute });
const tooManyChecks = (req) => limiter.tooMany(clientAddress(req, CFG));
// A hash the node does not know yet is remembered for a few seconds: asking again costs nothing and uses no budget.
const unknownTx = new Map();
const NOT_FOUND_TTL_MS = 10000;
const recentlyUnknown = (txid) => { const until = unknownTx.get(txid); if (until && until > Date.now()) return true; unknownTx.delete(txid); return false; };
const rememberUnknown = (txid) => { unknownTx.set(txid, Date.now() + NOT_FOUND_TTL_MS); while (unknownTx.size > 5000) unknownTx.delete(unknownTx.keys().next().value); };
const jobDir = (id) => join(CFG.dataDir, 'jobs', id);
// The reason a job failed stays in the server log and the ledger; the client learns only what it can act on.
const publicJob = (j) => ({
  job: j.id, status: j.status, title: j.title, created: j.created_at, finished: j.finished_at || undefined,
  ...(j.status === 'failed' ? String(j.error || '').startsWith('refused: ') ? { error: 'document_refused', transaction_released: true, detail: j.error.slice(9) } : j.image_made ? { error: 'failed_after_the_picture_was_made', transaction_released: false } : { error: 'failed_before_the_picture_was_made', transaction_released: true, detail: 'Our side failed. Your transaction is released: send the same hash again.' } : {}),
});

async function createJob(req, res, url) {
  const txid = String(req.headers['x-dgb-tx'] || url.searchParams.get('tx') || '').trim().toLowerCase();
  if (!TXID.test(txid)) return send(res, 400, { error: 'missing_or_invalid_tx', detail: 'Send the transaction hash (64 hex characters) in the X-DGB-Tx header.' });
  const type = String(req.headers['content-type'] || '').split(';')[0].trim();
  const ext = type === 'application/pdf' ? 'pdf' : type === 'text/markdown' ? 'md' : type === 'text/plain' ? 'txt' : null;
  if (!ext) return send(res, 415, { error: 'unsupported_type', detail: 'Send application/pdf, text/plain or text/markdown.' });
  // Nothing is read, and the node is not asked, before the cheap checks have passed.
  if (Number(req.headers['content-length'] || 0) > CFG.maxBytes) return send(res, 413, { error: 'too_large', detail: `At most ${Math.floor(CFG.maxBytes / 1048576)} MB.` }); // no `connection: close`: Node then discards the unread body after answering, and the client still receives the 413
  const used = store.payment(txid);
  if (used && used.status !== 'released') return send(res, 409, { error: 'tx_already_used' }); // nothing about the job: hashes are public
  if (recentlyUnknown(txid)) return send(res, 402, { error: 'tx_not_found', detail: 'Our node does not know this transaction yet. Wait a minute and try again.' });
  if (tooManyChecks(req)) return send(res, 429, { error: 'slow_down', detail: 'Too many payment checks from your address. Wait a minute.' }, { 'retry-after': '60' });
  let tx;
  try {
    tx = await fetchTransaction(txid, CFG.dgb);
  } catch (e) {
    console.error(`[payment check] ${e.message}`);
    return send(res, 503, { error: 'payment_check_unavailable', detail: 'Our DigiByte node cannot be reached right now. Your transaction is not used; try again later.' });
  }
  if (!tx) { rememberUnknown(txid); return send(res, 402, { error: 'tx_not_found', detail: 'Our node does not know this transaction yet. Wait a minute and try again.' }); }
  const pay = evaluatePayment(tx, CFG);
  if (!pay.ok) {
    return send(res, 402, { error: pay.reason, paid_dgb: pay.paidDgb, confirmations: pay.confirmations, required_dgb: CFG.minDgb, required_confirmations: CFG.minConfirmations, address: CFG.address });
  }
  const body = await readBody(req); // only a paying request gets to upload
  if (!body.length) return send(res, 400, { error: 'empty_body' });
  const id = randomUUID();
  if (!store.reserve(txid, pay.paidDgb, pay.confirmations, id)) return send(res, 409, { error: 'tx_already_used' });
  // From here on a failure must give the payment back, or it stays reserved with no job.
  let token;
  try {
    mkdirSync(jobDir(id), { recursive: true });
    const input = join(jobDir(id), `input.${ext}`);
    writeFileSync(input, body);
    const title = (url.searchParams.get('title') || '').slice(0, 80) || null;
    // The job is fetched with a secret only this answer carries; the transaction hash alone is public on the chain.
    token = randomBytes(24).toString('base64url');
    store.addJob(id, txid, sha256(token), title, input);
  } catch (e) {
    console.error(`[job ${id}] could not be queued: ${e.message}`);
    rmSync(jobDir(id), { recursive: true, force: true });
    store.release(txid, 'could not be queued');
    return send(res, 500, { error: 'internal_error', detail: 'The job could not be queued. Your transaction is released: send the same hash again.' });
  }
  work().catch((e) => console.error('[queue]', e.message));
  return send(res, 202, { job: id, token, status: 'queued', status_url: `/v1/jobs/${id}?token=${token}`, paid_dgb: pay.paidDgb, confirmations: pay.confirmations });
}

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const tokenOk = (j, token) => {
  const a = Buffer.from(sha256(token || '')), b = Buffer.from(j.token_hash);
  return a.length === b.length && timingSafeEqual(a, b);
};

async function getJob(req, res, id, url) {
  const wait = Math.min(Number(url.searchParams.get('wait') || 0), 90) * 1000, t0 = Date.now();
  let j = store.job(id);
  if (!j || !tokenOk(j, url.searchParams.get('token') || req.headers['x-job-token'])) return send(res, 404, { error: 'unknown_job' });
  while (j && (j.status === 'queued' || j.status === 'running') && Date.now() - t0 < wait) {
    await new Promise((r) => setTimeout(r, 2000));
    j = store.job(id);
  }
  if (!j) return send(res, 404, { error: 'unknown_job' });
  if (j.status === 'done' && !j.result) return send(res, 410, { error: 'result_removed', detail: `Results are kept for ${CFG.keepDays} days.` });
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
      let imageMade = false, timer, session = null, stopped = false, run;
      const abort = new AbortController();
      try {
        run = runJob({ inputFile: j.input, title: j.title, pdfOut: pdf, previewOut: join(jobDir(j.id), 'preview.jpg'), signal: abort.signal, onImage: () => { imageMade = true; store.setJob(j.id, { image_made: 1 }); }, onSession: (x) => { session = x; } }, CFG);
        run.then(() => { stopped = true; }, () => { stopped = true; });
        // On a timeout the job is aborted (model requests end, the browser is shut down) and the service goes on.
        const timeout = new Promise((_, reject) => { timer = setTimeout(() => { abort.abort(); session?.close().catch(() => {}); reject(Object.assign(new Error(`job exceeded ${CFG.jobTimeoutMs / 60000} minutes`), { timedOut: true })); }, CFG.jobTimeoutMs); });
        const r = await Promise.race([run, timeout]);
        store.setJob(j.id, { status: 'done', result: pdf, finished_at: new Date().toISOString() });
        store.burn(j.txid, { job: j.id, prompt: r.prompt, characters: r.characters, pdfBytes: r.pdfBytes, imageModel: CFG.image.model });
        console.log(`[job ${j.id}] done: ${r.characters} characters, ${r.pdfBytes} bytes`);
      } catch (e) {
        // After a timeout, wait (at most 30 s) until the run has really stopped: the transaction is only released
        // while nothing can still be using the image model for it.
        if (e.timedOut) await Promise.race([run.catch(() => {}), new Promise((r) => setTimeout(r, 30000))]);
        const stillRunning = e.timedOut && !stopped;
        const reason = (e.refused ? 'refused: ' : '') + String(e.message || e).slice(0, 300);
        store.setJob(j.id, { status: 'failed', error: reason, finished_at: new Date().toISOString() });
        // Released only if the failure came before the picture was made (our outage); once the image model has
        // worked for this payment, it is spent even if the layout failed.
        const spent = imageMade || stillRunning;
        if (spent) store.burn(j.txid, { job: j.id, failedAfterImage: reason, stillRunningAfterTimeout: stillRunning || undefined });
        else store.release(j.txid, reason);
        console.error(`[job ${j.id}] failed (${spent ? 'after the image or still running, transaction burned' : 'transaction released'}): ${reason}`);
      } finally {
        clearTimeout(timer);
        rmSync(j.input, { force: true });
      }
    }
  } catch (e) {
    console.error('[queue]', e.message);
  } finally {
    working = false;
  }
}

// Finished results are kept for KEEP_RESULTS_DAYS, then the files go and the job answers 410.
function sweep() {
  try {
    for (const j of store.expired(CFG.keepDays)) {
      rmSync(jobDir(j.id), { recursive: true, force: true });
      store.setJob(j.id, { result: null });
    }
  } catch (e) { console.error('[sweep]', e.message); }
}
sweep();
setInterval(sweep, 3600000).unref();

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true });
    if (req.method === 'GET' && url.pathname === '/') {
      return send(res, 200, {
        service: 'Typographics Art one-pager API', docs: 'https://github.com/typographics-art/typogram/blob/main/api/README.md',
        pay: { address: CFG.address, amount_dgb: CFG.minDgb, confirmations: CFG.minConfirmations, currency: 'DGB (DigiByte)' },
        usage: 'POST /v1/onepage with the document as body and the transaction hash in X-DGB-Tx; then GET the status_url.',
      });
    }
    if (req.method === 'POST' && url.pathname === '/v1/onepage') return await createJob(req, res, url);
    const m = url.pathname.match(/^\/v1\/jobs\/([0-9a-f-]{36})$/);
    if (req.method === 'GET' && m) return await getJob(req, res, m[1], url);
    return send(res, 404, { error: 'not_found' });
  } catch (e) {
    console.error(`[${req.method} ${url.pathname}]`, e.message);
    if (!res.headersSent) send(res, e.status || 500, { error: e.status === 413 ? 'too_large' : 'internal_error' });
  }
}).listen(CFG.port, () => {
  console.log(`typographics-art api on :${CFG.port}, address ${CFG.address}, ${CFG.minDgb} DGB, ${CFG.minConfirmations} confirmations`);
  work().catch((e) => console.error('[queue]', e.message));
});
