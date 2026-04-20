# Local AI Screen Assistant

Windows-first local desktop assistant that captures screen context and returns actionable UI click-by-click instructions.

## Run

```bash
npm install
npm run build
npm start
```

If Electron reports a native module mismatch for `better-sqlite3`, run:

```bash
npm run rebuild:native
```

Close any running Electron app before rebuilding native modules.

## What is implemented

- Electron overlay window with global hotkey (`Ctrl+Shift+Space`)
- Screenshot capture on hotkey trigger
- Active-window title detection
- Voice capture from the overlay and a local STT worker bridge
- Agent orchestration service with:
  - prompt shaping for concrete UI guidance
  - built-in Codex CLI runner with screenshot attachment
  - optional CLI adapter override (`AI_ASSISTANT_AGENT_CMD`)
  - fallback local deterministic answer when local agent execution fails
- SQLite-backed session history per app title

## Environment

Optional environment variables:

- `AI_ASSISTANT_AGENT_CMD` - optional command override executed with the full prompt passed on stdin; by default the app uses `codex exec` and attaches the screenshot with `--image`
- `PYTHON_BIN` - custom Python executable for the STT worker (default: `python`)
- `STT_MODEL_SIZE` - faster-whisper model size (default: `base`)
- `STT_DEVICE` - `cpu`, `cuda`, or `auto` (default: `cpu`)
- `STT_COMPUTE_TYPE` - optional compute override, e.g. `float16` for CUDA
- `STT_CUDA_BIN_DIR` - optional semicolon-separated list of CUDA/cuDNN `bin` directories

The desktop app loads `.env` from the repo root if the file exists.

## STT dependency

Install local Python package for speech recognition:

```bash
pip install faster-whisper
```

If unavailable, the app still works with text input.

## GPU STT on Windows

The current STT stack can use an NVIDIA GPU, but the Python process must see the CUDA/cuDNN runtime libraries.

Recommended runtime install:

```bash
py -m pip install --upgrade setuptools pip wheel
py -m pip install nvidia-cublas-cu12 nvidia-cudnn-cu12
```

The app automatically looks for runtime DLLs in:

- `STT_CUDA_BIN_DIR`
- `%CUDA_PATH%\bin`
- `C:\Program Files\NVIDIA\CUDNN\v9*\bin`
- Python `site-packages\nvidia\cublas\bin`
- Python `site-packages\nvidia\cudnn\bin`

To force GPU:

```bash
STT_DEVICE=cuda
STT_COMPUTE_TYPE=float16
```

To prefer GPU but fall back to CPU:

```bash
STT_DEVICE=auto
```

If GPU init fails, the worker returns structured diagnostics describing which runtime directories were discovered and which DLLs were still missing.
