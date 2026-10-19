// Map the handful of characters the embedded subset font (Roboto Flex) does not contain to glyphs it has, so a
// self-contained Typogram renders identically everywhere — offline, in a sandbox, under a strict CSP — instead of
// falling back to a system font with the wrong width (which shifts every glyph after it, because the layout places
// each letter at a measured x). Measured against assets/fonts/roboto-flex-*.woff2: the font HAS ¹²³ · — – « » § and
// the common Latin set; it LACKS the arrows, check marks, maths signs, white square brackets, the superscripts ⁴⁺,
// the figure/non-breaking hyphens and the loose combining diacritical marks handled below. NFC first, then idempotent.
export const fontSafe = (s) => String(s).normalize('NFC')
  .replace(/→/g, '->').replace(/←/g, '<-').replace(/↔/g, '<->').replace(/⇒/g, '=>').replace(/⇐/g, '<=')
  .replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/≈/g, '~').replace(/≠/g, '!=')
  .replace(/✓/g, 'yes').replace(/✗/g, 'no')
  .replace(/⟦/g, '«').replace(/⟧/g, '»')
  .replace(/[‐‑‒―]/g, '-')              // hyphen, non-breaking, figure and horizontal-bar dashes (– — stay)
  .replace(/­/g, '').replace(/[   ]/g, ' ') // soft hyphen out; narrow/no-break spaces → a space
  .replace(/[̀-ͯ]/g, '');                        // leftover combining diacritical marks (not in the subset font)
