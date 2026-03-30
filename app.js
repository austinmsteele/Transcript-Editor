import { makeId } from './id.js';
import { buildTranscriptPdfBytes as createTranscriptPdfBytes } from './transcript-pdf.js';

const HISTORY_LIMIT = 120;
const TEXT_HISTORY_IDLE_MS = 500;
const REMOTE_SYNC_INTERVAL_MS = 4000;
const SESSION_DB_NAME = 'interview-timestamps-editor';
const SESSION_STORE_NAME = 'sessions';
const SESSION_RECORD_KEY = 'current';
const MAX_SPEAKERS = 10;
const FILTER_VALUES = ['red', 'yellow', 'green', 'comments'];
const PLAYBACK_RATE_OPTIONS = [1, 1.5, 2];

const state = {
  audioBlob: null,
  audioFileName: '',
  audioFingerprint: '',
  audioNeedsRemoteSync: false,
  audioRemoteUrl: '',
  audioUrl: '',
  landingMessage: '',
  transcriptFileName: '',
  transcriptWarning: '',
  bites: [],
  projectName: '',
  projectNameDraft: '',
  shareProjectId: '',
  remoteVersion: 0,
  speakerAssignments: [],
  speakerStatus: '',
  speakerEditorOpen: true,
  activeFilters: [],
  searchOpen: false,
  searchQuery: '',
  activeSearchResultIndex: 0,
  hasUnsavedChanges: false,
  saveStatus: ''
};

const landingPanel = document.querySelector('#landing-panel');
const workspace = document.querySelector('#workspace');
const audioInput = document.querySelector('#audio-input');
const transcriptInput = document.querySelector('#transcript-input');
const audioUploadBtn = document.querySelector('#audio-upload-btn');
const transcriptUploadBtn = document.querySelector('#transcript-upload-btn');
const undoBtn = document.querySelector('#undo-btn');
const redoBtn = document.querySelector('#redo-btn');
const saveBtn = document.querySelector('#save-btn');
const shareBtn = document.querySelector('#share-btn');
const shareMenu = document.querySelector('#share-menu');
const shareLinkBtn = document.querySelector('#share-link-btn');
const downloadPdfBtn = document.querySelector('#download-pdf-btn');
const startOverBtn = document.querySelector('#start-over-btn');
const projectTitleBtn = document.querySelector('#project-title-btn');
const projectTitleInput = document.querySelector('#project-title-input');
const speakerSummaryBtn = document.querySelector('#speaker-summary-btn');
const setupPanel = document.querySelector('#setup-panel');
const speakerEditorPanel = document.querySelector('#speaker-editor-panel');
const speakerFields = document.querySelector('#speaker-fields');
const speakerConfirmBtn = document.querySelector('#speaker-confirm-btn');
const speakerStatus = document.querySelector('#speaker-status');
const filterBtn = document.querySelector('#filter-btn');
const filterMenu = document.querySelector('#filter-menu');
const filterCheckboxes = Array.from(document.querySelectorAll('.filter-checkbox'));
const searchBtn = document.querySelector('#search-btn');
const searchPanel = document.querySelector('#search-panel');
const searchInlineRow = document.querySelector('.search-inline-row');
const searchInput = document.querySelector('#search-input');
const searchResultsStatus = document.querySelector('#search-results-status');
const searchPrevBtn = document.querySelector('#search-prev-btn');
const searchNextBtn = document.querySelector('#search-next-btn');
const searchCloseBtn = document.querySelector('#search-close-btn');
const audioFileName = document.querySelector('#audio-file-name');
const transcriptFileName = document.querySelector('#transcript-file-name');
const audioPlayer = document.querySelector('#audio-player');
const audioPlayBtn = document.querySelector('#audio-play-btn');
const audioPlayIcon = document.querySelector('#audio-play-icon');
const audioMuteBtn = document.querySelector('#audio-mute-btn');
const audioVolumeIcon = document.querySelector('#audio-volume-icon');
const audioSpeedBtn = document.querySelector('#audio-speed-btn');
const audioTimeLabel = document.querySelector('#audio-time-label');
const audioScrubber = document.querySelector('#audio-scrubber');
const transcriptSummary = document.querySelector('#transcript-summary');
const statusMessage = document.querySelector('#status-message');
const emptyState = document.querySelector('#empty-state');
const bitesList = document.querySelector('#bites-list');
const biteTemplate = document.querySelector('#bite-template');
const landingStatusMessage = document.querySelector('#landing-status-message');
const shareDialog = document.querySelector('#share-dialog');
const shareDialogLink = document.querySelector('#share-dialog-link');
const shareDialogCloseBtn = document.querySelector('#share-dialog-close-btn');
const shareDialogCopyBtn = document.querySelector('#share-dialog-copy-btn');
const startOverDialog = document.querySelector('#start-over-dialog');
const startOverDialogCancelBtn = document.querySelector('#start-over-dialog-cancel-btn');
const startOverDialogConfirmBtn = document.querySelector('#start-over-dialog-confirm-btn');

const undoStack = [];
const redoStack = [];
const textEditTimers = new Map();
const textEditLocks = new Set();
const textSelectionRanges = new Map();

let draggedBiteId = '';
let lastSavedSignature = '';
let isEditingProjectName = false;
let isFilterMenuOpen = false;
let isShareMenuOpen = false;
let activePlaybackBiteId = '';
let activeAudioObjectUrl = '';
let activeTextEditorId = '';
let remoteSyncTimerId = 0;
let remoteSyncInFlight = false;
let isShareDialogOpen = false;
let shareDialogUrl = '';
let isStartOverDialogOpen = false;
let lastFocusedElement = null;
let shouldScrollToSearchResult = false;

audioUploadBtn.addEventListener('click', () => audioInput.click());
transcriptUploadBtn.addEventListener('click', () => transcriptInput.click());
undoBtn.addEventListener('click', () => undo());
redoBtn.addEventListener('click', () => redo());
saveBtn.addEventListener('click', () => {
  void saveSession();
});
shareBtn.addEventListener('click', () => {
  if (shareBtn.disabled) return;
  isShareMenuOpen = !isShareMenuOpen;
  if (isShareMenuOpen) {
    isFilterMenuOpen = false;
  }
  renderFilterMenu();
  renderShareMenu();
});
shareLinkBtn.addEventListener('click', () => {
  isShareMenuOpen = false;
  renderShareMenu();
  void shareProjectLink();
});
downloadPdfBtn.addEventListener('click', () => {
  isShareMenuOpen = false;
  renderShareMenu();
  void downloadTranscriptPdf();
});
shareDialogCloseBtn.addEventListener('click', () => {
  closeShareDialog();
});
shareDialogCopyBtn.addEventListener('click', () => {
  void copyShareDialogLink();
});

filterBtn.addEventListener('click', () => {
  isFilterMenuOpen = !isFilterMenuOpen;
  if (isFilterMenuOpen) {
    isShareMenuOpen = false;
  }
  renderFilterMenu();
  renderShareMenu();
});

searchBtn.addEventListener('click', () => {
  state.searchOpen = true;
  shouldScrollToSearchResult = Boolean(String(state.searchQuery || '').trim());
  render();
  window.requestAnimationFrame(() => {
    searchInput.focus();
    searchInput.select();
  });
});

searchInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  closeSearchControls();
});

searchCloseBtn.addEventListener('click', () => {
  closeSearchControls();
});

searchInput.addEventListener('input', (event) => {
  state.searchQuery = event.target.value;
  state.activeSearchResultIndex = 0;
  shouldScrollToSearchResult = Boolean(String(state.searchQuery || '').trim());
  render();
});

searchPrevBtn.addEventListener('click', () => {
  const visibleBites = getVisibleBites();
  const matches = buildSearchMatches(visibleBites, state.searchQuery);
  if (!matches.length) return;
  state.activeSearchResultIndex = (state.activeSearchResultIndex - 1 + matches.length) % matches.length;
  shouldScrollToSearchResult = true;
  render();
});

searchNextBtn.addEventListener('click', () => {
  const visibleBites = getVisibleBites();
  const matches = buildSearchMatches(visibleBites, state.searchQuery);
  if (!matches.length) return;
  state.activeSearchResultIndex = (state.activeSearchResultIndex + 1) % matches.length;
  shouldScrollToSearchResult = true;
  render();
});

for (const checkbox of filterCheckboxes) {
  checkbox.addEventListener('change', () => {
    state.activeFilters = filterCheckboxes.filter((input) => input.checked).map((input) => input.value);
    shouldScrollToSearchResult = state.searchOpen && Boolean(String(state.searchQuery || '').trim());
    updateDirtyState();
    render();
  });
}

audioPlayer.addEventListener('timeupdate', () => {
  syncAudioControls();
  syncPlaybackHighlight({ shouldScroll: true, scrollBehavior: 'smooth' });
});

audioPlayer.addEventListener('seeked', () => {
  syncAudioControls();
  syncPlaybackHighlight({ shouldScroll: true, scrollBehavior: 'smooth', forceScroll: true });
});

audioPlayer.addEventListener('play', () => {
  syncAudioControls();
  syncPlaybackHighlight({ shouldScroll: true, scrollBehavior: 'smooth', forceScroll: true });
});

audioPlayer.addEventListener('pause', () => {
  syncAudioControls();
  syncPlaybackHighlight();
});

audioPlayer.addEventListener('ended', () => {
  activePlaybackBiteId = '';
  syncAudioControls();
  syncPlaybackHighlight();
});

audioPlayer.addEventListener('loadedmetadata', () => {
  syncAudioControls();
});

audioPlayer.addEventListener('durationchange', () => {
  syncAudioControls();
});

audioPlayer.addEventListener('volumechange', () => {
  syncAudioControls();
});

audioPlayer.addEventListener('ratechange', () => {
  syncAudioControls();
});

audioPlayBtn.addEventListener('click', () => {
  if (!audioPlayer.src) return;
  if (audioPlayer.paused) {
    void audioPlayer.play().catch(() => {});
    return;
  }
  audioPlayer.pause();
});

audioMuteBtn.addEventListener('click', () => {
  audioPlayer.muted = !audioPlayer.muted;
});

audioSpeedBtn.addEventListener('click', () => {
  if (!audioPlayer.src) return;
  cycleAudioPlaybackRate();
});

audioScrubber.addEventListener('input', (event) => {
  const duration = Number.isFinite(audioPlayer.duration) ? audioPlayer.duration : 0;
  if (duration <= 0) return;
  const ratio = Math.max(0, Math.min(1, Number(event.target.value) || 0));
  audioPlayer.currentTime = duration * ratio;
  syncAudioControls();
  syncPlaybackHighlight({ shouldScroll: true, scrollBehavior: 'auto', forceScroll: true });
});

audioInput.addEventListener('change', async (event) => {
  const [file] = event.target.files || [];
  if (!file) return;
  loadAudioFile(file);
  audioInput.value = '';
});

transcriptInput.addEventListener('change', async (event) => {
  const [file] = event.target.files || [];
  if (!file) return;

  try {
    await loadTranscriptFile(file);
  } catch (error) {
    console.error('Transcript upload failed:', error);
    const message = describeUploadFailure(
      error,
      'Could not read the transcript file. Try a plain text .txt, .srt, or .vtt file.'
    );
    state.landingMessage = message;
    state.transcriptWarning = message;
    render();
  } finally {
    transcriptInput.value = '';
  }
});

projectTitleBtn.addEventListener('click', () => {
  beginProjectNameEdit();
});

projectTitleInput.addEventListener('input', (event) => {
  state.projectNameDraft = event.target.value;
  updateDirtyState();
  renderTopControls();
});

projectTitleInput.addEventListener('keydown', (event) => {
  if (isPlainEnterSaveKey(event)) {
    event.preventDefault();
    commitProjectNameEdit();
    queueSaveSession();
    return;
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    cancelProjectNameEdit();
  }
});

projectTitleInput.addEventListener('blur', () => {
  if (!isEditingProjectName) return;
  commitProjectNameEdit();
});

speakerConfirmBtn.addEventListener('click', () => {
  pushUndoState();
  for (const assignment of state.speakerAssignments) {
    assignment.name = collapseWhitespace(assignment.draft) || assignment.label;
    assignment.draft = assignment.name;
  }
  state.speakerStatus = '';
  state.speakerEditorOpen = false;
  state.saveStatus = '';
  updateDirtyState();
  render();
});

speakerSummaryBtn.addEventListener('click', () => {
  state.speakerEditorOpen = true;
  state.speakerStatus = '';
  render();
});

startOverBtn.addEventListener('click', async () => {
  openStartOverDialog();
});
startOverDialogCancelBtn.addEventListener('click', () => {
  closeStartOverDialog();
});
startOverDialogConfirmBtn.addEventListener('click', () => {
  void confirmStartOver();
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (isShareDialogOpen) {
      event.preventDefault();
      closeShareDialog();
      return;
    }

    if (isStartOverDialogOpen) {
      event.preventDefault();
      closeStartOverDialog();
      return;
    }
  }

  const metaKeyPressed = event.metaKey || event.ctrlKey;
  if (!metaKeyPressed) return;

  const normalizedKey = event.key.toLowerCase();
  if (normalizedKey === 's') {
    event.preventDefault();
    void saveSession();
    return;
  }

  if (normalizedKey === 'z' && !event.shiftKey) {
    event.preventDefault();
    undo();
    return;
  }

  if ((normalizedKey === 'z' && event.shiftKey) || normalizedKey === 'y') {
    event.preventDefault();
    redo();
  }
});

window.addEventListener('beforeunload', (event) => {
  if (activeAudioObjectUrl) {
    URL.revokeObjectURL(activeAudioObjectUrl);
    activeAudioObjectUrl = '';
  }

  if (state.hasUnsavedChanges) {
    event.preventDefault();
    event.returnValue = '';
  }
});

document.addEventListener('click', (event) => {
  if (!filterMenu.contains(event.target) && !filterBtn.contains(event.target)) {
    isFilterMenuOpen = false;
    renderFilterMenu();
  }
  if (!shareMenu.contains(event.target) && !shareBtn.contains(event.target)) {
    isShareMenuOpen = false;
    renderShareMenu();
  }
  if (isShareDialogOpen && event.target === shareDialog) {
    closeShareDialog();
  }
  if (isStartOverDialogOpen && event.target === startOverDialog) {
    closeStartOverDialog();
  }
});

document.addEventListener('selectionchange', () => {
  if (!activeTextEditorId) return;
  const activeEditor = bitesList.querySelector(`.bite-card[data-id="${activeTextEditorId}"] .bite-text`);
  if (!(activeEditor instanceof HTMLElement)) return;
  saveTextSelection(activeEditor, activeTextEditorId);
  syncTextFormatToolbarState(activeEditor, activeTextEditorId);
});

void initializeApp();

async function initializeApp() {
  const sharedProjectId = readSharedProjectIdFromUrl();
  const restored = sharedProjectId
    ? await loadRemoteProject(sharedProjectId)
    : await restoreSavedSession();
  if (restored) {
    state.saveStatus = sharedProjectId ? 'Shared project loaded.' : 'Saved progress restored.';
  }
  if (state.shareProjectId) {
    startRemoteSync();
  }
  render();
  syncAudioControls();
}

function loadAudioFile(file) {
  pushUndoState();
  setAudioSource(file, file.name, '', buildAudioFingerprint(file));
  state.audioNeedsRemoteSync = true;
  state.landingMessage = '';

  if (!collapseWhitespace(state.projectNameDraft)) {
    const defaultProjectName = deriveProjectName(file.name);
    state.projectNameDraft = defaultProjectName;
    if (!collapseWhitespace(state.projectName)) {
      state.projectName = defaultProjectName;
    }
  }

  state.saveStatus = '';
  updateDirtyState();
  render();
}

async function loadTranscriptFile(file) {
  const rawText = await file.text();
  const parsedTranscript = parseTranscript(rawText);

  pushUndoState();
  state.landingMessage = '';
  state.transcriptFileName = file.name;
  state.transcriptWarning = parsedTranscript.warning;
  state.bites = parsedTranscript.bites;
  state.speakerAssignments = buildSpeakerAssignments(parsedTranscript.bites, state.speakerAssignments);
  state.speakerStatus = '';
  state.speakerEditorOpen = state.speakerAssignments.length > 0;
  state.saveStatus = '';
  updateDirtyState();
  render();
}

async function resetWorkspace() {
  clearTextEditTracking();
  undoStack.length = 0;
  redoStack.length = 0;
  lastSavedSignature = '';
  draggedBiteId = '';
  stopRemoteSync();
  clearState();
  state.hasUnsavedChanges = false;
  state.saveStatus = '';
  await clearSavedSession();
  clearSharedProjectIdFromUrl();
  render();
}

function clearState() {
  setAudioSource(null, '', '');
  state.landingMessage = '';
  state.transcriptFileName = '';
  state.transcriptWarning = '';
  state.bites = [];
  state.projectName = '';
  state.projectNameDraft = '';
  state.shareProjectId = '';
  state.remoteVersion = 0;
  state.speakerAssignments = [];
  state.speakerStatus = '';
  state.speakerEditorOpen = true;
  state.activeFilters = [];
  state.audioNeedsRemoteSync = false;
}

function setAudioSource(blob, fileName, remoteUrl = '', fingerprint = '') {
  if (activeAudioObjectUrl) {
    URL.revokeObjectURL(activeAudioObjectUrl);
    activeAudioObjectUrl = '';
  }

  state.audioBlob = blob || null;
  state.audioFileName = fileName || '';
  state.audioRemoteUrl = blob ? '' : String(remoteUrl || '');
  state.audioFingerprint = String(fingerprint || '').trim() || fileName || '';
  state.audioUrl = blob ? URL.createObjectURL(blob) : state.audioRemoteUrl;
  if (blob) {
    activeAudioObjectUrl = state.audioUrl;
  }

  if (state.audioUrl) {
    audioPlayer.src = state.audioUrl;
  } else {
    audioPlayer.removeAttribute('src');
    audioPlayer.load();
  }
  syncAudioControls();
}

function render() {
  const isReady = hasReadyWorkspace();

  audioFileName.textContent = state.audioUrl ? state.audioFileName : '';
  transcriptFileName.textContent = state.transcriptFileName || '';
  landingStatusMessage.textContent = state.landingMessage;
  landingStatusMessage.classList.toggle('hidden', !state.landingMessage);
  document.body.classList.toggle('workspace-active', isReady);

  landingPanel.classList.toggle('hidden', isReady);
  workspace.classList.toggle('hidden', !isReady);

  renderTopControls(isReady);
  syncAudioControls();
  renderShareDialog();
  renderStartOverDialog();

  if (!isReady) return;

  renderPromptPanel();
  renderProjectTitle();
  renderFilterMenu();

  const visibleBites = getVisibleBites();
  const searchMatches = buildSearchMatches(visibleBites, state.searchQuery);
  syncSearchState(searchMatches);
  renderSearchControls(searchMatches);
  transcriptSummary.textContent = buildTranscriptSummary(visibleBites.length, state.bites.length);

  if (state.transcriptWarning) {
    statusMessage.textContent = state.transcriptWarning;
    statusMessage.classList.remove('hidden');
  } else {
    statusMessage.textContent = '';
    statusMessage.classList.add('hidden');
  }

  emptyState.textContent = state.bites.length > 0 ? 'No sound bites match the selected filters.' : 'No transcript bites were created from this file yet.';
  emptyState.classList.toggle('hidden', visibleBites.length > 0);
  renderBites(visibleBites, searchMatches);

  if (shouldScrollToSearchResult && searchMatches.length) {
    shouldScrollToSearchResult = false;
    window.requestAnimationFrame(() => {
      scrollToActiveSearchResult(searchMatches);
    });
  } else if (shouldScrollToSearchResult) {
    shouldScrollToSearchResult = false;
  }
}

function syncAudioControls() {
  const hasAudioSource = Boolean(audioPlayer.src);
  const duration = Number.isFinite(audioPlayer.duration) ? audioPlayer.duration : 0;
  const currentTime = Math.min(duration || 0, Math.max(0, Number(audioPlayer.currentTime) || 0));
  const ratio = duration > 0 ? currentTime / duration : 0;
  const progressPercent = `${Math.max(0, Math.min(100, ratio * 100))}%`;
  const playbackRate = hasAudioSource ? getNormalizedPlaybackRate(audioPlayer.playbackRate) : PLAYBACK_RATE_OPTIONS[0];
  const playbackRateLabel = formatPlaybackRateLabel(playbackRate);
  const nextPlaybackRateLabel = formatPlaybackRateLabel(getNextPlaybackRate(playbackRate));

  audioPlayBtn.disabled = !hasAudioSource;
  audioMuteBtn.disabled = !hasAudioSource;
  audioSpeedBtn.disabled = !hasAudioSource;
  audioScrubber.disabled = !audioPlayer.src || duration <= 0;
  audioScrubber.value = String(ratio);
  audioScrubber.style.setProperty('--scrubber-progress', progressPercent);
  audioTimeLabel.textContent = `${formatPlayerTimestamp(currentTime)} / ${formatPlayerTimestamp(duration)}`;
  audioSpeedBtn.textContent = playbackRateLabel;
  audioSpeedBtn.setAttribute(
    'aria-label',
    hasAudioSource ? `Playback speed ${playbackRateLabel}. Click to switch to ${nextPlaybackRateLabel}.` : 'Playback speed'
  );
  audioSpeedBtn.setAttribute(
    'title',
    hasAudioSource ? `Playback speed ${playbackRateLabel}. Click to switch to ${nextPlaybackRateLabel}.` : 'Playback speed'
  );

  if (audioPlayer.paused || audioPlayer.ended) {
    audioPlayBtn.setAttribute('aria-label', 'Play audio');
    audioPlayBtn.setAttribute('title', 'Play audio');
    audioPlayIcon.setAttribute('viewBox', '0 0 24 24');
    audioPlayIcon.innerHTML = '<path d="M8 6l10 6-10 6z"></path>';
  } else {
    audioPlayBtn.setAttribute('aria-label', 'Pause audio');
    audioPlayBtn.setAttribute('title', 'Pause audio');
    audioPlayIcon.setAttribute('viewBox', '0 0 24 24');
    audioPlayIcon.innerHTML = '<path d="M8 6h3v12H8z"></path><path d="M13 6h3v12h-3z"></path>';
  }

  const isMuted = audioPlayer.muted || audioPlayer.volume === 0;
  audioMuteBtn.setAttribute('aria-label', isMuted ? 'Unmute audio' : 'Mute audio');
  audioMuteBtn.setAttribute('title', isMuted ? 'Unmute audio' : 'Mute audio');
  audioVolumeIcon.innerHTML = isMuted
    ? '<path d="M5 10h4l5-4v12l-5-4H5z"></path><path d="M17 9l4 6"></path><path d="M21 9l-4 6"></path>'
    : '<path d="M5 10h4l5-4v12l-5-4H5z"></path><path d="M17 9c1.6 1.6 1.6 4.4 0 6"></path><path d="M19.5 6.5c3 3 3 8 0 11"></path>';
}

function getNormalizedPlaybackRate(rate) {
  const safeRate = Number(rate);
  if (!Number.isFinite(safeRate) || safeRate <= 0) {
    return PLAYBACK_RATE_OPTIONS[0];
  }

  let closestRate = PLAYBACK_RATE_OPTIONS[0];
  let closestDelta = Math.abs(safeRate - closestRate);

  for (const candidate of PLAYBACK_RATE_OPTIONS.slice(1)) {
    const delta = Math.abs(safeRate - candidate);
    if (delta < closestDelta) {
      closestRate = candidate;
      closestDelta = delta;
    }
  }

  return closestRate;
}

function getNextPlaybackRate(currentRate) {
  const normalizedRate = getNormalizedPlaybackRate(currentRate);
  const currentIndex = PLAYBACK_RATE_OPTIONS.indexOf(normalizedRate);
  const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % PLAYBACK_RATE_OPTIONS.length : 0;
  return PLAYBACK_RATE_OPTIONS[nextIndex];
}

function formatPlaybackRateLabel(rate) {
  return `${Number(rate)}X`;
}

function cycleAudioPlaybackRate() {
  const nextPlaybackRate = getNextPlaybackRate(audioPlayer.playbackRate);
  audioPlayer.defaultPlaybackRate = nextPlaybackRate;
  audioPlayer.playbackRate = nextPlaybackRate;
  syncAudioControls();
}

function formatPlayerTimestamp(totalSeconds) {
  const safeSeconds = Math.max(0, Number(totalSeconds) || 0);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = Math.floor(safeSeconds % 60);

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function renderTopControls(isReady = hasReadyWorkspace()) {
  undoBtn.disabled = undoStack.length === 0;
  redoBtn.disabled = redoStack.length === 0;
  saveBtn.disabled = !isReady || !state.hasUnsavedChanges;
  shareBtn.disabled = !isReady;
  renderShareMenu();
}

function renderPromptPanel() {
  const showSpeakerEditor = state.speakerEditorOpen && state.speakerAssignments.length > 0;
  setupPanel.classList.toggle('hidden', !showSpeakerEditor);
  renderPromptStatuses();
  renderSpeakerSummary();
  renderSpeakerFields();
  speakerEditorPanel.classList.toggle('hidden', !showSpeakerEditor);
}

function renderFilterMenu() {
  filterBtn.setAttribute('aria-expanded', String(isFilterMenuOpen));
  filterMenu.classList.toggle('hidden', !isFilterMenuOpen);
  filterBtn.textContent = state.activeFilters.length ? `Filter (${state.activeFilters.length})` : 'Filter';

  for (const checkbox of filterCheckboxes) {
    checkbox.checked = state.activeFilters.includes(checkbox.value);
  }
}

function renderSearchControls(searchMatches = []) {
  searchBtn.setAttribute('aria-expanded', String(state.searchOpen));
  searchPanel.classList.toggle('hidden', !state.searchOpen);
  searchInlineRow.classList.toggle('search-open', state.searchOpen);
  searchInput.value = state.searchQuery;

  const hasQuery = Boolean(String(state.searchQuery || '').trim());
  if (!hasQuery) {
    searchResultsStatus.textContent = '0 results';
  } else if (!searchMatches.length) {
    searchResultsStatus.textContent = '0 results';
  } else {
    searchResultsStatus.textContent = `${state.activeSearchResultIndex + 1}/${searchMatches.length} results`;
  }

  searchPrevBtn.disabled = searchMatches.length <= 1;
  searchNextBtn.disabled = searchMatches.length <= 1;
}

function closeSearchControls() {
  state.searchOpen = false;
  state.searchQuery = '';
  state.activeSearchResultIndex = 0;
  shouldScrollToSearchResult = false;
  render();
}

function renderShareMenu() {
  shareBtn.setAttribute('aria-expanded', String(isShareMenuOpen));
  shareMenu.classList.toggle('hidden', !isShareMenuOpen || shareBtn.disabled);
}

function renderPromptStatuses() {
  if (state.speakerStatus) {
    speakerStatus.textContent = state.speakerStatus;
    speakerStatus.classList.remove('hidden');
  } else {
    speakerStatus.textContent = '';
    speakerStatus.classList.add('hidden');
  }
}

function renderSpeakerSummary() {
  const speakerNames = state.speakerAssignments
    .map((assignment) => collapseWhitespace(assignment.name) || assignment.label)
    .filter(Boolean);

  if (!speakerNames.length) {
    speakerSummaryBtn.textContent = '';
    speakerSummaryBtn.classList.add('hidden');
    return;
  }

  speakerSummaryBtn.textContent = `Speakers: ${speakerNames.join(', ')}`;
  speakerSummaryBtn.classList.remove('hidden');
}

function renderProjectTitle() {
  const projectName = collapseWhitespace(state.projectNameDraft) || collapseWhitespace(state.projectName) || deriveProjectName(state.audioFileName) || 'Untitled Project';
  projectTitleBtn.textContent = projectName;
  projectTitleInput.value = state.projectNameDraft || projectName;
  projectTitleBtn.classList.toggle('hidden', isEditingProjectName);
  projectTitleInput.classList.toggle('hidden', !isEditingProjectName);
}

function beginProjectNameEdit() {
  isEditingProjectName = true;
  renderProjectTitle();
  window.requestAnimationFrame(() => {
    projectTitleInput.focus();
    projectTitleInput.select();
  });
}

function commitProjectNameEdit() {
  const nextProjectName = collapseWhitespace(state.projectNameDraft) || deriveProjectName(state.audioFileName) || 'Untitled Project';
  if (nextProjectName !== state.projectName) {
    pushUndoState();
    state.projectName = nextProjectName;
  }
  state.projectNameDraft = nextProjectName;
  state.saveStatus = '';
  isEditingProjectName = false;
  updateDirtyState();
  render();
}

function cancelProjectNameEdit() {
  state.projectNameDraft = state.projectName || deriveProjectName(state.audioFileName) || '';
  isEditingProjectName = false;
  updateDirtyState();
  render();
}

function renderSpeakerFields() {
  speakerFields.replaceChildren();
  speakerFields.classList.toggle('single-speaker-fields', state.speakerAssignments.length <= 1);

  if (!state.speakerAssignments.length) {
    const emptyCopy = document.createElement('p');
    emptyCopy.className = 'speaker-empty-copy';
    emptyCopy.textContent = 'No speaker labels were detected in this transcript.';
    speakerFields.append(emptyCopy);
    speakerConfirmBtn.disabled = true;
    return;
  }

  speakerConfirmBtn.disabled = false;

  for (const assignment of state.speakerAssignments) {
    const field = document.createElement('label');
    field.className = 'speaker-field';

    const input = document.createElement('input');
    input.className = 'prompt-input speaker-input';
    input.type = 'text';
    input.value = assignment.draft;
    input.placeholder = assignment.label;
    input.addEventListener('input', (event) => {
      assignment.draft = event.target.value;
      state.speakerStatus = '';
      updateDirtyState();
      renderTopControls();
      renderPromptStatuses();
    });
    input.addEventListener('keydown', (event) => {
      if (!isPlainEnterSaveKey(event)) return;
      event.preventDefault();
      if (!speakerConfirmBtn.disabled) {
        speakerConfirmBtn.click();
        queueSaveSession();
      }
    });

    field.append(input);
    speakerFields.append(field);
  }
}

function renderBites(visibleBites = state.bites, searchMatches = []) {
  bitesList.replaceChildren();
  textSelectionRanges.clear();
  activeTextEditorId = '';
  const matchesByBiteId = buildMatchesByBiteId(searchMatches);

  for (const [index, bite] of visibleBites.entries()) {
    const fragment = biteTemplate.content.cloneNode(true);
    const card = fragment.querySelector('.bite-card');
    const orderLabel = fragment.querySelector('.bite-order');
    const timecodeBtn = fragment.querySelector('.timecode-btn');
    const speakerChip = fragment.querySelector('.speaker-chip');
    const textToolbar = fragment.querySelector('.text-format-toolbar');
    const editor = fragment.querySelector('.bite-text');
    const textFormatButtons = Array.from(fragment.querySelectorAll('.text-format-btn'));
    const producerNoteToggle = fragment.querySelector('.producer-note-toggle');
    const producerNoteInputWrap = fragment.querySelector('.producer-note-input-wrap');
    const producerNoteInput = fragment.querySelector('.producer-note-input');
    const producerNoteRemove = fragment.querySelector('.producer-note-remove');
    const producerNoteConfirm = fragment.querySelector('.producer-note-confirm');
    const toneButtons = Array.from(fragment.querySelectorAll('.tone-btn'));
    const moveUpBtn = fragment.querySelector('.move-up-btn');
    const moveDownBtn = fragment.querySelector('.move-down-btn');
    const deleteBtn = fragment.querySelector('.delete-btn');

    card.dataset.id = bite.id;
    card.classList.toggle('tone-red', bite.tone === 'red');
    card.classList.toggle('tone-yellow', bite.tone === 'yellow');
    card.classList.toggle('tone-green', bite.tone === 'green');
    card.classList.toggle('is-playing', bite.id === activePlaybackBiteId);

    orderLabel.textContent = `Bite ${index + 1}`;
    timecodeBtn.textContent = formatTimeRange(bite);
    timecodeBtn.disabled = bite.startSeconds == null;
    timecodeBtn.addEventListener('click', () => {
      if (bite.startSeconds == null) return;
      audioPlayer.currentTime = bite.startSeconds;
      void audioPlayer.play().catch(() => {});
    });

    const speakerName = getSpeakerDisplayName(bite);
    if (speakerName) {
      speakerChip.textContent = speakerName;
      speakerChip.classList.remove('hidden');
    } else {
      speakerChip.textContent = '';
      speakerChip.classList.add('hidden');
    }

    editor.dataset.placeholder = 'Transcript text';
    const biteSearchMatches = matchesByBiteId.get(bite.id) || [];
    editor.innerHTML = buildHighlightedBiteHtml(bite, biteSearchMatches);
    syncBiteTextPlaceholder(editor);
    syncTextFormatToolbarState(editor, bite.id);

    if (biteSearchMatches.length) {
      card.classList.add('has-search-match');
    }

    if (biteSearchMatches.some((match) => match.resultIndex === state.activeSearchResultIndex)) {
      card.classList.add('has-active-search-match');
    }

    const activateTextEditor = () => {
      activeTextEditorId = bite.id;
      card.classList.add('is-text-active');
      card.draggable = false;
      saveTextSelection(editor, bite.id);
      syncTextFormatToolbarState(editor, bite.id);
    };

    const commitTextEditor = () => {
      const normalizedContent = getNormalizedBiteTextContent(editor.innerHTML, { capitalize: true });
      if (normalizedContent.text !== bite.text || normalizedContent.textHtml !== bite.textHtml) {
        handleTextEdit(bite.id, normalizedContent.text, normalizedContent.textHtml);
      }

      if (editor.innerHTML !== normalizedContent.textHtml) {
        editor.innerHTML = normalizedContent.textHtml;
      }

      syncBiteTextPlaceholder(editor);
      saveTextSelection(editor, bite.id);
      syncTextFormatToolbarState(editor, bite.id);
    };

    editor.addEventListener('focus', activateTextEditor);
    editor.addEventListener('click', activateTextEditor);
    editor.addEventListener('keyup', () => {
      saveTextSelection(editor, bite.id);
      syncTextFormatToolbarState(editor, bite.id);
    });
    editor.addEventListener('mouseup', () => {
      saveTextSelection(editor, bite.id);
      syncTextFormatToolbarState(editor, bite.id);
    });
    editor.addEventListener('input', () => {
      const nextContent = getNormalizedBiteTextContent(editor.innerHTML);
      handleTextEdit(bite.id, nextContent.text, nextContent.textHtml);
      syncBiteTextPlaceholder(editor);
      saveTextSelection(editor, bite.id);
      syncTextFormatToolbarState(editor, bite.id);
    });
    editor.addEventListener('paste', (event) => {
      handleRichTextPaste(event, bite.id, editor);
      syncBiteTextPlaceholder(editor);
      saveTextSelection(editor, bite.id);
      syncTextFormatToolbarState(editor, bite.id);
    });
    editor.addEventListener('keydown', handleEditableSaveOnEnter);
    editor.addEventListener('blur', () => {
      window.setTimeout(() => {
        commitTextEditor();
        if (card.contains(document.activeElement)) return;
        card.classList.remove('is-text-active');
        card.draggable = true;
        if (activeTextEditorId === bite.id) {
          activeTextEditorId = '';
        }
        syncTextFormatToolbarState(editor, bite.id);
      }, 0);
    });

    textToolbar.addEventListener('focusout', () => {
      window.setTimeout(() => {
        if (card.contains(document.activeElement)) return;
        card.classList.remove('is-text-active');
        card.draggable = true;
        if (activeTextEditorId === bite.id) {
          activeTextEditorId = '';
        }
        syncTextFormatToolbarState(editor, bite.id);
      }, 0);
    });

    for (const button of textFormatButtons) {
      button.addEventListener('mousedown', (event) => {
        event.preventDefault();
      });
      button.addEventListener('click', () => {
        if (button.disabled) return;
        applyTextFormat(button.dataset.format, bite.id, editor);
        syncBiteTextPlaceholder(editor);
        saveTextSelection(editor, bite.id);
        syncTextFormatToolbarState(editor, bite.id);
      });
    }

    producerNoteToggle.addEventListener('click', () => {
      bite.notesOpen = true;
      render();
    });

    const noteValue = Array.isArray(bite.comments) ? bite.comments[0] || '' : '';
    const hasProducerNote = hasTextContent(noteValue);
    const noteVisible = bite.notesOpen === true || hasProducerNote;

    producerNoteToggle.classList.toggle('hidden', noteVisible);
    producerNoteInputWrap.classList.toggle('hidden', !noteVisible);
    producerNoteInput.value = noteValue;
    producerNoteInputWrap.dataset.committedValue = noteValue;
    syncProducerNoteState(producerNoteInputWrap, producerNoteInput.value);
    producerNoteInput.addEventListener('input', (event) => {
      handleProducerNoteEdit(bite.id, event.target.value);
      syncProducerNoteState(producerNoteInputWrap, event.target.value);
      syncProducerNoteDirtyState(producerNoteInputWrap, event.target.value);
    });
    producerNoteInput.addEventListener('focus', () => {
      bite.notesOpen = true;
      producerNoteInputWrap.classList.add('is-editing');
      syncProducerNoteState(producerNoteInputWrap, producerNoteInput.value);
      syncProducerNoteDirtyState(producerNoteInputWrap, producerNoteInput.value);
    });
    producerNoteInput.addEventListener('blur', () => {
      producerNoteInputWrap.classList.remove('is-editing');
      producerNoteInputWrap.classList.remove('is-dirty');
      producerNoteInputWrap.dataset.committedValue = producerNoteInput.value;
      syncProducerNoteState(producerNoteInputWrap, producerNoteInput.value);
    });
    producerNoteInput.addEventListener('keydown', handleEditableSaveOnEnter);
    producerNoteConfirm.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      producerNoteInput.blur();
      queueSaveSession();
    });
    producerNoteRemove.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      pushUndoState();
      bite.comments = [];
      bite.notesOpen = false;
      state.saveStatus = '';
      updateDirtyState();
      render();
    });

    for (const button of toneButtons) {
      const isActive = button.dataset.tone === bite.tone;
      button.classList.toggle('is-active', isActive);
      button.addEventListener('click', () => {
        pushUndoState();
        bite.tone = isActive ? 'none' : button.dataset.tone;
        state.saveStatus = '';
        updateDirtyState();
        render();
      });
    }

    moveUpBtn.disabled = index === 0;
    moveUpBtn.addEventListener('click', () => {
      const currentIndex = state.bites.findIndex((entry) => entry.id === bite.id);
      moveBite(currentIndex, currentIndex - 1);
    });

    moveDownBtn.disabled = index === visibleBites.length - 1;
    moveDownBtn.addEventListener('click', () => {
      const currentIndex = state.bites.findIndex((entry) => entry.id === bite.id);
      moveBite(currentIndex, currentIndex + 1);
    });

    deleteBtn.addEventListener('click', () => {
      pushUndoState();
      state.bites = state.bites.filter((entry) => entry.id !== bite.id);
      state.speakerAssignments = buildSpeakerAssignments(state.bites, state.speakerAssignments);
      state.saveStatus = '';
      updateDirtyState();
      render();
    });

    attachDragHandlers(card, bite.id);
    bitesList.append(card);
  }

  syncPlaybackHighlight();
}

function syncSearchState(searchMatches) {
  if (!searchMatches.length) {
    state.activeSearchResultIndex = 0;
    return;
  }

  state.activeSearchResultIndex = Math.max(0, Math.min(state.activeSearchResultIndex, searchMatches.length - 1));
}

function buildSearchMatches(visibleBites, rawQuery) {
  const query = String(rawQuery || '').trim().toLowerCase();
  if (!query) return [];

  const matches = [];

  for (const bite of visibleBites) {
    const plainText = getPlainTextFromRichTextHtml(getBiteTextHtml(bite)).replace(/\u00a0/g, ' ');
    const haystack = plainText.toLowerCase();
    let fromIndex = 0;

    while (fromIndex < haystack.length) {
      const matchIndex = haystack.indexOf(query, fromIndex);
      if (matchIndex === -1) break;
      matches.push({
        biteId: bite.id,
        start: matchIndex,
        end: matchIndex + query.length,
        resultIndex: matches.length
      });
      fromIndex = matchIndex + Math.max(query.length, 1);
    }
  }

  return matches;
}

function buildMatchesByBiteId(searchMatches) {
  const matchesByBiteId = new Map();
  for (const match of searchMatches) {
    if (!matchesByBiteId.has(match.biteId)) {
      matchesByBiteId.set(match.biteId, []);
    }
    matchesByBiteId.get(match.biteId).push(match);
  }
  return matchesByBiteId;
}

function buildHighlightedBiteHtml(bite, biteSearchMatches) {
  const baseHtml = getBiteTextHtml(bite);
  if (!biteSearchMatches.length) {
    return baseHtml;
  }

  const template = document.createElement('template');
  template.innerHTML = baseHtml;
  const textNodes = [];
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);

  let currentNode = walker.nextNode();
  while (currentNode) {
    textNodes.push(currentNode);
    currentNode = walker.nextNode();
  }

  let textOffset = 0;

  for (const node of textNodes) {
    const text = node.textContent || '';
    const nodeStart = textOffset;
    const nodeEnd = nodeStart + text.length;
    textOffset = nodeEnd;

    const overlappingMatches = biteSearchMatches.filter((match) => match.start < nodeEnd && match.end > nodeStart);
    if (!overlappingMatches.length) continue;

    const fragment = document.createDocumentFragment();
    let cursor = 0;

    for (const match of overlappingMatches) {
      const localStart = Math.max(0, match.start - nodeStart);
      const localEnd = Math.min(text.length, match.end - nodeStart);

      if (localStart > cursor) {
        fragment.append(document.createTextNode(text.slice(cursor, localStart)));
      }

      const mark = document.createElement('mark');
      mark.className = 'search-highlight';
      if (match.resultIndex === state.activeSearchResultIndex) {
        mark.classList.add('search-highlight-active');
        mark.dataset.activeSearchResult = 'true';
      }
      mark.textContent = text.slice(localStart, localEnd);
      fragment.append(mark);
      cursor = localEnd;
    }

    if (cursor < text.length) {
      fragment.append(document.createTextNode(text.slice(cursor)));
    }

    node.parentNode?.replaceChild(fragment, node);
  }

  return template.innerHTML;
}

function scrollToActiveSearchResult(searchMatches) {
  const activeMatch = searchMatches[state.activeSearchResultIndex];
  if (!activeMatch) return;

  const activeHighlight = bitesList.querySelector('[data-active-search-result="true"]');
  if (activeHighlight) {
    activeHighlight.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    return;
  }

  const activeCard = bitesList.querySelector(`.bite-card[data-id="${activeMatch.biteId}"]`);
  activeCard?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
}

function getVisibleBites() {
  if (!state.activeFilters.length) {
    return state.bites;
  }

  return state.bites.filter((bite) => biteMatchesFilters(bite));
}

function biteMatchesFilters(bite) {
  return state.activeFilters.some((filter) => {
    if (filter === 'comments') {
      return Array.isArray(bite.comments) && bite.comments.some((entry) => hasTextContent(entry));
    }

    return bite.tone === filter;
  });
}

function buildTranscriptSummary(visibleCount, totalCount) {
  if (!state.activeFilters.length) {
    return `${totalCount} sound ${totalCount === 1 ? 'bite' : 'bites'}`;
  }

  return `${visibleCount} of ${totalCount} sound ${totalCount === 1 ? 'bite' : 'bites'}`;
}

function syncPlaybackHighlight(options = {}) {
  const {
    shouldScroll = false,
    scrollBehavior = 'smooth',
    forceScroll = false
  } = options;
  const previousActiveBiteId = activePlaybackBiteId;
  const nextActiveBiteId = getActivePlaybackBiteId(audioPlayer.currentTime);
  activePlaybackBiteId = nextActiveBiteId;
  let activeCard = null;

  for (const card of bitesList.querySelectorAll('.bite-card')) {
    const isActive = card.dataset.id === activePlaybackBiteId;
    card.classList.toggle('is-playing', isActive);
    if (isActive) {
      activeCard = card;
    }
  }

  if (!shouldScroll || !activeCard) {
    return;
  }

  if (!forceScroll && previousActiveBiteId === activePlaybackBiteId) {
    return;
  }

  scrollPlaybackBiteIntoView(activeCard, scrollBehavior);
}

function scrollPlaybackBiteIntoView(card, behavior = 'smooth') {
  if (!card) return;

  const hasScrollableTranscriptList = bitesList.scrollHeight > bitesList.clientHeight + 1;
  if (hasScrollableTranscriptList && isPlaybackCardVisibleWithinTranscriptList(card)) {
    return;
  }

  if (!hasScrollableTranscriptList && isPlaybackCardVisibleInViewport(card)) {
    return;
  }

  card.scrollIntoView({ behavior, block: 'center', inline: 'nearest' });
}

function isPlaybackCardVisibleWithinTranscriptList(card) {
  const containerRect = bitesList.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  if (!containerRect.height) {
    return false;
  }

  const verticalPadding = Math.max(32, Math.min(96, containerRect.height * 0.18));
  return cardRect.top >= containerRect.top + verticalPadding
    && cardRect.bottom <= containerRect.bottom - verticalPadding;
}

function isPlaybackCardVisibleInViewport(card) {
  const cardRect = card.getBoundingClientRect();
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  if (!viewportHeight) {
    return false;
  }

  const verticalPadding = Math.max(32, Math.min(120, viewportHeight * 0.18));
  return cardRect.top >= verticalPadding
    && cardRect.bottom <= viewportHeight - verticalPadding;
}

function getActivePlaybackBiteId(currentTimeSeconds) {
  if (!Number.isFinite(currentTimeSeconds) || currentTimeSeconds < 0) {
    return '';
  }

  for (let index = 0; index < state.bites.length; index += 1) {
    const bite = state.bites[index];
    if (bite.startSeconds == null) continue;

    const nextTimedBite = state.bites.slice(index + 1).find((entry) => entry.startSeconds != null);
    const biteEndSeconds = bite.endSeconds ?? nextTimedBite?.startSeconds ?? Number.POSITIVE_INFINITY;

    if (currentTimeSeconds >= bite.startSeconds && currentTimeSeconds < biteEndSeconds) {
      return bite.id;
    }
  }

  return '';
}

function getSpeakerDisplayName(bite) {
  if (!bite.speakerKey) return '';
  const assignment = state.speakerAssignments.find((entry) => entry.key === bite.speakerKey);
  return assignment?.name || bite.speakerLabel || '';
}

function handleTextEdit(biteId, textValue, htmlValue = plainTextToRichTextHtml(textValue)) {
  if (!textEditLocks.has(biteId)) {
    pushUndoState();
    textEditLocks.add(biteId);
  }

  const bite = state.bites.find((entry) => entry.id === biteId);
  if (!bite) return;

  bite.text = String(textValue || '').replace(/\r\n/g, '\n');
  bite.textHtml = String(htmlValue || '');
  state.saveStatus = '';
  updateDirtyState();
  renderTopControls();

  window.clearTimeout(textEditTimers.get(biteId));
  textEditTimers.set(
    biteId,
    window.setTimeout(() => {
      textEditLocks.delete(biteId);
      textEditTimers.delete(biteId);
    }, TEXT_HISTORY_IDLE_MS)
  );
}

function syncTextFormatToolbarState(editor, biteId) {
  const toolbar = editor.closest('.bite-text-wrap')?.querySelector('.text-format-toolbar');
  if (!toolbar) return;

  const hasSelection = hasStoredTextSelection(editor, biteId);
  for (const button of toolbar.querySelectorAll('.text-format-btn')) {
    button.disabled = !hasSelection;
  }
}

function syncBiteTextPlaceholder(editor) {
  editor.dataset.empty = hasTextContent(getPlainTextFromRichTextHtml(editor.innerHTML)) ? 'false' : 'true';
}

function saveTextSelection(editor, biteId) {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return;

  const range = selection.getRangeAt(0);
  if (!isRangeInsideEditor(editor, range)) return;
  textSelectionRanges.set(biteId, range.cloneRange());
}

function hasStoredTextSelection(editor, biteId) {
  const range = textSelectionRanges.get(biteId);
  return Boolean(range && !range.collapsed && isRangeInsideEditor(editor, range));
}

function isRangeInsideEditor(editor, range) {
  return editor.contains(range.startContainer) && editor.contains(range.endContainer);
}

function restoreTextSelection(editor, biteId) {
  const range = textSelectionRanges.get(biteId);
  if (!range || !isRangeInsideEditor(editor, range)) return false;

  const selection = window.getSelection();
  if (!selection) return false;

  editor.focus();
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

function handleRichTextPaste(event, biteId, editor) {
  event.preventDefault();
  const pastedText = event.clipboardData?.getData('text/plain') || '';
  if (!restoreTextSelection(editor, biteId)) {
    editor.focus();
  }
  insertTextAtSelection(pastedText);
  const nextContent = getNormalizedBiteTextContent(editor.innerHTML);
  handleTextEdit(biteId, nextContent.text, nextContent.textHtml);
}

function insertTextAtSelection(value) {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return;

  const range = selection.getRangeAt(0);
  range.deleteContents();

  const normalizedValue = String(value || '').replace(/\r\n/g, '\n');
  const fragment = document.createDocumentFragment();
  const lines = normalizedValue.split('\n');
  let lastInsertedNode = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line) {
      lastInsertedNode = document.createTextNode(line);
      fragment.append(lastInsertedNode);
    }

    if (index < lines.length - 1) {
      lastInsertedNode = document.createElement('br');
      fragment.append(lastInsertedNode);
    }
  }

  if (lastInsertedNode) {
    range.insertNode(fragment);
    if (lastInsertedNode.nodeType === Node.TEXT_NODE) {
      range.setStart(lastInsertedNode, lastInsertedNode.textContent.length);
    } else {
      range.setStartAfter(lastInsertedNode);
    }
  }

  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function applyTextFormat(format, biteId, editor) {
  if (!restoreTextSelection(editor, biteId)) return;

  if (format === 'uppercase') {
    applyUppercaseSelection(editor);
  } else {
    try {
      document.execCommand('styleWithCSS', false, false);
    } catch {
      // Ignore browsers that don't expose this command.
    }
    document.execCommand(format === 'strikethrough' ? 'strikeThrough' : format, false, null);
  }

  const nextContent = getNormalizedBiteTextContent(editor.innerHTML);
  handleTextEdit(biteId, nextContent.text, nextContent.textHtml);
}

function applyUppercaseSelection(editor) {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return;

  const range = selection.getRangeAt(0);
  if (range.collapsed || !isRangeInsideEditor(editor, range)) return;

  for (const { node, startOffset, endOffset } of getSelectedTextNodes(range)) {
    const text = node.textContent || '';
    node.textContent = `${text.slice(0, startOffset)}${text.slice(startOffset, endOffset).toUpperCase()}${text.slice(endOffset)}`;
  }
}

function getSelectedTextNodes(range) {
  const root = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
    ? range.commonAncestorContainer.parentNode
    : range.commonAncestorContainer;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }
  });
  const nodes = [];
  let currentNode = walker.nextNode();

  while (currentNode) {
    nodes.push({
      node: currentNode,
      startOffset: currentNode === range.startContainer ? range.startOffset : 0,
      endOffset: currentNode === range.endContainer ? range.endOffset : (currentNode.textContent || '').length
    });
    currentNode = walker.nextNode();
  }

  return nodes.filter(({ startOffset, endOffset }) => endOffset > startOffset);
}

function getNormalizedBiteTextContent(rawHtml, options = {}) {
  const normalizedHtml = options.capitalize
    ? capitalizeRichTextHtml(normalizeRichTextHtml(rawHtml))
    : normalizeRichTextHtml(rawHtml);
  const plainText = getPlainTextFromRichTextHtml(normalizedHtml);

  if (!hasTextContent(plainText)) {
    return {
      text: '',
      textHtml: ''
    };
  }

  return {
    text: plainText,
    textHtml: normalizedHtml
  };
}

function getBiteTextHtml(bite) {
  if (typeof bite.textHtml === 'string' && bite.textHtml) {
    return normalizeRichTextHtml(bite.textHtml);
  }

  return plainTextToRichTextHtml(bite.text);
}

function plainTextToRichTextHtml(value) {
  const text = String(value || '').replace(/\r\n/g, '\n');
  return hasTextContent(text) ? escapeHtml(text).replace(/\n/g, '<br>') : '';
}

function getPlainTextFromRichTextHtml(html) {
  const template = document.createElement('template');
  template.innerHTML = String(html || '');
  return readPlainTextFromNode(template.content).replace(/\u00a0/g, ' ');
}

function readPlainTextFromNode(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent || '';
  }

  if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
    return '';
  }

  if (node.nodeType === Node.ELEMENT_NODE && node.tagName.toLowerCase() === 'br') {
    return '\n';
  }

  return Array.from(node.childNodes).map(readPlainTextFromNode).join('');
}

function normalizeRichTextHtml(html) {
  const template = document.createElement('template');
  template.innerHTML = String(html || '');
  const normalizedHtml = serializeRichTextFragment(template.content);
  return hasTextContent(getPlainTextFromRichTextHtml(normalizedHtml)) ? normalizedHtml : '';
}

function serializeRichTextFragment(root) {
  const nodes = Array.from(root.childNodes);
  const parts = [];

  for (const [index, node] of nodes.entries()) {
    const serializedNode = serializeRichTextNode(node);
    if (serializedNode) {
      parts.push(serializedNode);
    }
    if (isBlockRichTextNode(node) && index < nodes.length - 1) {
      parts.push('<br>');
    }
  }

  return parts.join('');
}

function serializeRichTextNode(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    return escapeHtml((node.textContent || '').replace(/\u00a0/g, ' '));
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }

  const tagName = node.tagName.toLowerCase();
  if (tagName === 'br') {
    return '<br>';
  }

  if (['script', 'style', 'iframe', 'object', 'embed', 'meta', 'link'].includes(tagName)) {
    return '';
  }

  const content = serializeRichTextFragment(node);
  if (isBlockRichTextNode(node)) {
    return content;
  }

  return wrapRichTextContent(content, readRichTextFormats(node));
}

function readRichTextFormats(node) {
  const tagName = node.tagName.toLowerCase();
  const fontWeight = String(node.style.fontWeight || '').toLowerCase();
  const numericWeight = Number.parseInt(fontWeight, 10);
  const textDecoration = `${node.style.textDecoration || ''} ${node.style.textDecorationLine || ''}`.toLowerCase();

  return {
    bold: tagName === 'b'
      || tagName === 'strong'
      || fontWeight === 'bold'
      || (!Number.isNaN(numericWeight) && numericWeight >= 600),
    underline: tagName === 'u' || textDecoration.includes('underline'),
    strikethrough: ['s', 'strike', 'del'].includes(tagName) || textDecoration.includes('line-through'),
    uppercase: node.classList.contains('text-transform-uppercase')
      || String(node.style.textTransform || '').toLowerCase() === 'uppercase'
  };
}

function wrapRichTextContent(content, formats) {
  if (!content) return '';
  if (content === '<br>') return content;

  let wrapped = content;
  if (formats.bold) {
    wrapped = `<strong>${wrapped}</strong>`;
  }
  if (formats.underline) {
    wrapped = `<u>${wrapped}</u>`;
  }
  if (formats.strikethrough) {
    wrapped = `<s>${wrapped}</s>`;
  }
  if (formats.uppercase) {
    wrapped = `<span class="text-transform-uppercase">${wrapped}</span>`;
  }

  return wrapped;
}

function isBlockRichTextNode(node) {
  return node.nodeType === Node.ELEMENT_NODE
    && ['address', 'article', 'aside', 'blockquote', 'div', 'figcaption', 'figure', 'footer', 'header', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'ul'].includes(node.tagName.toLowerCase());
}

function capitalizeRichTextHtml(html) {
  const template = document.createElement('template');
  template.innerHTML = String(html || '');
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  let currentNode = walker.nextNode();

  while (currentNode) {
    const text = currentNode.textContent || '';
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (/\s/.test(character)) {
        continue;
      }

      if (/[a-z]/.test(character)) {
        currentNode.textContent = `${text.slice(0, index)}${character.toUpperCase()}${text.slice(index + 1)}`;
      }

      return serializeRichTextFragment(template.content);
    }
    currentNode = walker.nextNode();
  }

  return serializeRichTextFragment(template.content);
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function handleProducerNoteEdit(biteId, value) {
  const lockKey = `comment:${biteId}`;
  if (!textEditLocks.has(lockKey)) {
    pushUndoState();
    textEditLocks.add(lockKey);
  }

  const bite = state.bites.find((entry) => entry.id === biteId);
  if (!bite) return;

  const nextValue = String(value || '').replace(/\r\n/g, '\n');
  bite.comments = collapseWhitespace(nextValue) ? [nextValue] : [];
  state.saveStatus = '';
  updateDirtyState();
  renderTopControls();

  window.clearTimeout(textEditTimers.get(lockKey));
  textEditTimers.set(
    lockKey,
    window.setTimeout(() => {
      textEditLocks.delete(lockKey);
      textEditTimers.delete(lockKey);
    }, TEXT_HISTORY_IDLE_MS)
  );
}

function syncProducerNoteState(wrapper, value) {
  if (!wrapper) return;
  wrapper.classList.toggle('has-note', hasTextContent(value));
}

function syncProducerNoteDirtyState(wrapper, value) {
  if (!wrapper) return;
  const committedValue = String(wrapper.dataset.committedValue || '').replace(/\r\n/g, '\n');
  const nextValue = String(value || '').replace(/\r\n/g, '\n');
  wrapper.classList.toggle('is-dirty', nextValue !== committedValue);
}

function hasTextContent(value) {
  return Boolean(collapseWhitespace(String(value || '')));
}

function isPlainEnterSaveKey(event) {
  return event.key === 'Enter'
    && !event.shiftKey
    && !event.metaKey
    && !event.ctrlKey
    && !event.altKey
    && !event.isComposing;
}

function queueSaveSession() {
  window.setTimeout(() => {
    if (!state.hasUnsavedChanges) return;
    void saveSession();
  }, 0);
}

function handleEditableSaveOnEnter(event) {
  if (!isPlainEnterSaveKey(event)) return;
  event.preventDefault();
  event.currentTarget.blur();
  queueSaveSession();
}

function attachDragHandlers(card, biteId) {
  card.addEventListener('dragstart', (event) => {
    draggedBiteId = biteId;
    card.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', biteId);
  });

  card.addEventListener('dragend', () => {
    draggedBiteId = '';
    clearDropTargets();
    card.classList.remove('dragging');
  });

  card.addEventListener('dragover', (event) => {
    if (!draggedBiteId || draggedBiteId === biteId) return;
    event.preventDefault();
    clearDropTargets();

    const midpoint = card.getBoundingClientRect().top + card.offsetHeight / 2;
    card.classList.add(event.clientY < midpoint ? 'drop-before' : 'drop-after');
  });

  card.addEventListener('dragleave', () => {
    card.classList.remove('drop-before', 'drop-after');
  });

  card.addEventListener('drop', (event) => {
    if (!draggedBiteId || draggedBiteId === biteId) return;
    event.preventDefault();

    const sourceIndex = state.bites.findIndex((bite) => bite.id === draggedBiteId);
    const targetIndex = state.bites.findIndex((bite) => bite.id === biteId);
    const midpoint = card.getBoundingClientRect().top + card.offsetHeight / 2;
    const insertAt = event.clientY < midpoint ? targetIndex : targetIndex + 1;

    if (sourceIndex === -1 || targetIndex === -1) return;

    pushUndoState();
    const [movedBite] = state.bites.splice(sourceIndex, 1);
    const adjustedIndex = sourceIndex < insertAt ? insertAt - 1 : insertAt;
    state.bites.splice(adjustedIndex, 0, movedBite);

    state.saveStatus = '';
    clearDropTargets();
    updateDirtyState();
    render();
  });
}

function clearDropTargets() {
  for (const card of bitesList.querySelectorAll('.bite-card')) {
    card.classList.remove('drop-before', 'drop-after');
  }
}

function moveBite(fromIndex, toIndex) {
  if (toIndex < 0 || toIndex >= state.bites.length) return;
  pushUndoState();
  const [bite] = state.bites.splice(fromIndex, 1);
  state.bites.splice(toIndex, 0, bite);
  state.saveStatus = '';
  updateDirtyState();
  render();
}

function undo() {
  if (!undoStack.length) return;
  clearTextEditTracking();
  redoStack.push(createSnapshot());
  const snapshot = undoStack.pop();
  applySnapshot(snapshot);
  state.saveStatus = '';
  state.speakerStatus = '';
  updateDirtyState();
  render();
}

function redo() {
  if (!redoStack.length) return;
  clearTextEditTracking();
  undoStack.push(createSnapshot());
  const snapshot = redoStack.pop();
  applySnapshot(snapshot);
  state.saveStatus = '';
  state.speakerStatus = '';
  updateDirtyState();
  render();
}

async function saveSession() {
  if (!hasReadyWorkspace()) return;

  state.saveStatus = 'Saving...';
  renderTopControls();

  try {
    const sharedProject = await saveRemoteProject();
    applyRemoteProject(sharedProject, { preserveFilters: true });
    const snapshot = createSnapshot();
    await writeSavedSession(snapshot);
    lastSavedSignature = getSnapshotSignature(snapshot);
    state.hasUnsavedChanges = false;
    state.saveStatus = 'Saved.';
    startRemoteSync();
  } catch (error) {
    state.saveStatus = error instanceof Error ? error.message : 'Save failed.';
  }

  renderTopControls();
}

function pushUndoState() {
  clearTextEditTracking();
  undoStack.push(createSnapshot());
  if (undoStack.length > HISTORY_LIMIT) {
    undoStack.shift();
  }
  redoStack.length = 0;
}

function createSnapshot() {
  return {
    audioBlob: state.audioBlob,
    audioFileName: state.audioFileName,
    audioFingerprint: state.audioFingerprint,
    audioNeedsRemoteSync: state.audioNeedsRemoteSync,
    audioRemoteUrl: state.audioRemoteUrl,
    transcriptFileName: state.transcriptFileName,
    transcriptWarning: state.transcriptWarning,
    projectName: state.projectName,
    projectNameDraft: state.projectNameDraft,
    shareProjectId: state.shareProjectId,
    remoteVersion: state.remoteVersion,
    speakerEditorOpen: state.speakerEditorOpen,
    activeFilters: [...state.activeFilters],
    speakerAssignments: state.speakerAssignments.map(cloneSpeakerAssignment),
    bites: state.bites.map(cloneBite)
  };
}

function applySnapshot(snapshot) {
  setAudioSource(
    snapshot.audioBlob || null,
    snapshot.audioFileName || '',
    snapshot.audioRemoteUrl || '',
    snapshot.audioFingerprint || snapshot.audioFileName || ''
  );
  state.audioNeedsRemoteSync = snapshot.audioNeedsRemoteSync === true;
  state.transcriptFileName = snapshot.transcriptFileName || '';
  state.transcriptWarning = snapshot.transcriptWarning || '';
  state.projectName = snapshot.projectName || '';
  state.projectNameDraft = snapshot.projectNameDraft || '';
  state.shareProjectId = snapshot.shareProjectId || '';
  state.remoteVersion = Math.max(0, Number(snapshot.remoteVersion) || 0);
  state.speakerEditorOpen = snapshot.speakerEditorOpen ?? true;
  state.activeFilters = Array.isArray(snapshot.activeFilters)
    ? snapshot.activeFilters.filter((value) => FILTER_VALUES.includes(value))
    : [];
  state.bites = (snapshot.bites || []).map(normalizeLoadedBite);
  state.speakerAssignments = buildSpeakerAssignments(state.bites, (snapshot.speakerAssignments || []).map(cloneSpeakerAssignment));
  if (state.shareProjectId) {
    startRemoteSync();
  } else {
    stopRemoteSync();
  }
}

function cloneBite(bite) {
  const textContent = typeof bite?.textHtml === 'string' && bite.textHtml
    ? getNormalizedBiteTextContent(bite.textHtml)
    : {
        text: String(bite?.text || '').replace(/\r\n/g, '\n'),
        textHtml: plainTextToRichTextHtml(bite?.text || '')
      };

  return {
    id: bite.id,
    startSeconds: bite.startSeconds,
    endSeconds: bite.endSeconds,
    text: textContent.text,
    textHtml: textContent.textHtml,
    tone: bite.tone,
    speakerKey: bite.speakerKey || '',
    speakerLabel: bite.speakerLabel || '',
    comments: Array.isArray(bite.comments) ? bite.comments.map((entry) => String(entry || '')) : []
  };
}

function normalizeLoadedBite(bite) {
  const clonedBite = cloneBite(bite);
  const normalizedText = clonedBite.textHtml
    ? getNormalizedBiteTextContent(clonedBite.textHtml, { capitalize: true })
    : {
        text: capitalizeSoundbite(clonedBite.text),
        textHtml: plainTextToRichTextHtml(capitalizeSoundbite(clonedBite.text))
      };
  const normalizedBite = {
    ...clonedBite,
    text: normalizedText.text,
    textHtml: normalizedText.textHtml
  };

  if (normalizedBite.speakerKey || !normalizedBite.text) {
    return normalizedBite;
  }

  const speakerInfo = extractSpeakerInfo(normalizedBite.text);
  const speakerText = capitalizeSoundbite(speakerInfo.text);
  if (speakerText === normalizedBite.text) {
    return {
      ...normalizedBite,
      speakerKey: speakerInfo.speakerKey,
      speakerLabel: speakerInfo.speakerLabel
    };
  }

  return {
    ...normalizedBite,
    text: speakerText,
    textHtml: plainTextToRichTextHtml(speakerText),
    speakerKey: speakerInfo.speakerKey,
    speakerLabel: speakerInfo.speakerLabel
  };
}

function cloneSpeakerAssignment(assignment) {
  return {
    key: assignment.key,
    label: assignment.label,
    name: assignment.name,
    draft: assignment.draft
  };
}

function updateDirtyState() {
  state.hasUnsavedChanges = getSnapshotSignature(createSnapshot()) !== lastSavedSignature;
}

function getSnapshotSignature(snapshot) {
  return JSON.stringify({
    hasAudio: Boolean(snapshot.audioBlob || snapshot.audioRemoteUrl),
    audioFileName: snapshot.audioFileName,
    audioFingerprint: snapshot.audioFingerprint,
    audioRemoteUrl: snapshot.audioRemoteUrl,
    transcriptFileName: snapshot.transcriptFileName,
    transcriptWarning: snapshot.transcriptWarning,
    projectName: snapshot.projectName,
    projectNameDraft: snapshot.projectNameDraft,
    shareProjectId: snapshot.shareProjectId,
    speakerEditorOpen: snapshot.speakerEditorOpen,
    activeFilters: snapshot.activeFilters,
    speakerAssignments: snapshot.speakerAssignments.map((assignment) => ({
      key: assignment.key,
      label: assignment.label,
      name: assignment.name,
      draft: assignment.draft
    })),
    bites: snapshot.bites.map((bite) => ({
      id: bite.id,
      startSeconds: bite.startSeconds,
      endSeconds: bite.endSeconds,
      text: bite.text,
      textHtml: bite.textHtml || '',
      tone: bite.tone,
      speakerKey: bite.speakerKey,
      speakerLabel: bite.speakerLabel,
      comments: Array.isArray(bite.comments) ? bite.comments.map((entry) => String(entry || '')) : []
    }))
  });
}

function clearTextEditTracking() {
  for (const timerId of textEditTimers.values()) {
    window.clearTimeout(timerId);
  }
  textEditTimers.clear();
  textEditLocks.clear();
  textSelectionRanges.clear();
  activeTextEditorId = '';
}

function hasReadyWorkspace() {
  return Boolean(state.audioUrl) && Boolean(state.transcriptFileName);
}

async function restoreSavedSession() {
  try {
    const snapshot = await readSavedSession();
    if (!snapshot) return false;
    applySnapshot(snapshot);
    lastSavedSignature = getSnapshotSignature(createSnapshot());
    state.hasUnsavedChanges = false;
    return true;
  } catch {
    return false;
  }
}

async function shareProjectLink() {
  try {
    if (!state.shareProjectId) {
      if (!hasReadyWorkspace()) return;
      const sharedProject = await saveRemoteProject();
      applyRemoteProject(sharedProject, { preserveFilters: true });
      const snapshot = createSnapshot();
      await writeSavedSession(snapshot);
      lastSavedSignature = getSnapshotSignature(snapshot);
      state.hasUnsavedChanges = false;
      startRemoteSync();
      renderTopControls();
    }

    const shareUrl = buildShareUrl(state.shareProjectId);
    openShareDialog(shareUrl);
  } catch (error) {
    window.alert(error instanceof Error ? error.message : 'Could not create share link.');
  }
}

function renderShareDialog() {
  shareDialog.classList.toggle('hidden', !isShareDialogOpen);
  document.body.classList.toggle('dialog-open', isShareDialogOpen || isStartOverDialogOpen);
  shareDialogLink.value = shareDialogUrl;
}

function openShareDialog(url) {
  shareDialogUrl = url;
  isShareDialogOpen = true;
  lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  renderShareDialog();
  window.requestAnimationFrame(() => {
    shareDialogCopyBtn.focus();
  });
}

function closeShareDialog() {
  if (!isShareDialogOpen) return;
  isShareDialogOpen = false;
  renderShareDialog();
  if (lastFocusedElement instanceof HTMLElement) {
    lastFocusedElement.focus();
  }
}

async function copyShareDialogLink() {
  if (!shareDialogUrl) return;
  await copyTextToClipboard(shareDialogUrl);
}

function renderStartOverDialog() {
  startOverDialog.classList.toggle('hidden', !isStartOverDialogOpen);
  document.body.classList.toggle('dialog-open', isShareDialogOpen || isStartOverDialogOpen);
}

function openStartOverDialog() {
  isStartOverDialogOpen = true;
  lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  renderStartOverDialog();
  window.requestAnimationFrame(() => {
    startOverDialogConfirmBtn.focus();
  });
}

function closeStartOverDialog() {
  if (!isStartOverDialogOpen) return;
  isStartOverDialogOpen = false;
  renderStartOverDialog();
  if (lastFocusedElement instanceof HTMLElement) {
    lastFocusedElement.focus();
  }
}

async function confirmStartOver() {
  closeStartOverDialog();
  await resetWorkspace();
}

async function copyTextToClipboard(value) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall back to execCommand below.
  }

  const helper = document.createElement('textarea');
  helper.value = value;
  helper.setAttribute('readonly', '');
  helper.style.position = 'fixed';
  helper.style.top = '0';
  helper.style.left = '0';
  helper.style.opacity = '0';
  helper.style.pointerEvents = 'none';
  document.body.append(helper);
  helper.select();
  helper.setSelectionRange(0, helper.value.length);

  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    helper.remove();
  }
}

async function downloadTranscriptPdf() {
  if (!hasReadyWorkspace()) return;

  const pdfBytes = buildTranscriptPdfBytes();
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  const downloadUrl = URL.createObjectURL(blob);
  const downloadLink = document.createElement('a');

  downloadLink.href = downloadUrl;
  downloadLink.download = buildTranscriptPdfFileName();
  document.body.append(downloadLink);
  downloadLink.click();
  downloadLink.remove();

  window.setTimeout(() => {
    URL.revokeObjectURL(downloadUrl);
  }, 1_000);
}

function buildTranscriptPdfFileName() {
  const title = collapseWhitespace(state.projectNameDraft)
    || collapseWhitespace(state.projectName)
    || stripFileExtension(state.transcriptFileName)
    || 'transcript';
  return `${sanitizeFileName(title)}.pdf`;
}

function buildTranscriptPdfBytes() {
  const measureText = createPdfMeasureText();
  const title = collapseWhitespace(state.projectNameDraft)
    || collapseWhitespace(state.projectName)
    || stripFileExtension(state.transcriptFileName)
    || 'Transcript';
  const bites = state.bites.map((bite) => ({
    timeLabel: formatTimeRange(bite),
    speakerName: getSpeakerDisplayName(bite),
    text: capitalizeSoundbite(bite.text),
    tone: bite.tone,
    comments: Array.isArray(bite.comments) ? bite.comments : []
  }));

  return createTranscriptPdfBytes(
    {
      title,
      exportDate: new Date(),
      bites
    },
    { measureText }
  );
}

function createPdfMeasureText() {
  const canvas = document.createElement('canvas');
  const measureContext = canvas.getContext('2d');

  if (!measureContext) {
    return (text, fontSize, fontWeight) => {
      const widthMultiplier = fontWeight === '700' ? 0.58 : 0.53;
      return String(text || '').length * fontSize * widthMultiplier;
    };
  }

  return (text, fontSize, fontWeight) => {
    measureContext.font = `${fontWeight} ${fontSize}px Helvetica, Arial, sans-serif`;
    return measureContext.measureText(String(text || '')).width;
  };
}

function stripFileExtension(fileName) {
  return String(fileName || '').replace(/\.[^.]+$/, '');
}

function sanitizeFileName(value) {
  return String(value || 'transcript')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
    || 'transcript';
}

function buildRemoteProjectPayload() {
  return {
    projectName: collapseWhitespace(state.projectNameDraft) || collapseWhitespace(state.projectName) || deriveProjectName(state.audioFileName) || 'Untitled Project',
    transcriptFileName: state.transcriptFileName,
    transcriptWarning: state.transcriptWarning,
    speakerEditorOpen: state.speakerEditorOpen,
    speakerAssignments: state.speakerAssignments.map(cloneSpeakerAssignment),
    bites: state.bites.map(cloneBite)
  };
}

async function saveRemoteProject() {
  let projectId = state.shareProjectId;
  if (!projectId) {
    const createResponse = await fetch('/api/interview-projects', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });
    const created = await parseJsonResponse(createResponse, 'Could not create shared project.');
    projectId = String(created?.project?.id || '').trim();
    if (!projectId) {
      throw new Error('Could not create shared project.');
    }
    state.shareProjectId = projectId;
    replaceUrlWithSharedProjectId(projectId);
  }

  if (state.audioBlob && state.audioNeedsRemoteSync) {
    const uploadUrl = `/api/interview-projects/${encodeURIComponent(projectId)}/audio?filename=${encodeURIComponent(state.audioFileName || 'audio')}`;
    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': state.audioBlob.type || 'application/octet-stream'
      },
      body: state.audioBlob
    });
    if (!uploadResponse.ok) {
      throw new Error('Could not upload interview audio.');
    }
  }

  const saveResponse = await fetch(`/api/interview-projects/${encodeURIComponent(projectId)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(buildRemoteProjectPayload())
  });
  const payload = await parseJsonResponse(saveResponse, 'Could not save shared project.');
  return payload?.project;
}

async function loadRemoteProject(projectId) {
  try {
    const project = await fetchRemoteProject(projectId);
    applyRemoteProject(project, { preserveFilters: true });
    lastSavedSignature = getSnapshotSignature(createSnapshot());
    state.hasUnsavedChanges = false;
    return true;
  } catch (error) {
    state.saveStatus = error instanceof Error ? error.message : 'Could not load shared project.';
    return false;
  }
}

async function fetchRemoteProject(projectId) {
  const response = await fetch(`/api/interview-projects/${encodeURIComponent(projectId)}`);
  const payload = await parseJsonResponse(response, 'Could not load shared project.');
  if (!payload?.project) {
    throw new Error('Shared project not found.');
  }
  return payload.project;
}

function applyRemoteProject(project, { preserveFilters = false } = {}) {
  const preservedFilters = preserveFilters ? [...state.activeFilters] : [];
  const normalizedProjectName = collapseWhitespace(project?.projectName) || deriveProjectName(project?.audioFileName) || 'Untitled Project';
  const projectId = String(project?.id || '').trim();
  const remoteVersion = Math.max(0, Number(project?.version) || 0);
  const remoteAudioUrl = projectId && project?.audioAvailable
    ? buildRemoteAudioUrl(projectId, remoteVersion)
    : '';

  setAudioSource(null, project?.audioFileName || state.audioFileName, remoteAudioUrl, `${projectId}:${remoteVersion}:${project?.audioFileName || ''}`);
  state.audioNeedsRemoteSync = false;
  state.shareProjectId = projectId;
  state.remoteVersion = remoteVersion;
  state.transcriptFileName = String(project?.transcriptFileName || '').trim();
  state.transcriptWarning = String(project?.transcriptWarning || '').trim();
  state.projectName = normalizedProjectName;
  state.projectNameDraft = normalizedProjectName;
  state.speakerEditorOpen = project?.speakerEditorOpen !== false;
  state.bites = Array.isArray(project?.bites) ? project.bites.map(normalizeLoadedBite) : [];
  state.speakerAssignments = buildSpeakerAssignments(
    state.bites,
    Array.isArray(project?.speakerAssignments) ? project.speakerAssignments.map(cloneSpeakerAssignment) : []
  );
  state.speakerStatus = '';
  state.saveStatus = '';
  if (preserveFilters) {
    state.activeFilters = preservedFilters;
  }
  if (projectId) {
    replaceUrlWithSharedProjectId(projectId);
  }
}

function startRemoteSync() {
  stopRemoteSync();
  if (!state.shareProjectId) return;
  remoteSyncTimerId = window.setInterval(() => {
    void pollRemoteProject();
  }, REMOTE_SYNC_INTERVAL_MS);
}

function stopRemoteSync() {
  if (!remoteSyncTimerId) return;
  window.clearInterval(remoteSyncTimerId);
  remoteSyncTimerId = 0;
}

async function pollRemoteProject() {
  if (remoteSyncInFlight || !state.shareProjectId || state.hasUnsavedChanges) return;
  remoteSyncInFlight = true;
  try {
    const project = await fetchRemoteProject(state.shareProjectId);
    const remoteVersion = Math.max(0, Number(project?.version) || 0);
    if (remoteVersion > state.remoteVersion) {
      applyRemoteProject(project, { preserveFilters: true });
      lastSavedSignature = getSnapshotSignature(createSnapshot());
      state.hasUnsavedChanges = false;
      state.saveStatus = 'Changes synced.';
      render();
    }
  } catch {
    // Ignore transient polling errors.
  } finally {
    remoteSyncInFlight = false;
  }
}

function readSharedProjectIdFromUrl() {
  const url = new URL(window.location.href);
  return String(url.searchParams.get('project') || '').trim();
}

function replaceUrlWithSharedProjectId(projectId) {
  const url = new URL(window.location.href);
  url.searchParams.set('project', projectId);
  window.history.replaceState({}, '', url);
}

function clearSharedProjectIdFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete('project');
  window.history.replaceState({}, '', url);
}

function buildShareUrl(projectId) {
  const url = new URL(window.location.href);
  url.searchParams.set('project', projectId);
  return url.toString();
}

function buildRemoteAudioUrl(projectId, version) {
  return `/api/interview-projects/${encodeURIComponent(projectId)}/audio?v=${encodeURIComponent(String(version || 0))}`;
}

function buildAudioFingerprint(file) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

async function parseJsonResponse(response, fallbackMessage) {
  const payload = safeJsonParse(await response.text(), {});
  if (response.ok) {
    return payload;
  }
  throw new Error(String(payload?.error || fallbackMessage || 'Request failed.'));
}

function safeJsonParse(raw, fallback = {}) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function openSessionDb() {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(SESSION_DB_NAME, 1);

    request.addEventListener('upgradeneeded', () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SESSION_STORE_NAME)) {
        database.createObjectStore(SESSION_STORE_NAME);
      }
    });

    request.addEventListener('success', () => {
      resolve(request.result);
    });

    request.addEventListener('error', () => {
      reject(request.error);
    });
  });
}

async function readSavedSession() {
  const database = await openSessionDb();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(SESSION_STORE_NAME, 'readonly');
    const store = transaction.objectStore(SESSION_STORE_NAME);
    const request = store.get(SESSION_RECORD_KEY);

    request.addEventListener('success', () => {
      resolve(request.result || null);
    });

    request.addEventListener('error', () => {
      reject(request.error);
    });
  });
}

async function writeSavedSession(snapshot) {
  const database = await openSessionDb();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(SESSION_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(SESSION_STORE_NAME);
    const request = store.put(snapshot, SESSION_RECORD_KEY);

    request.addEventListener('success', () => {
      resolve();
    });

    request.addEventListener('error', () => {
      reject(request.error);
    });
  });
}

async function clearSavedSession() {
  const database = await openSessionDb();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(SESSION_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(SESSION_STORE_NAME);
    const request = store.delete(SESSION_RECORD_KEY);

    request.addEventListener('success', () => {
      resolve();
    });

    request.addEventListener('error', () => {
      reject(request.error);
    });
  });
}

function parseTranscript(rawText) {
  const normalizedText = rawText.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();

  if (!normalizedText) {
    return {
      bites: [],
      warning: 'The transcript file was empty.'
    };
  }

  const timedBlocks = parseTimedBlocks(normalizedText);
  if (timedBlocks.length > 0) {
    return {
      bites: timedBlocks.map(createBite),
      warning: ''
    };
  }

  const paragraphBlocks = normalizedText
    .split(/\n{2,}/)
    .map((block) => collapseWhitespace(block))
    .filter(Boolean);

  return {
    bites: paragraphBlocks.map((text) =>
      createBite({
        startSeconds: null,
        endSeconds: null,
        text
      })
    ),
    warning: 'No timecodes were detected, so the transcript was split into paragraph bites.'
  };
}

function parseTimedBlocks(text) {
  const bites = [];
  const blockList = text.split(/\n{2,}/);

  for (const block of blockList) {
    const lines = block
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    if (!lines.length || lines[0] === 'WEBVTT') continue;

    const adjustedLines = [...lines];
    if (/^\d+$/.test(adjustedLines[0]) && adjustedLines[1] && hasTimingRange(adjustedLines[1])) {
      adjustedLines.shift();
    }

    if (adjustedLines[0] && hasTimingRange(adjustedLines[0])) {
      const timing = parseTimingRange(adjustedLines[0]);
      const cueText = cleanCueText(adjustedLines.slice(1).join(' '));
      if (timing && cueText) {
        bites.push({
          startSeconds: timing.startSeconds,
          endSeconds: timing.endSeconds,
          text: cueText
        });
      }
      continue;
    }

    const parsedInline = parseInlineTimedLines(adjustedLines);
    if (parsedInline.length > 0) {
      bites.push(...parsedInline);
    }
  }

  return bites;
}

function parseInlineTimedLines(lines) {
  const bites = [];
  let currentBite = null;

  for (const line of lines) {
    const timedLineMatch = line.match(/^(?:\d+\s*[-–—]\s*)?\[?((?:\d{1,2}:)?\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)\]?(?:\s*(?:-->|[-–—])\s*\[?((?:\d{1,2}:)?\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)\]?)?(?:\s*(?:[-–—:])\s*|\s+)?(.*)$/);

    if (timedLineMatch) {
      if (currentBite && currentBite.text) {
        bites.push(currentBite);
      }

      currentBite = {
        startSeconds: parseTimestamp(timedLineMatch[1]),
        endSeconds: parseTimestamp(timedLineMatch[2]),
        text: cleanCueText(timedLineMatch[3] || '')
      };
      continue;
    }

    if (!currentBite) {
      return [];
    }

    currentBite.text = cleanCueText(`${currentBite.text} ${line}`);
  }

  if (currentBite && currentBite.text) {
    bites.push(currentBite);
  }

  return bites;
}

function hasTimingRange(value) {
  return /^\s*(?:\d{1,2}:)?\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?\s*(?:-->|[-–—])\s*(?:\d{1,2}:)?\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?\s*$/.test(value);
}

function parseTimingRange(value) {
  const match = value.match(/^\s*((?:\d{1,2}:)?\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)\s*(?:-->|[-–—])\s*((?:\d{1,2}:)?\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)\s*$/);
  if (!match) return null;

  return {
    startSeconds: parseTimestamp(match[1]),
    endSeconds: parseTimestamp(match[2])
  };
}

function parseTimestamp(value) {
  if (!value) return null;

  const normalized = value.replace(',', '.').trim();
  const parts = normalized.split(':');
  if (parts.length < 2 || parts.length > 4) return null;

  const numericParts = parts.map((part) => Number(part));
  if (numericParts.some((part) => Number.isNaN(part))) return null;

  if (numericParts.length === 2) {
    return numericParts[0] * 60 + numericParts[1];
  }

  if (numericParts.length === 4) {
    return numericParts[0] * 3600 + numericParts[1] * 60 + numericParts[2];
  }

  return numericParts[0] * 3600 + numericParts[1] * 60 + numericParts[2];
}

function formatTimeRange(bite) {
  if (bite.startSeconds == null && bite.endSeconds == null) return 'No timecode';
  const startLabel = bite.startSeconds == null ? '00:00' : formatTimestamp(bite.startSeconds);
  const endLabel = bite.endSeconds == null ? startLabel : formatTimestamp(bite.endSeconds);
  return `${startLabel} - ${endLabel}`;
}

function formatTimestamp(totalSeconds) {
  const safeSeconds = Math.max(0, Number(totalSeconds) || 0);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = Math.floor(safeSeconds % 60);

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function collapseWhitespace(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function cleanCueText(value) {
  return capitalizeSoundbite(
    collapseWhitespace(
      value
        .replace(/^\s*\d+\s*[-–—]\s*\d{1,2}:\d{2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?\s*/, '')
        .replace(/^\s*\d{1,2}:\d{2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?\s*[-–—:]\s*/, '')
    )
  );
}

function capitalizeSoundbite(value) {
  const text = String(value || '');
  const match = text.match(/^(\s*)([a-z])(.*)$/s);
  if (!match) return text;

  return `${match[1]}${match[2].toUpperCase()}${match[3]}`;
}

function describeUploadFailure(error, fallbackMessage) {
  const message = collapseWhitespace(String(error?.message || ''));
  return message || fallbackMessage;
}

function createBite({ startSeconds, endSeconds, text }) {
  const speakerInfo = extractSpeakerInfo(text);
  const biteText = capitalizeSoundbite(speakerInfo.text);
  return {
    id: makeId('bite'),
    startSeconds,
    endSeconds,
    text: biteText,
    textHtml: plainTextToRichTextHtml(biteText),
    tone: 'none',
    speakerKey: speakerInfo.speakerKey,
    speakerLabel: speakerInfo.speakerLabel,
    comments: []
  };
}

function extractSpeakerInfo(rawText) {
  const text = collapseWhitespace(rawText);
  if (!text) {
    return { text: '', speakerKey: '', speakerLabel: '' };
  }

  const speakerMatch = text.match(/^((?:speaker|spk)\s*(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten))\b(?:\s*[:\-]\s*|\s+)(.+)$/i);
  if (speakerMatch) {
    const label = formatSpeakerLabel(speakerMatch[1]);
    return {
      text: collapseWhitespace(speakerMatch[2]),
      speakerKey: normalizeSpeakerKey(label),
      speakerLabel: label
    };
  }

  const roleMatch = text.match(/^((?:producer|host|interviewer|interviewee|guest|narrator))\b(?:\s*[:\-]\s*|\s+)(.+)$/i);
  if (roleMatch) {
    const label = formatSpeakerLabel(roleMatch[1]);
    return {
      text: collapseWhitespace(roleMatch[2]),
      speakerKey: normalizeSpeakerKey(label),
      speakerLabel: label
    };
  }

  const namedColonMatch = text.match(/^([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2})\s*:\s*(.+)$/);
  if (namedColonMatch) {
    const label = collapseWhitespace(namedColonMatch[1]);
    return {
      text: collapseWhitespace(namedColonMatch[2]),
      speakerKey: normalizeSpeakerKey(label),
      speakerLabel: label
    };
  }

  return {
    text,
    speakerKey: '',
    speakerLabel: ''
  };
}

function buildSpeakerAssignments(bites, existingAssignments = []) {
  const existingMap = new Map(existingAssignments.map((assignment) => [assignment.key, assignment]));
  const orderedAssignments = [];
  const seenKeys = new Set();

  for (const bite of bites) {
    if (!bite.speakerKey || seenKeys.has(bite.speakerKey)) continue;
    seenKeys.add(bite.speakerKey);
    if (orderedAssignments.length >= MAX_SPEAKERS) break;

    const existingAssignment = existingMap.get(bite.speakerKey);
    orderedAssignments.push({
      key: bite.speakerKey,
      label: bite.speakerLabel,
      name: existingAssignment?.name || bite.speakerLabel,
      draft: existingAssignment?.draft || existingAssignment?.name || bite.speakerLabel
    });
  }

  return orderedAssignments;
}

function deriveProjectName(fileName) {
  return String(fileName || '').replace(/\.[^.]+$/, '').trim();
}

function normalizeSpeakerKey(value) {
  return collapseWhitespace(String(value || '')).toLowerCase();
}

function formatSpeakerLabel(value) {
  return collapseWhitespace(String(value || '')).replace(/\b\w/g, (char) => char.toUpperCase());
}
