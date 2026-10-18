//! Decrypts a `tgst1` stream: `StreamReader::open` derives the frame key and decrypts the
//! metadata frame, `frame(i)` decrypts a single data frame. Reimplements only the read path of
//! `src/stream.js`'s `StreamReader` (the self-extractor is a player, not a packer, so
//! `sealStream` is not reimplemented here): HKDF-SHA-256 key derivation and AES-256-GCM per
//! frame with AAD `header || counter`.

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use hkdf::Hkdf;
use sha2::Sha256;

use crate::error::TgxError;
use crate::header::{Header, HEADER_LEN};
use crate::meta::Metadata;

const META_COUNTER: u64 = u64::MAX;
const HKDF_SALT_PREFIX: &[u8] = b"tgst1/key";
const HKDF_INFO_PREFIX: &[u8] = b"tgst1/aes-256-gcm";

/// Reads a `tgst1` stream file: parses the clear header on construction (no key needed), then
/// `open` decrypts the metadata frame, and `frame(i)` decrypts one data frame at a time.
pub struct StreamReader<'a> {
    file: &'a [u8],
    header: Header,
    cipher: Option<Aes256Gcm>,
    meta: Option<Metadata>,
}

impl<'a> StreamReader<'a> {
    /// Parses and validates the clear header of `file`. No key is needed yet.
    pub fn new(file: &'a [u8]) -> Result<Self, TgxError> {
        let header = Header::parse(file)?;
        Ok(StreamReader {
            file,
            header,
            cipher: None,
            meta: None,
        })
    }

    /// True if the stream is bound to a work.
    pub fn bound(&self) -> bool {
        self.header.bound
    }

    /// Number of data frames.
    pub fn frame_count(&self) -> u32 {
        self.header.frame_count
    }

    /// Plaintext bytes per data frame (the last frame may be shorter).
    pub fn frame_size(&self) -> u32 {
        self.header.frame_size
    }

    /// Total plaintext size across all data frames.
    pub fn size(&self) -> u64 {
        self.header.size
    }

    /// The decrypted metadata envelope, once `open` has succeeded.
    pub fn meta(&self) -> Option<&Metadata> {
        self.meta.as_ref()
    }

    /// Derives the frame key and decrypts the metadata frame.
    ///
    /// `secret` is the 16- or 32-byte key secret (the same key model as a sealed record).
    /// `work_digest` (the work's SHA-256) is required when the stream is bound, and ignored
    /// otherwise — matching the JS reader, which never mixes a work digest into an unbound
    /// stream's key.
    pub fn open(
        &mut self,
        secret: &[u8],
        work_digest: Option<&[u8; 32]>,
    ) -> Result<&Metadata, TgxError> {
        if self.header.bound && work_digest.is_none() {
            return Err(TgxError::WorkRequired(
                "This stream is tied to a work: give the work".into(),
            ));
        }
        let bound_digest = if self.header.bound { work_digest } else { None };
        let key = frame_key(secret, &self.header.file_salt, bound_digest)?;
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));

        let ct = &self.file[HEADER_LEN..HEADER_LEN + self.header.meta_ct_len as usize];
        let plain = decrypt(&cipher, &self.header.bytes, META_COUNTER, ct)?;
        let meta: Metadata = serde_json::from_slice(&plain)
            .map_err(|_| TgxError::Damaged("The metadata is damaged".into()))?;
        if meta.size != self.header.size {
            return Err(TgxError::Damaged(
                "The metadata does not match the stream".into(),
            ));
        }

        self.cipher = Some(cipher);
        self.meta = Some(meta);
        Ok(self.meta.as_ref().unwrap())
    }

    /// Decrypts data frame `i` (0-based) and returns its plaintext.
    pub fn frame(&self, i: u32) -> Result<Vec<u8>, TgxError> {
        let cipher = self
            .cipher
            .as_ref()
            .ok_or_else(|| TgxError::NoKey("Open the stream first".into()))?;
        if i >= self.header.frame_count {
            return Err(TgxError::BadOption("frame out of range".into()));
        }
        let (off, len) = self.header.frame_bounds(i);
        let ct = &self.file[off..off + len];
        decrypt(cipher, &self.header.bytes, i as u64, ct)
    }
}

/// `HKDF-SHA-256(secret, salt = "tgst1/key" || fileSalt, info = "tgst1/aes-256-gcm" ||
/// (bound ? workDigest : ""), 32)`.
fn frame_key(
    secret: &[u8],
    file_salt: &[u8; 16],
    work_digest: Option<&[u8; 32]>,
) -> Result<[u8; 32], TgxError> {
    if secret.len() != 16 && secret.len() != 32 {
        return Err(TgxError::BadOption("The secret is 16 or 32 bytes".into()));
    }
    let mut salt = Vec::with_capacity(HKDF_SALT_PREFIX.len() + 16);
    salt.extend_from_slice(HKDF_SALT_PREFIX);
    salt.extend_from_slice(file_salt);

    let mut info = Vec::with_capacity(HKDF_INFO_PREFIX.len() + 32);
    info.extend_from_slice(HKDF_INFO_PREFIX);
    if let Some(wd) = work_digest {
        info.extend_from_slice(wd);
    }

    let hk = Hkdf::<Sha256>::new(Some(&salt), secret);
    let mut okm = [0u8; 32];
    hk.expand(&info, &mut okm)
        .map_err(|_| TgxError::Damaged("HKDF output length is invalid".into()))?;
    Ok(okm)
}

/// The 12-byte nonce `0x00000000 || counter` (8-byte big-endian counter).
fn nonce_of(counter: u64) -> [u8; 12] {
    let mut n = [0u8; 12];
    n[4..12].copy_from_slice(&counter.to_be_bytes());
    n
}

/// Decrypts one frame: ciphertext `ct` (including its trailing 16-byte GCM tag), AAD = clear
/// header || big-endian counter, nonce derived from the counter.
fn decrypt(
    cipher: &Aes256Gcm,
    header: &[u8; HEADER_LEN],
    counter: u64,
    ct: &[u8],
) -> Result<Vec<u8>, TgxError> {
    let mut aad = Vec::with_capacity(HEADER_LEN + 8);
    aad.extend_from_slice(header);
    aad.extend_from_slice(&counter.to_be_bytes());
    let nonce_bytes = nonce_of(counter);
    let nonce = Nonce::from_slice(&nonce_bytes);
    cipher
        .decrypt(nonce, Payload { msg: ct, aad: &aad })
        .map_err(|_| {
            TgxError::BadKey("This key does not open the stream (or it was changed)".into())
        })
}
