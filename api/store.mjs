// Durable state of the paid API (SQLite, one file on the service's volume):
// - payments: one row per transaction hash. A hash is burned once a one-pager was made from it; while a job
//   runs it is reserved; if the job fails it is released, so the payer can try again with the same hash.
// - jobs: the queue and results.
// - ledger: the separate booking of every paid image (append-only).
import { DatabaseSync } from 'node:sqlite';

export function openStore(file) {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS payments (
      txid TEXT PRIMARY KEY, paid_dgb REAL NOT NULL, confirmations INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('reserved', 'burned', 'released')),
      job_id TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, txid TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed')),
      title TEXT, input TEXT NOT NULL, result TEXT, error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), finished_at TEXT);
    CREATE TABLE IF NOT EXISTS ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL DEFAULT (datetime('now')),
      txid TEXT NOT NULL, event TEXT NOT NULL, paid_dgb REAL, detail TEXT);
    CREATE TRIGGER IF NOT EXISTS ledger_append_only_u BEFORE UPDATE ON ledger BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS ledger_append_only_d BEFORE DELETE ON ledger BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
  `);
  const q = (sql) => db.prepare(sql);
  const book = q('INSERT INTO ledger (txid, event, paid_dgb, detail) VALUES (?, ?, ?, ?)');

  return {
    /**
     * Reserves a transaction for a job — atomically: a new hash, or one released after a failed job.
     * Returns false when the hash is already burned or a job with it is running.
     */
    reserve(txid, paidDgb, confirmations, jobId) {
      const r = q(`INSERT INTO payments (txid, paid_dgb, confirmations, status, job_id) VALUES (?, ?, ?, 'reserved', ?)
        ON CONFLICT (txid) DO UPDATE SET status = 'reserved', job_id = excluded.job_id, confirmations = excluded.confirmations,
          updated_at = datetime('now') WHERE payments.status = 'released'`).run(txid, paidDgb, confirmations, jobId);
      if (r.changes) book.run(txid, 'reserved', paidDgb, JSON.stringify({ jobId, confirmations }));
      return r.changes === 1;
    },
    burn(txid, detail) {
      q(`UPDATE payments SET status = 'burned', updated_at = datetime('now') WHERE txid = ? AND status = 'reserved'`).run(txid);
      const p = q('SELECT paid_dgb FROM payments WHERE txid = ?').get(txid);
      book.run(txid, 'image_generated', p?.paid_dgb ?? null, JSON.stringify(detail));
    },
    release(txid, reason) {
      q(`UPDATE payments SET status = 'released', updated_at = datetime('now') WHERE txid = ? AND status = 'reserved'`).run(txid);
      book.run(txid, 'released', null, JSON.stringify({ reason }));
    },
    payment: (txid) => q('SELECT * FROM payments WHERE txid = ?').get(txid),

    addJob(id, txid, title, input) {
      q(`INSERT INTO jobs (id, txid, status, title, input) VALUES (?, ?, 'queued', ?, ?)`).run(id, txid, title, input);
    },
    job: (id) => q('SELECT * FROM jobs WHERE id = ?').get(id),
    nextQueued: () => q(`SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at, rowid LIMIT 1`).get(),
    setJob(id, fields) {
      const keys = Object.keys(fields);
      q(`UPDATE jobs SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => fields[k]), id);
    },
    /** After a restart: jobs that were running did not finish — fail them and release their payments. */
    recover() {
      for (const j of q(`SELECT id, txid FROM jobs WHERE status = 'running'`).all()) {
        q(`UPDATE jobs SET status = 'failed', error = 'interrupted by a restart', finished_at = datetime('now') WHERE id = ?`).run(j.id);
        this.release(j.txid, 'interrupted by a restart');
      }
    },
    close: () => db.close(),
  };
}
