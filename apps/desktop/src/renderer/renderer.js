const state = {
  sessionId: undefined,
  screenshotPath: "",
  screenshotPaths: [],
  windowTitle: "Unknown Application",
  isFullscreen: true,
};

const els = {
  windowTitle: document.getElementById("windowTitle"),
  captureMeta: document.getElementById("captureMeta"),
  question: document.getElementById("question"),
  status: document.getElementById("status"),
  answer: document.getElementById("answer"),
  history: document.getElementById("history"),
  askBtn: document.getElementById("askBtn"),
  recordBtn: document.getElementById("recordBtn"),
  pinBtn: document.getElementById("pinBtn"),
  modeBtn: document.getElementById("modeBtn"),
  minBtn: document.getElementById("minBtn"),
  closeBtn: document.getElementById("closeBtn"),
};

function setStatus(message) {
  els.status.textContent = message;
}

function setWindowMode(isFullscreen) {
  state.isFullscreen = isFullscreen;
  els.modeBtn.textContent = isFullscreen ? "Okno" : "Pełny";
  els.modeBtn.title = isFullscreen
    ? "Przełącz do trybu okna, aby móc przesuwać aplikację"
    : "Przełącz z powrotem do pełnego ekranu";
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
    li.textContent = `${session.appTitle} — ${new Date(session.lastInteractionAt).toLocaleString()}`;
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

  setStatus(`Wysyłanie pytania razem z buforem ${state.screenshotPaths.length} screenshotów...`);

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
  setStatus(`Odpowiedź odebrana (${new Date(result.createdAt).toLocaleTimeString()})`);
  await loadHistory();
}

let mediaRecorder;
let chunks = [];

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    chunks = [];

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };

    mediaRecorder.onstop = async () => {
      const blob = new Blob(chunks, { type: "audio/webm" });
      const arrayBuffer = await blob.arrayBuffer();
      setStatus("Transkrypcja lokalna...");
      const res = await window.assistantAPI.transcribeAudio(Array.from(new Uint8Array(arrayBuffer)));
      if (res.text) {
        els.question.value = res.text;
        setStatus("Transkrypcja gotowa");
      } else {
        setStatus("Brak transkrypcji (fallback do wpisania tekstu)");
      }
    };

    mediaRecorder.start();
    setStatus("Nagrywanie...");
  } catch {
    setStatus("Mikrofon niedostępny");
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
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

els.recordBtn.addEventListener("mousedown", () => {
  void startRecording();
});

els.recordBtn.addEventListener("mouseup", stopRecording);
els.recordBtn.addEventListener("mouseleave", stopRecording);

els.minBtn.addEventListener("click", () => {
  void window.assistantAPI.minimizeWindow();
});

els.closeBtn.addEventListener("click", () => {
  void window.assistantAPI.closeWindow();
});

els.pinBtn.addEventListener("click", async () => {
  const pinned = await window.assistantAPI.togglePinWindow();
  els.pinBtn.textContent = pinned ? "📌" : "📍";
});

els.modeBtn.addEventListener("click", async () => {
  const result = await window.assistantAPI.toggleWindowMode();
  setWindowMode(Boolean(result?.isFullscreen));
});

setWindowMode(true);
void loadHistory();
