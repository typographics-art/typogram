import { test } from 'node:test';
import assert from 'node:assert/strict';
import { absolutize } from '../scripts/absolute-links.mjs';

const SITE = 'https://typographics-art.org/', REPO = 'https://github.com/typographics-art/typogram/';

test('absolutize: files the site publishes link to the site, everything else to GitHub', () => {
  const out = absolutize('[a](docs/technique.md) [b](examples/ch-bundesverfassung/onepage.pdf) [c](gallery/douglass.svg) [d](CONTRIBUTING.md) [e](src/layout.js) [f](examples/)', 'README.md');
  assert.equal(out, `[a](${SITE}docs/technique.md) [b](${SITE}examples/ch-bundesverfassung/onepage.pdf) [c](${SITE}gallery/douglass.svg) [d](${REPO}blob/main/CONTRIBUTING.md) [e](${REPO}blob/main/src/layout.js) [f](${REPO}tree/main/examples)`);
});

test('absolutize: links are resolved against the file they came from, anchors and titles are kept', () => {
  assert.equal(absolutize('[x](technique.md#rules "Rules") [y](../README.md)', 'docs/algorithm.md'), `[x](${SITE}docs/technique.md#rules "Rules") [y](${REPO}blob/main/README.md)`);
  assert.equal(absolutize('[p](ch-bundesverfassung/onepage.pdf) [m](motifs/x.jpg)', 'examples/README.md'), `[p](${SITE}examples/ch-bundesverfassung/onepage.pdf) [m](${SITE}examples/motifs/x.jpg)`);
});

test('absolutize: absolute links, mail links, same-part anchors and images stay as they are', () => {
  const md = '[w](https://example.org/a) [m](mailto:d0n@typographics-art.org) [a](#top) ![i](img/x.png)';
  assert.equal(absolutize(md, 'README.md'), md);
});

test('absolutize: a link that would leave the repository is not touched', () => {
  assert.equal(absolutize('[x](../../etc/passwd)', 'docs/a.md'), '[x](../../etc/passwd)');
});
