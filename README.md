# Local AI Screen Assistant (MVP Scaffold)

Windows-first local desktop assistant that captures screen context and returns actionable UI click-by-click instructions.

## Run

```bash
npm install
npm run build
npm run dev
```

If Electron reports a native module mismatch (for `better-sqlite3`), run:

```bash
npm run rebuild:native
```

Close any running Electron app before rebuilding native modules.

## What is implemented now

- Electron overlay window with global hotkey (`Ctrl+Shift+Space`)
- Screenshot capture on hotkey trigger
- Active-window title detection
- Push-to-talk audio capture from overlay and local STT worker bridge
- Agent orchestration service with:
  - prompt shaping for concrete UI guidance
  - built-in Codex CLI runner with screenshot attachment
  - optional CLI adapter override (`AI_ASSISTANT_AGENT_CMD`)
  - fallback local deterministic answer when local agent execution fails
- SQLite-backed session history per app title

## Environment

Optional environment variables:

- `AI_ASSISTANT_AGENT_CMD` — optional command override executed with full prompt passed on stdin; by default the app uses `codex exec` and attaches the screenshot with `--image`
- `PYTHON_BIN` — custom python executable for STT worker (default: `python`)
- `STT_MODEL_SIZE` — faster-whisper model size (default: `base`)

## STT dependency

Install local Python package for speech recognition:

```bash
pip install faster-whisper
```

If unavailable, app still works with text input.
