"""Paths and tunables.

Heavy data (models, job outputs) lives under %LOCALAPPDATA%\\AudioStudio so it is
not synced by OneDrive along with the source code.
"""

import os
import shutil
from functools import lru_cache
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
FRONTEND_DIST = ROOT_DIR / "frontend" / "dist"

DATA_DIR = Path(
    os.environ.get("AUDIO_STUDIO_DATA")
    or Path(os.environ.get("LOCALAPPDATA", Path.home())) / "AudioStudio"
)
JOBS_DIR = DATA_DIR / "jobs"
MODELS_DIR = DATA_DIR / "models"

JOB_TTL_HOURS = 24
MAX_UPLOAD_MB = 300
MP3_BITRATE = "320k"

# Separation models (audio-separator model filenames).
MODELS = {
    # Best-in-class vocal / instrumental split.
    "2stem": "model_bs_roformer_ep_317_sdr_12.9755.ckpt",
    # Vocals / drums / bass / other.
    "4stem": "htdemucs_ft.yaml",
}

for d in (JOBS_DIR, MODELS_DIR):
    d.mkdir(parents=True, exist_ok=True)


BIN_DIR = DATA_DIR / "bin"


@lru_cache
def ffmpeg_exe() -> str:
    """System ffmpeg if available, otherwise the binary bundled with imageio-ffmpeg.

    The bundled binary has a versioned name, so it is copied to bin/ffmpeg.exe and
    that folder is put on PATH: audio-separator and pydub call plain `ffmpeg`.
    """
    found = shutil.which("ffmpeg")
    if found:
        return found
    import imageio_ffmpeg

    src = Path(imageio_ffmpeg.get_ffmpeg_exe())
    BIN_DIR.mkdir(parents=True, exist_ok=True)
    dst = BIN_DIR / ("ffmpeg.exe" if os.name == "nt" else "ffmpeg")
    if not dst.exists() or dst.stat().st_size != src.stat().st_size:
        shutil.copy2(src, dst)
    os.environ["PATH"] = str(BIN_DIR) + os.pathsep + os.environ.get("PATH", "")
    return str(dst)


ffmpeg_exe()  # resolve once at import so PATH is ready before any library looks


@lru_cache
def node_exe() -> str | None:
    """yt-dlp needs a JS runtime to solve YouTube player challenges."""
    return shutil.which("node")
