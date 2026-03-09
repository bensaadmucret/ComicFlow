const fileInput = document.getElementById('fileInput');
const importBtn = document.getElementById('importBtn');
const immersiveBtn = document.getElementById('immersiveBtn');
const viewer = document.getElementById('viewer');
const comicImage1 = document.getElementById('comicImage1');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const chapterLabel = document.getElementById('chapterLabel');
const statusLabel = document.getElementById('statusLabel');
const pageLabel = document.getElementById('pageLabel');
const modeLabel = document.getElementById('modeLabel');
const preloadLabel = document.getElementById('preloadLabel');
const progressBar = document.getElementById('progressBar');
const libraryList = document.getElementById('libraryList');
const recentList = document.getElementById('recentList');
const notesPanel = document.getElementById('notesPanel');
const exportBtn = document.getElementById('exportBtn');
const modeToggleContainer = document.getElementById('modeToggles');
const readerOverlay = document.getElementById('readerOverlay');
const readerPagesGrid = document.getElementById('readerPagesGrid');
const readerCloseBtn = document.getElementById('readerCloseBtn');
const readerPrevBtn = document.getElementById('readerPrevBtn');
const readerNextBtn = document.getElementById('readerNextBtn');
const readerToggleModeBtn = document.getElementById('readerToggleMode');
const readerChapter = document.getElementById('readerChapter');
const readerPageLabel = document.getElementById('readerPageLabel');
const readerModeLabel = document.getElementById('readerModeLabel');
const readerPreloadLabel = document.getElementById('readerPreloadLabel');
const readerProgress = document.getElementById('readerProgress');
const readerImage1 = document.getElementById('readerImage1');
const readerImage2 = document.getElementById('readerImage2');
const readerImage1Wrapper = document.getElementById('readerImage1Wrapper');
const readerImage2Wrapper = document.getElementById('readerImage2Wrapper');

const tauriGlobal = window.__TAURI__;
const tauriCore = tauriGlobal?.core;
const tauriDialog = tauriGlobal?.dialog;
const rawInvoke = tauriCore?.invoke ?? tauriGlobal?.invoke;
const rawConvert = tauriCore?.convertFileSrc ?? tauriGlobal?.convertFileSrc;
const isNative = typeof rawInvoke === 'function';
const invoke = rawInvoke;
const convertFileSrc = rawConvert ?? ((path) => path);
const openDialog = tauriDialog?.open ?? tauriGlobal?.dialog?.open;

// State
let sessionId = null;
let pagesMeta = [];
let totalPages = 0;
let currentIndex = -1;
let currentFileLabel = '';
let readingMode = 'normal'; // 'normal' or 'manga'
let viewMode = 'single'; // 'single' or 'double'
const cache = new Map(); // index -> resolved URL
let overlayActive = false;
let browserZip = null;
let browserImages = [];
let coverPreviewUrl = null;
let libraryThumbnails = [];
let recentSessions = [];

function init() {
  setupEventListeners();
  updateNavigationState();
  refreshRecentSessions();
}

function setupEventListeners() {
  importBtn.addEventListener('click', handleImportClick);
  fileInput.addEventListener('change', handleFileSelect);
  immersiveBtn.addEventListener('click', () => {
    if (!hasLoadedContent()) {
      alert('Charge un CBZ avant d’entrer en lecture.');
      return;
    }
    openReaderOverlay();
  });
  prevBtn.addEventListener('click', () => navigate(-1));
  nextBtn.addEventListener('click', () => navigate(1));

  document.addEventListener('keydown', (e) => {
    if (overlayActive && e.key === 'Escape') closeReaderOverlay();
    if (e.metaKey && e.key === 'ArrowLeft') return navigate(-1);
    if (e.metaKey && e.key === 'ArrowRight') return navigate(1);
    if (e.key === 'ArrowLeft' && !e.metaKey) navigate(readingMode === 'normal' ? -1 : 1);
    if (e.key === 'ArrowRight' && !e.metaKey) navigate(readingMode === 'normal' ? 1 : -1);
    if (e.key.toLowerCase() === 'm') toggleReadingMode();
  });

  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    viewer.classList.add('outline', 'outline-pulse/40');
  });

  document.addEventListener('dragleave', () => viewer.classList.remove('outline', 'outline-pulse/40'));
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    viewer.classList.remove('outline', 'outline-pulse/40');
    const dropped = e.dataTransfer?.files?.[0];
    const nativePath = dropped?.path;
    if (nativePath && isNative) {
      processNativeFile(nativePath);
    } else if (dropped) {
      processBrowserFile(dropped);
    } else {
      alert('Impossible de lire ce fichier.');
    }
  });

  modeToggleContainer.querySelectorAll('button[data-reading]').forEach((btn) => {
    btn.addEventListener('click', () => setReadingMode(btn.dataset.reading));
  });

  modeToggleContainer.querySelectorAll('button[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => setViewMode(btn.dataset.view));
  });

  exportBtn.addEventListener('click', () => {
    if (!hasLoadedContent()) return alert('Aucun réglage à exporter.');
    const settings = {
      file: statusLabel.dataset.fileName || null,
      readingMode,
      viewMode,
      index: currentIndex,
    };
    navigator.clipboard.writeText(JSON.stringify(settings, null, 2));
    exportBtn.textContent = 'Réglages copiés !';
    setTimeout(() => (exportBtn.textContent = 'Exporter les réglages'), 2000);
  });

  readerCloseBtn.addEventListener('click', closeReaderOverlay);
  readerPrevBtn.addEventListener('click', () => navigate(-1));
  readerNextBtn.addEventListener('click', () => navigate(1));
  readerToggleModeBtn.addEventListener('click', toggleReadingMode);
  recentList.addEventListener('click', (event) => {
    const target = event.target.closest('[data-session-id]');
    if (!target) return;
    const sessionId = target.dataset.sessionId;
    resumeExistingSession(sessionId);
  });
}

function handleFileSelect(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  if (isNative && file.path) {
    processNativeFile(file.path);
  } else {
    processBrowserFile(file);
  }
}

async function handleImportClick() {
  if (!isNative || !openDialog) {
    return fileInput.click();
  }

  try {
    const selection = await openDialog({
      multiple: false,
      filters: [{ name: 'Comics CBZ', extensions: ['cbz'] }],
    });
    const path = Array.isArray(selection) ? selection[0] : selection;
    if (path) {
      await processNativeFile(path);
    }
  } catch (error) {
    console.error('Import annulé', error);
  }
}

async function processNativeFile(path) {
  if (!isNative || !invoke) {
    alert('Cette action nécessite l’application Tauri.');
    return;
  }

  try {
    statusLabel.textContent = 'Chargement…';
    const response = await invoke('load_cbz', { path });
    sessionId = response.session_id;
    pagesMeta = response.pages;
    totalPages = response.total_pages;
    currentFileLabel = response.file_name;
    browserZip = null;
    browserImages = [];
    clearCache();

    const cover = await fetchThumbnailSafe(0);
    coverPreviewUrl = cover;
    libraryThumbnails = await buildLibraryThumbnails();
    statusLabel.textContent = `Session locale · ${response.file_name}`;
    statusLabel.dataset.fileName = response.file_name;
    chapterLabel.textContent = response.file_name.replace(/\.cbz$/i, '') || 'Chapitre';
    updateLibraryList(response.file_name, coverPreviewUrl);
    refreshRecentSessions();

    const savedIndex = localStorage.getItem(`progress_${response.file_name}`);
    currentIndex = savedIndex ? Math.min(parseInt(savedIndex, 10) || 0, totalPages - 1) : 0;
    if (currentIndex < 0) currentIndex = 0;
    notesPanel.textContent = 'Dernière page lue : 1';
    renderPage();
  } catch (err) {
    console.error(err);
    alert('Erreur lors de l\'ouverture du fichier.');
    resetState();
  }
}

async function processBrowserFile(file) {
  try {
    statusLabel.textContent = 'Chargement…';
    const zip = await JSZip.loadAsync(file);
    const imageEntries = Object.keys(zip.files)
      .filter((path) => path.match(/\.(jpe?g|png|gif|webp)$/i))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

    if (!imageEntries.length) {
      alert('Aucune image trouvée dans ce fichier CBZ.');
      return resetState();
    }

    browserZip = zip;
    browserImages = imageEntries;
    sessionId = null;
    pagesMeta = [];
    totalPages = imageEntries.length;
    currentFileLabel = file.name;
    clearCache();

    const savedIndex = localStorage.getItem(`progress_${file.name}`);
    currentIndex = savedIndex ? Math.min(parseInt(savedIndex, 10) || 0, totalPages - 1) : 0;
    if (currentIndex < 0) currentIndex = 0;

    coverPreviewUrl = await getPageUrl(currentIndex).catch(() => null);
    libraryThumbnails = await buildLibraryThumbnails();
    statusLabel.textContent = `Session locale · ${file.name}`;
    statusLabel.dataset.fileName = file.name;
    chapterLabel.textContent = file.name.replace(/\.cbz$/i, '') || 'Chapitre';
    updateLibraryList(file.name, coverPreviewUrl);
    refreshRecentSessions();

    notesPanel.textContent = 'Dernière page lue : 1';
    renderPage();
  } catch (err) {
    console.error(err);
    alert('Erreur lors de l\'ouverture du fichier.');
    resetState();
  }
}

function resetState() {
  sessionId = null;
  pagesMeta = [];
  totalPages = 0;
  currentIndex = -1;
  currentFileLabel = '';
  browserZip = null;
  browserImages = [];
  coverPreviewUrl = null;
  libraryThumbnails = [];
  clearCache();
  comicImage1.src = 'assets/sample-page.jpg';
  updateNavigationState();
  chapterLabel.textContent = 'Aucun contenu';
  statusLabel.textContent = 'Session locale · Aucun album';
  pageLabel.textContent = 'Page 0 · 0';
  progressBar.style.width = '0%';
  notesPanel.textContent = 'Ajouter un signet pour la page 0';
  readerImage2Wrapper.classList.add('hidden');
  readerImage1Wrapper.style.order = 1;
}

async function renderPage() {
  if (!hasLoadedContent() || currentIndex < 0) return;

  const isLastPage = currentIndex === totalPages - 1;
  const showDouble = viewMode === 'double' && !isLastPage;

  const page1Url = await getPageUrl(currentIndex);
  comicImage1.src = page1Url;
  readerImage1.src = page1Url;

  if (showDouble) {
    const page2Url = await getPageUrl(currentIndex + 1);
    readerImage2.src = page2Url;
    readerImage2Wrapper.classList.remove('hidden');
    readerPagesGrid.classList.add('md:grid-cols-2');
    readerPagesGrid.classList.remove('place-items-center');
    readerImage1Wrapper.style.maxWidth = '';
    if (readingMode === 'manga') {
      readerImage1Wrapper.style.order = 2;
      readerImage2Wrapper.style.order = 1;
    } else {
      readerImage1Wrapper.style.order = 1;
      readerImage2Wrapper.style.order = 2;
    }
  } else {
    readerImage2Wrapper.classList.add('hidden');
    readerImage1Wrapper.style.order = 1;
    readerPagesGrid.classList.remove('md:grid-cols-2');
    readerPagesGrid.classList.add('place-items-center');
    readerImage1Wrapper.style.maxWidth = 'min(900px, 90vw)';
  }

  const pageDisplay = showDouble ? `${currentIndex + 1}-${currentIndex + 2}` : `${currentIndex + 1}`;
  pageLabel.textContent = `Page ${pageDisplay} · ${totalPages}`;
  notesPanel.textContent = `Dernière page lue : ${pageDisplay}`;

  const progress = ((currentIndex + (showDouble ? 2 : 1)) / totalPages) * 100;
  progressBar.style.width = `${progress}%`;
  preloadNext(showDouble ? 2 : 1);
  updateNavigationState();
  updateReaderUI({ showDouble, pageDisplay, progress });

  localStorage.setItem(`progress_${statusLabel.dataset.fileName}`, currentIndex);
  if (sessionId) syncProgress(currentIndex);
}

async function getPageUrl(index) {
  if (cache.has(index)) return cache.get(index);
  let url;
  if (sessionId) {
    url = await fetchNativePage(index);
  } else if (browserZip) {
    url = await fetchBrowserPage(index);
  } else {
    throw new Error('Aucune source disponible pour les pages');
  }
  cache.set(index, url);
  return url;
}

async function fetchNativePage(index) {
  if (!invoke) throw new Error('invoke indisponible');
  const payload = await invoke('get_page', { session_id: sessionId, index });
  return convertFileSrc(payload.path);
}

async function fetchBrowserPage(index) {
  if (!browserZip) throw new Error('Archive non chargée');
  const path = browserImages[index];
  const fileData = await browserZip.files[path].async('blob');
  const url = URL.createObjectURL(fileData);
  return url;
}

function preloadNext(offset = 1) {
  if (!hasLoadedContent()) return;
  const nextIdx = currentIndex + offset;
  if (nextIdx < totalPages) {
    if (sessionId && invoke) {
      const batchCount = viewMode === 'double' ? 2 : 1;
      preloadBatchNative(nextIdx, batchCount);
    } else {
      getPageUrl(nextIdx).catch((err) => console.error('Préchargement', err));
      if (viewMode === 'double' && nextIdx + 1 < totalPages) {
        getPageUrl(nextIdx + 1).catch((err) => console.error('Préchargement', err));
      }
    }
  }
}

function navigate(direction) {
  if (!hasLoadedContent()) return;
  const step = viewMode === 'double' ? 2 : 1;
  let newIndex = currentIndex + direction * step;

  if (newIndex < 0) newIndex = 0;
  if (newIndex >= totalPages) newIndex = totalPages - 1;

  if (newIndex !== currentIndex) {
    currentIndex = newIndex;
    renderPage();
  }
}

function updateNavigationState() {
  const disable = !hasLoadedContent();
  prevBtn.disabled = disable || currentIndex <= 0;
  nextBtn.disabled = disable || currentIndex >= totalPages - 1;
  const modeText = readingMode === 'normal' ? 'Classique' : 'Manga';
  modeLabel.textContent = modeText;
}

function setReadingMode(mode) {
  readingMode = mode;
  modeToggleContainer.querySelectorAll('button[data-reading]').forEach((btn) => {
    const isActive = btn.dataset.reading === mode;
    btn.classList.toggle('bg-white', isActive);
    btn.classList.toggle('text-midnight', isActive);
    btn.classList.toggle('border', !isActive);
    btn.classList.toggle('border-white/20', !isActive);
    btn.classList.toggle('text-slate-300', !isActive);
  });
  if (viewMode === 'double') renderPage();
  updateNavigationState();
}

function setViewMode(mode) {
  viewMode = mode;
  modeToggleContainer.querySelectorAll('button[data-view]').forEach((btn) => {
    const isActive = btn.dataset.view === mode;
    btn.classList.toggle('bg-white', isActive);
    btn.classList.toggle('text-midnight', isActive);
    btn.classList.toggle('border', !isActive);
    btn.classList.toggle('border-white/20', !isActive);
    btn.classList.toggle('text-slate-300', !isActive);
  });
  if (hasLoadedContent()) renderPage();
  updateNavigationState();
}

function toggleReadingMode() {
  setReadingMode(readingMode === 'normal' ? 'manga' : 'normal');
}

function updateLibraryList(fileName) {
  const cover = coverPreviewUrl || 'assets/sample-page.jpg';
  const thumbnailsHtml = libraryThumbnails
    .map(
      (thumb) => `
        <div class="aspect-[2/3] rounded-xl overflow-hidden border border-white/10">
          <img src="${thumb}" alt="Prévisualisation" class="w-full h-full object-cover" />
        </div>
      `,
    )
    .join('');
  libraryList.innerHTML = `
    <div class="p-4 rounded-2xl bg-white/10 border border-white/5 space-y-3">
      <div class="aspect-[3/4] rounded-2xl overflow-hidden border border-white/10 bg-black/30">
        <img src="${cover}" alt="Couverture" class="w-full h-full object-cover" />
      </div>
      <div>
        <p class="text-sm text-slate-400">Lecture actuelle</p>
        <p class="text-lg font-semibold">${fileName}</p>
        <p class="text-xs text-slate-500">${totalPages} pages</p>
      </div>
      <div class="grid grid-cols-3 gap-2 text-[0]">
        ${thumbnailsHtml}
      </div>
    </div>
  `;
}

function updateReaderUI({ showDouble, pageDisplay, progress }) {
  if (!overlayActive) return;
  readerChapter.textContent = currentFileLabel || chapterLabel.textContent;
  readerPageLabel.textContent = `Page ${pageDisplay}`;
  readerModeLabel.textContent = readingMode === 'normal' ? 'Mode Comic' : 'Mode Manga';
  readerProgress.style.width = `${progress}%`;
}

function openReaderOverlay() {
  readerOverlay.classList.remove('hidden');
  overlayActive = true;
  updateReaderUI({
    showDouble: viewMode === 'double' && currentIndex < totalPages - 1,
    pageDisplay: pageLabel.textContent.replace('Page ', ''),
    progress: parseFloat(progressBar.style.width) || 0,
  });
}

function closeReaderOverlay() {
  readerOverlay.classList.add('hidden');
  overlayActive = false;
}

function hasLoadedContent() {
  return (sessionId && totalPages > 0) || (browserZip && totalPages > 0);
}

function clearCache() {
  cache.forEach((url) => {
    if (url.startsWith('blob:')) URL.revokeObjectURL(url);
  });
  cache.clear();
}

async function fetchThumbnailSafe(index) {
  if (!sessionId || !invoke) return null;
  try {
    const payload = await invoke('get_thumbnail', { session_id: sessionId, index });
    return convertFileSrc(payload.path);
  } catch (err) {
    console.warn('Miniature indisponible', err);
    return null;
  }
}

async function buildLibraryThumbnails() {
  const previewUrls = [];
  const maxThumbs = Math.min(3, totalPages);
  for (let i = 0; i < maxThumbs; i += 1) {
    if (sessionId) {
      const thumb = await fetchThumbnailSafe(i);
      previewUrls.push(thumb || coverPreviewUrl || 'assets/sample-page.jpg');
    } else if (browserZip) {
      const url = await getPageUrl(i).catch(() => null);
      previewUrls.push(url || 'assets/sample-page.jpg');
    }
  }
  return previewUrls;
}

function preloadBatchNative(start, count) {
  if (!invoke || !sessionId) return;
  invoke('prepare_batch', { session_id: sessionId, start, count })
    .then((items) => {
      items.forEach((item) => {
        if (!cache.has(item.index)) {
          cache.set(item.index, convertFileSrc(item.path));
        }
      });
    })
    .catch((err) => console.error('Préchargement natif', err));
}

async function resumeExistingSession(sessionId) {
  if (!isNative || !invoke) return;
  try {
    const response = await invoke('resume_session', { session_id: sessionId });
    sessionId = response.session_id;
    pagesMeta = response.pages;
    totalPages = response.total_pages;
    currentFileLabel = response.file_name;
    browserZip = null;
    browserImages = [];
    clearCache();

    coverPreviewUrl = response.cover_path ? convertFileSrc(response.cover_path) : null;
    libraryThumbnails = await buildLibraryThumbnails();
    statusLabel.textContent = `Session locale · ${response.file_name}`;
    statusLabel.dataset.fileName = response.file_name;
    chapterLabel.textContent = response.file_name.replace(/\.cbz$/i, '') || 'Chapitre';
    updateLibraryList(response.file_name, coverPreviewUrl);

    currentIndex = response.last_index || 0;
    notesPanel.textContent = `Dernière page lue : ${currentIndex + 1}`;
    renderPage();
  } catch (err) {
    console.error('Impossible de reprendre cette session', err);
    alert('Impossible de reprendre cet album.');
  }
}

async function refreshRecentSessions() {
  if (!isNative || !invoke) {
    recentSessions = [];
    recentList.innerHTML = '<p class="text-sm text-slate-500">Historique disponible en mode desktop</p>';
    return;
  }
  try {
    const summaries = await invoke('list_sessions');
    recentSessions = summaries.map((item) => ({
      ...item,
      coverUrl: item.cover_path ? convertFileSrc(item.cover_path) : 'assets/sample-page.jpg',
    }));
    renderRecentList();
  } catch (err) {
    console.error('Erreur lors du chargement de l\'historique', err);
  }
}

function renderRecentList() {
  if (!recentSessions.length) {
    recentList.innerHTML = '<p class="text-sm text-slate-500">Aucun historique</p>';
    return;
  }
  recentList.innerHTML = recentSessions
    .map((session) => {
      const progressPercent = session.total_pages
        ? Math.round(((session.last_index + 1) / session.total_pages) * 100)
        : 0;
      const progressLabel = `${Math.min(session.last_index + 1, session.total_pages)} / ${session.total_pages}`;
      return `
        <div class="p-3 rounded-2xl border border-white/10 flex items-center gap-3 hover:border-pulse/60 transition" data-session-id="${session.session_id}">
          <div class="w-14 h-20 rounded-xl overflow-hidden border border-white/10 bg-black/30">
            <img src="${session.coverUrl}" alt="${session.file_name}" class="w-full h-full object-cover" />
          </div>
          <div class="flex-1">
            <p class="text-sm font-semibold line-clamp-1">${session.file_name}</p>
            <p class="text-xs text-slate-400">${progressLabel}</p>
            <div class="mt-1 h-1 rounded-full bg-white/10">
              <div class="h-full rounded-full bg-gradient-to-r from-pulse to-white" style="width:${progressPercent}%"></div>
            </div>
          </div>
          <button class="px-3 py-1 text-xs rounded-full border border-white/20 hover:border-pulse/70" data-session-id="${session.session_id}">
            Reprendre
          </button>
        </div>
      `;
    })
    .join('');
}

function syncProgress(index) {
  if (!sessionId || !invoke) return;
  invoke('update_progress', { session_id: sessionId, index }).catch((err) => console.warn('Sync progress', err));
}

init();
