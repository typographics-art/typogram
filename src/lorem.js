const WORDS = ('lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et ' +
  'dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo ' +
  'consequat duis aute irure in reprehenderit voluptate velit esse cillum fugiat nulla pariatur excepteur sint ' +
  'occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum').split(' ');

/**
 * Deterministic Lorem ipsum of at most `length` characters, ending with a full stop.
 * The same seed always yields the same text, so a filled artwork can be reproduced.
 */
export function lorem(length, seed = 1) {
  let s = (seed >>> 0) || 2463534242;
  const rnd = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  let out = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.';
  while (out.length < length) {
    const len = 6 + Math.floor(rnd() * 12);
    const w = [];
    for (let i = 0; i < len; i++) w.push(WORDS[Math.floor(rnd() * WORDS.length)]);
    if (len > 9) w[3 + Math.floor(rnd() * (len - 6))] += ',';
    w[0] = w[0][0].toUpperCase() + w[0].slice(1);
    out += ' ' + w.join(' ') + (rnd() < 0.08 ? '?' : '.');
  }
  if (out.length > length) {
    const cut = out.lastIndexOf(' ', length - 1);
    out = out.slice(0, cut > 0 ? cut : length - 1).replace(/[,.?]$/, '') + '.';
  }
  return out;
}
