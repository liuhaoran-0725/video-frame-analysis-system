from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

BASE_DIR = Path(__file__).resolve().parent
STORAGE_DIR = BASE_DIR / "storage"
UPLOADS_DIR = STORAGE_DIR / "uploads"
FRAMES_DIR = STORAGE_DIR / "frames"

UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
FRAMES_DIR.mkdir(parents=True, exist_ok=True)

MAX_UPLOAD_MB = 200
MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024
ALLOWED_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".webm"}
ALLOWED_MIME_TYPES = {
    "video/mp4",
    "video/quicktime",
    "video/x-msvideo",
    "video/x-matroska",
    "video/webm",
}

app = FastAPI(title="Frame Extractor API", version="0.1")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/static", StaticFiles(directory=STORAGE_DIR), name="static")


def parse_fps(value: str) -> float:
    if not value:
        return 0.0
    if "/" in value:
        numerator, denominator = value.split("/", 1)
        try:
            num = float(numerator)
            den = float(denominator)
            return num / den if den else num
        except ValueError:
            return 0.0
    try:
        return float(value)
    except ValueError:
        return 0.0


def read_video_fps(video_path: Path) -> float:
    if not shutil.which("ffprobe"):
        return 0.0
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=r_frame_rate",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(video_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        return 0.0
    return parse_fps(result.stdout.strip())


def extract_frames(video_path: Path, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-y",
        "-i",
        str(video_path),
        "-q:v",
        "2",
        "-start_number",
        "1",
        str(output_dir / "%06d.jpg"),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        message = result.stderr.strip() or result.stdout.strip() or "ffmpeg failed"
        raise RuntimeError(message)


def count_frames(output_dir: Path) -> int:
    return len(list(output_dir.glob("*.jpg")))


async def save_upload_file(file: UploadFile, destination: Path) -> int:
    size = 0
    with destination.open("wb") as buffer:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            if size + len(chunk) > MAX_UPLOAD_BYTES:
                size += len(chunk)
                break
            size += len(chunk)
            buffer.write(chunk)
    await file.close()
    return size


@app.post("/api/videos")
async def upload_video(file: UploadFile = File(...)) -> dict:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing file name.")

    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Unsupported file extension.")

    if file.content_type and file.content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported content type.")

    if not shutil.which("ffmpeg"):
        raise HTTPException(status_code=500, detail="ffmpeg not found in PATH.")

    video_id = uuid4().hex
    upload_path = UPLOADS_DIR / f"{video_id}{ext}"

    size = await save_upload_file(file, upload_path)
    if size > MAX_UPLOAD_BYTES:
        upload_path.unlink(missing_ok=True)
        raise HTTPException(status_code=413, detail="File too large.")

    frame_dir = FRAMES_DIR / video_id
    try:
        await run_in_threadpool(extract_frames, upload_path, frame_dir)
        frame_count = await run_in_threadpool(count_frames, frame_dir)
        fps = await run_in_threadpool(read_video_fps, upload_path)
    except RuntimeError as exc:
        shutil.rmtree(frame_dir, ignore_errors=True)
        upload_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"ffmpeg failed: {exc}") from exc

    message = "ok"
    if fps == 0.0:
        message = "ok (fps unavailable)"

    return {
        "video_id": video_id,
        "frame_count": frame_count,
        "fps": fps,
        "message": message,
    }


@app.get("/api/videos/{video_id}/frames")
def list_frames(
    video_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
) -> dict:
    frame_dir = FRAMES_DIR / video_id
    if not frame_dir.exists():
        raise HTTPException(status_code=404, detail="video_id not found.")

    files = sorted(frame_dir.glob("*.jpg"))
    total_frames = len(files)
    start = (page - 1) * page_size
    end = start + page_size
    selected_files = files[start:end]

    frames = []
    for path in selected_files:
        try:
            index = int(path.stem)
        except ValueError:
            index = start + len(frames) + 1
        frames.append(
            {
                "index": index,
                "url": f"/static/frames/{video_id}/{path.name}",
            }
        )

    return {
        "video_id": video_id,
        "page": page,
        "page_size": page_size,
        "total_frames": total_frames,
        "frames": frames,
    }
