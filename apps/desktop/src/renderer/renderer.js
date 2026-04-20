const state = {
  sessionId: undefined,
  screenshotPath: "",
  screenshotPaths: [],
  windowTitle: "Unknown Application",
  isFullscreen: true,
  voiceMode: "idle",
};

const els = {
  windowTitle: document.getElementById("windowTitle"),
  captureMeta: document.getElementById("captureMeta"),
  question: document.getElementById("question"),
  status: document.getElementById("status"),
  answer: document.getElementById("answer"),
  history: document.getElementById("history"),
  askBtn: document.getElementById("askBtn"),
  startRecordingBtn: document.getElementById("startRecordingBtn"),
  stopRecordingBtn: document.getElementById("stopRecordingBtn"),
  pinBtn: document.getElementById("pinBtn"),
  modeBtn: document.getElementById("modeBtn"),
  minBtn: document.getElementById("minBtn"),
  closeBtn: document.getElementById("closeBtn"),
};

function setStatus(message) {
  els.status.textContent = message;
}

function setVoiceMode(mode) {
  state.voiceMode = mode;
  const isRecording = mode === "recording";
  const isTranscribing = mode === "transcribing";

  els.startRecordingBtn.disabled = isRecording || isTranscribing;
  els.stopRecordingBtn.disabled = !isRecording;
}

function setWindowMode(isFullscreen) {
  state.isFullscreen = isFullscreen;
  els.modeBtn.textContent = isFullscreen ? "Okno" : "Pelny";
  els.modeBtn.title = isFullscreen
    ? "Przelacz do trybu okna, aby moc przesuwac aplikacje"
    : "Przelacz z powrotem do pelnego ekranu";
}

function setContext(payload) {
  if (payload.screenshotPath) {
    state.screenshotPath = payload.screenshotPath;
  }

  if (Array.isArray(payload.screenshotPaths)) {
    state.screenshotPaths = payload.screenshotPaths;
  }

  state.windowTitle = payload.windowTitle;
  els.windowTitle.textContent = payload.windowTitle;
  els.captureMeta.textContent = "";
}

async function loadHistory() {
  const sessions = await window.assistantAPI.listHistory();
  els.history.innerHTML = "";

  for (const session of sessions) {
    const li = document.createElement("li");
    li.textContent = `${session.appTitle} - ${new Date(session.lastInteractionAt).toLocaleString()}`;
    li.onclick = async () => {
      const detail = await window.assistantAPI.getSession(session.id);
      if (!detail || !detail.interactions?.length) return;
      const last = detail.interactions[detail.interactions.length - 1];
      state.sessionId = session.id;
      state.windowTitle = session.appTitle;
      state.screenshotPath = last.screenshotPath;
      els.question.value = last.question;
      els.answer.textContent = last.answer;
      els.windowTitle.textContent = session.appTitle;
      els.captureMeta.textContent = "";
    };
    els.history.appendChild(li);
  }
}

async function askAgent() {
  const question = els.question.value.trim();
  if (!question || !state.screenshotPath) {
    setStatus("Poczekaj na automatyczny screenshot i wpisz pytanie.");
    return;
  }

  setStatus(`Wysylanie pytania razem z buforem ${state.screenshotPaths.length} screenshotow...`);

  const result = await window.assistantAPI.ask({
    question,
    screenshotPath: state.screenshotPath,
    screenshotPaths: state.screenshotPaths,
    windowTitle: state.windowTitle,
    sessionId: state.sessionId,
    captureMode: "active-window",
  });

  state.sessionId = result.sessionId;
  els.answer.textContent = result.answer;
  setStatus(`Odpowiedz odebrana (${new Date(result.createdAt).toLocaleTimeString()})`);
  await loadHistory();
}

let mediaRecorder;
let mediaStream;
let chunks = [];
let recordingStartedAt = 0;

function cleanupRecordingResources() {
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }

  mediaRecorder = null;
}

function getRecorderOptions() {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return undefined;
  }

  const preferredMimeTypes = [
    "audio/webm;codecs=opus",
    "audio/webm",
  ];

  const mimeType = preferredMimeTypes.find((candidate) => MediaRecorder.isTypeSupported(candidate));
  return mimeType ? { mimeType } : undefined;
}

function getTranscriptionErrorMessage(result) {
  switch (result?.errorCode) {
    case "dependency_missing":
      return "Lokalny worker STT nie jest gotowy. Sprawdz instalacje faster-whisper i Pythona.";
    case "gpu_runtime_missing":
      return "GPU zostalo wybrane do STT, ale aplikacja nie widzi bibliotek CUDA/cuDNN. Sprawdz konfiguracje GPU.";
    case "model_initialization_failed":
      return "Worker STT nie uruchomil modelu. Sprawdz konfiguracje CPU/GPU.";
    case "transcription_failed":
      return "Transkrypcja nie powiodla sie. Sprobuj ponownie albo sprawdz lokalny worker STT.";
    default:
      return "Brak transkrypcji. Lokalny worker STT zglosil blad.";
  }
}

async function handleRecordingStop(recordedChunks, audioMimeType) {
  cleanupRecordingResources();
  const durationMs = recordingStartedAt ? Math.max(Date.now() - recordingStartedAt, 0) : undefined;
  recordingStartedAt = 0;

  if (!recordedChunks.length) {
    setVoiceMode("idle");
    setStatus("Nie udalo sie zapisac nagrania. Sprobuj jeszcze raz.");
    return;
  }

  try {
    const blob = new Blob(recordedChunks, { type: audioMimeType });
    const arrayBuffer = await blob.arrayBuffer();
    setStatus("Transkrypcja lokalna...");
    const res = await window.assistantAPI.transcribeAudio({
      bytes: Array.from(new Uint8Array(arrayBuffer)),
      chunkCount: recordedChunks.length,
      durationMs,
      mimeType: audioMimeType,
    });

    if (res.status === "ok" && res.text) {
      els.question.value = res.text;
      els.question.focus();
      const strategy = res.diagnostics?.worker?.strategy;
      const backendLabel = strategy?.device === "cuda" ? "GPU" : "CPU";
      setStatus(`Transkrypcja gotowa (${backendLabel}). Mozesz kliknac Zapytaj agenta.`);
    } else if (res.status === "empty") {
      setStatus("Nie wykryto mowy w nagraniu. Sprobuj powiedziec zdanie blizej mikrofonu.");
    } else if (res.status === "error") {
      setStatus(getTranscriptionErrorMessage(res));
    } else {
      setStatus("Brak transkrypcji. Wpisz pytanie recznie albo sprobuj ponownie.");
    }
  } catch {
    setStatus("Nie udalo sie przetworzyc nagrania.");
  } finally {
    setVoiceMode("idle");
  }
}

async function startRecording() {
  if (state.voiceMode !== "idle") {
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    setStatus("To okno nie obsluguje nagrywania glosu.");
    return;
  }

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(mediaStream, getRecorderOptions());
    chunks = [];
    recordingStartedAt = Date.now();

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    };

    mediaRecorder.onerror = () => {
      chunks = [];
      recordingStartedAt = 0;
      cleanupRecordingResources();
      setVoiceMode("idle");
      setStatus("Wystapil blad podczas nagrywania glosu.");
    };

    mediaRecorder.onstop = () => {
      const recordedChunks = [...chunks];
      const audioMimeType = mediaRecorder?.mimeType || "audio/webm";
      chunks = [];
      void handleRecordingStop(recordedChunks, audioMimeType);
    };

    mediaRecorder.start(250);
    setVoiceMode("recording");
    setStatus("Nagrywanie trwa. Kliknij Zatrzymaj nagrywanie, gdy skonczysz.");
  } catch {
    chunks = [];
    recordingStartedAt = 0;
    cleanupRecordingResources();
    setVoiceMode("idle");
    setStatus("Mikrofon jest niedostepny albo brak zgody na nagrywanie.");
  }
}

function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state === "inactive" || state.voiceMode !== "recording") {
    return;
  }

  setVoiceMode("transcribing");
  setStatus("Zatrzymywanie nagrania...");

  if (typeof mediaRecorder.requestData === "function") {
    try {
      mediaRecorder.requestData();
    } catch {
      // Ignore: some runtimes reject requestData while stopping the recorder.
    }
  }

  mediaRecorder.stop();
}

window.assistantAPI.onOverlayContext((payload) => {
  setContext(payload);
});

window.assistantAPI.onWindowMode((payload) => {
  setWindowMode(Boolean(payload?.isFullscreen));
});

els.askBtn.addEventListener("click", () => {
  void askAgent();
});

els.startRecordingBtn.addEventListener("click", () => {
  void startRecording();
});

els.stopRecordingBtn.addEventListener("click", stopRecording);

els.minBtn.addEventListener("click", () => {
  void window.assistantAPI.minimizeWindow();
});

els.closeBtn.addEventListener("click", () => {
  void window.assistantAPI.closeWindow();
});

els.pinBtn.addEventListener("click", async () => {
  const pinned = await window.assistantAPI.togglePinWindow();
  els.pinBtn.textContent = pinned ? "PIN" : "UNPIN";
});

els.modeBtn.addEventListener("click", async () => {
  const result = await window.assistantAPI.toggleWindowMode();
  setWindowMode(Boolean(result?.isFullscreen));
});

window.addEventListener("beforeunload", cleanupRecordingResources);

setWindowMode(true);
setVoiceMode("idle");
setStatus("Mozesz wpisac pytanie albo nagrac glos.");
void loadHistory();
