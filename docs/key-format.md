# Key formats: side by side, measured, with lossless and lossy compression

Companion of [encrypted-data.md](encrypted-data.md). Every number below comes from `node scripts/crypt-measure.mjs` (Node 26.11, the real code in `src/crypt*.js`); the texts are the repository's own samples, seeded where random. Keys that are made from random choices are the mean of 5 runs.

## 1. The formats

| Prefix | What it is | Alphabet | Protects against | Status |
|---|---|---|---|---|
| `tg1.` | book cipher over the work's text, positions as varints ([hidden-messages.md](hidden-messages.md)) | base64url | nothing but a glance: **obfuscation** | existing, unchanged |
| `tg2.` | the same book cipher, bit-packed or Rice-coded positions, 2-byte check | base58 | the same: **obfuscation** | implemented (`src/crypt-book.js`) |
| `tgx1.` | key of a sealed record: 16 or 32 random bytes, optional work fingerprint, optionally the whole record | base58 | **encryption** (AES-256-GCM) | implemented (`src/crypt.js`) |
| `tgs1.` | the sealed record itself (public ciphertext) | base64url | needs the key; carries no secret | implemented |
| `TGS1[ … ]TGS1` | a sealed record inside a work's text, whitespace-tolerant like `TGD1[ … ]TGD1` | base64url | – | implemented (`findSealedBlocks`) |

The rule for structured data is therefore: **a TGD block is sealed (`tgx1.` + `tgs1.`), never book-ciphered.** Section 4 of [encrypted-data.md](encrypted-data.md) has the measurements that decided it.

## 2. Grammar

```ebnf
key          = tg1-key | tg2-key | tgx1-key ;
tg1-key      = "tg1."  , b64url ;
tg2-key      = "tg2."  , b58 ;
tgx1-key     = "tgx1." , b58 ;
record       = "tgs1." , b64url ;
sealed-block = "TGS1[" , { white } , record , { white } , "]TGS1" ;   (* white: whitespace and invisible characters are ignored anywhere *)
b64url       = { "A".."Z" | "a".."z" | "0".."9" | "-" | "_" } ;        (* RFC 4648 section 5, no padding, canonical: unused bits are zero *)
b58          = { "1".."9" | "A".."H" | "J".."N" | "P".."Z" | "a".."k" | "m".."z" } ;   (* Bitcoin alphabet: no 0 O I l *)
```

A reader first removes all whitespace from a key (a chat app may wrap it), then checks the prefix, then decodes. Anything that is not exactly one of these forms is refused with a named error code, never decoded to something else.

### 2.1 `tg1.` (unchanged)

```
bytes = fp8 , { varint }          fp8 = first 8 bytes of SHA-256(canonical text of the work)
varint = LEB128: 7 bits per byte, low group first, high bit = more follows
```

### 2.2 `tg2.`

```
bytes  = flags , fp , count , bits , check
flags  : bit 0  coding: 0 = fixed width, 1 = Rice distances
         bit 1  fingerprint length: 0 = 8 bytes, 1 = 4 bytes
         bits 2-6  fixed width: bits per position minus 1;  Rice: the parameter k (0 to 31)
         bit 7  reserved, must be 0
fp     = first 8 (or 4) bytes of SHA-256(canonical text)
count  = varint, characters of the message (1 to 2^20)
bits   = count codes, packed most significant bit first, last byte padded with zeros
         fixed:  position as an unsigned integer of `width` bits (width = ceil(log2 N), N = clusters in the work)
         Rice:   v = (position - previous - 1) mod N, previous starts at -1; q = v div 2^k in unary (q ones, a zero), then v mod 2^k in k bits
check  = first 2 bytes of SHA-256("tg2" , 0x00 , everything before it)
```

The encoder writes both codings and keeps the shorter one. The *choice of positions* (random among all occurrences, or near the previous one) is an encoder policy that the format does not record; see section 4.

### 2.3 `tgx1.`

```
bytes  = version(1) , flags , secret , [fp8] , [record-bytes] , check
version = 0x01
flags  : bit 0  bound: fp8 follows the secret (the key fits one work)
         bit 1  inline: the sealed record's bytes follow (the key carries the data)
         bit 2  secret is 16 bytes (else 32)
         bits 3-7  reserved, must be 0
check  = first 2 bytes of SHA-256("tgx1" , 0x00 , everything before it)
```

### 2.4 `tgs1.` record

```
bytes  = version(1) , flags , [salt(16) , iterations(varint)] , nonce(12) , ciphertext , tag(16)
version = 0x01
flags  : bit 0  bound: the content key was derived with the SHA-256 of the work's canonical text
         bit 1  the data inside is raw-deflate compressed
         bit 2  PBKDF2: salt and iteration count follow (the "key" is a password)
         bit 3  the data inside is brotli compressed (never together with bit 1)
         bits 4-7  reserved, must be 0
AAD    = "tgs1" , version , flags , [salt , iterations]       (so every header byte is authenticated)
content key = HKDF-SHA256( ikm , salt = "tgx1/salt" , info = "tgx1/aes-256-gcm" , work-digest if bound ) -> AES-256-GCM
ikm    = the key's secret, or PBKDF2-HMAC-SHA256(NFC(password), salt, iterations) with 32 output bytes
plaintext = varint(n) , kind(1) , data(n-1) , zero padding
kind   : 1 TGD body (the block without its frame, whitespace removed), 2 UTF-8 text, 3 bytes
```

After opening, a `kind` 1 body is wrapped in `TGD1[` … `]TGD1` and decoded by the TGD reader, which verifies its own `sum`; the result is recognised as TGD by the kind byte **and** the envelope checksum.

## 3. Measured lengths

### 3.1 The book cipher: characters of key, by message length and work length

Mean of 5 keys. Work lengths in grapheme clusters: 3k = 3 000, 50k = 47 409, 600k = 600 000. Message: English letters, spaces, commas, full stops.

| format | 3k:10 | 3k:100 | 3k:1000 | 50k:10 | 50k:100 | 50k:1000 | 600k:10 | 600k:100 | 600k:1000 |
|---|---|---|---|---|---|---|---|---|---|
| tg1 (varint) | 42 | 276 | 2627 | 50 | 362 | 3541 | 55 | 412 | 3971 |
| tg2 fixed width | 41 | 225 | 2064 | 48 | 292 | 2743 | 55 | 358 | 3379 |
| tg2 near K=32 | 38 | 192 | 1765 | 38 | 194 | 1818 | 39 | 205 | 1957 |
| tg2 near K=8 | 35 | 166 | 1512 | 35 | 165 | 1520 | 37 | 172 | 1549 |
| tg2 near K=2 | 32 | 140 | 1215 | 33 | 137 | 1231 | 35 | 147 | 1238 |
| tg2 near K=1 | 31 | 118 | 1098 | 31 | 118 | 1154 | 34 | 142 | 1161 |

"near K" means the encoder picks, for each character, one of the next K occurrences after the previous position. A 4-byte instead of 8-byte fingerprint saves 7 characters (294 to 287 for 100 characters in the 50k work).

Reading it: a book-cipher key costs **4 characters per character of message** with `tg1.` in a long work (3 bytes per position, base64url), 3.4 with `tg2.` fixed width, about 1.2 with nearest occurrences. The fixed cost is 8 to 11 characters (prefix, fingerprint, count, check).

### 3.2 Sealed keys

| key | characters |
|---|---|
| `tgx1.` 256-bit secret, bound to a work | 64 |
| `tgx1.` 128-bit secret, bound | 42 |
| `tgx1.` 256-bit, not bound | 53 |
| `tgx1.` 128-bit, not bound | 31 |
| `tgx1.` 256-bit bound, **with the record inside** (200-row sheet, deflate) | 5 781 |

A key of 64 characters does not depend on the size of the data: **a 200-row sheet and a one-word message have the same key length**, unlike a book cipher (a 17 760-character TGD text would need a key of about 60 600 characters even if every character occurred in the work, which it does not: encrypted-data.md section 4.1).

## 4. Compression: what is lossless, what trades security for size

### 4.1 The payload (a sheet) before it is sealed: lossless by construction

200 rows, 6 columns (name, e-mail, city, amount, date, note), seeded. "Lossless" here means `inflate(deflate(x)) = x` exactly; it never changes what the reader sees.

| variant | bytes |
|---|---|
| source CSV file | 14 440 |
| TGD block as the encoder writes it (rows layout) | 18 428 |
| TGD body, whitespace removed (what is sealed) | 18 205 |
| TGD body, gzip | 3 907 |
| TGD body, raw deflate through `CompressionStream` (default level; what a browser can do) | **4 153** |
| TGD body, raw deflate, zlib level 9 (Node only) | 3 889 |
| TGD body, raw deflate, preset dictionary of the envelope's keys (zlib only) | 3 597 |
| TGD body, brotli (`CompressionStream('brotli')` in Node 26; probe in browsers) | **3 231** |
| source CSV, raw deflate | 3 341 |

Findings: the whitespace-free TGD text is 26 % larger than the CSV (typed JSON); after deflate it is still 16 to 24 % larger (3 889 or 4 153 bytes against 3 341). Sealing the original file as `kind` 3 (bytes) is the smaller choice (3 341 deflated) when the typed model is not needed. Brotli is 22 % smaller than the browser's deflate, a preset dictionary 7.5 % smaller than plain zlib; neither is available in every browser, so deflate is the default and brotli an option the reader can refuse with a clear message (`unsupported-compression`). A dictionary needs a deflate implementation of our own; designed only.

Compression is kept only when the result is smaller than the plain bytes; the record says which method was used (flags bits 1 and 3).

### 4.2 The sealed record

| sealed variant (the same sheet, 600k work) | record bytes | record characters (base64url) |
|---|---|---|
| not compressed | 18 239 | 24 324 |
| deflate (default) | 4 186 | 5 587 |
| brotli | 3 264 | 4 357 |
| deflate, padded to a multiple of 1 024 | 5 150 | 6 872 |

The overhead of the format is exactly 2 (header) + 12 (nonce) + 16 (tag) + 1 (inner length, 2 bytes from 127 bytes of data on) + 1 (kind) = **32 bytes** over the compressed data; measured: a one-character message gives a 33-byte record. The random nonce could be left out (the content key is new for every seal, so a fixed nonce would be safe), saving 12 bytes = 0.3 % of this record; not taken, because a key that is ever reused with a fixed nonce breaks AES-GCM completely. The tag could be cut to 12 bytes (4 bytes saved); not taken.

### 4.3 The key: each idea, with its measured effect

| idea | effect measured | lossless? | security |
|---|---|---|---|
| bit-pack positions at ceil(log2 N) bits instead of varints (`tg2` fixed) | 13 to 23 % shorter than `tg1` (table 3.1) | yes: same positions, same message, same unpredictability | none lost |
| Rice-code distances with the encoder choosing one of the next K occurrences (`tg2` near) | 58 to 71 % shorter for 1 000 characters | the format is lossless; **the policy is not** | randomness per character falls from 11.2 bits (all occurrences, 50k work) to 5.0 (K=32), 3.0 (K=8), 1.0 (K=2), 0 (K=1); a holder of the key without the work learns 0.47 to 0.63 of the 4.15 bits of entropy of each message character (11 to 15 %); two keys of the same message are no longer unrelated |
| 4-byte instead of 8-byte fingerprint | 7 characters | yes | wrong-work detection fails once in 2^32 instead of 2^64 |
| base58 instead of base64url | +2.4 % length (59 instead of 58 characters for 43 bytes) | yes | none; survives chat (section 5) |
| 128-bit instead of 256-bit secret (`tgx1.`) | 42 instead of 64 characters | yes | 2^128 against 2^256 guesses; a public record is permanent, so 256 stays the default |
| unbound key (no fingerprint) | 11 characters | yes | the key fits any work, loses the "wrong work" message |
| 2-byte check in `tg2.`/`tgx1.` | costs 3 characters | – | a typo is reported as a typo (1 in 65 536 slips through to the next layer, which still catches it for `tgx1.` through the GCM tag) |
| word-level book cipher (designed only) | a 15-word, 87-character message: 144 bytes against 218 (-34 %); 10 of 15 words occurred in the 600k work, the other 5 had to be spelled | yes | not built: the gain depends on the words occurring, and it still is not encryption |
| record inside the key | key = 5 781 characters for the 200-row sheet instead of 64 + a 5 587-character record | – | the same; one string, but too long for a chat message |
| hide the 32-byte secret as hexadecimal characters of the work, "hybrid (c)" | 236 characters (`tg2.`), 271 (`tg1.`) for the same secret that `tgx1.` holds in 64 | – | none gained: see encrypted-data.md section 3 |

### 4.4 Lossless versus a trade of security for size, in one list

- **Lossless, no cost to security:** bit packing, base58, deflate/brotli of the payload before sealing, the fingerprint of 8 bytes, the 2-byte check, the 128-bit secret for short-lived data.
- **Lossless on the wire, security traded:** "near K" position policy, a 4-byte fingerprint (negligible), the unbound key.
- **Not done on purpose:** dropping or truncating the authentication tag, a fixed nonce.

## 5. Which characters survive: the alphabet decision

| alphabet | bits per character | 43 bytes | 5 000 bytes | URL-safe | inert in chat markdown | double-click selects it all |
|---|---|---|---|---|---|---|
| base64url (`tg1.`, records) | 6.00 | 58 | 6 667 | yes | no: `_` makes italics in WhatsApp, Telegram, Slack, Discord | no: `-` ends a word in most browsers |
| base58 (`tg2.`, `tgx1.`) | 5.86 | 59 | 6 829 | yes | yes | yes |
| base32 | 5.00 | 69 | 8 000 | yes | yes | yes |
| hex | 4.00 | 86 | 10 000 | yes | yes | yes |
| Z85 / base85 | 6.41 | 55 | 6 250 | no (`" < > \ % &`) | no | no |
| base91 | 6.50 | 53 | 6 154 | no | no | no |

Lengths are computed from the alphabets (script `alphabets`); the three right-hand columns state how the characters are treated by URLs and by the markdown of the named chat applications as documented by their authors, not an experiment run here. **Keys** are typed, pasted and shared by people, so they use base58 (2.4 % longer, no punctuation at all). **Records** travel as files, in a work's text or on a store, never retyped, so they stay base64url, 2.4 % shorter. base58 conversion is quadratic: 20 000 bytes take 0.55 s, so a key may carry at most 32 KiB of record (`LIMITS.maxInlineRecord`).

## 6. Password-derived keys (option)

`password` replaces the random secret: the record's flag bit 2 is set, 16 bytes of salt and the iteration count stand in the header, and there is **no key string**; the password is the key. PBKDF2-HMAC-SHA256 is used because it is the only password KDF Web Crypto offers in browsers (scrypt and Argon2 are not available there and a JavaScript version would be slower and untested).

| iterations | ms for one derivation (this machine, Node 26 Web Crypto) |
|---|---|
| 100 000 | 17 |
| 210 000 | 33 |
| 600 000 (default, OWASP 2023) | 96 |
| 1 000 000 | 159 |
| 2 000 000 | 313 |

A browser on a phone is typically several times slower; the reader accepts 100 000 to 5 000 000 so that a record cannot make a reader hang. What a password gives: an attacker with the record can test passwords offline at the cost above per guess (about 10 guesses per second per core at 600 000 iterations on this machine, orders of magnitude more on a GPU). A password of four random words (about 50 bits) is therefore not safe against an offline attacker who has the record; a random `tgx1.` key is.

## 7. Recommendation

1. **Structured data and anything that must stay secret:** `tgx1.` key (256-bit, bound) + `tgs1.` record, compressed with deflate, 64 characters of key, record kept separate. Brotli where both sides are known to read it. Passwords only for data of low value.
2. **A short message that only has to be hidden from a glance:** `tg2.` fixed width (13 to 23 % shorter than `tg1.`, the same security); `near K` only on request and with the warning of section 4.3.
3. **Keep `tg1.` readable forever** (`revealAny` reads both); never rewrite old keys.
4. **Alphabets:** base58 for keys, base64url for records.
