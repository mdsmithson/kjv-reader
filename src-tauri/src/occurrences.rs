//! Persistent n-gram counts and positional summaries, with cached filtered pages.
pub mod exclusive;
pub mod catalogue;
pub mod prepared;
use crate::spatial::{Position, Spatial};
use crate::text::words;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{self, BufWriter, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

const MAGIC: &[u8; 8] = b"KJVNGRM4";
const SELECTION_MAGIC: &[u8; 8] = b"KJVSEL04";
const VERSION: u32 = 4;
const HEADER_SIZE: u64 = 64;
pub const MAX_WORDS: u16 = 32;
const PAGE_SIZE: usize = crate::bible::PAGE_SIZE;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OccurrenceQuery {
    pub count: u32,
    #[serde(default)]
    pub count_up_to: bool,
    pub words: u16,
    pub up_to: bool,
    pub offset: usize,
    pub books: Option<u16>,
    #[serde(default)]
    pub books_up_to: bool,
    pub letters: Option<u32>,
    #[serde(default)]
    pub letters_up_to: bool,
    pub consecutive_verses: Option<u16>,
    pub consecutive_chapters: Option<u16>,
    pub chapter_frequency: Option<u32>,
    pub included_books: Option<Vec<String>>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PhraseCount {
    pub phrase: String,
    pub words: u16,
    pub count: u32,
    pub books: u16,
    pub letters: u32,
    pub max_verse_run: u16,
    pub max_chapter_run: u16,
    pub max_chapter_frequency: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OccurrencePage {
    pub total: usize,
    pub entries: Vec<PhraseCount>,
    pub built_lengths: Vec<u16>,
    pub built_filters: bool,
    pub elapsed_ms: u128,
}

#[derive(Clone)]
struct TokenVerse {
    position: Position,
    tokens: Arc<Vec<u32>>,
}

pub struct OccurrenceIndex {
    dictionary: Arc<Vec<String>>,
    token_letters: Arc<Vec<u32>>,
    verses: Vec<TokenVerse>,
    fingerprint: [u8; 32],
    directory: PathBuf,
    prebuilt_directory: Option<PathBuf>,
    build_lock: Mutex<()>,
    book_ids: HashMap<String, usize>,
    scopes: Mutex<HashMap<u128, std::sync::Arc<OccurrenceIndex>>>,
}

fn invalid(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

fn read_u32(file: &mut File) -> io::Result<u32> {
    let mut bytes = [0; 4];
    file.read_exact(&mut bytes)?;
    Ok(u32::from_le_bytes(bytes))
}

fn read_u64(file: &mut File) -> io::Result<u64> {
    let mut bytes = [0; 8];
    file.read_exact(&mut bytes)?;
    Ok(u64::from_le_bytes(bytes))
}

fn stride(length: u16) -> u64 {
    // count, books, letters, verse run, chapter run, max chapter count,
    // chapter-frequency byte offset (u64), chapter-frequency item count, tokens.
    4 * (u64::from(length) + 9)
}

fn letter_count(text: &str) -> u32 {
    text.chars().filter(|character| character.is_alphabetic()).count() as u32
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[derive(Default)]
struct Frequency {
    count: u32,
    books: u128,
    letters: u32,
    spatial: Spatial,
}

fn compare_frequency(
    (left_words, left): &(&[u32], Frequency),
    (right_words, right): &(&[u32], Frequency),
) -> std::cmp::Ordering {
    left.count.cmp(&right.count)
        .then_with(|| left.books.count_ones().cmp(&right.books.count_ones()))
        .then_with(|| left.letters.cmp(&right.letters))
        .then_with(|| left_words.cmp(right_words))
}

fn frequencies<'a>(verses: &'a [TokenVerse], length: u16, token_letters: &[u32]) -> Vec<(&'a [u32], Frequency)> {
    let counts = verses.iter()
        .filter(|line| line.tokens.len() >= usize::from(length))
        .flat_map(|line| line.tokens.windows(usize::from(length)).map(move |window| (line.position, window)))
        .fold(HashMap::<&[u32], Frequency>::new(), |mut counts, (position, window)| {
            let frequency = counts.entry(window).or_insert_with(|| Frequency {
                letters: window.iter().map(|token| token_letters[*token as usize]).sum(),
                ..Frequency::default()
            });
            frequency.count += 1;
            frequency.books |= position.book;
            frequency.spatial.observe(position);
            counts
        });
    let mut entries: Vec<_> = counts.into_iter().map(|(tokens, mut frequency)| {
        frequency.spatial.finish();
        (tokens, frequency)
    }).collect();
    entries.sort_unstable_by(compare_frequency);
    entries
}

struct Record {
    count: u32,
    books: u16,
    letters: u32,
    max_verse_run: u16,
    max_chapter_run: u16,
    max_chapter_frequency: u32,
    frequencies_offset: u64,
    frequencies_count: u32,
}

impl Record {
    fn read(file: &mut File) -> io::Result<Self> {
        Ok(Self {
            count: read_u32(file)?,
            books: read_u32(file)? as u16,
            letters: read_u32(file)?,
            max_verse_run: read_u32(file)? as u16,
            max_chapter_run: read_u32(file)? as u16,
            max_chapter_frequency: read_u32(file)?,
            frequencies_offset: read_u64(file)?,
            frequencies_count: read_u32(file)?,
        })
    }

    fn matches(&self, file: &mut File, query: &OccurrenceQuery) -> io::Result<bool> {
        if query.books.is_some_and(|books| if query.books_up_to { self.books > books } else { self.books != books })
            || query.letters.is_some_and(|letters| if query.letters_up_to { self.letters > letters } else { self.letters != letters }) {
            return Ok(false);
        }
        if query.consecutive_verses.is_some_and(|minimum| self.max_verse_run < minimum)
            || query.consecutive_chapters.is_some_and(|minimum| self.max_chapter_run < minimum) {
            return Ok(false);
        }
        match query.chapter_frequency {
            Some(count) if count <= self.max_chapter_frequency => {
                // The distinct per-chapter frequencies are sorted. Seek only O(log D)
                // items to test membership, rather than reading all matching chapters.
                let (mut low, mut high) = (0, self.frequencies_count);
                while low < high {
                    let middle = low + (high - low) / 2;
                    file.seek(SeekFrom::Start(self.frequencies_offset + u64::from(middle) * 4))?;
                    if read_u32(file)? < count { low = middle + 1; } else { high = middle; }
                }
                if low == self.frequencies_count { return Ok(false); }
                file.seek(SeekFrom::Start(self.frequencies_offset + u64::from(low) * 4))?;
                Ok(read_u32(file)? == count)
            }
            Some(_) => Ok(false),
            None => Ok(true),
        }
    }
}

enum Selection {
    Ranges(Vec<(u64, u64)>),
    Saved(File, u64),
}

impl Selection {
    fn total(&self) -> u64 {
        match self {
            Self::Ranges(ranges) => ranges.iter().map(|(start, end)| end - start).sum(),
            Self::Saved(_, total) => *total,
        }
    }

    fn page(&mut self, mut offset: u64, limit: usize) -> io::Result<Vec<u64>> {
        match self {
            Self::Saved(file, total) => {
                let remaining = total.saturating_sub(offset).min(limit as u64);
                if remaining == 0 { return Ok(Vec::new()); }
                file.seek(SeekFrom::Start(16 + offset * 8))?;
                (0..remaining).map(|_| read_u64(file)).collect()
            }
            Self::Ranges(ranges) => {
                let mut page = Vec::new();
                for (start, end) in ranges {
                    let count = *end - *start;
                    if offset >= count { offset -= count; continue; }
                    let take = (count - offset).min((limit - page.len()) as u64);
                    page.extend(*start + offset..*start + offset + take);
                    offset = 0;
                    if page.len() == limit { break; }
                }
                Ok(page)
            }
        }
    }
}

impl OccurrenceIndex {
    /// Convenience constructor for small synthetic corpora, one chapter per book.
    pub fn new<'a>(passages: impl Iterator<Item = (&'a str, &'a str)>, root: &Path) -> Self {
        Self::from_passages(passages.enumerate().map(|(index, (book, text))| {
            (book, 1, (index + 1) as u16, text)
        }), root)
    }

    pub fn from_passages<'a>(passages: impl Iterator<Item = (&'a str, u16, u16, &'a str)>, root: &Path) -> Self {
        let mut digest = Sha256::new();
        let mut book_ids = HashMap::new();
        let word_lines: Vec<_> = passages.map(|(book, chapter, verse, text)| {
            digest.update((book.len() as u64).to_le_bytes());
            digest.update(book.as_bytes());
            digest.update(chapter.to_le_bytes());
            digest.update(verse.to_le_bytes());
            digest.update((text.len() as u64).to_le_bytes());
            digest.update(text.as_bytes());
            let next = book_ids.len();
            let book_id = *book_ids.entry(book).or_insert(next);
            assert!(book_id < 128, "Book bitset supports up to 128 distinct books");
            (Position { book: 1u128 << book_id, chapter, verse }, words(text))
        }).collect();
        let fingerprint: [u8; 32] = digest.finalize().into();
        let unique: HashSet<&str> = word_lines.iter().flat_map(|(_, line)| line).map(String::as_str).collect();
        let mut dictionary: Vec<String> = unique.into_iter().map(str::to_owned).collect();
        dictionary.sort_unstable();
        let token_letters = dictionary.iter().map(|word| letter_count(word)).collect();
        let ids: HashMap<&str, u32> = dictionary.iter().enumerate()
            .map(|(index, word)| (word.as_str(), index as u32)).collect();
        let verses = word_lines.iter().map(|(position, line)| TokenVerse {
            position: *position,
            tokens: Arc::new(line.iter().map(|word| ids[word.as_str()]).collect()),
        }).collect();
        let directory = root.join(format!("occurrences-v{VERSION}-{}", hex(&fingerprint)));
        Self { dictionary: Arc::new(dictionary), token_letters: Arc::new(token_letters), verses, fingerprint, directory, prebuilt_directory: None, build_lock: Mutex::new(()), book_ids: book_ids.into_iter().map(|(name, id)| (name.to_owned(), id)).collect(), scopes: Mutex::new(HashMap::new()) }
    }

    pub fn with_prebuilt(mut self, root: &Path) -> Self {
        self.prebuilt_directory = self.directory.file_name().map(|name| root.join(name));
        self
    }
    fn read_file(&self, name: &str) -> io::Result<File> {
        match File::open(self.directory.join(name)) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                if let Some(root) = &self.prebuilt_directory { File::open(root.join(name)) } else { Err(error) }
            }
            result => result,
        }
    }
    fn path(&self, length: u16) -> PathBuf {
        self.directory.join(format!("words-{length}.bin"))
    }

    fn open(&self, length: u16) -> io::Result<(File, u64)> {
        let mut file = self.read_file(&format!("words-{length}.bin"))?;
        let mut magic = [0; 8];
        file.read_exact(&mut magic)?;
        let version = read_u32(&mut file)?;
        let stored_length = read_u32(&mut file)?;
        let mut fingerprint = [0; 32];
        file.read_exact(&mut fingerprint)?;
        let records = read_u64(&mut file)?;
        let frequencies = read_u64(&mut file)?;
        let expected = records.checked_mul(stride(length))
            .and_then(|size| frequencies.checked_mul(4).and_then(|extra| size.checked_add(extra)))
            .and_then(|size| size.checked_add(HEADER_SIZE));
        if &magic != MAGIC || version != VERSION || stored_length != u32::from(length)
            || fingerprint != self.fingerprint || expected != Some(file.metadata()?.len()) {
            return Err(invalid("Invalid occurrence index header or file size"));
        }
        Ok((file, records))
    }

    fn temporary(&self, prefix: &str) -> PathBuf {
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
        self.directory.join(format!("{prefix}-{}-{nonce}.tmp", std::process::id()))
    }

    fn publish(&self, temporary: &Path, destination: &Path) -> io::Result<()> {
        if destination.exists() {
            fs::rename(destination, self.temporary("previous-invalid"))?;
        }
        fs::rename(temporary, destination)
    }

    fn build(&self, length: u16) -> io::Result<()> {
        let entries = frequencies(&self.verses, length, &self.token_letters);
        fs::create_dir_all(&self.directory)?;
        let temporary = self.temporary(&format!("words-{length}"));
        let output = OpenOptions::new().write(true).create_new(true).open(&temporary)?;
        let mut writer = BufWriter::new(output);
        writer.write_all(MAGIC)?;
        writer.write_all(&VERSION.to_le_bytes())?;
        writer.write_all(&u32::from(length).to_le_bytes())?;
        writer.write_all(&self.fingerprint)?;
        writer.write_all(&(entries.len() as u64).to_le_bytes())?;
        let frequencies_count: u64 = entries.iter().map(|(_, frequency)| frequency.spatial.chapter_frequencies.len() as u64).sum();
        writer.write_all(&frequencies_count.to_le_bytes())?;
        let mut offset = HEADER_SIZE + entries.len() as u64 * stride(length);
        for (tokens, frequency) in &entries {
            let spatial = &frequency.spatial;
            for value in [frequency.count, frequency.books.count_ones(), frequency.letters,
                u32::from(spatial.max_verse_run), u32::from(spatial.max_chapter_run),
                *spatial.chapter_frequencies.last().unwrap_or(&0)] {
                writer.write_all(&value.to_le_bytes())?;
            }
            writer.write_all(&offset.to_le_bytes())?;
            writer.write_all(&(spatial.chapter_frequencies.len() as u32).to_le_bytes())?;
            for token in *tokens { writer.write_all(&token.to_le_bytes())?; }
            offset += spatial.chapter_frequencies.len() as u64 * 4;
        }
        for (_, frequency) in &entries {
            for count in &frequency.spatial.chapter_frequencies { writer.write_all(&count.to_le_bytes())?; }
        }
        writer.flush()?;
        writer.get_ref().sync_all()?;
        drop(writer);
        if self.open(length).is_ok() { fs::remove_file(&temporary)?; return Ok(()); }
        self.publish(&temporary, &self.path(length))
    }

    fn ensure(&self, length: u16) -> io::Result<(File, u64, bool)> {
        let _guard = self.build_lock.lock().map_err(|_| invalid("Occurrence build lock was poisoned"))?;
        match self.open(length) {
            Ok((file, records)) => Ok((file, records, false)),
            Err(error) if rebuildable(&error) => {
                self.build(length)?;
                let (file, records) = self.open(length)?;
                Ok((file, records, true))
            }
            Err(error) => Err(error),
        }
    }

    fn selection(&self, file: &mut File, records: u64, length: u16, query: &OccurrenceQuery, ranges: Vec<(u64, u64)>) -> io::Result<(Selection, bool)> {
        if query.consecutive_verses.is_none() && query.consecutive_chapters.is_none() && query.chapter_frequency.is_none()
            && !(query.count_up_to && (query.books.is_some() || query.letters.is_some())) {
            return Ok((Selection::Ranges(ranges), false));
        }
        let key = OccurrenceQuery { offset: 0, words: length, up_to: false, ..query.clone() };
        let serialized = serde_json::to_vec(&key).map_err(io::Error::other)?;
        let path = self.directory.join(format!("selection-{length}-{}.bin", hex(&Sha256::digest(serialized))));
        let _guard = self.build_lock.lock().map_err(|_| invalid("Occurrence build lock was poisoned"))?;
        match open_selection(&path, records) {
            Ok(selection) => return Ok((selection, false)),
            Err(error) if rebuildable(&error) => {}
            Err(error) => return Err(error),
        }
        let mut matching = Vec::new();
        for (start, end) in ranges {
            for index in start..end {
                file.seek(SeekFrom::Start(HEADER_SIZE + index * stride(length)))?;
                let record = Record::read(file)?;
                if record.matches(file, query)? { matching.push(index); }
            }
        }
        let temporary = self.temporary("selection");
        fs::create_dir_all(&self.directory)?;
        let mut writer = BufWriter::new(OpenOptions::new().create_new(true).write(true).open(&temporary)?);
        writer.write_all(SELECTION_MAGIC)?;
        writer.write_all(&(matching.len() as u64).to_le_bytes())?;
        for index in matching { writer.write_all(&index.to_le_bytes())?; }
        writer.flush()?;
        writer.get_ref().sync_all()?;
        drop(writer);
        self.publish(&temporary, &path)?;
        Ok((open_selection(&path, records)?, true))
    }

    pub fn search(&self, query: &OccurrenceQuery) -> Result<OccurrencePage, String> {
        if query.count == 0 || query.words == 0 || query.words > MAX_WORDS
            || query.books.is_some_and(|books| books == 0 || books > 66)
            || query.consecutive_verses == Some(0) || query.consecutive_chapters == Some(0)
            || query.chapter_frequency == Some(0) {
            return Err(format!("Use positive counts, 1–{MAX_WORDS} words, and 1–66 books. Letter counts may be zero."));
        }
        if let Some(names) = &query.included_books {
            if names.is_empty() { return Err("Choose at least one book.".into()); }
            let mask = names.iter().try_fold(0u128, |mask, name| {
                self.book_ids.get(name).map(|id| mask | (1u128 << id))
                    .ok_or_else(|| format!("Unknown book: {name}"))
            })?;
            let scope = {
                let mut scopes = self.scopes.lock().map_err(|_| "Book selection lock failed")?;
                // Keep a small working set; active workers retain their shared index.
                if !scopes.contains_key(&mask) && scopes.len() >= 4 {
                    if let Some(key) = scopes.iter().find(|(_, index)| Arc::strong_count(index) == 1).map(|(&key, _)| key) {
                        scopes.remove(&key);
                    }
                }
                std::sync::Arc::clone(scopes.entry(mask).or_insert_with(|| {
                    let mut digest = Sha256::new();
                    digest.update(self.fingerprint);
                    digest.update(mask.to_le_bytes());
                    let fingerprint: [u8; 32] = digest.finalize().into();
                    std::sync::Arc::new(Self {
                        dictionary: self.dictionary.clone(), token_letters: self.token_letters.clone(),
                        verses: self.verses.iter().filter(|verse| verse.position.book & mask != 0).cloned().collect(),
                        fingerprint, directory: self.directory.join(format!("books-{}", hex(&fingerprint))),
                        prebuilt_directory: None, build_lock: Mutex::new(()), book_ids: self.book_ids.clone(), scopes: Mutex::new(HashMap::new()),
                    })
                }))
            };
            return scope.search(&OccurrenceQuery { included_books: None, ..query.clone() });
        }
        self.search_page(query).map_err(|error| format!("Unable to build or read saved occurrence data: {error}"))
    }

    fn search_page(&self, query: &OccurrenceQuery) -> io::Result<OccurrencePage> {
        let started = Instant::now();
        let lengths = if query.up_to { 1..=query.words } else { query.words..=query.words };
        let mut selected = Vec::new();
        let mut built_lengths = Vec::new();
        let mut built_filters = false;
        let mut total = 0;
        for length in lengths {
            let (mut file, records, built) = self.ensure(length)?;
            if built { built_lengths.push(length); }
            let mut ranges = Vec::new();
            for (from, to) in query_ranges(query) {
                let start = lower_bound(&mut file, length, records, from)?;
                let end = lower_bound(&mut file, length, records, to)?;
                if start != end { ranges.push((start, end)); }
            }
            let (selection, filtered) = self.selection(&mut file, records, length, query, ranges)?;
            total += selection.total() as usize;
            built_filters |= filtered;
            selected.push((length, file, records, selection));
        }
        let mut offset = query.offset as u64;
        let mut entries = Vec::new();
        for (length, mut file, records, mut selection) in selected {
            if offset >= selection.total() { offset -= selection.total(); continue; }
            for index in selection.page(offset, PAGE_SIZE - entries.len())? {
                if index >= records { return Err(invalid("Invalid saved occurrence selection")); }
                file.seek(SeekFrom::Start(HEADER_SIZE + index * stride(length)))?;
                let record = Record::read(&mut file)?;
                let phrase = (0..length).map(|_| {
                    let token = read_u32(&mut file)?;
                    self.dictionary.get(token as usize).map(String::as_str)
                        .ok_or_else(|| invalid("Invalid token ID in occurrence index"))
                }).collect::<io::Result<Vec<_>>>()?.join(" ");
                entries.push(PhraseCount {
                    phrase, words: length, count: record.count, books: record.books, letters: record.letters,
                    max_verse_run: record.max_verse_run, max_chapter_run: record.max_chapter_run,
                    max_chapter_frequency: record.max_chapter_frequency,
                });
            }
            offset = 0;
            if entries.len() == PAGE_SIZE { break; }
        }
        Ok(OccurrencePage { total, entries, built_lengths, built_filters, elapsed_ms: started.elapsed().as_millis() })
    }
}

fn rebuildable(error: &io::Error) -> bool {
    matches!(error.kind(), io::ErrorKind::NotFound | io::ErrorKind::InvalidData | io::ErrorKind::UnexpectedEof)
}

fn open_selection(path: &Path, records: u64) -> io::Result<Selection> {
    let mut file = File::open(path)?;
    let mut magic = [0; 8];
    file.read_exact(&mut magic)?;
    let count = read_u64(&mut file)?;
    let expected = count.checked_mul(8).and_then(|size| size.checked_add(16));
    if &magic != SELECTION_MAGIC || count > records || expected != Some(file.metadata()?.len()) {
        return Err(invalid("Invalid saved selection header or size"));
    }
    Ok(Selection::Saved(file, count))
}

type IndexKey = (u64, u32, u64);

fn query_ranges(query: &OccurrenceQuery) -> Vec<(IndexKey, IndexKey)> {
    let count = u64::from(query.count);
    // A single range bounds every positive frequency through the requested maximum.
    // Book/letter restrictions within this range use cached metadata selections.
    if query.count_up_to { return vec![((1, 0, 0), (count + 1, 0, 0))]; }
    match query.letters {
        Some(letters) => {
            let requested_maximum = query.books.unwrap_or(66);
            let maximum = requested_maximum.min(query.count.min(66) as u16);
            let minimum = if query.books.is_some() && !query.books_up_to { requested_maximum } else { 1 };
            (minimum..=maximum).map(|books| (
                (count, u32::from(books), if query.letters_up_to { 0 } else { u64::from(letters) }),
                (count, u32::from(books), u64::from(letters) + 1),
            )).collect()
        }
        None => vec![match query.books {
            Some(books) => (
                (count, if query.books_up_to { 0 } else { u32::from(books) }, 0),
                (count, u32::from(books) + 1, 0),
            ),
            None => ((count, 0, 0), (count + 1, 0, 0)),
        }],
    }
}

fn lower_bound(file: &mut File, length: u16, records: u64, target: IndexKey) -> io::Result<u64> {
    let (mut low, mut high) = (0, records);
    while low < high {
        let middle = low + (high - low) / 2;
        file.seek(SeekFrom::Start(HEADER_SIZE + middle * stride(length)))?;
        let mut bytes = [0; 12];
        file.read_exact(&mut bytes)?;
        let key = (
            u64::from(u32::from_le_bytes(bytes[0..4].try_into().unwrap())),
            u32::from_le_bytes(bytes[4..8].try_into().unwrap()),
            u64::from(u32::from_le_bytes(bytes[8..12].try_into().unwrap())),
        );
        if key < target { low = middle + 1; } else { high = middle; }
    }
    Ok(low)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_supported_lengths_include_every_phrase_and_reuse_indices() {
        let index = OccurrenceIndex::new([("Genesis", "a b c d")].into_iter(), &cache_root());
        let request = query(1, MAX_WORDS, true, 0);
        let page = index.search(&request).unwrap();
        assert_eq!(page.total, 10);
        assert_eq!(page.entries.iter().map(|entry| entry.words).collect::<HashSet<_>>(), HashSet::from([1, 2, 3, 4]));
        let reused = index.search(&request).unwrap();
        assert!(reused.built_lengths.is_empty());
        assert_eq!(page.entries, reused.entries);
    }

    #[test]
    fn up_to_counts_combine_with_all_filters_and_selected_books() {
        let passages = [("Genesis", 1, 1, "a a bb bb ccc"), ("Genesis", 1, 2, "a bb dddd"), ("Genesis", 2, 1, "a ccc"), ("Exodus", 1, 1, "a bb eeeee")];
        let root = cache_root();
        let index = OccurrenceIndex::from_passages(passages.into_iter(), &root);
        for up_to in [false, true] {
            for (books, books_up_to) in [(None, false), (Some(1), false), (Some(2), false), (Some(2), true)] {
                for (letters, letters_up_to) in [(None, false), (Some(2), false), (Some(4), true), (Some(0), true)] {
                    for spatial in [false, true] {
                        for included_books in [None, Some(vec!["Genesis".into()])] {
                            let request = OccurrenceQuery {
                                count_up_to: true, books, books_up_to, letters, letters_up_to,
                                consecutive_verses: spatial.then_some(2),
                                consecutive_chapters: spatial.then_some(2),
                                chapter_frequency: spatial.then_some(3), included_books,
                                ..query(3, 2, up_to, 0)
                            };
                            let mut expected = Vec::new();
                            for count in 1..=3 {
                                expected.extend(index.search(&OccurrenceQuery { count, count_up_to: false, ..request.clone() }).unwrap().entries);
                            }
                            expected.sort_by(|a, b| (a.words, a.count, a.books, a.letters, &a.phrase).cmp(&(b.words, b.count, b.books, b.letters, &b.phrase)));
                            let page = index.search(&request).unwrap();
                            assert_eq!(page.total, expected.len());
                            assert_eq!(page.entries, expected);
                            let reused = index.search(&request).unwrap();
                            assert!(!reused.built_filters);
                            assert_eq!(reused.entries, expected);
                        }
                    }
                }
            }
        }
        let request = OccurrenceQuery { count_up_to: true, books: Some(1), letters: Some(4), letters_up_to: true, ..query(3, 1, false, 0) };
        let restarted = OccurrenceIndex::from_passages(passages.into_iter(), &root);
        assert_eq!(restarted.search(&request).unwrap().entries, index.search(&request).unwrap().entries);
    }

    #[test]
    fn up_to_count_pages_and_maximum_do_not_skip_or_duplicate_matches() {
        let line = (0..120).map(|number| {
            let word = format!("word{number}");
            if number % 2 == 0 { format!("{word} {word}") } else { word }
        }).collect::<Vec<_>>().join(" ");
        let index = OccurrenceIndex::new([("Genesis", line.as_str())].into_iter(), &cache_root());
        let request = OccurrenceQuery { count_up_to: true, ..query(u32::MAX, 1, false, 0) };
        let mut all = Vec::new();
        for offset in [0, 50, 100] {
            let page = index.search(&OccurrenceQuery { offset, ..request.clone() }).unwrap();
            assert_eq!(page.total, 120);
            all.extend(page.entries);
        }
        assert_eq!(all.len(), 120);
        assert_eq!(all.iter().map(|entry| &entry.phrase).collect::<HashSet<_>>().len(), 120);
        assert!(all[..60].iter().all(|entry| entry.count == 1));
        assert!(all[60..].iter().all(|entry| entry.count == 2));
        assert_eq!(index.search(&OccurrenceQuery { count: 1, ..request.clone() }).unwrap().total, 60);
        assert!(index.search(&OccurrenceQuery { count: 0, ..request }).is_err());
    }

    #[test]
    fn selected_books_recount_all_filters_and_reuse_across_order_and_restart() {
        let passages = [("Genesis", 1, 1, "alpha alpha shared"), ("Exodus", 1, 1, "alpha shared shared")];
        let root = cache_root();
        let index = OccurrenceIndex::from_passages(passages.into_iter(), &root);
        let selected = OccurrenceQuery { included_books: Some(vec!["Genesis".into()]), books: Some(1), chapter_frequency: Some(2), ..query(2, 1, false, 0) };
        let page = index.search(&selected).unwrap();
        assert_eq!(page.entries[0].phrase, "alpha");
        assert_eq!(page.entries[0].count, 2);
        assert!(index.search(&selected).unwrap().built_lengths.is_empty());
        let restarted = OccurrenceIndex::from_passages(passages.into_iter(), &root);
        assert!(restarted.search(&selected).unwrap().built_lengths.is_empty());
        let both = OccurrenceQuery { included_books: Some(vec!["Exodus".into(), "Genesis".into()]), ..query(3, 1, false, 0) };
        assert_eq!(index.search(&both).unwrap().total, 2);
        let reversed = OccurrenceQuery { included_books: Some(vec!["Genesis".into(), "Exodus".into(), "Genesis".into()]), ..both.clone() };
        assert!(index.search(&reversed).unwrap().built_lengths.is_empty());
        assert!(index.search(&OccurrenceQuery { included_books: Some(vec![]), ..selected.clone() }).is_err());
        assert!(index.search(&OccurrenceQuery { included_books: Some(vec!["Missing".into()]), ..selected.clone() }).is_err());
    }

    #[test]
    fn consecutive_runs_and_exact_chapter_counts_use_real_locations() {
        let passages = [
            ("Genesis", 1, 1, "alpha alpha beta"),
            ("Genesis", 1, 2, "alpha beta"),
            ("Genesis", 1, 3, "alpha beta"),
            ("Genesis", 1, 4, "beta edge"),
            ("Genesis", 1, 5, "alpha"),
            ("Genesis", 2, 1, "alpha beta edge"),
            ("Genesis", 3, 1, "alpha"),
            ("Genesis", 5, 1, "alpha"),
            ("Exodus", 1, 1, "alpha"),
        ];
        let root = cache_root();
        let index = OccurrenceIndex::from_passages(passages.into_iter(), &root);
        let request = OccurrenceQuery {
            consecutive_verses: Some(3), consecutive_chapters: Some(3),
            chapter_frequency: Some(5), ..query(9, 1, false, 0)
        };
        let page = index.search(&request).unwrap();
        assert_eq!(page.total, 1);
        assert_eq!(page.entries[0].phrase, "alpha");
        assert_eq!(page.entries[0].max_verse_run, 3);
        assert_eq!(page.entries[0].max_chapter_run, 3);
        assert_eq!(page.entries[0].max_chapter_frequency, 5);
        assert!(page.built_filters);
        assert!(!index.search(&request).unwrap().built_filters);
        assert_eq!(index.search(&OccurrenceQuery { chapter_frequency: Some(3), ..request.clone() }).unwrap().total, 0);
        assert_eq!(index.search(&OccurrenceQuery { consecutive_verses: Some(4), ..request.clone() }).unwrap().total, 0);
        assert_eq!(index.search(&OccurrenceQuery { consecutive_chapters: Some(4), ..request.clone() }).unwrap().total, 0);
        let restarted = OccurrenceIndex::from_passages(passages.into_iter(), &root);
        let reused = restarted.search(&request).unwrap();
        assert_eq!(reused.entries, page.entries);
        assert!(reused.built_lengths.is_empty());
        assert!(!reused.built_filters);
        let beta = index.search(&OccurrenceQuery { consecutive_verses: Some(4), consecutive_chapters: Some(2), chapter_frequency: Some(4), ..query(5, 1, false, 0) }).unwrap();
        assert_eq!(beta.entries[0].phrase, "beta");
        let edge = index.search(&OccurrenceQuery { consecutive_verses: Some(2), ..query(2, 1, false, 0) }).unwrap();
        assert_eq!(edge.total, 0);
        assert_eq!(index.search(&OccurrenceQuery { consecutive_chapters: Some(2), ..query(2, 1, false, 0) }).unwrap().total, 1);
    }

    #[test]
    fn repeated_matches_do_not_extend_runs_and_book_boundaries_reset() {
        let index = OccurrenceIndex::from_passages([
            ("Genesis", 1, 1, "a a a a"),
            ("Genesis", 2, 1, "a"),
            ("Exodus", 1, 1, "a"),
        ].into_iter(), &cache_root());
        let page = index.search(&query(6, 1, false, 0)).unwrap();
        assert_eq!(page.entries[0].max_verse_run, 1);
        assert_eq!(page.entries[0].max_chapter_run, 2);
        assert_eq!(index.search(&OccurrenceQuery { consecutive_verses: Some(2), ..query(6, 1, false, 0) }).unwrap().total, 0);
        assert_eq!(index.search(&OccurrenceQuery { consecutive_chapters: Some(3), ..query(6, 1, false, 0) }).unwrap().total, 0);
        assert_eq!(index.search(&OccurrenceQuery { chapter_frequency: Some(4), ..query(6, 1, false, 0) }).unwrap().total, 1);
        assert_eq!(index.search(&OccurrenceQuery { chapter_frequency: Some(2), ..query(6, 1, false, 0) }).unwrap().total, 0);
        assert!(index.search(&OccurrenceQuery { consecutive_verses: Some(0), ..query(6, 1, false, 0) }).is_err());
        assert!(index.search(&OccurrenceQuery { consecutive_chapters: Some(0), ..query(6, 1, false, 0) }).is_err());
        assert!(index.search(&OccurrenceQuery { chapter_frequency: Some(0), ..query(6, 1, false, 0) }).is_err());
    }

    #[test]
    fn saved_spatial_selections_page_and_recover_from_truncation() {
        let line = (0..120).map(|number| format!("word{number}")).collect::<Vec<_>>().join(" ");
        let index = OccurrenceIndex::from_passages([
            ("Genesis", 1, 1, line.as_str()), ("Genesis", 1, 2, line.as_str()),
        ].into_iter(), &cache_root());
        let request = OccurrenceQuery { consecutive_verses: Some(2), chapter_frequency: Some(2), ..query(2, 2, true, 0) };
        let mut found = Vec::new();
        for offset in [0, 50, 100, 150, 200] {
            let page = index.search(&OccurrenceQuery { offset, ..request.clone() }).unwrap();
            assert_eq!(page.total, 239);
            assert!(page.entries.iter().all(|entry| entry.max_verse_run == 2));
            if offset != 0 { assert!(!page.built_filters); }
            found.extend(page.entries);
        }
        assert_eq!(found.iter().map(|entry| (&entry.phrase, entry.words)).collect::<HashSet<_>>().len(), 239);
        let path = fs::read_dir(&index.directory).unwrap().map(|entry| entry.unwrap().path())
            .find(|path| path.file_name().unwrap().to_string_lossy().starts_with("selection-1-")).unwrap();
        fs::write(path, b"incomplete").unwrap();
        assert!(index.search(&request).unwrap().built_filters);
        assert!(!index.search(&request).unwrap().built_filters);
    }

    #[test]
    fn letter_filters_combine_with_words_books_and_saved_data() {
        let root = cache_root();
        let passages = [
            ("Genesis", "God's [word] 123"),
            ("Exodus", "God's word 123"),
            ("Genesis", "a"),
            ("Exodus", "a"),
            ("Matthew", "c c"),
        ];
        let index = OccurrenceIndex::new(passages.into_iter(), &root);
        let request = OccurrenceQuery { books: Some(2), letters: Some(8), ..query(2, 2, false, 0) };
        let page = index.search(&request).unwrap();
        assert_eq!(page.total, 1);
        assert_eq!(page.entries[0].phrase, "god's word");
        assert_eq!(page.entries[0].letters, 8);
        assert_eq!(page.entries[0].books, 2);
        let shorter = index.search(&OccurrenceQuery { letters: Some(4), ..request.clone() }).unwrap();
        assert!(shorter.built_lengths.is_empty());
        assert_eq!(shorter.entries[0].phrase, "word 123");
        let maximum = index.search(&OccurrenceQuery { letters_up_to: true, ..request.clone() }).unwrap();
        assert_eq!(maximum.total, 2);
        let zero = index.search(&OccurrenceQuery { letters: Some(0), ..query(2, 1, false, 0) }).unwrap();
        assert_eq!(zero.entries[0].phrase, "123");
        let any_books = index.search(&OccurrenceQuery { letters: Some(1), ..query(2, 1, false, 0) }).unwrap();
        assert_eq!(any_books.entries.iter().map(|entry| (&*entry.phrase, entry.books)).collect::<Vec<_>>(), vec![("c", 1), ("a", 2)]);
        let one_book = index.search(&OccurrenceQuery { letters: Some(1), books: Some(1), books_up_to: true, ..query(2, 1, false, 0) }).unwrap();
        assert_eq!(one_book.entries[0].phrase, "c");
        assert_eq!(one_book.total, 1);
        assert_eq!(index.search(&OccurrenceQuery { letters: Some(u32::MAX), ..request.clone() }).unwrap().total, 0);
        assert_eq!(index.search(&OccurrenceQuery { letters: Some(u32::MAX), letters_up_to: true, ..request.clone() }).unwrap().total, 2);
        let restarted = OccurrenceIndex::new(passages.into_iter(), &root);
        let reused = restarted.search(&request).unwrap();
        assert!(reused.built_lengths.is_empty());
        assert_eq!(reused.entries, page.entries);
        assert_eq!(letter_count("éA1-' "), 2);
    }

    #[test]
    fn letter_filtered_paging_spans_word_lengths() {
        let line = (0..120).map(|number| format!("word{number}")).collect::<Vec<_>>().join(" ");
        let index = OccurrenceIndex::new([("Genesis", line.as_str())].into_iter(), &cache_root());
        let request = OccurrenceQuery { letters: Some(8), letters_up_to: true, ..query(1, 2, true, 0) };
        let mut found = Vec::new();
        for offset in [0, 50, 100, 150, 200] {
            let page = index.search(&OccurrenceQuery { offset, ..request.clone() }).unwrap();
            assert_eq!(page.total, 239);
            assert!(page.entries.iter().all(|entry| entry.letters == 4 || entry.letters == 8));
            found.extend(page.entries);
        }
        assert_eq!(found.iter().map(|entry| (&entry.phrase, entry.words)).collect::<HashSet<_>>().len(), 239);
    }

    pub(super) fn cache_root() -> PathBuf {
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        std::env::temp_dir()
            .join("kjv-occurrence-tests")
            .join(format!("{}-{nonce}", std::process::id()))
    }

    fn query(count: u32, words: u16, up_to: bool, offset: usize) -> OccurrenceQuery {
        OccurrenceQuery { count, count_up_to: false, words, up_to, offset, books: None, books_up_to: false, letters: None, letters_up_to: false, consecutive_verses: None, consecutive_chapters: None, chapter_frequency: None, included_books: None }
    }

    #[test]
    fn matches_an_independent_string_counting_oracle() {
        let lines = ["God, GOD; God's [word] # word.", "Word of God", "a a a a", "end", "start"];
        let index = OccurrenceIndex::new(lines.iter().map(|line| ("Genesis", *line)), &cache_root());
        for length in 1..=4 {
            let mut oracle = HashMap::<String, u32>::new();
            for line in lines {
                let tokens = words(line);
                if tokens.len() >= length {
                    for sequence in tokens.windows(length) {
                        *oracle.entry(sequence.join(" ")).or_default() += 1;
                    }
                }
            }
            for count in 1..=5 {
                let mut expected: Vec<_> = oracle.iter().filter(|(_, frequency)| **frequency == count)
                    .map(|(phrase, _)| phrase.clone()).collect();
                expected.sort_by_key(|phrase| (letter_count(phrase), phrase.clone()));
                let page = index.search(&query(count, length as u16, false, 0)).unwrap();
                assert_eq!(page.total, expected.len());
                assert_eq!(page.entries.iter().map(|entry| &entry.phrase).collect::<Vec<_>>(), expected.iter().collect::<Vec<_>>());
            }
        }
        assert_eq!(index.search(&query(3, 2, false, 0)).unwrap().entries[0].phrase, "a a");
        assert!(!index.search(&query(1, 2, false, 0)).unwrap().entries.iter().any(|entry| entry.phrase == "end start"));
    }

    #[test]
    fn reuses_saved_indices_after_restart_and_changed_frequency() {
        let root = cache_root();
        let lines = ["one one two", "two three"];
        let first = OccurrenceIndex::new(lines.iter().map(|line| ("Genesis", *line)), &root);
        let built = first.search(&query(2, 2, true, 0)).unwrap();
        assert_eq!(built.built_lengths, vec![1, 2]);
        let timestamps: Vec<_> = (1..=2).map(|length| fs::metadata(first.path(length)).unwrap().modified().unwrap()).collect();
        let restarted = OccurrenceIndex::new(lines.iter().map(|line| ("Genesis", *line)), &root);
        let reused = restarted.search(&query(2, 2, true, 0)).unwrap();
        assert!(reused.built_lengths.is_empty());
        assert_eq!(built.entries, reused.entries);
        assert!(restarted.search(&query(1, 2, true, 0)).unwrap().built_lengths.is_empty());
        let after: Vec<_> = (1..=2).map(|length| fs::metadata(first.path(length)).unwrap().modified().unwrap()).collect();
        assert_eq!(timestamps, after);
        let changed = OccurrenceIndex::new([("Genesis", "different words")].into_iter(), &root);
        assert_ne!(first.directory, changed.directory);
        assert_eq!(changed.search(&query(1, 1, false, 0)).unwrap().built_lengths, vec![1]);
    }

    #[test]
    fn pages_across_lengths_without_missing_or_duplicate_records() {
        let line = (0..120).map(|number| format!("word{number}")).collect::<Vec<_>>().join(" ");
        let index = OccurrenceIndex::new([("Genesis", line.as_str())].into_iter(), &cache_root());
        let first = index.search(&query(1, 2, true, 0)).unwrap();
        assert_eq!(first.total, 239);
        assert_eq!(first.entries.len(), 50);
        let mut entries = first.entries;
        for offset in [50, 100, 150, 200] {
            let page = index.search(&query(1, 2, true, offset)).unwrap();
            assert!(page.built_lengths.is_empty());
            entries.extend(page.entries);
        }
        assert_eq!(entries.len(), 239);
        assert_eq!(entries.iter().map(|entry| (&entry.phrase, entry.words)).collect::<HashSet<_>>().len(), 239);
        assert!(entries[..120].iter().all(|entry| entry.words == 1));
        assert!(entries[120..].iter().all(|entry| entry.words == 2));
        assert!(index.search(&query(1, 2, true, usize::MAX)).unwrap().entries.is_empty());
        assert_eq!(index.search(&query(u32::MAX, 2, true, 0)).unwrap().total, 0);
    }

    #[test]
    fn truncated_indices_rebuild_and_invalid_queries_fail() {
        let index = OccurrenceIndex::new([("Genesis", "one two one")].into_iter(), &cache_root());
        index.search(&query(1, 1, false, 0)).unwrap();
        fs::write(index.path(1), b"broken").unwrap();
        assert_eq!(index.search(&query(2, 1, false, 0)).unwrap().built_lengths, vec![1]);
        assert!(index.search(&query(0, 1, false, 0)).is_err());
        assert!(index.search(&query(1, 0, false, 0)).is_err());
        assert!(index.search(&query(1, MAX_WORDS + 1, false, 0)).is_err());
    }

    #[test]
    fn simultaneous_requests_publish_one_complete_index() {
        let index = std::sync::Arc::new(OccurrenceIndex::new([("Genesis", "a a a a a a a")].into_iter(), &cache_root()));
        let handles: Vec<_> = (0..4).map(|_| {
            let index = std::sync::Arc::clone(&index);
            std::thread::spawn(move || index.search(&query(7, 1, false, 0)).unwrap())
        }).collect();
        let pages: Vec<_> = handles.into_iter().map(|handle| handle.join().unwrap()).collect();
        assert_eq!(pages.iter().filter(|page| !page.built_lengths.is_empty()).count(), 1);
        assert!(pages.iter().all(|page| page.total == 1 && page.entries[0].phrase == "a"));
    }

    #[test]
    fn filters_distinct_books_without_rebuilding_or_double_counting() {
        let index = OccurrenceIndex::new([
            ("Genesis", "a a a c c"),
            ("Genesis", "a b"),
            ("Exodus", "a b"),
            ("Matthew", "a"),
        ].into_iter(), &cache_root());
        let all = index.search(&query(2, 1, false, 0)).unwrap();
        assert_eq!(all.entries.iter().map(|entry| (&*entry.phrase, entry.books)).collect::<Vec<_>>(), vec![("c", 1), ("b", 2)]);
        let exact = OccurrenceQuery { books: Some(1), ..query(2, 1, false, 0) };
        let one = index.search(&exact).unwrap();
        assert!(one.built_lengths.is_empty());
        assert_eq!(one.entries[0].phrase, "c");
        let two = index.search(&OccurrenceQuery { books: Some(2), ..exact.clone() }).unwrap();
        assert_eq!(two.entries[0].phrase, "b");
        assert_eq!(index.search(&OccurrenceQuery { books: Some(2), books_up_to: true, ..exact.clone() }).unwrap().total, 2);
        assert_eq!(index.search(&OccurrenceQuery { books: Some(1), books_up_to: true, ..exact.clone() }).unwrap().total, 1);
        let three = index.search(&OccurrenceQuery { books: Some(3), ..query(6, 1, false, 0) }).unwrap();
        assert_eq!(three.entries[0].phrase, "a");
        assert_eq!(three.entries[0].books, 3);
        let phrase = index.search(&OccurrenceQuery { books: Some(2), ..query(2, 2, false, 0) }).unwrap();
        assert_eq!(phrase.entries[0].phrase, "a b");
        assert_eq!(phrase.entries[0].books, 2);
        assert!(index.search(&OccurrenceQuery { books: Some(0), ..exact.clone() }).is_err());
        assert!(index.search(&OccurrenceQuery { books: Some(67), ..exact.clone() }).is_err());
    }
}
