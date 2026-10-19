// MuPDF script: apply a signed data layer to a Typogram PDF. It replaces the metadata.json attachment with the signed
// record and (unless the seal argument is empty) draws the visible green "signed" corner on page 1. The source
// attachment, the /Info fields and the text layer are untouched, so the identity hash is unchanged and `tg verify`
// reads the same text — now VERIFIED. The seal is a content-stream overlay (a shape, not text), bracketed so it does not
// disturb the page content; the caller (cli/tg.mjs sealContentStream) builds it from the page size via sealGeometry.
//
//   mutool run cli/pdf-sign-apply.js in.pdf out.pdf metadata.json "<seal content stream, or empty>"
var a = scriptArgs;
if (a.length < 4) throw new Error('usage: mutool run pdf-sign-apply.js in out metadata.json "<seal or empty>"');
var doc = new PDFDocument(a[0]);

// 1) Replace the metadata.json attachment with the signed record.
try { doc.deleteEmbeddedFile('metadata.json'); } catch (e) { /* none yet — fine */ }
// The EmbeddedFiles name tree must exist for insertEmbeddedFile to walk it (a PDF stripped of all attachments has none).
function ensure(dict, key, kind) {
  var v = dict.get(key);
  if (!v || !(kind === 'arr' ? v.isArray() : v.isDictionary())) { v = kind === 'arr' ? doc.newArray() : doc.newDictionary(); dict.put(key, v); }
  return v;
}
var root = doc.getTrailer().get('Root');
ensure(ensure(ensure(root, 'Names', 'dict'), 'EmbeddedFiles', 'dict'), 'Names', 'arr');
var mbuf = new Buffer();
mbuf.writeBuffer(readFile(a[2]));
var now = new Date();
var fs = doc.addEmbeddedFile('metadata.json', 'application/json', mbuf, now, now, false);
doc.insertEmbeddedFile('metadata.json', fs);

// 2) Draw the seal on page 1, bracketing the original content in q … Q so the overlay starts from the default graphics
//    state whatever the page left behind (the classic watermark trick). a[3] is itself a balanced "q … Q".
if (a[3]) {
  var page = doc.loadPage(0).getObject();
  var contents = page.get('Contents');
  var arr = doc.newArray();
  arr.push(doc.addStream('q\n', null));
  if (contents.isArray()) { for (var i = 0; i < contents.length; i++) arr.push(contents.get(i)); }
  else { arr.push(contents); }
  arr.push(doc.addStream('Q\n' + a[3] + '\n', null));
  page.put('Contents', arr);
}

doc.save(a[1], 'compress,garbage');
print('signed PDF data layer applied' + (a[3] ? ' + sealed page 1' : ''));
