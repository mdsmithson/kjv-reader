use crate::bible::{Bible, SearchPage, Verse, PAGE_SIZE};
use serde::Serialize;
use std::collections::HashSet;
#[derive(Debug, Serialize)]
pub struct PhraseDetail {
    pub phrase: String,
    pub words: usize,
    pub letters: usize,
    pub books: usize,
    pub occurrences: usize,
    pub results: SearchPage,
}
pub fn details(bible: &Bible, phrase: &str, offset: usize) -> Result<PhraseDetail, String> {
    let tokens = crate::text::words(phrase);
    if !(2..=32).contains(&tokens.len()) {
        return Err("Choose a phrase of 2–32 words.".into());
    }
    let mut books = HashSet::new();
    let mut total = 0;
    let mut occurrences = 0;
    let mut verses = Vec::new();
    for (book, chapter, number, text) in bible.located_passages() {
        let appearances = crate::text::words(text)
            .windows(tokens.len())
            .filter(|window| *window == tokens)
            .count();
        if appearances > 0 {
            occurrences += appearances;
            books.insert(book);
            total += 1;
            if total > offset && verses.len() < PAGE_SIZE {
                verses.push(Verse {
                    book: book.into(),
                    chapter,
                    number,
                    text: text.into(),
                });
            }
        }
    }
    let phrase = tokens.join(" ");
    Ok(PhraseDetail {
        words: tokens.len(),
        letters: phrase.chars().filter(|c| c.is_alphabetic()).count(),
        phrase,
        books: books.len(),
        occurrences,
        results: SearchPage { total, verses },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn consecutive_whole_words_count_books_and_verses_once() {
        let bible = Bible::from_json(r#"{"Genesis 1:1":"God, WORD; god word.","Genesis 1:2":"god wordless", "Genesis 1:3":"god", "Genesis 1:4":"word", "Exodus 1:1":"God WORD", "Exodus 1:2":"word god"}"#).unwrap();
        let result = details(&bible, " GOD, Word ", 0).unwrap();
        assert_eq!(result.occurrences, 3);
        assert_eq!(
            (
                result.phrase.as_str(),
                result.words,
                result.letters,
                result.books,
                result.results.total
            ),
            ("god word", 2, 7, 2, 2)
        );
        assert_eq!(result.results.verses[0].number, 1);
        assert_eq!(result.results.verses[1].book, "Exodus");
        assert!(details(&bible, "god", 0).is_err());
        assert!(details(&bible, &vec!["god"; 33].join(" "), 0).is_err());
        assert!(details(&bible, "god word", usize::MAX)
            .unwrap()
            .results
            .verses
            .is_empty());
    }
    #[test]
    fn every_matching_verse_is_reachable_in_canonical_order() {
        let source: serde_json::Map<String, serde_json::Value> = (1..=120)
            .map(|n| (format!("Genesis 1:{n}"), serde_json::json!("a word a word")))
            .collect();
        let bible = Bible::from_json(&serde_json::to_string(&source).unwrap()).unwrap();
        let numbers: Vec<_> = [0, 50, 100]
            .into_iter()
            .flat_map(|offset| {
                let detail = details(&bible, "a word", offset).unwrap();
                assert_eq!(detail.results.total, 120);
                assert_eq!(detail.occurrences, 240);
                detail.results.verses.into_iter().map(|verse| verse.number)
            })
            .collect();
        assert_eq!(numbers, (1..=120).collect::<Vec<_>>());
    }
}
