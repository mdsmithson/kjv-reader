pub mod bible;
pub mod number_stats;
pub mod reader_highlights;
pub mod detail_lists;
pub mod book_stats;
pub mod occurrences;
pub mod text;
pub mod word_stats;
pub mod phrase_stats;
mod spatial;

#[cfg(feature = "desktop")]
mod commands;
#[cfg(feature = "desktop")]
mod clipboard;

#[cfg(feature = "desktop")]
pub fn run() {
    use std::sync::Arc;
    use tauri::Manager;
    let bible = bible::Bible::bundled().expect("Bundled Bible must be valid");
    tauri::Builder::default()
        .manage(bible)
        .setup(|app| {
            let bible = app.state::<bible::Bible>();
            let prepared = app.path().resource_dir()?.join("precomputed");
            #[cfg(debug_assertions)]
            let prepared = if prepared.join("manifest.json").exists() { prepared } else {
                std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("data/precomputed")
            };
            let phrases = occurrences::prepared::PreparedPhrases::open(&prepared, &bible)?;
            app.manage(occurrences::prepared::PreparedVerses::open(&prepared, &bible, &phrases)?);
            app.manage(Arc::new(phrases));
            app.manage(serde_json::from_reader::<_, book_stats::BookStatistics>(std::fs::File::open(prepared.join("books.json"))?)?);
            app.manage(serde_json::from_reader::<_, word_stats::WordStatistics>(std::fs::File::open(prepared.join("words.json"))?)?);
            app.manage(serde_json::from_reader::<_, number_stats::NumberStatistics>(std::fs::File::open(prepared.join("numbers.json"))?)?);
            let index = occurrences::OccurrenceIndex::from_passages(
                bible.located_passages(),
                &app.path().app_local_data_dir()?,
            ).with_prebuilt(&prepared.join("occurrences"));
            app.manage(Arc::new(index));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::number_list,
            commands::number_words,
            commands::catalog,
            commands::reader_highlights,
            commands::verse_list,
            commands::verse_catalogue,
            commands::verse_details,
            commands::word_list,
            commands::saved_phrases,
            commands::phrase_details,
            commands::word_details,
            commands::book_stats,
            commands::books_stats,
            commands::exclusive_count,
            commands::exclusive_phrases,
            commands::chapter,
            commands::search,
            commands::occurrences,
            commands::copy_occurrence_csv
        ])
        .run(tauri::generate_context!())
        .expect("Unable to run KJV Reader");
}
