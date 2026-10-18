//! Conformance test: every vector in `test/fixtures/conformance/stream-vectors.json` (built by
//! `scripts/build-stream-vectors.mjs` from the JS `sealStream`/`StreamReader` in `src/stream.js`)
//! must decrypt, in this Rust implementation, to byte-identical metadata and frames, using only
//! the inputs a real player has: `secret`, the file's own header (`fileSalt` included), the work
//! digest for bound streams, and the sealed bytes.

use serde::Deserialize;
use tgx_crypto::StreamReader;

#[derive(Deserialize)]
struct VectorFile {
    standard: String,
    version: u32,
    vectors: Vec<Vector>,
}

#[derive(Deserialize)]
struct Vector {
    name: String,
    #[serde(rename = "secretHex")]
    secret_hex: String,
    #[serde(rename = "workDigestHex")]
    work_digest_hex: Option<String>,
    #[serde(rename = "fileHex")]
    file_hex: String,
    expect: Expect,
}

#[derive(Deserialize)]
struct Expect {
    meta: serde_json::Value,
    #[serde(rename = "frameCount")]
    frame_count: u32,
    #[serde(rename = "frameSize")]
    frame_size: u32,
    size: u64,
    #[serde(rename = "frameHex")]
    frame_hex: Vec<String>,
}

fn decode_hex(s: &str) -> Vec<u8> {
    hex::decode(s).unwrap_or_else(|e| panic!("invalid hex in fixture: {e}"))
}

/// Compares the decrypted `Metadata` against the fixture's expected JSON object field by field,
/// so a missing optional field (absent from the JSON) and `None` compare equal.
fn assert_meta_matches(name: &str, meta: &tgx_crypto::Metadata, expect: &serde_json::Value) {
    let obj = expect.as_object().expect("expect.meta is a JSON object");
    let str_field = |k: &str| obj.get(k).and_then(|v| v.as_str()).map(str::to_string);

    assert_eq!(
        meta.media,
        obj["media"].as_str().unwrap(),
        "{name}: meta.media"
    );
    assert_eq!(
        meta.size,
        obj["size"].as_u64().unwrap(),
        "{name}: meta.size"
    );
    assert_eq!(meta.name, str_field("name"), "{name}: meta.name");
    assert_eq!(meta.created, str_field("created"), "{name}: meta.created");
    assert_eq!(meta.title, str_field("title"), "{name}: meta.title");
    assert_eq!(meta.sha256, str_field("sha256"), "{name}: meta.sha256");
}

#[test]
fn conformance_vectors() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../test/fixtures/conformance/stream-vectors.json"
    );
    let raw = std::fs::read_to_string(path).unwrap_or_else(|e| panic!("reading {path}: {e}"));
    let fixture: VectorFile = serde_json::from_str(&raw).expect("fixture is valid JSON");
    assert_eq!(fixture.standard, "tgst1");
    assert_eq!(fixture.version, 1);
    assert!(!fixture.vectors.is_empty(), "fixture has no vectors");

    let mut checked = Vec::new();
    for v in &fixture.vectors {
        let secret = decode_hex(&v.secret_hex);
        let work_digest = v.work_digest_hex.as_deref().map(|h| {
            let bytes = decode_hex(h);
            let mut arr = [0u8; 32];
            arr.copy_from_slice(&bytes);
            arr
        });
        let file = decode_hex(&v.file_hex);

        let mut reader = StreamReader::new(&file)
            .unwrap_or_else(|e| panic!("{}: header parse failed: {e}", v.name));
        assert_eq!(
            reader.frame_count(),
            v.expect.frame_count,
            "{}: frameCount",
            v.name
        );
        assert_eq!(
            reader.frame_size(),
            v.expect.frame_size,
            "{}: frameSize",
            v.name
        );
        assert_eq!(reader.size(), v.expect.size, "{}: size", v.name);

        let meta = reader
            .open(&secret, work_digest.as_ref())
            .unwrap_or_else(|e| panic!("{}: open failed: {e}", v.name));
        assert_meta_matches(&v.name, meta, &v.expect.meta);

        for (i, expected_hex) in v.expect.frame_hex.iter().enumerate() {
            let plain = reader
                .frame(i as u32)
                .unwrap_or_else(|e| panic!("{}: frame {i} failed: {e}", v.name));
            assert_eq!(
                plain,
                decode_hex(expected_hex),
                "{}: frame {i} bytes",
                v.name
            );
        }

        checked.push(v.name.clone());
    }

    assert_eq!(
        checked,
        vec![
            "single-frame-unbound",
            "multi-frame-three-plus-remainder",
            "single-frame-16-byte-secret",
            "bound-to-work",
            "empty-payload",
        ],
        "fixture vector set changed — update this test's expectations",
    );
}

/// An unbound stream's `open` without a work digest succeeds (the JS reader never requires one
/// unless `bound` is set) — this guards against accidentally flipping the `bound` check.
#[test]
fn unbound_stream_does_not_require_a_work_digest() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../test/fixtures/conformance/stream-vectors.json"
    );
    let raw = std::fs::read_to_string(path).unwrap();
    let fixture: VectorFile = serde_json::from_str(&raw).unwrap();
    let v = fixture
        .vectors
        .iter()
        .find(|v| v.name == "single-frame-unbound")
        .unwrap();
    let file = decode_hex(&v.file_hex);
    let secret = decode_hex(&v.secret_hex);
    let mut reader = StreamReader::new(&file).unwrap();
    assert!(!reader.bound());
    assert!(reader.open(&secret, None).is_ok());
}

/// A bound stream's `open` without a work digest is refused with `WorkRequired`.
#[test]
fn bound_stream_requires_a_work_digest() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../test/fixtures/conformance/stream-vectors.json"
    );
    let raw = std::fs::read_to_string(path).unwrap();
    let fixture: VectorFile = serde_json::from_str(&raw).unwrap();
    let v = fixture
        .vectors
        .iter()
        .find(|v| v.name == "bound-to-work")
        .unwrap();
    let file = decode_hex(&v.file_hex);
    let secret = decode_hex(&v.secret_hex);
    let mut reader = StreamReader::new(&file).unwrap();
    assert!(reader.bound());
    assert_eq!(
        reader.open(&secret, None),
        Err(tgx_crypto::TgxError::WorkRequired(
            "This stream is tied to a work: give the work".into()
        ))
    );
}

/// A wrong secret fails the GCM tag check on the metadata frame (`BadKey`), not a panic.
#[test]
fn wrong_secret_is_rejected_cleanly() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../test/fixtures/conformance/stream-vectors.json"
    );
    let raw = std::fs::read_to_string(path).unwrap();
    let fixture: VectorFile = serde_json::from_str(&raw).unwrap();
    let v = &fixture.vectors[0];
    let file = decode_hex(&v.file_hex);
    let mut wrong_secret = decode_hex(&v.secret_hex);
    wrong_secret[0] ^= 0xff;
    let mut reader = StreamReader::new(&file).unwrap();
    match reader.open(&wrong_secret, None) {
        Err(tgx_crypto::TgxError::BadKey(_)) => {}
        other => panic!("expected BadKey, got {other:?}"),
    }
}

/// A truncated file is refused at header-parse time (`Damaged`), not a panic or an out-of-bounds read.
#[test]
fn truncated_file_is_rejected_cleanly() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../test/fixtures/conformance/stream-vectors.json"
    );
    let raw = std::fs::read_to_string(path).unwrap();
    let fixture: VectorFile = serde_json::from_str(&raw).unwrap();
    let v = fixture
        .vectors
        .iter()
        .find(|v| v.name == "multi-frame-three-plus-remainder")
        .unwrap();
    let mut file = decode_hex(&v.file_hex);
    file.truncate(file.len() - 10);
    match StreamReader::new(&file) {
        Ok(_) => panic!("expected Damaged, got Ok"),
        Err(tgx_crypto::TgxError::Damaged(_)) => {}
        Err(other) => panic!("expected Damaged, got {other:?}"),
    }
}
