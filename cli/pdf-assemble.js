// MuPDF script: assembles PDF strips into ONE page without re-rendering anything.
//
//   mutool run cli/pdf-assemble.js out.pdf <widthPt> <heightPt> strip1.pdf <topPt> <contentPt> strip2.pdf …
//
// Each strip's first page becomes a Form XObject placed at its offset from the top of the sheet.
// Vector graphics, fonts and the text layer are kept as they are, in strip order (= reading order).
// Chrome prints a few hundred thousand glyphs per page quickly but stalls on a million; strips
// plus this script give print shops a single sheet regardless of size.
var args = scriptArgs;
if (args.length < 6) throw new Error('usage: mutool run pdf-assemble.js out.pdf widthPt heightPt strip.pdf topPt contentPt …');
// Each strip page is printed a little taller than its content; only the top contentPt of it is used,
// so the page height Chrome rounds to does not matter.
var out = args[0], W = Number(args[1]), H = Number(args[2]);
var dst = new PDFDocument();
var xobjects = dst.newDictionary();
var content = '';

for (var i = 3, k = 0; i < args.length; i += 3, k++) {
  var src = new PDFDocument(args[i]);
  var page = src.findPage(0);
  var box = page.get('MediaBox');
  var x0 = box.get(0).valueOf(), x1 = box.get(2).valueOf(), y1 = box.get(3).valueOf();
  var top = Number(args[i + 1]), used = Number(args[i + 2]);
  var y0 = y1 - used; // keep only the top `used` points of the strip page
  var contents = page.get('Contents');
  var data = new Buffer();
  if (contents.isArray()) { for (var j = 0; j < contents.length; j++) { data.writeBuffer(contents.get(j).readStream()); data.writeByte(10); } }
  else data.writeBuffer(contents.readStream());
  var form = dst.newDictionary();
  form.put('Type', dst.newName('XObject'));
  form.put('Subtype', dst.newName('Form'));
  form.put('BBox', dst.newArray());
  form.get('BBox').push(x0); form.get('BBox').push(y0); form.get('BBox').push(x1); form.get('BBox').push(y1);
  form.put('Resources', dst.graftObject(page.get('Resources')));
  var name = 'S' + k;
  xobjects.put(name, dst.addStream(data, form));
  // PDF coordinates start at the bottom left: put the strip's top edge (y1) at H - top.
  content += 'q 1 0 0 1 ' + (-x0).toFixed(4) + ' ' + (H - top - y1).toFixed(4) + ' cm /' + name + ' Do Q\n';
}

var resources = dst.newDictionary();
resources.put('XObject', xobjects);
dst.insertPage(-1, dst.addPage([0, 0, W, H], 0, resources, content));
dst.save(out, 'compress,garbage');
print('assembled ' + k + ' strips into 1 page of ' + W.toFixed(1) + ' x ' + H.toFixed(1) + ' pt');
