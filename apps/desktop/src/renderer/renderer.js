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
  els.modeBtn.textContent = isFullscreen ? "Okno" : "PeĹ‚ny";
  els.modeBtn.title = isFullscreen
    ? "PrzeĹ‚Ä…cz do trybu okna, aby mĂłc przesuwaÄ‡ aplikacjÄ™"
    : "PrzeĹ‚Ä…cz z powrotem do peĹ‚nego ekranu";
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
    li.textContent = `${session.appTitle} â€” ${new Date(session.lastInteractionAt).toLocaleString()}`;
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

  setStatus(`WysyĹ‚anie pytania razem z buforem ${state.screenshotPaths.length} screenshotĂłw...`);

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
  setStatus(`OdpowiedĹş odebrana (${new Date(result.createdAt).toLocaleTimeString()})`);
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
      return "Lokalny worker STT nie jest gotowy. SprawdĹş instalacjÄ™ faster-whisper i Pythona.";
    case "model_initialization_failed":
      return "Worker STT nie uruchomiĹ‚ modelu. SprawdĹş konfiguracjÄ™ CPU/GPU.";
    case "transcription_failed":
      return "Transkrypcja nie powiodĹ‚a siÄ™. SprĂłbuj ponownie albo sprawdĹş lokalny worker STT.";
    default:
      return "Brak transkrypcji. Lokalny worker STT zgĹ‚osiĹ‚ bĹ‚Ä…d.";
  }
}

async function handleRecordingStop(recordedChunks, audioMimeType) {
  cleanupRecordingResources();
  const durationMs = recordingStartedAt ? Math.max(Date.now() - recordingStartedAt, 0) : undefined;
  recordingStartedAt = 0;

  if (!recordedChunks.length) {
    setVoiceMode("idle");
    setStatus("Nie udaĹ‚o siÄ™ zapisaÄ‡ nagrania. SprĂłbuj jeszcze raz.");
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
      setStatus("Transkrypcja gotowa. MoĹĽesz kliknÄ…Ä‡ Zapytaj agenta.");
    } else if (res.status === "empty") {
      setStatus("Nie wykryto mowy w nagraniu. SprĂłbuj powiedzieÄ‡ zdanie bliĹĽej mikrofonu.");
    } else if (res.status === "error") {
      setStatus(getTranscriptionErrorMessage(res));
    } else {
      setStatus("Brak transkrypcji. Wpisz pytanie rÄ™cznie albo sprĂłbuj ponownie.");
    }
  } catch {
    setStatus("Nie udaĹ‚o siÄ™ przetworzyÄ‡ nagrania.");
  } finally {
    setVoiceMode("idle");
  }
}

async function startRecording() {
  if (state.voiceMode !== "idle") {
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    setStatus("To okno nie obsĹ‚uguje nagrywania gĹ‚osu.");
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
      setStatus("WystÄ…piĹ‚ bĹ‚Ä…d podczas nagrywania gĹ‚osu.");
    };

    mediaRecorder.onstop = () => {
      const recordedChunks = [...chunks];
      const audioMimeType = mediaRecorder?.mimeType || "audio/webm";
      chunks = [];
      void handleRecordingStop(recordedChunks, audioMimeType);
    };

    mediaRecorder.start(250);
    setVoiceMode("recording");
    setStatus("Nagrywanie trwa. Kliknij Zatrzymaj nagrywanie, gdy skoĹ„czysz.");
  } catch {
    chunks = [];
    recordingStartedAt = 0;
    cleanupRecordingResources();
    setVoiceMode("idle");
    setStatus("Mikrofon jest niedostÄ™pny albo brak zgody na nagrywanie.");
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
  els.pinBtn.textContent = pinned ? "đź“Ś" : "đź“Ť";
});

els.modeBtn.addEventListener("click", async () => {
  const result = await window.assistantAPI.toggleWindowMode();
  setWindowMode(Boolean(result?.isFullscreen));
});

window.addEventListener("beforeunload", cleanupRecordingResources);

setWindowMode(true);
setVoiceMode("idle");
setStatus("MoĹĽesz wpisaÄ‡ pytanie albo nagraÄ‡ gĹ‚os.");
void loadHistory();
