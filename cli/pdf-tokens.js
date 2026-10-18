// MuPDF script: prints the largest number of tokens in any content stream of a PDF (page contents and
// Form XObjects).
//
//   mutool run cli/pdf-tokens.js file.pdf
//
// pypdf (used by many AI document loaders) stops reading a content stream after 2 000 000 tokens and
// silently drops the rest of its text (measured: the EU AI Act one-pager lost 44 % of its text there).
// cli/core.mjs splits print strips until every stream stays below that.
var doc = new PDFDocument(scriptArgs[0]);
var max = 0;
function count(stream) {
  var n = stream.readStream().asString().split(/\s+/).length;
  if (n > max) max = n;
}
for (var i = 1; i < doc.countObjects(); i++) {
  var obj = doc.newIndirect(i, 0);
  if (obj.isStream() && String(obj.get('Subtype')) === '/Form') count(obj);
}
for (var p = 0; p < doc.countPages(); p++) {
  var contents = doc.findPage(p).get('Contents');
  if (contents.isArray()) for (var j = 0; j < contents.length; j++) count(contents.get(j));
  else if (contents.isStream()) count(contents);
}
print(max);
