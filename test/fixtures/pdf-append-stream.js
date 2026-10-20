// MuPDF script for test/pdf-lint.test.js: append a content stream to page 1 of a PDF (the attack the lint must catch).
//   mutool run pdf-append-stream.js in.pdf out.pdf "<content stream>"
var a = scriptArgs; var doc = new PDFDocument(a[0]);
var page = doc.loadPage(0).getObject(); var contents = page.get('Contents'); var arr = doc.newArray();
arr.push(doc.addStream('q\n', null));
if (contents.isArray()) { for (var i = 0; i < contents.length; i++) arr.push(contents.get(i)); } else arr.push(contents);
arr.push(doc.addStream('Q\n' + a[2] + '\n', null)); page.put('Contents', arr); doc.save(a[1], 'compress,garbage');
