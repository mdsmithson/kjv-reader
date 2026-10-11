//! Saved numeric profiles, indexed by whole-Bible word frequency.
use crate::{
    bible::PAGE_SIZE,
    word_stats::{WordPage, WordStatistics, WordSummary},
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
#[derive(Serialize, Deserialize)]
pub struct NumberStatistics(BTreeMap<usize, Vec<WordSummary>>);
#[derive(Serialize)]
pub struct NumberSummary {
    pub number: usize,
    pub words: usize,
}
#[derive(Serialize)]
pub struct NumberPage {
    pub total: usize,
    pub entries: Vec<NumberSummary>,
}
impl NumberStatistics {
    pub fn new(words: &WordStatistics) -> Self {
        let mut groups = BTreeMap::<usize, Vec<WordSummary>>::new();
        // Include numbers used by the linked word statistics, even if no word
        // has that exact frequency. WordStatistics iterates alphabetically.
        for word in words.entries() {
            groups.entry(word.books.len()).or_default();
            groups.entry(word.letters).or_default();
            groups.entry(word.count).or_default().push(WordSummary {
                word: word.word.clone(),
                count: word.count,
                books: word.books.len(),
            });
        }
        Self(groups)
    }
    pub fn list(&self, offset: usize) -> NumberPage {
        NumberPage {
            total: self.0.len(),
            entries: self
                .0
                .iter()
                .skip(offset)
                .take(PAGE_SIZE)
                .map(|(&number, words)| NumberSummary {
                    number,
                    words: words.len(),
                })
                .collect(),
        }
    }
    pub fn words(&self, number: usize, offset: usize) -> WordPage {
        let words = self.0.get(&number).map(Vec::as_slice).unwrap_or_default();
        WordPage {
            total: words.len(),
            entries: words
                .iter()
                .skip(offset)
                .take(PAGE_SIZE)
                .map(|word| WordSummary {
                    word: word.word.clone(),
                    count: word.count,
                    books: word.books,
                })
                .collect(),
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn profiles_roundtrip_and_page_alphabetically_without_recounting() {
        let text = (0..71)
            .map(|i| format!("word{i}"))
            .collect::<Vec<_>>()
            .join(" ");
        let bible = crate::bible::Bible::from_json(&serde_json::json!({"Genesis 1:1": format!("{text} repeat repeat"), "Exodus 1:1": "repeat"}).to_string()).unwrap();
        let stats = WordStatistics::new(&bible);
        let saved = serde_json::to_vec(&NumberStatistics::new(&stats)).unwrap();
        let numbers: NumberStatistics = serde_json::from_slice(&saved).unwrap();
        assert_eq!(numbers.words(1, 0).total, 71);
        assert_eq!(numbers.words(1, 0).entries.len(), PAGE_SIZE);
        assert_eq!(numbers.words(1, PAGE_SIZE).entries.len(), 21);
        let expected = stats.list_filtered("", PAGE_SIZE, None, Some(1));
        assert_eq!(
            serde_json::to_value(numbers.words(1, PAGE_SIZE)).unwrap(),
            serde_json::to_value(expected).unwrap()
        );
        assert_eq!(numbers.words(3, 0).entries[0].word, "repeat");
        assert_eq!(numbers.words(2, 0).total, 0);
        assert_eq!(numbers.words(99999, 0).total, 0);
        assert_eq!(numbers.words(1, 999).entries.len(), 0);
        assert!(numbers
            .list(0)
            .entries
            .windows(2)
            .all(|pair| pair[0].number < pair[1].number));
        assert!(numbers
            .list(0)
            .entries
            .iter()
            .any(|entry| entry.number == 6));
    }
}
