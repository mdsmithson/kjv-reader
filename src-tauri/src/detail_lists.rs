//! Shared sorting and saved word metadata for verse and phrase detail lists.
use serde::{Deserialize, Serialize};
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PhraseSortField {
    #[default]
    Phrase,
    Occurrences,
    Books,
}
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SortDirection {
    #[default]
    Asc,
    Desc,
}
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
pub struct PhraseSort {
    #[serde(default)]
    pub field: PhraseSortField,
    #[serde(default)]
    pub direction: SortDirection,
}
impl PhraseSort {
    pub fn rank(self, offset: usize, total: usize) -> usize {
        match self.direction {
            SortDirection::Asc => offset,
            SortDirection::Desc => total - 1 - offset,
        }
    }
}
#[derive(Clone, Debug, Serialize)]
pub struct ContextWord {
    pub word: String,
    pub display: String,
    pub occurrences: usize,
    pub letters: usize,
    pub books: usize,
}
pub fn context_words(
    text: &str,
    parts: &[crate::occurrences::prepared::VerseWord],
    stats: &crate::word_stats::WordStatistics,
) -> Result<Vec<ContextWord>, String> {
    let utf16: Vec<_> = text.encode_utf16().collect();
    let mut entries = std::collections::BTreeMap::new();
    for part in parts {
        if !entries.contains_key(&part.word) {
            let word = stats.get(&part.word)?;
            let display = String::from_utf16(
                utf16
                    .get(part.start as usize..part.end as usize)
                    .ok_or("Invalid word boundary")?,
            )
            .map_err(|_| "Invalid word text")?;
            entries.insert(
                part.word.clone(),
                ContextWord {
                    word: part.word.clone(),
                    display,
                    occurrences: word.count,
                    letters: word.letters,
                    books: word.books.len(),
                },
            );
        }
    }
    Ok(entries.into_values().collect())
}
