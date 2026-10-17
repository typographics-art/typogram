#!/usr/bin/env node
// tg-art: render a Typographics Art work from the command line (needs Node 22+ and Chrome/Chromium; PDF also MuPDF).
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';
import { openSession, MIME } from './core.mjs';

const HELP = `Usage: tg-art <image> (--text <file> | --string <text>) -o <out.svg|.html|.pdf|.png|.jpg> [options]

  --font <roboto|fraunces|recursive|archivo|notoserif|mono>  typeface (default roboto)
  --legibility <high|medium|free>           how far glyphs may drift from plain text (default medium)
  --color <photo|gray|mono>                 colour mode (default photo)
  --paper <light|dark>                      paper (default light)
  --unit <char|word>                        one style per letter or per word (default char)
  --width <px>                              text block width (default 960)
  --aspect <h/w>                            crop to this aspect ratio, e.g. 1.25 (default: the image's)
  --contrast <n>  --brightness <n>  --edges <n>  --spacing <n>
  --no-stretch  --no-shape  --invert
  --fill <n>                                append declared Lorem ipsum up to n characters
  --scale <n>                               pixel scale for PNG/JPEG (default 1)
  --print-width <mm>                        PDF at physical size, e.g. 2000 for a 2 m wide poster: always ONE page,
                                            ready for the print shop (height follows the image, max 5080 mm)

Fonts are loaded from Google Fonts, so an internet connection is needed.
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    text: { type: 'string' }, string: { type: 'string' }, out: { type: 'string', short: 'o' },
    font: { type: 'string' }, legibility: { type: 'string' }, color: { type: 'string' }, paper: { type: 'string' },
    unit: { type: 'string' }, width: { type: 'string' }, aspect: { type: 'string' }, contrast: { type: 'string' },
    brightness: { type: 'string' }, edges: { type: 'string' }, spacing: { type: 'string' }, fill: { type: 'string' },
    scale: { type: 'string' }, 'print-width': { type: 'string' }, 'no-stretch': { type: 'boolean' }, 'no-shape': { type: 'boolean' },
    invert: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  },
});

if (values.help || positionals.length !== 1 || !values.out || !(values.text || values.string)) {
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

const num = (v) => (v == null ? undefined : Number(v));
const options = Object.fromEntries(Object.entries({
  font: values.font, legibility: values.legibility, color: values.color, paper: values.paper, unit: values.unit,
  width: num(values.width), aspect: num(values.aspect), contrast: num(values.contrast), brightness: num(values.brightness),
  edges: num(values.edges), lineSpacing: num(values.spacing), fill: num(values.fill), scale: num(values.scale),
  printWidthMm: num(values['print-width']),
  stretch: values['no-stretch'] ? false : undefined, shape: values['no-shape'] ? false : undefined, invert: values.invert || undefined,
}).filter(([, v]) => v !== undefined));

const text = values.string ?? readFileSync(values.text, 'utf8');
const image = `data:${mime};base64,${readFileSync(imagePath).toString('base64')}`;

const session = await openSession();
try {
  const { meta, data } = await session.render(text, image, options, format);
  writeFileSync(values.out, data);
  const filler = meta.filler ? `, of which ${meta.filler} filler` : '';
  const page = meta.pageMm ? `, 1 page ${meta.pageMm[0].toFixed(0)} × ${meta.pageMm[1].toFixed(0)} mm` : '';
  console.log(`${values.out}: ${meta.characters} characters${filler}, ${meta.lines} lines, ${meta.width}×${meta.height} px${page}, ` +
    `tone fidelity ${meta.toneFidelity.toFixed(2)}, text ${meta.faithful ? 'preserved 1:1' : 'NOT preserved'}`);
  if (!meta.faithful) process.exitCode = 2;
} finally {
  await session.close();
}
