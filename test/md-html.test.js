// The data-layer Markdown rendered to the HTML DATA view (src/md-html.js): real block structure, safe inline markup, and no
// way for hostile source to inject script or a dangerous URL (the article is CSP-safe).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdownToHtml } from '../src/md-html.js';

test('md-html: block structure becomes real HTML', () => {
  const h = markdownToHtml('# H1\n\n## H2\n\npara\n\n---\n\n> quote\n\n```js\ncode();\n```\n\n- a\n- b\n\n1. one\n2. two\n');
  assert.match(h, /<h1>H1<\/h1>/);
  assert.match(h, /<h2>H2<\/h2>/);
  assert.match(h, /<p>para<\/p>/);
  assert.match(h, /<hr>/);
  assert.match(h, /<blockquote><p>quote<\/p><\/blockquote>/);
  assert.match(h, /<pre><code class="language-js">code\(\);<\/code><\/pre>/);
  assert.match(h, /<ul><li>a<\/li><li>b<\/li><\/ul>/);
  assert.match(h, /<ol><li>one<\/li><li>two<\/li><\/ol>/);
});

test('md-html: tables keep per-column alignment', () => {
  const h = markdownToHtml('| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |\n');
  assert.match(h, /<table><thead><tr><th style="text-align:left">a<\/th><th style="text-align:center">b<\/th><th style="text-align:right">c<\/th><\/tr><\/thead>/);
  assert.match(h, /<tbody><tr><td style="text-align:left">1<\/td>/);
});

test('md-html: inline emphasis, code and safe links render', () => {
  const h = markdownToHtml('a **bold** and *italic* and `code` and a [link](https://example.com).');
  assert.match(h, /<strong>bold<\/strong>/);
  assert.match(h, /<em>italic<\/em>/);
  assert.match(h, /<code>code<\/code>/);
  assert.match(h, /<a href="https:\/\/example\.com">link<\/a>/);
});

test('md-html: hostile source cannot inject — raw HTML is escaped, dangerous URLs are neutralised', () => {
  const h = markdownToHtml('<script>alert(1)</script>\n\n<img src=x onerror=alert(2)>\n\na [evil](javascript:alert(3)) and [data](data:text/html,x).');
  assert.ok(!/<script/i.test(h), 'no live <script>');
  assert.ok(!/<img[^>]*onerror/i.test(h), 'no live <img> with an event handler (the raw tag is escaped to text)');
  assert.ok(!/href="javascript:/i.test(h) && !/href="data:/i.test(h), 'no dangerous link scheme');
  assert.match(h, /href="#"/, 'the dangerous link became inert');
  assert.match(h, /&lt;script&gt;/, 'raw HTML shown as text');
});

test('md-html: safe inline image keeps http(s) and data: sources, drops others', () => {
  assert.match(markdownToHtml('![a](https://x/y.png)'), /<img src="https:\/\/x\/y\.png" alt="a">/);
  assert.match(markdownToHtml('![a](data:image/png;base64,AAAA)'), /<img src="data:image\/png;base64,AAAA" alt="a">/);
  assert.equal(/<img/.test(markdownToHtml('![a](javascript:alert(1))')), false, 'a javascript: image is dropped to its alt text');
});

test('md-html: empty source is empty, broken input never throws', () => {
  assert.equal(markdownToHtml(''), '');
  assert.equal(typeof markdownToHtml('# ok'), 'string');
});
