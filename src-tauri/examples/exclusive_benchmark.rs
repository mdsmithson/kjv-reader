use kjv_reader_lib::{bible::Bible, occurrences::OccurrenceIndex};
use std::{path::PathBuf, time::Instant};

fn main() {
    let bible = Bible::bundled().unwrap();
    let root = PathBuf::from(std::env::args().nth(1).expect("Provide a cache directory"));
    let index = OccurrenceIndex::from_passages(bible.located_passages(), &root);
    for length in 1..=32 {
        let started = Instant::now();
        let count = index.exclusive_count("Genesis", length).unwrap();
        println!("{length} words: {count} distinct phrases, {} ms", started.elapsed().as_millis());
    }
    let started = Instant::now();
    let page = index.exclusive_page("Genesis", 2, 50).unwrap();
    println!("Saved page: {} of {} phrases in {} ms", page.entries.len(), page.total, started.elapsed().as_millis());
}
