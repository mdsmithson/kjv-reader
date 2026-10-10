//! Pure domain operations over an immutable, canonically ordered corpus.
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Verse {
    pub book: String,
    pub chapter: u16,
    pub number: u16,
    pub text: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Book {
    pub name: String,
    pub chapters: u16,
}

#[derive(Debug)]
struct IndexedVerse {
    verse: Verse,
    normalized: String,
    word_text: String,
}

#[derive(Debug)]
pub struct Bible {
    books: Vec<Book>,
    verses: Vec<IndexedVerse>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchQuery {
    pub text: String,
    pub book: Option<String>,
    pub phrase: bool,
    #[serde(default)]
    pub partial: bool,
    pub offset: usize,
    #[serde(default)]
    pub normalized_words: bool,
    pub included_books: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
pub struct SearchPage {
    pub total: usize,
    pub verses: Vec<Verse>,
}

pub const PAGE_SIZE: usize = 50;

fn parse_verse((reference, text): (String, String)) -> Result<IndexedVerse, String> {
    let invalid = || format!("Invalid verse reference: {reference}");
    let (book, location) = reference.rsplit_once(' ').ok_or_else(invalid)?;
    let (chapter, number) = location.split_once(':').ok_or_else(invalid)?;
    let verse = Verse {
        book: book.to_owned(),
        chapter: chapter.parse().map_err(|_| invalid())?,
        number: number.parse().map_err(|_| invalid())?,
        text,
    };
    if book.is_empty() || verse.chapter == 0 || verse.number == 0 {
        return Err(invalid());
    }
    Ok(IndexedVerse {
        normalized: verse.text.to_lowercase(),
        word_text: crate::text::word_text(&verse.text),
        verse,
    })
}

fn to_verse(indexed: &IndexedVerse) -> Verse {
    indexed.verse.clone()
}

impl Bible {
    pub fn verse_at(&self, index: usize) -> Option<Verse> { self.verses.get(index).map(to_verse) }
    pub fn bundled() -> Result<Self, String> {
        Self::from_json(include_str!("../data/kjv.json"))
    }

    pub fn from_json(json: &str) -> Result<Self, String> {
        let source: serde_json::Map<String, serde_json::Value> =
            serde_json::from_str(json).map_err(|error| error.to_string())?;
        let verses = source
            .into_iter()
            .map(|(reference, value)| {
                value
                    .as_str()
                    .map(str::to_owned)
                    .ok_or_else(|| format!("Expected verse text: {reference}"))
                    .and_then(|text| parse_verse((reference, text)))
            })
            .collect::<Result<Vec<_>, _>>()?;
        let books = verses.iter().fold(Vec::<Book>::new(), |mut books, indexed| {
            match books.last_mut() {
                Some(book) if book.name == indexed.verse.book => {
                    book.chapters = book.chapters.max(indexed.verse.chapter);
                }
                _ => books.push(Book {
                    name: indexed.verse.book.clone(),
                    chapters: indexed.verse.chapter,
                }),
            }
            books
        });
        Ok(Self { books, verses })
    }

    pub fn catalog(&self) -> &[Book] {
        &self.books
    }

    pub fn texts(&self) -> impl Iterator<Item = &str> {
        self.verses.iter().map(|indexed| indexed.verse.text.as_str())
    }

    pub fn passages(&self) -> impl Iterator<Item = (&str, &str)> {
        self.verses.iter().map(|indexed| (indexed.verse.book.as_str(), indexed.verse.text.as_str()))
    }

    pub fn located_passages(&self) -> impl Iterator<Item = (&str, u16, u16, &str)> {
        self.verses.iter().map(|indexed| (
            indexed.verse.book.as_str(), indexed.verse.chapter,
            indexed.verse.number, indexed.verse.text.as_str(),
        ))
    }

    pub fn chapter(&self, book: &str, chapter: u16) -> Result<Vec<Verse>, String> {
        let verses: Vec<_> = self
            .verses
            .iter()
            .filter(|indexed| indexed.verse.book == book && indexed.verse.chapter == chapter)
            .map(to_verse)
            .collect();
        (!verses.is_empty())
            .then_some(verses)
            .ok_or_else(|| format!("Chapter not found: {book} {chapter}"))
    }

    pub fn search(&self, query: &SearchQuery) -> SearchPage {
        let normalized = query.text.trim().to_lowercase();
        let terms: Vec<_> = normalized.split_whitespace().collect();
        let word_query = crate::text::word_text(&query.text);
        let matches = |indexed: &&IndexedVerse| {
            !terms.is_empty()
                && query
                    .book
                    .as_ref()
                    .is_none_or(|book| *book == indexed.verse.book)
                && query.included_books.as_ref().is_none_or(|books| books.contains(&indexed.verse.book))
                && if query.normalized_words {
                    word_query != "  " && indexed.word_text.contains(&word_query)
                } else if !query.partial {
                    let words = crate::text::words(&query.text);
                    !words.is_empty() && if query.phrase { indexed.word_text.contains(&word_query) } else {
                        words.iter().all(|word| indexed.word_text.contains(&format!(" {word} ")))
                    }
                } else if query.phrase {
                    indexed.normalized.contains(&normalized)
                } else {
                    terms.iter().all(|term| indexed.normalized.contains(term))
                }
        };
        let matching = || self.verses.iter().filter(matches);
        SearchPage {
            total: matching().count(),
            verses: matching()
                .skip(query.offset)
                .take(PAGE_SIZE)
                .map(to_verse)
                .collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn whole_words_are_default_and_partial_matches_are_optional() {
        let bible = Bible::from_json(r#"{"Genesis 1:1":"God, GOD's word.","Genesis 1:2":"godhead words","Genesis 1:3":"God; word!"}"#).unwrap();
        let mut request = query("god");
        assert_eq!(bible.search(&request).total, 2);
        request.partial = true;
        assert_eq!(bible.search(&request).total, 3);
        request = query("god's");
        assert_eq!(bible.search(&request).total, 1);
        request = query("god word");
        request.phrase = true;
        assert_eq!(bible.search(&request).verses[0].number, 3);
        assert_eq!(bible.search(&query("!!!")).total, 0);
    }

    fn query(text: &str) -> SearchQuery {
        SearchQuery {
            text: text.into(),
            book: None,
            phrase: false,
            partial: false,
            offset: 0,
            normalized_words: false,
            included_books: None,
        }
    }

    #[test]
    fn bundled_corpus_has_canonical_order_and_complete_chapters() {
        let bible = Bible::bundled().unwrap();
        assert_eq!(bible.catalog().len(), 66);
        assert_eq!(bible.catalog().first().unwrap().name, "Genesis");
        assert_eq!(bible.catalog().last().unwrap().name, "Revelation");
        assert_eq!(bible.verses.len(), 31_102);
        assert_eq!(
            bible
                .catalog()
                .iter()
                .map(|book| book.chapters as usize)
                .sum::<usize>(),
            1_189
        );
        assert_eq!(bible.chapter("Genesis", 1).unwrap().len(), 31);
        assert_eq!(
            bible.chapter("Revelation", 22).unwrap().last().unwrap().number,
            21
        );
        assert!(bible.chapter("Genesis", 51).is_err());
        assert!(bible.chapter("Missing", 1).is_err());
        assert!(bible.chapter("Genesis", 0).is_err());
    }

    #[test]
    fn search_is_case_insensitive_paged_and_book_scoped() {
        let bible = Bible::bundled().unwrap();
        let mut query = query("  GOD  ");
        let first = bible.search(&query);
        assert!(first.total > PAGE_SIZE);
        assert_eq!(first.verses.len(), PAGE_SIZE);
        query.offset = PAGE_SIZE;
        let second = bible.search(&query);
        assert_eq!(first.total, second.total);
        assert_ne!(first.verses[0].text, second.verses[0].text);
        query.book = Some("1 John".into());
        query.offset = 0;
        assert!(bible
            .search(&query)
            .verses
            .iter()
            .all(|verse| verse.book == "1 John"));
        query.offset = usize::MAX;
        assert!(bible.search(&query).verses.is_empty());
    }

    #[test]
    fn phrase_and_all_terms_have_distinct_meanings() {
        let bible = Bible::bundled().unwrap();
        let mut query = query("beginning God");
        let terms = bible.search(&query);
        query.phrase = true;
        let phrase = bible.search(&query);
        assert!(terms.total > phrase.total);
        assert_eq!(phrase.verses[0].number, 1);
        assert_eq!(phrase.verses[0].book, "Genesis");
        assert_eq!(bible.search(&super::tests::query("   ")).total, 0);
        assert_eq!(bible.search(&super::tests::query("zzzz_no_match")).total, 0);
    }

    #[test]
    fn malformed_sources_fail_explicitly() {
        assert!(Bible::from_json(r#"{"Genesis bad":"text"}"#).is_err());
        assert!(Bible::from_json(r#"{"Genesis 1:1":42}"#).is_err());
        assert!(Bible::from_json(r#"{"Genesis 0:1":"text"}"#).is_err());
    }

    #[test]
    fn counted_phrase_search_uses_whole_normalized_words() {
        let bible = Bible::from_json(r#"{"Genesis 1:1":"God, [word] God; word.","Genesis 1:2":"godhead word"}"#).unwrap();
        let mut query = query("god word");
        query.normalized_words = true;
        assert_eq!(bible.search(&query).total, 1);
        assert_eq!(bible.search(&query).verses[0].number, 1);
        query.text = "God".into();
        assert_eq!(bible.search(&query).total, 1);
    }
}
