//! Thin IPC adapters: domain logic belongs in bible.rs.
use crate::bible::{Bible, Book, SearchPage, SearchQuery, Verse};
use crate::occurrences::{OccurrenceIndex, OccurrencePage, OccurrenceQuery};
use std::sync::Arc;

#[tauri::command]
pub fn catalog(bible: tauri::State<'_, Bible>) -> Vec<Book> {
    bible.catalog().to_vec()
}

#[tauri::command]
pub fn chapter(
    book: String,
    chapter: u16,
    bible: tauri::State<'_, Bible>,
) -> Result<Vec<Verse>, String> {
    bible.chapter(&book, chapter)
}

#[tauri::command]
pub fn search(query: SearchQuery, bible: tauri::State<'_, Bible>) -> SearchPage {
    bible.search(&query)
}

#[tauri::command]
pub async fn occurrences(
    query: OccurrenceQuery,
    index: tauri::State<'_, Arc<OccurrenceIndex>>,
) -> Result<OccurrencePage, String> {
    let index = Arc::clone(index.inner());
    tauri::async_runtime::spawn_blocking(move || index.search(&query))
        .await
        .map_err(|error| format!("Occurrence worker failed: {error}"))?
}

#[tauri::command]
pub fn book_stats(book: String, statistics: tauri::State<'_, crate::book_stats::BookStatistics>) -> Result<crate::book_stats::BookStats, String> {
    statistics.get(&book)
}

#[tauri::command]
pub async fn exclusive_count(book: String, length: u16, index: tauri::State<'_, Arc<OccurrenceIndex>>) -> Result<usize, String> {
    let index = Arc::clone(index.inner());
    tauri::async_runtime::spawn_blocking(move || index.exclusive_count(&book, length))
        .await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn exclusive_phrases(book: String, length: u16, offset: usize, index: tauri::State<'_, Arc<OccurrenceIndex>>) -> Result<crate::occurrences::exclusive::ExclusivePage, String> {
    let index = Arc::clone(index.inner());
    tauri::async_runtime::spawn_blocking(move || index.exclusive_page(&book, length, offset))
        .await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn word_list(text: String, offset: usize, books: Option<usize>, count: Option<usize>, statistics: tauri::State<'_, crate::word_stats::WordStatistics>) -> crate::word_stats::WordPage {
    statistics.list_filtered(&text, offset, books, count)
}
#[tauri::command]
pub fn word_details(word: String, statistics: tauri::State<'_, crate::word_stats::WordStatistics>) -> Result<crate::word_stats::WordDetail, String> {
    statistics.get(&word)
}

#[tauri::command]
pub async fn saved_phrases(offset: usize, filters: Option<crate::occurrences::catalogue::PhraseFilters>, phrases: tauri::State<'_, Arc<crate::occurrences::prepared::PreparedPhrases>>) -> Result<crate::occurrences::catalogue::SavedPhrasePage, String> {
    let phrases = Arc::clone(phrases.inner());
    tauri::async_runtime::spawn_blocking(move || phrases.page(offset, &filters.unwrap_or_default())).await.map_err(|error| error.to_string())?
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhrasePage { book_entries: Vec<crate::occurrences::prepared::BookOccurrence>, #[serde(flatten)] details:crate::phrase_stats::PhraseDetail, #[serde(flatten)] contents:crate::occurrences::prepared::PhraseContents }
#[tauri::command]
pub fn phrase_details(phrase:String,offset:usize,bible:tauri::State<'_,Bible>,phrases:tauri::State<'_,Arc<crate::occurrences::prepared::PreparedPhrases>>,statistics:tauri::State<'_,crate::word_stats::WordStatistics>)->Result<PhrasePage,String> {
    Ok(PhrasePage {book_entries:phrases.book_counts(&phrase)?,details:phrases.detail(&bible,&phrase,offset)?,contents:phrases.contents(&phrase,&statistics)?})
}

#[tauri::command]
pub fn verse_list(book: Option<String>, offset: usize, filters:Option<crate::occurrences::prepared::VerseFilters>, verses: tauri::State<'_, crate::occurrences::prepared::PreparedVerses>) -> Result<crate::occurrences::prepared::VersePage,String> { verses.page_filtered(book.as_deref(),offset,&filters.unwrap_or_default()) }
#[derive(serde::Deserialize)]
pub struct VerseDetailQuery { book:String, chapter:u16, verse:u16, offset:usize, sort:Option<crate::detail_lists::PhraseSort> }
#[tauri::command]
pub fn verse_details(query:VerseDetailQuery,verses:tauri::State<'_,crate::occurrences::prepared::PreparedVerses>,phrases:tauri::State<'_,Arc<crate::occurrences::prepared::PreparedPhrases>>,statistics:tauri::State<'_,crate::word_stats::WordStatistics>)->Result<crate::occurrences::prepared::VerseDetail,String> {
    let mut detail=verses.detail_sorted(&phrases,&query.book,query.chapter,query.verse,query.offset,query.sort.unwrap_or_default())?;
    detail.word_entries=crate::detail_lists::context_words(&detail.summary.verse.text,&detail.word_parts,&statistics)?;
    Ok(detail)
}

#[tauri::command]
pub fn reader_highlights(book:String,chapter:u16,verses:tauri::State<'_,crate::occurrences::prepared::PreparedVerses>,phrases:tauri::State<'_,Arc<crate::occurrences::prepared::PreparedPhrases>>,statistics:tauri::State<'_,crate::word_stats::WordStatistics>,books:tauri::State<'_,crate::book_stats::BookStatistics>)->Result<crate::reader_highlights::ChapterHighlights,String> {
    verses.highlights(&phrases,&statistics,&books,&book,chapter)
}

#[tauri::command]
pub fn number_list(offset:usize, statistics:tauri::State<'_,crate::number_stats::NumberStatistics>)->crate::number_stats::NumberPage { statistics.list(offset) }
#[tauri::command]
pub fn number_words(number:usize, offset:usize, statistics:tauri::State<'_,crate::number_stats::NumberStatistics>)->crate::word_stats::WordPage { statistics.words(number,offset) }

#[tauri::command]
pub fn verse_catalogue(query:crate::occurrences::prepared::VerseFrequencyQuery,verses:tauri::State<'_,crate::occurrences::prepared::PreparedVerses>)->Result<crate::occurrences::prepared::VersePage,String> {verses.frequency_page(&query)}
