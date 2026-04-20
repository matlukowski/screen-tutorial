#!/usr/bin/env python3
import json
import os
import shutil
import site
import sys
import sysconfig
from pathlib import Path


def emit(payload: dict) -> int:
    print(json.dumps(payload, ensure_ascii=False))
    return 0


def build_error(code: str, message: str, diagnostics: dict | None = None) -> dict:
    return {
        "status": "error",
        "text": "",
        "errorCode": code,
        "errorMessage": message,
        "diagnostics": diagnostics or {},
    }


def unique_existing_dirs(paths: list[str]) -> list[str]:
    normalized = []
    seen = set()

    for raw_path in paths:
        if not raw_path:
            continue

        try:
            resolved = str(Path(raw_path).resolve())
        except Exception:
            resolved = str(Path(raw_path))

        lowered = resolved.lower()
        if lowered in seen or not os.path.isdir(resolved):
            continue

        seen.add(lowered)
        normalized.append(resolved)

    return normalized


def get_python_runtime_bin_dirs() -> list[str]:
    site_roots = []

    try:
        site_roots.extend(site.getsitepackages())
    except Exception:
        pass

    try:
        site_roots.append(site.getusersitepackages())
    except Exception:
        pass

    for key in ("purelib", "platlib"):
        value = sysconfig.get_paths().get(key)
        if value:
            site_roots.append(value)

    candidates = []

    for root in unique_existing_dirs(site_roots):
        candidates.extend(
            [
                os.path.join(root, "nvidia", "cublas", "bin"),
                os.path.join(root, "nvidia", "cudnn", "bin"),
                os.path.join(root, "nvidia", "cuda_runtime", "bin"),
            ]
        )

    return unique_existing_dirs(candidates)


def get_env_runtime_bin_dirs() -> list[str]:
    raw_value = os.environ.get("STT_CUDA_BIN_DIR", "")
    if not raw_value.strip():
        return []

    return unique_existing_dirs([part.strip() for part in raw_value.split(os.pathsep)])


def get_system_runtime_bin_dirs() -> list[str]:
    candidates = []
    cuda_path = os.environ.get("CUDA_PATH")

    if cuda_path:
        candidates.append(os.path.join(cuda_path, "bin"))

    program_files = os.environ.get("ProgramFiles", r"C:\Program Files")
    cudnn_root = os.path.join(program_files, "NVIDIA", "CUDNN")
    if os.path.isdir(cudnn_root):
        for version_dir in sorted(os.listdir(cudnn_root), reverse=True):
            candidates.append(os.path.join(cudnn_root, version_dir, "bin"))

    return unique_existing_dirs(candidates)


def discover_windows_cuda_bin_dirs() -> dict:
    env_dirs = get_env_runtime_bin_dirs()
    python_dirs = get_python_runtime_bin_dirs()
    system_dirs = get_system_runtime_bin_dirs()

    ordered_dirs = unique_existing_dirs(env_dirs + system_dirs + python_dirs)
    return {
        "allCandidates": ordered_dirs,
        "envCandidates": env_dirs,
        "pythonCandidates": python_dirs,
        "systemCandidates": system_dirs,
    }


def register_windows_cuda_runtime() -> dict:
    if sys.platform != "win32":
        return {
            "registeredDllDirs": [],
            "runtimeCandidates": [],
            "runtimeSource": "non-windows",
        }

    discovery = discover_windows_cuda_bin_dirs()
    registered_dirs = []
    handles = []

    for dll_dir in discovery["allCandidates"]:
        try:
            if hasattr(os, "add_dll_directory"):
                handles.append(os.add_dll_directory(dll_dir))

            registered_dirs.append(dll_dir)
        except Exception:
            continue

    if registered_dirs:
        current_path = os.environ.get("PATH", "")
        os.environ["PATH"] = os.pathsep.join(registered_dirs + [current_path])

    runtime_source = "missing"
    if discovery["envCandidates"]:
        runtime_source = "env"
    elif discovery["systemCandidates"]:
        runtime_source = "system"
    elif discovery["pythonCandidates"]:
        runtime_source = "python-site-packages"

    return {
        "registeredDllDirs": registered_dirs,
        "runtimeCandidates": discovery["allCandidates"],
        "runtimeSource": runtime_source,
        "handleCount": len(handles),
    }


def has_windows_cuda_runtime(runtime_info: dict) -> tuple[bool, dict]:
    if sys.platform != "win32":
        return True, runtime_info

    path_entries = os.environ.get("PATH", "").split(os.pathsep)
    required_dlls = [
        "cudnn_ops64_9.dll",
        "cublas64_12.dll",
    ]
    missing_dlls = []

    for dll_name in required_dlls:
        found = any(os.path.exists(os.path.join(entry, dll_name)) for entry in path_entries if entry)
        if not found:
            missing_dlls.append(dll_name)

    diagnostics = {
        **runtime_info,
        "missingDlls": missing_dlls,
        "nvidiaSmiAvailable": shutil.which("nvidia-smi") is not None,
    }

    return len(missing_dlls) == 0, diagnostics


def main() -> int:
    if len(sys.argv) < 2:
        return emit(build_error("invalid_request", "Brak ścieżki do pliku audio."))

    audio_path = sys.argv[1]
    model_size = sys.argv[2] if len(sys.argv) > 2 else "base"
    requested_device = os.environ.get("STT_DEVICE", "cpu").strip().lower() or "cpu"
    requested_compute_type = os.environ.get("STT_COMPUTE_TYPE", "").strip() or None
    explicit_language = os.environ.get("STT_LANGUAGE", "").strip() or None
    runtime_info = register_windows_cuda_runtime() if requested_device in {"cuda", "auto"} else {
        "registeredDllDirs": [],
        "runtimeCandidates": [],
        "runtimeSource": "not-requested",
    }

    if not os.path.exists(audio_path):
        return emit(build_error("audio_file_missing", "Plik audio nie istnieje.", {"audioPath": audio_path}))

    try:
        from faster_whisper import WhisperModel  # type: ignore
    except Exception as exc:
        return emit(
            build_error(
                "dependency_missing",
                "Nie udało się zaimportować faster-whisper.",
                {
                    "exceptionType": type(exc).__name__,
                    "exceptionMessage": str(exc),
                    **runtime_info,
                },
            )
        )

    if requested_device == "auto":
        device_candidates = ["cuda", "cpu"]
    elif requested_device == "cuda":
        device_candidates = ["cuda"]
    else:
        device_candidates = ["cpu"]

    init_failures = []
    model = None
    strategy = None

    for device in device_candidates:
        compute_type = requested_compute_type or ("float16" if device == "cuda" else "int8")

        if device == "cuda":
            has_runtime, runtime_diagnostics = has_windows_cuda_runtime(runtime_info)
            if not has_runtime:
                init_failures.append(
                    {
                        "device": device,
                        "computeType": compute_type,
                        "errorCode": "gpu_runtime_missing",
                        "exceptionType": "MissingCudaRuntime",
                        "exceptionMessage": "Brak wymaganych bibliotek CUDA/cuDNN dla faster-whisper.",
                        **runtime_diagnostics,
                    }
                )
                continue

        try:
            model = WhisperModel(model_size, device=device, compute_type=compute_type)
            strategy = {
                "requestedDevice": requested_device,
                "device": device,
                "computeType": compute_type,
                "fallbackUsed": device != device_candidates[0],
                "runtimeSource": runtime_info.get("runtimeSource"),
                "registeredDllDirs": runtime_info.get("registeredDllDirs", []),
            }
            break
        except Exception as exc:
            init_failures.append(
                {
                    "device": device,
                    "computeType": compute_type,
                    "exceptionType": type(exc).__name__,
                    "exceptionMessage": str(exc),
                    **runtime_info,
                }
            )

    if model is None or strategy is None:
        error_code = "model_initialization_failed"
        if any(failure.get("errorCode") == "gpu_runtime_missing" for failure in init_failures):
            error_code = "gpu_runtime_missing"

        return emit(
            build_error(
                error_code,
                "Nie udało się uruchomić modelu faster-whisper.",
                {
                    **runtime_info,
                    "attempts": init_failures,
                },
            )
        )

    transcribe_kwargs = {
        "vad_filter": True,
    }

    if explicit_language:
        transcribe_kwargs["language"] = explicit_language

    try:
        segments, info = model.transcribe(audio_path, **transcribe_kwargs)
        segments = list(segments)
        text = " ".join(segment.text.strip() for segment in segments if segment.text).strip()

        diagnostics = {
            "strategy": strategy,
            **runtime_info,
            "segmentCount": len(segments),
            "duration": getattr(info, "duration", None),
            "durationAfterVad": getattr(info, "duration_after_vad", None),
            "language": getattr(info, "language", None),
            "languageProbability": getattr(info, "language_probability", None),
        }

        if not text:
            return emit(
                {
                    "status": "empty",
                    "text": "",
                    "errorCode": "no_speech_detected",
                    "errorMessage": "Nie wykryto mowy w nagraniu.",
                    "diagnostics": diagnostics,
                }
            )

        return emit(
            {
                "status": "ok",
                "text": text,
                "diagnostics": diagnostics,
            }
        )
    except Exception as exc:
        if "max() iterable argument is empty" in str(exc):
            return emit(
                {
                    "status": "empty",
                    "text": "",
                    "errorCode": "no_speech_detected",
                    "errorMessage": "Nie wykryto mowy w nagraniu.",
                    "diagnostics": {
                        "strategy": strategy,
                        **runtime_info,
                        "exceptionType": type(exc).__name__,
                        "exceptionMessage": str(exc),
                    },
                }
            )

        return emit(
            build_error(
                "transcription_failed",
                "Transkrypcja nie powiodła się.",
                {
                    "strategy": strategy,
                    **runtime_info,
                    "exceptionType": type(exc).__name__,
                    "exceptionMessage": str(exc),
                },
            )
        )


if __name__ == "__main__":
    raise SystemExit(main())
