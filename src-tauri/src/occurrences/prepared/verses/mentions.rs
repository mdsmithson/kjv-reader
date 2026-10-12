//! Persisted first/final word occurrence flags aligned with saved verse-word links.
use super::*;
#[derive(Serialize, Deserialize)]
struct Header {
    format: u32,
    fingerprint: String,
    total: u64,
    phrases: u64,
}
pub(super) fn read(root: &Path, manifest: &VerseManifest) -> io::Result<(Vec<u8>, Vec<u32>)> {
    let header: Header = read_json(&root.join("reader-mentions.json"))?;
    let flags = fs::read(root.join("reader-mentions.bin"))?;
    let counts = u32_file(&root.join("reader-phrase-counts.bin"))?;
    if header.format != 2
        || header.fingerprint != manifest.fingerprint
        || header.total != manifest.word_links
        || header.phrases != manifest.display_links
        || counts.len() as u64 != manifest.display_links
        || counts.contains(&0)
        || flags.len() as u64 != manifest.word_links
        || flags.iter().any(|&flag| flag > 3)
    {
        return Err(invalid("Incomplete saved reader mention flags"));
    }
    Ok((flags, counts))
}
pub(super) fn prepare(root: &Path) -> io::Result<()> {
    let manifest: VerseManifest = read_json(&root.join("verses.json"))?;
    if read(root, &manifest).is_ok() {
        return Ok(());
    }
    let words = u32_file(&root.join("verse-words.bin"))?;
    if words.len() as u64 != manifest.word_links * 3 {
        return Err(invalid("Incomplete reader word links"));
    }
    let mut bounds = HashMap::<u32, (usize, usize)>::new();
    for (id, word) in words.as_chunks::<3>().0.iter().enumerate() {
        bounds
            .entry(word[2])
            .and_modify(|entry| entry.1 = id)
            .or_insert((id, id));
    }
    let mut flags = vec![0u8; manifest.word_links as usize];
    for (first, last) in bounds.values() {
        flags[*first] |= 1;
        flags[*last] |= 2;
    }
    fs::write(root.join("reader-mentions.tmp"), &flags)?;
    fs::rename(
        root.join("reader-mentions.tmp"),
        root.join("reader-mentions.bin"),
    )?;
    let phrases: Manifest = read_json(&root.join("manifest.json"))?;
    let mut records = BufReader::new(File::open(root.join("phrases.bin"))?);
    let mut occurrences = Vec::with_capacity(phrases.total);
    for _ in 0..phrases.total {
        occurrences.push(Record::read(&mut records)?.occurrences);
    }
    let display = u32_file(&root.join("verse-display.bin"))?;
    if display.len() as u64 != manifest.display_links * 3 {
        return Err(invalid("Invalid reader phrase boundaries"));
    }
    let mut output = BufWriter::new(File::create(root.join("reader-phrase-counts.tmp"))?);
    for phrase in display.as_chunks::<3>().0 {
        let count = occurrences
            .get(phrase[0] as usize)
            .ok_or_else(|| invalid("Invalid reader phrase ID"))?;
        output.write_all(&count.to_le_bytes())?;
    }
    output.flush()?;
    drop(output);
    fs::rename(
        root.join("reader-phrase-counts.tmp"),
        root.join("reader-phrase-counts.bin"),
    )?;
    json_file(
        &root.join("reader-mentions.json"),
        &Header {
            format: 2,
            fingerprint: manifest.fingerprint,
            total: manifest.word_links,
            phrases: manifest.display_links,
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn mentions_and_phrase_counts_reuse_saved_files_and_repair_truncation() {
        let root = std::env::temp_dir().join(format!(
            "kjv-mentions-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let bible = Bible::from_json(r#"{"Genesis 1:1":"a a b","Exodus 1:1":"a b b"}"#).unwrap();
        let index = OccurrenceIndex::from_passages(bible.located_passages(), &root.join("cache"));
        index.prepare_phrases(&root.join("pack"), 3).unwrap();
        let phrases = PreparedPhrases::open(&root.join("pack"), &bible).unwrap();
        phrases.prepare_verses(&bible).unwrap();
        let verses = PreparedVerses::open(&root.join("pack"), &bible, &phrases).unwrap();
        assert_eq!(verses.mention_flags, vec![1, 0, 1, 2, 0, 2]);
        let stamp = fs::metadata(root.join("pack/reader-mentions.bin"))
            .unwrap()
            .modified()
            .unwrap();
        phrases.prepare_verses(&bible).unwrap();
        assert_eq!(
            stamp,
            fs::metadata(root.join("pack/reader-mentions.bin"))
                .unwrap()
                .modified()
                .unwrap()
        );
        fs::write(root.join("pack/reader-phrase-counts.bin"), [0]).unwrap();
        assert!(PreparedVerses::open(&root.join("pack"), &bible, &phrases).is_err());
        phrases.prepare_verses(&bible).unwrap();
        assert!(PreparedVerses::open(&root.join("pack"), &bible, &phrases).is_ok());
        fs::remove_dir_all(root).unwrap();
    }
}
