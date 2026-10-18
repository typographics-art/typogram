import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inkFor } from '../src/index.js';
import { motifSource } from '../cli/onepage-core.mjs';

test('inkFor: colours are rounded to the given step and stay within 0..255', () => {
  for (const step of [6, 24]) {
    for (const target of [[200, 40, 30], [10, 120, 250], [250, 250, 0]]) {
      const ink = inkFor(target, 0.4, [255, 255, 255], 0.9, false, step);
      for (const v of ink) {
        assert.ok(v >= 0 && v <= 255, `${v} out of range`);
        assert.ok(v % step === 0 || v === 255, `${v} is not a multiple of ${step}`);
      }
    }
  }
});

test('motifSource: images become data URLs, recipes pass through, other files are refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tg-motif-'));
  const jpg = join(dir, 'a.JPG');
  writeFileSync(jpg, Buffer.from([0xff, 0xd8, 0xff]));
  assert.equal(motifSource(jpg), 'data:image/jpeg;base64,/9j/');
  assert.equal(motifSource('recipe:globe'), 'recipe:globe');
  assert.throws(() => motifSource(join(dir, 'a.gif')), /JPEG, PNG or WebP/);
});
