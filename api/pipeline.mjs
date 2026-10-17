// One paid job: document text → image prompt (our LLM) → picture (our image model) → one-pager with that
// picture as its motif. Everything runs on the operator's own models.
import { openSession } from '../cli/core.mjs';
import { readDocument, makeOnePage } from '../cli/onepage-core.mjs';

const PROMPT_SYSTEM = `You write one prompt for a text-to-image model. The picture will be redrawn by setting the whole document in tiny letters whose weight follows the brightness, so it needs LARGE FILLED AREAS of clearly different brightness: one central, recognisable subject (a person, object, building or landscape that stands for the document's topic), photographic or painted with strong light and shadow, dark subject on a light background or the reverse. No line drawings, no thin outlines, no fine patterns. Never letters, typography, posters, pages, books, documents, screens or signs as the subject, and no text anywhere — even if the document is about writing; then show a person, place or object instead. Answer with the prompt only, in English, at most 60 words.`;

/** A short, iconic image prompt for the document, from its title and opening. */
export async function imagePrompt(title, text, { url, apiKey, model, timeoutMs = 120000 }, signal) {
  const limit = (ms) => (signal ? AbortSignal.any([AbortSignal.timeout(ms), signal]) : AbortSignal.timeout(ms));
  const headers = { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) };
  let name = model;
  if (!name) {
    const models = await fetch(`${url}/v1/models`, { headers, signal: limit(15000) }).then((r) => r.json());
    name = models.data?.[0]?.id;
    if (!name) throw new Error('LLM: no model available');
  }
  const res = await fetch(`${url}/v1/chat/completions`, {
    method: 'POST', headers, signal: limit(timeoutMs),
    body: JSON.stringify({
      model: name, temperature: 0.4, max_tokens: 200,
      messages: [
        { role: 'system', content: PROMPT_SYSTEM },
        { role: 'user', content: `Document title: ${title}\n\nOpening of the document:\n${text.slice(0, 6000)}` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`LLM: HTTP ${res.status}`);
  const out = (await res.json()).choices?.[0]?.message?.content?.trim();
  if (!out) throw new Error('LLM: empty answer');
  // Quoted words would be painted as lettering: drop them, and say again that the picture has no text.
  const prompt = out.replace(/<think>[\s\S]*?<\/think>/g, '').trim().replace(/^"|"$/g, '').replace(/["“„][^"”“]*["”“]/g, '').replace(/\s{2,}/g, ' ').trim();
  return `${prompt.replace(/[.\s]+$/, '')}. No text, no letters, no writing.`;
}

/** The picture as a data URL, from our image model (OpenAI-compatible images endpoint). */
export async function generateImage(prompt, { url, model, size = '1024x1152', timeoutMs = 600000 }, signal) {
  const res = await fetch(`${url}/v1/images/generations`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: signal ? AbortSignal.any([AbortSignal.timeout(timeoutMs), signal]) : AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({ prompt, model, size, steps: 30, n: 1, negative_prompt: 'text, letters, words, watermark, signature, logo, frame' }),
  });
  if (!res.ok) throw new Error(`Image model: HTTP ${res.status}`);
  const item = (await res.json()).data?.[0];
  if (item?.b64_json) return `data:image/png;base64,${item.b64_json}`;
  if (item?.url) return item.url;
  throw new Error('Image model: no image');
}

/** Runs a whole job; returns { pdfBytes, prompt, characters, check }. */
export async function runJob({ inputFile, title, pdfOut, previewOut, onImage, onSession, signal }, cfg) {
  signal?.throwIfAborted();
  const doc = readDocument(inputFile);
  // Refused before any model or browser work is spent on it: the payer's fault, so the transaction is released.
  if (!doc.text.trim()) throw Object.assign(new Error('The document has no text layer.'), { refused: true });
  if (cfg.maxCharacters && doc.text.length > cfg.maxCharacters) throw Object.assign(new Error(`The document has ${doc.text.length} characters; at most ${cfg.maxCharacters} are accepted.`), { refused: true });
  const name = title || 'Document';
  const prompt = await imagePrompt(name, doc.text, cfg.llm, signal);
  const motif = await generateImage(prompt, cfg.image, signal);
  onImage?.();
  signal?.throwIfAborted();
  const session = await openSession();
  onSession?.(session);
  try {
    signal?.throwIfAborted();
    const subtitle = [doc.pages ? `${doc.pages} pages` : null, 'on one page'].filter(Boolean).join(' ');
    const r = await makeOnePage(session, { text: doc.text, title: name, subtitle, motif, options: { color: 'photo' }, pdf: pdfOut, preview: previewOut });
    if (!r.check || !r.check.visibleIdentical) throw new Error('The one-pager did not read back identical to the document');
    return { pdfBytes: r.pdfBytes, prompt, characters: r.characters, check: r.check, motifBytes: motif.length };
  } finally {
    await session.close();
  }
}

