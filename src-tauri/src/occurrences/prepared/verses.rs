//! Prepared verse counts, word boundaries, and alphabetical phrase references.
use super::*;
use crate::bible::{Verse, PAGE_SIZE};
use serde::{Deserialize, Serialize};
const VERSION: u32 = 3;
#[derive(Clone, Serialize, Deserialize)]
pub struct VerseSummary {
    pub verse: Verse,
    pub words: usize,
    pub letters: usize,
    pub phrases: usize,
}
#[derive(Clone, Default, Deserialize)]
pub struct VerseFilters {
    pub words: Option<usize>,
    pub letters: Option<usize>,
    pub phrases: Option<usize>,
}
impl VerseFilters {
    fn matches(&self, verse: &VerseSummary) -> bool {
        self.words.is_none_or(|n| verse.words == n)
            && self.letters.is_none_or(|n| verse.letters == n)
            && self.phrases.is_none_or(|n| verse.phrases == n)
    }
}
#[derive(Serialize)]
pub struct VersePage {
    pub total: usize,
    pub entries: Vec<VerseSummary>,
}
#[derive(Clone, Serialize)]
pub struct VerseWord {
    pub start: u32,
    pub end: u32,
    pub word: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerseDetail {
    pub word_entries: Vec<crate::detail_lists::ContextWord>,
    #[serde(flatten)]
    pub summary: VerseSummary,
    pub word_parts: Vec<VerseWord>,
    pub phrase_results: SavedPhrasePage,
}
#[derive(Serialize, Deserialize)]
struct StoredVerse {
    #[serde(flatten)]
    summary: VerseSummary,
    word_start: u64,
    phrase_start: u64,
    display_start: u64,
    display_phrases: usize,
}
#[derive(Serialize, Deserialize)]
struct VerseManifest {
    format: u32,
    fingerprint: String,
    maximum_words: u16,
    total: usize,
    word_links: u64,
    phrase_links: u64,
    display_links: u64,
    entries: Vec<StoredVerse>,
}
pub struct PreparedVerses {
    root: PathBuf,
    manifest: VerseManifest,
    locations: BTreeMap<(String, u16, u16), usize>,
    books: BTreeMap<String, (usize, usize)>,
}
pub(super) fn word_parts(text: &str) -> Vec<VerseWord> {
    fn flush(
        text: &str,
        byte_start: usize,
        byte_end: usize,
        utf_start: u32,
        utf_end: u32,
        parts: &mut Vec<VerseWord>,
    ) {
        let raw = &text[byte_start..byte_end];
        let trimmed = raw.trim_matches('\'');
        if !trimmed.is_empty() {
            parts.push(VerseWord {
                start: utf_start + raw.chars().take_while(|c| *c == '\'').count() as u32,
                end: utf_end - raw.chars().rev().take_while(|c| *c == '\'').count() as u32,
                word: trimmed.to_lowercase(),
            });
        }
    }
    let mut parts = Vec::new();
    let mut start = None;
    let mut utf = 0u32;
    for (byte, c) in text.char_indices() {
        if c.is_alphanumeric() || c == '\'' {
            if start.is_none() {
                start = Some((byte, utf));
            }
        } else if let Some((begin, utf_begin)) = start.take() {
            flush(text, begin, byte, utf_begin, utf, &mut parts);
        }
        utf += c.len_utf16() as u32;
    }
    if let Some((begin, utf_begin)) = start {
        flush(text, begin, text.len(), utf_begin, utf, &mut parts);
    }
    parts
}
#[derive(Clone, Copy)]
struct PhraseMeta {
    books: u16,
    token: u32,
    words: u16,
    occurrences: u32,
}
#[derive(Clone, Copy)]
pub(super) struct LocatedPhrase {
    pub(super) id: u32,
    pub(super) start: usize,
    pub(super) end: usize,
    pub(super) occurrences: u32,
}
pub(super) fn rolled_phrases(
    tokens: &[u32],
    candidates: &HashMap<&[u32], (u32, u32)>,
    maximum: usize,
) -> Vec<LocatedPhrase> {
    let mut located = Vec::new();
    let mut seen = HashSet::new();
    for length in 2..=maximum.min(tokens.len()) {
        for (start, window) in tokens.windows(length).enumerate() {
            if let Some(&(id, occurrences)) = candidates.get(window) {
                if seen.insert(id) {
                    located.push(LocatedPhrase {
                        id,
                        start,
                        end: start + length,
                        occurrences,
                    });
                }
            }
        }
    }
    let mut unique: Vec<_> = located
        .iter()
        .filter(|entry| entry.occurrences == 1)
        .copied()
        .collect();
    unique.sort_unstable_by_key(|entry| (entry.start, std::cmp::Reverse(entry.end)));
    let mut hidden = HashSet::new();
    let mut furthest = 0;
    for entry in unique {
        if entry.end <= furthest {
            hidden.insert(entry.id);
        } else {
            furthest = entry.end;
        }
    }
    located.retain(|entry| !hidden.contains(&entry.id));
    located.sort_unstable_by_key(|entry| entry.id);
    located
}
pub(super) fn display_boundaries(text: &str, parts: &[VerseWord]) -> Vec<(u32, u32)> {
    let units: Vec<_> = text.encode_utf16().collect();
    parts
        .iter()
        .map(|part| {
            let mut start = part.start as usize;
            let mut end = part.end as usize;
            while start > 0
                && [
                    b'[' as u16,
                    b'(' as u16,
                    b'{' as u16,
                    b'\'' as u16,
                    b'"' as u16,
                    0x2018,
                    0x201c,
                ]
                .contains(&units[start - 1])
            {
                start -= 1;
            }
            while end < units.len()
                && [
                    b']' as u16,
                    b')' as u16,
                    b'}' as u16,
                    b'\'' as u16,
                    b'"' as u16,
                    b'.' as u16,
                    b',' as u16,
                    b';' as u16,
                    b':' as u16,
                    b'!' as u16,
                    b'?' as u16,
                    0x2019,
                    0x201d,
                ]
                .contains(&units[end])
            {
                end += 1;
            }
            (start as u32, end as u32)
        })
        .collect()
}
impl PreparedVerses {
    pub fn open(root: &Path, bible: &Bible, phrases: &PreparedPhrases) -> Result<Self, String> {
        let run = || -> io::Result<Self> {
            let manifest: VerseManifest = read_json(&root.join("verses.json"))?;
            if manifest.format != VERSION
                || manifest.fingerprint != fingerprint(bible)
                || manifest.maximum_words != phrases.manifest.maximum_words
                || manifest.total != phrases.manifest.verses
                || manifest.entries.len() != manifest.total
                || manifest.phrase_links != phrases.manifest.postings
                || fs::metadata(root.join("verse-phrases.bin"))?.len() != manifest.phrase_links * 4
                || fs::metadata(root.join("verse-words.bin"))?.len() != manifest.word_links * 12
                || fs::metadata(root.join("verse-display.bin"))?.len()
                    != manifest.display_links * 12
                || fs::metadata(root.join("verse-order.bin"))?.len() != manifest.display_links * 8
            {
                return Err(invalid("Incomplete or incompatible prepared verse data"));
            }
            let mut locations = BTreeMap::new();
            let mut books = BTreeMap::new();
            let mut word_end = 0;
            let mut phrase_end = 0;
            let mut display_end = 0;
            for (id, entry) in manifest.entries.iter().enumerate() {
                let verse = &entry.summary.verse;
                if entry.word_start != word_end
                    || entry.phrase_start != phrase_end
                    || entry.display_start != display_end
                    || entry.display_phrases > entry.summary.phrases
                {
                    return Err(invalid("Invalid verse directory offsets"));
                }
                word_end += entry.summary.words as u64;
                phrase_end += entry.summary.phrases as u64;
                display_end += entry.display_phrases as u64;
                if locations
                    .insert((verse.book.clone(), verse.chapter, verse.number), id)
                    .is_some()
                {
                    return Err(invalid("Duplicate verse reference"));
                }
                books.entry(verse.book.clone()).or_insert((id, id)).1 = id + 1;
            }
            if word_end != manifest.word_links
                || phrase_end != manifest.phrase_links
                || display_end != manifest.display_links
            {
                return Err(invalid("Invalid verse directory totals"));
            }
            Ok(Self {
                root: root.into(),
                manifest,
                locations,
                books,
            })
        };
        run().map_err(|e| format!("Unable to open prepared verses: {e}"))
    }
    pub fn highlights(
        &self,
        phrases: &PreparedPhrases,
        stats: &crate::word_stats::WordStatistics,
        books: &crate::book_stats::BookStatistics,
        book: &str,
        chapter: u16,
    ) -> Result<crate::reader_highlights::ChapterHighlights, String> {
        let book_stats = books.get(book)?;
        let chapter_stats = book_stats
            .chapters
            .iter()
            .find(|entry| entry.chapter == chapter)
            .ok_or("Chapter not found")?;
        let exclusive: HashSet<_> = chapter_stats
            .exclusive_words
            .iter()
            .map(|entry| entry.word.as_str())
            .collect();
        let run = || -> io::Result<crate::reader_highlights::ChapterHighlights> {
            let mut file = File::open(self.root.join("verse-words.bin"))?;
            let mut verses = Vec::new();
            for ((_, _, number), &id) in self
                .locations
                .range((book.to_owned(), chapter, 0)..=(book.to_owned(), chapter, u16::MAX))
            {
                let entry = &self.manifest.entries[id];
                file.seek(SeekFrom::Start(entry.word_start * 12))?;
                let mut words = Vec::with_capacity(entry.summary.words);
                let mut first_seen = HashSet::new();
                for _ in 0..entry.summary.words {
                    let start = read_u32(&mut file)?;
                    let end = read_u32(&mut file)?;
                    let token = read_u32(&mut file)?;
                    let word = phrases
                        .dictionary
                        .get(token as usize)
                        .ok_or_else(|| invalid("Invalid reader word"))?;
                    let data = stats
                        .find_normalized(word)
                        .ok_or_else(|| invalid("Missing saved word statistics"))?;
                    let first_mention = data.first_mention.book == book
                        && data.first_mention.chapter == chapter
                        && data.first_mention.number == *number
                        && first_seen.insert(word.clone());
                    words.push(crate::reader_highlights::HighlightWord {
                        start,
                        end,
                        word: word.clone(),
                        count: data.count,
                        exclusive: exclusive.contains(word.as_str()),
                        first_mention,
                    });
                }
                verses.push(crate::reader_highlights::HighlightVerse {
                    number: *number,
                    words,
                });
            }
            if verses.is_empty() {
                return Err(invalid("Chapter not found"));
            }
            Ok(crate::reader_highlights::ChapterHighlights {
                book: book.into(),
                chapter,
                verses,
            })
        };
        run().map_err(|e| format!("Unable to read chapter highlighting data: {e}"))
    }
    pub fn page(&self, book: Option<&str>, offset: usize) -> Result<VersePage, String> {
        self.page_filtered(book, offset, &VerseFilters::default())
    }
    pub fn page_filtered(
        &self,
        book: Option<&str>,
        offset: usize,
        filters: &VerseFilters,
    ) -> Result<VersePage, String> {
        let (start, end) = match book {
            None => (0, self.manifest.total),
            Some(book) => *self
                .books
                .get(book)
                .ok_or_else(|| format!("Book not found: {book}"))?,
        };
        let matches = || {
            self.manifest.entries[start..end]
                .iter()
                .filter(|entry| filters.matches(&entry.summary))
        };
        let total = matches().count();
        let entries = matches()
            .skip(offset)
            .take(PAGE_SIZE)
            .map(|entry| entry.summary.clone())
            .collect();
        Ok(VersePage { total, entries })
    }
    pub fn detail(
        &self,
        phrases: &PreparedPhrases,
        book: &str,
        chapter: u16,
        verse: u16,
        offset: usize,
    ) -> Result<VerseDetail, String> {
        self.detail_sorted(
            phrases,
            book,
            chapter,
            verse,
            offset,
            crate::detail_lists::PhraseSort::default(),
        )
    }
    pub fn detail_sorted(
        &self,
        phrases: &PreparedPhrases,
        book: &str,
        chapter: u16,
        verse: u16,
        offset: usize,
        sort: crate::detail_lists::PhraseSort,
    ) -> Result<VerseDetail, String> {
        let run = || -> io::Result<VerseDetail> {
            let id = *self
                .locations
                .get(&(book.into(), chapter, verse))
                .ok_or_else(|| invalid("Verse not found"))?;
            let entry = &self.manifest.entries[id];
            let mut words = File::open(self.root.join("verse-words.bin"))?;
            words.seek(SeekFrom::Start(entry.word_start * 12))?;
            let word_parts = (0..entry.summary.words)
                .map(|_| {
                    let start = read_u32(&mut words)?;
                    let end = read_u32(&mut words)?;
                    let token = read_u32(&mut words)?;
                    if start >= end {
                        return Err(invalid("Invalid word boundary"));
                    }
                    let word = phrases
                        .dictionary
                        .get(token as usize)
                        .cloned()
                        .ok_or_else(|| invalid("Invalid verse word ID"))?;
                    Ok(VerseWord { start, end, word })
                })
                .collect::<io::Result<Vec<_>>>()?;
            let total = entry.display_phrases;
            let mut ids = File::open(self.root.join("verse-display.bin"))?;
            let utf16: Vec<_> = entry.summary.verse.text.encode_utf16().collect();
            let mut order = File::open(self.root.join("verse-order.bin"))?;
            let mut records = File::open(phrases.root.join("phrases.bin"))?;
            let entries = (offset.min(total)..offset.saturating_add(PAGE_SIZE).min(total))
                .enumerate()
                .map(|(_index, _)| {
                    let rank = sort.rank(offset + _index, total);
                    let local = match sort.field {
                        crate::detail_lists::PhraseSortField::Phrase => rank,
                        field => {
                            let block =
                                if matches!(field, crate::detail_lists::PhraseSortField::Books) {
                                    total as u64
                                } else {
                                    0
                                };
                            order.seek(SeekFrom::Start(
                                (entry.display_start * 2 + block + rank as u64) * 4,
                            ))?;
                            read_u32(&mut order)? as usize
                        }
                    };
                    if local >= total {
                        return Err(invalid("Invalid saved phrase sort rank"));
                    }
                    ids.seek(SeekFrom::Start((entry.display_start + local as u64) * 12))?;
                    let phrase_id = read_u32(&mut ids)? as usize;
                    let start = read_u32(&mut ids)? as usize;
                    let end = read_u32(&mut ids)? as usize;
                    let slice = utf16
                        .get(start..end)
                        .ok_or_else(|| invalid("Invalid phrase display boundaries"))?;
                    let mut summary = phrases.summary(phrases.record(&mut records, phrase_id)?)?;
                    summary.display = Some(
                        String::from_utf16(slice)
                            .map_err(|_| invalid("Invalid phrase display text"))?,
                    );
                    Ok(summary)
                })
                .collect::<io::Result<Vec<_>>>()?;
            Ok(VerseDetail {
                word_entries: Vec::new(),
                summary: entry.summary.clone(),
                word_parts,
                phrase_results: SavedPhrasePage {
                    total,
                    entries,
                    persisted_lengths: (2..=phrases.manifest.maximum_words).collect(),
                },
            })
        };
        run().map_err(|e| format!("Unable to read verse details: {e}"))
    }
}
impl PreparedPhrases {
    pub fn prepare_verses(&self, bible: &Bible) -> Result<(), String> {
        if PreparedVerses::open(&self.root, bible, self).is_ok() {
            return Ok(());
        }
        let run = || -> io::Result<()> {
            let mut lists = vec![Vec::<u32>::new(); self.manifest.verses];
            let mut records = BufReader::new(File::open(self.root.join("phrases.bin"))?);
            let mut postings = BufReader::new(File::open(self.root.join("postings.bin"))?);
            let mut metadata = Vec::with_capacity(self.manifest.total);
            for phrase in 0..self.manifest.total {
                let record = Record::read(&mut records)?;
                metadata.push(PhraseMeta {
                    books: record.books,
                    token: record.token,
                    words: record.words,
                    occurrences: record.occurrences,
                });
                for _ in 0..record.verses {
                    let mut bytes = [0; 4];
                    postings.read_exact(&mut bytes)?;
                    let verse = u32::from_le_bytes(bytes) as usize;
                    lists
                        .get_mut(verse)
                        .ok_or_else(|| invalid("Invalid phrase verse reference"))?
                        .push(phrase as u32);
                }
            }
            let mut word_writer = BufWriter::new(File::create(self.root.join("verse-words.bin"))?);
            let mut phrase_writer =
                BufWriter::new(File::create(self.root.join("verse-phrases.bin"))?);
            let mut display_writer =
                BufWriter::new(File::create(self.root.join("verse-display.bin"))?);
            let mut sort_writer = BufWriter::new(File::create(self.root.join("verse-order.bin"))?);
            let mut display_start = 0u64;
            let mut entries = Vec::new();
            let mut word_start = 0u64;
            let mut phrase_start = 0u64;
            for (id, list) in lists.into_iter().enumerate() {
                let verse = bible
                    .verse_at(id)
                    .ok_or_else(|| invalid("Invalid Bible verse"))?;
                let parts = word_parts(&verse.text);
                let words = parts.len();
                let letters = verse.text.chars().filter(|c| c.is_alphabetic()).count();
                let count = list.len();
                let tokens = parts
                    .iter()
                    .map(|part| {
                        self.dictionary
                            .binary_search(&part.word)
                            .map(|id| id as u32)
                            .map_err(|_| invalid("Missing verse word"))
                    })
                    .collect::<io::Result<Vec<_>>>()?;
                let candidates: HashMap<_, _> = list
                    .iter()
                    .map(|&id| {
                        let meta = metadata[id as usize];
                        (
                            &self.tokens
                                [meta.token as usize..meta.token as usize + meta.words as usize],
                            (id, meta.occurrences),
                        )
                    })
                    .collect();
                let visible =
                    rolled_phrases(&tokens, &candidates, self.manifest.maximum_words as usize);
                let boundaries = display_boundaries(&verse.text, &parts);
                let mut order: Vec<u32> = (0..visible.len() as u32).collect();
                order.sort_unstable_by_key(|&position| {
                    let id = visible[position as usize].id;
                    (metadata[id as usize].occurrences, id)
                });
                for position in &order {
                    sort_writer.write_all(&position.to_le_bytes())?;
                }
                order.sort_unstable_by_key(|&position| {
                    let id = visible[position as usize].id;
                    (metadata[id as usize].books, id)
                });
                for position in &order {
                    sort_writer.write_all(&position.to_le_bytes())?;
                }
                for phrase in &visible {
                    display_writer.write_all(&phrase.id.to_le_bytes())?;
                    display_writer.write_all(&boundaries[phrase.start].0.to_le_bytes())?;
                    display_writer.write_all(&boundaries[phrase.end - 1].1.to_le_bytes())?;
                }
                for part in parts {
                    let token = self
                        .dictionary
                        .binary_search(&part.word)
                        .map_err(|_| invalid("Missing verse word"))?
                        as u32;
                    word_writer.write_all(&part.start.to_le_bytes())?;
                    word_writer.write_all(&part.end.to_le_bytes())?;
                    word_writer.write_all(&token.to_le_bytes())?;
                }
                for phrase in list {
                    phrase_writer.write_all(&phrase.to_le_bytes())?;
                }
                entries.push(StoredVerse {
                    summary: VerseSummary {
                        verse,
                        words,
                        letters,
                        phrases: count,
                    },
                    word_start,
                    phrase_start,
                    display_start,
                    display_phrases: visible.len(),
                });
                word_start += words as u64;
                phrase_start += count as u64;
                display_start += visible.len() as u64;
            }
            word_writer.flush()?;
            phrase_writer.flush()?;
            display_writer.flush()?;
            sort_writer.flush()?;
            let manifest = VerseManifest {
                format: VERSION,
                fingerprint: self.manifest.fingerprint.clone(),
                maximum_words: self.manifest.maximum_words,
                total: entries.len(),
                word_links: word_start,
                phrase_links: phrase_start,
                display_links: display_start,
                entries,
            };
            let path = self.root.join("verses.tmp");
            json_file(&path, &manifest)?;
            fs::rename(path, self.root.join("verses.json"))?;
            println!(
                "Prepared {} verse summaries, {} word links, and {} phrase links",
                manifest.total, manifest.word_links, manifest.phrase_links
            );
            Ok(())
        };
        run().map_err(|e| format!("Unable to prepare verses: {e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn word_boundaries_preserve_original_unicode_and_apostrophes() {
        let text = "😀 'God's'—Élie 123; 'a' a a.";
        let parts = word_parts(text);
        assert_eq!(
            parts
                .iter()
                .map(|part| part.word.as_str())
                .collect::<Vec<_>>(),
            vec!["god's", "élie", "123", "a", "a", "a"]
        );
        let utf16: Vec<_> = text.encode_utf16().collect();
        assert_eq!(
            parts
                .iter()
                .map(
                    |part| String::from_utf16(&utf16[part.start as usize..part.end as usize])
                        .unwrap()
                )
                .collect::<Vec<_>>(),
            vec!["God's", "Élie", "123", "a", "a", "a"]
        );
    }
    #[test]
    fn rollup_keeps_repeated_children_and_overlapping_maximal_phrases() {
        let tokens = vec![0, 1, 2, 3];
        let full = &tokens[..];
        let left = &tokens[..3];
        let right = &tokens[1..];
        let middle = &tokens[1..3];
        let mut candidates = HashMap::from([
            (full, (0, 1)),
            (left, (1, 1)),
            (right, (2, 1)),
            (middle, (3, 2)),
        ]);
        assert_eq!(
            rolled_phrases(&tokens, &candidates, 4)
                .iter()
                .map(|p| p.id)
                .collect::<Vec<_>>(),
            vec![0, 3]
        );
        candidates.remove(full);
        assert_eq!(
            rolled_phrases(&tokens, &candidates, 4)
                .iter()
                .map(|p| p.id)
                .collect::<Vec<_>>(),
            vec![1, 2, 3]
        );
        let text = "God, [is] good; god is here.";
        let parts = word_parts(text);
        let bounds = display_boundaries(text, &parts);
        let units: Vec<_> = text.encode_utf16().collect();
        assert_eq!(
            String::from_utf16(&units[bounds[0].0 as usize..bounds[2].1 as usize]).unwrap(),
            "God, [is] good;"
        );
        assert_eq!(
            String::from_utf16(&units[bounds[3].0 as usize..bounds[5].1 as usize]).unwrap(),
            "god is here."
        );
    }
    #[test]
    fn prepared_verse_counts_phrases_paging_and_reuse_match_the_corpus() {
        let root = std::env::temp_dir().join(format!(
            "kjv-verses-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let text = (0..90)
            .map(|n| format!("word{n:02}"))
            .collect::<Vec<_>>()
            .join(" ");
        let source = serde_json::json!({"Genesis 1:1":"a a a, God's [word].", "Genesis 1:2":text,"Exodus 1:1":"a a word"});
        let bible = Bible::from_json(&source.to_string()).unwrap();
        let index = OccurrenceIndex::from_passages(bible.located_passages(), &root.join("cache"));
        index.prepare_phrases(&root.join("pack"), 32).unwrap();
        let phrases = PreparedPhrases::open(&root.join("pack"), &bible).unwrap();
        phrases.prepare_verses(&bible).unwrap();
        let verses = PreparedVerses::open(&root.join("pack"), &bible, &phrases).unwrap();
        assert_eq!(verses.page(None, 0).unwrap().total, 3);
        let filters = VerseFilters {
            words: Some(5),
            letters: Some(11),
            phrases: Some(9),
        };
        let filtered = verses.page_filtered(None, 0, &filters).unwrap();
        assert_eq!(filtered.total, 1);
        assert_eq!(filtered.entries[0].verse.number, 1);
        assert_eq!(
            verses
                .page_filtered(Some("Exodus"), 0, &filters)
                .unwrap()
                .total,
            0
        );
        assert!(verses
            .page_filtered(None, 1, &filters)
            .unwrap()
            .entries
            .is_empty());
        assert_eq!(
            verses
                .page_filtered(
                    None,
                    0,
                    &VerseFilters {
                        phrases: Some(2294),
                        ..Default::default()
                    }
                )
                .unwrap()
                .entries[0]
                .verse
                .number,
            2
        );

        assert_eq!(verses.page(Some("Exodus"), 0).unwrap().total, 1);
        assert!(verses.page(None, usize::MAX).unwrap().entries.is_empty());
        assert!(verses.page(Some("Missing"), 0).is_err());
        let detail = verses.detail(&phrases, "Genesis", 1, 1, 0).unwrap();
        assert_eq!(detail.summary.words, 5);
        assert_eq!(detail.summary.letters, 11);
        let expected: BTreeMap<_, _> = (2..=5)
            .flat_map(|length| {
                crate::text::words("a a a, God's [word].")
                    .windows(length)
                    .map(|window| (window.join(" "), ()))
                    .collect::<Vec<_>>()
            })
            .collect();
        assert_eq!(detail.summary.phrases, expected.len());
        assert_eq!(
            detail
                .phrase_results
                .entries
                .iter()
                .map(|p| p.phrase.as_str())
                .collect::<Vec<_>>(),
            vec!["a a", "a a a god's word"]
        );
        assert_eq!(
            detail.phrase_results.entries[1].display.as_deref(),
            Some("a a a, God's [word].")
        );
        let repeated = detail
            .phrase_results
            .entries
            .iter()
            .find(|entry| entry.phrase == "a a")
            .unwrap();
        assert_eq!((repeated.occurrences, repeated.books), (3, 2));
        use crate::detail_lists::{PhraseSort, PhraseSortField, SortDirection};
        for field in [
            PhraseSortField::Phrase,
            PhraseSortField::Occurrences,
            PhraseSortField::Books,
        ] {
            for direction in [SortDirection::Asc, SortDirection::Desc] {
                let page = verses
                    .detail_sorted(
                        &phrases,
                        "Genesis",
                        1,
                        1,
                        0,
                        PhraseSort { field, direction },
                    )
                    .unwrap();
                let mut expected: Vec<_> = detail.phrase_results.entries.iter().collect();
                expected.sort_by(|a, b| {
                    let primary = match field {
                        PhraseSortField::Phrase => a.phrase.cmp(&b.phrase),
                        PhraseSortField::Occurrences => a.occurrences.cmp(&b.occurrences),
                        PhraseSortField::Books => a.books.cmp(&b.books),
                    };
                    let order = primary.then_with(|| a.phrase.cmp(&b.phrase));
                    if matches!(direction, SortDirection::Desc) {
                        order.reverse()
                    } else {
                        order
                    }
                });
                assert_eq!(
                    page.phrase_results
                        .entries
                        .iter()
                        .map(|entry| entry.phrase.as_str())
                        .collect::<Vec<_>>(),
                    expected
                        .iter()
                        .map(|entry| entry.phrase.as_str())
                        .collect::<Vec<_>>()
                );
            }
        }
        let stats = crate::word_stats::WordStatistics::new(&bible);
        let books = crate::book_stats::BookStatistics::new(&bible);
        let marks = verses
            .highlights(&phrases, &stats, &books, "Genesis", 1)
            .unwrap();
        let first = &marks.verses[0];
        assert_eq!(
            first
                .words
                .iter()
                .filter(|word| word.word == "a" && word.first_mention)
                .count(),
            1
        );
        assert_eq!(
            first
                .words
                .iter()
                .find(|word| word.word == "a")
                .unwrap()
                .count,
            5
        );
        assert!(
            !first
                .words
                .iter()
                .find(|word| word.word == "a")
                .unwrap()
                .exclusive
        );
        assert!(
            first
                .words
                .iter()
                .find(|word| word.word == "god's")
                .unwrap()
                .exclusive
        );
        assert!(
            first
                .words
                .iter()
                .find(|word| word.word == "god's")
                .unwrap()
                .first_mention
        );
        let exodus = verses
            .highlights(&phrases, &stats, &books, "Exodus", 1)
            .unwrap();
        assert!(exodus
            .verses
            .iter()
            .flat_map(|verse| &verse.words)
            .all(|word| !word.first_mention));
        assert!(verses
            .highlights(&phrases, &stats, &books, "Genesis", 2)
            .is_err());
        let word_rows = crate::detail_lists::context_words(
            &detail.summary.verse.text,
            &detail.word_parts,
            &stats,
        )
        .unwrap();
        assert_eq!(word_rows.len(), 3);
        assert_eq!(
            (
                word_rows[0].word.as_str(),
                word_rows[0].occurrences,
                word_rows[0].books
            ),
            ("a", 5, 2)
        );
        assert_eq!(
            (word_rows[1].display.as_str(), word_rows[1].letters),
            ("God's", 4)
        );

        let mut all = Vec::new();
        for offset in (0..59).step_by(PAGE_SIZE) {
            let page = verses.detail(&phrases, "Genesis", 1, 2, offset).unwrap();
            assert_eq!(page.summary.phrases, 2294);
            assert_eq!(page.phrase_results.total, 59);
            all.extend(page.phrase_results.entries);
        }
        assert_eq!(all.len(), 59);
        assert!(all.iter().all(|entry| entry.words == 32));
        assert!(all.windows(2).all(|pair| pair[0].phrase < pair[1].phrase));
        let expected_desc: Vec<_> = all.iter().rev().map(|entry| entry.phrase.clone()).collect();
        for field in [
            PhraseSortField::Phrase,
            PhraseSortField::Occurrences,
            PhraseSortField::Books,
        ] {
            let actual: Vec<_> = [0, 50]
                .into_iter()
                .flat_map(|offset| {
                    verses
                        .detail_sorted(
                            &phrases,
                            "Genesis",
                            1,
                            2,
                            offset,
                            PhraseSort {
                                field,
                                direction: SortDirection::Desc,
                            },
                        )
                        .unwrap()
                        .phrase_results
                        .entries
                        .into_iter()
                        .map(|entry| entry.phrase)
                })
                .collect();
            assert_eq!(actual, expected_desc);
        }

        let before = fs::metadata(root.join("pack/verses.json"))
            .unwrap()
            .modified()
            .unwrap();
        phrases.prepare_verses(&bible).unwrap();
        assert_eq!(
            fs::metadata(root.join("pack/verses.json"))
                .unwrap()
                .modified()
                .unwrap(),
            before
        );
        assert!(verses.detail(&phrases, "Genesis", 1, 3, 0).is_err());
        fs::write(root.join("pack/verse-phrases.bin"), b"truncated").unwrap();
        assert!(PreparedVerses::open(&root.join("pack"), &bible, &phrases).is_err());
        phrases.prepare_verses(&bible).unwrap();
        assert!(PreparedVerses::open(&root.join("pack"), &bible, &phrases).is_ok());
        fs::remove_dir_all(root).unwrap();
    }
}
