//! Compact, saved phrase spans for whole-word and partial phrase lookup.
use super::*;
pub(super) fn prepare(root: &Path) -> io::Result<()> {
    let manifest: Manifest = read_json(&root.join("manifest.json"))?;
    if read_json::<ChildrenHeader>(&root.join("phrase-search.json")).is_ok_and(|header| {
        header.format == 1
            && header.fingerprint == manifest.fingerprint
            && header.total == manifest.total
    }) && fs::metadata(root.join("phrase-search.bin"))
        .is_ok_and(|m| m.len() == manifest.total as u64 * 8)
    {
        return Ok(());
    }
    let temporary = root.join("phrase-search.tmp");
    let mut input = BufReader::new(File::open(root.join("phrases.bin"))?);
    let mut output = BufWriter::new(File::create(&temporary)?);
    for _ in 0..manifest.total {
        let record = Record::read(&mut input)?;
        output.write_all(&record.token.to_le_bytes())?;
        output.write_all(&(record.words as u32).to_le_bytes())?;
    }
    output.flush()?;
    drop(output);
    fs::rename(temporary, root.join("phrase-search.bin"))?;
    json_file(
        &root.join("phrase-search.json"),
        &ChildrenHeader {
            format: 1,
            fingerprint: manifest.fingerprint,
            total: manifest.total,
        },
    )
}
pub(super) fn read_spans(root: &Path, manifest: &Manifest, tokens: &[u32]) -> io::Result<Vec<u32>> {
    let header: ChildrenHeader = read_json(&root.join("phrase-search.json"))?;
    let spans = u32_file(&root.join("phrase-search.bin"))?;
    if header.format != 1
        || header.fingerprint != manifest.fingerprint
        || header.total != manifest.total
        || spans.len() != manifest.total * 2
        || spans.as_chunks::<2>().0.iter().any(|span| {
            span[1] < 2
                || span[1] > manifest.maximum_words as u32
                || span[0] as usize + span[1] as usize > tokens.len()
        })
    {
        return Err(invalid("Incomplete saved phrase search index"));
    }
    Ok(spans)
}
impl PreparedPhrases {
    fn search_ids(&self, text: &str, partial: bool) -> io::Result<Arc<Vec<u32>>> {
        let query = crate::text::words(text);
        let key = format!("{partial}:{}", query.join(" "));
        if let Some((_, ids)) = self
            .search_cache
            .lock()
            .map_err(|_| invalid("Phrase search cache failed"))?
            .iter()
            .find(|(saved, _)| saved == &key)
        {
            return Ok(Arc::clone(ids));
        }
        let mut ids = Vec::new();
        if !query.is_empty() && query.len() <= self.manifest.maximum_words as usize {
            let accepted: Vec<Vec<bool>> = query
                .iter()
                .map(|term| {
                    self.dictionary
                        .iter()
                        .map(|word| {
                            if partial {
                                word.contains(term)
                            } else {
                                word == term
                            }
                        })
                        .collect()
                })
                .collect();
            // Mark matching token starts once, then test every saved phrase span
            // in constant time. A span cannot cross a verse boundary.
            let mut prefix = vec![0u32; self.tokens.len() + 1];
            for start in 0..self.tokens.len() {
                let matches = start + query.len() <= self.tokens.len()
                    && accepted
                        .iter()
                        .enumerate()
                        .all(|(i, allowed)| allowed[self.tokens[start + i] as usize]);
                prefix[start + 1] = prefix[start] + u32::from(matches);
            }
            for (id, span) in self.search_spans.as_chunks::<2>().0.iter().enumerate() {
                let (start, length) = (span[0] as usize, span[1] as usize);
                if length >= query.len() && prefix[start + length - query.len() + 1] > prefix[start]
                {
                    ids.push(id as u32);
                }
            }
        }
        let ids = Arc::new(ids);
        let mut cache = self
            .search_cache
            .lock()
            .map_err(|_| invalid("Phrase search cache failed"))?;
        if cache.len() >= 2 {
            cache.remove(0);
        }
        cache.push((key, Arc::clone(&ids)));
        Ok(ids)
    }
    pub(super) fn search_page(
        &self,
        text: &str,
        partial: bool,
        offset: usize,
        filters: &PhraseFilters,
    ) -> io::Result<SavedPhrasePage> {
        let ids = self.search_ids(text, partial)?;
        let restricted = filters.words.is_some()
            || filters.letters.is_some()
            || filters.occurrences.is_some()
            || filters.books.is_some();
        let allowed = restricted.then(|| {
            let mut allowed = vec![false; self.manifest.total];
            for group in self
                .manifest
                .groups
                .iter()
                .filter(|group| group.matches(filters))
            {
                for &id in &self.ids[group.start..group.start + group.total] {
                    allowed[id as usize] = true;
                }
            }
            allowed
        });
        let matches = || {
            ids.iter()
                .copied()
                .filter(|&id| allowed.as_ref().is_none_or(|allowed| allowed[id as usize]))
        };
        let total = matches().count();
        let mut file = File::open(self.root.join("phrases.bin"))?;
        let entries = matches()
            .skip(offset)
            .take(PAGE_SIZE)
            .map(|id| self.summary(self.record(&mut file, id as usize)?))
            .collect::<io::Result<Vec<_>>>()?;
        Ok(SavedPhrasePage {
            total,
            entries,
            persisted_lengths: (2..=self.manifest.maximum_words).collect(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn phrase_search_matches_whole_words_parts_filters_pages_and_saved_restarts() {
        let root = std::env::temp_dir().join(format!(
            "kjv-phrase-search-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let source: BTreeMap<String, String> = (1..=71)
            .map(|i| {
                (
                    format!("Genesis 1:{i}"),
                    format!("God word{i} godhead alpha"),
                )
            })
            .chain([("Exodus 1:1".into(), "beta god's godliness".into())])
            .collect();
        let bible = Bible::from_json(&serde_json::to_string(&source).unwrap()).unwrap();
        let index = OccurrenceIndex::from_passages(bible.located_passages(), &root.join("cache"));
        let saved = root.join("saved");
        index.prepare_phrases(&saved, 4).unwrap();
        let mut oracle = BTreeMap::<String, (usize, usize)>::new();
        for (_, text) in bible.passages() {
            let tokens = crate::text::words(text);
            for length in 2..=tokens.len().min(4) {
                for window in tokens.windows(length) {
                    let entry = oracle.entry(window.join(" ")).or_default();
                    entry.0 += 1;
                    entry.1 = length;
                }
            }
        }
        let verify = |store: &PreparedPhrases| {
            for (text, partial, count, length) in [
                ("GOD,", false, None, None),
                ("god", true, None, None),
                ("alpha beta", false, None, None),
                ("godhead alpha", false, Some(71), Some(2)),
                ("od", false, None, None),
                ("od", true, None, None),
                ("!!!", false, None, None),
                ("missing", false, None, None),
            ] {
                let query = crate::text::words(text);
                let expected: Vec<_> = oracle
                    .iter()
                    .filter(|(phrase, (n, l))| {
                        let tokens = crate::text::words(phrase);
                        count.is_none_or(|count| *n == count)
                            && length.is_none_or(|length| *l == length)
                            && !query.is_empty()
                            && tokens.windows(query.len()).any(|window| {
                                window.iter().zip(&query).all(|(word, term)| {
                                    if partial {
                                        word.contains(term)
                                    } else {
                                        word == term
                                    }
                                })
                            })
                    })
                    .map(|(phrase, _)| phrase.clone())
                    .collect();
                let filters = PhraseFilters {
                    text: Some(text.into()),
                    partial,
                    occurrences: count.map(|n| n as u32),
                    words: length.map(|n| n as u16),
                    ..Default::default()
                };
                for offset in [0, 50, 100, 999] {
                    let page = store.page(offset, &filters).unwrap();
                    assert_eq!(page.total, expected.len());
                    assert_eq!(
                        page.entries
                            .iter()
                            .map(|e| e.phrase.clone())
                            .collect::<Vec<_>>(),
                        expected
                            .iter()
                            .skip(offset)
                            .take(PAGE_SIZE)
                            .cloned()
                            .collect::<Vec<_>>()
                    );
                }
            }
        };
        verify(&PreparedPhrases::open(&saved, &bible).unwrap());
        let stamp = fs::metadata(saved.join("phrase-search.bin"))
            .unwrap()
            .modified()
            .unwrap();
        index.prepare_phrases(&saved, 4).unwrap();
        assert_eq!(
            stamp,
            fs::metadata(saved.join("phrase-search.bin"))
                .unwrap()
                .modified()
                .unwrap()
        );
        verify(&PreparedPhrases::open(&saved, &bible).unwrap());
        fs::write(saved.join("phrase-search.bin"), [0]).unwrap();
        assert!(PreparedPhrases::open(&saved, &bible).is_err());
        index.prepare_phrases(&saved, 4).unwrap();
        verify(&PreparedPhrases::open(&saved, &bible).unwrap());
        fs::remove_dir_all(root).unwrap();
    }
}
