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
const progressList = document.getElementById('progressList');
const webtoonUrlInput = document.getElementById('webtoonUrlInput');
const webtoonFetchBtn = document.getElementById('webtoonFetchBtn');
const webtoonChaptersList = document.getElementById('webtoonChaptersList');
const notesPanel = document.getElementById('notesPanel');
const exportBtn = document.getElementById('exportBtn');
const modeToggleContainer = document.getElementById('modeToggles');
const webtoonModeBtn = modeToggleContainer?.querySelector('button[data-webtoon-mode="stack"]');
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
const readerWebtoonStack = document.getElementById('readerWebtoonStack');
const globalLoader = document.getElementById('globalLoader');

const tauriGlobal = window.__TAURI__;
const tauriCore = tauriGlobal?.core;
const tauriDialog = tauriGlobal?.dialog;
const rawInvoke = tauriCore?.invoke ?? tauriGlobal?.invoke;

function showGlobalLoader(message = 'Chargement…') {
  if (!globalLoader) return;
  const label = globalLoader.querySelector('p');
  if (label) label.textContent = message;
  globalLoader.classList.remove('hidden');
  globalLoader.style.display = 'flex';
}

async function prefetchAdjacentWebtoon(offset = 1) {
  if (!isNative || !invoke) return;
  if (!webtoonChapters.length) return;
  const baseIndex = typeof currentWebtoonIndex === 'number' ? currentWebtoonIndex : -1;
  const neighbor = findWebtoonNeighbor(baseIndex, offset);
  if (!neighbor) return;
  const { chapter, index } = neighbor;
  if (!chapter || prefetchedWebtoonMap.has(chapter.url) || prefetchingWebtoonSet.has(chapter.url)) return;
  prefetchingWebtoonSet.add(chapter.url);
  try {
    console.log('[ComicFlow] Prefetch webtoon', chapter.url);
    const response = await invoke('load_webtoon', { chapterUrl: chapter.url, title: chapter.title });
    prefetchedWebtoonMap.set(chapter.url, { response, index });
  } catch (err) {
    console.warn('Prefetch webtoon échoué', err);
  } finally {
    prefetchingWebtoonSet.delete(chapter.url);
  }
}

function hideGlobalLoader() {
  if (!globalLoader) return;
  globalLoader.classList.add('hidden');
  globalLoader.style.display = 'none';
}

const toNativeSrc = (path) => {
  const resolver = tauriCore?.convertFileSrc ?? tauriGlobal?.convertFileSrc;
  if (typeof resolver === 'function') {
    try {
      return resolver(path);
    } catch (err) {
      console.warn('[ComicFlow] convertFileSrc failed, fallback to raw path', err);
    }
  }
  return path;
};
const isNative = typeof rawInvoke === 'function';
const invoke = rawInvoke;
const openDialog = tauriDialog?.open ?? tauriGlobal?.dialog?.open;

// State
let sessionId = null;
let pagesMeta = [];
let totalPages = 0;
let currentIndex = -1;
let currentFileLabel = '';
let readingMode = 'normal'; // 'normal' or 'manga'
let viewMode = 'single'; // 'single' or 'double'
let webtoonScrollMode = false;
const cache = new Map(); // index -> resolved URL
let overlayActive = false;
let browserZip = null;
let browserImages = [];
let coverPreviewUrl = null;
let libraryThumbnails = [];
let recentSessions = [];
let savedProgress = [];
let currentProgressId = null;
let currentSource = 'cbz';
let currentCoverPath = null;
let webtoonChapters = [];
let currentWebtoonIndex = null;
let isSwitchingChapter = false;
let renderedWebtoonSessionId = null;
const prefetchedWebtoonMap = new Map(); // url -> { response, index }
const prefetchingWebtoonSet = new Set();

function init() {
  setupEventListeners();
  updateNavigationState();
  refreshRecentSessions();
  refreshProgressList();
  updateWebtoonModeToggle();
}

async function fetchWebtoonIndex(catalogUrl) {
  if (!isNative || !invoke) {
    alert('Le mode webtoon nécessite l’app desktop.');
    return;
  }
  showGlobalLoader('Chargement de l’index webtoon…');
  webtoonFetchBtn.disabled = true;
  webtoonFetchBtn.textContent = 'Chargement…';
  webtoonChaptersList.innerHTML = '<p class="text-sm text-slate-400">Chargement du catalogue…</p>';
  statusLabel.textContent = 'Chargement de l’index webtoon…';
  try {
    webtoonChapters = await invoke('fetch_webtoon_catalog', { catalogUrl });
    currentWebtoonIndex = null;
    prefetchedWebtoonMap.clear();
    prefetchingWebtoonSet.clear();
    statusLabel.textContent = `Index webtoon chargé (${webtoonChapters.length} chapitres)`;
    console.log('Webtoon catalog', webtoonChapters);
    renderWebtoonChapters();
  } catch (err) {
    console.error('Catalogue webtoon', err);
    webtoonChaptersList.innerHTML = '<p class="text-sm text-ember">Impossible de charger ce catalogue.</p>';
    statusLabel.textContent = 'Erreur lors du chargement du webtoon.';
  } finally {
    hideGlobalLoader();
    webtoonFetchBtn.disabled = false;
    webtoonFetchBtn.textContent = 'Charger l’index';
  }
}

function renderWebtoonChapters() {
  if (!webtoonChapters.length) {
    webtoonChaptersList.innerHTML = '<p class="text-sm text-slate-500">Aucun chapitre détecté.</p>';
    return;
  }
  webtoonChaptersList.innerHTML = webtoonChapters
    .map((chapter, index) => {
      const numberLabel = chapter.number ? `Chapitre ${chapter.number}` : `Chapitre ${index + 1}`;
      return `
        <div class="p-3 rounded-2xl border border-white/10 flex items-center justify-between gap-3">
          <div>
            <p class="text-sm font-semibold line-clamp-1">${chapter.title}</p>
            <p class="text-xs text-slate-400">${numberLabel}</p>
          </div>
          <button class="px-3 py-1 text-xs rounded-full border border-white/20 hover:border-pulse"
            data-webtoon-url="${chapter.url}" data-webtoon-title="${chapter.title}">
            Lire
          </button>
        </div>
      `;
    })
    .join('');
}

async function loadWebtoonChapter(chapterUrl, title) {
  if (!isNative || !invoke) {
    alert('Le mode webtoon nécessite l’app desktop.');
    return;
  }
  const chapterIdx = webtoonChapters.findIndex((chapter) => chapter.url === chapterUrl);
  if (chapterIdx !== -1) currentWebtoonIndex = chapterIdx;
  const prefetched = prefetchedWebtoonMap.get(chapterUrl);
  if (prefetched) {
    prefetchedWebtoonMap.delete(chapterUrl);
    currentWebtoonIndex = typeof prefetched.index === 'number' ? prefetched.index : chapterIdx;
    await applyNativeSession(prefetched.response);
    prefetchAdjacentWebtoon(1);
    return;
  }
  try {
    showGlobalLoader('Chargement du chapitre…');
    statusLabel.textContent = 'Chargement du webtoon…';
    const response = await invoke('load_webtoon', { chapterUrl, title });
    await applyNativeSession(response);
    prefetchAdjacentWebtoon(1);
  } catch (err) {
    console.error('Webtoon', err);
    alert('Impossible de charger ce chapitre.');
  } finally {
    hideGlobalLoader();
  }
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

  if (webtoonModeBtn) {
    webtoonModeBtn.addEventListener('click', () => toggleWebtoonScrollMode());
  }

  if (exportBtn) {
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
  }

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

  progressList.addEventListener('click', (event) => {
    const actionBtn = event.target.closest('[data-progress-action]');
    if (!actionBtn) return;
    const progressId = actionBtn.dataset.progressId;
    if (!progressId) return;
    const action = actionBtn.dataset.progressAction;
    if (action === 'resume') {
      resumeFromProgress(progressId);
    } else if (action === 'clear') {
      clearProgressEntryById(progressId);
    }
  });

  if (webtoonFetchBtn) {
    console.log('[ComicFlow] Webtoon button ready');
    webtoonFetchBtn.addEventListener('click', () => {
      const url = webtoonUrlInput.value.trim();
      if (!url) {
        alert('Colle l’URL du catalogue webtoon.');
        return;
      }
      console.log('[ComicFlow] Webtoon fetch click', url);
      fetchWebtoonIndex(url);
    });
  }

  if (webtoonChaptersList) {
    webtoonChaptersList.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-webtoon-url]');
      if (!btn) return;
      const url = btn.dataset.webtoonUrl;
      const title = btn.dataset.webtoonTitle;
      loadWebtoonChapter(url, title);
    });
  }
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
    await applyNativeSession(response);
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
  webtoonScrollMode = false;
  renderedWebtoonSessionId = null;
  prefetchedWebtoonMap.clear();
  prefetchingWebtoonSet.clear();
  if (readerWebtoonStack) {
    readerWebtoonStack.innerHTML = '';
    readerWebtoonStack.dataset.sessionId = '';
  }
  updateWebtoonModeToggle();
}

async function renderPage() {
  if (!hasLoadedContent() || currentIndex < 0) return;

  const isLastPage = currentIndex === totalPages - 1;
  const allowDouble = viewMode === 'double' && currentSource !== 'webtoon' && !webtoonScrollMode;
  const showDouble = allowDouble && !isLastPage;

  const isWebtoon = currentSource === 'webtoon';

  if (isWebtoon && webtoonScrollMode) {
    await renderWebtoonStack();
  }

  const page1Url = await getPageUrl(currentIndex);
  comicImage1.src = page1Url;
  readerImage1.src = page1Url;

  if (isWebtoon && !webtoonScrollMode) {
    const webtoonWidth = '100%';
    comicImage1.style.width = '100%';
    comicImage1.style.objectFit = 'contain';
    comicImage1.style.height = 'auto';
    readerImage1.style.width = '100%';
    readerImage1.style.objectFit = 'contain';
    readerImage1.style.height = 'auto';
    readerImage1Wrapper.style.width = '100%';
    readerImage1Wrapper.style.maxWidth = webtoonWidth;
    readerImage1Wrapper.style.height = 'auto';
    readerPagesGrid.style.maxWidth = '100%';
    readerPagesGrid.style.width = '100%';
    readerPagesGrid.style.alignItems = 'stretch';
  } else {
    comicImage1.style.width = '';
    comicImage1.style.objectFit = '';
    comicImage1.style.height = '';
    readerImage1.style.width = '';
    readerImage1.style.objectFit = '';
    readerImage1.style.height = '';
    readerImage1Wrapper.style.width = '';
    readerImage1Wrapper.style.maxWidth = '';
    readerImage1Wrapper.style.height = '';
    readerPagesGrid.style.maxWidth = '';
    readerPagesGrid.style.width = '';
    readerPagesGrid.style.alignItems = '';
  }

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
    readerImage1Wrapper.style.maxWidth = isWebtoon && !webtoonScrollMode ? 'min(1040px, 95vw)' : 'min(900px, 90vw)';
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
  const payload = await invoke('get_page', { sessionId, session_id: sessionId, index });
  return toNativeSrc(payload.path);
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

  if (currentSource === 'webtoon') {
    if (webtoonScrollMode) {
      const stack = readerWebtoonStack;
      if (stack && stack.parentElement && !stack.classList.contains('hidden')) {
        const container = stack;
        const delta = direction * 600;
        container.scrollBy({ top: delta, behavior: 'smooth' });
        if (direction > 0 && container.scrollTop + container.clientHeight >= container.scrollHeight - 5) {
          loadAdjacentWebtoon(1);
        }
        if (direction < 0 && container.scrollTop <= 5) {
          loadAdjacentWebtoon(-1);
        }
        return;
      }
    }
    if (newIndex < 0) {
      loadAdjacentWebtoon(-1);
      return;
    }
    if (newIndex >= totalPages) {
      loadAdjacentWebtoon(1);
      return;
    }
  }

  if (newIndex < 0) newIndex = 0;
  if (newIndex >= totalPages) newIndex = totalPages - 1;

  if (newIndex !== currentIndex) {
    currentIndex = newIndex;
    renderPage();
  }
}

async function loadAdjacentWebtoon(offset) {
  if (!webtoonChapters.length || isSwitchingChapter) return;
  const baseIndex = typeof currentWebtoonIndex === 'number' ? currentWebtoonIndex : -1;
  const neighbor = findWebtoonNeighbor(baseIndex, offset);
  if (!neighbor) {
    alert('Pas d’autre chapitre dans cette direction.');
    return;
  }
  const { chapter: target, index: targetIndex } = neighbor;
  try {
    isSwitchingChapter = true;
    console.log('[ComicFlow] Auto-switch webtoon', { direction: offset > 0 ? 'next' : 'prev', target });
    const prefetched = prefetchedWebtoonMap.get(target.url);
    if (prefetched) {
      prefetchedWebtoonMap.delete(target.url);
      currentWebtoonIndex = typeof prefetched.index === 'number' ? prefetched.index : targetIndex;
      await applyNativeSession(prefetched.response);
      prefetchAdjacentWebtoon(1);
    } else {
      await loadWebtoonChapter(target.url, target.title);
    }
  } finally {
    isSwitchingChapter = false;
  }
}

function findWebtoonNeighbor(baseIndex, offset) {
  if (!webtoonChapters.length) return null;
  if (baseIndex === -1) {
    const fallbackIndex = offset > 0 ? 0 : webtoonChapters.length - 1;
    const chapter = webtoonChapters[fallbackIndex];
    return chapter ? { chapter, index: fallbackIndex } : null;
  }
  const enriched = webtoonChapters.map((chapter, idx) => ({
    chapter,
    idx,
    order: parseChapterNumber(chapter, idx),
  }));
  const currentEntry = enriched.find((entry) => entry.idx === baseIndex);
  if (!currentEntry) return null;
  const sorted = [...enriched].sort((a, b) => a.order - b.order);
  let neighbor;
  if (offset > 0) {
    neighbor = sorted.find((entry) => entry.order > currentEntry.order);
  } else {
    for (let i = sorted.length - 1; i >= 0; i -= 1) {
      if (sorted[i].order < currentEntry.order) {
        neighbor = sorted[i];
        break;
      }
    }
  }
  if (!neighbor) return null;
  return { chapter: neighbor.chapter, index: neighbor.idx };
}

function parseChapterNumber(chapter, fallbackIndex) {
  if (!chapter) return fallbackIndex;
  const fromField = chapter.number || chapter.title;
  if (fromField) {
    const match = fromField.match(/(\d+[\.,]?\d*)/);
    if (match) {
      return parseFloat(match[1].replace(',', '.'));
    }
  }
  return fallbackIndex;
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
  if (currentSource === 'webtoon' && (mode === 'double' || webtoonScrollMode)) {
    alert('Le mode double page est désactivé pour les webtoons.');
    return;
  }
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
  readerPageLabel.textContent = webtoonScrollMode ? 'Défilement Webtoon' : `Page ${pageDisplay}`;
  readerModeLabel.textContent = readingMode === 'normal' ? 'Mode Comic' : 'Mode Manga';
  readerProgress.style.width = `${progress}%`;
  if (readerWebtoonStack) {
    readerWebtoonStack.classList.toggle('hidden', !(currentSource === 'webtoon' && webtoonScrollMode));
  }
  readerPagesGrid.classList.toggle('hidden', currentSource === 'webtoon' && webtoonScrollMode);
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

function toggleWebtoonScrollMode() {
  if (currentSource !== 'webtoon') {
    alert('Charge un chapitre webtoon pour activer ce mode.');
    return;
  }
  webtoonScrollMode = !webtoonScrollMode;
  if (webtoonScrollMode) {
    viewMode = 'single';
    renderWebtoonStack(true);
  } else if (readerWebtoonStack) {
    readerWebtoonStack.scrollTop = 0;
  }
  updateWebtoonModeToggle();
  renderPage();
}

async function renderWebtoonStack(force = false) {
  if (!readerWebtoonStack || !sessionId) return;
  if (!force && renderedWebtoonSessionId === sessionId && readerWebtoonStack.childElementCount) {
    return;
  }
  renderedWebtoonSessionId = sessionId;
  readerWebtoonStack.dataset.sessionId = sessionId;
  readerWebtoonStack.innerHTML = '';
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < totalPages; i += 1) {
    let url = null;
    try {
      url = await getPageUrl(i);
    } catch (err) {
      console.warn('Webtoon stack image', i, err);
    }
    const figure = document.createElement('figure');
    figure.className = 'flex-none rounded-3xl overflow-hidden border border-white/10 bg-black/60';
    const img = document.createElement('img');
    img.src = url || 'assets/sample-page.jpg';
    img.alt = `Page ${i + 1}`;
    img.loading = 'lazy';
    img.className = 'w-full h-auto block object-contain';
    figure.appendChild(img);
    fragment.appendChild(figure);
  }
  readerWebtoonStack.appendChild(fragment);
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

function updateWebtoonModeToggle() {
  if (!webtoonModeBtn) return;
  const enabled = currentSource === 'webtoon';
  webtoonModeBtn.classList.toggle('opacity-50', !enabled);
  webtoonModeBtn.classList.toggle('cursor-not-allowed', !enabled);
  const active = enabled && webtoonScrollMode;
  webtoonModeBtn.classList.toggle('bg-white', active);
  webtoonModeBtn.classList.toggle('text-midnight', active);
  webtoonModeBtn.classList.toggle('text-slate-300', !active);
  webtoonModeBtn.classList.toggle('border-white/20', !active);
  webtoonModeBtn.classList.toggle('border-pulse', active);
}

async function fetchThumbnailSafe(index) {
  if (!sessionId || !invoke) return null;
  try {
    const payload = await invoke('get_thumbnail', { sessionId, session_id: sessionId, index });
    return toNativeSrc(payload.path);
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
  invoke('prepare_batch', { sessionId, session_id: sessionId, start, count })
    .then((items) => {
      items.forEach((item) => {
        if (!cache.has(item.index)) {
          cache.set(item.index, toNativeSrc(item.path));
        }
      });
    })
    .catch((err) => console.error('Préchargement natif', err));
}

async function resumeExistingSession(sessionIdToLoad) {
  if (!isNative || !invoke) return;
  try {
    const response = await invoke('resume_session', { sessionId: sessionIdToLoad, session_id: sessionIdToLoad });
    await applyNativeSession(response);
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
      coverUrl: item.cover_path ? toNativeSrc(item.cover_path) : 'assets/sample-page.jpg',
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
  invoke('update_progress', { sessionId, session_id: sessionId, index })
    .then(() => {
      if (!currentProgressId) return;
      const entry = savedProgress.find((item) => item.id === currentProgressId);
      if (entry) {
        entry.last_index = index;
        entry.total_pages = totalPages;
        entry.updated_at = Math.floor(Date.now() / 1000);
        renderProgressList();
      }
    })
    .catch((err) => console.warn('Sync progress', err));
}

async function applyNativeSession(response) {
  sessionId = response.session_id;
  pagesMeta = response.pages;
  totalPages = response.total_pages;
  currentFileLabel = response.file_name;
  currentProgressId = response.identifier;
  currentSource = response.source || 'cbz';
  currentCoverPath = response.cover_path || null;
  browserZip = null;
  browserImages = [];
  clearCache();

  if (response.is_webtoon && viewMode !== 'single') {
    setViewMode('single');
  }

  coverPreviewUrl = response.cover_path ? toNativeSrc(response.cover_path) : await fetchThumbnailSafe(0);
  libraryThumbnails = await buildLibraryThumbnails();
  statusLabel.textContent = `Session locale · ${response.file_name}`;
  statusLabel.dataset.fileName = response.file_name;
  chapterLabel.textContent = response.file_name.replace(/\.cbz$/i, '') || 'Chapitre';
  updateLibraryList(response.file_name, coverPreviewUrl);
  webtoonScrollMode = webtoonScrollMode && currentSource === 'webtoon';
  renderedWebtoonSessionId = null;
  if (readerWebtoonStack) {
    readerWebtoonStack.innerHTML = '';
    readerWebtoonStack.dataset.sessionId = '';
  }
  updateWebtoonModeToggle();

  const savedIndex = typeof response.last_index === 'number' ? response.last_index : 0;
  currentIndex = totalPages ? Math.min(Math.max(savedIndex, 0), totalPages - 1) : 0;
  renderPage();
  refreshRecentSessions();
  refreshProgressList();
}

async function refreshProgressList() {
  if (!isNative || !invoke) {
    savedProgress = [];
    progressList.innerHTML = '<p class="text-sm text-slate-500">Disponible en mode desktop</p>';
    return;
  }
  try {
    savedProgress = await invoke('list_progress');
    renderProgressList();
  } catch (err) {
    console.error('Erreur progression', err);
  }
}

function renderProgressList() {
  if (!savedProgress.length) {
    progressList.innerHTML = '<p class="text-sm text-slate-500">Aucune progression enregistrée</p>';
    return;
  }

  progressList.innerHTML = savedProgress
    .map((entry) => {
      const coverUrl = entry.cover_path ? toNativeSrc(entry.cover_path) : 'assets/sample-page.jpg';
      const progressPercent = entry.total_pages
        ? Math.round(((entry.last_index + 1) / entry.total_pages) * 100)
        : 0;
      const progressLabel = entry.total_pages
        ? `${Math.min(entry.last_index + 1, entry.total_pages)} / ${entry.total_pages}`
        : '—';
      const sourceLabel = entry.source === 'webtoon' ? 'Webtoon' : 'CBZ local';
      return `
        <div class="p-3 rounded-2xl border border-white/10 flex gap-3 items-center" data-progress-id="${entry.id}">
          <div class="w-12 h-16 rounded-lg overflow-hidden border border-white/10 bg-black/30">
            <img src="${coverUrl}" alt="${entry.label}" class="w-full h-full object-cover" />
          </div>
          <div class="flex-1">
            <p class="text-sm font-semibold line-clamp-1">${entry.label}</p>
            <p class="text-xs text-slate-400">${sourceLabel} · ${progressLabel}</p>
            <div class="mt-1 h-1 rounded-full bg-white/10">
              <div class="h-full rounded-full bg-gradient-to-r from-pulse to-white" style="width:${progressPercent}%"></div>
            </div>
          </div>
          <div class="flex flex-col gap-1 text-xs">
            <button class="px-3 py-1 rounded-full border border-white/30 hover:border-pulse/80" data-progress-action="resume" data-progress-id="${entry.id}">Lire</button>
            <button class="px-3 py-1 rounded-full border border-white/10 text-white/60 hover:text-ember" data-progress-action="clear" data-progress-id="${entry.id}">Effacer</button>
          </div>
        </div>
      `;
    })
    .join('');
}

async function resumeFromProgress(progressId) {
  if (!isNative || !invoke) return;
  try {
    const response = await invoke('open_progress_entry', { id: progressId });
    if (!response) {
      await invoke('clear_progress_entry', { id: progressId });
      await refreshProgressList();
      alert('Progression introuvable. Elle a été nettoyée.');
      return;
    }
    await applyNativeSession(response);
  } catch (err) {
    console.error('Impossible de reprendre cette progression', err);
    alert('Impossible de charger cette progression.');
  }
}

async function clearProgressEntryById(progressId) {
  if (!isNative || !invoke) return;
  try {
    await invoke('clear_progress_entry', { id: progressId });
    savedProgress = savedProgress.filter((entry) => entry.id !== progressId);
    renderProgressList();
  } catch (err) {
    console.error('Impossible de supprimer la progression', err);
  }
}

init();
