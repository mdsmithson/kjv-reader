//! Saved occurrence counts per book, generated once for the retained catalogue.
use super::*;
#[derive(Clone, Debug, Serialize)]
pub struct BookOccurrence {
    pub book: String,
    pub occurrences: u32,
}
#[derive(Serialize, Deserialize)]
struct Header {
    format: u32,
    fingerprint: String,
    total: usize,
    retained: usize,
    links: usize,
    books: Vec<String>,
}
pub(super) struct BookCounts {
    header: Header,
    directory: Vec<u32>,
    counts: Vec<u32>,
}
impl BookCounts {
    pub(super) fn read(root: &Path, manifest: &Manifest, visible: &visibility::VisibleCatalogue) -> io::Result<Self> {
        let header: Header = read_json(&root.join("phrase-books.json"))?;
        let directory = u32_file(&root.join("phrase-books-directory.bin"))?;
        let counts = u32_file(&root.join("phrase-books.bin"))?;
        if header.format != 1 || header.fingerprint != manifest.fingerprint || header.total != manifest.total || header.retained != visible.ids.len() || directory.len() != header.retained * 3 || counts.len() != header.links * 2 || directory.as_chunks::<3>().0.iter().zip(&visible.ids).any(|(row,id)| row[0] != *id || row[1] as usize + row[2] as usize > header.links) || counts.as_chunks::<2>().0.iter().any(|row| row[0] as usize >= header.books.len() || row[1] == 0) {
            return Err(invalid("Incomplete saved phrase book counts"));
        }
        Ok(Self { header, directory, counts })
    }
    pub(super) fn entries(&self, id: u32) -> io::Result<Vec<BookOccurrence>> {
        let rows = self.directory.as_chunks::<3>().0;
        let rank = rows.binary_search_by_key(&id, |row| row[0]).map_err(|_| invalid("Phrase is not in the retained catalogue"))?;
        let row = rows[rank];
        Ok(self.counts.as_chunks::<2>().0[row[1] as usize..(row[1]+row[2]) as usize].iter().map(|pair| BookOccurrence { book: self.header.books[pair[0] as usize].clone(), occurrences: pair[1] }).collect())
    }
}
pub(super) fn prepare(index: &OccurrenceIndex, root: &Path) -> io::Result<()> {
    let manifest: Manifest = read_json(&root.join("manifest.json"))?;
    let visible = visibility::read(root, &manifest)?;
    if BookCounts::read(root, &manifest, &visible).is_ok() { return Ok(()); }
    let tokens = u32_file(&root.join("tokens.bin"))?;
    let mut records = File::open(root.join("phrases.bin"))?;
    let mut postings = BufReader::new(File::open(root.join("postings.bin"))?);
    let mut books = vec![String::new(); index.book_ids.len()];
    for (name, &id) in &index.book_ids { books[id] = name.clone(); }
    let mut directory = Vec::with_capacity(visible.ids.len()*3);
    let mut counts = Vec::<u32>::new();
    for &id in &visible.ids {
        records.seek(SeekFrom::Start(id as u64 * RECORD_SIZE))?;
        let record = Record::read(&mut records)?;
        let needle = &tokens[record.token as usize..record.token as usize+record.words as usize];
        let mut per_book = vec![0u32; books.len()];
        postings.seek(SeekFrom::Start(record.posting * 4))?;
        for _ in 0..record.verses {
            let mut bytes = [0u8; 4];
            postings.read_exact(&mut bytes)?;
            let verse_id = u32::from_le_bytes(bytes) as usize;
            let verse = index.verses.get(verse_id).ok_or_else(|| invalid("Invalid phrase verse ID"))?;
            let count = verse.tokens.windows(needle.len()).filter(|window| *window == needle).count() as u32;
            per_book[verse.position.book.trailing_zeros() as usize] += count;
        }
        if per_book.iter().sum::<u32>() != record.occurrences || per_book.iter().filter(|&&n| n>0).count() != record.books as usize { return Err(invalid("Phrase book counts disagree with summary")); }
        directory.extend([id, (counts.len()/2) as u32, record.books as u32]);
        for (book,count) in per_book.into_iter().enumerate().filter(|(_,count)| *count>0) { counts.extend([book as u32,count]); }
    }
    for (name,values) in [("phrase-books-directory.bin", &directory), ("phrase-books.bin", &counts)] {
        let temporary = root.join(format!("{name}.tmp"));
        let mut writer = BufWriter::new(File::create(&temporary)?);
        for value in values { writer.write_all(&value.to_le_bytes())?; }
        writer.flush()?; drop(writer); fs::rename(temporary,root.join(name))?;
    }
    json_file(&root.join("phrase-books.json"), &Header { format:1, fingerprint:manifest.fingerprint, total:manifest.total, retained:visible.ids.len(), links:counts.len()/2, books })?;
    println!("Prepared book counts for {} retained phrases",visible.ids.len());
    Ok(())
}
impl PreparedPhrases {
    pub fn book_counts(&self, phrase: &str) -> Result<Vec<BookOccurrence>,String> {
        let ids = self.search_ids(phrase, false, true).map_err(|e| e.to_string())?;
        let id = ids.first().ok_or("Phrase is not in the retained catalogue")?;
        self.book_counts.entries(*id).map_err(|e| e.to_string())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn saved_books_count_repetitions_in_a_verse_and_reuse_data() {
        let root=std::env::temp_dir().join(format!("kjv-phrase-books-{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        let bible=Bible::from_json(r#"{"Genesis 1:1":"God word God word","Exodus 1:1":"God word other"}"#).unwrap();
        let index=OccurrenceIndex::from_passages(bible.located_passages(),&root.join("cache"));
        let saved=root.join("saved");
        index.prepare_phrases(&saved,4).unwrap();
        let verify=|| {
            let store=PreparedPhrases::open(&saved,&bible).unwrap();
            let rows=store.book_counts("GOD, word").unwrap();
            assert_eq!(rows.iter().map(|r| (r.book.as_str(),r.occurrences)).collect::<Vec<_>>(),vec![("Genesis",2),("Exodus",1)]);
            assert_eq!(rows.iter().map(|r| r.occurrences).sum::<u32>(),store.detail(&bible,"god word",0).unwrap().occurrences as u32);
            assert!(store.book_counts("missing phrase").is_err());
        };
        verify();
        let stamp=fs::metadata(saved.join("phrase-books.bin")).unwrap().modified().unwrap();
        index.prepare_phrases(&saved,4).unwrap();
        assert_eq!(stamp,fs::metadata(saved.join("phrase-books.bin")).unwrap().modified().unwrap());
        fs::write(saved.join("phrase-books.bin"),[0]).unwrap();
        assert!(PreparedPhrases::open(&saved,&bible).is_err());
        index.prepare_phrases(&saved,4).unwrap(); verify();
        fs::remove_dir_all(root).unwrap();
    }
}
