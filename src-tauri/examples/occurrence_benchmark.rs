//! Run with: cargo run --release --no-default-features --example occurrence_benchmark
use kjv_reader_lib::bible::Bible;
use kjv_reader_lib::occurrences::{OccurrenceIndex, OccurrenceQuery};
use std::path::PathBuf;
use std::time::Instant;

fn main() {
    let bible = Bible::bundled().unwrap();
    let cache = std::env::args().nth(1).map(PathBuf::from).unwrap_or_else(|| {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../work/occurrence-benchmark")
    });
    let started = Instant::now();
    let index = OccurrenceIndex::from_passages(bible.located_passages(), &cache);
    println!("Tokenize and intern corpus: {:?}", started.elapsed());
    let query = OccurrenceQuery { count: 7, count_up_to: false, words: 2, up_to: true, offset: 0, books: None, books_up_to: false, chapters: None, letters: None, letters_up_to: false, consecutive_verses: None, consecutive_chapters: None, chapter_frequency: None, included_books: None };
    for (name, request) in [
        ("First request", OccurrenceQuery { ..query.clone() }),
        ("Repeated request", OccurrenceQuery { ..query.clone() }),
        ("Next page", OccurrenceQuery { offset: 50, ..query.clone() }),
        ("Changed count", OccurrenceQuery { count: 8, ..query.clone() }),
        ("Exactly 3 books", OccurrenceQuery { books: Some(3), ..query.clone() }),
        ("Up to 3 books", OccurrenceQuery { books: Some(3), books_up_to: true, ..query.clone() }),
        ("Exactly 7 letters", OccurrenceQuery { letters: Some(7), ..query.clone() }),
        ("Up to 7 letters in up to 3 books", OccurrenceQuery { letters: Some(7), letters_up_to: true, books: Some(3), books_up_to: true, ..query.clone() }),
        ("Consecutive verses", OccurrenceQuery { consecutive_verses: Some(2), ..query.clone() }),
        ("Repeat consecutive verses", OccurrenceQuery { consecutive_verses: Some(2), ..query.clone() }),
        ("Consecutive chapters", OccurrenceQuery { consecutive_chapters: Some(2), ..query.clone() }),
        ("Exactly 2 appearances in a chapter", OccurrenceQuery { chapter_frequency: Some(2), ..query.clone() }),
    ] {
        let page = index.search(&request).unwrap();
        println!("{name}: {} ms; {} matches; {} returned; built {:?}", page.elapsed_ms, page.total, page.entries.len(), page.built_lengths);
    }
    let restarted = OccurrenceIndex::from_passages(bible.located_passages(), &cache);
    let page = restarted.search(&query).unwrap();
    println!("After restart: {} ms; built {:?}", page.elapsed_ms, page.built_lengths);
}
