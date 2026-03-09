mod reader;

use reader::{get_page, load_cbz, SessionManager};

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
      Ok(())
    })
    .manage(SessionManager::default())
    .invoke_handler(tauri::generate_handler![load_cbz, get_page])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
