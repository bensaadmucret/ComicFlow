use std::{
    collections::{HashMap, VecDeque},
    fs::{self, File},
    io::{copy, Write},
    path::{Path, PathBuf},
    sync::Arc,
};

use anyhow::{anyhow, Context, Result};
use crate::progress_store::{ProgressInput, ProgressRecord, ProgressStore};
use crate::webtoon::{CatalogChapter, WebtoonFetcher};
use image::imageops::FilterType;
use image::GenericImageView;
use natord::compare;
use parking_lot::Mutex;
use sanitize_filename::sanitize;
use serde::Serialize;
use uuid::Uuid;
use zip::ZipArchive;

const MAX_SESSIONS: usize = 5;
const THUMB_HEIGHT: u32 = 320;

pub struct SessionManager {
    sessions: Mutex<HashMap<String, Session>>,
    order: Mutex<VecDeque<String>>,
    progress: Arc<ProgressStore>,
    session_root: PathBuf,
    covers_root: PathBuf,
}

fn infer_extension(url: &str) -> String {
    let trimmed = url.split('?').next().unwrap_or(url);
    let ext = trimmed
        .rsplit('.')
        .next()
        .map(|chunk| chunk.to_lowercase())
        .filter(|ext| matches!(ext.as_str(), "jpg" | "jpeg" | "png" | "gif" | "webp"));
    ext.unwrap_or_else(|| "jpg".to_string())
}

fn generate_thumbnail(original: &Path) -> Result<PathBuf> {
    let img = image::open(original)?;
    let (width, height) = img.dimensions();
    if width == 0 || height == 0 {
        return Err(anyhow!("Image vide"));
    }
    let scale = THUMB_HEIGHT as f32 / height as f32;
    let new_width = ((width as f32 * scale).round() as u32).max(1);
    let resized = img.resize(new_width, THUMB_HEIGHT, FilterType::Triangle);
    let thumb_path = original.with_file_name(format!(
        "{}_thumb.png",
        original.file_stem().unwrap_or_default().to_string_lossy()
    ));
    resized.save(&thumb_path)?;
    Ok(thumb_path)
}

impl SessionManager {
    pub fn new(
        progress_store: ProgressStore,
        session_root: PathBuf,
        covers_root: PathBuf,
    ) -> Result<Self> {
        fs::create_dir_all(&session_root).ok();
        fs::create_dir_all(&covers_root).ok();
        Ok(Self {
            sessions: Mutex::new(HashMap::new()),
            order: Mutex::new(VecDeque::new()),
            progress: Arc::new(progress_store),
            session_root,
            covers_root,
        })
    }

    fn store_session(&self, session: Session) {
        let mut sessions = self.sessions.lock();
        let mut order = self.order.lock();

        let session_id = session.id.clone();
        sessions.insert(session_id.clone(), session);
        order.push_back(session_id);

        while order.len() > MAX_SESSIONS {
            if let Some(old_id) = order.pop_front() {
                if let Some(old_session) = sessions.remove(&old_id) {
                    old_session.cleanup();
                }
            }
        }
    }

    pub fn load_cbz(&self, path: String) -> Result<LoadCbzResponse> {
        let identifier = format!("cbz:{}", path);
        let resume = self.progress.get(&identifier)?;
        let mut session = Session::from_cbz(
            Path::new(&path),
            &self.session_root,
            &self.covers_root,
            resume.as_ref().and_then(|entry| entry.cover_path.clone()),
        )?;
        if let Some(entry) = resume {
            session.last_index = entry.last_index.min(session.pages.len().saturating_sub(1));
        }
        let response = session.to_response();
        self.store_session(session);
        Ok(response)
    }

    pub fn load_webtoon_session(
        &self,
        title: String,
        chapter_url: String,
        images: Vec<DownloadedImage>,
    ) -> Result<LoadCbzResponse> {
        if images.is_empty() {
            return Err(anyhow!("Aucune page à enregistrer pour ce webtoon"));
        }
        let identifier = format!("webtoon:{}", chapter_url);
        let resume = self.progress.get(&identifier)?;
        let mut session = Session::from_webtoon(
            title,
            &chapter_url,
            images,
            &self.session_root,
            &self.covers_root,
            resume.as_ref().and_then(|entry| entry.cover_path.clone()),
        )?;
        if let Some(entry) = resume {
            session.last_index = entry.last_index.min(session.pages.len().saturating_sub(1));
        }
        let response = session.to_response();
        self.store_session(session);
        Ok(response)
    }

    pub fn get_session(&self, session_id: &str) -> Result<LoadCbzResponse> {
        let mut sessions = self.sessions.lock();
        let mut order = self.order.lock();
        let session = sessions
            .get(session_id)
            .ok_or_else(|| anyhow!("Session inconnue"))?
            .clone();
        touch_session(&mut order, session_id);
        Ok(session.to_response())
    }

    pub fn get_page(&self, session_id: &str, index: usize) -> Result<PagePayload> {
        let guard = self.sessions.lock();
        let session = guard
            .get(session_id)
            .ok_or_else(|| anyhow!("Session inconnue"))?;
        let entry = session
            .pages
            .get(index)
            .ok_or_else(|| anyhow!("Page hors limites"))?;
        Ok(PagePayload {
            index,
            path: entry.path.to_string_lossy().into_owned(),
        })
    }

    pub fn prepare_batch(&self, session_id: &str, start: usize, count: usize) -> Result<Vec<PagePayload>> {
        let guard = self.sessions.lock();
        let session = guard
            .get(session_id)
            .ok_or_else(|| anyhow!("Session inconnue"))?;

        let end = (start + count).min(session.pages.len());
        let mut payloads = Vec::with_capacity(end.saturating_sub(start));
        for (idx, entry) in session.pages.iter().enumerate().skip(start).take(count) {
            payloads.push(PagePayload {
                index: idx,
                path: entry.path.to_string_lossy().into_owned(),
            });
        }
        Ok(payloads)
    }

    pub fn get_thumbnail(&self, session_id: &str, index: usize) -> Result<PagePayload> {
        let guard = self.sessions.lock();
        let session = guard
            .get(session_id)
            .ok_or_else(|| anyhow!("Session inconnue"))?;
        let entry = session
            .pages
            .get(index)
            .ok_or_else(|| anyhow!("Page hors limites"))?;
        if let Some(thumb) = &entry.thumbnail_path {
            Ok(PagePayload {
                index,
                path: thumb.to_string_lossy().into_owned(),
            })
        } else {
            Err(anyhow!("Miniature indisponible pour cette page"))
        }
    }

    pub fn update_progress(&self, session_id: &str, index: usize) -> Result<()> {
        let mut sessions = self.sessions.lock();
        let mut order = self.order.lock();
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| anyhow!("Session inconnue"))?;
        session.last_index = index.min(session.pages.len().saturating_sub(1));
        touch_session(&mut order, session_id);

        let input = ProgressInput {
            id: session.identifier.clone(),
            label: session.file_name.clone(),
            source: session.source.clone(),
            location: session.reference.clone(),
            last_index: session.last_index,
            total_pages: session.pages.len(),
            cover_path: session.cover_public.clone(),
        };
        self.progress.save(input)?;
        Ok(())
    }

    pub fn list_sessions(&self) -> Vec<SessionSummary> {
        let sessions = self.sessions.lock();
        let order = self.order.lock();
        order
            .iter()
            .rev()
            .filter_map(|id| sessions.get(id).map(|session| session.to_summary()))
            .collect()
    }
    pub fn list_progress(&self) -> Result<Vec<ProgressRecord>> {
        self.progress.list()
    }

    pub fn get_progress_entry(&self, id: &str) -> Result<Option<ProgressRecord>> {
        self.progress.get(id)
    }

    pub fn clear_progress(&self, id: &str) -> Result<()> {
        self.progress.clear(id)
    }

    pub fn restore_cbz_entry(&self, entry: &ProgressRecord) -> Result<Option<LoadCbzResponse>> {
        if !Path::new(&entry.location).exists() {
            return Ok(None);
        }
        let session = Session::from_cbz(
            Path::new(&entry.location),
            &self.session_root,
            &self.covers_root,
            entry.cover_path.clone(),
        )?;
        let response = session.to_response();
        self.store_session(session);
        Ok(Some(response))
    }
}

#[derive(Clone)]
struct Session {
    id: String,
    temp_dir: PathBuf,
    pages: Vec<PageEntry>,
    file_name: String,
    cover_thumbnail: Option<PathBuf>,
    cover_public: Option<String>,
    last_index: usize,
    source: String,
    reference: String,
    identifier: String,
}

impl Session {
    fn from_cbz(
        path: &Path,
        session_root: &Path,
        covers_root: &Path,
        existing_cover: Option<String>,
    ) -> Result<Self> {
        let file = File::open(path).with_context(|| format!("Impossible d'ouvrir {:?}", path))?;
        let mut archive = ZipArchive::new(file).context("Archive CBZ invalide")?;

        let mut image_entries: Vec<(String, usize)> = Vec::new();
        for i in 0..archive.len() {
            let entry = archive.by_index(i)?;
            if entry.is_file() && is_supported_image(entry.name()) {
                image_entries.push((entry.name().to_string(), i));
            }
        }

        if image_entries.is_empty() {
            return Err(anyhow!("Aucune image trouvée dans cette archive"));
        }

        image_entries.sort_by(|a, b| compare(&a.0, &b.0));

        let session_id = Uuid::new_v4().to_string();
        let session_dir = session_root.join(&session_id);
        fs::create_dir_all(&session_dir)?;

        let mut pages = Vec::with_capacity(image_entries.len());
        let mut cover_thumbnail = None;
        let mut public_cover = existing_cover;
        for (idx, (name, entry_index)) in image_entries.into_iter().enumerate() {
            let mut file_entry = archive.by_index(entry_index)?;
            let safe_name = sanitize(name.split('/').last().unwrap_or("page"));
            let fallback = format!("page_{idx}");
            let file_name = if safe_name.is_empty() { fallback } else { safe_name };
            let target_name = format!("{idx:04}_{}", file_name);
            let target_path = session_dir.join(target_name);
            let mut output = File::create(&target_path)?;
            copy(&mut file_entry, &mut output)?;
            let thumbnail_path = generate_thumbnail(&target_path).ok();
            if idx == 0 {
                if let Some(ref thumb) = thumbnail_path {
                    let cover_name = format!("{}_cover.png", session_id);
                    let cover_path = covers_root.join(&cover_name);
                    fs::copy(thumb, &cover_path).ok();
                    public_cover = Some(cover_path.to_string_lossy().into_owned());
                }
                cover_thumbnail = thumbnail_path.clone();
            }
            pages.push(PageEntry {
                path: target_path,
                label: derive_label(&file_name, idx + 1),
                thumbnail_path,
            });
        }

        let file_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Session anonyme")
            .to_string();

        Ok(Self {
            id: session_id,
            temp_dir: session_dir,
            pages,
            file_name,
            cover_thumbnail,
            cover_public: public_cover,
            last_index: 0,
            source: "cbz".to_string(),
            reference: path.to_string_lossy().into_owned(),
            identifier: format!("cbz:{}", path.to_string_lossy()),
        })
    }

    fn from_webtoon(
        title: String,
        chapter_url: &str,
        images: Vec<DownloadedImage>,
        session_root: &Path,
        covers_root: &Path,
        existing_cover: Option<String>,
    ) -> Result<Self> {
        let session_id = Uuid::new_v4().to_string();
        let session_dir = session_root.join(&session_id);
        fs::create_dir_all(&session_dir)?;

        let mut pages = Vec::with_capacity(images.len());
        let mut cover_thumbnail = None;
        let mut public_cover = existing_cover;
        for (idx, image) in images.into_iter().enumerate() {
            let safe_label = sanitize(image.label.replace('/', "_").replace(' ', "_"));
            let ext = if image.extension.starts_with('.') {
                image.extension.clone()
            } else {
                format!(".{}", image.extension)
            };
            let file_name = if safe_label.is_empty() {
                format!("page_{idx}")
            } else {
                safe_label
            };
            let target_name = format!("{idx:04}_{}{}", file_name, ext);
            let target_path = session_dir.join(target_name);
            let mut output = File::create(&target_path)?;
            output.write_all(&image.bytes)?;
            let thumbnail_path = generate_thumbnail(&target_path).ok();
            if idx == 0 {
                if let Some(ref thumb) = thumbnail_path {
                    let cover_name = format!("{}_cover.png", session_id);
                    let cover_path = covers_root.join(&cover_name);
                    fs::copy(thumb, &cover_path).ok();
                    public_cover = Some(cover_path.to_string_lossy().into_owned());
                }
                cover_thumbnail = thumbnail_path.clone();
            }
            pages.push(PageEntry {
                path: target_path,
                label: format!("Page {}", idx + 1),
                thumbnail_path,
            });
        }

        Ok(Self {
            id: session_id,
            temp_dir: session_dir,
            pages,
            file_name: title,
            cover_thumbnail,
            cover_public: public_cover,
            last_index: 0,
            source: "webtoon".to_string(),
            reference: chapter_url.to_string(),
            identifier: format!("webtoon:{}", chapter_url),
        })
    }

    fn to_response(&self) -> LoadCbzResponse {
        LoadCbzResponse {
            session_id: self.id.clone(),
            file_name: self.file_name.clone(),
            total_pages: self.pages.len(),
            last_index: self.last_index,
            cover_path: self
                .cover_thumbnail
                .as_ref()
                .map(|path| path.to_string_lossy().into_owned()),
            pages: self
                .pages
                .iter()
                .enumerate()
                .map(|(index, entry)| PageDescriptor {
                    index,
                    label: entry.label.clone(),
                })
                .collect(),
            source: self.source.clone(),
            identifier: self.identifier.clone(),
            is_webtoon: matches!(self.source.as_str(), "webtoon"),
        }
    }

    fn to_summary(&self) -> SessionSummary {
        SessionSummary {
            session_id: self.id.clone(),
            file_name: self.file_name.clone(),
            total_pages: self.pages.len(),
            last_index: self.last_index,
            cover_path: self
                .cover_thumbnail
                .as_ref()
                .map(|path| path.to_string_lossy().into_owned()),
            source: self.source.clone(),
        }
    }

    fn cleanup(&self) {
        let _ = fs::remove_dir_all(&self.temp_dir);
    }
}

#[derive(Clone)]
struct PageEntry {
    path: PathBuf,
    label: String,
    thumbnail_path: Option<PathBuf>,
}

pub(crate) struct DownloadedImage {
    bytes: Vec<u8>,
    label: String,
    extension: String,
}

#[derive(Serialize)]
pub struct LoadCbzResponse {
    pub session_id: String,
    pub file_name: String,
    pub total_pages: usize,
    pub last_index: usize,
    pub cover_path: Option<String>,
    pub pages: Vec<PageDescriptor>,
    pub source: String,
    pub identifier: String,
    pub is_webtoon: bool,
}

#[derive(Serialize)]
pub struct PageDescriptor {
    pub index: usize,
    pub label: String,
}

#[derive(Serialize)]
pub struct PagePayload {
    pub index: usize,
    pub path: String,
}

#[derive(Serialize)]
pub struct SessionSummary {
    pub session_id: String,
    pub file_name: String,
    pub total_pages: usize,
    pub last_index: usize,
    pub cover_path: Option<String>,
    pub source: String,
}

fn is_supported_image(name: &str) -> bool {
    matches!(
        Path::new(name)
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.to_lowercase()),
        Some(ext) if matches!(ext.as_str(), "jpg" | "jpeg" | "png" | "gif" | "webp")
    )
}

fn derive_label(file_name: &str, fallback_index: usize) -> String {
    let stem = Path::new(file_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or_default();

    if stem.is_empty() {
        format!("Page {}", fallback_index)
    } else {
        stem.replace('_', " ")
    }
}

#[tauri::command]
pub async fn load_cbz(path: String, state: tauri::State<'_, SessionManager>) -> Result<LoadCbzResponse, String> {
    state.load_cbz(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn resume_session(
    session_id: String,
    state: tauri::State<'_, SessionManager>,
) -> Result<LoadCbzResponse, String> {
    state.get_session(&session_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_page(
    session_id: String,
    index: usize,
    state: tauri::State<'_, SessionManager>,
) -> Result<PagePayload, String> {
    state.get_page(&session_id, index).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn prepare_batch(
    session_id: String,
    start: usize,
    count: usize,
    state: tauri::State<'_, SessionManager>,
) -> Result<Vec<PagePayload>, String> {
    state
        .prepare_batch(&session_id, start, count)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_thumbnail(
    session_id: String,
    index: usize,
    state: tauri::State<'_, SessionManager>,
) -> Result<PagePayload, String> {
    state
        .get_thumbnail(&session_id, index)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_progress(
    session_id: String,
    index: usize,
    state: tauri::State<'_, SessionManager>,
) -> Result<(), String> {
    state.update_progress(&session_id, index).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_sessions(state: tauri::State<'_, SessionManager>) -> Result<Vec<SessionSummary>, String> {
    Ok(state.list_sessions())
}

#[tauri::command]
pub async fn list_progress(state: tauri::State<'_, SessionManager>) -> Result<Vec<ProgressRecord>, String> {
    state.list_progress().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_progress_entry(
    id: String,
    state: tauri::State<'_, SessionManager>,
) -> Result<(), String> {
    state.clear_progress(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_progress_entry(
    id: String,
    state: tauri::State<'_, SessionManager>,
) -> Result<Option<LoadCbzResponse>, String> {
    let entry = match state.get_progress_entry(&id).map_err(|e| e.to_string())? {
        Some(entry) => entry,
        None => return Ok(None),
    };
    match entry.source.as_str() {
        "cbz" => state.restore_cbz_entry(&entry).map_err(|e| e.to_string()),
        "webtoon" => {
            let fetcher = WebtoonFetcher::new().map_err(|e| e.to_string())?;
            let urls = fetcher
                .fetch_chapter_images(&entry.location)
                .await
                .map_err(|e| e.to_string())?;
            let mut images = Vec::with_capacity(urls.len());
            for (idx, url) in urls.iter().enumerate() {
                let bytes = fetcher.fetch_image_bytes(url).await.map_err(|e| e.to_string())?;
                images.push(DownloadedImage {
                    bytes,
                    label: format!("Page {}", idx + 1),
                    extension: infer_extension(url),
                });
            }
            state
                .load_webtoon_session(entry.label.clone(), entry.location.clone(), images)
                .map(Some)
                .map_err(|e| e.to_string())
        }
        _ => Ok(None),
    }
}

#[tauri::command]
pub async fn fetch_webtoon_catalog(catalogUrl: String) -> Result<Vec<CatalogChapter>, String> {
    println!("[ComicFlow] fetch_webtoon_catalog -> {catalogUrl}");
    let fetcher = WebtoonFetcher::new().map_err(|e| e.to_string())?;
    match fetcher.fetch_catalog(&catalogUrl).await {
        Ok(chapters) => {
            println!("[ComicFlow] catalog ok: {} chapitres", chapters.len());
            Ok(chapters)
        }
        Err(err) => {
            println!("[ComicFlow] catalog error: {err}");
            Err(err.to_string())
        }
    }
}

#[tauri::command]
pub async fn load_webtoon(
    chapterUrl: String,
    title: Option<String>,
    state: tauri::State<'_, SessionManager>,
) -> Result<LoadCbzResponse, String> {
    println!("[ComicFlow] load_webtoon -> {chapterUrl}");
    let fetcher = WebtoonFetcher::new().map_err(|e| e.to_string())?;
    let urls = fetcher
        .fetch_chapter_images(&chapterUrl)
        .await
        .map_err(|e| {
            println!("[ComicFlow] chapter error: {e}");
            e.to_string()
        })?;
    let mut images = Vec::with_capacity(urls.len());
    for (idx, url) in urls.iter().enumerate() {
        let bytes = fetcher.fetch_image_bytes(url).await.map_err(|e| e.to_string())?;
        images.push(DownloadedImage {
            bytes,
            label: format!("Page {}", idx + 1),
            extension: infer_extension(url),
        });
    }
    let resolved_title = title.unwrap_or_else(|| format!("Chapitre webtoon {}", chapterUrl));
    state
        .load_webtoon_session(resolved_title, chapterUrl, images)
        .map_err(|e| e.to_string())
}

fn touch_session(order: &mut VecDeque<String>, session_id: &str) {
    if let Some(pos) = order.iter().position(|id| id == session_id) {
        order.remove(pos);
    }
    order.push_back(session_id.to_string());
}
