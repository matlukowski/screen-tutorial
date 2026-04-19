const assert = require("node:assert/strict");
const path = require("node:path");
const { fallbackAnswer, resolveAgentInvocation } = require("../dist/agent.js");
const { buildSystemPrompt, buildUserPrompt } = require("../dist/prompt.js");

function run(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

run("system prompt enforces concrete UI guidance", () => {
  const prompt = buildSystemPrompt();
  assert.match(prompt, /konkretnie/i);
  assert.match(prompt, /krok po kroku/i);
  assert.match(prompt, /po polsku/i);
  assert.match(prompt, /główne źródło prawdy/i);
  assert.match(prompt, /krótki ciąg czasowy/i);
});

run("user prompt includes multiple screenshots, title and question", () => {
  const prompt = buildUserPrompt({
    question: "Jak zrobić mirror?",
    screenshotPath: "C:/tmp/screen-3.png",
    screenshotPaths: [
      "C:/tmp/screen-1.png",
      "C:/tmp/screen-2.png",
      "C:/tmp/screen-3.png",
    ],
    windowTitle: "AutoCAD",
    captureMode: "active-window",
  });

  assert.match(prompt, /AutoCAD/);
  assert.match(prompt, /Liczba dołączonych screenshotów: 3/);
  assert.match(prompt, /C:\/tmp\/screen-1\.png/);
  assert.match(prompt, /C:\/tmp\/screen-3\.png/);
  assert.match(prompt, /Jak zrobić mirror/);
});

run("default agent invocation uses codex CLI with all attached screenshots", () => {
  const previous = process.env.AI_ASSISTANT_AGENT_CMD;
  delete process.env.AI_ASSISTANT_AGENT_CMD;

  try {
    const invocation = resolveAgentInvocation({
      question: "Jak dodać kontakt?",
      screenshotPath: "C:/tmp/screen-3.png",
      screenshotPaths: [
        "C:/tmp/screen-1.png",
        "C:/tmp/screen-2.png",
        "C:/tmp/screen-3.png",
      ],
      windowTitle: "CRM",
      captureMode: "active-window",
    });

    if (process.platform === "win32") {
      assert.match(invocation.command, /(codex|codex\.exe)$/i);
      assert.equal(path.basename(invocation.command).toLowerCase(), "codex.exe");
      assert.equal(invocation.shell, false);
    } else {
      assert.equal(invocation.command, "codex");
      assert.equal(invocation.shell, false);
    }

    assert.deepEqual(invocation.args, [
      "exec",
      "--skip-git-repo-check",
      "--color",
      "never",
      "--sandbox",
      "read-only",
      "--image",
      "C:/tmp/screen-1.png",
      "--image",
      "C:/tmp/screen-2.png",
      "--image",
      "C:/tmp/screen-3.png",
      "-",
    ]);
  } finally {
    if (previous === undefined) {
      delete process.env.AI_ASSISTANT_AGENT_CMD;
    } else {
      process.env.AI_ASSISTANT_AGENT_CMD = previous;
    }
  }
});

run("custom agent invocation still respects AI_ASSISTANT_AGENT_CMD override", () => {
  const previous = process.env.AI_ASSISTANT_AGENT_CMD;
  process.env.AI_ASSISTANT_AGENT_CMD = "custom-agent --stdin";

  try {
    const invocation = resolveAgentInvocation({
      question: "Jak dodać kontakt?",
      screenshotPath: "C:/tmp/screen-3.png",
      screenshotPaths: [
        "C:/tmp/screen-1.png",
        "C:/tmp/screen-2.png",
        "C:/tmp/screen-3.png",
      ],
      windowTitle: "CRM",
      captureMode: "active-window",
    });

    assert.equal(invocation.command, "custom-agent --stdin");
    assert.equal(invocation.shell, true);
    assert.deepEqual(invocation.args, []);
  } finally {
    if (previous === undefined) {
      delete process.env.AI_ASSISTANT_AGENT_CMD;
    } else {
      process.env.AI_ASSISTANT_AGENT_CMD = previous;
    }
  }
});

run("fallback answer points to codex as the default runner", () => {
  const answer = fallbackAnswer({
    question: "Jak dodać kontakt?",
    screenshotPath: "C:/tmp/screen-3.png",
    screenshotPaths: [
      "C:/tmp/screen-1.png",
      "C:/tmp/screen-2.png",
      "C:/tmp/screen-3.png",
    ],
    windowTitle: "CRM",
    captureMode: "active-window",
  });

  assert.match(answer, /Codex CLI/i);
  assert.match(answer, /AI_ASSISTANT_AGENT_CMD/);
});

if (!process.exitCode) {
  console.log("All orchestrator tests passed.");
}
