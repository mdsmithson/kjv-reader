//! One corpus pass computes per-book counts and global word ownership.
use crate::bible::Bible;
use serde::{Serialize, Deserialize};
use std::collections::{BTreeMap, HashSet};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct CommonWord {
    pub word: String,
    pub count: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookStats {
    pub name: String,
    pub words: usize,
    pub unique_words: usize,
    pub verses: usize,
    pub most_common: Vec<CommonWord>,
    pub most_common_exclusive: Vec<CommonWord>,
    pub exclusive_words: Vec<CommonWord>,
    pub chapters: Vec<ChapterStats>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterStats {
    pub chapter: u16,
    pub words: usize,
    pub unique_words: usize,
    pub exclusive_words: Vec<CommonWord>,
}

#[derive(Serialize, Deserialize)]
pub struct BookStatistics(BTreeMap<String, BookStats>);

fn leaders<'a>(words: impl Iterator<Item = (&'a String, &'a usize)>) -> Vec<CommonWord> {
    words.fold(Vec::<CommonWord>::new(), |mut best, (word, &count)| {
        let maximum = best.first().map_or(0, |entry| entry.count);
        if count > maximum {
            best.clear();
        }
        if count >= maximum {
            best.push(CommonWord {
                word: word.clone(),
                count,
            });
        }
        best
    })
}

fn ranked<'a>(words: impl Iterator<Item = (&'a String, &'a usize)>) -> Vec<CommonWord> {
    let mut entries: Vec<_> = words
        .map(|(word, &count)| CommonWord {
            word: word.clone(),
            count,
        })
        .collect();
    entries.sort_unstable_by(|left, right| {
        right
            .count
            .cmp(&left.count)
            .then_with(|| left.word.cmp(&right.word))
    });
    entries
}

impl BookStatistics {
    pub fn new(bible: &Bible) -> Self {
        let mut counts = BTreeMap::<String, (usize, BTreeMap<String, usize>)>::new();
        let mut chapter_counts = BTreeMap::<(String, u16), BTreeMap<String, usize>>::new();
        for (book, chapter, _, text) in bible.located_passages() {
            let (verses, words) = counts.entry(book.into()).or_default();
            let chapter_words = chapter_counts.entry((book.into(), chapter)).or_default();
            *verses += 1;
            for word in crate::text::words(text) {
                *chapter_words.entry(word.clone()).or_default() += 1;
                *words.entry(word).or_default() += 1;
            }
        }
        // Each word contributes once per chapter, even when repeated in that chapter.
        let chapter_owners = chapter_counts.values().flat_map(|words| words.keys()).fold(
            BTreeMap::<&str, usize>::new(),
            |mut owners, word| {
                *owners.entry(word).or_default() += 1;
                owners
            },
        );
        let owners = counts.values().flat_map(|(_, words)| words.keys()).fold(
            BTreeMap::<&str, usize>::new(),
            |mut owners, word| {
                *owners.entry(word).or_default() += 1;
                owners
            },
        );
        Self(
            counts
                .iter()
                .map(|(name, (verses, words))| {
                    (
                        name.clone(),
                        BookStats {
                            name: name.clone(),
                            words: words.values().sum(),
                            unique_words: words.len(),
                            verses: *verses,
                            most_common: leaders(words.iter()),
                            most_common_exclusive: leaders(
                                words.iter().filter(|(word, _)| owners[word.as_str()] == 1),
                            ),
                            exclusive_words: ranked(
                                words.iter().filter(|(word, _)| owners[word.as_str()] == 1),
                            ),
                            chapters: chapter_counts
                                .iter()
                                .filter(|((book, _), _)| book == name)
                                .map(|((_, chapter), words)| ChapterStats {
                                    chapter: *chapter,
                                    words: words.values().sum(),
                                    unique_words: words.len(),
                                    exclusive_words: ranked(
                                        words
                                            .iter()
                                            .filter(|(word, _)| chapter_owners[word.as_str()] == 1),
                                    ),
                                })
                                .collect(),
                        },
                    )
                })
                .collect(),
        )
    }

    /// Combine saved per-book word frequencies; no Bible text is retokenized.
    pub fn combined(&self, books: &[String], words: &crate::word_stats::WordStatistics) -> Result<BookStats,String> {
        if books.is_empty() { return Err("Choose at least one book.".into()); }
        let selected: HashSet<&str>=books.iter().map(String::as_str).collect();
        for book in &selected { if !self.0.contains_key(*book) { return Err(format!("Book not found: {book}")); } }
        let verses=selected.iter().map(|book|self.0[*book].verses).sum();
        let mut counts=BTreeMap::<String,usize>::new();
        let mut exclusive=BTreeMap::<String,usize>::new();
        for entry in words.entries() {
            let count=entry.books.iter().filter(|book|selected.contains(book.name.as_str())).map(|book|book.count).sum::<usize>();
            if count>0 {
                counts.insert(entry.word.clone(),count);
                if entry.books.iter().all(|book|selected.contains(book.name.as_str())) { exclusive.insert(entry.word.clone(),count); }
            }
        }
        let mut names=Vec::new();
        for book in books { if !names.contains(book) { names.push(book.clone()); } }
        Ok(BookStats { name:names.join(", "), words:counts.values().sum(), unique_words:counts.len(), verses, most_common:leaders(counts.iter()), most_common_exclusive:leaders(exclusive.iter()), exclusive_words:ranked(exclusive.iter()), chapters:Vec::new() })
    }

    pub fn get(&self, book: &str) -> Result<BookStats, String> {
        self.0
            .get(book)
            .cloned()
            .ok_or_else(|| format!("Book not found: {book}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn combined_books_include_shared_exclusives_without_double_counting() {
        let bible=Bible::from_json(r#"{"Genesis 1:1":"the alpha alpha shared shared overlap","Exodus 1:1":"the beta beta shared overlap","Numbers 1:1":"the overlap outside"}"#).unwrap();
        let saved:BookStatistics=serde_json::from_str(&serde_json::to_string(&BookStatistics::new(&bible)).unwrap()).unwrap();
        let words:crate::word_stats::WordStatistics=serde_json::from_str(&serde_json::to_string(&crate::word_stats::WordStatistics::new(&bible)).unwrap()).unwrap();
        let group=saved.combined(&["Genesis".into(),"Exodus".into(),"Genesis".into()],&words).unwrap();
        assert_eq!((group.words,group.unique_words,group.verses),(11,5,2));
        assert!(group.chapters.is_empty());
        assert_eq!(group.most_common,vec![CommonWord {word:"shared".into(),count:3}]);
        assert_eq!(group.most_common_exclusive,group.most_common);
        assert_eq!(group.exclusive_words,vec![CommonWord {word:"shared".into(),count:3},CommonWord {word:"alpha".into(),count:2},CommonWord {word:"beta".into(),count:2}]);
        let single=saved.combined(&["Genesis".into()],&words).unwrap();
        let original=saved.get("Genesis").unwrap();
        assert_eq!((single.words,single.unique_words,single.verses),(original.words,original.unique_words,original.verses));
        assert_eq!(single.exclusive_words,original.exclusive_words);
        let all=saved.combined(&["Genesis".into(),"Exodus".into(),"Numbers".into()],&words).unwrap();
        assert_eq!((all.words,all.unique_words,all.verses),(14,6,3));
        assert_eq!(all.exclusive_words.len(),all.unique_words);
        assert_eq!(all.most_common.iter().map(|entry|entry.word.as_str()).collect::<Vec<_>>(),vec!["overlap","shared","the"]);
        assert!(saved.combined(&[],&words).is_err());
        assert!(saved.combined(&["Unknown".into()],&words).is_err());
    }

    #[test]
    fn chapter_exclusivity_spans_other_chapters_and_books() {
        let bible = Bible::from_json(r#"{"Genesis 1:1":"THE alpha alpha can't beta.","Genesis 1:2":"Alpha gamma","Genesis 2:1":"the beta delta","Exodus 1:1":"gamma delta"}"#).unwrap();
        let stats = BookStatistics::new(&bible);
        let genesis = stats.get("Genesis").unwrap();
        let first = &genesis.chapters[0];
        assert_eq!(
            (
                first.chapter,
                first.words,
                first.unique_words,
                first.exclusive_words.len()
            ),
            (1, 7, 5, 2)
        );
        let second = &genesis.chapters[1];
        assert_eq!(
            first.exclusive_words,
            vec![
                CommonWord {
                    word: "alpha".into(),
                    count: 3
                },
                CommonWord {
                    word: "can't".into(),
                    count: 1
                },
            ]
        );
        assert_eq!(
            (
                second.chapter,
                second.words,
                second.unique_words,
                second.exclusive_words.len()
            ),
            (2, 3, 3, 0)
        );
        assert_eq!(
            stats.get("Exodus").unwrap().chapters[0]
                .exclusive_words
                .len(),
            0
        );
    }

    #[test]
    fn chapter_totals_match_book_totals_for_bundled_bible() {
        let bible = Bible::bundled().unwrap();
        let stats = BookStatistics::new(&bible);
        for book in bible.catalog() {
            let book_stats = stats.get(&book.name).unwrap();
            assert_eq!(book_stats.chapters.len(), usize::from(book.chapters));
            assert_eq!(
                book_stats
                    .chapters
                    .iter()
                    .map(|chapter| chapter.words)
                    .sum::<usize>(),
                book_stats.words
            );
            for chapter in book_stats.chapters {
                assert!(chapter.exclusive_words.len() <= chapter.unique_words);
                assert!(chapter.unique_words <= chapter.words);
            }
        }
    }

    #[test]
    fn counts_tokens_ownership_ties_and_empty_exclusives() {
        let bible = Bible::from_json(r#"{"Genesis 1:1":"The alpha alpha beta beta.","Genesis 1:2":"THE gamma","Exodus 1:1":"the gamma gamma"}"#).unwrap();
        let stats = BookStatistics::new(&bible);
        let genesis = stats.get("Genesis").unwrap();
        assert_eq!(
            (genesis.words, genesis.unique_words, genesis.verses),
            (7, 4, 2)
        );
        assert_eq!(
            genesis
                .most_common
                .iter()
                .map(|w| w.word.as_str())
                .collect::<Vec<_>>(),
            vec!["alpha", "beta", "the"]
        );
        assert_eq!(
            genesis
                .most_common_exclusive
                .iter()
                .map(|w| w.word.as_str())
                .collect::<Vec<_>>(),
            vec!["alpha", "beta"]
        );
        assert!(stats
            .get("Exodus")
            .unwrap()
            .most_common_exclusive
            .is_empty());
        assert!(stats.get("Exodus").unwrap().exclusive_words.is_empty());
        assert!(stats.get("Unknown").is_err());
    }

    #[test]
    fn exclusive_words_rank_by_frequency_then_alphabetically() {
        let bible = Bible::from_json(r#"{"Genesis 1:1":"rare beta alpha beta ALPHA top top top shared","Exodus 1:1":"shared"}"#).unwrap();
        let stats = BookStatistics::new(&bible).get("Genesis").unwrap();
        let words = stats.exclusive_words;
        assert_eq!(stats.chapters[0].exclusive_words, words);
        assert_eq!(
            words,
            vec![
                CommonWord {
                    word: "top".into(),
                    count: 3
                },
                CommonWord {
                    word: "alpha".into(),
                    count: 2
                },
                CommonWord {
                    word: "beta".into(),
                    count: 2
                },
                CommonWord {
                    word: "rare".into(),
                    count: 1
                },
            ]
        );
    }
}
