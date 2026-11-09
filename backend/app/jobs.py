"""In-memory job store with a single worker thread.

There is one GPU, so jobs run strictly one at a time. Each job carries a
`version` counter that increments on every change; the SSE endpoint watches it.
"""

from __future__ import annotations

import logging
import queue
import shutil
import threading
import time
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Callable, Literal

from .config import JOB_TTL_HOURS, JOBS_DIR

log = logging.getLogger(__name__)

Status = Literal["queued", "running", "done", "error"]
Stage = Literal["queued", "download", "convert", "load_model", "separate", "encode", "done"]


@dataclass
class OutputFile:
    name: str  # file name on disk
    stem: str  # "original" | "vocals" | "instrumental" | "drums" | "bass" | "other"
    url: str


@dataclass
class Job:
    id: str
    kind: Literal["extract", "separate", "full"]
    status: Status = "queued"
    stage: Stage = "queued"
    progress: float | None = 0.0  # 0..100, None = indeterminate
    message: str = ""
    title: str = ""
    error: str | None = None
    files: list[OutputFile] = field(default_factory=list)
    created: float = field(default_factory=time.time)
    started: float | None = None
    finished: float | None = None
    version: int = 0
    queue_position: int = 0

    @property
    def dir(self) -> Path:
        return JOBS_DIR / self.id

    def public(self) -> dict:
        d = asdict(self)
        d.pop("version")
        return d


class JobStore:
    def __init__(self) -> None:
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()
        self._queue: queue.Queue[tuple[Job, Callable[[Job, JobStore], None]]] = queue.Queue()
        self._pending: list[str] = []
        threading.Thread(target=self._worker, daemon=True, name="job-worker").start()
        threading.Thread(target=self._janitor, daemon=True, name="job-janitor").start()

    # ---- public API -------------------------------------------------------

    def create(self, kind: Job.__annotations__["kind"]) -> Job:  # type: ignore[valid-type]
        job = Job(id=uuid.uuid4().hex[:12], kind=kind)
        job.dir.mkdir(parents=True, exist_ok=True)
        with self._lock:
            self._jobs[job.id] = job
        return job

    def submit(self, job: Job, fn: Callable[[Job, "JobStore"], None]) -> None:
        with self._lock:
            self._pending.append(job.id)
            self._refresh_positions()
        self._queue.put((job, fn))

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            return self._jobs.get(job_id)

    def update(self, job: Job, **changes) -> None:
        with self._lock:
            for k, v in changes.items():
                setattr(job, k, v)
            job.version += 1

    # ---- internals --------------------------------------------------------

    def _refresh_positions(self) -> None:
        for i, jid in enumerate(self._pending):
            j = self._jobs.get(jid)
            if j:
                j.queue_position = i + 1
                j.version += 1

    def _worker(self) -> None:
        while True:
            job, fn = self._queue.get()
            with self._lock:
                if job.id in self._pending:
                    self._pending.remove(job.id)
                job.queue_position = 0
                self._refresh_positions()
            self.update(job, status="running", started=time.time())
            try:
                fn(job, self)
                self.update(job, status="done", stage="done", progress=100.0,
                            message="완료", finished=time.time())
            except Exception as e:  # noqa: BLE001 - surface any failure to the UI
                log.exception("job %s failed", job.id)
                self.update(job, status="error", error=_friendly_error(e), finished=time.time())

    def _janitor(self) -> None:
        while True:
            cutoff = time.time() - JOB_TTL_HOURS * 3600
            # Disk: remove old job folders, including ones from previous runs.
            for d in JOBS_DIR.iterdir():
                try:
                    if d.is_dir() and d.stat().st_mtime < cutoff:
                        shutil.rmtree(d, ignore_errors=True)
                except OSError:
                    pass
            with self._lock:
                for jid in [j.id for j in self._jobs.values() if j.created < cutoff]:
                    del self._jobs[jid]
            time.sleep(3600)


def _friendly_error(e: Exception) -> str:
    text = str(e).strip() or e.__class__.__name__
    low = text.lower()
    if "sign in to confirm" in low or "not a bot" in low:
        return "YouTube가 요청을 차단했어요. 잠시 후 다시 시도해 주세요."
    if "private video" in low:
        return "비공개 영상이라 받을 수 없어요."
    if "video unavailable" in low:
        return "영상을 찾을 수 없어요. 링크를 확인해 주세요."
    if "failed to download" in low:
        return "모델 파일을 받지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요."
    if "out of memory" in low:
        return "GPU 메모리가 부족해요. 다른 GPU 프로그램을 닫고 다시 시도해 주세요."
    return text[:500]


store = JobStore()
