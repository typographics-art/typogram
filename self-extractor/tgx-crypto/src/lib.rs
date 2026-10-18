//! Pure decryption of the tg-art `tgst1` encrypted-stream format: the clear 44-byte header,
//! HKDF-SHA-256 frame-key derivation, and AES-256-GCM per-frame decryption with an
//! AAD-authenticated header+counter (docs/encrypted-media-adapter.md; ground truth is
//! `src/stream.js`). This crate implements only the read path (`StreamReader`) — the
//! self-extractor is a player, not a packer, so `sealStream` is not reimplemented here.

mod error;
mod header;
mod meta;
mod reader;

pub use error::TgxError;
pub use header::{Header, HEADER_LEN, TAG_LEN};
pub use meta::Metadata;
pub use reader::StreamReader;
