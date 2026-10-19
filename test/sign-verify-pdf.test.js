// tg sign + three-state verify on a PDF, whose data-layer record lives in a metadata.json attachment (not inline markup).
// Signing re-embeds the signed record and draws the visible seal on page 1; neither touches the text layer, so the
// identity hash is unchanged. Needs MuPDF (mutool); skipped without it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TG = join(HERE, '..', 'cli', 'tg.mjs');
const APPLY = join(HERE, '..', 'cli', 'pdf-sign-apply.js');
const SUBJECT = join(HERE, '..', 'examples', 'us-constitution', 'onepage.pdf'); // a real, consistent Typogram PDF (signed in the repo)
const run = (...a) => spawnSync(process.execPath, [TG, ...a], { encoding: 'utf8' });
const haveMutool = spawnSync('which', ['mutool']).status === 0;

test('tg sign/verify PDF: UNSIGNED → VERIFIED, and the seal + signature keep the identity hash', { skip: haveMutool ? false : 'needs MuPDF (mutool)' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tg-pdf-'));
  try {
    // Committed example PDFs are signed, so build an UNSIGNED-but-consistent fixture: take the record, drop its signature,
    // and re-embed it (no seal). This exercises the UNSIGNED path without depending on any committed file's signed state.
    const rec = JSON.parse(run('extract', SUBJECT, '--json').stdout);
    delete rec.tgart.signature;
    const meta = join(dir, 'metadata.json');
    writeFileSync(meta, JSON.stringify(rec));
    const unsigned = join(dir, 'unsigned.pdf');
    assert.equal(spawnSync('mutool', ['run', APPLY, SUBJECT, unsigned, meta, ''], { encoding: 'utf8' }).status, 0, 'build unsigned fixture');
    assert.equal(run('verify', unsigned).status, 2, 'a consistent PDF with no signature is UNSIGNED (exit 2)');

    assert.equal(run('keygen', '--issuer', 'test.example', '--kid', 'k1', '--out', dir, '--private-out', join(dir, 'priv.pem')).status, 0);
    const signed = join(dir, 'signed.pdf');
    const s = run('sign', unsigned, '--key', join(dir, 'priv.pem'), '--issuer', 'test.example', '--kid', 'k1', '--out', signed);
    assert.equal(s.status, 0, `signing the PDF should succeed:\n${s.stdout}${s.stderr}`);

    const v = run('verify', signed, '--keys', dir);
    assert.equal(v.status, 0, `the signed PDF should be VERIFIED:\n${v.stdout}${v.stderr}`);
    assert.match(v.stdout, /VERIFIED/);
    assert.match(v.stdout, /test\.example/);

    // the seal is a shape overlay and the signature lives in an attachment — the text the page carries is unchanged
    const hashOf = (f) => run('extract', f, '--json').stdout.match(/"hash":\s*"([0-9a-f]{64})"/)?.[1];
    assert.equal(hashOf(signed), hashOf(unsigned), 'the seal + signature do not change the identity hash');

    assert.equal(run('verify', signed).status, 1, 'without the issuer key, a signed PDF does not pass (TAMPERED)');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
