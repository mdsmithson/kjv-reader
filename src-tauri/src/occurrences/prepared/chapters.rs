//! Read-only chapter profiles prepared once from saved phrase records and word statistics.
use super::*;
use crate::{book_stats::BookStatistics, word_stats::WordStatistics};
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterSummary {
    pub book: String,
    pub chapter: u16,
    pub words: usize,
    pub letters: usize,
    pub unique_words: usize,
    pub first_mention_words: usize,
    pub exclusive_words: usize,
    pub verses: usize,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterWord {
    pub word: String,
    pub display: String,
    pub count: usize,
    pub letters: usize,
    pub books: usize,
    pub bible_count: usize,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterPhrase {
    #[serde(flatten)]
    pub phrase: SavedPhrase,
    pub count: usize,
    pub first_mention_words: usize,
}
#[derive(Clone, Serialize, Deserialize)]
struct Profile {
    summary: ChapterSummary,
    words: Vec<ChapterWord>,
    phrases: Vec<ChapterPhrase>,
}
#[derive(Serialize, Deserialize)]
struct Header {
    format: u32,
    fingerprint: String,
    entries: Vec<ChapterSummary>,
    sizes: Vec<u64>,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Direction {
    Asc,
    Desc,
}
#[derive(Clone, Deserialize)]
pub struct ChapterSort {
    pub field: String,
    pub direction: Direction,
}
#[derive(Serialize)]
pub struct ChapterPage {
    pub total: usize,
    pub entries: Vec<ChapterSummary>,
}
#[derive(Serialize)]
pub struct WordPage {
    pub total: usize,
    pub entries: Vec<ChapterWord>,
}
#[derive(Serialize)]
pub struct PhrasePage {
    pub total: usize,
    pub entries: Vec<ChapterPhrase>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterDetail {
    pub summary: ChapterSummary,
    pub word_results: WordPage,
    pub phrase_results: PhrasePage,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterDetailQuery {
    pub book: String,
    pub chapter: u16,
    #[serde(default)]
    pub word_offset: usize,
    #[serde(default)]
    pub phrase_offset: usize,
    pub word_sort: Option<ChapterSort>,
    pub phrase_sort: Option<ChapterSort>,
    #[serde(default)]
    pub word_filters: ChapterFilters,
    #[serde(default)]
    pub phrase_filters: ChapterFilters,
}
pub type ChapterFilters = BTreeMap<String, serde_json::Value>;
fn matches_filters(
    filters: &ChapterFilters,
    counts: &[(&str, usize)],
    texts: &[(&str, &str)],
    exact_text: bool,
) -> bool {
    filters.iter().all(|(field, value)| {
        if value.is_null() {
            return true;
        }
        if let Some((_, count)) = counts.iter().find(|(name, _)| *name == field) {
            return value.as_u64() == Some(*count as u64);
        }
        if let Some((_, text)) = texts.iter().find(|(name, _)| *name == field) {
            return value.as_str().is_some_and(|query| {
                if exact_text {
                    text.to_lowercase() == query.trim().to_lowercase()
                } else {
                    text.to_lowercase().contains(&query.trim().to_lowercase())
                }
            });
        }
        false
    })
}
pub struct PreparedChapters {
    root: PathBuf,
    header: Header,
    cache: Mutex<HashMap<usize, Arc<Profile>>>,
}
fn read_header(root: &Path, bible: &Bible) -> io::Result<Header> {
    let header: Header = read_json(&root.join("chapters.json"))?;
    let expected = bible
        .catalog()
        .iter()
        .flat_map(|book| (1..=book.chapters).map(move |chapter| (book.name.as_str(), chapter)))
        .collect::<Vec<_>>();
    if header.format != 2
        || header.fingerprint != fingerprint(bible)
        || header.entries.len() != expected.len()
        || header.sizes.len() != expected.len()
        || header
            .entries
            .iter()
            .zip(expected)
            .any(|(entry, (book, chapter))| entry.book != book || entry.chapter != chapter)
        || header.sizes.iter().enumerate().any(|(id, &size)| {
            !fs::metadata(root.join("chapter-profiles").join(format!("{id}.json")))
                .is_ok_and(|file| file.len() == size)
        })
    {
        return Err(invalid("Incomplete prepared chapter profiles"));
    }
    Ok(header)
}
fn order(value: std::cmp::Ordering, sort: &ChapterSort) -> std::cmp::Ordering {
    if matches!(sort.direction, Direction::Desc) {
        value.reverse()
    } else {
        value
    }
}
impl PreparedChapters {
    pub fn open(root: &Path, bible: &Bible) -> Result<Self, String> {
        Ok(Self {
            root: root.into(),
            header: read_header(root, bible).map_err(|e| e.to_string())?,
            cache: Mutex::new(HashMap::new()),
        })
    }
    pub fn page(
        &self,
        book: Option<&str>,
        offset: usize,
        sort: Option<&ChapterSort>,
    ) -> ChapterPage {
        self.page_filtered(book, offset, sort, &ChapterFilters::new())
    }
    pub fn page_filtered(
        &self,
        book: Option<&str>,
        offset: usize,
        sort: Option<&ChapterSort>,
        filters: &ChapterFilters,
    ) -> ChapterPage {
        let mut entries = self
            .header
            .entries
            .iter()
            .enumerate()
            .filter(|(_, entry)| {
                book.is_none_or(|book| entry.book == book)
                    && matches_filters(
                        filters,
                        &[
                            ("chapter", entry.chapter as usize),
                            ("words", entry.words),
                            ("letters", entry.letters),
                            ("uniqueWords", entry.unique_words),
                            ("firstMentionWords", entry.first_mention_words),
                            ("exclusiveWords", entry.exclusive_words),
                        ],
                        &[("book", entry.book.as_str())],
                        true,
                    )
            })
            .collect::<Vec<_>>();
        if let Some(sort) = sort {
            entries.sort_by(|(id, a), (other, b)| {
                let value = match sort.field.as_str() {
                    "book" => a.book.cmp(&b.book),
                    "chapter" => a.chapter.cmp(&b.chapter),
                    "words" => a.words.cmp(&b.words),
                    "letters" => a.letters.cmp(&b.letters),
                    "uniqueWords" => a.unique_words.cmp(&b.unique_words),
                    "firstMentionWords" => a.first_mention_words.cmp(&b.first_mention_words),
                    "exclusiveWords" => a.exclusive_words.cmp(&b.exclusive_words),
                    _ => id.cmp(other),
                };
                order(value, sort).then_with(|| id.cmp(other))
            });
        }
        ChapterPage {
            total: entries.len(),
            entries: entries
                .into_iter()
                .skip(offset)
                .take(PAGE_SIZE)
                .map(|(_, entry)| entry.clone())
                .collect(),
        }
    }
    pub fn detail(&self, query: &ChapterDetailQuery) -> Result<ChapterDetail, String> {
        let id = self
            .header
            .entries
            .iter()
            .position(|entry| entry.book == query.book && entry.chapter == query.chapter)
            .ok_or("Chapter not found")?;
        let profile = {
            let mut cache = self.cache.lock().map_err(|_| "Chapter cache failed")?;
            if let Some(profile) = cache.get(&id) {
                Arc::clone(profile)
            } else {
                let profile: Profile = read_json(
                    &self
                        .root
                        .join("chapter-profiles")
                        .join(format!("{id}.json")),
                )
                .map_err(|e| e.to_string())?;
                let profile = Arc::new(profile);
                if cache.len() >= 8 {
                    if let Some(&key) = cache.keys().next() {
                        cache.remove(&key);
                    }
                }
                cache.insert(id, Arc::clone(&profile));
                profile
            }
        };
        let mut words = profile
            .words
            .iter()
            .filter(|entry| {
                matches_filters(
                    &query.word_filters,
                    &[
                        ("count", entry.count),
                        ("letters", entry.letters),
                        ("books", entry.books),
                        ("bibleCount", entry.bible_count),
                    ],
                    &[("word", entry.word.as_str())],
                    false,
                )
            })
            .collect::<Vec<_>>();
        if let Some(sort) = &query.word_sort {
            words.sort_by(|a, b| {
                let value = match sort.field.as_str() {
                    "count" => a.count.cmp(&b.count),
                    "letters" => a.letters.cmp(&b.letters),
                    "books" => a.books.cmp(&b.books),
                    "bibleCount" => a.bible_count.cmp(&b.bible_count),
                    _ => a.word.cmp(&b.word),
                };
                order(value, sort).then_with(|| a.word.cmp(&b.word))
            });
        }
        let mut phrases = profile
            .phrases
            .iter()
            .filter(|entry| {
                matches_filters(
                    &query.phrase_filters,
                    &[
                        ("words", entry.phrase.words as usize),
                        ("letters", entry.phrase.letters as usize),
                        ("books", entry.phrase.books as usize),
                        ("occurrences", entry.phrase.occurrences as usize),
                        ("count", entry.count),
                        ("firstMentionWords", entry.first_mention_words),
                    ],
                    &[("phrase", entry.phrase.phrase.as_str())],
                    false,
                )
            })
            .collect::<Vec<_>>();
        if let Some(sort) = &query.phrase_sort {
            phrases.sort_by(|a, b| {
                let value = match sort.field.as_str() {
                    "words" => a.phrase.words.cmp(&b.phrase.words),
                    "letters" => a.phrase.letters.cmp(&b.phrase.letters),
                    "books" => a.phrase.books.cmp(&b.phrase.books),
                    "occurrences" => a.phrase.occurrences.cmp(&b.phrase.occurrences),
                    "firstMentionWords" => a.first_mention_words.cmp(&b.first_mention_words),
                    "count" => a.count.cmp(&b.count),
                    _ => a.phrase.phrase.cmp(&b.phrase.phrase),
                };
                order(value, sort).then_with(|| a.phrase.phrase.cmp(&b.phrase.phrase))
            });
        }
        Ok(ChapterDetail {
            summary: profile.summary.clone(),
            word_results: WordPage {
                total: words.len(),
                entries: words
                    .into_iter()
                    .skip(query.word_offset)
                    .take(PAGE_SIZE)
                    .cloned()
                    .collect(),
            },
            phrase_results: PhrasePage {
                total: phrases.len(),
                entries: phrases
                    .into_iter()
                    .skip(query.phrase_offset)
                    .take(PAGE_SIZE)
                    .cloned()
                    .collect(),
            },
        })
    }
}
impl PreparedPhrases {
    pub fn prepare_chapters(
        &self,
        bible: &Bible,
        words: &WordStatistics,
        books: &BookStatistics,
    ) -> Result<(), String> {
        if read_header(&self.root, bible).is_ok() {
            return Ok(());
        }
        let run = || -> io::Result<()> {
            let mut ids = BTreeMap::<(String, u16), usize>::new();
            let mut profiles = Vec::<Profile>::new();
            for book in bible.catalog() {
                let stats = books.get(&book.name).map_err(io::Error::other)?;
                for chapter in &stats.chapters {
                    ids.insert((book.name.clone(), chapter.chapter), profiles.len());
                    profiles.push(Profile {
                        summary: ChapterSummary {
                            book: book.name.clone(),
                            chapter: chapter.chapter,
                            words: chapter.words,
                            letters: 0,
                            unique_words: chapter.unique_words,
                            first_mention_words: 0,
                            exclusive_words: chapter.exclusive_words.len(),
                            verses: 0,
                        },
                        words: Vec::new(),
                        phrases: Vec::new(),
                    });
                }
            }
            let first = self
                .dictionary
                .iter()
                .map(|word| {
                    let entry = words
                        .find_normalized(word)
                        .ok_or_else(|| invalid("Missing word statistics"))?;
                    ids.get(&(
                        entry.first_mention.book.clone(),
                        entry.first_mention.chapter,
                    ))
                    .copied()
                    .ok_or_else(|| invalid("Invalid first mention chapter"))
                })
                .collect::<io::Result<Vec<_>>>()?;
            let mut word_counts = vec![BTreeMap::<String, (String, usize)>::new(); profiles.len()];
            let mut verse_ranges = Vec::new();
            let mut offset = 0;
            for (book, chapter, _, text) in bible.located_passages() {
                let id = ids[&(book.into(), chapter)];
                profiles[id].summary.verses += 1;
                profiles[id].summary.letters += text.chars().filter(|c| c.is_alphabetic()).count();
                let raw = text
                    .split(|c: char| !c.is_alphanumeric() && c != '\'')
                    .map(|word| word.trim_matches('\''))
                    .filter(|word| !word.is_empty())
                    .collect::<Vec<_>>();
                verse_ranges.push((offset, offset + raw.len(), id));
                offset += raw.len();
                for display in raw {
                    let word = display.to_lowercase();
                    let row = word_counts[id].entry(word).or_insert((display.into(), 0));
                    row.1 += 1;
                }
            }
            for (id, counts) in word_counts.into_iter().enumerate() {
                for (word, (display, count)) in counts {
                    let data = words
                        .find_normalized(&word)
                        .ok_or_else(|| invalid("Missing word profile"))?;
                    if data.first_mention.book == profiles[id].summary.book
                        && data.first_mention.chapter == profiles[id].summary.chapter
                    {
                        profiles[id].summary.first_mention_words += 1;
                    }
                    profiles[id].words.push(ChapterWord {
                        word,
                        display,
                        count,
                        letters: data.letters,
                        books: data.books.len(),
                        bible_count: data.count,
                    });
                }
            }
            let mut records = File::open(self.root.join("phrases.bin"))?;
            let mut postings = File::open(self.root.join("postings.bin"))?;
            for &phrase_id in &self.visible.ids {
                let record = self.record(&mut records, phrase_id as usize)?;
                let tokens = self.phrase_tokens(record)?;
                let mut counts = BTreeMap::<usize, usize>::new();
                postings.seek(SeekFrom::Start(record.posting * 4))?;
                for _ in 0..record.verses {
                    let verse_id = read_u32(&mut postings)? as usize;
                    let &(start, end, chapter) = verse_ranges
                        .get(verse_id)
                        .ok_or_else(|| invalid("Invalid chapter phrase posting"))?;
                    let count = self.tokens[start..end]
                        .windows(tokens.len())
                        .filter(|window| *window == tokens)
                        .count();
                    *counts.entry(chapter).or_default() += count;
                }
                if counts.values().sum::<usize>() != record.occurrences as usize {
                    return Err(invalid("Chapter phrase counts disagree with Bible counts"));
                }
                let summary = self.summary(record)?;
                let unique = tokens.iter().copied().collect::<HashSet<_>>();
                for (chapter, count) in counts {
                    let first_mention_words = unique
                        .iter()
                        .filter(|&&token| first[token as usize] == chapter)
                        .count();
                    profiles[chapter].phrases.push(ChapterPhrase {
                        phrase: summary.clone(),
                        count,
                        first_mention_words,
                    });
                }
            }
            let directory = self.root.join("chapter-profiles");
            fs::create_dir_all(&directory)?;
            let mut sizes = Vec::new();
            let mut entries = Vec::new();
            for (id, profile) in profiles.into_iter().enumerate() {
                let path = directory.join(format!("{id}.json"));
                let temporary = directory.join(format!("{id}.tmp"));
                json_file(&temporary, &profile)?;
                fs::rename(temporary, &path)?;
                sizes.push(fs::metadata(path)?.len());
                entries.push(profile.summary);
            }
            json_file(
                &self.root.join("chapters.json"),
                &Header {
                    format: 2,
                    fingerprint: self.manifest.fingerprint.clone(),
                    entries,
                    sizes,
                },
            )
        };
        run().map_err(|e| format!("Unable to prepare chapters: {e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn chapter_profiles_persist_counts_mentions_exclusives_and_sort_pages() {
        let root = std::env::temp_dir().join(format!(
            "kjv-chapters-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let bible=Bible::from_json(r#"{"Genesis 1:1":"God alpha God alpha unique","Genesis 2:1":"God beta","Exodus 1:1":"alpha outside"}"#).unwrap();
        let words = WordStatistics::new(&bible);
        let books = BookStatistics::new(&bible);
        let index = OccurrenceIndex::from_passages(bible.located_passages(), &root.join("cache"));
        let saved = root.join("saved");
        index.prepare_phrases(&saved, 5).unwrap();
        let phrases = PreparedPhrases::open(&saved, &bible).unwrap();
        phrases.prepare_chapters(&bible, &words, &books).unwrap();
        let verify = || {
            let chapters = PreparedChapters::open(&saved, &bible).unwrap();
            assert_eq!(chapters.page(None, 0, None).total, 3);
            assert_eq!(chapters.page(Some("Genesis"), 0, None).total, 2);
            let q = ChapterDetailQuery {
                book: "Genesis".into(),
                chapter: 1,
                word_offset: 0,
                phrase_offset: 0,
                word_sort: None,
                phrase_sort: None,
                word_filters: Default::default(),
                phrase_filters: Default::default(),
            };
            let d = chapters.detail(&q).unwrap();
            assert_eq!(
                (
                    d.summary.words,
                    d.summary.letters,
                    d.summary.unique_words,
                    d.summary.first_mention_words,
                    d.summary.exclusive_words
                ),
                (5, 22, 3, 3, 1)
            );
            let god = d
                .word_results
                .entries
                .iter()
                .find(|row| row.word == "god")
                .unwrap();
            assert_eq!(
                (
                    god.display.as_str(),
                    god.count,
                    god.bible_count,
                    god.letters,
                    god.books
                ),
                ("God", 2, 3, 3, 1)
            );
            let pair = d
                .phrase_results
                .entries
                .iter()
                .find(|row| row.phrase.phrase == "god alpha")
                .unwrap();
            assert_eq!(
                (
                    pair.count,
                    pair.first_mention_words,
                    pair.phrase.words,
                    pair.phrase.books
                ),
                (2, 2, 2, 1)
            );
            for field in [
                "words",
                "letters",
                "uniqueWords",
                "firstMentionWords",
                "exclusiveWords",
                "chapter",
                "book",
            ] {
                let asc = chapters.page(
                    None,
                    0,
                    Some(&ChapterSort {
                        field: field.into(),
                        direction: Direction::Asc,
                    }),
                );
                assert_eq!(asc.entries.len(), 3);
            }
            let filters: ChapterFilters = serde_json::from_value(
                serde_json::json!({"book":"genesis", "letters":22, "chapter":1}),
            )
            .unwrap();
            assert_eq!(chapters.page_filtered(None, 0, None, &filters).total, 1);
            let filters: ChapterFilters =
                serde_json::from_value(serde_json::json!({"exclusiveWords":0})).unwrap();
            assert_eq!(chapters.page_filtered(None, 0, None, &filters).total, 0);
            let filtered = chapters.detail(&ChapterDetailQuery {
                word_filters: serde_json::from_value(serde_json::json!({"word":"GO", "count":2,"letters":3,"books":1,"bibleCount":3})).unwrap(),
                phrase_filters: serde_json::from_value(serde_json::json!({"phrase":"god alpha", "words":2,"firstMentionWords":2,"count":2,"books":1,"occurrences":2,"letters":8})).unwrap(),
                ..q.clone()
            }).unwrap();
            assert_eq!(filtered.word_results.total, 1);
            assert_eq!(filtered.word_results.entries[0].word, "god");
            assert_eq!(filtered.phrase_results.total, 1);
            let empty = chapters
                .detail(&ChapterDetailQuery {
                    word_filters: serde_json::from_value(serde_json::json!({"letters":999}))
                        .unwrap(),
                    phrase_filters: serde_json::from_value(serde_json::json!({"words":999}))
                        .unwrap(),
                    ..q.clone()
                })
                .unwrap();
            assert_eq!(
                (empty.word_results.total, empty.phrase_results.total),
                (0, 0)
            );
            let d = chapters
                .detail(&ChapterDetailQuery {
                    word_sort: Some(ChapterSort {
                        field: "count".into(),
                        direction: Direction::Desc,
                    }),
                    word_offset: 1,
                    ..q
                })
                .unwrap();
            assert_eq!(d.word_results.total, 3);
            assert_eq!(d.word_results.entries.len(), 2);
            assert!(d
                .word_results
                .entries
                .windows(2)
                .all(|rows| rows[0].count >= rows[1].count));
        };
        verify();
        let stamp = fs::metadata(saved.join("chapters.json"))
            .unwrap()
            .modified()
            .unwrap();
        phrases.prepare_chapters(&bible, &words, &books).unwrap();
        assert_eq!(
            stamp,
            fs::metadata(saved.join("chapters.json"))
                .unwrap()
                .modified()
                .unwrap()
        );
        fs::write(saved.join("chapter-profiles/0.json"), b"{}").unwrap();
        assert!(PreparedChapters::open(&saved, &bible).is_err());
        phrases.prepare_chapters(&bible, &words, &books).unwrap();
        verify();
        fs::remove_dir_all(root).unwrap();
    }
}
