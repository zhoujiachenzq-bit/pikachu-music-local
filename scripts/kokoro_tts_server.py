"""Small loopback-only TTS sidecar for hexgrad/Kokoro-82M-v1.1-zh."""

from __future__ import annotations

import argparse
import io
import json
import os
import re
import threading
import wave
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

MODEL_ID = "hexgrad/Kokoro-82M-v1.1-zh"
SAMPLE_RATE = 24_000
MAX_BODY_BYTES = 32 * 1024
MAX_TEXT_LENGTH = 1_500
VOICE_PATTERN = re.compile(r"^z[fm]_\d{3}$")
_load_lock = threading.Lock()
_inference_lock = threading.Lock()
_pipeline: Any = None
_model: Any = None


def clean_text(value: str) -> str:
    value = re.sub(r"https?://\S+", "链接", value)
    value = re.sub(r"```[\s\S]*?```", "", value)
    value = re.sub(r"[`*_#>]", "", value)
    value = re.sub(r"\[([^\]]+)]\([^)]*\)", r"\1", value)
    return re.sub(r"\s+", " ", value).strip()


def text_chunks(text: str, maximum: int = 180) -> list[str]:
    sentences = [part.strip() for part in re.split(r"(?<=[。！？!?；;])\s*", text) if part.strip()]
    chunks: list[str] = []
    for sentence in sentences:
        while len(sentence) > maximum:
            boundary = max(sentence.rfind(mark, 0, maximum) for mark in "，、,:：")
            boundary = boundary + 1 if boundary >= maximum // 2 else maximum
            chunks.append(sentence[:boundary].strip())
            sentence = sentence[boundary:].strip()
        if sentence:
            if chunks and len(chunks[-1]) + len(sentence) <= maximum:
                chunks[-1] += sentence
            else:
                chunks.append(sentence)
    return chunks or [text]


def load_pipeline() -> Any:
    global _pipeline, _model
    if _pipeline is not None:
        return _pipeline
    with _load_lock:
        if _pipeline is not None:
            return _pipeline
        import torch
        from kokoro import KModel, KPipeline

        torch.set_num_threads(max(1, min(8, int(os.getenv("KOKORO_TORCH_THREADS", "6")))))
        _model = KModel(repo_id=MODEL_ID).to("cpu").eval()
        # misaki's optional English pipeline currently exits the Windows process when
        # espeak-ng-loader exposes its build-machine data path. Mandarin G2P works
        # independently, so keep the local service available instead of loading it.
        _pipeline = KPipeline(lang_code="z", repo_id=MODEL_ID, model=_model, en_callable=None)
        return _pipeline


def result_audio(result: Any) -> Any:
    audio = getattr(result, "audio", None)
    if audio is None and isinstance(result, tuple) and len(result) >= 3:
        audio = result[2]
    if audio is None:
        return None
    if hasattr(audio, "detach"):
        audio = audio.detach()
    if hasattr(audio, "cpu"):
        audio = audio.cpu()
    if hasattr(audio, "numpy"):
        audio = audio.numpy()
    return audio


def synthesize(text: str, voice: str, speed: float) -> bytes:
    import numpy as np

    pipeline = load_pipeline()
    sections = []
    silence = np.zeros(int(SAMPLE_RATE * 0.075), dtype=np.float32)
    with _inference_lock:
        for chunk in text_chunks(text):
            for result in pipeline(chunk, voice=voice, speed=speed):
                audio = result_audio(result)
                if audio is not None and len(audio):
                    sections.append(np.asarray(audio, dtype=np.float32).reshape(-1))
            sections.append(silence)
    if not sections:
        raise RuntimeError("KOKORO_EMPTY_AUDIO")
    samples = np.clip(np.concatenate(sections[:-1]), -1.0, 1.0)
    pcm = (samples * 32767.0).astype("<i2").tobytes()
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE)
        wav.writeframes(pcm)
    return output.getvalue()


class Handler(BaseHTTPRequestHandler):
    server_version = "ZhenqiKokoro/1"

    def send_json(self, status: int, payload: dict[str, Any]) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        if self.path != "/health":
            self.send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "NOT_FOUND"})
            return
        self.send_json(HTTPStatus.OK, {"ok": True, "service": "kokoro-local", "model": MODEL_ID, "loaded": _pipeline is not None})

    def do_POST(self) -> None:
        if self.path != "/synthesize":
            self.send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "NOT_FOUND"})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size <= 0 or size > MAX_BODY_BYTES:
                raise ValueError("BODY_SIZE_INVALID")
            payload = json.loads(self.rfile.read(size))
            text = clean_text(str(payload.get("text", "")))
            voice = str(payload.get("voice", "zf_001"))
            speed = float(payload.get("speed", 1.0))
            if not text or len(text) > MAX_TEXT_LENGTH:
                raise ValueError("TEXT_LENGTH_INVALID")
            if not VOICE_PATTERN.fullmatch(voice):
                raise ValueError("VOICE_INVALID")
            if not 0.75 <= speed <= 1.25:
                raise ValueError("SPEED_INVALID")
            audio = synthesize(text, voice, speed)
            if len(audio) > 12 * 1024 * 1024:
                raise ValueError("AUDIO_TOO_LARGE")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(audio)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(audio)
        except ValueError as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(error)})
        except Exception as error:
            print(f"kokoro synthesis failed: {type(error).__name__}", flush=True)
            self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": "SYNTHESIS_FAILED"})

    def log_message(self, format_string: str, *args: Any) -> None:
        print(f"kokoro {self.address_string()} {format_string % args}", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8791)
    parser.add_argument("--warmup-only", action="store_true")
    args = parser.parse_args()
    if args.warmup_only:
        audio = synthesize("晚上好，我是珍奇。", "zf_001", 1.0)
        print(f"Kokoro ready ({len(audio)} WAV bytes).")
        return
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"Kokoro local TTS listening on http://127.0.0.1:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
