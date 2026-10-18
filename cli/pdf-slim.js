// MuPDF script: rounds the coordinates in Chrome's Type 3 glyph outlines to whole units.
//
//   mutool run cli/pdf-slim.js in.pdf out.pdf
//
// Chrome embeds every variable-font instance as Type 3 glyphs whose outlines are written with up to six
// decimals in a 1000-unit glyph grid. Whole units move a point by at most 1/2000 of the type size
// (0.0005 mm at 1 mm type). Measured on the Swiss constitution one-pager: 22 % smaller, text identical,
// no pixel at 600 dpi changed by more than 32 of 255 levels. Glyph widths and positions (the font's
// /Widths and the page's text operators) are not touched.
var args = scriptArgs;
if (args.length !== 2) throw new Error('usage: mutool run pdf-slim.js in.pdf out.pdf');
var doc = new PDFDocument(args[0]);
var procs = 0;
for (var i = 1; i < doc.countObjects(); i++) {
  var obj = doc.newIndirect(i, 0);
  if (!obj.isDictionary() || String(obj.get('Subtype')) !== '/Type3') continue;
  var charProcs = obj.get('CharProcs');
  if (!charProcs.isDictionary()) continue;
  charProcs.forEach(function (proc) {
    var text = proc.readStream().asString();
    proc.writeStream(text.replace(/-?\d*\.\d+/g, function (n) { return String(Math.round(Number(n))); }));
    procs++;
  });
}
doc.save(args[1], 'compress,garbage');
print('rounded ' + procs + ' glyph outlines');
