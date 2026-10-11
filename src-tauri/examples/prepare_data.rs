//! Prepare once with npm run prepare:data. Existing complete data is reused.
use kjv_reader_lib::{
    bible::Bible,
    book_stats::BookStatistics,
    occurrences::{catalogue::PhraseFilters, prepared::PreparedPhrases, OccurrenceIndex},
    word_stats::WordStatistics,
};
use std::{
    fs::{self, File},
    io::BufWriter,
    path::PathBuf,
    time::Instant,
};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let output = root.join("data/precomputed");
    let bible = Bible::bundled()?;
    let index =
        OccurrenceIndex::from_passages(bible.located_passages(), &root.join("target/preparation"));
    let start = Instant::now();
    let reusable = PreparedPhrases::open(&output, &bible).is_ok();
    index.prepare_phrases(&output, 32)?;
    index.prepare_analysis(&output.join("occurrences"))?;
    if !reusable || !output.join("words.json").exists() {
        serde_json::to_writer(
            BufWriter::new(File::create(output.join("words.json"))?),
            &WordStatistics::new(&bible),
        )?;
    }
    if !reusable || !output.join("books.json").exists() {
        serde_json::to_writer(
            BufWriter::new(File::create(output.join("books.json"))?),
            &BookStatistics::new(&bible),
        )?;
    }
    if !reusable || !output.join("numbers.json").exists() {
        let words: WordStatistics = serde_json::from_reader(File::open(output.join("words.json"))?)?;
        serde_json::to_writer(BufWriter::new(File::create(output.join("numbers.json"))?),
            &kjv_reader_lib::number_stats::NumberStatistics::new(&words))?;
    }
    let load = Instant::now();
    let store = PreparedPhrases::open(&output, &bible)?;
    println!("Open prepared data: {:?}", load.elapsed());
    store.prepare_verses(&bible)?;
    let before = Instant::now();
    let verses =
        kjv_reader_lib::occurrences::prepared::PreparedVerses::open(&output, &bible, &store)?;
    println!("Open prepared verses: {:?}", before.elapsed());
    let before = Instant::now();
    let page = verses.page(None, 0)?;
    println!(
        "First verse page: {:?}, {} verses",
        before.elapsed(),
        page.total
    );
    let before = Instant::now();
    let detail = verses.detail(&store, "Genesis", 1, 1, 0)?;
    println!(
        "Verse detail: {:?}, {} words, {} letters, {} phrases",
        before.elapsed(),
        detail.summary.words,
        detail.summary.letters,
        detail.summary.phrases
    );
    for (name, filters, offset) in [
        ("First alphabetical page", PhraseFilters::default(), 0),
        (
            "Deep alphabetical page",
            PhraseFilters::default(),
            1_000_000,
        ),
        (
            "Occurrences = 7",
            PhraseFilters {
                occurrences: Some(7),
                ..Default::default()
            },
            0,
        ),
        (
            "Books = 66",
            PhraseFilters {
                books: Some(66),
                ..Default::default()
            },
            0,
        ),
        (
            "Combined filters",
            PhraseFilters {
                words: Some(2),
                letters: Some(7),
                occurrences: Some(7),
                ..Default::default()
            },
            0,
        ),
        (
            "Frequent matches, later page",
            PhraseFilters {
                occurrences: Some(1),
                ..Default::default()
            },
            1_000_000,
        ),
    ] {
        let before = Instant::now();
        let page = store.page(offset, &filters)?;
        println!(
            "{name}: {:?}; {} matches, {} entries",
            before.elapsed(),
            page.total,
            page.entries.len()
        );
    }
    let before = Instant::now();
    let detail = store.detail(&bible, "and the", 0)?;
    println!(
        "Phrase detail: {:?}; {} occurrences in {} verses",
        before.elapsed(),
        detail.occurrences,
        detail.results.total
    );
    let mut bytes = 0u64;
    let mut pending = vec![output];
    while let Some(path) = pending.pop() {
        for entry in fs::read_dir(path)? {
            let path = entry?.path();
            if path.is_dir() {
                pending.push(path);
            } else {
                bytes += fs::metadata(path)?.len();
            }
        }
    }
    println!("Prepared {} bytes in {:?}", bytes, start.elapsed());
    Ok(())
}
