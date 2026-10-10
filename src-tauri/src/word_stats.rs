//! Alphabetical word catalogue with canonical first mentions and book frequencies.
use crate::bible::{Bible, Verse, PAGE_SIZE};
use serde::{Serialize, Deserialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WordBook {
    pub name: String,
    pub count: usize,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WordDetail {
    pub word: String,
    pub count: usize,
    pub books: Vec<WordBook>,
    pub first_mention: Verse,
    pub letters: usize,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct WordSummary {
    pub word: String,
    pub count: usize,
    pub books: usize,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct WordPage {
    pub total: usize,
    pub entries: Vec<WordSummary>,
}
#[derive(Serialize, Deserialize)]
pub struct WordStatistics(BTreeMap<String, WordDetail>);
impl WordStatistics {
    pub fn find_normalized(&self,word:&str)->Option<&WordDetail>{self.0.get(word)}
    pub fn new(bible: &Bible) -> Self {
        let mut entries = BTreeMap::<String, WordDetail>::new();
        for (book, chapter, number, text) in bible.located_passages() {
            for word in crate::text::words(text) {
                let entry = entries.entry(word.clone()).or_insert_with(|| WordDetail {
                    letters: word.chars().filter(|c| c.is_alphabetic()).count(),
                    word,
                    count: 0,
                    books: Vec::new(),
                    first_mention: Verse {
                        book: book.into(),
                        chapter,
                        number,
                        text: text.into(),
                    },
                });
                entry.count += 1;
                if let Some(found) = entry.books.iter_mut().find(|entry| entry.name == book) {
                    found.count += 1;
                } else {
                    entry.books.push(WordBook {
                        name: book.into(),
                        count: 1,
                    });
                }
            }
        }
        Self(entries)
    }
    pub fn list(&self, text: &str, offset: usize) -> WordPage {
        self.list_filtered(text, offset, None, None)
    }
    pub fn list_filtered(
        &self,
        text: &str,
        offset: usize,
        books: Option<usize>,
        count: Option<usize>,
    ) -> WordPage {
        let text = text.trim().to_lowercase();
        let matches = || {
            self.0.values().filter(|entry| {
                entry.word.contains(&text)
                    && books.is_none_or(|books| entry.books.len() == books)
                    && count.is_none_or(|count| entry.count == count)
            })
        };
        WordPage {
            total: matches().count(),
            entries: matches()
                .skip(offset)
                .take(PAGE_SIZE)
                .map(|entry| WordSummary {
                    word: entry.word.clone(),
                    count: entry.count,
                    books: entry.books.len(),
                })
                .collect(),
        }
    }
    pub fn get(&self, word: &str) -> Result<WordDetail, String> {
        self.0
            .get(&word.trim().to_lowercase())
            .cloned()
            .ok_or_else(|| format!("Word not found: {word}"))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ranks_counts_books_first_mentions_and_letters() {
        let bible = Bible::from_json(r#"{"Genesis 1:1":"God, GOD God's alpha.","Genesis 1:2":"godhead", "Exodus 1:1":"god alpha"}"#).unwrap();
        let stats = WordStatistics::new(&bible);
        assert_eq!(
            stats
                .list("", 0)
                .entries
                .iter()
                .map(|entry| entry.word.as_str())
                .collect::<Vec<_>>(),
            vec!["alpha", "god", "god's", "godhead"]
        );
        let god = stats.get(" GOD ").unwrap();
        assert_eq!((god.count, god.books.len(), god.letters), (3, 2, 3));
        assert_eq!(
            god.books
                .iter()
                .map(|book| (book.name.as_str(), book.count))
                .collect::<Vec<_>>(),
            vec![("Genesis", 2), ("Exodus", 1)]
        );
        assert_eq!(
            (
                god.first_mention.book.as_str(),
                god.first_mention.chapter,
                god.first_mention.number
            ),
            ("Genesis", 1, 1)
        );
        assert_eq!(stats.get("god's").unwrap().letters, 4);
        assert_eq!(stats.list("god", 1).entries.len(), 2);
        assert_eq!(stats.list("missing", 0).total, 0);
        assert!(stats.get("missing").is_err());
    }
    #[test]
    fn bundled_totals_and_paging_are_complete() {
        let bible = Bible::bundled().unwrap();
        let stats = WordStatistics::new(&bible);
        let expected: usize = bible
            .passages()
            .map(|(_, text)| crate::text::words(text).len())
            .sum();
        assert_eq!(
            stats.0.values().map(|entry| entry.count).sum::<usize>(),
            expected
        );
        let total = stats.list("", 0).total;
        let words: Vec<_> = (0..total)
            .step_by(PAGE_SIZE)
            .flat_map(|offset| {
                stats
                    .list("", offset)
                    .entries
                    .into_iter()
                    .map(|entry| entry.word)
            })
            .collect();
        assert_eq!(words, stats.0.keys().cloned().collect::<Vec<_>>());
    }
    #[test]
    fn exact_counts_combine_with_text_before_pagination() {
        let bible = Bible::from_json(
            r#"{"Genesis 1:1":"a a b c", "Exodus 1:1":"a b b", "Leviticus 1:1":"b"}"#,
        )
        .unwrap();
        let stats = WordStatistics::new(&bible);
        assert_eq!(
            stats.list_filtered("", 0, Some(2), Some(3)).entries[0].word,
            "a"
        );
        assert_eq!(stats.list_filtered("b", 0, Some(3), Some(4)).total, 1);
        assert_eq!(stats.list_filtered("a", 0, Some(3), None).total, 0);
        assert_eq!(stats.list_filtered("", 1, None, Some(3)).entries.len(), 0);
        let full = WordStatistics::new(&Bible::bundled().unwrap());
        let expected: Vec<_> = full
            .0
            .values()
            .filter(|entry| entry.books.len() == 66)
            .map(|entry| entry.word.clone())
            .collect();
        assert!(!expected.is_empty());
        assert_eq!(
            full.list_filtered("", 0, Some(66), None)
                .entries
                .into_iter()
                .map(|entry| entry.word)
                .collect::<Vec<_>>(),
            expected
        );
    }
}
