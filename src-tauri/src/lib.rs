mod progress_store;
mod reader;
mod webtoon;

use anyhow::Context;
use progress_store::ProgressStore;
use reader::{
  clear_progress_entry,
  fetch_webtoon_catalog,
  get_page,
  get_thumbnail,
  list_progress,
  list_sessions,
  load_cbz,
  load_webtoon,
  open_progress_entry,
  prepare_batch,
  resume_session,
  update_progress,
  SessionManager,
};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      let data_dir = app
        .path()
        .app_data_dir()
        .context("Impossible de déterminer le répertoire de données")?;
      let progress_path = data_dir.join("progress.sqlite3");
      let session_dir = data_dir.join("sessions");
      let covers_dir = data_dir.join("covers");
      let progress_store = ProgressStore::new(&progress_path)?;
      let session_manager = SessionManager::new(progress_store, session_dir, covers_dir)?;
      app.manage(session_manager);
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      load_cbz,
      load_webtoon,
      resume_session,
      get_page,
      prepare_batch,
      get_thumbnail,
      update_progress,
      list_sessions,
      list_progress,
      fetch_webtoon_catalog,
      clear_progress_entry,
      open_progress_entry
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
