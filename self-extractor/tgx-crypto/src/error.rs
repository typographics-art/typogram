//! Error type for `tgx-crypto`. Every failure path returns one of these — never a panic.

use std::fmt;

/// A decoding or decryption failure. Mirrors the error classes of the JS `tgst1` reader
/// (`src/stream.js`'s `StreamReader`), without carrying its error codes verbatim.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TgxError {
    /// The file does not start with the `TGST1` magic, or is shorter than the header.
    BadPrefix(String),
    /// The clear header is internally inconsistent, or the file length does not match it.
    Damaged(String),
    /// A caller-supplied argument is invalid (e.g. a secret that is neither 16 nor 32 bytes).
    BadOption(String),
    /// The AES-256-GCM authentication tag did not verify: wrong key, or changed ciphertext.
    BadKey(String),
    /// A frame was requested before `open` derived the key.
    NoKey(String),
    /// The stream is bound to a work and no work digest was given.
    WorkRequired(String),
}

impl fmt::Display for TgxError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let msg = match self {
            TgxError::BadPrefix(m)
            | TgxError::Damaged(m)
            | TgxError::BadOption(m)
            | TgxError::BadKey(m)
            | TgxError::NoKey(m)
            | TgxError::WorkRequired(m) => m,
        };
        f.write_str(msg)
    }
}

impl std::error::Error for TgxError {}
