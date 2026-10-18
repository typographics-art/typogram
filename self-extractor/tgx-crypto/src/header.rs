//! Parses and validates the 44-byte clear `tgst1` header (docs/encrypted-media-adapter.md,
//! `src/stream.js`'s `StreamReader` constructor). Every check here mirrors that constructor,
//! including the exact byte ranges — ground truth is the JS source, not the prose doc.

use crate::error::TgxError;

/// Size of the clear header, in bytes: `magic(5) flags(1) fileSalt(16) frameSize(4)
/// frameCount(4) reserved(4) totalSize(8) metaCtLen(2)`. The sealer leaves the 4 bytes at
/// offset 30..34 zero; the reader does not interpret them.
pub const HEADER_LEN: usize = 44;
/// AES-256-GCM authentication tag length, in bytes.
pub const TAG_LEN: usize = 16;

const MAGIC: &[u8; 5] = b"TGST1";
const FLAG_BOUND: u8 = 1;
const MIN_FRAME: u32 = 4 << 10; // 4 KiB
const MAX_FRAME: u32 = 16 << 20; // 16 MiB

/// The parsed and validated clear header of a `tgst1` file.
#[derive(Debug, Clone)]
pub struct Header {
    /// The raw 44 header bytes, kept verbatim: every frame's AAD is `header || counter`.
    pub bytes: [u8; HEADER_LEN],
    /// True if the stream is bound to a work (the metadata key's HKDF info includes the work digest).
    pub bound: bool,
    /// Per-file random salt, mixed into the HKDF salt.
    pub file_salt: [u8; 16],
    /// Plaintext bytes per data frame (the last frame may be shorter).
    pub frame_size: u32,
    /// Number of data frames.
    pub frame_count: u32,
    /// Total plaintext size across all data frames.
    pub size: u64,
    /// Ciphertext length (including the 16-byte tag) of the metadata frame.
    pub meta_ct_len: u16,
}

impl Header {
    /// Parses and validates the header of `file`, including that `file.len()` matches what the
    /// header declares. Touches no ciphertext.
    pub fn parse(file: &[u8]) -> Result<Header, TgxError> {
        if file.len() < HEADER_LEN || &file[0..5] != MAGIC {
            return Err(TgxError::BadPrefix("Not a tgst1 stream file".into()));
        }
        let mut bytes = [0u8; HEADER_LEN];
        bytes.copy_from_slice(&file[0..HEADER_LEN]);

        let bound = (bytes[5] & FLAG_BOUND) != 0;
        let mut file_salt = [0u8; 16];
        file_salt.copy_from_slice(&bytes[6..22]);
        let frame_size = u32::from_be_bytes(bytes[22..26].try_into().unwrap());
        let frame_count = u32::from_be_bytes(bytes[26..30].try_into().unwrap());
        let size = u64::from_be_bytes(bytes[34..42].try_into().unwrap());
        let meta_ct_len = u16::from_be_bytes(bytes[42..44].try_into().unwrap());

        if !(MIN_FRAME..=MAX_FRAME).contains(&frame_size) {
            return Err(TgxError::Damaged(
                "The stream header is damaged (frame size)".into(),
            ));
        }
        if (size as u128).div_ceil(frame_size as u128) != frame_count as u128 {
            return Err(TgxError::Damaged(
                "The stream header is damaged (frame count does not match the size)".into(),
            ));
        }
        if (meta_ct_len as usize) < TAG_LEN {
            return Err(TgxError::Damaged(
                "The stream header is damaged (metadata length)".into(),
            ));
        }

        let expected_len = HEADER_LEN as u128
            + meta_ct_len as u128
            + size as u128
            + frame_count as u128 * TAG_LEN as u128;
        if file.len() as u128 != expected_len {
            let word = if file.len() as u128 > expected_len {
                "longer"
            } else {
                "shorter"
            };
            return Err(TgxError::Damaged(format!(
                "The stream file is {word} than its header says (truncated or changed)"
            )));
        }

        Ok(Header {
            bytes,
            bound,
            file_salt,
            frame_size,
            frame_count,
            size,
            meta_ct_len,
        })
    }

    /// Byte offset and ciphertext+tag length of data frame `i` within the file. Caller must
    /// have already checked `i < frame_count`.
    pub(crate) fn frame_bounds(&self, i: u32) -> (usize, usize) {
        let frame_size = self.frame_size as u128;
        let off = HEADER_LEN as u128
            + self.meta_ct_len as u128
            + i as u128 * (frame_size + TAG_LEN as u128);
        let plain_len = if i < self.frame_count - 1 {
            frame_size
        } else {
            self.size as u128 - (self.frame_count as u128 - 1) * frame_size
        };
        (off as usize, (plain_len + TAG_LEN as u128) as usize)
    }
}
