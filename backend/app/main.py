from __future__ import annotations

import asyncio
import json
import logging
import re
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import pipeline
from .config import FRONTEND_DIST, MAX_UPLOAD_MB
from .jobs import store

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = FastAPI(title="Audio Studio")
app.add_middleware(  # Vite dev server
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

YOUTUBE_RE = re.compile(r"^https?://([a-z0-9-]+\.)?(youtube\.com|youtu\.be|youtube-nocookie\.com)/", re.I)
AUDIO_EXT = {".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg", ".opus", ".webm", ".mp4", ".wma", ".aiff", ".aif"}


class YoutubeRequest(BaseModel):
    url: str
    separate: bool = False
    mode: Literal["2stem", "4stem"] = "2stem"
    format: Literal["mp3", "wav"] = "mp3"
    quality: Literal["fast", "high"] = "fast"


@app.get("/api/health")
def health() -> dict:
    info: dict = {"ok": True, "gpu": None}
    try:
        import torch

        if torch.cuda.is_available():
            info["gpu"] = torch.cuda.get_device_name(0)
    except Exception:  # noqa: BLE001
        pass
    return info


@app.post("/api/jobs/youtube")
def create_youtube_job(req: YoutubeRequest) -> dict:
    url = req.url.strip()
    if not YOUTUBE_RE.match(url):
        raise HTTPException(400, "YouTube 링크를 입력해 주세요.")
    job = store.create("full" if req.separate else "extract")
    store.submit(job, pipeline.youtube_job(url, req.separate, req.mode, req.format, req.quality))
    return job.public()


@app.post("/api/jobs/upload")
async def create_upload_job(
    file: UploadFile = File(...),
    mode: Literal["2stem", "4stem"] = Form("2stem"),
    format: Literal["mp3", "wav"] = Form("mp3"),
    quality: Literal["fast", "high"] = Form("fast"),
) -> dict:
    name = file.filename or "audio"
    ext = Path(name).suffix.lower()
    if ext not in AUDIO_EXT:
        raise HTTPException(400, "지원하지 않는 파일 형식이에요.")

    job = store.create("separate")
    dst = job.dir / f"upload{ext}"
    size = 0
    with dst.open("wb") as f:
        while chunk := await file.read(1 << 20):
            size += len(chunk)
            if size > MAX_UPLOAD_MB << 20:
                f.close()
                dst.unlink(missing_ok=True)
                raise HTTPException(413, f"파일은 {MAX_UPLOAD_MB}MB까지 올릴 수 있어요.")
            f.write(chunk)

    store.submit(job, pipeline.upload_job(dst, Path(name).stem, mode, format, quality))
    return job.public()


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    job = store.get(job_id)
    if not job:
        raise HTTPException(404, "작업을 찾을 수 없어요.")
    return job.public()


@app.get("/api/jobs/{job_id}/events")
async def job_events(job_id: str, request: Request) -> StreamingResponse:
    job = store.get(job_id)
    if not job:
        raise HTTPException(404, "작업을 찾을 수 없어요.")

    async def stream():
        last = -1
        while not await request.is_disconnected():
            if job.version != last:
                last = job.version
                yield f"data: {json.dumps(job.public(), ensure_ascii=False)}\n\n"
                if job.status in ("done", "error"):
                    return
            await asyncio.sleep(0.25)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/files/{job_id}/{name}")
def get_file(job_id: str, name: str, download: bool = False) -> FileResponse:
    job = store.get(job_id)
    if not job or not any(f.name == name for f in job.files):
        raise HTTPException(404, "파일을 찾을 수 없어요.")
    path = job.dir / name
    if not path.is_file():
        raise HTTPException(404, "파일이 만료됐어요.")
    media = "audio/mpeg" if path.suffix == ".mp3" else "audio/wav"
    return FileResponse(path, media_type=media,
                        filename=name if download else None,
                        content_disposition_type="attachment" if download else "inline")


# Built frontend (npm run build). In dev, use the Vite server on :5173 instead.
if FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
