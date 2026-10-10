#[cfg(feature = "desktop")]
fn verify_prepared() {
    use sha2::{Digest, Sha256};
    use std::{fs, path::Path};
    let root = Path::new("data/precomputed");
    let manifest: serde_json::Value = serde_json::from_slice(
        &fs::read(root.join("manifest.json"))
            .expect("Run npm run prepare:data before building the desktop app"),
    )
    .expect("Invalid prepared manifest");
    let corpus: serde_json::Map<String, serde_json::Value> =
        serde_json::from_slice(&fs::read("data/kjv.json").unwrap()).unwrap();
    let mut hash = Sha256::new();
    for (reference, text) in &corpus {
        let (book, position) = reference.rsplit_once(' ').unwrap();
        let (chapter, verse) = position.split_once(':').unwrap();
        let text = text.as_str().unwrap();
        hash.update((book.len() as u64).to_le_bytes());
        hash.update(book.as_bytes());
        hash.update(chapter.parse::<u16>().unwrap().to_le_bytes());
        hash.update(verse.parse::<u16>().unwrap().to_le_bytes());
        hash.update((text.len() as u64).to_le_bytes());
        hash.update(text.as_bytes());
    }
    let fingerprint: String = hash
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    assert_eq!(
        manifest["format"].as_u64(),
        Some(1),
        "Rebuild prepared phrase data"
    );
    assert_eq!(
        manifest["maximum_words"].as_u64(),
        Some(32),
        "Prepare every phrase length before packaging"
    );
    assert_eq!(
        manifest["fingerprint"].as_str(),
        Some(fingerprint.as_str()),
        "Prepared data belongs to an older Bible; run npm run prepare:data"
    );
    for (name, size) in [
        ("phrases.bin", manifest["total"].as_u64().unwrap() * 32),
        ("groups.bin", manifest["total"].as_u64().unwrap() * 4),
        ("postings.bin", manifest["postings"].as_u64().unwrap() * 4),
        ("tokens.bin", manifest["tokens"].as_u64().unwrap() * 4),
    ] {
        assert_eq!(
            fs::metadata(root.join(name)).unwrap().len(),
            size,
            "Prepared file is incomplete: {name}"
        );
    }
    for name in ["dictionary.json", "words.json", "books.json"] {
        assert!(fs::metadata(root.join(name)).unwrap().len() > 0);
    }
    let verses: serde_json::Value = serde_json::from_slice(
        &fs::read(root.join("verses.json")).expect("Run npm run prepare:data to prepare verses"),
    )
    .unwrap();
    assert_eq!(verses["format"].as_u64(), Some(3));
    assert_eq!(verses["fingerprint"].as_str(), Some(fingerprint.as_str()));
    assert_eq!(verses["maximum_words"], manifest["maximum_words"]);
    assert_eq!(verses["total"], manifest["verses"]);
    assert_eq!(verses["phrase_links"], manifest["postings"]);
    assert_eq!(
        verses["entries"].as_array().unwrap().len() as u64,
        manifest["verses"].as_u64().unwrap()
    );
    assert_eq!(
        fs::metadata(root.join("verse-words.bin")).unwrap().len(),
        verses["word_links"].as_u64().unwrap() * 12
    );
    assert_eq!(
        fs::metadata(root.join("verse-phrases.bin")).unwrap().len(),
        verses["phrase_links"].as_u64().unwrap() * 4
    );
    assert_eq!(
        fs::metadata(root.join("verse-display.bin")).unwrap().len(),
        verses["display_links"].as_u64().unwrap() * 12
    );
    assert_eq!(
        fs::metadata(root.join("verse-order.bin")).unwrap().len(),
        verses["display_links"].as_u64().unwrap() * 8
    );
    assert_eq!(
        fs::metadata(root.join("phrase-children.bin"))
            .unwrap()
            .len(),
        manifest["total"].as_u64().unwrap() * 8
    );
    let children: serde_json::Value = serde_json::from_slice(
        &fs::read(root.join("phrase-children.json"))
            .expect("Prepare subphrase relationships before packaging"),
    )
    .unwrap();
    assert_eq!(children["format"].as_u64(), Some(1));
    assert_eq!(children["fingerprint"], manifest["fingerprint"]);
    assert_eq!(children["total"], manifest["total"]);
    let analysis = root
        .join("occurrences")
        .join(format!("occurrences-v4-{fingerprint}"));
    for length in 1..=32 {
        for prefix in ["words", "exclusive"] {
            assert!(
                fs::metadata(analysis.join(format!("{prefix}-{length}.bin")))
                    .expect("Missing prepared analysis file; run npm run prepare:data")
                    .len()
                    >= 64
            );
        }
    }
    println!("cargo:rerun-if-changed=data/kjv.json");
    println!("cargo:rerun-if-changed=data/precomputed");
}
fn main() {
    #[cfg(feature = "desktop")]
    {
        verify_prepared();
        tauri_build::build();
    }
}
