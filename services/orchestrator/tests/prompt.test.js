const test = require("node:test");
const assert = require("node:assert/strict");
const { buildSystemPrompt, buildUserPrompt } = require("../dist/prompt.js");

test("system prompt enforces concrete UI guidance", () => {
  const prompt = buildSystemPrompt();
  assert.match(prompt, /konkretnie/i);
  assert.match(prompt, /krok po kroku/i);
  assert.match(prompt, /po polsku/i);
  assert.match(prompt, /główne źródło prawdy/i);
});

test("user prompt includes screenshot, title and question", () => {
  const prompt = buildUserPrompt({
    question: "Jak zrobić mirror?",
    screenshotPath: "C:/tmp/screen.png",
    windowTitle: "AutoCAD",
    captureMode: "active-window",
  });

  assert.match(prompt, /AutoCAD/);
  assert.match(prompt, /C:\/tmp\/screen.png/);
  assert.match(prompt, /Jak zrobić mirror/);
  assert.match(prompt, /dołączony jako obraz/i);
});
