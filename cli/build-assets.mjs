#!/usr/bin/env node
// Renders assets/logo.png and assets/social.png (GitHub social preview, Open Graph image) from assets/brand.html.
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSession } from './core.mjs';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const session = await openSession();
try {
  writeFileSync(join(DIR, 'logo.png'), await session.screenshot('assets/brand.html?view=logo', 1200, 300));
  writeFileSync(join(DIR, 'social.png'), await session.screenshot('assets/brand.html?view=social', 1280, 640));
  console.log('assets/logo.png, assets/social.png written');
} finally {
  await session.close();
}
