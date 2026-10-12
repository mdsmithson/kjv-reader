//! Derived alphabetical catalogues of saved phrases; build only from existing caches.
use super::*;
use std::io::BufReader;
const CATALOGUE_MAGIC: &[u8; 8] = b"KJVCAT02";
const CATALOGUE_HEADER: u64 = 48;

#[derive(Clone, Debug, Default, Deserialize)]
pub struct PhraseFilters {
    pub words: Option<u16>,
    pub letters: Option<u32>,
    pub occurrences: Option<u32>,
    pub books: Option<u16>,
    pub text: Option<String>,
    #[serde(default)]
    pub partial: bool,
    #[serde(default)]
    pub exact: bool,
}
impl PhraseFilters {
    fn matches(&self, entry: &SavedPhrase) -> bool {
        self.words.is_none_or(|value| entry.words == value)
            && self.letters.is_none_or(|value| entry.letters == value)
            && self
                .occurrences
                .is_none_or(|value| entry.occurrences == value)
            && self.books.is_none_or(|value| entry.books == value)
            && self.text.as_ref().is_none_or(|text| {
                if text.trim().is_empty() { return true; }
                let query = crate::text::words(text);
                let tokens = crate::text::words(&entry.phrase);
                !query.is_empty() && (!self.exact || tokens == query) && tokens.windows(query.len()).any(|window| window.iter().zip(&query).all(|(word,term)| if self.partial { word.contains(term) } else { word == term }))
            })
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct SavedPhrase {
    pub phrase: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display: Option<String>,
    pub words: u16,
    pub letters: u32,
    pub books: u16,
    pub occurrences: u32,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedPhrasePage {
    pub total: usize,
    pub entries: Vec<SavedPhrase>,
    pub persisted_lengths: Vec<u16>,
}
struct Reader {
    file: BufReader<File>,
    length: u16,
    remaining: u64,
}
fn catalogue_u32(reader: &mut impl Read) -> io::Result<u32> {
    let mut bytes = [0; 4];
    reader.read_exact(&mut bytes)?;
    Ok(u32::from_le_bytes(bytes))
}
impl Reader {
    fn next(&mut self, dictionary: &[String]) -> io::Result<Option<SavedPhrase>> {
        if self.remaining == 0 {
            return Ok(None);
        }
        self.remaining -= 1;
        let letters = catalogue_u32(&mut self.file)?;
        let books = catalogue_u32(&mut self.file)? as u16;
        let occurrences = catalogue_u32(&mut self.file)?;
        let phrase = (0..self.length)
            .map(|_| {
                let token = catalogue_u32(&mut self.file)? as usize;
                dictionary
                    .get(token)
                    .cloned()
                    .ok_or_else(|| invalid("Invalid saved phrase token"))
            })
            .collect::<io::Result<Vec<_>>>()?
            .join(" ");
        Ok(Some(SavedPhrase {
            phrase,
            display: None,
            words: self.length,
            letters,
            books,
            occurrences,
        }))
    }
}
impl OccurrenceIndex {
    fn catalogue_sources(&self) -> io::Result<BTreeMap<u16, Vec<PathBuf>>> {
        let mut sources = BTreeMap::<u16, Vec<PathBuf>>::new();
        let mut directories = vec![self.directory.clone()];
        if !self.directory.exists() {
            return Ok(sources);
        }
        for entry in fs::read_dir(&self.directory)? {
            let entry = entry?;
            if entry.file_type()?.is_dir()
                && entry.file_name().to_string_lossy().starts_with("books-")
            {
                directories.push(entry.path());
            }
        }
        for directory in directories {
            for entry in fs::read_dir(directory)? {
                let path = entry?.path();
                let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
                    continue;
                };
                let length = name
                    .strip_prefix("words-")
                    .or_else(|| name.strip_prefix("exclusive-"))
                    .and_then(|name| name.strip_suffix(".bin"))
                    .and_then(|length| length.parse::<u16>().ok());
                if let Some(length @ 2..=MAX_WORDS) = length {
                    sources.entry(length).or_default().push(path);
                }
            }
        }
        for paths in sources.values_mut() {
            paths.sort();
        }
        Ok(sources)
    }
    fn source_tokens(&self, path: &Path, length: u16) -> io::Result<HashSet<Vec<u32>>> {
        let mut file = File::open(path)?;
        let mut magic = [0; 8];
        file.read_exact(&mut magic)?;
        let exclusive = &magic == b"KJVEXC01";
        let (start, records, record_stride) = if exclusive {
            let mut fingerprint = [0; 32];
            file.read_exact(&mut fingerprint)?;
            if fingerprint != self.fingerprint || read_u32(&mut file)? != u32::from(length) {
                return Err(invalid("Invalid exclusive phrase source"));
            }
            let books = read_u32(&mut file)?;
            if books as usize != self.book_ids.len() {
                return Err(invalid("Invalid exclusive book count"));
            }
            let mut records = 0u64;
            for _ in 0..books {
                records = records
                    .checked_add(read_u64(&mut file)?)
                    .ok_or_else(|| invalid("Phrase source overflow"))?;
            }
            let start = 48 + 8 * u64::from(books);
            let record_stride = 4 * (u64::from(length) + 1);
            if records
                .checked_mul(record_stride)
                .and_then(|size| size.checked_add(start))
                != Some(file.metadata()?.len())
            {
                return Err(invalid("Truncated exclusive phrase source"));
            }
            (start, records, record_stride)
        } else {
            if &magic != MAGIC
                || read_u32(&mut file)? != VERSION
                || read_u32(&mut file)? != u32::from(length)
            {
                return Err(invalid("Invalid occurrence phrase source"));
            }
            let mut fingerprint = [0; 32];
            file.read_exact(&mut fingerprint)?;
            let parent = path.parent().unwrap_or(Path::new(""));
            let valid = if parent == self.directory {
                fingerprint == self.fingerprint
            } else {
                parent.file_name().and_then(|name| name.to_str())
                    == Some(format!("books-{}", hex(&fingerprint)).as_str())
            };
            if !valid {
                return Err(invalid("Mismatched phrase source corpus"));
            }
            let records = read_u64(&mut file)?;
            let frequencies = read_u64(&mut file)?;
            let expected = records
                .checked_mul(stride(length))
                .and_then(|size| {
                    frequencies
                        .checked_mul(4)
                        .and_then(|extra| size.checked_add(extra))
                })
                .and_then(|size| size.checked_add(HEADER_SIZE));
            if expected != Some(file.metadata()?.len()) {
                return Err(invalid("Truncated occurrence phrase source"));
            }
            (HEADER_SIZE, records, stride(length))
        };
        let mut tokens = HashSet::new();
        for index in 0..records {
            file.seek(SeekFrom::Start(
                start + index * record_stride + if exclusive { 4 } else { 40 },
            ))?;
            let phrase = (0..length)
                .map(|_| read_u32(&mut file))
                .collect::<io::Result<Vec<_>>>()?;
            if phrase
                .iter()
                .any(|token| *token as usize >= self.dictionary.len())
            {
                return Err(invalid("Invalid source phrase token"));
            }
            tokens.insert(phrase);
        }
        Ok(tokens)
    }
    fn alphabetical_reader(&self, length: u16, paths: &[PathBuf]) -> io::Result<Reader> {
        let mut digest = Sha256::new();
        digest.update(self.fingerprint);
        for path in paths {
            let metadata = fs::metadata(path)?;
            digest.update(path.to_string_lossy().as_bytes());
            digest.update(metadata.len().to_le_bytes());
            digest.update(
                metadata
                    .modified()?
                    .duration_since(UNIX_EPOCH)
                    .map_err(io::Error::other)?
                    .as_nanos()
                    .to_le_bytes(),
            );
        }
        let signature: [u8; 32] = digest.finalize().into();
        let path = self.directory.join(format!("catalogue-{length}.bin"));
        let open = || -> io::Result<Reader> {
            let mut file = File::open(&path)?;
            let mut magic = [0; 8];
            file.read_exact(&mut magic)?;
            let mut stored = [0; 32];
            file.read_exact(&mut stored)?;
            let remaining = read_u64(&mut file)?;
            if &magic != CATALOGUE_MAGIC
                || stored != signature
                || remaining
                    .checked_mul(4 * (u64::from(length) + 3))
                    .and_then(|size| size.checked_add(CATALOGUE_HEADER))
                    != Some(file.metadata()?.len())
            {
                return Err(invalid("Invalid saved alphabetical catalogue"));
            }
            Ok(Reader {
                file: BufReader::new(file),
                length,
                remaining,
            })
        };
        if let Ok(reader) = open() {
            return Ok(reader);
        }
        let mut candidates = HashSet::new();
        for path in paths {
            candidates.extend(self.source_tokens(path, length)?);
        }
        // Scoped and exclusive sources hold subsets; metadata always counts the whole Bible.
        let mut counts: HashMap<Vec<u32>, (u128, u32)> = candidates
            .into_iter()
            .map(|tokens| (tokens, (0, 0)))
            .collect();
        for verse in &self.verses {
            for tokens in verse.tokens.windows(usize::from(length)) {
                if let Some((books, occurrences)) = counts.get_mut(tokens) {
                    *books |= verse.position.book;
                    *occurrences += 1;
                }
            }
        }
        let mut entries: Vec<_> = counts
            .into_iter()
            .filter(|(_, (books, _))| *books != 0)
            .map(|(tokens, (books, occurrences))| {
                let phrase = tokens
                    .iter()
                    .map(|token| self.dictionary[*token as usize].as_str())
                    .collect::<Vec<_>>()
                    .join(" ");
                let letters: u32 = tokens
                    .iter()
                    .map(|token| self.token_letters[*token as usize])
                    .sum();
                (phrase, letters, books.count_ones(), occurrences, tokens)
            })
            .collect();
        entries.sort_unstable_by(|a, b| a.0.cmp(&b.0));
        let temporary = self.temporary("catalogue");
        let mut writer = BufWriter::new(
            OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)?,
        );
        writer.write_all(CATALOGUE_MAGIC)?;
        writer.write_all(&signature)?;
        writer.write_all(&(entries.len() as u64).to_le_bytes())?;
        for (_, letters, books, occurrences, tokens) in entries {
            writer.write_all(&letters.to_le_bytes())?;
            writer.write_all(&books.to_le_bytes())?;
            writer.write_all(&occurrences.to_le_bytes())?;
            for token in tokens {
                writer.write_all(&token.to_le_bytes())?;
            }
        }
        writer.flush()?;
        writer.get_ref().sync_all()?;
        drop(writer);
        self.publish(&temporary, &path)?;
        open()
    }
    pub fn saved_phrases(&self, offset: usize) -> Result<SavedPhrasePage, String> {
        self.saved_phrases_filtered(offset, &PhraseFilters::default())
    }
    pub fn saved_phrases_filtered(
        &self,
        offset: usize,
        filters: &PhraseFilters,
    ) -> Result<SavedPhrasePage, String> {
        let _guard = self
            .build_lock
            .lock()
            .map_err(|_| "Phrase catalogue lock failed")?;
        let run = || -> io::Result<SavedPhrasePage> {
            let sources = self.catalogue_sources()?;
            let persisted_lengths = sources.keys().copied().collect();
            let mut readers = sources
                .iter()
                .filter(|(length, _)| filters.words.is_none_or(|words| words == **length))
                .map(|(length, paths)| self.alphabetical_reader(*length, paths))
                .collect::<io::Result<Vec<_>>>()?;
            let unfiltered = filters.letters.is_none()
                && filters.occurrences.is_none()
                && filters.books.is_none();
            let source_total: usize = readers.iter().map(|reader| reader.remaining as usize).sum();
            let mut matched = 0;
            let mut next = readers
                .iter_mut()
                .map(|reader| reader.next(&self.dictionary))
                .collect::<io::Result<Vec<_>>>()?;
            let mut entries = Vec::new();
            for _ in 0..source_total {
                let Some(index) = next
                    .iter()
                    .enumerate()
                    .filter_map(|(index, entry)| entry.as_ref().map(|entry| (index, &entry.phrase)))
                    .min_by(|a, b| a.1.cmp(b.1))
                    .map(|(index, _)| index)
                else {
                    break;
                };
                let entry = next[index].take().unwrap();
                if filters.matches(&entry) {
                    if matched >= offset && entries.len() < PAGE_SIZE {
                        entries.push(entry);
                    }
                    matched += 1;
                }
                if unfiltered && matched >= offset.saturating_add(PAGE_SIZE) {
                    break;
                }
                next[index] = readers[index].next(&self.dictionary)?;
            }
            Ok(SavedPhrasePage {
                total: if unfiltered { source_total } else { matched },
                entries,
                persisted_lengths,
            })
        };
        run().map_err(|error| format!("Unable to browse saved phrases: {error}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn root() -> PathBuf {
        std::env::temp_dir().join(format!(
            "kjv-catalogue-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }
    fn query(length: u16) -> OccurrenceQuery {
        serde_json::from_value(
            serde_json::json!({"count":1,"words":length,"upTo":false,"offset":0}),
        )
        .unwrap()
    }
    #[test]
    fn uses_saved_sources_deduplicates_and_counts_books_globally() {
        let root = root();
        let lines = [
            ("Genesis", "a b c a b"),
            ("Exodus", "a b d"),
            ("Leviticus", "only other phrase"),
        ];
        let index = OccurrenceIndex::new(lines.into_iter(), &root);
        assert_eq!(index.saved_phrases(0).unwrap().total, 0);
        let mut selected = query(2);
        selected.included_books = Some(vec!["Genesis".into()]);
        index.search(&selected).unwrap();
        let saved = index.saved_phrases(0).unwrap();
        assert_eq!(saved.total, 3);
        assert_eq!(saved.entries[0].occurrences, 3);
        assert_eq!(
            saved
                .entries
                .iter()
                .map(|entry| entry.phrase.as_str())
                .collect::<Vec<_>>(),
            vec!["a b", "b c", "c a"]
        );
        assert_eq!(
            (
                saved.entries[0].books,
                saved.entries[0].words,
                saved.entries[0].letters
            ),
            (2, 2, 2)
        );
        index.exclusive_count("Genesis", 2).unwrap();
        index.search(&query(3)).unwrap();
        let saved = index.saved_phrases(0).unwrap();
        assert_eq!(saved.persisted_lengths, vec![2, 3]);
        let expected = vec![
            "a b",
            "a b c",
            "a b d",
            "b c",
            "b c a",
            "b d",
            "c a",
            "c a b",
            "only other",
            "only other phrase",
            "other phrase",
        ];
        assert_eq!(
            saved
                .entries
                .iter()
                .map(|entry| entry.phrase.as_str())
                .collect::<Vec<_>>(),
            expected
        );
        let restarted = OccurrenceIndex::new(lines.into_iter(), &root);
        assert_eq!(restarted.saved_phrases(0).unwrap().total, expected.len());
        fs::write(index.directory.join("catalogue-2.bin"), b"truncated").unwrap();
        assert_eq!(index.saved_phrases(0).unwrap().total, expected.len());
        assert!(!index.directory.join("words-2.bin").exists());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn merging_lengths_pages_without_duplicates_and_detects_bad_sources() {
        let root = root();
        let line = (0..120)
            .map(|n| format!("word{n:03}"))
            .collect::<Vec<_>>()
            .join(" ");
        let index = OccurrenceIndex::new([("Genesis", line.as_str())].into_iter(), &root);
        index.search(&query(2)).unwrap();
        index.search(&query(3)).unwrap();
        let mut phrases = Vec::new();
        for offset in (0..237).step_by(50) {
            let page = index.saved_phrases(offset).unwrap();
            assert_eq!(page.total, 237);
            phrases.extend(page.entries.into_iter().map(|entry| entry.phrase));
        }
        let filtered = PhraseFilters {
            words: Some(2),
            letters: Some(8),
            occurrences: Some(1),
            books: Some(1),
            ..Default::default()
        };
        let mut filtered_phrases = Vec::new();
        for offset in [0, 50, 100] {
            let page = index.saved_phrases_filtered(offset, &filtered).unwrap();
            assert_eq!(page.total, 119);
            filtered_phrases.extend(page.entries.into_iter().map(|entry| entry.phrase));
        }
        assert_eq!(
            filtered_phrases,
            phrases
                .iter()
                .filter(|phrase| phrase.split_whitespace().count() == 2)
                .cloned()
                .collect::<Vec<_>>()
        );
        assert_eq!(phrases.len(), 237);
        assert!(phrases.windows(2).all(|pair| pair[0] < pair[1]));
        assert!(index.saved_phrases(usize::MAX).unwrap().entries.is_empty());
        fs::write(index.directory.join("words-2.bin"), b"truncated").unwrap();
        assert!(index.saved_phrases(0).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn filters_all_metadata_and_rebuilds_old_catalogues() {
        let root = root();
        let index = OccurrenceIndex::new(
            [
                ("Genesis", "a a a"),
                ("Genesis", "a b a b"),
                ("Exodus", "a b"),
                ("Exodus", "aa bb"),
            ]
            .into_iter(),
            &root,
        );
        index.search(&query(2)).unwrap();
        index.search(&query(3)).unwrap();
        let all = index.saved_phrases(0).unwrap();
        assert_eq!(
            all.entries
                .iter()
                .find(|e| e.phrase == "a a")
                .unwrap()
                .occurrences,
            2
        );
        let filters = PhraseFilters {
            words: Some(2),
            letters: Some(2),
            occurrences: Some(3),
            books: Some(2),
            ..Default::default()
        };
        let page = index.saved_phrases_filtered(0, &filters).unwrap();
        assert_eq!(page.total, 1);
        assert_eq!(page.entries[0].phrase, "a b");
        assert!(index
            .saved_phrases_filtered(1, &filters)
            .unwrap()
            .entries
            .is_empty());
        assert_eq!(
            index
                .saved_phrases_filtered(
                    0,
                    &PhraseFilters {
                        letters: Some(4),
                        ..Default::default()
                    }
                )
                .unwrap()
                .entries[0]
                .phrase,
            "aa bb"
        );
        assert_eq!(
            index
                .saved_phrases_filtered(
                    0,
                    &PhraseFilters {
                        words: Some(3),
                        ..Default::default()
                    }
                )
                .unwrap()
                .total,
            3
        );
        assert_eq!(
            index
                .saved_phrases_filtered(
                    0,
                    &PhraseFilters {
                        occurrences: Some(2),
                        ..Default::default()
                    }
                )
                .unwrap()
                .entries[0]
                .phrase,
            "a a"
        );
        assert_eq!(
            index
                .saved_phrases_filtered(
                    0,
                    &PhraseFilters {
                        books: Some(66),
                        ..Default::default()
                    }
                )
                .unwrap()
                .total,
            0
        );
        let path = index.directory.join("catalogue-2.bin");
        let mut bytes = fs::read(&path).unwrap();
        bytes[..8].copy_from_slice(b"KJVCAT01");
        fs::write(path, bytes).unwrap();
        assert_eq!(index.saved_phrases(0).unwrap().total, all.total);
        fs::remove_dir_all(root).unwrap();
    }
}
