import { execFile, type ExecFileException } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";

export type TranscribeStatus = "ok" | "empty" | "error";

export interface TranscribeDiagnostics {
  audioPath?: string;
  byteLength?: number;
  chunkCount?: number;
  durationMs?: number;
  errorName?: string;
  exitCode?: number | null;
  keptAudioFile?: boolean;
  mimeType?: string;
  pythonBin?: string;
  scriptPath?: string;
  stderr?: string;
  worker?: Record<string, unknown>;
}

export interface TranscribeResult {
  status: TranscribeStatus;
  text: string;
  errorCode?: string;
  errorMessage?: string;
  diagnostics?: TranscribeDiagnostics;
}

export interface TranscribeAudioInput {
  bytes: Buffer | Uint8Array;
  chunkCount?: number;
  durationMs?: number;
  mimeType?: string;
}

interface PythonWorkerPayload {
  diagnostics?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
  status?: string;
  text?: string;
}

type ExecFileImpl = typeof execFile;

interface LocalSttWorkerOptions {
  execFileImpl?: ExecFileImpl;
  keepFailedAudio?: boolean;
  modelSize?: string;
  pythonBin?: string;
  scriptPath?: string;
  tempDir?: string;
}

export function getAudioExtension(mimeType?: string): string {
  if (!mimeType) {
    return ".webm";
  }

  const normalized = mimeType.toLowerCase();

  if (normalized.includes("wav")) return ".wav";
  if (normalized.includes("mpeg") || normalized.includes("mp3")) return ".mp3";
  if (normalized.includes("ogg")) return ".ogg";
  if (normalized.includes("mp4") || normalized.includes("aac") || normalized.includes("m4a")) return ".m4a";
  if (normalized.includes("webm")) return ".webm";

  return ".webm";
}

export function parseTranscribeWorkerOutput(
  stdout: string,
  stderr: string,
  diagnostics: TranscribeDiagnostics,
): TranscribeResult {
  const trimmedStdout = stdout.trim();
  const trimmedStderr = stderr.trim();

  if (trimmedStdout) {
    try {
      const payload = JSON.parse(trimmedStdout) as PythonWorkerPayload;
      const normalizedStatus = payload.status === "ok" || payload.status === "empty" || payload.status === "error"
        ? payload.status
        : "error";

      return {
        status: normalizedStatus,
        text: typeof payload.text === "string" ? payload.text : "",
        errorCode: typeof payload.errorCode === "string" ? payload.errorCode : undefined,
        errorMessage: typeof payload.errorMessage === "string" ? payload.errorMessage : undefined,
        diagnostics: {
          ...diagnostics,
          stderr: trimmedStderr || diagnostics.stderr,
          worker: payload.diagnostics,
        },
      };
    } catch {
      return {
        status: "error",
        text: "",
        errorCode: "invalid_worker_response",
        errorMessage: "Worker STT zwrócił nieprawidłową odpowiedź.",
        diagnostics: {
          ...diagnostics,
          stderr: trimmedStderr || diagnostics.stderr,
        },
      };
    }
  }

  return {
    status: "error",
    text: "",
    errorCode: "empty_worker_response",
    errorMessage: trimmedStderr || "Worker STT nie zwrócił danych.",
    diagnostics: {
      ...diagnostics,
      stderr: trimmedStderr || diagnostics.stderr,
    },
  };
}

export class LocalSttWorker {
  private readonly execFileImpl: ExecFileImpl;
  private readonly keepFailedAudio: boolean;
  private readonly modelSize: string;
  private readonly pythonBin: string;
  private readonly scriptPath: string;
  private readonly tempDir: string;

  constructor(options: LocalSttWorkerOptions = {}) {
    this.execFileImpl = options.execFileImpl || execFile;
    this.keepFailedAudio = options.keepFailedAudio ?? process.env.STT_KEEP_FAILED_AUDIO === "1";
    this.modelSize = options.modelSize || process.env.STT_MODEL_SIZE || "base";
    this.pythonBin = options.pythonBin || process.env.PYTHON_BIN || "python";
    this.scriptPath = options.scriptPath || path.resolve(__dirname, "../scripts/transcribe.py");
    this.tempDir = options.tempDir || path.join(os.tmpdir(), "local-ai-screen-assistant");
  }

  async transcribeFromBuffer(input: TranscribeAudioInput): Promise<TranscribeResult> {
    const bytes = Buffer.isBuffer(input.bytes) ? input.bytes : Buffer.from(input.bytes);
    await fs.mkdir(this.tempDir, { recursive: true });

    const audioPath = path.join(this.tempDir, `${uuidv4()}${getAudioExtension(input.mimeType)}`);

    try {
      await fs.writeFile(audioPath, bytes);
      return await this.transcribeFile(audioPath, {
        byteLength: bytes.byteLength,
        chunkCount: input.chunkCount,
        durationMs: input.durationMs,
        mimeType: input.mimeType,
      });
    } finally {
      if (!this.keepFailedAudio) {
        fs.unlink(audioPath).catch(() => undefined);
      }
    }
  }

  async transcribeFile(
    audioPath: string,
    metadata: Omit<TranscribeDiagnostics, "audioPath" | "pythonBin" | "scriptPath"> = {},
  ): Promise<TranscribeResult> {
    return new Promise((resolve) => {
      const baseDiagnostics: TranscribeDiagnostics = {
        ...metadata,
        audioPath,
        keptAudioFile: this.keepFailedAudio,
        pythonBin: this.pythonBin,
        scriptPath: this.scriptPath,
      };

      this.execFileImpl(
        this.pythonBin,
        [this.scriptPath, audioPath, this.modelSize],
        { timeout: 30_000 },
        (error, stdout, stderr) => {
          const stdoutText = stdout.toString();
          const stderrText = stderr.toString();
          const exitCode = typeof (error as ExecFileException | null)?.code === "number"
            ? Number((error as ExecFileException).code)
            : null;

          const parsed = parseTranscribeWorkerOutput(stdoutText, stderrText, {
            ...baseDiagnostics,
            errorName: error?.name,
            exitCode,
          });

          if (error && parsed.status !== "ok" && parsed.errorCode === "empty_worker_response") {
            resolve({
              status: "error",
              text: "",
              errorCode: "worker_process_failed",
              errorMessage: stderrText.trim() || error.message,
              diagnostics: parsed.diagnostics,
            });
            return;
          }

          resolve(parsed);
        },
      );
    });
  }
}
