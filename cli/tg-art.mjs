#!/usr/bin/env node
// tg-art: render a Typographics Art work from the command line (needs Node 22+ and Chrome/Chromium; PDF also MuPDF).
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';
import { openSession, MIME } from './core.mjs';

const HELP = `Usage: tg-art <image> (--text <file> | --string <text>) -o <out.svg|.html|.pdf|.png|.jpg> [options]

  --legibility <high|medium|free>           how far glyphs may drift from plain text (default medium)
  --color <photo|gray|mono>                 colour mode (default photo)
  --paper <light|dark|auto>                 paper (default light; auto: dark for a dark picture)
  --unit <char|word>                        one style per letter or per word (default char)
  --width <px>                              text block width (default 960)
  --aspect <h/w>                            crop to this aspect ratio, e.g. 1.25 (default: the image's)
  --contrast <n>  --brightness <n>  --edges <n>  --spacing <n>
  --no-stretch  --no-shape  --invert  --auto-levels (stretch the picture's tones over the whole range)
  --fill <n>                                append declared Lorem ipsum up to n characters
  --scale <n>                               pixel scale for PNG/JPEG (default 1)
  --print-width <mm>                        PDF at physical size, e.g. 2000 for a 2 m wide poster: always ONE page,
                                            ready for the print shop (height follows the image, max 5080 mm)

Fonts are loaded from Google Fonts, so an internet connection is needed.
`;

let values, positionals;
try {
  ({ values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    text: { type: 'string' }, string: { type: 'string' }, out: { type: 'string', short: 'o' },
    legibility: { type: 'string' }, color: { type: 'string' }, paper: { type: 'string' },
    unit: { type: 'string' }, width: { type: 'string' }, aspect: { type: 'string' }, contrast: { type: 'string' },
    brightness: { type: 'string' }, edges: { type: 'string' }, spacing: { type: 'string' }, fill: { type: 'string' },
    scale: { type: 'string' }, 'print-width': { type: 'string' }, 'no-stretch': { type: 'boolean' }, 'no-shape': { type: 'boolean' },
    invert: { type: 'boolean' }, 'auto-levels': { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  },
}));
} catch (e) { console.error(`${e.message.split('\n')[0]} (see --help)`); process.exit(1); }

if (values.help || positionals.length !== 1 || !values.out || (values.text === undefined && values.string === undefined)) {
  process.stdout.write(HELP);
  process.exit(values.help ? 0 : 1);
}

const format = extname(values.out).slice(1).toLowerCase().replace('jpeg', 'jpg');
if (!['svg', 'html', 'pdf', 'png', 'jpg'].includes(format)) {
  console.error(`Unsupported output format ".${format}". Use .svg, .html, .pdf, .png or .jpg.`);
  process.exit(1);
}
const imagePath = positionals[0];
const mime = MIME[extname(imagePath).toLowerCase()];
if (!mime) { console.error(`Unsupported image type: ${imagePath}`); process.exit(1); }

// A number option must be a number: --width abc used to produce an SVG of width NaN and exit 0.
const num = (name) => {
  const v = values[name];
  if (v == null) return undefined;
  const n = Number(v);
  const anySign = name === 'brightness', nonNegative = name === 'edges';
  if (!Number.isFinite(n) || (!anySign && (nonNegative ? n < 0 : n <= 0))) {
    console.error(`--${name} needs ${anySign ? 'a number' : nonNegative ? 'a number from 0' : 'a number above 0'}, got "${v}".`);
    process.exit(1);
  }
  return n;
};
const options = Object.fromEntries(Object.entries({
  legibility: values.legibility, color: values.color, paper: values.paper, unit: values.unit,
  width: num('width'), aspect: num('aspect'), contrast: num('contrast'), brightness: num('brightness'),
  edges: num('edges'), lineSpacing: num('spacing'), fill: num('fill'), scale: num('scale'),
  printWidthMm: num('print-width'),
  stretch: values['no-stretch'] ? false : undefined, shape: values['no-shape'] ? false : undefined, invert: values.invert || undefined,
  autoLevels: values['auto-levels'] || undefined,
}).filter(([, v]) => v !== undefined));

const text = values.string ?? readFileSync(values.text, 'utf8');
if (!text.trim()) { console.error('The text is empty: there is nothing to set.'); process.exit(1); }
const image = `data:${mime};base64,${readFileSync(imagePath).toString('base64')}`;

const session = await openSession();
try {
  const { meta, data } = await session.render(text, image, options, format);
  writeFileSync(values.out, data);
  const filler = meta.filler ? `, of which ${meta.filler} filler` : '';
  const page = meta.pageMm ? `, 1 page ${meta.pageMm[0].toFixed(0)} × ${meta.pageMm[1].toFixed(0)} mm` : '';
  console.log(`${values.out}: ${meta.characters} characters${filler}, ${meta.lines} lines, ${meta.width}×${meta.height} px${page}, ` +
    `tone fidelity ${meta.toneFidelity.toFixed(2)}, dynamic range ${meta.dynamicRange.toFixed(2)}, text ${meta.faithful ? 'preserved 1:1' : 'NOT preserved'}`);
  if (!meta.faithful) process.exitCode = 2;
} finally {
  await session.close();
}
