//! The `tgst1` metadata envelope: a small canonical-JSON record (media type, size, optional
//! name/created/title/sha256) carried as the stream's first, encrypted frame.

use serde::Deserialize;

/// The decrypted metadata envelope of a `tgst1` stream.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Metadata {
    /// The MIME type of the plaintext, e.g. `video/mp4`.
    pub media: String,
    /// Plaintext length in bytes; must equal the header's `size`.
    pub size: u64,
    /// The original file name, if any.
    #[serde(default)]
    pub name: Option<String>,
    /// An ISO-8601 timestamp, if any.
    #[serde(default)]
    pub created: Option<String>,
    /// A human label for a cover or a player, if any.
    #[serde(default)]
    pub title: Option<String>,
    /// Hex SHA-256 of the plaintext, if any.
    #[serde(default)]
    pub sha256: Option<String>,
}
