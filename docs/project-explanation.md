# Air Drawing App Project Explanation

## What this project does

Air Drawing App lets a user write in the air with a hand gesture, captures the strokes in the browser, and recognizes the handwriting with TrOCR on the Python backend.

The app is split into two major parts:

- The frontend handles camera access, hand tracking, drawing, and canvas capture.
- The backend receives the canvas image over WebSocket, prepares it for OCR, and returns recognized text.

## High-level architecture

1. The browser opens the webcam and uses MediaPipe hand tracking.
2. The user draws with their index finger on an HTML canvas.
3. When OCR is requested, the frontend sends the canvas image to the backend.
4. The backend decodes the image, crops it to the handwritten content, and prepares it for TrOCR.
5. TrOCR predicts text and the result is sent back to the browser.

## Main folders

- `backend/` contains the FastAPI app and OCR pipeline.
- `frontend/` contains the single-page browser interface and MediaPipe vendor files.
- `training/` contains scripts for manifest creation, fine-tuning, and model testing.
- `data/collected/` stores the collected handwritten samples and manifests.
- `artifacts/` stores OCR debug output and trained model checkpoints.

## Backend

The backend is implemented in `backend/main.py` and `backend/ocr.py`.

`backend/main.py` is responsible for:

- Serving the frontend page.
- Providing a `/health` endpoint.
- Exposing `hand_landmarker.task` for the browser.
- Handling the WebSocket connection used for OCR requests.
- Saving debug copies of the incoming image and OCR input.

`backend/ocr.py` is responsible for:

- Loading the preferred TrOCR model.
- Cropping the handwritten content.
- Converting the image into the format TrOCR expects.
- Running inference on CPU or GPU.
- Cleaning the raw model output into readable text.

## Frontend

The frontend is a self-contained HTML app in `frontend/index.html`.

It provides:

- Webcam preview.
- MediaPipe hand tracking.
- Drawing controls and brush settings.
- OCR mode selection.
- A result bar for recognized text.

The frontend does not perform OCR itself. It only captures and prepares the canvas image before sending it to the backend.

## OCR flow

The OCR pipeline is designed to work with handwritten words or short lines:

- Images are decoded from base64.
- The handwritten region is cropped using ink detection.
- The image is normalized to a clean white background.
- TrOCR processes the image and returns text.
- The backend cleans repeated spaces and removes some obvious noise tokens.

Debug images are written to `artifacts/ocr_debug/` so the preprocessing steps can be inspected.

## Training workflow

The repository also supports training a custom TrOCR model.

The intended workflow is:

1. Collect labeled samples from the app.
2. Build train, validation, and test manifests.
3. Fine-tune TrOCR with the scripts in `training/`.
4. Place the best checkpoint in `artifacts/trocr_airdraw/best`.

If that folder exists, the backend prefers it automatically.

## Deployment

The root `Dockerfile` is the production build path.

It packages:

- the backend,
- the frontend,
- MediaPipe assets,
- `hand_landmarker.task`, and
- any local TrOCR checkpoint stored under `artifacts/`.

## Cleanup notes

I checked the main Python files for syntax problems and did not find any.

One real maintenance issue was the reference `backend/Dockerfile`, which used the wrong Uvicorn target. That has been corrected so the file matches the actual module path used by the app.

I also cleaned a few unused imports and formatting issues in the backend to make the code easier to maintain.