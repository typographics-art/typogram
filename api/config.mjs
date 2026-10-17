// Reads the service's numeric settings from the environment and refuses nonsense. A typo must stop the
// service at start-up: `Number('abc')` is NaN, and every comparison with NaN is false, which would let the
// payment check wave everything through.

/**
 * A number from the environment, or `fallback` when unset. Throws on anything that is not a finite number
 * inside [min, max], or not an integer when `integer` is set.
 */
export function numberFrom(env, name, fallback, { min = 0, max = Infinity, integer = false, minExclusive = false } = {}) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  const bad = !Number.isFinite(n) || (integer && !Number.isInteger(n)) || (minExclusive ? n <= min : n < min) || n > max;
  if (bad) throw new Error(`${name}=${JSON.stringify(raw)} is not valid: expected ${integer ? 'an integer' : 'a number'} ${minExclusive ? '>' : '>='} ${min}${max < Infinity ? ` and <= ${max}` : ''}`);
  return n;
}
