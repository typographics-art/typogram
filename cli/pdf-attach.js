// MuPDF script: gives a one-pager PDF its DATA LAYER — the exact source and the JSON-LD record as PDF attached files, and
// the document's Title/Author/Subject/Keywords. The text layer (what a machine reads from the page) is untouched.
//
//   mutool run cli/pdf-attach.js in.pdf out.pdf srcPath srcName srcMime metaPath title author subject keywords
//
// srcPath/srcName/srcMime: the exact source (source.md, text/markdown). metaPath: the JSON-LD record (metadata.json,
// application/json). title/author/subject/keywords: /Info fields; an empty string is skipped. Keywords carries the identity
// hash ("sha256=…") so the binding between the picture and the source is discoverable without opening an attachment.
var a = scriptArgs;
if (a.length < 6) throw new Error('usage: mutool run pdf-attach.js in out srcPath srcName srcMime metaPath [title author subject keywords]');
var doc = new PDFDocument(a[0]);

var info = [['info:Title', a[6]], ['info:Author', a[7]], ['info:Subject', a[8]], ['info:Keywords', a[9]]];
for (var k = 0; k < info.length; k++) if (info[k][1]) doc.setMetaData(info[k][0], info[k][1]);

// Pre-create an empty EmbeddedFiles name tree so insertEmbeddedFile (which walks it) does not hit a null on a fresh PDF.
function ensure(dict, key, kind) {
  var v = dict.get(key);
  if (!v || !(kind === 'arr' ? v.isArray() : v.isDictionary())) { v = kind === 'arr' ? doc.newArray() : doc.newDictionary(); dict.put(key, v); }
  return v;
}
var root = doc.getTrailer().get('Root');
ensure(ensure(ensure(root, 'Names', 'dict'), 'EmbeddedFiles', 'dict'), 'Names', 'arr');

function attach(path, name, mime) {
  var buf = new Buffer();
  buf.writeBuffer(readFile(path));
  var now = new Date();
  var fs = doc.addEmbeddedFile(name, mime, buf, now, now, false);
  doc.insertEmbeddedFile(name, fs); // proper string key, sorted into the name tree
}
attach(a[2], a[3], a[4]);          // the exact source (source.md / source.txt)
if (a[5]) attach(a[5], 'metadata.json', 'application/json'); // the JSON-LD record

doc.save(a[1], 'compress,garbage');
print('attached ' + (a[5] ? 2 : 1) + ' file(s) and set document info');
