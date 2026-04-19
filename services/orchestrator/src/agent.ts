import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { AssistantQueryInput } from "@local-ai/shared";
import { buildSystemPrompt, buildUserPrompt } from "./prompt";

export interface AgentInvocation {
  command: string;
  args: string[];
  shell: boolean;
}

export function fallbackAnswer(input: AssistantQueryInput): string {
  return [
    `Krok 1: Sprawdź panel po lewej stronie w oknie '${input.windowTitle}'.`,
    "Krok 2: Otwórz sekcję, która najlepiej pasuje do Twojego pytania i wybierz główną akcję.",
    "Krok 3: Potwierdź zmianę i sprawdź podgląd / wynik po prawej stronie.",
    "Uwaga: Nie udało się uzyskać odpowiedzi od lokalnego agenta. Aplikacja domyślnie używa Codex CLI; jeśli chcesz nadpisać runner, ustaw AI_ASSISTANT_AGENT_CMD.",
  ].join("\n");
}

function findCodexExecutableOnWindows(): string | null {
  const pathValue = process.env.PATH;

  if (!pathValue) {
    return null;
  }

  for (const rawDir of pathValue.split(path.delimiter)) {
    const dir = rawDir.trim();
    if (!dir) {
      continue;
    }

    const candidate = path.join(dir, "codex.exe");
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function getUniqueScreenshotPaths(input: AssistantQueryInput): string[] {
  const allPaths = [
    ...(input.screenshotPaths ?? []),
    input.screenshotPath,
  ].filter(Boolean);

  return [...new Set(allPaths)];
}

export function resolveAgentInvocation(input: AssistantQueryInput): AgentInvocation {
  const override = process.env.AI_ASSISTANT_AGENT_CMD?.trim();
  const isWindows = process.platform === "win32";

  if (override) {
    return {
      command: override,
      args: [],
      shell: true,
    };
  }

  const command = isWindows ? findCodexExecutableOnWindows() ?? "codex" : "codex";
  const screenshotPaths = getUniqueScreenshotPaths(input);

  const args = [
    "exec",
    "--skip-git-repo-check",
    "--color",
    "never",
    "--sandbox",
    "read-only",
  ];

  for (const screenshotPath of screenshotPaths) {
    args.push("--image", screenshotPath);
  }

  args.push("-");

  return {
    command,
    args,
    shell: isWindows && command === "codex",
  };
}

export class LocalAgentClient {
  generate(input: AssistantQueryInput): string {
    const prompt = `${buildSystemPrompt()}\n\n${buildUserPrompt(input)}`;
    const invocation = resolveAgentInvocation(input);
    const result = spawnSync(invocation.command, invocation.args, {
      shell: invocation.shell,
      input: prompt,
      encoding: "utf-8",
      timeout: 90_000,
      windowsHide: true,
    });

    if (result.error || result.status !== 0) {
      console.error("Local agent invocation failed", {
        command: invocation.command,
        args: invocation.args,
        status: result.status,
        error: result.error?.message,
        stderr: result.stderr?.trim(),
      });
      return fallbackAnswer(input);
    }

    const output = result.stdout?.trim();
    return output || fallbackAnswer(input);
  }
}
