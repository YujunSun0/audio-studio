"""The actual work: YouTube download, ffmpeg transcoding and stem separation."""

from __future__ import annotations

import logging
import re
import subprocess
import threading
from pathlib import Path
from typing import Literal
from urllib.parse import quote

from . import models
from .config import MODELS, MODELS_DIR, MP3_BITRATE, ffmpeg_exe, node_exe
from .jobs import Job, JobStore, OutputFile

log = logging.getLogger(__name__)

Format = Literal["mp3", "wav"]
Mode = Literal["2stem", "4stem"]
Quality = Literal["fast", "high"]

# Measured on an RTX 3060 with fp16 autocast, 60 s clip:
#   BS-Roformer overlap 2 -> 16 s, overlap 4 -> 30 s (fp32 default overlap 4 -> 62 s).
QUALITY_PARAMS: dict[Mode, dict[Quality, dict[str, int]]] = {
    "2stem": {"fast": {"overlap": 2}, "high": {"overlap": 4}},
    "4stem": {"fast": {"shifts": 1}, "high": {"shifts": 2}},
}
# Rough realtime factor on that GPU, used only for the "about N seconds" hint.
SPEED: dict[Mode, dict[Quality, float]] = {
    "2stem": {"fast": 3.7, "high": 2.0},
    "4stem": {"fast": 4.0, "high": 2.0},
}

STEM_ORDER = ["original", "vocals", "instrumental", "drums", "bass", "other"]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def safe_name(title: str, fallback: str = "audio") -> str:
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", title).strip().rstrip(".")
    name = re.sub(r"\s+", " ", name)
    return (name or fallback)[:120]


def file_url(job: Job, path: Path) -> str:
    return f"/api/files/{job.id}/{quote(path.name)}"


def add_file(store: JobStore, job: Job, path: Path, stem: str) -> None:
    files = [f for f in job.files if f.stem != stem]
    files.append(OutputFile(name=path.name, stem=stem, url=file_url(job, path)))
    files.sort(key=lambda f: STEM_ORDER.index(f.stem) if f.stem in STEM_ORDER else 99)
    store.update(job, files=files)


def run_ffmpeg(args: list[str], duration: float | None = None, on_progress=None) -> None:
    """Run ffmpeg, optionally reporting progress (0..1) based on output time."""
    cmd = [ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-y", *args]
    if on_progress and duration:
        cmd[1:1] = ["-progress", "pipe:1", "-nostats"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                            encoding="utf-8", errors="replace",
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if on_progress and duration and proc.stdout:
        for line in proc.stdout:
            if line.startswith("out_time_us=") or line.startswith("out_time_ms="):
                try:
                    us = int(line.split("=", 1)[1])
                    on_progress(min(us / 1e6 / duration, 1.0))
                except ValueError:
                    pass
    _, err = proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg 변환 실패: {err.strip()[-400:]}")


def encode(src: Path, dst: Path, fmt: Format, duration: float | None = None, on_progress=None) -> Path:
    if fmt == "mp3":
        args = ["-i", str(src), "-vn", "-map_metadata", "-1", "-c:a", "libmp3lame", "-b:a", MP3_BITRATE, str(dst)]
    else:
        args = ["-i", str(src), "-vn", "-map_metadata", "-1", "-c:a", "pcm_s16le", "-ar", "44100", str(dst)]
    run_ffmpeg(args, duration, on_progress)
    return dst


def probe_duration(path: Path) -> float | None:
    """ffmpeg -i prints 'Duration: HH:MM:SS.xx' on stderr (no ffprobe needed)."""
    proc = subprocess.run([ffmpeg_exe(), "-hide_banner", "-i", str(path)], capture_output=True, text=True,
                          encoding="utf-8", errors="replace",
                          creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", proc.stderr)
    if not m:
        return None
    h, mnt, s = m.groups()
    return int(h) * 3600 + int(mnt) * 60 + float(s)


# ---------------------------------------------------------------------------
# Step 1: YouTube -> audio
# ---------------------------------------------------------------------------

def download_youtube(job: Job, store: JobStore, url: str) -> tuple[Path, str, float | None]:
    import yt_dlp

    store.update(job, stage="download", progress=0.0, message="YouTube에서 오디오를 받는 중")

    def hook(d: dict) -> None:
        if d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate")
            if total:
                store.update(job, progress=round(d.get("downloaded_bytes", 0) / total * 100, 1))

    opts: dict = {
        "format": "bestaudio/best",
        "outtmpl": str(job.dir / "source.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "progress_hooks": [hook],
        "ffmpeg_location": ffmpeg_exe(),
    }
    if node_exe():
        opts["js_runtimes"] = {"node": {"path": node_exe()}}

    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
        if info.get("_type") == "playlist":
            raise RuntimeError("재생목록 링크는 지원하지 않아요. 영상 하나의 링크를 넣어 주세요.")
        downloads = info.get("requested_downloads") or []
        path = Path(downloads[0]["filepath"]) if downloads else Path(ydl.prepare_filename(info))

    title = info.get("title") or "youtube-audio"
    store.update(job, title=title)
    return path, title, info.get("duration")


# ---------------------------------------------------------------------------
# Step 2: separation
# ---------------------------------------------------------------------------

_separators: dict[str, object] = {}
_sep_lock = threading.Lock()


def _get_separator(job: Job, store: JobStore, mode: Mode, out_dir: Path):
    from audio_separator.separator import Separator

    with _sep_lock:
        sep = _separators.get(mode)
        if sep is None:
            models.ensure(mode, lambda pct, msg: store.update(job, stage="load_model", progress=pct, message=msg))
            store.update(job, stage="load_model", progress=None, message="분리 모델을 GPU에 올리는 중")
            sep = Separator(log_level=logging.WARNING, model_file_dir=str(MODELS_DIR),
                            output_dir=str(out_dir), output_format="WAV", use_autocast=True)
            sep.load_model(model_filename=MODELS[mode])
            _separators[mode] = sep
        # Separator writes into its output_dir; point it at this job's folder.
        sep.output_dir = str(out_dir)
        if getattr(sep, "model_instance", None) is not None:
            sep.model_instance.output_dir = str(out_dir)
        return sep


def _stem_of(filename: str) -> str | None:
    for m in re.finditer(r"\(([A-Za-z]+)\)", filename):
        s = m.group(1).lower()
        if s in ("vocals", "instrumental", "drums", "bass", "other"):
            return s
    return None


def separate(job: Job, store: JobStore, src: Path, title: str, mode: Mode, fmt: Format,
             quality: Quality) -> None:
    work = job.dir / "_work"
    work.mkdir(exist_ok=True)

    # Normalize any input (webm/opus/m4a/mp3/...) to 44.1k stereo WAV for the model.
    wav_in = work / "input.wav"
    store.update(job, stage="convert", progress=None, message="분리용 오디오 준비 중")
    run_ffmpeg(["-i", str(src), "-vn", "-ac", "2", "-ar", "44100", "-c:a", "pcm_s16le", str(wav_in)])

    sep = _get_separator(job, store, mode, work)
    label = "보컬과 반주를" if mode == "2stem" else "보컬·드럼·베이스·기타를"
    eta = ""
    if (dur := probe_duration(wav_in)) and dur > 20:
        eta = f" · 약 {max(5, round(dur / SPEED[mode][quality] / 5) * 5)}초 예상"
    store.update(job, stage="separate", progress=None, message=f"{label} 분리하는 중{eta}")
    with _sep_lock:
        sep.output_dir = str(work)
        inst = getattr(sep, "model_instance", None)
        if inst is not None:
            inst.output_dir = str(work)
            # Tune speed/quality on the loaded model instead of reloading it.
            for attr, value in QUALITY_PARAMS[mode][quality].items():
                setattr(inst, attr, value)
        outputs = sep.separate(str(wav_in))

    stems: list[tuple[str, Path]] = []
    for out in outputs:
        p = Path(out)
        if not p.is_absolute():
            p = work / p
        stem = _stem_of(p.name)
        if stem:
            stems.append((stem, p))
    if not stems:
        raise RuntimeError("분리 결과 파일을 찾지 못했어요.")

    labels = {"vocals": "Vocals", "instrumental": "Instrumental", "drums": "Drums",
              "bass": "Bass", "other": "Other"}
    for i, (stem, p) in enumerate(stems):
        store.update(job, stage="encode", progress=round(i / len(stems) * 100, 1),
                     message=f"{labels[stem]} 파일 저장 중")
        dst = job.dir / f"{safe_name(title)} ({labels[stem]}).{fmt}"
        encode(p, dst, fmt)
        add_file(store, job, dst, stem)

    for p in work.iterdir():
        p.unlink(missing_ok=True)
    work.rmdir()


# ---------------------------------------------------------------------------
# Job entrypoints
# ---------------------------------------------------------------------------

def youtube_job(url: str, do_separate: bool, mode: Mode, fmt: Format, quality: Quality):
    def run(job: Job, store: JobStore) -> None:
        src, title, duration = download_youtube(job, store, url)

        store.update(job, stage="convert", progress=0.0, message=f"{fmt.upper()}로 변환 중")
        dst = job.dir / f"{safe_name(title)}.{fmt}"
        encode(src, dst, fmt, duration,
               lambda r: store.update(job, progress=round(r * 100, 1)))
        add_file(store, job, dst, "original")

        if do_separate:
            # Separate from the downloaded source, not the MP3, to avoid a second lossy pass.
            separate(job, store, src, title, mode, fmt, quality)
        src.unlink(missing_ok=True)

    return run


def upload_job(src: Path, title: str, mode: Mode, fmt: Format, quality: Quality):
    def run(job: Job, store: JobStore) -> None:
        store.update(job, title=title)
        separate(job, store, src, title, mode, fmt, quality)
        src.unlink(missing_ok=True)

    return run
