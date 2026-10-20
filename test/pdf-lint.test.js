// PDF counterpart of picture-lint.test.js: the text layer (and so hash + signature) stays intact while the PAGE is painted
// over. Each case appends a content stream to a real signed one-pager; all must come out TAMPERED, the original VERIFIED.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pdfPaintProblems } from '../cli/pdf-lint.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'examples', 'agentic-engineering', 'onepage.pdf');
const have = spawnSync('mutool', ['-v']).status !== null && existsSync(SRC);
const opts = { skip: have ? false : 'needs MuPDF (mutool) and the example PDF' };

const CASES = {
  'a white rectangle over the whole page': 'q 1 1 1 rg 0 0 595 842 re f Q',
  'a clipped cover': 'q 0 0 595 842 re W n 1 1 1 rg 0 0 595 842 re f Q',
  'a seal-green cover that is not the corner seal': 'q .122 .541 .298 rg 0 0 595 842 re f Q',
  'a strike-through line': 'q 5 w 0 0 m 595 842 l S Q',
  'a paper-coloured bar over one line': 'q 0.07 0.07 0.09 rg 50 600 200 14 re f Q',
};

test('the signed one-pager has a clean painted page', opts, async () => {
  assert.deepEqual(await pdfPaintProblems(SRC), []);
  const r = spawnSync('node', [join(ROOT, 'cli', 'tg.mjs'), 'verify', SRC], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

for (const [name, stream] of Object.entries(CASES)) {
  test(`visual lie caught in a PDF: ${name}`, opts, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tg-pdf-lint-'));
    try {
      const out = join(dir, 'lie.pdf');
      const b = spawnSync('mutool', ['run', join(ROOT, 'test', 'fixtures', 'pdf-append-stream.js'), SRC, out, stream], { encoding: 'utf8' });
      assert.equal(b.status, 0, b.stderr);
      assert.ok((await pdfPaintProblems(out)).length > 0, 'lint flags it');
      const r = spawnSync('node', [join(ROOT, 'cli', 'tg.mjs'), 'verify', out], { encoding: 'utf8' });
      assert.equal(r.status, 1, r.stdout + r.stderr); // TAMPERED
      assert.match(r.stderr, /picture layer/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
