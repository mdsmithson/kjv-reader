//! Read-only, build-time phrase data: fixed records, verse postings and metadata groups.
use super::*;
mod verses;
mod search;
mod book_counts;
pub use book_counts::BookOccurrence;
mod visibility;
use crate::{bible::Bible, phrase_stats::PhraseDetail};
use catalogue::{PhraseFilters, SavedPhrase, SavedPhrasePage};
use std::cmp::Reverse;
use std::collections::BinaryHeap;
use std::io::BufReader;
pub use verses::{VerseFrequencyQuery, VerseFrequencySort, PreparedVerses, VerseDetail, VersePage, VerseWord, VerseFilters, VerseSearchFilter};

const FORMAT: u32 = 1;
const MAX_PREPARED_WORDS:u16=90;
const RECORD_SIZE: u64 = 32;
#[derive(Clone, Debug, Serialize, Deserialize)]
struct Group {
    words: u16,
    letters: u32,
    occurrences: u32,
    books: u16,
    start: usize,
    total: usize,
}
impl Group {
    fn matches(&self, filters: &PhraseFilters) -> bool {
        filters.words.is_none_or(|v| v == self.words)
            && filters.letters.is_none_or(|v| v == self.letters)
            && filters.occurrences.is_none_or(|v| v == self.occurrences)
            && filters.books.is_none_or(|v| v == self.books)
    }
}
#[derive(Serialize, Deserialize)]
struct Manifest {
    format: u32,
    fingerprint: String,
    maximum_words: u16,
    total: usize,
    tokens: usize,
    verses: usize,
    postings: u64,
    groups: Vec<Group>,
}
#[derive(Clone, Copy)]
struct Record {
    token: u32,
    words: u16,
    books: u16,
    letters: u32,
    occurrences: u32,
    verses: u32,
    posting: u64,
}
impl Record {
    fn read(reader: &mut impl Read) -> io::Result<Self> {
        let mut b = [0u8; 32];
        reader.read_exact(&mut b)?;
        Ok(Self {
            token: u32::from_le_bytes(b[0..4].try_into().unwrap()),
            words: u16::from_le_bytes(b[4..6].try_into().unwrap()),
            books: u16::from_le_bytes(b[6..8].try_into().unwrap()),
            letters: u32::from_le_bytes(b[8..12].try_into().unwrap()),
            occurrences: u32::from_le_bytes(b[12..16].try_into().unwrap()),
            verses: u32::from_le_bytes(b[16..20].try_into().unwrap()),
            posting: u64::from_le_bytes(b[24..32].try_into().unwrap()),
        })
    }
    fn write(&self, writer: &mut impl Write) -> io::Result<()> {
        writer.write_all(&self.token.to_le_bytes())?;
        writer.write_all(&self.words.to_le_bytes())?;
        writer.write_all(&self.books.to_le_bytes())?;
        writer.write_all(&self.letters.to_le_bytes())?;
        writer.write_all(&self.occurrences.to_le_bytes())?;
        writer.write_all(&self.verses.to_le_bytes())?;
        writer.write_all(&0u32.to_le_bytes())?;
        writer.write_all(&self.posting.to_le_bytes())
    }
}
fn fingerprint(bible: &Bible) -> String {
    let mut hash = Sha256::new();
    for (book, chapter, verse, text) in bible.located_passages() {
        hash.update((book.len() as u64).to_le_bytes());
        hash.update(book.as_bytes());
        hash.update(chapter.to_le_bytes());
        hash.update(verse.to_le_bytes());
        hash.update((text.len() as u64).to_le_bytes());
        hash.update(text.as_bytes());
    }
    hex(&hash.finalize())
}
fn json_file<T: Serialize>(path: &Path, value: &T) -> io::Result<()> {
    serde_json::to_writer(BufWriter::new(File::create(path)?), value).map_err(io::Error::other)
}
fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> io::Result<T> {
    serde_json::from_reader(BufReader::new(File::open(path)?)).map_err(io::Error::other)
}
fn u32_file(path: &Path) -> io::Result<Vec<u32>> {
    let bytes = fs::read(path)?;
    if bytes.len() % 4 != 0 {
        return Err(invalid("Truncated token or filter index"));
    }
    Ok(bytes
        .as_chunks::<4>()
        .0
        .iter()
        .map(|b| u32::from_le_bytes(*b))
        .collect())
}
pub struct PreparedPhrases {
    root: PathBuf,
    manifest: Manifest,
    dictionary: Vec<String>,
    tokens: Vec<u32>,
    children: Vec<u32>,
    visible: visibility::VisibleCatalogue,
    search_spans: Vec<u32>,
    book_counts: book_counts::BookCounts,
    search_cache: Mutex<Vec<(String, Arc<Vec<u32>>)>>,
    contents_cache: Mutex<HashMap<String, PhraseContents>>,
}
impl PreparedPhrases {
    pub fn open(root: &Path, bible: &Bible) -> Result<Self, String> {
        Self::read(root, bible).map_err(|e| format!("Unable to open bundled phrase data: {e}"))
    }
    fn read(root: &Path, bible: &Bible) -> io::Result<Self> {
        let manifest: Manifest = read_json(&root.join("manifest.json"))?;
        if manifest.format != FORMAT
            || manifest.fingerprint != fingerprint(bible)
            || !(2..=MAX_PREPARED_WORDS).contains(&manifest.maximum_words)
            || manifest.verses != bible.located_passages().count()
            || fs::metadata(root.join("phrases.bin"))?.len() != manifest.total as u64 * RECORD_SIZE
            || fs::metadata(root.join("postings.bin"))?.len() != manifest.postings * 4
        {
            return Err(invalid(
                "Bundled phrase data is incomplete or belongs to a different Bible",
            ));
        }
        let tokens = u32_file(&root.join("tokens.bin"))?;
        let ids = u32_file(&root.join("groups.bin"))?;
        let visible = visibility::read(root, &manifest)?;
        let book_counts = book_counts::BookCounts::read(root, &manifest, &visible)?;
        let search_spans = search::read_spans(root, &manifest, &tokens)?;
        let children = u32_file(&root.join("phrase-children.bin"))?;
        let child_header: ChildrenHeader = read_json(&root.join("phrase-children.json"))?;
        if child_header.format != 1
            || child_header.fingerprint != manifest.fingerprint
            || child_header.total != manifest.total
            || children.len() != manifest.total * 2
        {
            return Err(invalid("Incomplete saved subphrase relationships"));
        }
        let dictionary: Vec<String> = read_json(&root.join("dictionary.json"))?;
        if tokens.len() != manifest.tokens
            || ids.len() != manifest.total
            || tokens
                .iter()
                .any(|&token| token as usize >= dictionary.len())
            || manifest.groups.iter().any(|g| {
                g.start
                    .checked_add(g.total)
                    .is_none_or(|end| end > ids.len())
            })
            || manifest.groups.iter().map(|g| g.total).sum::<usize>() != manifest.total
        {
            return Err(invalid("Invalid bundled phrase directory"));
        }
        Ok(Self {
            root: root.into(),
            manifest,
            dictionary,
            tokens,
            children,
            visible,
            search_spans,
            book_counts,
            search_cache: Mutex::new(Vec::new()),
            contents_cache: Mutex::new(HashMap::new()),
        })
    }
    fn record(&self, file: &mut File, id: usize) -> io::Result<Record> {
        if id >= self.manifest.total {
            return Err(invalid("Phrase ID out of bounds"));
        }
        file.seek(SeekFrom::Start(id as u64 * RECORD_SIZE))?;
        Record::read(file)
    }
    fn phrase_tokens(&self, record: Record) -> io::Result<&[u32]> {
        self.tokens
            .get(record.token as usize..record.token as usize + record.words as usize)
            .ok_or_else(|| invalid("Invalid phrase token range"))
    }
    fn summary(&self, record: Record) -> io::Result<SavedPhrase> {
        let phrase = self
            .phrase_tokens(record)?
            .iter()
            .map(|&id| self.dictionary[id as usize].as_str())
            .collect::<Vec<_>>()
            .join(" ");
        Ok(SavedPhrase {
            phrase,
            display: None,
            words: record.words,
            letters: record.letters,
            books: record.books,
            occurrences: record.occurrences,
        })
    }
    pub fn page(&self, offset: usize, filters: &PhraseFilters) -> Result<SavedPhrasePage, String> {
        self.read_page(offset, filters)
            .map_err(|e| format!("Unable to read prepared phrases: {e}"))
    }
    fn read_page(&self, offset: usize, filters: &PhraseFilters) -> io::Result<SavedPhrasePage> {
        if let Some(text) = filters.text.as_ref().filter(|text| !text.trim().is_empty()) {
            return self.search_page(text, filters.partial, offset, filters);
        }
        let unfiltered = filters.words.is_none()
            && filters.letters.is_none()
            && filters.occurrences.is_none()
            && filters.books.is_none();
        let mut file = File::open(self.root.join("phrases.bin"))?;
        let mut entries = Vec::new();
        let total;
        if unfiltered {
            total = self.visible.ids.len();
            for &id in self.visible.ids.iter().skip(offset).take(PAGE_SIZE) {
                entries.push(self.summary(self.record(&mut file, id as usize)?)?);
            }
        } else {
            let groups: Vec<&[u32]> = self
                .visible
                .groups
                .iter()
                .filter(|g| g.matches(filters))
                .map(|g| &self.visible.group_ids[g.start..g.start + g.total])
                .collect();
            total = groups.iter().map(|g| g.len()).sum();
            if offset < total {
                // Find the requested alphabetical rank using saved group IDs, without scanning phrases.
                let mut low = 0u32;
                let mut high = (self.manifest.total - 1) as u32;
                if offset > 0 {
                    while low < high {
                        let mid = low + (high - low) / 2;
                        let rank: usize = groups
                            .iter()
                            .map(|g| g.partition_point(|&id| id <= mid))
                            .sum();
                        if rank > offset {
                            high = mid;
                        } else {
                            low = mid + 1;
                        }
                    }
                }
                let mut heap = BinaryHeap::new();
                for (group, ids) in groups.iter().enumerate() {
                    let pos = ids.partition_point(|&id| id < low);
                    if let Some(&id) = ids.get(pos) {
                        heap.push(Reverse((id, group, pos)));
                    }
                }
                while entries.len() < PAGE_SIZE {
                    let Some(Reverse((id, group, pos))) = heap.pop() else {
                        break;
                    };
                    entries.push(self.summary(self.record(&mut file, id as usize)?)?);
                    if let Some(&next) = groups[group].get(pos + 1) {
                        heap.push(Reverse((next, group, pos + 1)));
                    }
                }
            }
        }
        Ok(SavedPhrasePage {
            total,
            entries,
            persisted_lengths: (2..=self.manifest.maximum_words).collect(),
        })
    }
    pub fn detail(
        &self,
        bible: &Bible,
        phrase: &str,
        offset: usize,
    ) -> Result<PhraseDetail, String> {
        self.read_detail(bible, phrase, offset)
            .map_err(|e| format!("Unable to read prepared phrase: {e}"))
    }
    fn read_detail(&self, bible: &Bible, phrase: &str, offset: usize) -> io::Result<PhraseDetail> {
        let words = words(phrase);
        if !(2..=self.manifest.maximum_words as usize).contains(&words.len()) {
            return Err(invalid("Choose a supported phrase length"));
        }
        let tokens = words
            .iter()
            .map(|word| {
                self.dictionary
                    .binary_search(word)
                    .map(|id| id as u32)
                    .map_err(|_| invalid("Phrase not found"))
            })
            .collect::<io::Result<Vec<_>>>()?;
        let mut file = File::open(self.root.join("phrases.bin"))?;
        let mut low = 0;
        let mut high = self.manifest.total;
        while low < high {
            let mid = low + (high - low) / 2;
            let record = self.record(&mut file, mid)?;
            match self.phrase_tokens(record)?.cmp(&tokens) {
                std::cmp::Ordering::Less => low = mid + 1,
                std::cmp::Ordering::Greater => high = mid,
                std::cmp::Ordering::Equal => {
                    let summary = self.summary(record)?;
                    let total = record.verses as usize;
                    let mut postings = File::open(self.root.join("postings.bin"))?;
                    let start = offset.min(total);
                    if record
                        .posting
                        .checked_add(total as u64)
                        .is_none_or(|end| end > self.manifest.postings)
                    {
                        return Err(invalid("Invalid phrase verse range"));
                    }
                    postings.seek(SeekFrom::Start((record.posting + start as u64) * 4))?;
                    let verses = (start..offset.saturating_add(PAGE_SIZE).min(total))
                        .map(|_| {
                            bible
                                .verse_at(read_u32(&mut postings)? as usize)
                                .ok_or_else(|| invalid("Invalid phrase verse ID"))
                        })
                        .collect::<io::Result<Vec<_>>>()?;
                    return Ok(PhraseDetail {
                        phrase: summary.phrase,
                        words: summary.words as usize,
                        letters: summary.letters as usize,
                        books: summary.books as usize,
                        occurrences: summary.occurrences as usize,
                        results: crate::bible::SearchPage { total, verses },
                    });
                }
            }
        }
        Err(invalid("Phrase not found"))
    }
}

#[derive(Serialize, Deserialize)]
struct ChildrenHeader {
    format: u32,
    fingerprint: String,
    total: usize,
}
fn prepare_children(root: &Path) -> io::Result<()> {
    let manifest: Manifest = read_json(&root.join("manifest.json"))?;
    if let Ok(header) = read_json::<ChildrenHeader>(&root.join("phrase-children.json")) {
        if header.format == 1
            && header.fingerprint == manifest.fingerprint
            && header.total == manifest.total
            && fs::metadata(root.join("phrase-children.bin"))
                .is_ok_and(|m| m.len() == manifest.total as u64 * 8)
        {
            return Ok(());
        }
    }
    let tokens = u32_file(&root.join("tokens.bin"))?;
    let mut file = BufReader::new(File::open(root.join("phrases.bin"))?);
    let mut records = Vec::with_capacity(manifest.total);
    let mut lengths = vec![Vec::<u32>::new(); manifest.maximum_words as usize + 1];
    for id in 0..manifest.total {
        let record = Record::read(&mut file)?;
        lengths[record.words as usize].push(id as u32);
        records.push((record.token, record.words));
    }
    let mut children = vec![[u32::MAX; 2]; manifest.total];
    for length in 3..=manifest.maximum_words as usize {
        let shorter: HashMap<&[u32], u32> = lengths[length - 1]
            .iter()
            .map(|&id| {
                let (start, words) = records[id as usize];
                (&tokens[start as usize..start as usize + words as usize], id)
            })
            .collect();
        for &id in &lengths[length] {
            let (start, words) = records[id as usize];
            let phrase = &tokens[start as usize..start as usize + words as usize];
            children[id as usize] = [
                *shorter
                    .get(&phrase[..phrase.len() - 1])
                    .ok_or_else(|| invalid("Missing phrase prefix"))?,
                *shorter
                    .get(&phrase[1..])
                    .ok_or_else(|| invalid("Missing phrase suffix"))?,
            ];
        }
    }
    let temporary = root.join("phrase-children.tmp");
    let mut writer = BufWriter::new(File::create(&temporary)?);
    for pair in children {
        for id in pair {
            writer.write_all(&id.to_le_bytes())?;
        }
    }
    writer.flush()?;
    drop(writer);
    fs::rename(temporary, root.join("phrase-children.bin"))?;
    json_file(
        &root.join("phrase-children.json"),
        &ChildrenHeader {
            format: 1,
            fingerprint: manifest.fingerprint,
            total: manifest.total,
        },
    )?;
    println!(
        "Prepared subphrase relationships for {} phrases",
        manifest.total
    );
    Ok(())
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhraseContents {
    pub word_parts: Vec<VerseWord>,
    pub word_entries: Vec<crate::detail_lists::ContextWord>,
    pub subphrase_results: SavedPhrasePage,
}
impl PreparedPhrases {
    pub fn contents(
        &self,
        text: &str,
        stats: &crate::word_stats::WordStatistics,
    ) -> Result<PhraseContents, String> {
        if let Some(saved) = self
            .contents_cache
            .lock()
            .map_err(|_| "Phrase contents cache failed")?
            .get(text)
            .cloned()
        {
            return Ok(saved);
        }
        let run = || -> io::Result<PhraseContents> {
            let parts = verses::word_parts(text);
            let tokens = parts
                .iter()
                .map(|part| {
                    self.dictionary
                        .binary_search(&part.word)
                        .map(|id| id as u32)
                        .map_err(|_| invalid("Phrase not found"))
                })
                .collect::<io::Result<Vec<_>>>()?;
            let mut file = File::open(self.root.join("phrases.bin"))?;
            let mut low = 0;
            let mut high = self.manifest.total;
            let mut parent = None;
            while low < high {
                let mid = low + (high - low) / 2;
                let record = self.record(&mut file, mid)?;
                match self.phrase_tokens(record)?.cmp(&tokens) {
                    std::cmp::Ordering::Less => low = mid + 1,
                    std::cmp::Ordering::Greater => high = mid,
                    std::cmp::Ordering::Equal => {
                        parent = Some(mid as u32);
                        break;
                    }
                }
            }
            let parent = parent.ok_or_else(|| invalid("Phrase not found"))?;
            let mut pending = self.children[parent as usize * 2..parent as usize * 2 + 2].to_vec();
            let mut visited = HashSet::new();
            while let Some(id) = pending.pop() {
                if id != u32::MAX && visited.insert(id) {
                    if id as usize >= self.manifest.total {
                        return Err(invalid("Invalid saved subphrase ID"));
                    }
                    pending.extend_from_slice(&self.children[id as usize * 2..id as usize * 2 + 2]);
                }
            }
            let mut metadata = HashMap::new();
            for id in visited {
                if !self.visible.mask[id as usize] { continue; }
                let record = self.record(&mut file, id as usize)?;
                metadata.insert(self.phrase_tokens(record)?, (id, record.occurrences));
            }
            let visible =
                verses::rolled_phrases(&tokens, &metadata, self.manifest.maximum_words as usize);
            let bounds = verses::display_boundaries(text, &parts);
            let utf16: Vec<_> = text.encode_utf16().collect();
            let mut entries = Vec::new();
            for child in visible {
                let mut summary = self.summary(self.record(&mut file, child.id as usize)?)?;
                summary.display = Some(
                    String::from_utf16(
                        &utf16[bounds[child.start].0 as usize..bounds[child.end - 1].1 as usize],
                    )
                    .map_err(|_| invalid("Invalid phrase text"))?,
                );
                entries.push(summary);
            }
            let total = entries.len();
            let word_entries = crate::detail_lists::context_words(text, &parts, stats)
                .map_err(io::Error::other)?;
            Ok(PhraseContents {
                word_parts: parts,
                word_entries,
                subphrase_results: SavedPhrasePage {
                    total,
                    entries,
                    persisted_lengths: (2..=self.manifest.maximum_words).collect(),
                },
            })
        };
        let result = run().map_err(|e| format!("Unable to read phrase contents: {e}"))?;
        let mut cache = self
            .contents_cache
            .lock()
            .map_err(|_| "Phrase contents cache failed")?;
        if cache.len() >= 16 {
            if let Some(key) = cache.keys().next().cloned() {
                cache.remove(&key);
            }
        }
        cache.insert(text.to_owned(), result.clone());
        Ok(result)
    }
}

struct Aggregate {
    token: u32,
    books: u128,
    count: u32,
    letters: u32,
    verses: Vec<u32>,
}
struct Chunk {
    records: BufReader<File>,
    postings: BufReader<File>,
    remaining: usize,
    next: Option<Record>,
}
impl OccurrenceIndex {
    pub fn prepare_analysis(&self, destination: &Path) -> Result<(), String> {
        let output = destination.join(self.directory.file_name().ok_or("Missing cache name")?);
        fs::create_dir_all(&output).map_err(|e| e.to_string())?;
        let book = self.book_ids.keys().next().ok_or("Empty Bible")?;
        for length in 1..=MAX_WORDS {
            self.ensure(length).map_err(|e| e.to_string())?;
            self.exclusive_count(book, length)?;
            for prefix in ["words", "exclusive"] {
                let name = format!("{prefix}-{length}.bin");
                let source = self.directory.join(&name);
                let target = output.join(name);
                let expected = fs::metadata(&source).map_err(|e| e.to_string())?.len();
                if !fs::metadata(&target).is_ok_and(|m| m.len() == expected) {
                    let temp = target.with_extension("tmp");
                    fs::copy(source, &temp).map_err(|e| e.to_string())?;
                    fs::rename(temp, target).map_err(|e| e.to_string())?;
                }
            }
            println!("Prepared occurrences and book-exclusive phrases: {length} words");
        }
        Ok(())
    }
    /// Run before packaging, never from the application UI. Completed chunks resume unchanged.
    pub fn prepare_phrases(&self, destination: &Path, maximum_words: u16) -> Result<(), String> {
        self.prepare(destination, maximum_words)
            .and_then(|_| prepare_children(destination))
            .and_then(|_| visibility::prepare(destination))
            .and_then(|_| search::prepare(destination))
            .and_then(|_| book_counts::prepare(self, destination))
            .map_err(|e| format!("Unable to prepare phrase data: {e}"))
    }
    fn prepare(&self, destination: &Path, maximum_words: u16) -> io::Result<()> {
        if !(2..=MAX_PREPARED_WORDS).contains(&maximum_words) {
            return Err(invalid("Invalid prepared phrase range"));
        }
        if let Ok(manifest) = read_json::<Manifest>(&destination.join("manifest.json")) {
            if manifest.format == FORMAT
                && manifest.fingerprint == hex(&self.fingerprint)
                && manifest.maximum_words == maximum_words
                && fs::metadata(destination.join("phrases.bin"))
                    .is_ok_and(|m| m.len() == manifest.total as u64 * RECORD_SIZE)
                && fs::metadata(destination.join("postings.bin"))
                    .is_ok_and(|m| m.len() == manifest.postings * 4)
                && fs::metadata(destination.join("groups.bin"))
                    .is_ok_and(|m| m.len() == manifest.total as u64 * 4)
                && fs::metadata(destination.join("tokens.bin"))
                    .is_ok_and(|m| m.len() == manifest.tokens as u64 * 4)
                && destination.join("dictionary.json").exists()
            {
                return Ok(());
            }
        }
        fs::create_dir_all(destination)?;
        let scratch = self.directory.join("prepared-chunks-v1");
        fs::create_dir_all(&scratch)?;
        let flat: Vec<u32> = self
            .verses
            .iter()
            .flat_map(|v| v.tokens.iter().copied())
            .collect();
        json_file(&destination.join("dictionary.json"), &*self.dictionary)?;
        let mut writer = BufWriter::new(File::create(destination.join("tokens.bin"))?);
        for token in &flat {
            writer.write_all(&token.to_le_bytes())?;
        }
        writer.flush()?;
        let mut chunks = Vec::new();
        for length in 2..=maximum_words {
            let records_path = scratch.join(format!("phrases-{length}.bin"));
            let postings_path = scratch.join(format!("postings-{length}.bin"));
            let marker = scratch.join(format!("complete-{length}.json"));
            let existing = read_json::<(u64, u64)>(&marker)
                .ok()
                .filter(|&(records, postings)| {
                    fs::metadata(&records_path).is_ok_and(|m| m.len() == records * RECORD_SIZE)
                        && fs::metadata(&postings_path).is_ok_and(|m| m.len() == postings * 4)
                });
            let (records, _) = if let Some(saved) = existing {
                saved
            } else {
                let mut counts = HashMap::<&[u32], Aggregate>::new();
                let mut token_offset = 0u32;
                for (verse_id, verse) in self.verses.iter().enumerate() {
                    for (start, tokens) in verse.tokens.windows(length as usize).enumerate() {
                        let entry = counts.entry(tokens).or_insert_with(|| Aggregate {
                            token: token_offset + start as u32,
                            books: 0,
                            count: 0,
                            letters: tokens
                                .iter()
                                .map(|&id| self.token_letters[id as usize])
                                .sum(),
                            verses: Vec::new(),
                        });
                        entry.count += 1;
                        entry.books |= verse.position.book;
                        if entry.verses.last() != Some(&(verse_id as u32)) {
                            entry.verses.push(verse_id as u32);
                        }
                    }
                    token_offset += verse.tokens.len() as u32;
                }
                let mut entries: Vec<_> = counts.into_iter().collect();
                entries.sort_unstable_by(|a, b| a.0.cmp(b.0));
                let mut records = BufWriter::new(File::create(&records_path)?);
                let mut postings = BufWriter::new(File::create(&postings_path)?);
                let mut posting = 0u64;
                for (_, entry) in &entries {
                    Record {
                        token: entry.token,
                        words: length,
                        books: entry.books.count_ones() as u16,
                        letters: entry.letters,
                        occurrences: entry.count,
                        verses: entry.verses.len() as u32,
                        posting,
                    }
                    .write(&mut records)?;
                    for verse in &entry.verses {
                        postings.write_all(&verse.to_le_bytes())?;
                    }
                    posting += entry.verses.len() as u64;
                }
                records.flush()?;
                postings.flush()?;
                let saved = (entries.len() as u64, posting);
                json_file(&marker, &saved)?;
                saved
            };
            let mut reader = BufReader::new(File::open(records_path)?);
            let next = if records > 0 {
                Some(Record::read(&mut reader)?)
            } else {
                None
            };
            chunks.push(Chunk {
                records: reader,
                postings: BufReader::new(File::open(postings_path)?),
                remaining: records as usize,
                next,
            });
            println!("Prepared phrase length {length}: {records} distinct phrases");
        }
        let mut records = BufWriter::new(File::create(destination.join("phrases.bin"))?);
        let mut postings = BufWriter::new(File::create(destination.join("postings.bin"))?);
        let mut grouped = BTreeMap::<(u16, u32, u32, u16), Vec<u32>>::new();
        let mut total = 0u32;
        let mut posting = 0u64;
        while let Some(index) = chunks
            .iter()
            .enumerate()
            .filter_map(|(i, c)| c.next.map(|r| (i, r)))
            .min_by(|(_, a), (_, b)| {
                flat[a.token as usize..a.token as usize + a.words as usize]
                    .cmp(&flat[b.token as usize..b.token as usize + b.words as usize])
            })
            .map(|(i, _)| i)
        {
            let chunk = &mut chunks[index];
            let mut record = chunk.next.take().unwrap();
            record.posting = posting;
            record.write(&mut records)?;
            let copied = io::copy(
                &mut (&mut chunk.postings).take(u64::from(record.verses) * 4),
                &mut postings,
            )?;
            if copied != u64::from(record.verses) * 4 {
                return Err(invalid("Truncated preparation chunk"));
            }
            posting += u64::from(record.verses);
            grouped
                .entry((
                    record.words,
                    record.letters,
                    record.occurrences,
                    record.books,
                ))
                .or_default()
                .push(total);
            total = total
                .checked_add(1)
                .ok_or_else(|| invalid("Too many distinct phrases"))?;
            chunk.remaining -= 1;
            chunk.next = if chunk.remaining > 0 {
                Some(Record::read(&mut chunk.records)?)
            } else {
                None
            };
        }
        records.flush()?;
        postings.flush()?;
        let mut ids = BufWriter::new(File::create(destination.join("groups.bin"))?);
        let mut start = 0;
        let mut groups = Vec::new();
        for ((words, letters, occurrences, books), entries) in grouped {
            for id in &entries {
                ids.write_all(&id.to_le_bytes())?;
            }
            groups.push(Group {
                words,
                letters,
                occurrences,
                books,
                start,
                total: entries.len(),
            });
            start += entries.len();
        }
        ids.flush()?;
        let manifest = Manifest {
            format: FORMAT,
            fingerprint: hex(&self.fingerprint),
            maximum_words,
            total: total as usize,
            tokens: flat.len(),
            verses: self.verses.len(),
            postings: posting,
            groups,
        };
        // Publish the manifest last: interrupted preparation cannot masquerade as a finished pack.
        let temp = destination.join("manifest.tmp");
        json_file(&temp, &manifest)?;
        fs::rename(temp, destination.join("manifest.json"))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn root() -> PathBuf {
        static NEXT: std::sync::atomic::AtomicU64=std::sync::atomic::AtomicU64::new(0);
        let nonce=NEXT.fetch_add(1,std::sync::atomic::Ordering::Relaxed);
        std::env::temp_dir().join(format!(
            "kjv-prepared-{}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            nonce
        ))
    }
    #[test]
    fn every_phrase_filter_and_verse_matches_an_independent_oracle() {
        let root = root();
        let cache = root.join("cache");
        let output = root.join("pack");
        let source: serde_json::Map<String, serde_json::Value> = (1..=120)
            .map(|n| {
                (
                    format!("Genesis 1:{n}"),
                    serde_json::json!(format!("word{n:03} a a a marker end")),
                )
            })
            .chain([(
                String::from("Exodus 1:1"),
                serde_json::json!("a a marker word001"),
            )])
            .collect();
        let bible = Bible::from_json(&serde_json::to_string(&source).unwrap()).unwrap();
        let index = OccurrenceIndex::from_passages(bible.located_passages(), &cache);
        index.prepare_phrases(&output, 4).unwrap();
        let store = PreparedPhrases::open(&output, &bible).unwrap();
        let mut oracle =
            BTreeMap::<String, (usize, HashSet<String>, Vec<crate::bible::Verse>, usize)>::new();
        for (verse_id, (book, _, _, text)) in bible.located_passages().enumerate() {
            let tokens = words(text);
            for length in 2..=4 {
                for window in tokens.windows(length) {
                    let phrase = window.join(" ");
                    let entry = oracle
                        .entry(phrase)
                        .or_insert_with(|| (0, HashSet::new(), Vec::new(), length));
                    entry.0 += 1;
                    entry.1.insert(book.into());
                    let verse = bible.verse_at(verse_id).unwrap();
                    if entry
                        .2
                        .last()
                        .is_none_or(|last| last.book != verse.book || last.number != verse.number)
                    {
                        entry.2.push(verse);
                    }
                }
            }
        }
        let visible = visibility::oracle(&bible,4);
        let all: Vec<_> = oracle.keys().filter(|phrase|visible.contains(*phrase)).cloned().collect();
        let actual: Vec<_> = (0..all.len())
            .step_by(PAGE_SIZE)
            .flat_map(|offset| {
                store
                    .page(offset, &PhraseFilters::default())
                    .unwrap()
                    .entries
                    .into_iter()
                    .map(|e| e.phrase)
            })
            .collect();
        assert_eq!(actual, all);
        for (phrase, (count, books, verses, length)) in &oracle {
            let detail = store.detail(&bible, phrase, 0).unwrap();
            assert_eq!(
                (
                    detail.occurrences,
                    detail.books,
                    detail.words,
                    detail.results.total
                ),
                (*count, books.len(), *length, verses.len())
            );
            let detail_verses: Vec<_> = (0..verses.len())
                .step_by(PAGE_SIZE)
                .flat_map(|offset| {
                    store
                        .detail(&bible, phrase, offset)
                        .unwrap()
                        .results
                        .verses
                        .into_iter()
                        .map(|v| (v.book, v.chapter, v.number))
                })
                .collect();
            assert_eq!(
                detail_verses,
                verses
                    .iter()
                    .map(|v| (v.book.clone(), v.chapter, v.number))
                    .collect::<Vec<_>>()
            );
        }
        for filters in [
            PhraseFilters {
                words: Some(3),
                ..Default::default()
            },
            PhraseFilters {
                letters: Some(2),
                ..Default::default()
            },
            PhraseFilters {
                occurrences: Some(1),
                ..Default::default()
            },
            PhraseFilters {
                books: Some(2),
                ..Default::default()
            },
            PhraseFilters {
                words: Some(2),
                letters: Some(5),
                occurrences: Some(1),
                books: Some(1),
                ..Default::default()
            },
        ] {
            let expected: Vec<_> = oracle
                .iter()
                .filter(|(phrase, (count, books, _, length))| {
                    visible.contains(*phrase) && filters.words.is_none_or(|v| v as usize == *length)
                        && filters.letters.is_none_or(|v| {
                            v as usize == phrase.chars().filter(|c| c.is_alphabetic()).count()
                        })
                        && filters.occurrences.is_none_or(|v| v as usize == *count)
                        && filters.books.is_none_or(|v| v as usize == books.len())
                })
                .map(|(phrase, _)| phrase.clone())
                .collect();
            let actual: Vec<_> = (0..expected.len())
                .step_by(PAGE_SIZE)
                .flat_map(|offset| {
                    let page = store.page(offset, &filters).unwrap();
                    assert_eq!(page.total, expected.len());
                    page.entries.into_iter().map(|entry| entry.phrase)
                })
                .collect();
            assert_eq!(actual, expected);
            assert!(store.page(usize::MAX, &filters).unwrap().entries.is_empty());
        }
        assert_eq!(store.detail(&bible, "a a", 0).unwrap().occurrences, 241);
        let updated = fs::metadata(output.join("phrases.bin"))
            .unwrap()
            .modified()
            .unwrap();
        index.prepare_phrases(&output, 4).unwrap();
        assert_eq!(
            fs::metadata(output.join("phrases.bin"))
                .unwrap()
                .modified()
                .unwrap(),
            updated
        );
        assert_eq!(
            PreparedPhrases::open(&output, &bible)
                .unwrap()
                .page(0, &PhraseFilters::default())
                .unwrap()
                .total,
            all.len()
        );
        assert!(store.detail(&bible, "not in bible", 0).is_err());
        let other = Bible::from_json(r#"{"Genesis 1:1":"different corpus"}"#).unwrap();
        assert!(PreparedPhrases::open(&output, &other).is_err());
        fs::write(output.join("phrases.bin"), b"truncated").unwrap();
        assert!(PreparedPhrases::open(&output, &bible).is_err());
        index.prepare_phrases(&output, 4).unwrap();
        assert!(PreparedPhrases::open(&output, &bible).is_ok());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn saved_subphrase_graph_matches_proper_windows_and_word_counts() {
        let root = root();
        let bible=Bible::from_json(r#"{"Genesis 1:1":"God, [is] good; god is here.","Exodus 1:1":"God is good","Exodus 1:2":"a a a"}"#).unwrap();
        let index = OccurrenceIndex::from_passages(bible.located_passages(), &root.join("cache"));
        index.prepare_phrases(&root.join("pack"), 32).unwrap();
        let store = PreparedPhrases::open(&root.join("pack"), &bible).unwrap();
        let stats = crate::word_stats::WordStatistics::new(&bible);
        for text in [
            "God, [is] good; god is here.",
            "God is good",
            "a a a",
            "God is",
        ] {
            let tokens = words(text);
            let proper: BTreeMap<_, _> = (2..tokens.len())
                .flat_map(|length| tokens.windows(length).map(|window| window.join(" ")))
                .map(|phrase| {
                    let details = crate::phrase_stats::details(&bible, &phrase, 0).unwrap();
                    (phrase, details.occurrences)
                })
                .collect();
            let globally_visible=visibility::oracle(&bible,32);
            let expected: Vec<_> = proper
                .iter()
                .filter(|(phrase,_)|globally_visible.contains(*phrase))
                .map(|(phrase, _)| phrase.clone())
                .collect();
            let contents = store.contents(text, &stats).unwrap();
            assert_eq!(
                contents
                    .subphrase_results
                    .entries
                    .iter()
                    .map(|entry| entry.phrase.clone())
                    .collect::<Vec<_>>(),
                expected
            );
            assert!(contents
                .subphrase_results
                .entries
                .iter()
                .all(|entry| (entry.words as usize) < tokens.len()
                    && entry
                        .display
                        .as_ref()
                        .is_some_and(|display| text.contains(display))));
            assert_eq!(
                contents.word_entries.len(),
                tokens.iter().collect::<HashSet<_>>().len()
            );
            assert!(contents
                .word_entries
                .iter()
                .all(|entry| entry.occurrences == stats.get(&entry.word).unwrap().count));
        }
        let contents = store
            .contents("God, [is] good; god is here.", &stats)
            .unwrap();
        let god = contents
            .word_entries
            .iter()
            .find(|entry| entry.word == "god")
            .unwrap();
        assert_eq!(
            (god.display.as_str(), god.occurrences, god.books),
            ("God", 3, 2)
        );
        assert_eq!(contents.word_parts.len(), 6);
        assert!(store.contents("missing phrase", &stats).is_err());
        let modified = fs::metadata(root.join("pack/phrase-children.bin"))
            .unwrap()
            .modified()
            .unwrap();
        index.prepare_phrases(&root.join("pack"), 32).unwrap();
        assert_eq!(
            modified,
            fs::metadata(root.join("pack/phrase-children.bin"))
                .unwrap()
                .modified()
                .unwrap()
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn shipped_analysis_is_reused_without_copying_or_rebuilding() {
        let root = root();
        let bible = Bible::from_json(
            r#"{"Genesis 1:1":"a a a a", "Genesis 1:2":"a a", "Exodus 1:1":"a b c"}"#,
        )
        .unwrap();
        let first = OccurrenceIndex::from_passages(bible.located_passages(), &root.join("build"));
        first.prepare_analysis(&root.join("shipped")).unwrap();
        let cache = root.join("user");
        let runtime = OccurrenceIndex::from_passages(bible.located_passages(), &cache)
            .with_prebuilt(&root.join("shipped"));
        let mut query: OccurrenceQuery = serde_json::from_value(
            serde_json::json!({"count":4,"words":2,"upTo":false,"offset":0}),
        )
        .unwrap();
        let page = runtime.search(&query).unwrap();
        assert!(page.built_lengths.is_empty());
        assert_eq!(page.entries[0].phrase, "a a");
        assert_eq!(runtime.exclusive_count("Genesis", 2).unwrap(), 1);
        assert!(!cache.exists());
        query.consecutive_verses = Some(2);
        assert_eq!(runtime.search(&query).unwrap().entries[0].phrase, "a a");
        assert!(runtime.search(&query).unwrap().built_lengths.is_empty());
        fs::remove_dir_all(root).unwrap();
    }
}
