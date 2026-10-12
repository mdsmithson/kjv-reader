//! Chapter highlight flags read from prepared word boundaries and saved statistics.
use serde::Serialize;
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HighlightWord {
    pub start: u32,
    pub end: u32,
    pub word: String,
    pub count: usize,
    pub exclusive: bool,
    pub first_mention: bool,
    pub last_mention: bool,
}
#[derive(Serialize)]
pub struct HighlightPhrase {
    pub start: u32,
    pub end: u32,
    pub count: usize,
}
#[derive(Serialize)]
pub struct HighlightVerse {
    pub number: u16,
    pub words: Vec<HighlightWord>,
    pub phrases: Vec<HighlightPhrase>,
}
#[derive(Serialize)]
pub struct ChapterHighlights {
    pub book: String,
    pub chapter: u16,
    pub verses: Vec<HighlightVerse>,
}
