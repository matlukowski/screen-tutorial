#!/usr/bin/env python3
import json
import sys


def main() -> int:
    if len(sys.argv) < 2:
        print("", end="")
        return 0

    audio_path = sys.argv[1]
    model_size = sys.argv[2] if len(sys.argv) > 2 else "base"

    try:
        from faster_whisper import WhisperModel  # type: ignore
    except Exception:
        # Graceful fallback: no local STT package
        print("")
        return 0

    model = WhisperModel(model_size, device="auto", compute_type="int8")
    segments, _ = model.transcribe(audio_path, vad_filter=True)
    text = " ".join(segment.text.strip() for segment in segments if segment.text).strip()
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
