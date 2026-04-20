const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  LocalSttWorker,
  getAudioExtension,
  parseTranscribeWorkerOutput,
} = require("../dist/index.js");

function run(name, fn) {
  Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`ok - ${name}`);
    })
    .catch((error) => {
      console.error(`not ok - ${name}`);
      console.error(error);
      process.exitCode = 1;
    });
}

run("maps mime types to expected audio extensions", () => {
  assert.equal(getAudioExtension("audio/webm;codecs=opus"), ".webm");
  assert.equal(getAudioExtension("audio/wav"), ".wav");
  assert.equal(getAudioExtension("audio/mp4"), ".m4a");
  assert.equal(getAudioExtension(undefined), ".webm");
});

run("parses successful worker payloads", () => {
  const result = parseTranscribeWorkerOutput(
    JSON.stringify({ status: "ok", text: "test", diagnostics: { strategy: "cpu:int8" } }),
    "",
    { mimeType: "audio/webm" },
  );

  assert.equal(result.status, "ok");
  assert.equal(result.text, "test");
  assert.equal(result.diagnostics.worker.strategy, "cpu:int8");
});

run("surfaces invalid worker responses as errors", () => {
  const result = parseTranscribeWorkerOutput("not-json", "boom", { durationMs: 1000 });

  assert.equal(result.status, "error");
  assert.equal(result.errorCode, "invalid_worker_response");
  assert.match(result.diagnostics.stderr, /boom/);
});

run("uses structured worker output from the exec callback", async () => {
  const worker = new LocalSttWorker({
    execFileImpl: (_command, _args, _options, callback) => {
      callback(null, JSON.stringify({ status: "empty", text: "", errorCode: "no_speech_detected" }), "");
      return {};
    },
  });

  const result = await worker.transcribeFile("sample.wav", { mimeType: "audio/wav" });

  assert.equal(result.status, "empty");
  assert.equal(result.errorCode, "no_speech_detected");
});

run("writes temporary audio files with the correct extension", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "stt-worker-test-"));
  let observedAudioPath = "";

  try {
    const worker = new LocalSttWorker({
      execFileImpl: (_command, args, _options, callback) => {
        observedAudioPath = args[1];
        callback(null, JSON.stringify({ status: "ok", text: "halo" }), "");
        return {};
      },
      tempDir,
    });

    const result = await worker.transcribeFromBuffer({
      bytes: Buffer.from("fake"),
      mimeType: "audio/wav",
      durationMs: 1200,
    });

    assert.equal(result.status, "ok");
    assert.match(observedAudioPath, /\.wav$/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

run("discovers NVIDIA runtime DLL directories from Python site-packages on Windows", () => {
  if (process.platform !== "win32") {
    return;
  }

  const pythonSnippet = [
    "import importlib.util, json, pathlib",
    `script_path = pathlib.Path(r"${path.resolve(__dirname, "../scripts/transcribe.py")}")`,
    "spec = importlib.util.spec_from_file_location('transcribe_module', script_path)",
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "print(json.dumps(module.discover_windows_cuda_bin_dirs()))",
  ].join("; ");

  const output = execFileSync("python", ["-c", pythonSnippet], {
    encoding: "utf8",
  });
  const result = JSON.parse(output.trim());

  assert(result.pythonCandidates.some((entry) => entry.toLowerCase().includes(`${path.sep}nvidia${path.sep}cublas${path.sep}bin`.toLowerCase())));
  assert(result.pythonCandidates.some((entry) => entry.toLowerCase().includes(`${path.sep}nvidia${path.sep}cudnn${path.sep}bin`.toLowerCase())));
});

process.on("beforeExit", () => {
  if (!process.exitCode) {
    console.log("All stt-worker tests passed.");
  }
});
