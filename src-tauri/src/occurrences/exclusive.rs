//! Fixed-width, frequency-ranked exclusive phrases. Build one length at a time.
use super::*;

const EXCLUSIVE_MAGIC: &[u8; 8] = b"KJVEXC01";

#[derive(Debug, Serialize)]
pub struct ExclusivePhrase {
    pub phrase: String,
    pub count: u32,
}

#[derive(Debug, Serialize)]
pub struct ExclusivePage {
    pub total: usize,
    pub entries: Vec<ExclusivePhrase>,
}

fn record_size(length: u16) -> u64 { 4 * (u64::from(length) + 1) }
fn header_size(books: usize) -> u64 { 48 + 8 * books as u64 }

impl OccurrenceIndex {
    fn exclusive_path(&self, length: u16) -> PathBuf {
        self.directory.join(format!("exclusive-{length}.bin"))
    }

    fn open_exclusive(&self, length: u16) -> io::Result<(File, Vec<u64>)> {
        let mut file = self.read_file(&format!("exclusive-{length}.bin"))?;
        let mut magic = [0; 8];
        let mut fingerprint = [0; 32];
        file.read_exact(&mut magic)?;
        file.read_exact(&mut fingerprint)?;
        if &magic != EXCLUSIVE_MAGIC || fingerprint != self.fingerprint
            || read_u32(&mut file)? != u32::from(length)
            || read_u32(&mut file)? as usize != self.book_ids.len() {
            return Err(invalid("Invalid exclusive phrase header"));
        }
        let totals = (0..self.book_ids.len()).map(|_| read_u64(&mut file)).collect::<io::Result<Vec<_>>>()?;
        let records = totals.iter().try_fold(0u64, |sum, count| sum.checked_add(*count))
            .ok_or_else(|| invalid("Exclusive phrase count overflow"))?;
        let expected = records.checked_mul(record_size(length)).and_then(|size| size.checked_add(header_size(totals.len())));
        if expected != Some(file.metadata()?.len()) { return Err(invalid("Truncated exclusive phrase index")); }
        Ok((file, totals))
    }

    fn build_exclusive(&self, length: u16) -> io::Result<()> {
        // Borrow interned token windows: no phrase strings or positional summaries
        // are allocated while counting. Equality checks make hash collisions safe.
        let counts = self.verses.iter().fold(HashMap::<&[u32], (u32, u128)>::new(), |mut counts, verse| {
            for phrase in verse.tokens.windows(length as usize) {
                let frequency = counts.entry(phrase).or_default();
                frequency.0 += 1;
                frequency.1 |= verse.position.book;
            }
            counts
        });
        let mut entries: Vec<_> = counts.into_iter().filter(|(_, (_, books))| books.count_ones() == 1).collect();
        entries.sort_unstable_by(|(left, (a, book_a)), (right, (b, book_b))| {
            book_a.trailing_zeros().cmp(&book_b.trailing_zeros()).then_with(|| b.cmp(a)).then_with(|| left.cmp(right))
        });
        let mut totals = vec![0u64; self.book_ids.len()];
        for (_, (_, book)) in &entries { totals[book.trailing_zeros() as usize] += 1; }
        fs::create_dir_all(&self.directory)?;
        let temporary = self.temporary("exclusive");
        let mut writer = BufWriter::new(OpenOptions::new().write(true).create_new(true).open(&temporary)?);
        writer.write_all(EXCLUSIVE_MAGIC)?;
        writer.write_all(&self.fingerprint)?;
        writer.write_all(&u32::from(length).to_le_bytes())?;
        writer.write_all(&(totals.len() as u32).to_le_bytes())?;
        for count in totals { writer.write_all(&count.to_le_bytes())?; }
        for (phrase, (count, _)) in entries {
            writer.write_all(&count.to_le_bytes())?;
            for token in phrase { writer.write_all(&token.to_le_bytes())?; }
        }
        writer.flush()?;
        writer.get_ref().sync_all()?;
        drop(writer);
        self.publish(&temporary, &self.exclusive_path(length))
    }

    fn ensure_exclusive(&self, length: u16) -> io::Result<(File, Vec<u64>)> {
        match self.open_exclusive(length) {
            Ok(saved) => return Ok(saved),
            Err(error) if rebuildable(&error) => (),
            Err(error) => return Err(error),
        }
        let _guard = self.build_lock.lock().map_err(|_| invalid("Exclusive phrase lock failed"))?;
        match self.open_exclusive(length) {
            Ok(saved) => Ok(saved),
            Err(error) if rebuildable(&error) => { self.build_exclusive(length)?; self.open_exclusive(length) }
            Err(error) => Err(error),
        }
    }

    pub fn exclusive_count(&self, book: &str, length: u16) -> Result<usize, String> {
        if !(1..=MAX_WORDS).contains(&length) { return Err("Choose 1–32 words.".into()); }
        let id = *self.book_ids.get(book).ok_or_else(|| format!("Book not found: {book}"))?;
        self.ensure_exclusive(length).map(|(_, totals)| totals[id] as usize).map_err(|error| error.to_string())
    }

    pub fn exclusive_page(&self, book: &str, length: u16, offset: usize) -> Result<ExclusivePage, String> {
        if !(1..=MAX_WORDS).contains(&length) { return Err("Choose 1–32 words.".into()); }
        let id = *self.book_ids.get(book).ok_or_else(|| format!("Book not found: {book}"))?;
        let read = || -> io::Result<ExclusivePage> {
            let (mut file, totals) = self.ensure_exclusive(length)?;
            let total = totals[id] as usize;
            let offset = offset.min(total);
            let start = totals[..id].iter().sum::<u64>() + offset as u64;
            file.seek(SeekFrom::Start(header_size(totals.len()) + start * record_size(length)))?;
            let entries = (0..(total - offset).min(PAGE_SIZE)).map(|_| {
                let count = read_u32(&mut file)?;
                let phrase = (0..length).map(|_| {
                    let token = read_u32(&mut file)?;
                    self.dictionary.get(token as usize).map(String::as_str).ok_or_else(|| invalid("Invalid exclusive phrase token"))
                }).collect::<io::Result<Vec<_>>>()?.join(" ");
                Ok(ExclusivePhrase { phrase, count })
            }).collect::<io::Result<Vec<_>>>()?;
            Ok(ExclusivePage { total, entries })
        };
        read().map_err(|error| format!("Unable to read exclusive phrases: {error}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exclusive_phrases_count_overlap_rank_and_respect_verse_boundaries() {
        let root = super::super::tests::cache_root();
        let passages = [("Genesis", "a a a beta alpha beta alpha shared"), ("Genesis", "boundary"), ("Genesis", "other"), ("Exodus", "shared beta alpha")];
        let index = OccurrenceIndex::new(passages.into_iter(), &root);
        let page = index.exclusive_page("Genesis", 2, 0).unwrap();
        assert_eq!(page.entries[0].phrase, "a a");
        assert_eq!(page.entries[0].count, 2);
        assert!(page.entries.iter().all(|entry| entry.phrase != "beta alpha" && entry.phrase != "boundary other"));
        let names: Vec<_> = page.entries.iter().map(|entry| entry.phrase.as_str()).collect();
        assert_eq!(names, vec!["a a", "a beta", "alpha beta", "alpha shared"]);
        let restarted = OccurrenceIndex::new(passages.into_iter(), &root);
        assert_eq!(restarted.exclusive_count("Genesis", 2).unwrap(), page.total);
        assert_eq!(restarted.exclusive_count("Genesis", 32).unwrap(), 0);
        assert!(restarted.exclusive_page("Missing", 1, 0).is_err());
        assert!(restarted.exclusive_page("Genesis", 0, 0).is_err());
        assert!(restarted.exclusive_page("Genesis", 33, 0).is_err());
        assert!(restarted.exclusive_page("Genesis", 2, usize::MAX).unwrap().entries.is_empty());
        fs::write(index.exclusive_path(2), b"truncated").unwrap();
        assert_eq!(index.exclusive_count("Genesis", 2).unwrap(), page.total);
    }

    #[test]
    fn exclusive_pages_cover_every_rank_once() {
        let line = (0..120).map(|i| format!("word{i:03}")).collect::<Vec<_>>().join(" ");
        let index = OccurrenceIndex::new([("Genesis", line.as_str()), ("Exodus", "shared")].into_iter(), &super::super::tests::cache_root());
        let mut entries = Vec::new();
        for offset in [0, 50, 100] { entries.extend(index.exclusive_page("Genesis", 2, offset).unwrap().entries); }
        assert_eq!(entries.len(), 119);
        assert!(entries.windows(2).all(|pair| pair[0].phrase < pair[1].phrase));
        let longest = index.exclusive_page("Genesis", 32, 0).unwrap();
        assert_eq!(longest.total, 89);
        assert_eq!(longest.entries.len(), 50);
        assert!(longest.entries.iter().all(|entry| entry.phrase.split_whitespace().count() == 32));
    }

    #[test]
    fn all_lengths_match_a_string_based_ownership_oracle() {
        let lines = [("Genesis", "Alpha alpha beta gamma alpha beta"), ("Genesis", "gamma alpha"), ("Exodus", "alpha beta gamma"), ("Exodus", "other")];
        let index = OccurrenceIndex::new(lines.into_iter(), &super::super::tests::cache_root());
        for length in 1..=32 {
            let mut counts = std::collections::BTreeMap::<String, (u32, HashSet<&str>)>::new();
            for (book, text) in lines {
                let tokens = text.to_lowercase().split_whitespace().map(str::to_owned).collect::<Vec<_>>();
                for phrase in tokens.windows(length as usize) {
                    let entry = counts.entry(phrase.join(" ")).or_default();
                    entry.0 += 1;
                    entry.1.insert(book);
                }
            }
            for book in ["Genesis", "Exodus"] {
                let mut expected: Vec<_> = counts.iter().filter(|(_, (_, owners))| owners.len() == 1 && owners.contains(book))
                    .map(|(phrase, (count, _))| (phrase.clone(), *count)).collect();
                expected.sort_by(|(left, a), (right, b)| b.cmp(a).then_with(|| left.cmp(right)));
                let actual = index.exclusive_page(book, length, 0).unwrap();
                assert_eq!(actual.total, expected.len());
                assert_eq!(actual.entries.into_iter().map(|entry| (entry.phrase, entry.count)).collect::<Vec<_>>(), expected);
            }
        }
    }
}
