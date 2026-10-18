// Password stretching for the places where a human-chosen secret is an ADDITIONAL factor (docs/key-management.md
// section 7, docs/cipher-review.md section 1). Two KDFs, both deterministic and the same in browsers and Node:
//   pbkdf2-sha512  Web Crypto (available everywhere; not memory-hard)
//   argon2id       RFC 9106, vendored @noble/hashes 2.4.0 (assets/vendor/noble-hashes, MIT); cross-checked against Node's native
//                  implementation in the tests. Memory-hard: the default.
// The parameters are written next to the data they protect (a public record may be attacked offline for ever, so the
// parameters are part of the evidence, not a secret).
import { argon2idAsync } from '../assets/vendor/noble-hashes/argon2.js';
import { fail, utf8, concat, varint, readVarint } from './crypt-codec.js';

export const KDF_LIMITS = { minIterations: 100_000, maxIterations: 5_000_000, minMemoryKiB: 8192, maxMemoryKiB: 262_144, maxPasses: 10, maxParallelism: 4 };
export const DEFAULT_PARAMS = Object.freeze({ kdf: 'argon2id', memoryKiB: 65_536, passes: 3, parallelism: 1 });
export const PBKDF2_PARAMS = Object.freeze({ kdf: 'pbkdf2-sha512', iterations: 600_000 });

/** Checks parameters (also those read from an untrusted record) and returns a clean copy. */
export function checkParams(p = DEFAULT_PARAMS) {
  if (p?.kdf === 'pbkdf2-sha512') {
    if (!Number.isInteger(p.iterations) || p.iterations < KDF_LIMITS.minIterations || p.iterations > KDF_LIMITS.maxIterations) throw fail('bad-option', `iterations is ${KDF_LIMITS.minIterations} to ${KDF_LIMITS.maxIterations}`);
    return { kdf: 'pbkdf2-sha512', iterations: p.iterations };
  }
  if (p?.kdf === 'argon2id') {
    const { memoryKiB, passes, parallelism } = p;
    if (!Number.isInteger(memoryKiB) || memoryKiB < KDF_LIMITS.minMemoryKiB || memoryKiB > KDF_LIMITS.maxMemoryKiB) throw fail('bad-option', `memoryKiB is ${KDF_LIMITS.minMemoryKiB} to ${KDF_LIMITS.maxMemoryKiB}`);
    if (!Number.isInteger(passes) || passes < 1 || passes > KDF_LIMITS.maxPasses) throw fail('bad-option', `passes is 1 to ${KDF_LIMITS.maxPasses}`);
    if (!Number.isInteger(parallelism) || parallelism < 1 || parallelism > KDF_LIMITS.maxParallelism) throw fail('bad-option', `parallelism is 1 to ${KDF_LIMITS.maxParallelism}`);
    return { kdf: 'argon2id', memoryKiB, passes, parallelism };
  }
  throw fail('bad-option', 'kdf is "argon2id" or "pbkdf2-sha512"');
}
/** Parameters as bytes: 0x01 varint(iterations) | 0x02 varint(memoryKiB) varint(passes) varint(parallelism). */
export function encodeParams(p) {
  const c = checkParams(p);
  return c.kdf === 'pbkdf2-sha512' ? concat(Uint8Array.of(1), varint(c.iterations)) : concat(Uint8Array.of(2), varint(c.memoryKiB), varint(c.passes), varint(c.parallelism));
}
/** @returns {[object, number]} parameters and the offset after them */
export function decodeParams(bytes, at = 0) {
  const id = bytes[at];
  try {
    if (id === 1) { const [iterations, n] = readVarint(bytes, at + 1); return [checkParams({ kdf: 'pbkdf2-sha512', iterations }), n]; }
    if (id === 2) {
      const [memoryKiB, a] = readVarint(bytes, at + 1), [passes, b] = readVarint(bytes, a), [parallelism, c] = readVarint(bytes, b);
      return [checkParams({ kdf: 'argon2id', memoryKiB, passes, parallelism }), c];
    }
  } catch (e) { if (e.code === 'bad-option') throw fail('damaged', 'The key derivation parameters are not acceptable'); throw e; }
  throw fail('damaged', 'Unknown key derivation');
}

/** 32 bytes from a password: the password is NFC-normalised UTF-8; the salt is at least 16 bytes. */
export async function stretch(password, salt, params = DEFAULT_PARAMS) {
  if (typeof password !== 'string' || !password) throw fail('no-key', 'The password is empty');
  if (!(salt instanceof Uint8Array) || salt.length < 16) throw fail('bad-option', 'The salt is at least 16 bytes');
  const p = checkParams(params), pw = utf8(password.normalize('NFC'));
  if (p.kdf === 'pbkdf2-sha512') {
    const k = await crypto.subtle.importKey('raw', pw, 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-512', salt, iterations: p.iterations }, k, 256));
  }
  return argon2idAsync(pw, salt, { t: p.passes, m: p.memoryKiB, p: p.parallelism, dkLen: 32 });
}
