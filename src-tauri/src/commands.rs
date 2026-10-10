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
