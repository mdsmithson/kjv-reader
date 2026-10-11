//! Persisted catalogue after rolling equal-count segments into maximal equal-count phrases.
use super::*;
#[derive(Serialize, Deserialize)]
struct Header {
    format: u32,
    fingerprint: String,
    total: usize,
    retained: usize,
    groups: Vec<Group>,
}
pub(super) struct VisibleCatalogue {
    pub ids: Vec<u32>,
    pub mask: Vec<bool>,
    pub groups: Vec<Group>,
    pub group_ids: Vec<u32>,
}
pub(super) fn read(root: &Path, manifest: &Manifest) -> io::Result<VisibleCatalogue> {
    let header: Header = read_json(&root.join("phrase-rollup.json"))?;
    let bytes = fs::read(root.join("phrase-rollup-mask.bin"))?;
    let ids = u32_file(&root.join("phrase-rollup-ids.bin"))?;
    let group_ids = u32_file(&root.join("phrase-rollup-groups.bin"))?;
    if header.format != 2
        || header.fingerprint != manifest.fingerprint
        || header.total != manifest.total
        || bytes.len() != manifest.total
        || bytes.iter().any(|&b| b > 1)
        || ids.len() != header.retained
        || group_ids.len() != header.retained
        || !ids.windows(2).all(|pair| pair[0] < pair[1])
        || ids
            .iter()
            .any(|&id| id as usize >= manifest.total || bytes[id as usize] != 1)
        || bytes.iter().filter(|&&b| b == 1).count() != header.retained
        || header.groups.iter().map(|g| g.total).sum::<usize>() != header.retained
        || header.groups.iter().any(|g| {
            g.start
                .checked_add(g.total)
                .is_none_or(|end| end > group_ids.len())
        })
        || group_ids
            .iter()
            .any(|&id| id as usize >= manifest.total || bytes[id as usize] != 1)
    {
        return Err(invalid("Incomplete persisted phrase rollup"));
    }
    Ok(VisibleCatalogue {
        ids,
        mask: bytes.into_iter().map(|b| b == 1).collect(),
        groups: header.groups,
        group_ids,
    })
}
pub(super) fn prepare(root: &Path) -> io::Result<()> {
    let manifest: Manifest = read_json(&root.join("manifest.json"))?;
    if read(root, &manifest).is_ok() {
        return Ok(());
    }
    let mut input = BufReader::new(File::open(root.join("phrases.bin"))?);
    let mut occurrences = Vec::with_capacity(manifest.total);
    for _ in 0..manifest.total {
        occurrences.push(Record::read(&mut input)?.occurrences);
    }
    let children = u32_file(&root.join("phrase-children.bin"))?;
    let mut mask = vec![1u8; manifest.total];
    for (parent, pair) in children.as_chunks::<2>().0.iter().enumerate() {
        for &child in pair {
            if child != u32::MAX {
                if child as usize >= manifest.total {
                    return Err(invalid("Invalid phrase rollup child"));
                }
                if occurrences[parent] == occurrences[child as usize] {
                    mask[child as usize] = 0;
                }
            }
        }
    }
    let raw_ids = u32_file(&root.join("groups.bin"))?;
    let mut grouped = Vec::new();
    let mut groups = Vec::new();
    for group in &manifest.groups {
        let start = grouped.len();
        grouped.extend(
            raw_ids[group.start..group.start + group.total]
                .iter()
                .copied()
                .filter(|&id| mask[id as usize] == 1),
        );
        if grouped.len() > start {
            groups.push(Group {
                start,
                total: grouped.len() - start,
                ..group.clone()
            });
        }
    }
    for (name, values) in [
        (
            "phrase-rollup-ids",
            (0..manifest.total as u32)
                .filter(|&id| mask[id as usize] == 1)
                .collect::<Vec<_>>(),
        ),
        ("phrase-rollup-groups", grouped),
    ] {
        let path = root.join(format!("{name}.tmp"));
        let mut output = BufWriter::new(File::create(&path)?);
        for id in values {
            output.write_all(&id.to_le_bytes())?;
        }
        output.flush()?;
        drop(output);
        fs::rename(path, root.join(format!("{name}.bin")))?;
    }
    let retained = mask.iter().filter(|&&b| b == 1).count();
    fs::write(root.join("phrase-rollup-mask.tmp"), &mask)?;
    fs::rename(
        root.join("phrase-rollup-mask.tmp"),
        root.join("phrase-rollup-mask.bin"),
    )?;
    json_file(
        &root.join("phrase-rollup.json"),
        &Header {
            format: 2,
            fingerprint: manifest.fingerprint,
            total: manifest.total,
            retained,
            groups,
        },
    )?;
    println!(
        "Persisted {retained} phrases after equal-count rollup ({} segments omitted)",
        manifest.total - retained
    );
    Ok(())
}
#[cfg(test)]
pub(crate) fn oracle(bible: &Bible, maximum: usize) -> HashSet<String> {
    let mut counts = BTreeMap::<Vec<String>, usize>::new();
    for (_, text) in bible.passages() {
        let tokens = crate::text::words(text);
        for length in 2..=maximum.min(tokens.len()) {
            for window in tokens.windows(length) {
                *counts.entry(window.to_vec()).or_default() += 1;
            }
        }
    }
    counts
        .iter()
        .filter(|(phrase, count)| {
            !counts.iter().any(|(parent, n)| {
                n == *count
                    && parent.len() > phrase.len()
                    && parent
                        .windows(phrase.len())
                        .any(|window| window == phrase.as_slice())
            })
        })
        .map(|(phrase, _)| phrase.join(" "))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repeated_equal_count_fragments_roll_up_but_more_frequent_parts_survive() {
        let root = std::env::temp_dir().join(format!(
            "kjv-equal-repeat-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let bible=Bible::from_json(r#"{"Genesis 1:1":"prefix band of iron and brass suffix","Genesis 1:2":"other band of iron and brass ending","Exodus 1:1":"iron and brass"}"#).unwrap();
        let index = OccurrenceIndex::from_passages(bible.located_passages(), &root.join("cache"));
        let saved = root.join("pack");
        index.prepare_phrases(&saved, 7).unwrap();
        let store = PreparedPhrases::open(&saved, &bible).unwrap();
        let expected = oracle(&bible, 7);
        let page = store.page(0, &PhraseFilters::default()).unwrap();
        assert_eq!(page.total, expected.len());
        assert_eq!(
            page.entries
                .iter()
                .map(|entry| entry.phrase.clone())
                .collect::<HashSet<_>>(),
            expected
        );
        assert!(expected.contains("band of iron and brass"));
        assert!(expected.contains("iron and brass"));
        assert!(!expected.contains("band of iron"));
        assert!(!expected.contains("and brass"));
        assert_eq!(
            store
                .detail(&bible, "band of iron and brass", 0)
                .unwrap()
                .occurrences,
            2
        );
        assert_eq!(
            store
                .detail(&bible, "iron and brass", 0)
                .unwrap()
                .occurrences,
            3
        );
        assert!(store
            .page(
                0,
                &PhraseFilters {
                    text: Some("band of iron".into()),
                    occurrences: Some(2),
                    ..Default::default()
                }
            )
            .unwrap()
            .entries
            .iter()
            .all(|entry| entry.phrase == "band of iron and brass"));
        store.prepare_verses(&bible).unwrap();
        let verses = PreparedVerses::open(&saved, &bible, &store).unwrap();
        let detail = verses.detail(&store, "Genesis", 1, 1, 0).unwrap();
        assert_eq!(detail.summary.phrases, 3);
        assert_eq!(detail.phrase_results.total, 3);
        let contents = store
            .contents(
                "band of iron and brass",
                &crate::word_stats::WordStatistics::new(&bible),
            )
            .unwrap();
        assert_eq!(
            contents
                .subphrase_results
                .entries
                .iter()
                .map(|entry| entry.phrase.as_str())
                .collect::<Vec<_>>(),
            vec!["iron and brass"]
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn persisted_rollup_is_global_keeps_repetitions_and_reuses_complete_indexes() {
        let root = std::env::temp_dir().join(format!(
            "kjv-rollup-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let bible = Bible::from_json(r#"{"Genesis 1:1":"a b c d e","Exodus 1:1":"a b"}"#).unwrap();
        let index = OccurrenceIndex::from_passages(bible.located_passages(), &root.join("cache"));
        let saved = root.join("pack");
        index.prepare_phrases(&saved, 4).unwrap();
        let verify = |store: &PreparedPhrases| {
            let page = store.page(0, &PhraseFilters::default()).unwrap();
            assert_eq!(page.total, 3);
            assert_eq!(
                page.entries
                    .iter()
                    .map(|entry| entry.phrase.as_str())
                    .collect::<Vec<_>>(),
                vec!["a b", "a b c d", "b c d e"]
            );
            assert_eq!(
                store.page(1, &PhraseFilters::default()).unwrap().entries[0].phrase,
                "a b c d"
            );
            let page = store
                .page(
                    0,
                    &PhraseFilters {
                        occurrences: Some(1),
                        words: Some(3),
                        ..Default::default()
                    },
                )
                .unwrap();
            assert_eq!(page.total, 0);
            let page = store
                .page(
                    0,
                    &PhraseFilters {
                        text: Some("c d".into()),
                        ..Default::default()
                    },
                )
                .unwrap();
            assert_eq!(page.total, 2);
            assert!(page.entries.iter().all(|entry| entry.words == 4));
            let stats = crate::word_stats::WordStatistics::new(&bible);
            let contents = store.contents("a b c d", &stats).unwrap();
            assert_eq!(contents.subphrase_results.total, 1);
            assert_eq!(contents.subphrase_results.entries[0].phrase, "a b");
        };
        let store = PreparedPhrases::open(&saved, &bible).unwrap();
        verify(&store);
        store.prepare_verses(&bible).unwrap();
        let verses = PreparedVerses::open(&saved, &bible, &store).unwrap();
        assert_eq!(verses.page(None, 0).unwrap().entries[0].phrases, 3);
        let query = serde_json::from_value(serde_json::json!({"phraseFrequencies":[1,2]})).unwrap();
        assert_eq!(
            verses.frequency_page(&query).unwrap().entries[0].phrase_frequency_counts,
            vec![2, 1]
        );
        let stamp = fs::metadata(saved.join("phrase-rollup-mask.bin"))
            .unwrap()
            .modified()
            .unwrap();
        index.prepare_phrases(&saved, 4).unwrap();
        assert_eq!(
            stamp,
            fs::metadata(saved.join("phrase-rollup-mask.bin"))
                .unwrap()
                .modified()
                .unwrap()
        );
        verify(&PreparedPhrases::open(&saved, &bible).unwrap());
        fs::write(saved.join("phrase-rollup-ids.bin"), [0]).unwrap();
        assert!(PreparedPhrases::open(&saved, &bible).is_err());
        index.prepare_phrases(&saved, 4).unwrap();
        verify(&PreparedPhrases::open(&saved, &bible).unwrap());
        fs::remove_dir_all(root).unwrap();
    }
}
