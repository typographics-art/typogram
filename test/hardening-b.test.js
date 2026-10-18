// Regression tests of the internal adversarial review 2026-10 (docs/security-review-internal-2026-10-b.md). Each test
// failed on main 4757fd5 and passes with the fix it names; the inputs are the exact reproductions of the report.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hideSecret, revealSecret } from '../src/secret.js';
import { revealAny } from '../src/crypt-book.js';
import { equalBytes, seededRandom } from '../src/crypt-codec.js';
import { parseBlocks, readMarkdown } from '../src/structured-md.js';
import { parseYaml } from '../src/structured-yaml.js';
import { markupText } from '../src/work-text.js';

const b64u = (b) => Buffer.from(b).toString('base64url');
const ms = (fn) => { const t = performance.now(); try { fn(); } catch { /* a refusal is fine; the time is what is measured */ } return performance.now() - t; };
/** A copy of the reader's row splitter (a table needs the same number of cells in the head and the delimiter row). */
function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { cur += '\\|'; i++; } else if (s[i] === '|') { cells.push(cur.trim()); cur = ''; } else cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}
/** Short random lines over an alphabet, deterministic. */
function randomLines(seed, alphabet, count, maxLen) {
  const rnd = seededRandom(seed), b = new Uint8Array(maxLen + 1), out = [];
  for (let i = 0; i < count; i++) { rnd(b); const len = b[0] % (maxLen + 1); let s = ''; for (let j = 0; j < len; j++) s += alphabet[b[1 + j] % alphabet.length]; out.push(s); }
  return out;
}

test('B-1 tg1: a varint of more than 7 bytes is refused as damaged, never decoded to a wrong message', async () => {
  const work = 'the quick brown fox jumps over the lazy dog';
  const key = await hideSecret(work, 'fox');
  assert.equal(await revealSecret(work, key), 'fox');
  const fp = Buffer.from(key.slice(4), 'base64url').subarray(0, 8);
  // fingerprint, then 200 continuation bytes (the varint never ends in 7 bytes), a terminator, then position 5 ("u")
  const crafted = 'tg1.' + b64u(Uint8Array.from([...fp, ...new Array(200).fill(0x80), 0x00, 5]));
  for (const read of [(k) => revealSecret(work, k), (k) => revealAny(work, k)]) {
    await assert.rejects(() => read(crafted), (e) => e.code === 'damaged');
  }
  // 8 continuation bytes are already too many (the reader of src/crypt-codec.js stops at 7 bytes too)
  const eight = 'tg1.' + b64u(Uint8Array.from([...fp, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x01]));
  await assert.rejects(() => revealSecret(work, eight), (e) => e.code === 'damaged');
  // a legitimate position still reads
  const one = 'tg1.' + b64u(Uint8Array.from([...fp, 0x05]));
  assert.equal(await revealSecret(work, one), 'u');
});

test('B-4 codec: equalBytes compares every byte (no early exit) and is still exact', () => {
  const a = Uint8Array.from([1, 2, 3, 4]);
  assert.equal(equalBytes(a, Uint8Array.from([1, 2, 3, 4])), true);
  assert.equal(equalBytes(a, Uint8Array.from([1, 2, 3, 5])), false);
  assert.equal(equalBytes(a, Uint8Array.from([0, 2, 3, 4])), false);
  assert.equal(equalBytes(a, Uint8Array.from([1, 2, 3])), false);
  assert.equal(equalBytes(new Uint8Array(0), new Uint8Array(0)), true);
  assert.equal(equalBytes(Uint8Array.from([0]), Uint8Array.from([0])), true);
});

test('B-2 markdown and yaml: a line is matched in linear time (seven regexes were quadratic in a run of spaces)', () => {
  const n = 150000, sp = ' '.repeat(n);
  for (const [name, lines] of [
    ['fence a*n`', ['```' + 'a'.repeat(n) + '`']], ['fence spaces`', ['```' + sp + '`']], ['paragraph trailing', ['a' + sp + 'x']],
    ['atx', ['# a' + sp + 'x']], ['table separator', ['a|b', '|-' + sp + 'x']], ['thematic break', ['---' + sp + 'x']], ['setext', ['p', '='.repeat(1000) + sp + 'x']],
  ]) assert.ok(ms(() => parseBlocks(lines)) < 1500, name);
  assert.ok(ms(() => readMarkdown(new TextEncoder().encode('x\n\n```' + 'a'.repeat(n) + '`\n'))) < 1500);
  assert.ok(ms(() => parseYaml('k: a' + sp + 'b')) < 1500, 'yaml plain scalar');
  assert.ok(ms(() => parseYaml('k: [a]' + sp + 'x')) < 1500, 'yaml after a flow collection');
  // the results are those of the old regexes: fixed cases, then random short lines against the old regexes themselves
  assert.deepEqual(parseBlocks(['```js title', 'x', '```']), [{ t: 'code', lang: 'js', x: 'x' }]);
  assert.deepEqual(parseBlocks(['~~~', 'y', '~~~']), [{ t: 'code', x: 'y' }]);
  assert.deepEqual(parseBlocks(['   ````  ruby  ', 'z', '````']), [{ t: 'code', lang: 'ruby', x: 'z' }]);
  assert.deepEqual(parseBlocks(['``` a`b', 'q']), [{ t: 'p', x: '``` a`b\nq' }], 'a backtick in the info string is not a fence');
  assert.deepEqual(parseBlocks(['# a #', '## b ## c ##', '#', '# #', '#x', '####### y', '  ### z  ###  ']), [{ t: 'h', l: 1, x: 'a' }, { t: 'h', l: 2, x: 'b ## c' }, { t: 'h', l: 1, x: '' }, { t: 'h', l: 1, x: '#' }, { t: 'p', x: '#x\n####### y' }, { t: 'h', l: 3, x: 'z' }]);
  assert.deepEqual(parseBlocks(['* * *', ' - -  - ', '__', '---x', '    ---']).map((b) => b.t), ['hr', 'hr', 'p']);
  assert.deepEqual(parseBlocks(['# a\u2028b', '# c\nd']).map((b) => b.t), ['p'], 'a line terminator inside a line is not a heading (as before)');
  assert.deepEqual(parseBlocks(['a|b', '|---|:-:|', 'c|d']), [{ t: 'table', align: [null, 'c'], head: ['a', 'b'], rows: [['c', 'd']] }]);
  assert.deepEqual(parseBlocks(['t', '==', 'u', '-- ', 'v']).map((b) => [b.t, b.l]), [['h', 1], ['h', 2], ['p', undefined]]);
  assert.deepEqual(parseYaml('a: x  # c\nb: "x # c"\nc: [1, 2]   # d\nd: x#y'), new Map([['a', 'x'], ['b', 'x # c'], ['c', [1, 2]], ['d', 'x#y']]));
  const OLD = {
    fence: /^( {0,3})(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/, atx: /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/, hr: /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/,
    sep: /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/, setext: /^ {0,3}(=+|-+)[ \t]*$/,
  };
  const lines = randomLines('b2', '# -=*_|:`~ \t\tax', 6000, 14);
  let checked = 0;
  for (const l of lines) {
    // each old regex against the block the new code makes of that line (alone, or as a table separator under "a|b")
    const b = parseBlocks([l])[0];
    const f = OLD.fence.exec(l);
    if (f) assert.deepEqual(b, { t: 'code', ...(f[3] ? { lang: f[3] } : {}), x: '' }, JSON.stringify(l));
    else if (OLD.atx.test(l)) { const m = OLD.atx.exec(l); assert.deepEqual(b, { t: 'h', l: m[1].length, x: (m[2] || '').trim() }, JSON.stringify(l)); }
    else if (OLD.hr.test(l)) assert.deepEqual(b, { t: 'hr' }, JSON.stringify(l));
    const t = parseBlocks(['a|b', l])[0];
    assert.equal(t.t === 'table', OLD.sep.test(l) && splitRow(l).length === 2, JSON.stringify(l));
    const s = parseBlocks(['p', l])[0];
    assert.equal(s.t === 'h' && s.l !== undefined && s.x === 'p', OLD.setext.test(l), JSON.stringify(l));
    const para = parseBlocks(['a' + l.replace(/[`#|~]/g, 'b')])[0];
    if (para?.t === 'p') assert.equal(para.x, ('a' + l.replace(/[`#|~]/g, 'b')).replace(/^[ \t]+/, '').replace(/[ \t]+$/, ''), JSON.stringify(l));
    checked++;
  }
  assert.equal(checked, lines.length);
  for (const v of randomLines('b2y', 'a #\t"x', 3000, 12)) {
    const oldPlain = v.trim().replace(/\s+#.*$/, ''), oldFlow = v.replace(/\s*#.*$/, '');
    let got; try { got = parseYaml('k: ' + v); } catch { continue; }
    const want = oldPlain === '' ? null : /^[ "#]/.test(oldPlain) ? undefined : oldPlain; // a quoted value or a comment: not a plain scalar
    if (want !== undefined) assert.equal(got.get('k'), want, JSON.stringify(v));
    let flowErr = false; try { parseYaml('k: []' + v); } catch { flowErr = true; }
    assert.equal(flowErr, oldFlow.trim() !== '', JSON.stringify(v));
  }
});

test('B-3 work text: markup with many "<" and no ">" is read in linear time (the old regexes were quadratic)', () => {
  const n = 200000;
  assert.ok(ms(() => markupText('<text>' + 'a<'.repeat(n), 'svg')) < 1500, 'svg: "<" never closed');
  assert.ok(ms(() => markupText('<script>'.repeat(n / 4), 'html')) < 1500, 'html: openers never closed');
  assert.ok(ms(() => markupText('<style>'.repeat(n / 4), 'html')) < 1500);
  // the results of the old regexes are kept: fixed cases, then random strings against the old regexes themselves
  assert.equal(markupText('<p>a<b</p>', 'html'), 'a');
  assert.equal(markupText('<a<b>c', 'html'), 'c');
  assert.equal(markupText('x<SCRIPT type="x">1</script>y<style>s</STYLE>z<title>t</title><head><meta></head>w', 'html'), 'xyzw');
  assert.equal(markupText('<script>never closed', 'html'), 'never closed');
  assert.equal(markupText('<scripts>k</scripts><script>x</script>y', 'html'), 'ky');
  assert.equal(markupText('<>a<>', 'html'), '<>a<>');
  assert.equal(markupText('a &lt;b&gt; &amp; &#65;&#x42; &quot;', 'html'), 'a <b> & AB "');
  assert.equal(markupText('<svg><style>s</style><text>a<tspan>b</tspan>c</text><desc>d</desc></svg>', 'svg'), 'abc');
  const old = (raw, kind) => {
    const end = raw.lastIndexOf('</text>');
    const body = kind === 'svg' ? raw.slice(Math.max(0, raw.indexOf('<text')), end < 0 ? raw.length : end) : raw.replace(/<(script|style|title|head)\b[\s\S]*?<\/\1>/gi, '');
    return body.replace(/<[^>]+>/g, '');
  };
  const atoms = ['<', '>', 'a', ' ', '<script>', '</script>', '<SCRIPT >', '</Script>', '<style>', '</style>', '<title>', '</title>', '<head>', '</head>', '<scripts>', '<p>', '</p>', '<text>', '</text>', '<tspan>', '<>'];
  const rnd = seededRandom('b3'), b = new Uint8Array(13);
  for (let i = 0; i < 8000; i++) {
    rnd(b);
    let s = '';
    for (let j = 0; j < 1 + (b[0] % 12); j++) s += atoms[b[1 + j] % atoms.length];
    for (const k of ['html', 'svg']) assert.equal(markupText(s, k), old(s, k), `${k} ${JSON.stringify(s)}`);
  }
});
