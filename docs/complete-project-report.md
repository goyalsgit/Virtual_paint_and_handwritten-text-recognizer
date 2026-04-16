# Air Drawing App - Complete Project Report

## 1. Problem Statement

People should be able to write and interact with documents without touching keyboard, mouse, stylus, or screen.

Main problem:
- Handwriting in air is noisy and unstable.
- Raw hand landmarks jitter heavily.
- OCR models are usually trained on scanned paper handwriting, not thin digital air-drawn strokes.
- Real-time UX requires low latency while OCR is computationally heavy.

Project objective:
- Build a real-time, touchless handwriting system.
- Recognize air-written text using OCR.
- Support practical workflows like PDF annotation and search.
- Keep architecture modular for training, inference, and deployment.

---

## 2. High-Level Solution

The project solves the problem with a split architecture:

1. Browser frontend:
- Captures webcam video.
- Runs hand tracking with MediaPipe.
- Classifies gestures and smooths pointer movement.
- Draws on canvas in real-time.
- Sends processed image to backend via WebSocket.

2. Python backend:
- Hosts UI and static files.
- Receives image payloads over WebSocket.
- Preprocesses and runs TrOCR inference.
- Returns recognized text.
- Saves optional labeled samples for training.

3. Training pipeline:
- Builds train/val/test manifests.
- Fine-tunes TrOCR checkpoint.
- Reuses fine-tuned model in backend.

---

## 3. End-to-End Flow

## 3.1 Main Air Writing Flow

1. User opens root page.
2. Frontend starts camera and MediaPipe model.
3. Each frame:
- Landmarks are detected.
- Gesture is classified.
- Pointer is smoothed.
- Action is mapped (draw, erase, pan, lift, idle).
4. Frontend renders strokes on virtual canvas.
5. After inactivity or manual trigger, frontend builds a clean OCR image.
6. Frontend sends image over WebSocket.
7. Backend decodes image and runs OCR.
8. Backend sends OCR result to frontend.
9. Frontend displays recognized text.

## 3.2 PDF Viewer Flow

1. User opens PDF viewer route.
2. Frontend loads PDF via PDF.js.
3. User activates camera and hand tracking.
4. Gesture state machine controls modes:
- Cursor
- Pen
- Search overlay
- Scroll with fist
5. Search mode captures in-air text on transparent overlay.
6. Overlay image is converted to high-contrast OCR input.
7. OCR text is used to search PDF text layer.
8. Matching pages and highlight overlays are rendered.

## 3.3 Training Flow

1. Samples are collected from app into dataset folder.
2. Labels CSV is converted to train/val/test JSONL manifests.
3. TrOCR is fine-tuned on those manifests.
4. Best checkpoint is saved in artifacts.
5. Backend picks local checkpoint if valid, otherwise fallback model.

---

## 4. Folder-by-Folder Breakdown

## 4.1 backend

Purpose:
- API server, WebSocket OCR pipeline, static serving.

Files:
- backend/main.py
- backend/ocr.py
- backend/requirements.txt
- backend/Dockerfile (legacy/reference Dockerfile)

## 4.2 frontend

Purpose:
- Main air-writing UI and PDF viewer UI.

Files:
- frontend/index.html
- frontend/styles.css
- frontend/pdf-viewer.html
- frontend/css/pdf-viewer.css
- frontend/js/app.js
- frontend/js/config.js
- frontend/js/gestures.js
- frontend/js/pointer-filter.js
- frontend/js/virtual-buttons.js
- frontend/js/pdf-viewer/constants.js
- frontend/js/pdf-viewer/filters.js
- frontend/js/pdf-viewer/main.js
- frontend/vendor/mediapipe/... (local MediaPipe fallback assets)

## 4.3 training

Purpose:
- Manifest generation, model fine-tuning, local prediction tests.

Files:
- training/prepare_manifests.py
- training/train_trocr.py
- training/predict_trocr.py
- training/requirements.txt
- training/trocr_gpu_training_guide.ipynb
- training/README.md (contains stale references, should be updated)

## 4.4 custom_dataset

Purpose:
- Master labeled data.

Files:
- custom_dataset/images/*
- custom_dataset/labels.csv

## 4.5 data/manifests

Purpose:
- Generated split manifests for training.

Files:
- data/manifests/train.jsonl
- data/manifests/val.jsonl
- data/manifests/test.jsonl

## 4.6 artifacts

Purpose:
- OCR debug outputs and model checkpoints.

Key subfolders:
- artifacts/ocr_debug (generated debug images)
- artifacts/trocr_large_model (complete model with weights)
- artifacts/trocr_finetuned (tokenizer/config only, not complete model)
- artifacts/trocr_airdraw/best (currently placeholder only)

## 4.7 docs

Purpose:
- Explanatory documentation.

Files:
- docs/backend-documentation.md (partially outdated paths/model notes)
- docs/project-explanation.md
- docs/project-explanation.pdf
- docs/training/colab-trocr-guide.md
- docs/training/fine-tuning-steps.md

## 4.8 Root files

- README.md (main setup and usage)
- Dockerfile (primary production container file)
- setup.sh (local environment setup)
- main.py (ASGI import shortcut)
- hand_landmarker.task (hand tracking model file)
- .gitignore, .dockerignore

---

## 5. File-by-File Technical Details

## 5.1 backend/main.py

Role:
- FastAPI app creation, CORS, static serving, routes, WebSocket OCR, sample save API.

Important functions:

- base64_to_cv2
  - Problem solved: Browser sends base64 PNG, backend needs OpenCV image.
  - Solution: Decodes data URL to bytes, converts with cv2.imdecode.

- save_debug_image
  - Problem solved: Need image-level debugging for OCR failures.
  - Solution: Encodes PNG and writes to artifact folder.

- save_debug_ocr_bundle
  - Problem solved: Need request trace (source and preprocessed image + metadata).
  - Solution: Stores latest and timestamped artifacts.

- append_manifest_row
  - Problem solved: Add newly collected labeled samples.
  - Solution: Appends image/text row to labels CSV.

- root route
  - Serves main frontend page.

- pdfviewer route
  - Serves PDF viewer page.

- health route
  - Returns server and OCR backend status.

- hand_landmarker route
  - Serves model file if present.

- save_sample route
  - Saves image sample from frontend and appends CSV label.

- websocket_endpoint
  - Core OCR channel.
  - Receives OCR request messages, decodes image, runs OCR, sends response.

Known limitation:
- OCR call is synchronous inside WebSocket loop, so heavy OCR can block that connection while processing.

## 5.2 backend/ocr.py

Role:
- OCR preprocessing, model loading, inference, model fallback logic, output cleanup.

Important functions and class:

- _has_model_files
  - Checks whether directory contains usable model weights.

- _ensure_bgr
  - Normalizes grayscale/alpha images to BGR for OpenCV.

- _to_grayscale
  - Converts to grayscale and normalizes light/dark polarity.

- _ink_mask
  - Detects ink pixels robustly (including alpha channels).

- crop_to_content
  - Crops canvas to handwriting area with padding.

- _split_into_lines
  - Segments multi-line handwriting into line candidates.

- _prepare_trocr_image
  - Main preprocessing for TrOCR.
  - Includes square padding and optional stroke thickening.

- _save_debug_prepared_images
  - Writes prepared OCR images for diagnostics.

- _TrOCREngine class
  - Loads processor and model.
  - Selects CPU/GPU.
  - Predict method handles segmentation and generation.

- _clean_prediction
  - Cleans extra tokens/noise from generated text.

- _preferred_trocr_model_ref
  - Model selection priority:
    1) AIRDRAW_OCR_MODEL env
    2) artifacts/trocr_large_model
    3) artifacts/trocr_airdraw/best
    4) microsoft/trocr-large-handwritten

- get_ocr_backend_status
  - Returns availability and model metadata.

- run_ocr
  - Wrapper used by backend/main.py.

Known limitations:
- Duplicate import line exists for os.
- run_ocr catches broad exceptions and returns empty string, which hides detailed error causes.

## 5.3 frontend/index.html

Role:
- Main UI layout for air-writing app.

Contains:
- Loading overlay.
- Toolbar (tools, OCR actions, sample save, PDF viewer navigation).
- Webcam and draw/overlay canvases.
- OCR result and status bars.
- App module script load.

## 5.4 frontend/styles.css

Role:
- Main page styles for toolbar, canvas area, status bars, overlays.

Problem solved:
- Keeps UI readable and interaction-focused while rendering video and canvases in stacked layers.

## 5.5 frontend/js/config.js

Role:
- Central constants and shared mutable state.

Key responsibilities:
- Resolve WS_URL and BACKEND_URL.
- MediaPipe CDN/local fallback paths.
- Drawing constants (canvas size, brush defaults, gesture thresholds).
- Single shared state object used across modules.

Problem solved:
- Avoids hardcoded scattered constants.
- Provides one source of truth for application state.

## 5.6 frontend/js/pointer-filter.js

Role:
- One Euro filter implementation for smoothing hand pointer coordinates.

Classes:
- LowPassFilter
- OneEuroFilter
- PointFilter

Problem solved:
- Reduces jitter while preserving responsiveness during fast motion.

## 5.7 frontend/js/gestures.js

Role:
- Gesture classification and temporal stabilization.

Functions:
- fingersUp
- isThumbClosed
- isFullFist
- classifyGesture
- updateStableGesture
- isLandmarkOutlier
- addToLandmarkHistory
- resolvePointerAction

Problem solved:
- Converts noisy landmark snapshots into stable, user-intent gestures.

## 5.8 frontend/js/virtual-buttons.js

Role:
- Left-side virtual controls selectable by hover dwell.

Functions:
- initVirtualButtons
- drawVirtualButtons
- checkVirtualButtonDwell

Problem solved:
- Enables touchless color/tool selection.

## 5.9 frontend/js/app.js

Role:
- Main orchestrator for entire air-writing experience.

Major function groups:

1) Core helpers
- clamp, setMode, resetStrokeState, breakStrokePath

2) Mode controls
- setEraserMode, setFocusMode, syncColorButtons

3) Undo/redo
- pushUndoSnapshot, restoreCanvasFromDataUrl, undoLastAction, redoLastAction

4) Drawing and erasing
- beginCanvasAction, drawAtPoint, eraseAtPoint

5) Pan and viewport
- applyPan, resizeCanvases

6) OCR image pipeline
- canvasHasInk, buildOcrImage, buildRawCanvasImage, buildOcrImageAll
- cropInkCanvas, getOcrTargetSize, buildTrainingImage

7) OCR triggers
- triggerOCR, triggerOCRAll, checkAutoOCR

8) Export/data collection
- downloadCanvas, saveCurrentSample

9) Networking
- connectWS

10) Camera + MediaPipe setup
- ensureMediaPipeLoaded, setupMediaPipe, setupCamera

11) Rendering
- drawSkeleton, renderLoop

12) Bootstrapping
- init

Problems solved by this file:
- Real-time draw loop.
- Gesture-to-action mapping.
- OCR request orchestration.
- Connection resilience and auto-reconnect.

Known limitation:
- Undo stack stores full-canvas PNG data URLs, which is memory heavy at large virtual canvas sizes.

## 5.10 frontend/pdf-viewer.html

Role:
- Structure for gesture-enabled PDF viewer page.

Contains:
- Header, toolbar, PDF area, side panel, search panel, virtual toolbar, overlay canvases.

## 5.11 frontend/css/pdf-viewer.css

Role:
- Styles for PDF viewer layout and interaction layers.

Problem solved:
- Clearly separates PDF content, cursor/overlay layers, and gesture controls.

## 5.12 frontend/js/pdf-viewer/constants.js

Role:
- Central constants for PDF viewer behavior.

Includes:
- Scale bounds.
- Search overlay timing and stroke thresholds.
- OCR WebSocket URL resolution.
- Hover dwell and gesture confirmation constants.
- Filter presets.

## 5.13 frontend/js/pdf-viewer/filters.js

Role:
- OneEuroFilter and factory for viewer-specific filters.

Functions/classes:
- OneEuroFilter
- createViewerFilters

Problem solved:
- Separate smoothing profiles for pointer, drawing, overlay writing, and scroll.

## 5.14 frontend/js/pdf-viewer/main.js

Role:
- Complete PDF viewer logic.

Key subsystems and functions:

1) Gesture engine
- classifyGesture
- updateGestureState
- onGestureEnter/onGestureExit

2) PDF rendering
- renderAllPages
- rerenderAtScale
- setupIntersectionObserver
- updatePageInfo
- scrollToPage

3) OCR search overlay
- openSearchOverlay / closeSearchOverlay
- addSearchOverlayPoint
- submitSearchOverlay
- ensureOcrSocket
- requestOcrFromCanvas
- searchPdfByText
- renderSearchResultsList

4) Annotation tools
- addHighlighterPoint / redrawHighlights
- addPenPoint / redrawPenStrokes / finishPenStroke
- notes panel management

5) Interaction helpers
- virtual toolbar hover logic
- cursor drawing helpers
- scroll inertia system

6) Camera + loop
- initHandLandmarker
- startWebcam
- detectLoop

7) App setup and events
- loadPDF
- setActiveTool
- file input, drag-drop, keyboard, toolbar button handlers

Problems solved by this file:
- Integrates PDF.js rendering, gesture interaction, and OCR-driven search in one workflow.

Known complexity risk:
- File is large and handles many concerns, so future changes should keep constants and helpers modular to avoid regressions.

## 5.15 training/prepare_manifests.py

Role:
- Reads labels CSV and writes train/val/test JSONL manifests.

Functions:
- load_labels_csv
- write_jsonl
- main

Problem solved:
- Converts collected data into trainable split format.

## 5.16 training/train_trocr.py

Role:
- Fine-tunes TrOCR using manifests.

Functions/classes:
- load_jsonl
- OCRDataset class
- main

Problem solved:
- Domain adaptation from generic handwriting OCR to app-specific air-writing strokes.

## 5.17 training/predict_trocr.py

Role:
- Quick local inference script for a single image.

Functions:
- ensure_bgr
- to_grayscale
- crop_to_content
- prepare_image
- main

Problem solved:
- Fast checkpoint sanity testing without running full app.

## 5.18 Other important non-code files

- README.md
  - Main setup and usage instructions.

- Dockerfile
  - Main production build file.

- setup.sh
  - Creates venv and installs backend + training dependencies.

- .gitignore
  - Excludes venv, generated manifests, debug artifacts, large checkpoint folders.

- .dockerignore
  - Excludes dev-only files from docker context, but model artifacts are still copied by Dockerfile when present.

- backend/Dockerfile
  - Legacy/reference container file.

- main.py
  - One-line app import for ASGI convenience.

---

## 6. Known Issues and Current Gaps

1. Port conflict during local run
- Existing process on port 8000 can block startup.

2. Documentation drift
- Some docs still mention old dataset/model paths and missing scripts.

3. Artifact ambiguity
- trocr_finetuned folder has tokenizer/config only and no model weights.

4. OCR debugging overhead
- Debug image writes can add IO overhead when enabled frequently.

5. Large memory usage risk
- Full-frame undo snapshots in main drawing app.

---

## 7. Why This Topic vs Others

1. Strong real-world relevance
- Touchless interaction for accessibility and hands-busy scenarios.

2. Multi-disciplinary depth
- Combines computer vision, real-time UI, signal filtering, and transformer OCR.

3. Clear measurable outputs
- OCR quality, latency, robustness under environment variability.

4. Extensible innovation path
- Personalized models, multilingual OCR, offline edge optimization, document workflows.

---

## 8. Innovation and USP

1. Touchless handwriting input with practical OCR output.
2. Real-time gesture-to-canvas UX with adaptive smoothing.
3. Integrated PDF workflow with gesture-based annotation plus OCR search.
4. End-to-end dataset collection and fine-tuning loop inside the same project.

---

## 9. Suggested Next Steps for Report and Viva

1. Keep this report as your technical master document.
2. Add metrics section:
- OCR CER/WER before and after fine-tuning.
- Mean OCR latency.
- Gesture stability success rate.

3. Add ablation table:
- Without smoothing vs with One Euro filter.
- Without preprocessing vs with preprocessing.

4. Add deployment profiles:
- Lightweight runtime image.
- Training environment profile.

5. Update stale docs to match current code paths and model selection order.

---

## 10. Quick One-Paragraph Abstract (Ready to Use)

This project implements a touchless air-writing and document interaction system using browser-based hand tracking and backend OCR inference. Hand landmarks from MediaPipe are stabilized with adaptive filtering and mapped to gestures for draw, erase, pan, and mode control. The frontend generates cleaned handwriting images and streams them over WebSocket to a FastAPI backend, where TrOCR-based recognition converts air-written strokes to digital text. The system extends to gesture-enabled PDF annotation and OCR-assisted search, and includes a full data collection and fine-tuning pipeline to adapt OCR performance to air-drawn handwriting style.

---

## 11. Architecture Deep Dive

## 11.1 Logical Layers

1. Interaction layer (browser)
- Camera input
- Hand landmark detection
- Gesture classification
- Cursor smoothing
- Drawing and virtual UI controls

2. Communication layer
- WebSocket channel for OCR requests and responses
- Lightweight HTTP routes for static pages, health, and model file

3. OCR inference layer (backend)
- Image decoding and preprocessing
- TrOCR model loading and inference
- Postprocessing and response formatting

4. Data and training layer
- Sample collection from live app
- Dataset manifest generation
- Fine-tuning and checkpoint reuse

## 11.2 Runtime Connection Map

1. Main app page
- [frontend/index.html](frontend/index.html) loads [frontend/js/app.js](frontend/js/app.js)
- [frontend/js/app.js](frontend/js/app.js) imports:
  - [frontend/js/config.js](frontend/js/config.js)
  - [frontend/js/pointer-filter.js](frontend/js/pointer-filter.js)
  - [frontend/js/gestures.js](frontend/js/gestures.js)
  - [frontend/js/virtual-buttons.js](frontend/js/virtual-buttons.js)

2. PDF viewer page
- [frontend/pdf-viewer.html](frontend/pdf-viewer.html) loads [frontend/js/pdf-viewer/main.js](frontend/js/pdf-viewer/main.js)
- [frontend/js/pdf-viewer/main.js](frontend/js/pdf-viewer/main.js) imports:
  - [frontend/js/pdf-viewer/constants.js](frontend/js/pdf-viewer/constants.js)
  - [frontend/js/pdf-viewer/filters.js](frontend/js/pdf-viewer/filters.js)

3. Backend app
- [backend/main.py](backend/main.py) imports [backend/ocr.py](backend/ocr.py)
- [backend/main.py](backend/main.py) serves frontend files and handles WebSocket OCR requests
- [backend/ocr.py](backend/ocr.py) performs model loading and prediction

## 11.3 Full Request Path (Main App OCR)

1. User writes in air on main canvas.
2. [frontend/js/app.js](frontend/js/app.js) builds OCR image and source image.
3. JSON is sent over WebSocket to /ws.
4. [backend/main.py](backend/main.py) decodes base64 image.
5. [backend/ocr.py](backend/ocr.py) preprocesses and infers text.
6. Result is returned as OCR result JSON.
7. Frontend updates recognized text bar.

## 11.4 Full Request Path (PDF Search OCR)

1. User selects search mode in PDF viewer.
2. Overlay captures in-air writing.
3. [frontend/js/pdf-viewer/main.js](frontend/js/pdf-viewer/main.js) thresholds image for OCR.
4. WebSocket OCR call is sent.
5. Recognized query string is received.
6. PDF text content is scanned and matched pages are highlighted.

---

## 12. API and Message Contracts

## 12.1 HTTP Endpoints

1. GET /
- Returns [frontend/index.html](frontend/index.html)

2. GET /pdfviewer
- Returns [frontend/pdf-viewer.html](frontend/pdf-viewer.html)

3. GET /health
- Returns backend status and OCR readiness metadata

4. GET /hand_landmarker.task
- Returns model asset file for frontend hand tracking

5. POST /api/samples
- Input JSON fields:
  - image (base64 data URL)
  - text (label)
  - source (optional)
  - mode (optional)
- Output JSON fields:
  - success
  - image
  - text
  - mode

## 12.2 WebSocket Protocol on /ws

Client to server:
- Ping
  - type: ping
- OCR request
  - type: ocr
  - mode: sentence or line or word
  - image: base64 image
  - source_image: optional base64 image
  - preprocessed: boolean

Server to client:
- Pong
  - type: pong
- OCR response success
  - type: ocr_result
  - text
  - success true
- OCR response failure
  - type: ocr_result or error
  - success false or error message

---

## 13. Backend Function-Level Walkthrough

## 13.1 [backend/main.py](backend/main.py)

Core utility functions:

1. base64_to_cv2
- Input: base64 image string
- Output: OpenCV image array
- Problem solved: transport-safe image encoding from browser to backend

2. save_debug_image
- Input: OpenCV image and path
- Output: PNG file on disk
- Problem solved: reproducible OCR debugging

3. save_debug_ocr_bundle
- Input: source image, OCR image, mode, preprocessed flag
- Output: saved debug artifacts and latest request metadata
- Problem solved: full traceability per OCR request

4. append_manifest_row
- Input: saved image path and text label
- Output: labels CSV row append
- Problem solved: online dataset growth from app

Data model:

5. SampleSaveRequest class
- Validates POST /api/samples payload

Routes and handlers:

6. root
- Serves main app page

7. pdfviewer
- Serves PDF viewer page

8. health
- Returns health and OCR backend status

9. hand_landmarker
- Serves hand model file for frontend

10. save_sample
- Saves user-labeled sample and returns metadata

11. websocket_endpoint
- Main OCR loop: receives message, decodes image, runs OCR, sends response

Important design note:
- OCR is called in this handler synchronously, so per-request latency depends on model speed.

## 13.2 [backend/ocr.py](backend/ocr.py)

Model discovery and image normalization:

1. _has_model_files
2. _ensure_bgr
3. _to_grayscale
4. _ink_mask
5. crop_to_content

Segmentation and preprocessing:

6. _split_into_lines
7. _prepare_trocr_image
8. _save_debug_prepared_images

Inference engine:

9. _TrOCREngine class
- constructor loads processor and model
- predict prepares segments and generates text

Cleanup and model selection:

10. _clean_prediction
11. _preferred_trocr_model_ref
12. _local_trocr_checkpoint_dir
13. _get_trocr_engine
14. _trocr_dependencies_ready
15. get_ocr_backend_status
16. run_ocr

Key OCR robustness choices:
- Optional stroke thickening for thin digital ink
- Square padding before TrOCR resize
- Multi-line segmentation for sentence mode

---

## 14. Frontend Function-Level Walkthrough (Main App)

## 14.1 [frontend/js/config.js](frontend/js/config.js)

No runtime functions are exported here.
This file exports constants and one shared mutable state object.

What it solves:
- Centralized configuration
- Shared state across modules without complex state framework

## 14.2 [frontend/js/pointer-filter.js](frontend/js/pointer-filter.js)

1. smoothingFactor
- Computes filter alpha from cutoff and delta time

2. LowPassFilter class
- Basic low-pass primitive for scalar values

3. OneEuroFilter class
- Adaptive smoothing based on motion speed

4. PointFilter class
- Applies One Euro filter to x and y together

What it solves:
- Smooth drawing and stable cursor with low lag

## 14.3 [frontend/js/gestures.js](frontend/js/gestures.js)

1. fingersUp
2. isThumbClosed
3. isFullFist
4. classifyGesture
5. updateStableGesture
6. isLandmarkOutlier
7. addToLandmarkHistory
8. resolvePointerAction

What it solves:
- Stable and human-intent gesture mapping in noisy camera conditions

## 14.4 [frontend/js/virtual-buttons.js](frontend/js/virtual-buttons.js)

1. initVirtualButtons
2. drawVirtualButtons
3. checkVirtualButtonDwell

What it solves:
- Touchless UI interaction for color/tool changes

## 14.5 [frontend/js/app.js](frontend/js/app.js)

Core helper and mode functions:

1. clamp
2. setMode
3. resetStrokeState
4. breakStrokePath
5. setEraserMode
6. setFocusMode
7. syncColorButtons

Undo and state-history functions:

8. pushUndoSnapshot
9. restoreCanvasFromDataUrl
10. undoLastAction
11. redoLastAction
12. beginCanvasAction

Drawing and canvas interaction:

13. drawAtPoint
14. eraseAtPoint
15. applyPan
16. resizeCanvases

OCR image preparation:

17. canvasHasInk
18. buildOcrImage
19. buildRawCanvasImage
20. buildOcrImageAll
21. cropInkCanvas
22. getOcrTargetSize
23. buildTrainingImage

OCR triggering and automation:

24. triggerOCR
25. triggerOCRAll
26. checkAutoOCR

Export and dataset capture:

27. downloadCanvas
28. saveCurrentSample

Networking and model setup:

29. connectWS
30. ensureMediaPipeLoaded
31. setupMediaPipe
32. setupCamera

Render loop and bootstrap:

33. drawSkeleton
34. renderLoop
35. init

Important note:
- This file is the orchestrator. It calls every major module and controls the real-time frame lifecycle.

---

## 15. PDF Viewer Function-Level Walkthrough

## 15.1 [frontend/js/pdf-viewer/constants.js](frontend/js/pdf-viewer/constants.js)

Exports timing, thresholds, filter presets, and OCR WS URL resolution.

## 15.2 [frontend/js/pdf-viewer/filters.js](frontend/js/pdf-viewer/filters.js)

1. OneEuroFilter class
2. createFilter helper
3. createViewerFilters factory

## 15.3 [frontend/js/pdf-viewer/main.js](frontend/js/pdf-viewer/main.js)

Gesture and state machine:

1. dist
2. isFingerExtended
3. classifyGesture
4. updateGestureState
5. onGestureEnter
6. onGestureExit

PDF rendering and navigation:

7. renderAllPages
8. rerenderAtScale
9. setupIntersectionObserver
10. updatePageInfo
11. scrollToPage

Search and OCR overlay flow:

12. normalizeSearchText
13. setSearchStatus
14. updateSearchPreview
15. resizeSearchOverlayCanvas
16. clearSearchOverlayDrawing
17. closeSearchOverlay
18. openSearchOverlay
19. drawSearchOverlayDot
20. drawSearchOverlaySegment
21. addSearchOverlayPoint
22. submitSearchOverlay
23. maybeAutoSubmitSearchOverlay
24. canvasHasInk
25. redrawSearchHighlights
26. clearSearchResults
27. performOcrSearch
28. renderSearchResultsList
29. handleOcrSocketMessage
30. ensureOcrSocket
31. requestOcrFromCanvas
32. buildSearchRects
33. getPageTextContent
34. searchPdfByText

Annotation, drawing, and page-coordinate helpers:

35. getPageUnderCursor
36. screenToPage
37. addHighlighterPoint
38. redrawHighlights
39. addPenPoint
40. finishPenStroke
41. redrawPenStrokes

Scroll inertia:

42. startInertia
43. stopInertia
44. inertiaStep

Virtual toolbar hover logic:

45. clearVirtualHover
46. isPointInsidePaddedRect
47. getNearestVirtualButton
48. beginVirtualHover
49. checkVirtualToolbarHover
50. toggleClickControls

Gesture action handlers and cursors:

51. handlePoint
52. handlePeace
53. drawLaserCursor
54. drawPenCursor
55. drawHighlighterCursor
56. handleFist
57. handleOpen

Skeleton and UI state:

58. drawSkeleton
59. showPill

Notes management:

60. refreshNotesPanel
61. deleteAnnotation
62. clearAllAnnotations
63. exportAnnotations

Loop, startup, and file handling:

64. resizeCursorCanvas
65. detectLoop
66. initHandLandmarker
67. startWebcam
68. loadPDF
69. isPdfFile
70. handlePdfSelection
71. setActiveTool

This module is effectively a mini-application containing: PDF render engine, gesture engine, annotation engine, and OCR-search engine.

---

## 16. Training Pipeline Function-Level Walkthrough

## 16.1 [training/prepare_manifests.py](training/prepare_manifests.py)

1. load_labels_csv
2. write_jsonl
3. main

Purpose:
- Transform labels CSV into reproducible JSONL train/val/test manifests.

## 16.2 [training/train_trocr.py](training/train_trocr.py)

1. load_jsonl
2. OCRDataset class
3. main

Purpose:
- Fine-tune TrOCR and save best checkpoint.

## 16.3 [training/predict_trocr.py](training/predict_trocr.py)

1. ensure_bgr
2. to_grayscale
3. crop_to_content
4. prepare_image
5. main

Purpose:
- Quick offline inference check for one image and model directory.

---

## 17. Complete File Catalog (Current Workspace)

## 17.1 Runtime source and infra files

Root and infra:
- [README.md](README.md)
- [Dockerfile](Dockerfile)
- [setup.sh](setup.sh)
- [main.py](main.py)
- [.gitignore](.gitignore)
- [.dockerignore](.dockerignore)
- [.vscode/settings.json](.vscode/settings.json)
- [hand_landmarker.task](hand_landmarker.task)

Backend:
- [backend/main.py](backend/main.py)
- [backend/ocr.py](backend/ocr.py)
- [backend/requirements.txt](backend/requirements.txt)
- [backend/Dockerfile](backend/Dockerfile)

Frontend main app:
- [frontend/index.html](frontend/index.html)
- [frontend/styles.css](frontend/styles.css)
- [frontend/js/app.js](frontend/js/app.js)
- [frontend/js/config.js](frontend/js/config.js)
- [frontend/js/gestures.js](frontend/js/gestures.js)
- [frontend/js/pointer-filter.js](frontend/js/pointer-filter.js)
- [frontend/js/virtual-buttons.js](frontend/js/virtual-buttons.js)

Frontend PDF viewer:
- [frontend/pdf-viewer.html](frontend/pdf-viewer.html)
- [frontend/css/pdf-viewer.css](frontend/css/pdf-viewer.css)
- [frontend/js/pdf-viewer/constants.js](frontend/js/pdf-viewer/constants.js)
- [frontend/js/pdf-viewer/filters.js](frontend/js/pdf-viewer/filters.js)
- [frontend/js/pdf-viewer/main.js](frontend/js/pdf-viewer/main.js)

Frontend vendor assets:
- [frontend/vendor/mediapipe/vision_bundle.mjs](frontend/vendor/mediapipe/vision_bundle.mjs)
- [frontend/vendor/mediapipe/wasm/vision_wasm_internal.js](frontend/vendor/mediapipe/wasm/vision_wasm_internal.js)
- [frontend/vendor/mediapipe/wasm/vision_wasm_internal.wasm](frontend/vendor/mediapipe/wasm/vision_wasm_internal.wasm)
- [frontend/vendor/mediapipe/wasm/vision_wasm_nosimd_internal.js](frontend/vendor/mediapipe/wasm/vision_wasm_nosimd_internal.js)
- [frontend/vendor/mediapipe/wasm/vision_wasm_nosimd_internal.wasm](frontend/vendor/mediapipe/wasm/vision_wasm_nosimd_internal.wasm)

Training and docs:
- [training/README.md](training/README.md)
- [training/prepare_manifests.py](training/prepare_manifests.py)
- [training/train_trocr.py](training/train_trocr.py)
- [training/predict_trocr.py](training/predict_trocr.py)
- [training/requirements.txt](training/requirements.txt)
- [training/trocr_gpu_training_guide.ipynb](training/trocr_gpu_training_guide.ipynb)
- [docs/backend-documentation.md](docs/backend-documentation.md)
- [docs/project-explanation.md](docs/project-explanation.md)
- [docs/project-explanation.pdf](docs/project-explanation.pdf)
- [docs/training/colab-trocr-guide.md](docs/training/colab-trocr-guide.md)
- [docs/training/fine-tuning-steps.md](docs/training/fine-tuning-steps.md)

## 17.2 Data and generated files

1. Dataset source:
- [custom_dataset/labels.csv](custom_dataset/labels.csv)
- custom_dataset/images with collected PNG samples

2. Generated manifests:
- [data/manifests/train.jsonl](data/manifests/train.jsonl)
- [data/manifests/val.jsonl](data/manifests/val.jsonl)
- [data/manifests/test.jsonl](data/manifests/test.jsonl)

3. Artifacts:
- OCR debug images in artifacts/ocr_debug
- Model checkpoints and tokenizer/config bundles in artifacts model folders

---

## 18. Problem to Solution Mapping (Report-Ready)

1. Problem: Hand jitter causes unstable drawing.
- Solution: Adaptive One Euro filter in [frontend/js/pointer-filter.js](frontend/js/pointer-filter.js).

2. Problem: Gesture misfires from frame noise.
- Solution: Gesture stabilization and outlier rejection in [frontend/js/gestures.js](frontend/js/gestures.js).

3. Problem: Touchless UI needs non-click controls.
- Solution: Hover dwell virtual controls in [frontend/js/virtual-buttons.js](frontend/js/virtual-buttons.js).

4. Problem: OCR poor on thin air strokes.
- Solution: preprocessing, stroke thickening, and model adaptation in [backend/ocr.py](backend/ocr.py).

5. Problem: Need practical document workflow.
- Solution: gesture-enabled PDF annotation and OCR search in [frontend/js/pdf-viewer/main.js](frontend/js/pdf-viewer/main.js).

6. Problem: Need continuous model improvement.
- Solution: in-app sample capture plus training pipeline in [backend/main.py](backend/main.py) and training scripts.

---

## 19. Report Writing Blueprint (Suggested Chapter Structure)

1. Chapter 1: Introduction
- Problem statement
- Motivation
- Objectives

2. Chapter 2: Literature and Existing Gaps
- Traditional OCR systems
- Touch-based annotation systems
- Gap addressed by touchless pipeline

3. Chapter 3: System Architecture
- Frontend and backend split
- Data flow and message contracts
- Module interaction diagrams

4. Chapter 4: Implementation
- Gesture pipeline
- Smoothing and mode handling
- OCR preprocessing and inference
- PDF workflow integration

5. Chapter 5: Results and Evaluation
- OCR qualitative examples
- CER and WER metrics
- Latency and user interaction quality

6. Chapter 6: Conclusion and Future Scope
- Achievements
- Limitations
- Future work: multilingual OCR, edge optimization, personalized adaptation

---

## 20. Final Summary

This codebase is a complete touchless handwriting platform with two user experiences:
- Live air-writing board for OCR text extraction
- Gesture-first PDF viewer for annotation and OCR-assisted search

The architecture is modular, the training loop is integrated, and the model-serving path is production-ready with fallback behavior. The major technical strengths are adaptive signal smoothing, robust gesture state management, and OCR preprocessing aligned to transformer model expectations.
