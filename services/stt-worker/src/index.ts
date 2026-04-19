import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { v4 as uuidv4 } from "uuid";

export interface TranscribeResult {
  text: string;
  error?: string;
}

export class LocalSttWorker {
  private readonly pythonBin: string;
  private readonly scriptPath: string;

  constructor() {
    this.pythonBin = process.env.PYTHON_BIN || "python";
    this.scriptPath = path.resolve(__dirname, "../scripts/transcribe.py");
  }

  async transcribeFromBuffer(buffer: Buffer): Promise<TranscribeResult> {
    const tempDir = path.join(os.tmpdir(), "local-ai-screen-assistant");
    await fs.mkdir(tempDir, { recursive: true });
    const audioPath = path.join(tempDir, `${uuidv4()}.webm`);

    try {
      await fs.writeFile(audioPath, buffer);
      return await this.transcribeFile(audioPath);
    } finally {
      fs.unlink(audioPath).catch(() => undefined);
    }
  }

  async transcribeFile(audioPath: string): Promise<TranscribeResult> {
    return new Promise((resolve) => {
      const modelSize = process.env.STT_MODEL_SIZE || "base";
      execFile(
        this.pythonBin,
        [this.scriptPath, audioPath, modelSize],
        { timeout: 30_000 },
        (error, stdout, stderr) => {
          if (error) {
            resolve({
              text: "",
              error: stderr?.trim() || error.message,
            });
            return;
          }

          const text = stdout.toString().trim();
          resolve({ text });
        },
      );
    });
  }
}
