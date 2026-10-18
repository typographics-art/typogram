// A module worker that turns a data file into a TGD block, so that reading a large Excel file does not freeze the page
// (src/data-panel-ui.js starts it; if workers are not available the page does the same work itself).
import { encode } from './structured.js';

self.onmessage = async (e) => {
  const { bytes, name, format, opts } = e.data;
  try {
    const r = await encode({ bytes, name, format }, opts);
    self.postMessage({ ok: true, result: { text: r.text, format: r.format, model: r.model, lossy: r.lossy, warnings: r.warnings, stats: r.stats } });
  } catch (err) {
    self.postMessage({ ok: false, error: { code: err?.code, message: String(err?.message || err) } });
  }
};
