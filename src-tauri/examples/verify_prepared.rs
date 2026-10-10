//! Verify the exact packaged resources without generating or changing any data.
use kjv_reader_lib::{
    bible::Bible,
    book_stats::BookStatistics,
    occurrences::{
        catalogue::PhraseFilters,
        prepared::{PreparedPhrases, PreparedVerses},
        OccurrenceIndex, OccurrenceQuery,
    },
    phrase_stats,
    word_stats::WordStatistics,
};
use std::{fs::File, path::PathBuf, time::Instant};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = PathBuf::from(
        std::env::args()
            .nth(1)
            .expect("Provide the packaged precomputed directory"),
    );
    let bible = Bible::bundled()?;
    let store = PreparedPhrases::open(&root, &bible)?;
    let words: WordStatistics = serde_json::from_reader(File::open(root.join("words.json"))?)?;
    let books: BookStatistics = serde_json::from_reader(File::open(root.join("books.json"))?)?;
    assert_eq!(
        words.get("god")?.count,
        WordStatistics::new(&bible).get("god")?.count
    );
    assert_eq!(
        books.get("Genesis")?.words,
        BookStatistics::new(&bible).get("Genesis")?.words
    );
    let cache =
        std::env::temp_dir().join(format!("kjv-resource-verification-{}", std::process::id()));
    let index = OccurrenceIndex::from_passages(bible.located_passages(), &cache)
        .with_prebuilt(&root.join("occurrences"));
    for length in 1..=32 {
        let query: OccurrenceQuery = serde_json::from_value(
            serde_json::json!({"count":7,"words":length,"upTo":false,"offset":0}),
        )?;
        assert!(index.search(&query)?.built_lengths.is_empty());
        index.exclusive_count("Genesis", length)?;
    }
    assert!(
        !cache.exists(),
        "Reading packaged source indexes must not create a cache"
    );
    for length in [2, 3, 16, 32] {
        let before = Instant::now();
        let page = store.page(
            0,
            &PhraseFilters {
                words: Some(length),
                ..Default::default()
            },
        )?;
        println!(
            "{length}-word page: {:?}, {} phrases",
            before.elapsed(),
            page.total
        );
        let phrase = &page.entries[0].phrase;
        let actual = store.detail(&bible, phrase, 0)?;
        let expected = phrase_stats::details(&bible, phrase, 0)?;
        assert_eq!(
            serde_json::to_value(actual)?,
            serde_json::to_value(expected)?
        );
    }
    let verses = PreparedVerses::open(&root, &bible, &store)?;
    assert_eq!(verses.page(None, 0)?.total, 31_102);
    for (book, chapter, number) in [
        ("Genesis", 1, 1),
        ("Genesis", 1, 2),
        ("John", 11, 35),
        ("Esther", 8, 9),
    ] {
        let before = Instant::now();
        let detail = verses.detail(&store, book, chapter, number, 0)?;
        println!(
            "{book} {chapter}:{number} details: {:?}; {} phrases",
            before.elapsed(),
            detail.summary.phrases
        );
        let tokens = kjv_reader_lib::text::words(&detail.summary.verse.text);
        assert_eq!(detail.summary.words, tokens.len());
        assert_eq!(
            detail.summary.letters,
            detail
                .summary
                .verse
                .text
                .chars()
                .filter(|c| c.is_alphabetic())
                .count()
        );
        let expected: std::collections::BTreeSet<_> = (2..=tokens.len().min(32))
            .flat_map(|length| tokens.windows(length).map(|window| window.join(" ")))
            .collect();
        assert_eq!(detail.summary.phrases, expected.len());
        let visible_total = detail.phrase_results.total;
        let actual: Vec<_> = (0..visible_total)
            .step_by(50)
            .flat_map(|offset| {
                verses
                    .detail(&store, book, chapter, number, offset)
                    .unwrap()
                    .phrase_results
                    .entries
            })
            .collect();
        assert_eq!(actual.len(), visible_total);
        assert!(actual
            .windows(2)
            .all(|pair| pair[0].phrase < pair[1].phrase));
        assert!(actual.iter().all(|entry| expected.contains(&entry.phrase)));
        let present: std::collections::HashSet<_> =
            actual.iter().map(|entry| entry.phrase.as_str()).collect();
        // Every hidden phrase must have a once-occurring longer parent; repeated phrases stay visible.
        let unique: Vec<_> = actual
            .iter()
            .filter(|entry| entry.occurrences == 1)
            .collect();
        for missing in expected
            .iter()
            .filter(|phrase| !present.contains(phrase.as_str()))
        {
            assert!(unique.iter().any(|parent| parent.words as usize
                > kjv_reader_lib::text::words(missing).len()
                && format!(" {} ", parent.phrase).contains(&format!(" {missing} "))));
        }
        for entry in &actual {
            assert!(detail
                .summary
                .verse
                .text
                .contains(entry.display.as_ref().unwrap()));
            assert_eq!(
                kjv_reader_lib::text::words(entry.display.as_ref().unwrap()).join(" "),
                entry.phrase
            );
        }
        // Every sort is applied to the complete saved list before pagination.
        use kjv_reader_lib::detail_lists::{PhraseSort, PhraseSortField, SortDirection};
        for field in [
            PhraseSortField::Phrase,
            PhraseSortField::Occurrences,
            PhraseSortField::Books,
        ] {
            for direction in [SortDirection::Asc, SortDirection::Desc] {
                let mut expected_order: Vec<_> = actual.iter().collect();
                expected_order.sort_by(|a, b| {
                    let value = match field {
                        PhraseSortField::Phrase => a.phrase.cmp(&b.phrase),
                        PhraseSortField::Occurrences => a.occurrences.cmp(&b.occurrences),
                        PhraseSortField::Books => a.books.cmp(&b.books),
                    };
                    let order = value.then_with(|| a.phrase.cmp(&b.phrase));
                    if matches!(direction, SortDirection::Desc) {
                        order.reverse()
                    } else {
                        order
                    }
                });
                let sorted_page = verses.detail_sorted(
                    &store,
                    book,
                    chapter,
                    number,
                    0,
                    PhraseSort { field, direction },
                )?;
                assert_eq!(
                    sorted_page
                        .phrase_results
                        .entries
                        .iter()
                        .map(|entry| entry.phrase.as_str())
                        .collect::<Vec<_>>(),
                    expected_order
                        .iter()
                        .take(50)
                        .map(|entry| entry.phrase.as_str())
                        .collect::<Vec<_>>()
                );
            }
        }
        let parent = actual.iter().max_by_key(|entry| entry.words).unwrap();
        let parent_text = parent.display.as_ref().unwrap();
        let before = Instant::now();
        let contents = store.contents(parent_text, &words)?;
        println!(
            "Saved words and subphrases: {:?}; {} words, {} subphrases",
            before.elapsed(),
            contents.word_entries.len(),
            contents.subphrase_results.total
        );
        let before = Instant::now();
        let reused = store.contents(parent_text, &words)?;
        println!("Reused phrase contents: {:?}", before.elapsed());
        assert_eq!(
            serde_json::to_value(contents)?,
            serde_json::to_value(reused)?
        );
        let utf16: Vec<_> = detail.summary.verse.text.encode_utf16().collect();
        let word_links: Vec<_> = detail
            .word_parts
            .iter()
            .map(|part| {
                String::from_utf16(&utf16[part.start as usize..part.end as usize])
                    .unwrap()
                    .to_lowercase()
            })
            .collect();
        assert_eq!(word_links, tokens);
        assert_eq!(
            detail
                .word_parts
                .iter()
                .map(|part| part.word.clone())
                .collect::<Vec<_>>(),
            tokens
        );
    }
    for (book, chapter) in [("Genesis", 1), ("Genesis", 2), ("John", 11)] {
        let before = Instant::now();
        let highlights = verses.highlights(&store, &words, &books, book, chapter)?;
        println!(
            "{book} {chapter} saved highlight metadata: {:?}",
            before.elapsed()
        );
        let saved_book = books.get(book)?;
        let saved_chapter = saved_book
            .chapters
            .iter()
            .find(|entry| entry.chapter == chapter)
            .unwrap();
        for verse in &highlights.verses {
            let mut seen = std::collections::HashSet::new();
            for word in &verse.words {
                let expected = words.get(&word.word)?;
                assert_eq!(word.count, expected.count);
                assert_eq!(
                    word.exclusive,
                    saved_chapter
                        .exclusive_words
                        .iter()
                        .any(|entry| entry.word == word.word)
                );
                let first = &expected.first_mention;
                assert_eq!(
                    word.first_mention,
                    first.book == book
                        && first.chapter == chapter
                        && first.number == verse.number
                        && seen.insert(word.word.clone())
                );
            }
        }
    }
    let total = store.page(0, &PhraseFilters::default())?.total;
    assert_eq!(total, 9_632_649);
    println!("Verified packaged data: {total} phrases, every analysis length, statistics, and matching verses. No files generated.");
    Ok(())
}
