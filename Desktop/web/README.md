# Video Upload -> Frame Browser MVP

Minimal full-stack system: upload a video, extract frames using FFmpeg, and browse them in a vanilla HTML/CSS/JS UI.

## Project Structure
- `backend/` FastAPI service and FFmpeg extraction
- `frontend/` static UI (upload + frame browser)

## Backend Setup
1. Check FFmpeg:
   - `ffmpeg -version`
2. Install dependencies:
   - `cd backend`
   - `python -m venv .venv`
   - `.\.venv\Scripts\Activate.ps1`
   - `pip install -r requirements.txt`
3. Start the API:
   - `uvicorn main:app --host 0.0.0.0 --port 8000 --reload`

Notes:
- Extraction runs synchronously in the request (MVP choice). Large videos will take longer.
- Storage paths:
  - Uploads: `backend/storage/uploads/`
  - Frames: `backend/storage/frames/<video_id>/`

## Frontend Setup
Option A: open directly
- Open `frontend/index.html` in a browser.

Option B: local static server
- `cd frontend`
- `python -m http.server 5173`
- Open `http://localhost:5173/`

The frontend expects the backend at `http://localhost:8000` (adjust in `frontend/app.js` if needed).

## API
- `POST /api/videos`
  - `multipart/form-data` with `file=<video>`
  - Behavior: saves to `backend/storage/uploads/<video_id>.<ext>`, runs `ffmpeg -i <video> -q:v 2 -start_number 1 backend/storage/frames/<video_id>/%06d.jpg`
  - Response: `{ "video_id": "...", "frame_count": 123, "fps": 30, "message": "..." }`
- `GET /api/videos/{video_id}/frames?page=1&page_size=50`
  - Response includes `frames` with `url` fields like `/static/frames/<video_id>/000001.jpg`
- Static frames:
  - `/static/frames/<video_id>/<frame>.jpg`

## Quick Flow
1. Start backend (`uvicorn main:app --reload`).
2. Open frontend.
3. Upload a video -> wait for extraction.
4. Scroll the frame list or click **Load More**.
5. Click a frame to preview; use Prev/Next or arrow keys to navigate.
