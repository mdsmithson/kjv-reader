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
    let maximum_words = corpus
        .values()
        .map(|text| {
            text.as_str()
                .unwrap()
                .split(|c: char| !c.is_alphanumeric() && c != '\'')
                .filter(|word| !word.trim_matches('\'').is_empty())
                .count()
        })
        .max()
        .unwrap_or(2) as u64;
    assert_eq!(
        manifest["maximum_words"].as_u64(),
        Some(maximum_words),
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
    assert_eq!(verses["format"].as_u64(), Some(4));
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

    let rollup: serde_json::Value = serde_json::from_slice(
        &fs::read(root.join("phrase-rollup.json"))
            .expect("Prepare equal-count rollups before packaging"),
    )
    .unwrap();
    assert_eq!(rollup["format"].as_u64(), Some(2));
    assert_eq!(rollup["fingerprint"], manifest["fingerprint"]);
    assert_eq!(rollup["total"], manifest["total"]);
    assert_eq!(
        fs::metadata(root.join("phrase-rollup-mask.bin"))
            .unwrap()
            .len(),
        manifest["total"].as_u64().unwrap()
    );
    for name in ["phrase-rollup-ids.bin", "phrase-rollup-groups.bin"] {
        assert_eq!(
            fs::metadata(root.join(name)).unwrap().len(),
            rollup["retained"].as_u64().unwrap() * 4
        );
    }
    let phrase_books: serde_json::Value = serde_json::from_slice(&fs::read(root.join("phrase-books.json")).expect("Prepare phrase book counts before packaging")).unwrap();
    assert_eq!(phrase_books["format"].as_u64(), Some(1));
    assert_eq!(phrase_books["fingerprint"], manifest["fingerprint"]);
    assert_eq!(phrase_books["total"], manifest["total"]);
    assert_eq!(phrase_books["retained"], rollup["retained"]);
    assert_eq!(fs::metadata(root.join("phrase-books-directory.bin")).unwrap().len(), phrase_books["retained"].as_u64().unwrap() * 12);
    assert_eq!(fs::metadata(root.join("phrase-books.bin")).unwrap().len(), phrase_books["links"].as_u64().unwrap() * 8);
    let frequencies: serde_json::Value =
        serde_json::from_slice(&fs::read(root.join("verse-phrase-frequency.json")).unwrap())
            .unwrap();
    assert_eq!(frequencies["format"].as_u64(), Some(3));
    assert_eq!(frequencies["fingerprint"], manifest["fingerprint"]);
    assert_eq!(frequencies["total"], verses["total"]);
    assert_eq!(
        fs::metadata(root.join("verse-phrase-frequency-order.bin"))
            .unwrap()
            .len(),
        frequencies["frequencies"].as_array().unwrap().len() as u64
            * frequencies["total"].as_u64().unwrap()
            * 8
    );
    let search:serde_json::Value=serde_json::from_slice(&fs::read(root.join("verse-search.json")).expect("Prepare verse search data before packaging")).unwrap();
    assert_eq!(search["format"].as_u64(),Some(1)); assert_eq!(search["fingerprint"],manifest["fingerprint"]);
    assert_eq!(search["words"].as_array().unwrap().len() as u64,verses["total"].as_u64().unwrap());
    assert_eq!(search["texts"].as_array().unwrap().len() as u64,verses["total"].as_u64().unwrap());
    let chapters:serde_json::Value=serde_json::from_slice(&fs::read(root.join("chapters.json")).expect("Prepare chapter profiles before packaging")).unwrap();
    assert_eq!(chapters["format"].as_u64(),Some(1)); assert_eq!(chapters["fingerprint"],manifest["fingerprint"]);
    let chapter_count=corpus.keys().map(|reference|reference.rsplit_once(':').unwrap().0).collect::<std::collections::HashSet<_>>().len();
    assert_eq!(chapters["entries"].as_array().unwrap().len(),chapter_count);
    assert_eq!(chapters["sizes"].as_array().unwrap().len(),chapter_count);
    for (id,size) in chapters["sizes"].as_array().unwrap().iter().enumerate(){assert_eq!(fs::metadata(root.join("chapter-profiles").join(format!("{id}.json"))).unwrap().len(),size.as_u64().unwrap());}
    let reader: serde_json::Value = serde_json::from_slice(
        &fs::read(root.join("reader-mentions.json"))
            .expect("Prepare reader highlight metadata before packaging"),
    )
    .unwrap();
    assert_eq!(reader["format"].as_u64(), Some(2));
    assert_eq!(reader["fingerprint"], manifest["fingerprint"]);
    assert_eq!(reader["total"], verses["word_links"]);
    assert_eq!(reader["phrases"], verses["display_links"]);
    assert_eq!(
        fs::metadata(root.join("reader-mentions.bin"))
            .unwrap()
            .len(),
        verses["word_links"].as_u64().unwrap()
    );
    assert_eq!(
        fs::metadata(root.join("reader-phrase-counts.bin"))
            .unwrap()
            .len(),
        verses["display_links"].as_u64().unwrap() * 4
    );
    let analysis = root
        .join("occurrences")
        .join(format!("occurrences-v5-{fingerprint}"));
    for length in 1..=32 {
        use std::io::Read;
        let mut file=fs::File::open(analysis.join(format!("words-{length}.bin"))).unwrap();
        let mut header=[0u8;64]; file.read_exact(&mut header).unwrap();
        assert_eq!(&header[..8], b"KJVNGRM5");
        assert_eq!(u32::from_le_bytes(header[8..12].try_into().unwrap()),5);
        let records=u64::from_le_bytes(header[48..56].try_into().unwrap());
        let frequencies=u64::from_le_bytes(header[56..64].try_into().unwrap());
        assert_eq!(file.metadata().unwrap().len(),64 + records * 4 * (length as u64 + 10) + frequencies * 4);
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
