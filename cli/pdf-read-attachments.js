// MuPDF script: writes every attached file of a PDF to <outDir>/<name>, and prints each name. Used by cli/tg.mjs to read a
// Typogram PDF's data layer (source.md / source.txt and metadata.json) back out.
//   mutool run cli/pdf-read-attachments.js <in.pdf> <outDir>
var doc = new PDFDocument(scriptArgs[0]), outDir = scriptArgs[1];
var files = doc.getEmbeddedFiles();
for (var name in files) {
  var buf = doc.getEmbeddedFileContents(files[name]);
  if (buf) { buf.save(outDir + '/' + name.replace(/[\/\\]/g, '_')); print(name); }
}
