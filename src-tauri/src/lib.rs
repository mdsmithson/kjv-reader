pub mod bible;
pub mod book_stats;
pub mod occurrences;
pub mod text;
mod spatial;

#[cfg(feature = "desktop")]
mod commands;

#[cfg(feature = "desktop")]
pub fn run() {
    use std::sync::Arc;
    use tauri::Manager;
    let bible = bible::Bible::bundled().expect("Bundled Bible must be valid");
    tauri::Builder::default()
        .manage(book_stats::BookStatistics::new(&bible))
        .manage(bible)
        .setup(|app| {
            let bible = app.state::<bible::Bible>();
            let index = occurrences::OccurrenceIndex::from_passages(
                bible.located_passages(),
                &app.path().app_local_data_dir()?,
            );
            app.manage(Arc::new(index));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::catalog,
            commands::book_stats,
            commands::exclusive_count,
            commands::exclusive_phrases,
            commands::chapter,
            commands::search,
            commands::occurrences
        ])
        .run(tauri::generate_context!())
        .expect("Unable to run KJV Reader");
}
