// Security regression for the HTML DATA view (src/md-html.js): hostile source must not inject script, event handlers or a
// dangerous URL scheme into the rendered <article>. Covers the two findings fixed on 2026-10-18 — a URL-scheme filter bypass
// via leading C0/whitespace (browsers strip those before resolving the scheme), and emphasis/code passes rewriting already-
// generated link/image markup (links, images and code spans are now parked as opaque tokens before escaping).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdownToHtml } from '../src/md-html.js';

test('md-html security: dangerous link schemes are neutralised, including a control-char bypass', () => {
  assert.match(markdownToHtml('[x](javascript:alert(1))'), /<a href="#">x<\/a>/);
  assert.match(markdownToHtml('[x](\u0001javascript:alert(1))'), /<a href="#">x<\/a>/, 'a leading C0 control does not smuggle javascript:');
  assert.match(markdownToHtml('[x](\u0001\u0001vbscript:msgbox)'), /<a href="#">x<\/a>/);
  assert.match(markdownToHtml('[x](data:text/html,xx)'), /<a href="#">x<\/a>/);
  assert.ok(!/href="javascript:|href="vbscript:|href="data:text/i.test(
    markdownToHtml('[a](javascript:1) [b](\u0001javascript:1) [c](vbscript:1) [d](data:text/html,x)')), 'no dangerous href scheme survives');
});

test('md-html security: safe and relative URLs pass through; data: images are kept', () => {
  assert.match(markdownToHtml('[x](https://good.example/a)'), /<a href="https:\/\/good\.example\/a">x<\/a>/);
  assert.match(markdownToHtml('[x](/local/path)'), /<a href="\/local\/path">x<\/a>/);
  assert.match(markdownToHtml('[x](mailto:a@b.c)'), /<a href="mailto:a@b\.c">x<\/a>/);
  assert.match(markdownToHtml('![a](data:image/png;base64,AAA)'), /<img src="data:image\/png;base64,AAA" alt="a">/);
});

test('md-html security: an image alt cannot break out into an event handler (the quote is escaped)', () => {
  const h = markdownToHtml('![" onerror=alert(1) x](http://a)');
  assert.ok(h.includes('<img src="http://a" alt="&quot; onerror=alert(1) x">'), 'the quote in alt is &quot;, so no attribute breaks out');
  assert.ok(!/<img[^>]*"\s+onerror=/i.test(h), 'no live event-handler attribute');
});

test('md-html security: emphasis cannot rewrite generated link/image markup', () => {
  // the asterisks surround a link; the link markup is parked before the emphasis pass, so it is never rewritten
  const h = markdownToHtml('*[x](https://a)*');
  assert.match(h, /<em><a href="https:\/\/a">x<\/a><\/em>/);
});

test('md-html security: a code span stays inside <code>, fully escaped', () => {
  assert.match(markdownToHtml('`<script>x</script>`'), /<code>&lt;script&gt;x&lt;\/script&gt;<\/code>/);
});
