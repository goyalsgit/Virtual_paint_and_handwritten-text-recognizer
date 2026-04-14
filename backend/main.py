import os
import base64
import csv
import json
from datetime import datetime
from pathlib import Path
import mimetypes

mimetypes.add_type("application/javascript", ".mjs")

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

try:
    from .ocr import get_ocr_backend_status, run_ocr
except ImportError:
    from ocr import get_ocr_backend_status, run_ocr

# ═══════════════════════════════════════════════════════════════════
# FASTAPI BACKEND — Air Drawing Web App
#
# What this server does:
#   1. Accepts WebSocket connections from the browser
#   2. Receives the already-drawn canvas image (base64 PNG) from the browser
#   3. Runs OCR using ocr.py (TrOCR) on that drawing
#   4. Sends recognized text back to the browser
#
# What this server does NOT do:
#   - Hand tracking (done in browser with MediaPipe JS)
#   - Air-gesture drawing (done in browser on HTML5 canvas)
#   - Webcam access (browser handles this)
#
# WebSocket message protocol:
#   Browser → Server:
#     { "type": "ocr", "mode": "sentence", "image": "<base64 PNG>" }
#     { "type": "ping" }
#
#   Server → Browser:
#     { "type": "ocr_result", "text": "hello world", "success": true }
#     { "type": "error", "message": "..." }
#     { "type": "pong" }
# ═══════════════════════════════════════════════════════════════════

app = FastAPI()
BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR.parent
FRONTEND_DIR = PROJECT_ROOT / "frontend"
STATIC_DIR = FRONTEND_DIR
MODEL_PATH = PROJECT_ROOT / "hand_landmarker.task"
DATASET_DIR = PROJECT_ROOT / "custom_dataset"
OCR_DEBUG_DIR = PROJECT_ROOT / "artifacts" / "ocr_debug"
IMAGES_DIR = DATASET_DIR / "images"
CSV_PATH = DATASET_DIR / "labels.csv"

# Allow requests from any origin (Vercel frontend, localhost dev)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

def base64_to_cv2(b64_string: str):
    """Convert base64 PNG string -> OpenCV image, preserving alpha when present."""
    # Strip data URL prefix if present
    if "," in b64_string:
        b64_string = b64_string.split(",")[1]
    img_bytes = base64.b64decode(b64_string)
    np_arr = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(np_arr, cv2.IMREAD_UNCHANGED)
    return img


def save_debug_image(image, path: Path):
    if image is None:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    success, encoded = cv2.imencode(".png", image)
    if success:
        path.write_bytes(encoded.tobytes())


def save_debug_ocr_bundle(source_canvas, ocr_input, mode: str, preprocessed: bool = False):
    OCR_DEBUG_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.utcnow().strftime("%Y%m%dT%H%M%S%f")

    if source_canvas is not None:
        save_debug_image(source_canvas, OCR_DEBUG_DIR / "latest_source_canvas.png")
        save_debug_image(source_canvas, OCR_DEBUG_DIR / f"{timestamp}_source_canvas.png")

    if ocr_input is not None:
        save_debug_image(ocr_input, OCR_DEBUG_DIR / "latest_ocr_input.png")
        save_debug_image(ocr_input, OCR_DEBUG_DIR / f"{timestamp}_ocr_input.png")

    meta = {
        "mode": mode,
        "preprocessed": preprocessed,
        "created_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "has_source_canvas": source_canvas is not None,
        "has_ocr_input": ocr_input is not None,
    }
    (OCR_DEBUG_DIR / "latest_request.json").write_text(
        json.dumps(meta, indent=2),
        encoding="utf-8",
    )


class SampleSaveRequest(BaseModel):
    image: str
    text: str
    source: str = "browser"
    mode: str = "word"


def append_manifest_row(image_path: Path, text: str):
    DATASET_DIR.mkdir(parents=True, exist_ok=True)

    row = {
        "image": image_path.name,
        "text": text,
    }

    csv_exists = CSV_PATH.exists()
    with CSV_PATH.open("a", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["image", "text"],
        )
        if not csv_exists:
            writer.writeheader()
        writer.writerow(row)




@app.get("/")
async def root():
    index_path = FRONTEND_DIR / "index.html"
    if index_path.exists():
        return FileResponse(index_path)
    return {"status": "Air Drawing OCR Server running"}

@app.get("/pdfviewer")
async def pdfviewer():
    viewer_path = FRONTEND_DIR / "pdf-viewer.html"
    if viewer_path.exists():
        return FileResponse(viewer_path)
    return {"error": "PDF Viewer not found"}


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "frontend": FRONTEND_DIR.exists(),
        "model": MODEL_PATH.exists(),
        "ocr": get_ocr_backend_status(load_model=False),
    }


@app.get("/hand_landmarker.task")
async def hand_landmarker():
    if MODEL_PATH.exists():
        return FileResponse(
            MODEL_PATH,
            media_type="application/octet-stream",
            filename="hand_landmarker.task",
        )
    return {"error": "Model file not found"}


@app.post("/api/samples")
async def save_sample(payload: SampleSaveRequest):
    text = payload.text.strip()

    if not text:
        raise HTTPException(status_code=400, detail="Sample label is required")

    image = base64_to_cv2(payload.image)
    if image is None:
        raise HTTPException(status_code=400, detail="Could not decode sample image")

    timestamp = datetime.utcnow().strftime("%Y%m%dT%H%M%S%f")
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    image_path = IMAGES_DIR / f"{timestamp}.png"

    save_debug_image(image, image_path)
    append_manifest_row(
        image_path=image_path,
        text=text,
    )

    return {
        "success": True,
        "image": image_path.name,
        "text": text,
        "mode": payload.mode,
    }

class OCRRequest(BaseModel):
    image: str

@app.post("/ocr")
def ocr_endpoint(req: OCRRequest):
    canvas = base64_to_cv2(req.image)
    if canvas is None:
        raise HTTPException(status_code=400, detail="Could not decode image")
    text = run_ocr(canvas, mode="word", preprocessed=False)
    return {"text": text}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("Client connected")

    try:
        while True:
            # Receive message from browser
            data = await websocket.receive_text()
            msg = json.loads(data)

            if msg.get("type") == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
                continue

            if msg.get("type") == "ocr":
                mode = msg.get("mode", "sentence")
                b64_img = msg.get("image", "")
                source_b64 = msg.get("source_image", "")
                preprocessed = bool(msg.get("preprocessed", False))

                if not b64_img:
                    await websocket.send_text(json.dumps({
                        "type": "error",
                        "message": "No image data received"
                    }))
                    continue

                # Decode image
                canvas = base64_to_cv2(b64_img)
                if canvas is None:
                    await websocket.send_text(json.dumps({
                        "type": "error",
                        "message": "Could not decode image"
                    }))
                    continue

                source_canvas = base64_to_cv2(source_b64) if source_b64 else None
                save_debug_ocr_bundle(source_canvas, canvas, mode, preprocessed=preprocessed)

                # Run OCR
                print(
                    f"Running OCR (mode={mode}, preprocessed={preprocessed}, image={canvas.shape})"
                )
                result = run_ocr(canvas, mode=mode, preprocessed=preprocessed)

                if result:
                    await websocket.send_text(json.dumps({
                        "type": "ocr_result",
                        "text": result,
                        "success": True
                    }))
                    print(f"OCR result: '{result}'")
                else:
                    await websocket.send_text(json.dumps({
                        "type": "ocr_result",
                        "text": "",
                        "success": False,
                        "message": "Could not recognize text"
                    }))
    except WebSocketDisconnect:
        print("Client disconnected")
    except Exception as e:
        print(f"Error: {e}")
        try:
            await websocket.send_text(json.dumps({
                "type": "error",
                "message": str(e)
            }))
        except Exception:
            pass
