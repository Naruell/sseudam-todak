"use strict";

const DATA_ROOT = "../Data";
const SOUND_ROOT = "../Sound";
const STORAGE_KEY = "sseudam-todak-settings-v1";

const state = {
  config: { minIntervalMultiply: 1, maxIntervalMultiply: 2, durations: [30] },
  sounds: new Map(),
  files: new Map(),
  tracks: [],
  selectedTrack: null,
  mode: "random",
  intervalMultiply: 1,
  durationMinutes: 30,
  fixedFiles: {},
  volume: 1,
  timeline: [],
  audioContext: null,
  masterGain: null,
  buffers: new Map(),
  activeSources: new Set(),
  playing: false,
  position: 0,
  anchorPosition: 0,
  anchorContextTime: 0,
  scheduler: null,
  nextEventIndex: 0,
  sessionKey: "",
  seeking: false,
  seekWasPlaying: false,
  previewSource: null,
  previewKey: "",
  previewResumePlayback: false,
  previewToken: 0,
  choiceKind: "speed",
};

const el = {};
let toastTimer;

document.addEventListener("DOMContentLoaded", init);

async function init() {
  cacheElements();
  bindEvents();
  try {
    const [configRows, soundRows, trackRows, fileRows] = await Promise.all([
      loadCsv(`${DATA_ROOT}/Config.csv`),
      loadCsv(`${DATA_ROOT}/Sounds.csv`),
      loadCsv(`${DATA_ROOT}/Tracks.csv`),
      loadCsv(`${DATA_ROOT}/Files.csv`),
    ]);
    applyData(configRows, soundRows, trackRows, fileRows);
    restoreSettings();
    render();
  } catch (error) {
    console.error(error);
    showToast("데이터를 불러오지 못했습니다. 웹 서버 주소로 열어주세요.", 5000);
  }
}

function cacheElements() {
  ["emptySettings", "settingsContent", "selectedTrackName", "modeToggle", "playModeDescription",
    "globalSettingsButton", "trackSounds", "trackList", "blackoutButton", "blackoutScreen",
    "playButton", "progressSlider", "elapsedTime", "totalTime", "speedControl", "durationControl",
    "settingsDialog", "fixedFileSettings", "volumeSlider", "choiceDialog", "choiceTitle", "choiceOptions", "toast"].forEach((id) => { el[id] = document.getElementById(id); });
}

function bindEvents() {
  el.playButton.addEventListener("click", togglePlayback);
  el.modeToggle.addEventListener("click", toggleMode);
  el.globalSettingsButton.addEventListener("click", openGlobalSettings);
  el.blackoutButton.addEventListener("click", () => { el.blackoutScreen.hidden = false; });
  el.blackoutScreen.addEventListener("click", () => { el.blackoutScreen.hidden = true; });
  el.speedControl.addEventListener("click", () => openChoiceDialog("speed"));
  el.durationControl.addEventListener("click", () => openChoiceDialog("duration"));
  el.choiceOptions.addEventListener("click", handleChoiceClick);
  el.progressSlider.addEventListener("pointerdown", beginSeek);
  el.progressSlider.addEventListener("input", previewSeek);
  el.progressSlider.addEventListener("change", commitSeek);
  el.fixedFileSettings.addEventListener("change", saveFixedFile);
  el.fixedFileSettings.addEventListener("click", handlePreviewClick);
  el.volumeSlider.addEventListener("input", applyVolume);
  el.settingsDialog.addEventListener("close", () => stopPreview(true));
  document.addEventListener("visibilitychange", () => { if (!document.hidden && state.playing) tick(); });
}

async function loadCsv(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return parseCsv(await response.text());
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field.trim()); field = ""; }
    else if (char === "\n") { row.push(field.trim()); if (row.some(Boolean)) rows.push(row); row = []; field = ""; }
    else if (char !== "\r") field += char;
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function applyData(configRows, soundRows, trackRows, fileRows) {
  const config = Object.fromEntries(configRows.map(([key, value]) => [key, value]));
  state.config.minIntervalMultiply = numberOr(config.MinIntervalMultiply, 1);
  state.config.maxIntervalMultiply = numberOr(config.MaxIntervalMultiply, 2);
  state.config.durations = String(config.TimeRserveMinutes || "30").split(",").map(Number).filter((n) => n > 0);
  state.sounds = new Map(soundRows.filter((row) => row.length >= 2).map(([id, seconds]) => [id, numberOr(seconds, 5)]));
  state.files = new Map(fileRows.filter((row) => row.length >= 3).map(([id, folder, files]) => [id, {
    folder,
    names: files.split(",").map((file) => file.trim()).filter(Boolean),
  }]));
  state.tracks = trackRows.filter((row) => row.length >= 3 && row[1] && row[2]).map(([id, name, sounds]) => ({ id, name, sounds: sounds.split(",").map((sound) => sound.trim()).filter(Boolean) }));
}

function restoreSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch { saved = {}; }
  state.mode = saved.mode === "fixed" ? "fixed" : "random";
  state.intervalMultiply = clamp(numberOr(saved.intervalMultiply, 1), state.config.minIntervalMultiply, state.config.maxIntervalMultiply);
  state.durationMinutes = state.config.durations.includes(Number(saved.durationMinutes)) ? Number(saved.durationMinutes) : (state.config.durations.includes(30) ? 30 : state.config.durations[0]);
  state.fixedFiles = saved.fixedFiles && typeof saved.fixedFiles === "object" ? saved.fixedFiles : {};
  state.volume = clamp(numberOr(saved.volume, 1), 0, 2);
  for (const [soundId, entry] of state.files) {
    if (!entry.names.includes(state.fixedFiles[soundId])) state.fixedFiles[soundId] = entry.names[0] || "";
  }
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    mode: state.mode,
    intervalMultiply: state.intervalMultiply,
    durationMinutes: state.durationMinutes,
    fixedFiles: state.fixedFiles,
    volume: state.volume,
  }));
}

function render() {
  renderTracks();
  renderSpeedOptions();
  renderDurationOptions();
  renderFixedFileSettings();
  el.volumeSlider.value = state.volume;
  updateTrackSettings();
  updatePlayer();
}

function renderTracks() {
  el.trackList.replaceChildren(...state.tracks.map((track) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "track-button";
    button.dataset.trackId = track.id;
    button.setAttribute("aria-current", String(state.selectedTrack?.id === track.id));
    const number = document.createElement("small");
    number.textContent = `TRACK ${String(track.id).padStart(2, "0")}`;
    const name = document.createElement("strong");
    name.textContent = track.name;
    button.append(number, name);
    button.addEventListener("click", () => selectTrack(track));
    return button;
  }));
}

function renderSpeedOptions() {
  el.speedControl.textContent = `x${state.intervalMultiply.toFixed(1)}`;
}

function renderDurationOptions() {
  el.durationControl.textContent = state.durationMinutes >= 60 && state.durationMinutes % 60 === 0 ? `${state.durationMinutes / 60} hr` : `${state.durationMinutes} min`;
}

function renderFixedFileSettings() {
  el.fixedFileSettings.replaceChildren(...Array.from(state.files, ([soundId, entry]) => {
    const row = document.createElement("div");
    row.className = "fixed-row";
    const label = document.createElement("label");
    label.htmlFor = `fixed-${soundId}`;
    label.textContent = soundId;
    const select = document.createElement("select");
    select.id = `fixed-${soundId}`;
    select.dataset.soundId = soundId;
    select.replaceChildren(...entry.names.map((file) => {
      const option = document.createElement("option");
      option.value = file;
      option.textContent = file;
      option.selected = state.fixedFiles[soundId] === file;
      return option;
    }));
    const preview = document.createElement("button");
    preview.type = "button";
    preview.className = "preview-button";
    preview.dataset.soundId = soundId;
    preview.setAttribute("aria-label", `${soundId} 미리 듣기`);
    row.append(label, select, preview);
    return row;
  }));
}

async function selectTrack(track) {
  stopPlayback(false);
  state.selectedTrack = track;
  state.position = 0;
  state.timeline = [];
  state.sessionKey = "";
  renderTracks();
  updateTrackSettings();
  updatePlayer();
  await startPlayback();
}

function updateTrackSettings() {
  const hasTrack = Boolean(state.selectedTrack);
  el.emptySettings.hidden = hasTrack;
  el.settingsContent.hidden = !hasTrack;
  if (!hasTrack) return;
  el.selectedTrackName.textContent = state.selectedTrack.name;
  el.trackSounds.textContent = state.selectedTrack.sounds.join(" · ");
  const random = state.mode === "random";
  el.modeToggle.setAttribute("aria-checked", String(random));
  el.modeToggle.querySelector("span").textContent = random ? "랜덤" : "고정";
  el.playModeDescription.textContent = random ? "이 재생에서 사용할 파일을 미리 섞어요" : "전역 설정에서 고른 파일만 재생해요";
}

function toggleMode() {
  state.mode = state.mode === "random" ? "fixed" : "random";
  saveSettings();
  updateTrackSettings();
  if (state.selectedTrack) restartSessionAt(state.position);
}

function openGlobalSettings() {
  renderFixedFileSettings();
  el.settingsDialog.showModal();
}

function saveFixedFile(event) {
  const select = event.target.closest("select[data-sound-id]");
  if (!select) return;
  const shouldResume = state.playing || state.previewResumePlayback;
  stopPreview(false);
  if (state.playing) pausePlayback();
  state.fixedFiles[select.dataset.soundId] = select.value;
  saveSettings();
  if (state.mode === "fixed" && state.selectedTrack?.sounds.includes(select.dataset.soundId)) {
    state.timeline = [];
    state.sessionKey = "";
  }
  if (shouldResume && state.selectedTrack && state.position < totalSeconds()) startPlayback();
}

async function togglePlayback() {
  if (!state.selectedTrack) return;
  if (state.playing) pausePlayback();
  else await startPlayback();
}

async function startPlayback() {
  if (!state.selectedTrack || state.position >= totalSeconds()) return;
  el.playButton.disabled = true;
  try {
    await ensureAudioContext();
    await loadTrackBuffers(state.selectedTrack);
    ensureTimeline();
    if (state.audioContext.state === "suspended") await state.audioContext.resume();
    state.anchorPosition = state.position;
    state.anchorContextTime = state.audioContext.currentTime;
    state.playing = true;
    state.nextEventIndex = lowerBoundTimeline(state.position);
    scheduleActiveAtPosition(state.position);
    tick();
    state.scheduler = window.setInterval(tick, 100);
  } catch (error) {
    console.error(error);
    state.playing = false;
    showToast("오디오를 재생할 수 없습니다.");
  } finally {
    updatePlayer();
  }
}

function pausePlayback() {
  if (!state.playing) return;
  state.position = currentPosition();
  state.playing = false;
  stopSources();
  clearInterval(state.scheduler);
  updatePlayer();
}

function stopPlayback(resetPosition = true) {
  state.playing = false;
  stopSources();
  clearInterval(state.scheduler);
  if (resetPosition) state.position = 0;
  updatePlayer();
}

async function restartSessionAt(position) {
  const wasPlaying = state.playing;
  stopPlayback(false);
  state.position = Math.min(position, totalSeconds());
  state.timeline = [];
  state.sessionKey = "";
  updatePlayer();
  if (wasPlaying) await startPlayback();
}

async function ensureAudioContext() {
  if (!state.audioContext) {
    state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    state.masterGain = state.audioContext.createGain();
    state.masterGain.gain.value = state.volume;
    state.masterGain.connect(state.audioContext.destination);
  }
  if (state.audioContext.state === "suspended") await state.audioContext.resume();
}

async function loadTrackBuffers(track) {
  const needed = track.sounds.flatMap((soundId) => (state.files.get(soundId)?.names || []).map((file) => ({ soundId, file })));
  const jobs = needed.map(({ soundId, file }) => loadSingleBuffer(soundId, file));
  await Promise.all(jobs);
}

async function loadSingleBuffer(soundId, file) {
  const key = `${soundId}/${file}`;
  if (state.buffers.has(key)) return state.buffers.get(key);
  const response = await fetch(soundUrl(soundId, file));
  if (!response.ok) throw new Error(`Audio ${response.status}: ${key}`);
  const buffer = await state.audioContext.decodeAudioData(await response.arrayBuffer());
  state.buffers.set(key, buffer);
  return buffer;
}

function ensureTimeline() {
  const key = `${state.selectedTrack.id}:${state.mode}:${state.intervalMultiply}:${state.durationMinutes}`;
  if (state.timeline.length && state.sessionKey === key) return;
  state.timeline = [];
  state.sessionKey = key;
  let cursor = 0, soundIndex = 0;
  while (cursor < totalSeconds()) {
    const soundId = state.selectedTrack.sounds[soundIndex % state.selectedTrack.sounds.length];
    const files = state.files.get(soundId)?.names || [];
    if (!files.length) { soundIndex += 1; if (soundIndex > state.selectedTrack.sounds.length * 2) break; continue; }
    const file = state.mode === "random" ? files[Math.floor(Math.random() * files.length)] : (state.fixedFiles[soundId] || files[0]);
    state.timeline.push({ start: cursor, soundId, file, key: `${soundId}/${file}` });
    cursor += (state.sounds.get(soundId) || 5) * state.intervalMultiply;
    soundIndex += 1;
  }
}

function tick() {
  if (!state.playing) return;
  const position = currentPosition();
  state.position = position;
  const lookAhead = 0.25;
  while (state.nextEventIndex < state.timeline.length && state.timeline[state.nextEventIndex].start <= position + lookAhead) {
    const event = state.timeline[state.nextEventIndex];
    if (event.start >= position - 0.12) scheduleSource(event, Math.max(0, event.start - position), 0);
    state.nextEventIndex += 1;
  }
  if (position >= totalSeconds()) {
    stopPlayback(true);
    state.timeline = [];
    state.sessionKey = "";
    return;
  }
  updateProgress(position);
}

function scheduleActiveAtPosition(position) {
  for (const event of state.timeline) {
    if (event.start > position) break;
    const buffer = state.buffers.get(event.key);
    const offset = position - event.start;
    if (buffer && offset > 0.08 && offset < buffer.duration) scheduleSource(event, 0, offset);
  }
}

function scheduleSource(event, delay, offset) {
  const buffer = state.buffers.get(event.key);
  if (!buffer || offset >= buffer.duration) return;
  const source = state.audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(state.masterGain);
  source.addEventListener("ended", () => state.activeSources.delete(source));
  state.activeSources.add(source);
  source.start(state.audioContext.currentTime + delay, offset);
}

function stopSources() {
  for (const source of state.activeSources) { try { source.stop(); } catch {} }
  state.activeSources.clear();
}

function currentPosition() {
  if (!state.playing || !state.audioContext) return state.position;
  return Math.min(totalSeconds(), state.anchorPosition + state.audioContext.currentTime - state.anchorContextTime);
}

function lowerBoundTimeline(position) {
  let low = 0, high = state.timeline.length;
  while (low < high) { const mid = (low + high) >> 1; if (state.timeline[mid].start < position) low = mid + 1; else high = mid; }
  return low;
}

function beginSeek() {
  if (state.seeking) return;
  state.seeking = true;
  state.seekWasPlaying = state.playing;
  if (state.playing) pausePlayback();
}

function previewSeek() {
  beginSeek();
  updateProgress(Number(el.progressSlider.value));
}

async function commitSeek() {
  const target = Number(el.progressSlider.value);
  const shouldResume = state.seekWasPlaying;
  state.position = target;
  state.seeking = false;
  state.seekWasPlaying = false;
  updatePlayer();
  if (shouldResume && target < totalSeconds()) await startPlayback();
}

function openChoiceDialog(kind) {
  state.choiceKind = kind;
  const isSpeed = kind === "speed";
  el.choiceTitle.textContent = isSpeed ? "반복 간격" : "재생 시간";
  const values = [];
  if (isSpeed) {
    for (let value = state.config.minIntervalMultiply; value <= state.config.maxIntervalMultiply + 0.001; value += 0.1) values.push(Number(value.toFixed(1)));
  } else values.push(...state.config.durations);
  const current = isSpeed ? state.intervalMultiply : state.durationMinutes;
  el.choiceOptions.replaceChildren(...values.map((value) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "choice-option";
    button.dataset.value = value;
    button.setAttribute("aria-pressed", String(value === current));
    button.textContent = isSpeed ? `x${value.toFixed(1)}` : formatDurationChoice(value);
    return button;
  }));
  el.choiceDialog.showModal();
}

function handleChoiceClick(event) {
  const button = event.target.closest(".choice-option");
  if (!button) return;
  const value = Number(button.dataset.value);
  el.choiceDialog.close();
  if (state.choiceKind === "speed") {
    state.intervalMultiply = value;
    saveSettings();
    renderSpeedOptions();
    if (state.selectedTrack) restartSessionAt(state.position);
    return;
  }
  const wasPlaying = state.playing;
  if (wasPlaying) pausePlayback();
  state.durationMinutes = value;
  saveSettings();
  renderDurationOptions();
  state.position = Math.min(state.position, totalSeconds());
  state.timeline = [];
  state.sessionKey = "";
  updatePlayer();
  if (wasPlaying && state.position < totalSeconds()) startPlayback();
}

function applyVolume() {
  state.volume = Number(el.volumeSlider.value);
  if (state.masterGain && state.audioContext) {
    state.masterGain.gain.setTargetAtTime(state.volume, state.audioContext.currentTime, 0.015);
  }
  saveSettings();
}

async function handlePreviewClick(event) {
  const button = event.target.closest(".preview-button");
  if (!button) return;
  const soundId = button.dataset.soundId;
  const select = document.getElementById(`fixed-${soundId}`);
  const file = select?.value;
  if (!file) return;
  const key = `${soundId}/${file}`;

  if (state.previewSource && state.previewKey === key) {
    stopPreview(true);
    return;
  }

  const shouldResume = state.previewKey ? state.previewResumePlayback : state.playing;
  stopPreview(false);
  if (state.playing) pausePlayback();
  state.previewResumePlayback = shouldResume;
  state.previewKey = key;
  const token = ++state.previewToken;
  updatePreviewButtons();

  try {
    await ensureAudioContext();
    const buffer = await loadSingleBuffer(soundId, file);
    if (token !== state.previewToken) return;
    const source = state.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(state.masterGain);
    state.previewSource = source;
    source.addEventListener("ended", () => {
      if (token !== state.previewToken || state.previewSource !== source) return;
      finishPreview();
    });
    source.start();
    updatePreviewButtons();
  } catch (error) {
    console.error(error);
    if (token === state.previewToken) {
      stopPreview(true);
      showToast("미리 듣기를 재생할 수 없습니다.");
    }
  }
}

function finishPreview() {
  const shouldResume = state.previewResumePlayback;
  state.previewSource = null;
  state.previewKey = "";
  state.previewResumePlayback = false;
  state.previewToken += 1;
  updatePreviewButtons();
  if (shouldResume && state.selectedTrack && state.position < totalSeconds()) startPlayback();
}

function stopPreview(resumePlayback) {
  const source = state.previewSource;
  const shouldResume = resumePlayback && state.previewResumePlayback;
  state.previewToken += 1;
  state.previewSource = null;
  state.previewKey = "";
  state.previewResumePlayback = false;
  if (source) { try { source.stop(); } catch {} }
  updatePreviewButtons();
  if (shouldResume && state.selectedTrack && state.position < totalSeconds()) startPlayback();
}

function updatePreviewButtons() {
  document.querySelectorAll(".preview-button").forEach((button) => {
    const soundId = button.dataset.soundId;
    const file = document.getElementById(`fixed-${soundId}`)?.value;
    const active = Boolean(state.previewKey && state.previewKey === `${soundId}/${file}`);
    button.classList.toggle("is-previewing", active);
    button.setAttribute("aria-label", active ? `${soundId} 미리 듣기 중지` : `${soundId} 미리 듣기`);
  });
}

function updatePlayer() {
  const enabled = Boolean(state.selectedTrack);
  el.playButton.disabled = !enabled;
  el.progressSlider.disabled = !enabled;
  el.playButton.classList.toggle("is-playing", state.playing);
  el.playButton.setAttribute("aria-label", state.playing ? "일시정지" : "재생");
  el.progressSlider.max = totalSeconds();
  el.totalTime.textContent = formatTime(totalSeconds());
  updateProgress(state.position);
}

function updateProgress(value) {
  const total = totalSeconds();
  const safeValue = Math.min(value, total);
  el.progressSlider.value = safeValue;
  el.progressSlider.style.setProperty("--progress", `${total ? (safeValue / total) * 100 : 0}%`);
  el.elapsedTime.textContent = formatTime(safeValue);
}

function totalSeconds() { return state.durationMinutes * 60; }
function numberOr(value, fallback) { const number = Number(value); return Number.isFinite(number) ? number : fallback; }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function formatTime(seconds) { const whole = Math.max(0, Math.floor(seconds)); const hours = Math.floor(whole / 3600); const minutes = Math.floor((whole % 3600) / 60); const secs = whole % 60; return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}` : `${minutes}:${String(secs).padStart(2, "0")}`; }
function formatDurationChoice(minutes) { return minutes < 60 ? `${minutes}분` : `${minutes / 60}시간`; }

function soundUrl(soundId, file) {
  const folder = state.files.get(soundId)?.folder || "";
  const encodedFolder = folder.split("/").map(encodeURIComponent).join("/");
  return `${SOUND_ROOT}/${encodedFolder}/${encodeURIComponent(file)}`;
}

function showToast(message, duration = 3000) {
  clearTimeout(toastTimer);
  el.toast.textContent = message;
  el.toast.classList.add("show");
  toastTimer = setTimeout(() => el.toast.classList.remove("show"), duration);
}
