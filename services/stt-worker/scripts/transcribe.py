#!/usr/bin/env python3
import json
import os
import shutil
import sys


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


def has_windows_cuda_runtime() -> tuple[bool, dict]:
    if sys.platform != "win32":
        return True, {}

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
        "missingDlls": missing_dlls,
        "nvidiaSmiAvailable": shutil.which("nvidia-smi") is not None,
    }

    return len(missing_dlls) == 0, diagnostics


def main() -> int:
    if len(sys.argv) < 2:
        return emit(build_error("invalid_request", "Brak ścieżki do pliku audio."))

    audio_path = sys.argv[1]
    model_size = sys.argv[2] if len(sys.argv) > 2 else "base"

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
                },
            )
        )

    requested_device = os.environ.get("STT_DEVICE", "cpu").strip().lower() or "cpu"
    requested_compute_type = os.environ.get("STT_COMPUTE_TYPE", "").strip() or None
    explicit_language = os.environ.get("STT_LANGUAGE", "").strip() or None

    if requested_device in {"cuda", "auto"}:
        device_candidates = ["cuda", "cpu"]
    else:
        device_candidates = ["cpu"]

    init_failures = []
    model = None
    strategy = None

    for device in device_candidates:
        compute_type = requested_compute_type or ("float16" if device == "cuda" else "int8")

        if device == "cuda":
            has_runtime, runtime_diagnostics = has_windows_cuda_runtime()
            if not has_runtime:
                init_failures.append(
                    {
                        "device": device,
                        "computeType": compute_type,
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
            }
            break
        except Exception as exc:
            init_failures.append(
                {
                    "device": device,
                    "computeType": compute_type,
                    "exceptionType": type(exc).__name__,
                    "exceptionMessage": str(exc),
                }
            )

    if model is None or strategy is None:
        return emit(
            build_error(
                "model_initialization_failed",
                "Nie udało się uruchomić modelu faster-whisper.",
                {"attempts": init_failures},
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
                    "exceptionType": type(exc).__name__,
                    "exceptionMessage": str(exc),
                },
            )
        )


if __name__ == "__main__":
    raise SystemExit(main())
