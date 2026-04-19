const test = require("node:test");
const assert = require("node:assert/strict");
const { fallbackAnswer, resolveAgentInvocation } = require("../dist/agent.js");

test("default agent invocation uses codex CLI with attached screenshot", () => {
  const previous = process.env.AI_ASSISTANT_AGENT_CMD;
  delete process.env.AI_ASSISTANT_AGENT_CMD;

  try {
    const invocation = resolveAgentInvocation({
      question: "Jak dodać kontakt?",
      screenshotPath: "C:/tmp/screen.png",
      windowTitle: "CRM",
      captureMode: "active-window",
    });

    assert.equal(invocation.command, "codex");
    assert.equal(invocation.shell, false);
    assert.deepEqual(invocation.args, [
      "exec",
      "--skip-git-repo-check",
      "--color",
      "never",
      "--sandbox",
      "read-only",
      "--image",
      "C:/tmp/screen.png",
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

test("custom agent invocation still respects AI_ASSISTANT_AGENT_CMD override", () => {
  const previous = process.env.AI_ASSISTANT_AGENT_CMD;
  process.env.AI_ASSISTANT_AGENT_CMD = "custom-agent --stdin";

  try {
    const invocation = resolveAgentInvocation({
      question: "Jak dodać kontakt?",
      screenshotPath: "C:/tmp/screen.png",
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

test("fallback answer points to codex as the default runner", () => {
  const answer = fallbackAnswer({
    question: "Jak dodać kontakt?",
    screenshotPath: "C:/tmp/screen.png",
    windowTitle: "CRM",
    captureMode: "active-window",
  });

  assert.match(answer, /Codex CLI/i);
  assert.match(answer, /AI_ASSISTANT_AGENT_CMD/);
});
