# Air Drawing BTP — Architecture & Codebase Guide

This document provides a highly detailed breakdown of your **Hand Gesture Text Recognizer** (Air Drawing App). You can use this guide to explain the structure to your BTP guides/Professors.

---

## 1. High-Level Architecture Overview

Your project is built using a modern **decoupled architecture**:
*   **Frontend (Browser):** Handles real-time video capture, MediaPipe hand-tracking, gesture logic, and drawing rendering. Written in HTML + vanilla JavaScript.
*   **Backend (Server):** Handles the heavy AI computation. Receives image data via WebSockets and runs the PyTorch Transformer models (TrOCR) to convert handwriting images into digital text. Written in Python (FastAPI).

By separating the heavy AI from the smooth browser drawing, the app achieves real-time 60FPS drawing performance while asynchronously processing the OCR.

---

## 2. Complete Folder & File Structure

```text
air-drawing-app/
├── backend/                  ← Python Server & AI logic
│   ├── main.py               ← FastAPI WebSocket server
│   └── ocr.py                ← TrOCR Model loading & inference
├── frontend/                 ← Browser UI & Logic
│   ├── index.html            ← Main UI structure
│   ├── styles.css            ← CSS styling
│   └── js/                   ← Modular JavaScript
│       ├── app.js            ← Main entry point & render loop
│       ├── config.js         ← Shared state & constants
│       ├── gestures.js       ← Hand tracking logic
│       ├── pointer-filter.js ← Smoothing algorithm for jitter
│       └── virtual-buttons.js← Gesture-based UI controls
├── artifacts/                ← Stored AI Models
│   ├── trocr_large_model/    ← The 2.4GB Fine-Tuned Model
│   └── ...                   
├── custom_dataset/           ← Your collected training data
│   ├── images/               ← Saved handwriting PNGs
│   └── labels.csv            ← Correct text for each image
├── training/                 ← Scripts used in Google Colab
│   ├── train_trocr.py        ← PyTorch training script
│   └── prepare_manifests.py  ← CSV to JSONL converter
├── venv/                     ← Python Virtual Environment
├── requirements.txt          ← Python Dependencies
└── .gitignore                ← Files Git should ignore
```

---

## 3. Frontend Breakdown — How the Web UI Works

The frontend has been completely refactored into clean, modular files.

### `frontend/index.html` & `frontend/styles.css`
*   **Working:** Contains only the structure (video element, two HTML5 text `<canvas>` layers: `draw-canvas` for the ink, and `overlay-canvas` for the skeleton and virtual buttons).

### `frontend/js/config.js`
*   **Working:** Contains all the "Shared State". Because the drawing system is complex, variables like `state.colorIdx`, `state.brushSize`, and `state.eraserMode` are kept here. If the user selects a color in `virtual-buttons.js`, the state updates here so that `app.js` instantly knows to change the ink color.

### `frontend/js/pointer-filter.js` (Crucial for BTP)
*   **Working:** Implements the **"One Euro Filter"**. 
*   **Why it's needed:** AI Hand-tracking points constantly jitter/shake. If we drew directly based on the raw landmark, the line would look zig-zagged. The One Euro Filter applies dynamic low-pass smoothing: when moving fast, it reduces smoothing to eliminate lag; when moving slow, it increases smoothing to eliminate jitter.

### `frontend/js/gestures.js` 
*   **Working:** Analyzes the 21 3D landmarks returned by MediaPipe.
*   **Functions:**
    *   `fingersUp()`: Checks finger tip Y-coordinates against the inner joints to mathematically determine if a finger is "open" or "folded".
    *   `classifyGesture()`: Maps finger states to actions (e.g., Index Up = DRAW, Fist = ERASE, 3 Fingers = PAN).
    *   `isLandmarkOutlier()`: Rejects frames where the hand jumps by more than 25% of the screen in a microsecond (prevents random lines across the screen).

### `frontend/js/app.js`
*   **Working:** The central orchestrator. Starts the webcam, initializes MediaPipe, and runs `renderLoop()`.
*   **renderLoop():** Runs 60 times a second using `requestAnimationFrame`. It grabs the hand coordinates, passes them through the One Euro Filter, classifies the gesture, and either draws ink on the context (`dCtx`), or moves the canvas ("panning").
*   **Auto-OCR:** Triggers the WebSocket automatically after 2.5 seconds of user inactivity.

---

## 4. Backend Breakdown — How the AI Works

The backend proves that the project runs a true local PyTorch AI model.

### `backend/main.py`
*   **Working:** A lightweight `FastAPI` server. Instead of normal HTTP requests, it runs a real-time **WebSocket** (`@app.websocket("/ws")`). This allows continuous two-way communication between the browser and the Python model without overhead logic.

### `backend/ocr.py` (The Core AI Engine)
*   **Working:** This file loads the HuggingFace `transformers` library.
*   **Model Loading:** It checks the `artifacts/trocr_large_model` directory. If it finds `model.safetensors`, it loads the **VisionEncoderDecoderModel** straight into RAM using your custom weights.
*   **Image Preparation (`_prepare_trocr_image`):** 
    1. TrOCR is very picky. It expects a white background and specific proportions.
    2. We pad the incoming images to a square shape so that when the AI resizes it to 384x384 internally, the text aspect ratio doesn't distort.
    3. We use `cv2.dilate` to "thicken" the digital air-drawn strokes so they look like thick pen strokes (which the model handles better).
*   **Inference (`predict`):** The processed image is fed into the Vision Encoder (which extracts visual features) and then to the Decoder (which generates the text tokens beam-by-beam). It returns the final recognized string to the WebSocket.

---

## 5. Datasets & Fine-Tuning 

### `custom_dataset/`
*   **Purpose:** Pre-trained models (like the generic Microsoft one) are trained on paper documents (the IAM dataset). They fail on our UI because air-strokes don't look like paper ink.
*   **Working:** Every time you drew text and clicked "Save Sample", it generated a cropped, perfectly sized PNG and appended a row to `labels.csv`. You collected exactly *216 validated samples*.

### `training/`
*   **Working:** `prepare_manifests.py` reads `labels.csv` and splits the 216 samples into a Training Set (for learning), a Validation Set (to test its accuracy during training), and a Test Set. 
*   **Google Colab:** Because training requires 16GB+ of VRAM, the `train_trocr.py` script was designed to be run in Google Colab on a free Tesla T4 GPU. It modifies the weights of the Microsoft architecture using backpropagation to specifically memorize the unique visual patterns of your air-drawn application.

---

## 6. What was just done:

Per your request:
1. I ignored `artifacts/trocr_finetuned/` inside `.gitignore` so your Git history stays protected.
2. I permanently deleted the `artifacts/ocr_debug` folder, which was just caching thousands of processed images taking up space.
3. Your deployment setup is perfect. The requirements in `training/requirements.txt` correctly mandate PyTorch and Transformers. The file structure is explicitly split by concerns (Frontend, Backend, ML).

When explaining this to the BTP panel, focus on:
1. The real-time decoupling (WebSockets).
2. The mathematical smoothing (One Euro Filter).
3. The custom fine-tuning pipeline required to bridge the domain gap between "paper" models and "digital" canvas inputs.
