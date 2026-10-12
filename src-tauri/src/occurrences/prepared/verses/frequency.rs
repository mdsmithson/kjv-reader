//! Saved per-verse histograms and complete ascending/descending frequency orders.
use super::*;
#[derive(Default, Serialize, Deserialize)]
pub(super) struct FrequencyIndex {
    format: u32,
    fingerprint: String,
    total: usize,
    frequencies: Vec<usize>,
    counts: Vec<BTreeMap<usize, usize>>,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Direction {
    Asc,
    Desc,
}
#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FrequencyKind {
    #[default]
    Words,
    Phrases,
}
#[derive(Clone, Deserialize)]
pub struct VerseFrequencySort {
    #[serde(default)]
    pub kind: FrequencyKind,
    pub frequency: usize,
    pub direction: Direction,
}
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerseFrequencyQuery {
    pub book: Option<String>,
    #[serde(default)]
    pub offset: usize,
    #[serde(default)]
    pub filters: VerseFilters,
    #[serde(default)]
    pub frequencies: Vec<usize>,
    #[serde(default)]
    pub phrase_frequencies: Vec<usize>,
    pub sort: Option<VerseFrequencySort>,
}
pub(super) fn read(root: &Path, manifest: &VerseManifest) -> io::Result<FrequencyIndex> {
    read_index(root, manifest, false)
}
pub(super) fn read_phrases(root: &Path, manifest: &VerseManifest) -> io::Result<FrequencyIndex> {
    read_index(root, manifest, true)
}
fn read_index(root: &Path, manifest: &VerseManifest, phrases: bool) -> io::Result<FrequencyIndex> {
    let prefix = if phrases {
        "verse-phrase-frequency"
    } else {
        "verse-frequency"
    };
    let index: FrequencyIndex = read_json(&root.join(format!("{prefix}.json")))?;
    if index.format != if phrases { 3 } else { 1 }
        || index.fingerprint != manifest.fingerprint
        || index.total != manifest.total
        || index.counts.len() != manifest.total
        || !index.frequencies.windows(2).all(|pair| pair[0] < pair[1])
        || index
            .counts
            .iter()
            .zip(&manifest.entries)
            .any(|(counts, verse)| {
                counts.values().sum::<usize>()
                    != if phrases {
                        verse.summary.phrases
                    } else {
                        verse.summary.words
                    }
            })
        || fs::metadata(root.join(format!("{prefix}-order.bin")))?.len()
            != index.frequencies.len() as u64 * index.total as u64 * 8
    {
        return Err(invalid("Incomplete verse frequency data"));
    }
    Ok(index)
}
pub(super) fn prepare_phrases(root: &Path) -> io::Result<()> {
    let mut manifest: VerseManifest = read_json(&root.join("verses.json"))?;
    for entry in &mut manifest.entries {
        entry.summary.phrases = entry.display_phrases;
    }
    if read_phrases(root, &manifest).is_ok() {
        return Ok(());
    }
    let phrases: Manifest = read_json(&root.join("manifest.json"))?;
    let mut records = BufReader::new(File::open(root.join("phrases.bin"))?);
    let mut postings = BufReader::new(File::open(root.join("postings.bin"))?);
    let mut counts = vec![BTreeMap::new(); manifest.total];
    let mask = fs::read(root.join("phrase-rollup-mask.bin"))?;
    let mut frequencies = std::collections::BTreeSet::new();
    if mask.len() != phrases.total {
        return Err(invalid("Invalid phrase rollup mask"));
    }
    for &visible in &mask {
        let record = Record::read(&mut records)?;
        if visible == 1 {
            frequencies.insert(record.occurrences as usize);
        }
        for _ in 0..record.verses {
            let mut bytes = [0u8; 4];
            postings.read_exact(&mut bytes)?;
            let verse = u32::from_le_bytes(bytes) as usize;
            if visible != 1 {
                continue;
            }
            *counts
                .get_mut(verse)
                .ok_or_else(|| invalid("Invalid phrase verse posting"))?
                .entry(record.occurrences as usize)
                .or_insert(0) += 1;
        }
    }
    let index = FrequencyIndex {
        format: 3,
        fingerprint: manifest.fingerprint,
        total: manifest.total,
        frequencies: frequencies.into_iter().collect(),
        counts,
    };
    write_index(root, "verse-phrase-frequency", &index)
}
pub(super) fn prepare(root: &Path, bible: &Bible) -> io::Result<()> {
    let manifest: VerseManifest = read_json(&root.join("verses.json"))?;
    if read(root, &manifest).is_ok() {
        return Ok(());
    }
    let words = if root.join("words.json").exists() {
        read_json::<crate::word_stats::WordStatistics>(&root.join("words.json"))?
    } else {
        crate::word_stats::WordStatistics::new(bible)
    };
    let mut frequencies = std::collections::BTreeSet::new();
    let mut counts = Vec::with_capacity(manifest.total);
    for verse in &manifest.entries {
        let mut histogram = BTreeMap::new();
        for word in crate::text::words(&verse.summary.verse.text) {
            let count = words
                .find_normalized(&word)
                .ok_or_else(|| invalid("Missing word frequency"))?
                .count;
            *histogram.entry(count).or_insert(0) += 1;
            frequencies.insert(count);
        }
        counts.push(histogram);
    }
    let index = FrequencyIndex {
        format: 1,
        fingerprint: manifest.fingerprint,
        total: manifest.total,
        frequencies: frequencies.into_iter().collect(),
        counts,
    };
    write_index(root, "verse-frequency", &index)
}
fn write_index(root: &Path, prefix: &str, index: &FrequencyIndex) -> io::Result<()> {
    let temporary = root.join(format!("{prefix}-order.tmp"));
    let mut output = BufWriter::new(File::create(&temporary)?);
    for &frequency in &index.frequencies {
        for descending in [false, true] {
            let mut ids: Vec<_> = (0..index.total as u32).collect();
            ids.sort_unstable_by(|&a, &b| {
                let left = index.counts[a as usize]
                    .get(&frequency)
                    .copied()
                    .unwrap_or(0);
                let right = index.counts[b as usize]
                    .get(&frequency)
                    .copied()
                    .unwrap_or(0);
                (if descending {
                    right.cmp(&left)
                } else {
                    left.cmp(&right)
                })
                .then(a.cmp(&b))
            });
            for id in ids {
                output.write_all(&id.to_le_bytes())?;
            }
        }
    }
    output.flush()?;
    drop(output);
    fs::rename(temporary, root.join(format!("{prefix}-order.bin")))?;
    json_file(&root.join(format!("{prefix}.json")), index)
}
impl PreparedVerses {
    pub fn frequency_page(&self, query: &VerseFrequencyQuery) -> Result<VersePage, String> {
        if query.frequencies.len() + query.phrase_frequencies.len() > 5
            || query.frequencies.contains(&0)
            || query.phrase_frequencies.contains(&0)
            || query
                .phrase_frequencies
                .iter()
                .collect::<HashSet<_>>()
                .len()
                != query.phrase_frequencies.len()
            || query.frequencies.iter().collect::<HashSet<_>>().len() != query.frequencies.len()
        {
            return Err("Add up to five different, positive frequencies per kind.".into());
        }
        if query.sort.as_ref().is_some_and(|sort| {
            !(if matches!(sort.kind, FrequencyKind::Phrases) {
                &query.phrase_frequencies
            } else {
                &query.frequencies
            })
            .contains(&sort.frequency)
        }) {
            return Err("Choose an added frequency column to sort.".into());
        }
        let (start, end) = match query.book.as_deref() {
            None => (0, self.manifest.total),
            Some(book) => *self
                .books
                .get(book)
                .ok_or_else(|| format!("Book not found: {book}"))?,
        };
        let run = || -> io::Result<VersePage> {
            let mut ids: Vec<u32> = (start as u32..end as u32).collect();
            if let Some(sort) = &query.sort {
                let (index, prefix) = if matches!(sort.kind, FrequencyKind::Phrases) {
                    (&self.phrase_frequencies, "verse-phrase-frequency")
                } else {
                    (&self.frequencies, "verse-frequency")
                };
                if let Ok(group) = index.frequencies.binary_search(&sort.frequency) {
                    let direction = usize::from(matches!(sort.direction, Direction::Desc));
                    let mut input =
                        BufReader::new(File::open(self.root.join(format!("{prefix}-order.bin")))?);
                    input.seek(SeekFrom::Start(
                        ((group * 2 + direction) * self.manifest.total * 4) as u64,
                    ))?;
                    ids = (0..self.manifest.total)
                        .map(|_| {
                            let mut bytes = [0u8; 4];
                            input.read_exact(&mut bytes)?;
                            Ok(u32::from_le_bytes(bytes))
                        })
                        .collect::<io::Result<Vec<_>>>()?;
                    if ids.iter().any(|&id| id as usize >= self.manifest.total) {
                        return Err(invalid("Invalid verse frequency order"));
                    }
                    ids.retain(|&id| (start..end).contains(&(id as usize)));
                }
            }
            let text_query=search::VerseSearchIndex::query(&query.filters);
            ids.retain(|&id| {
                self.search.matches(id as usize,&text_query) && query
                    .filters
                    .matches(&self.manifest.entries[id as usize].summary)
            });
            let total = ids.len();
            let entries = ids
                .into_iter()
                .skip(query.offset)
                .take(PAGE_SIZE)
                .map(|id| {
                    let mut summary = self.manifest.entries[id as usize].summary.clone();
                    summary.frequency_counts = query
                        .frequencies
                        .iter()
                        .map(|frequency| {
                            self.frequencies.counts[id as usize]
                                .get(frequency)
                                .copied()
                                .unwrap_or(0)
                        })
                        .collect();
                    summary.phrase_frequency_counts = query
                        .phrase_frequencies
                        .iter()
                        .map(|frequency| {
                            self.phrase_frequencies.counts[id as usize]
                                .get(frequency)
                                .copied()
                                .unwrap_or(0)
                        })
                        .collect();
                    summary
                })
                .collect();
            Ok(VersePage { total, entries })
        };
        run().map_err(|e| format!("Unable to read verse frequency columns: {e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn global_phrase_histograms_include_hidden_children_and_deduplicate_repetitions() {
        let root = std::env::temp_dir().join(format!(
            "kjv-phrase-frequency-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let bible = Bible::from_json(
            r#"{"Genesis 1:1":"a b a b","Genesis 1:2":"a b","Exodus 1:1":"a b c"}"#,
        )
        .unwrap();
        let index = OccurrenceIndex::from_passages(bible.located_passages(), &root.join("cache"));
        let saved = root.join("saved");
        index.prepare_phrases(&saved, 4).unwrap();
        let phrases = PreparedPhrases::open(&saved, &bible).unwrap();
        phrases.prepare_verses(&bible).unwrap();
        let verify = |verses: &PreparedVerses| {
            let query = |value| serde_json::from_value::<VerseFrequencyQuery>(value).unwrap();
            let page = verses
                .frequency_page(&query(
                    serde_json::json!({"frequencies":[1],"phraseFrequencies":[1,4]}),
                ))
                .unwrap();
            assert_eq!(
                page.entries
                    .iter()
                    .map(|entry| entry.phrase_frequency_counts.clone())
                    .collect::<Vec<_>>(),
                vec![vec![1, 1], vec![0, 1], vec![1, 1]]
            );
            for (direction, expected) in [
                ("desc", vec![("Genesis", 1), ("Exodus", 1), ("Genesis", 2)]),
                ("asc", vec![("Genesis", 2), ("Genesis", 1), ("Exodus", 1)]),
            ] {
                let page=verses.frequency_page(&query(serde_json::json!({"phraseFrequencies":[1],"sort":{"kind":"phrases","frequency":1,"direction":direction}}))).unwrap();
                assert_eq!(
                    page.entries
                        .iter()
                        .map(|entry| (entry.verse.book.as_str(), entry.verse.number))
                        .collect::<Vec<_>>(),
                    expected
                );
            }
            let page=verses.frequency_page(&query(serde_json::json!({"book":"Genesis","offset":1,"phraseFrequencies":[1],"sort":{"kind":"phrases","frequency":1,"direction":"desc"}}))).unwrap();
            assert_eq!(page.total, 2);
            assert_eq!(page.entries[0].verse.number, 2);
            for value in [
                serde_json::json!({"frequencies":[1,2,3],"phraseFrequencies":[1,2,3]}),
                serde_json::json!({"phraseFrequencies":[0]}),
                serde_json::json!({"phraseFrequencies":[1,1]}),
                serde_json::json!({"phraseFrequencies":[1],"sort":{"frequency":1,"direction":"asc"}}),
            ] {
                assert!(verses.frequency_page(&query(value)).is_err());
            }
        };
        verify(&PreparedVerses::open(&saved, &bible, &phrases).unwrap());
        let stamp = fs::metadata(saved.join("verse-phrase-frequency-order.bin"))
            .unwrap()
            .modified()
            .unwrap();
        phrases.prepare_verses(&bible).unwrap();
        assert_eq!(
            stamp,
            fs::metadata(saved.join("verse-phrase-frequency-order.bin"))
                .unwrap()
                .modified()
                .unwrap()
        );
        verify(&PreparedVerses::open(&saved, &bible, &phrases).unwrap());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn saved_frequency_columns_count_repetitions_sort_before_paging_and_reuse() {
        let root = std::env::temp_dir().join(format!(
            "kjv-frequency-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let bible=Bible::from_json(r#"{"Genesis 1:1":"a a once","Genesis 1:2":"b a twice","Exodus 1:1":"b twice unique rare"}"#).unwrap();
        let index = OccurrenceIndex::from_passages(bible.located_passages(), &root.join("cache"));
        let saved = root.join("saved");
        index.prepare_phrases(&saved, 4).unwrap();
        let phrases = PreparedPhrases::open(&saved, &bible).unwrap();
        phrases.prepare_verses(&bible).unwrap();
        let verify = |verses: &PreparedVerses| {
            let query = |value| serde_json::from_value::<VerseFrequencyQuery>(value).unwrap();
            let page = verses
                .frequency_page(&query(serde_json::json!({"frequencies":[1,2,3]})))
                .unwrap();
            assert_eq!(
                page.entries
                    .iter()
                    .map(|verse| verse.frequency_counts.clone())
                    .collect::<Vec<_>>(),
                vec![vec![1, 0, 2], vec![0, 2, 1], vec![2, 2, 0]]
            );
            for (direction, expected) in [
                ("asc", vec!["Genesis", "Genesis", "Exodus"]),
                ("desc", vec!["Genesis", "Exodus", "Genesis"]),
            ] {
                let page=verses.frequency_page(&query(serde_json::json!({"frequencies":[2],"sort":{"frequency":2,"direction":direction}}))).unwrap();
                assert_eq!(
                    page.entries
                        .iter()
                        .map(|verse| verse.verse.book.as_str())
                        .collect::<Vec<_>>(),
                    expected
                );
                assert_eq!(
                    page.entries[0].verse.number,
                    if direction == "asc" { 1 } else { 2 }
                );
            }
            let page=verses.frequency_page(&query(serde_json::json!({"book":"Genesis","offset":1,"frequencies":[3],"sort":{"frequency":3,"direction":"desc"}}))).unwrap();
            assert_eq!(page.total, 2);
            assert_eq!(page.entries[0].verse.number, 2);
            let page=verses.frequency_page(&query(serde_json::json!({"filters":{"words":4},"frequencies":[1],"sort":{"frequency":1,"direction":"desc"}}))).unwrap();
            assert_eq!(page.total, 1);
            assert_eq!(page.entries[0].frequency_counts, vec![2]);
            let page=verses.frequency_page(&query(serde_json::json!({"frequencies":[999],"sort":{"frequency":999,"direction":"desc"}}))).unwrap();
            assert!(page
                .entries
                .iter()
                .all(|entry| entry.frequency_counts == vec![0]));
            for columns in [vec![0], vec![1, 1], vec![1, 2, 3, 4, 5, 6]] {
                assert!(verses
                    .frequency_page(&query(serde_json::json!({"frequencies":columns})))
                    .is_err());
            }
            assert!(verses
                .frequency_page(&query(
                    serde_json::json!({"frequencies":[1],"sort":{"frequency":2,"direction":"desc"}})
                ))
                .is_err());
        };
        verify(&PreparedVerses::open(&saved, &bible, &phrases).unwrap());
        let stamp = fs::metadata(saved.join("verse-frequency-order.bin"))
            .unwrap()
            .modified()
            .unwrap();
        phrases.prepare_verses(&bible).unwrap();
        assert_eq!(
            stamp,
            fs::metadata(saved.join("verse-frequency-order.bin"))
                .unwrap()
                .modified()
                .unwrap()
        );
        verify(&PreparedVerses::open(&saved, &bible, &phrases).unwrap());
        fs::remove_dir_all(root).unwrap();
    }
}
