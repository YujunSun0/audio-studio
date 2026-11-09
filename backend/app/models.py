"""Pre-fetch separation model files with mirror fallback.

audio-separator downloads its models from GitHub release assets, which can be
unreachable (504s). It skips any file already present in model_file_dir, so we
fetch the exact files it expects ourselves, trying HuggingFace mirrors first.
"""

from __future__ import annotations

import hashlib
import json
import logging
from functools import lru_cache
from importlib import resources
from pathlib import Path
from typing import Callable

import requests

from .config import MODELS_DIR

log = logging.getLogger(__name__)

HF_POLITREES = "https://huggingface.co/Politrees/UVR_resources/resolve/main/models"
HF_BLANE = "https://huggingface.co/Blane187/all_public_uvr_models/resolve/main"
GH_UVR = "https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models"
GH_SEP = "https://github.com/nomadkaraoke/python-audio-separator/releases/download/model-configs"
FB_DEMUCS = "https://dl.fbaipublicfiles.com/demucs/hybrid_transformer"

# filename audio-separator expects -> candidate URLs (first that works wins)
FILES: dict[str, dict[str, list[str]]] = {
    "2stem": {
        "model_bs_roformer_ep_317_sdr_12.9755.ckpt": [
            f"{HF_POLITREES}/Roformer/BandSplit/model_bs_roformer_ep_317_sdr_12.9755.ckpt",
            f"{HF_BLANE}/model_bs_roformer_ep_317_sdr_12.9755.ckpt",
            f"{GH_SEP}/model_bs_roformer_ep_317_sdr_12.9755.ckpt",
            f"{GH_UVR}/model_bs_roformer_ep_317_sdr_12.9755.ckpt",
        ],
        "model_bs_roformer_ep_317_sdr_12.9755.yaml": [
            f"{HF_POLITREES}/Roformer/BandSplit/config_bs_roformer_ep_317_sdr_12.9755.yaml",
            f"{GH_SEP}/model_bs_roformer_ep_317_sdr_12.9755.yaml",
            f"{GH_UVR}/mdx_model_data/mdx_c_configs/model_bs_roformer_ep_317_sdr_12.9755.yaml",
        ],
    },
    "4stem": {
        **{
            name: [f"{FB_DEMUCS}/{name}", f"{HF_POLITREES}/Demucs/Demucs_v4/{name}"]
            for name in (
                "f7e0c4bc-ba3fe64a.th",
                "d12395a8-e57c48e6.th",
                "92cfc3b6-ef3bcb9c.th",
                "04573f0d-f3cf25b2.th",
            )
        },
        "htdemucs_ft.yaml": [
            f"{HF_POLITREES}/Demucs/Demucs_v4/htdemucs_ft.yaml",
            f"{HF_BLANE}/htdemucs_ft.yaml",
            f"{GH_UVR}/htdemucs_ft.yaml",
        ],
    },
}


def missing(mode: str) -> list[str]:
    return [name for name in FILES[mode] if not (MODELS_DIR / name).is_file()]


def ensure(mode: str, on_progress: Callable[[float | None, str], None] | None = None) -> None:
    """Download any missing files for `mode`. on_progress(percent|None, message)."""
    todo = missing(mode)
    if not todo:
        return

    # Sizes first, so progress covers all files together.
    sizes: dict[str, int] = {}
    for name in todo:
        for url in FILES[mode][name]:
            try:
                r = requests.head(url, allow_redirects=True, timeout=20)
                if r.ok:
                    sizes[name] = int(r.headers.get("content-length") or 0)
                    break
            except requests.RequestException:
                continue
    total = sum(sizes.values()) or None
    done = 0
    mb = f" · {total / 1e6:.0f}MB" if total else ""

    for name in todo:
        dst = MODELS_DIR / name
        last_err: str | None = None
        for url in FILES[mode][name]:
            try:
                done = _download(url, dst, done, total,
                                 lambda pct: on_progress and on_progress(pct, f"분리 모델 다운로드 중 (최초 1회{mb})"))
                last_err = None
                break
            except Exception as e:  # noqa: BLE001 - try the next mirror
                log.warning("download failed %s: %s", url, e)
                last_err = str(e)
        if last_err is not None:
            raise RuntimeError(f"모델 파일({name})을 받지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.")


@lru_cache
def _official_checksums() -> dict[str, str]:
    """SHA-256 map shipped inside audio-separator; mirrors must match it."""
    text = resources.files("audio_separator").joinpath("model-checksums.json").read_text()
    return json.loads(text)["sha256"]


def _download(url: str, dst: Path, done: int, total: int | None, report) -> int:
    part = dst.with_suffix(dst.suffix + ".part")
    digest = hashlib.sha256()
    start = done
    try:
        with requests.get(url, stream=True, allow_redirects=True, timeout=(20, 120)) as r:
            r.raise_for_status()
            with part.open("wb") as f:
                for chunk in r.iter_content(1 << 20):
                    f.write(chunk)
                    digest.update(chunk)
                    done += len(chunk)
                    if total:
                        report(round(min(done / total, 1) * 100, 1))
        expected = _official_checksums().get(dst.name)
        if expected and digest.hexdigest() != expected:
            raise RuntimeError(f"checksum mismatch for {dst.name}")
    except BaseException:
        part.unlink(missing_ok=True)
        # Roll progress back so the next mirror starts from the same place.
        report(round(start / total * 100, 1)) if total else None
        raise
    part.replace(dst)
    return done
