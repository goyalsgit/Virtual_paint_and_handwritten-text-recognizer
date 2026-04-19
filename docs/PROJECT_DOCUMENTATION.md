# Air Drawing App - Complete B.Tech Project Documentation

## 📋 Table of Contents
1. [Project Overview](#project-overview)
2. [How It Works - Complete Flow](#how-it-works)
3. [Architecture & Technology Stack](#architecture)
4. [Current Issues & Solutions](#issues)
5. [Optimization Guide](#optimization)
6. [Deployment Options](#deployment)
7. [Flowcharts & Diagrams](#flowcharts)

---

## 1. Project Overview

### What is This Project?
An **AI-powered Air Drawing Application** that lets users:
- Write in the air using hand gestures (tracked by webcam)
- Convert handwriting to text using a **locally fine-tuned TrOCR model**
- View PDFs with gesture-based controls
- No API calls - everything runs locally

### Why Local Model?
✅ **No API dependency** - Works offline  
✅ **No API costs** - Free to use  
✅ **Privacy** - Data stays on your machine  
✅ **Customizable** - Fine-tuned for your handwriting style  
✅ **Fast** - No network latency

### Key Features
1. **Air Drawing Canvas** - Draw with index finger, erase with fist
2. **OCR Recognition** - Converts drawings to text using TrOCR
3. **PDF Viewer** - Gesture-controlled PDF navigation
4. **Training System** - Collect samples and fine-tune the model
5. **Real-time WebSocket** - Instant communication between frontend and backend

---

## 2. How It Works - Complete Flow

### 🎯 MAIN APPLICATION FLOW

```
┌─────────────────────────────────────────────────────────────┐
│                    USER OPENS BROWSER                        │
│                  http://localhost:8000                       │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              FRONTEND LOADS (index.html)                     │
│  • Requests camera permission                                │
│  • Downloads MediaPipe hand tracking model                   │
│  • Connects WebSocket to backend                             │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│           MEDIAPIPE HAND TRACKING STARTS                     │
│  • Webcam captures video frames (60 FPS)                     │
│  • MediaPipe detects 21 hand landmarks                       │
│  • JavaScript classifies gestures                            │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              GESTURE CLASSIFICATION                          │
│                                                              │
│  INDEX FINGER UP     → Draw mode                             │
│  INDEX + MIDDLE UP   → Pen lift (cursor only)               │
│  FIST (all down)     → Erase mode                            │
│  3 FINGERS UP        → Pan canvas                            │
│  OPEN HAND           → Idle/Ready                            │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                 DRAWING ON CANVAS                            │
│  • Finger position mapped to screen coordinates              │
│  • Smoothing filter reduces jitter                           │
│  • Ink drawn on HTML5 canvas (virtual 4000x3000px)           │
│  • Undo/redo stack maintains history                         │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              AUTO-OCR TRIGGER                                │
│  Conditions:                                                 │
│  • 3.5 seconds of no drawing activity                        │
│  • Hand absent for 2 seconds                                 │
│  • 6 seconds since last OCR request                          │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│           IMAGE PREPROCESSING (Frontend)                     │
│  1. Extract visible viewport from canvas                     │
│  2. Convert colored ink to black-on-white                    │
│  3. Crop to content bounding box (+ padding)                 │
│  4. Scale to target size (320x120 for word mode)             │
│  5. Center on white background                               │
│  6. Convert to base64 PNG                                    │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│          WEBSOCKET MESSAGE TO BACKEND                        │
│  {                                                           │
│    "type": "ocr",                                            │
│    "mode": "sentence",                                       │
│    "image": "data:image/png;base64,iVBORw0KG...",            │
│    "preprocessed": true                                      │
│  }                                                           │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│         BACKEND RECEIVES (backend/main.py)                   │
│  • WebSocket handler receives message                        │
│  • Decodes base64 image to OpenCV format                     │
│  • Saves debug images (optional)                             │
│  • Calls run_ocr() function                                  │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│           OCR PROCESSING (backend/ocr.py)                    │
│                                                              │
│  Step 1: Load TrOCR Model (cached)                           │
│    • Check artifacts/trocr_large_model/ for weights          │
│    • Load VisionEncoderDecoderModel                          │
│    • Load TrOCRProcessor (tokenizer)                         │
│    • Move model to GPU if available, else CPU                │
│                                                              │
│  Step 2: Image Preprocessing                                 │
│    • Convert to grayscale                                    │
│    • Apply bilateral filter (noise reduction)                │
│    • Threshold to binary (black ink on white)                │
│    • Pad to square aspect ratio                              │
│    • Dilate strokes (thicken thin air-drawn lines)           │
│                                                              │
│  Step 3: Line Segmentation (for sentence mode)               │
│    • Detect horizontal ink activity                          │
│    • Split into individual lines                             │
│    • Process each line separately                            │
│                                                              │
│  Step 4: TrOCR Inference                                     │
│    • Resize image to 384x384 (TrOCR input size)              │
│    • Convert to pixel values tensor                          │
│    • Run model.generate() with beam search                   │
│    • Decode token IDs to text                                │
│                                                              │
│  Step 5: Post-processing                                     │
│    • Clean whitespace                                        │
│    • Remove leading noise digits/symbols                     │
│    • Join multi-line results                                 │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│         WEBSOCKET RESPONSE TO FRONTEND                       │
│  {                                                           │
│    "type": "ocr_result",                                     │
│    "text": "hello world",                                    │
│    "success": true                                           │
│  }                                                           │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              DISPLAY RESULT                                  │
│  • Frontend receives WebSocket message                       │
│  • Updates OCR result bar with recognized text               │
│  • User can save as training sample                          │
└─────────────────────────────────────────────────────────────┘
```

### 🔄 TRAINING DATA COLLECTION FLOW

```
User draws → Clicks "Save Sample" → Enters correct text
                                    ↓
                    Image saved to custom_dataset/images/
                                    ↓
                    Label appended to custom_dataset/labels.csv
                                    ↓
                    Run: python training/prepare_manifests.py
                                    ↓
                    Creates train/val/test splits in data/manifests/
                                    ↓
                    Run: python training/train_trocr.py
                                    ↓
                    Fine-tunes model, saves to artifacts/trocr_airdraw/best/
                                    ↓
                    Restart backend → New model automatically loaded
```

---

## 3. Architecture & Technology Stack

### Frontend Stack
```
HTML5 Canvas          → Drawing surface
MediaPipe (JS)        → Hand tracking (21 landmarks per hand)
WebSocket API         → Real-time communication
PDF.js                → PDF rendering
Vanilla JavaScript    → No framework dependencies
```

### Backend Stack
```
FastAPI               → Web framework
Uvicorn               → ASGI server
WebSockets            → Real-time bidirectional communication
OpenCV (cv2)          → Image processing
PyTorch               → Deep learning framework
Transformers          → Hugging Face library for TrOCR
TrOCR Model           → Vision Encoder-Decoder architecture
```

### Model Architecture
```
TrOCR = Vision Transformer (Encoder) + GPT-2 (Decoder)

Input Image (384x384)
        ↓
Vision Encoder (ViT)
  • Splits image into 16x16 patches
  • Embeds patches as tokens
  • Transformer layers extract visual features
        ↓
Decoder (GPT-2)
  • Autoregressive text generation
  • Beam search for best sequence
  • Outputs character tokens
        ↓
Text Output
```

### File Structure Explained
```
air-drawing-app/
├── backend/
│   ├── main.py              # FastAPI server, WebSocket handler
│   ├── ocr.py               # TrOCR model loading and inference
│   └── requirements.txt     # Python dependencies
│
├── frontend/
│   ├── index.html           # Main drawing app UI
│   ├── pdf-viewer.html      # PDF viewer UI
│   ├── js/
│   │   ├── app.js           # Main app logic, render loop
│   │   ├── config.js        # Constants and configuration
│   │   ├── gestures.js      # Gesture classification
│   │   ├── pointer-filter.js # Smoothing filter for jitter
│   │   └── pdf-viewer/
│   │       └── main.js      # PDF viewer logic
│   └── css/
│       └── pdf-viewer.css   # Styling
│
├── training/
│   ├── prepare_manifests.py # Split dataset into train/val/test
│   ├── train_trocr.py       # Fine-tuning script
│   └── predict_trocr.py     # Test trained model
│
├── custom_dataset/
│   ├── images/              # Training images (227 samples)
│   └── labels.csv           # Ground truth labels
│
├── artifacts/
│   ├── trocr_large_model/   # Your fine-tuned model (2.3GB)
│   ├── ocr_debug/           # Debug images for troubleshooting
│   └── trocr_airdraw/       # Training output directory
│
├── Dockerfile               # Container definition
└── setup.sh                 # One-command setup script
```

---

## 4. Current Issues & Solutions

### 🐛 ISSUE 1: PDF Viewer Cursor Not Showing When Open Hand

**Problem:** When open hand gesture is detected, cursor disappears completely. User cannot track where their hand is positioned.

**Location:** `frontend/js/pdf-viewer/main.js` - Line ~1400 in `handleOpen()` function

**Root Cause:** 
```javascript
function handleOpen(lm) {
  if (searchOverlayActive) {
    showPill("🔎 Search pad active", "#22d3ee");
    return;  // ❌ Returns without drawing cursor
  }
  
  if (currentStroke) finishPenStroke();
  prevWristX = null;
  openStableFrames = 0;
  showPill("✋ Open hand idle", "#94a3b8");
  // ❌ NO CURSOR DRAWING CODE HERE!
}
```

**Solution:** Add cursor tracking for open hand gesture


**FIX CODE:**
```javascript
function handleOpen(lm) {
  if (searchOverlayActive) {
    showPill("🔎 Search pad active", "#22d3ee");
    return;
  }

  if (currentStroke) finishPenStroke();
  prevWristX = null;
  openStableFrames = 0;
  
  // ✅ ADD CURSOR TRACKING FOR OPEN HAND
  const tip = lm[8];  // Index finger tip
  const t = now();
  const rawSx = (1 - tip.x) * cursorCanvas.width;
  const rawSy = tip.y * cursorCanvas.height;
  
  // Apply filter for smooth movement
  const sx = ptrFilterX.filter(rawSx, t);
  const sy = ptrFilterY.filter(rawSy, t);
  
  // Clear and draw cursor
  cursorCtx.clearRect(0, 0, cursorCanvas.width, cursorCanvas.height);
  drawLaserCursor(sx, sy, "#94a3b8");  // Gray cursor for idle state
  
  showPill("✋ Open hand idle", "#94a3b8");
}
```

---

### 🐛 ISSUE 2: PDF Search State Not Normalized After Search

**Problem:** After performing OCR search, the search overlay remains active or state is not properly reset

**Location:** `frontend/js/pdf-viewer/main.js` - `submitSearchOverlay()` function

**Root Cause:** Search overlay closes but tool mode remains "search", causing confusion

**Solution:** Add gesture to reset search state

**FIX CODE:**
```javascript
// Add this to handleOpen() function - use open hand to reset search
function handleOpen(lm) {
  // ... existing code ...
  
  // ✅ ADD: Reset search state with open hand
  if (activeTool === "search" && !searchOverlayActive) {
    setActiveTool("cursor");  // Switch back to cursor mode
    showPill("✋ Search cleared, cursor mode", "#22d3ee");
    return;
  }
  
  // ... rest of function ...
}
```

---

### 🐛 ISSUE 3: No Eraser in PDF Viewer

**Problem:** Cannot erase pen strokes or highlights in PDF viewer

**Location:** `frontend/js/pdf-viewer/main.js`

**Solution:** Add eraser tool and fist gesture for erasing

**FIX CODE:**

1. **Add eraser tool to virtual toolbar** (pdf-viewer.html):
```html
<div class="virtual-toolbar" id="virtual-toolbar">
  <div class="v-btn active" data-tool="cursor">🖱 Cursor</div>
  <div class="v-btn" data-tool="pen">✍️ Pen</div>
  <div class="v-btn" data-tool="eraser">🧹 Eraser</div>  <!-- ✅ ADD THIS -->
  <div class="v-btn" data-tool="search">🔎 Search</div>
</div>
```

2. **Add eraser logic** (main.js):
```javascript
// Add to handlePoint() function
function handlePoint(lm) {
  // ... existing code ...
  
  // ✅ ADD ERASER MODE
  if (activeTool === "eraser") {
    const pageEl = getPageUnderCursor(tip);
    if (!pageEl) {
      drawEraserCursor(sx, sy);
      showPill("🧹 Move onto page to erase", "#ef4444");
      return;
    }
    
    const coords = screenToPage(tip, pageEl);
    const filteredX = drawFilterX.filter(coords.x, t);
    const filteredY = drawFilterY.filter(coords.y, t);
    
    // Erase annotations near cursor
    eraseNearPoint(pageEl.pageNum, filteredX, filteredY, 0.03);  // 3% radius
    
    const rect = pageEl.wrapper.getBoundingClientRect();
    const screenX = rect.left + filteredX * rect.width;
    const screenY = rect.top + filteredY * rect.height;
    
    drawEraserCursor(screenX, screenY);
    showPill("🧹 Erasing", "#ef4444");
    return;
  }
  
  // ... rest of function ...
}

// ✅ ADD ERASER FUNCTIONS
function drawEraserCursor(sx, sy) {
  // Red circle cursor for eraser
  cursorCtx.beginPath();
  cursorCtx.arc(sx, sy, 15, 0, Math.PI * 2);
  cursorCtx.strokeStyle = "#ef4444";
  cursorCtx.lineWidth = 2;
  cursorCtx.stroke();
  
  // Crosshair
  cursorCtx.beginPath();
  cursorCtx.moveTo(sx - 10, sy);
  cursorCtx.lineTo(sx + 10, sy);
  cursorCtx.moveTo(sx, sy - 10);
  cursorCtx.lineTo(sx, sy + 10);
  cursorCtx.strokeStyle = "#ef4444";
  cursorCtx.lineWidth = 1.5;
  cursorCtx.stroke();
}

function eraseNearPoint(pageNum, normX, normY, radius) {
  let erased = false;
  
  // Erase highlights
  if (highlights[pageNum]) {
    const before = highlights[pageNum].length;
    highlights[pageNum] = highlights[pageNum].filter(h => {
      if (!h.points || h.points.length === 0) return true;
      // Check if any point is within erase radius
      return !h.points.some(p => 
        Math.hypot(p.x - normX, p.y - normY) < radius
      );
    });
    if (highlights[pageNum].length < before) {
      erased = true;
      redrawHighlights(pageNum);
    }
  }
  
  // Erase pen strokes
  if (penStrokes[pageNum]) {
    const before = penStrokes[pageNum].length;
    penStrokes[pageNum] = penStrokes[pageNum].filter(s => {
      if (!s.points || s.points.length === 0) return true;
      return !s.points.some(p => 
        Math.hypot(p.x - normX, p.y - normY) < radius
      );
    });
    if (penStrokes[pageNum].length < before) {
      erased = true;
      redrawPenStrokes(pageNum);
    }
  }
  
  if (erased) {
    refreshNotesPanel();
  }
}
```

---

### 🐛 ISSUE 4: Cursor Not Showing All Time in Main Drawing App

**Problem:** In the main air drawing app, cursor only shows when actively drawing

**Location:** `frontend/js/app.js` - render loop

**Root Cause:** Cursor is only drawn during specific actions, not continuously

**Solution:** Always draw cursor when hand is detected

**FIX CODE:**
```javascript
// In renderLoop() function, after gesture classification
function renderLoop() {
  // ... existing code ...
  
  if (result.landmarks && result.landmarks.length > 0) {
    const lm = result.landmarks[0];
    
    // ... existing code ...
    
    const gesture = updateStableGesture(classifyGesture(lm));
    const action = resolvePointerAction(gesture);
    
    // ✅ ALWAYS DRAW CURSOR WHEN HAND IS PRESENT
    const rawX = clamp(Math.round((1 - lm[8].x) * W), 0, W - 1);
    const rawY = clamp(Math.round(lm[8].y * H), 0, H - 1);
    const [cx, cy] = pointerFilter.filter(rawX, rawY, now);
    
    // Draw cursor BEFORE processing action
    if (!outlier && !buttonConsumed) {
      // Draw appropriate cursor based on mode
      if (action === "DRAW") {
        // Cursor already drawn in drawAtPoint()
      } else if (action === "ERASE") {
        // Cursor already drawn in eraseAtPoint()
      } else {
        // ✅ DRAW CURSOR FOR OTHER MODES
        oCtx.strokeStyle = "#00cccc";
        oCtx.lineWidth = 2;
        oCtx.beginPath();
        oCtx.arc(cx, cy, 8, 0, Math.PI * 2);
        oCtx.stroke();
      }
    }
    
    // ... rest of action processing ...
  }
}
```

---

## 5. Optimization Guide

### 🚀 Performance Optimizations

#### A. Model Loading Optimization

**Current Issue:** 2.3GB model loads slowly on startup

**Solutions:**

1. **Model Quantization** (Reduce size by 4x):
```python
# Add to backend/ocr.py
from transformers import VisionEncoderDecoderModel
import torch

def quantize_model(model_path, output_path):
    """Convert model to 8-bit quantized version"""
    model = VisionEncoderDecoderModel.from_pretrained(model_path)
    
    # Quantize to int8
    quantized_model = torch.quantization.quantize_dynamic(
        model, 
        {torch.nn.Linear}, 
        dtype=torch.qint8
    )
    
    quantized_model.save_pretrained(output_path)
    print(f"Quantized model saved to {output_path}")
    print(f"Size reduced by ~75%")

# Run once:
# quantize_model("artifacts/trocr_large_model", "artifacts/trocr_quantized")
```

2. **Lazy Loading** (Load model only when needed):
```python
# Current: Model loads on server startup
# Optimized: Load on first OCR request

class _TrOCREngine:
    def __init__(self, model_ref):
        self.model_ref = str(model_ref)
        self.available = False
        self.model = None  # Don't load yet
        
    def _ensure_loaded(self):
        """Load model on first use"""
        if self.model is not None:
            return
        # Load model here...
```

#### B. Image Processing Optimization

**Current Issue:** Multiple image conversions and filters

**Solution:** Optimize preprocessing pipeline

```python
# backend/ocr.py - Optimized preprocessing
def _prepare_trocr_image_optimized(img, mode="sentence", preprocessed=False):
    """Faster preprocessing with fewer conversions"""
    
    if preprocessed:
        # Skip processing if frontend already did it
        working = _ensure_bgr(img)
        return Image.fromarray(cv2.cvtColor(working, cv2.COLOR_BGR2RGB))
    
    # Single-pass processing
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if len(img.shape) == 3 else img
    
    # Combine threshold and morphology in one step
    _, binary = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
    
    # Use faster morphology
    kernel = np.ones((3,3), np.uint8)
    processed = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)
    
    return Image.fromarray(processed)
```

#### C. WebSocket Optimization

**Current Issue:** Base64 encoding is CPU intensive

**Solution:** Use binary WebSocket frames

```javascript
// frontend/js/app.js - Binary WebSocket
async function triggerOCR() {
  // Convert canvas to Blob instead of base64
  const blob = await new Promise(resolve => 
    drawCanvas.toBlob(resolve, 'image/png')
  );
  
  // Send as binary
  state.ws.send(blob);
}
```

```python
# backend/main.py - Handle binary messages
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    
    while True:
        # Receive binary or text
        try:
            data = await websocket.receive()
            
            if "bytes" in data:
                # Binary image data
                img_bytes = data["bytes"]
                np_arr = np.frombuffer(img_bytes, np.uint8)
                canvas = cv2.imdecode(np_arr, cv2.IMREAD_UNCHANGED)
                # Process...
            else:
                # JSON message
                msg = json.loads(data["text"])
                # Process...
        except Exception as e:
            # Handle error...
```

#### D. Frontend Optimization

**Current Issues:**
- Canvas redraws on every frame
- No request debouncing
- Large virtual canvas (4000x3000)

**Solutions:**

```javascript
// 1. Debounce OCR requests
let ocrDebounceTimer = null;
function triggerOCRDebounced() {
  clearTimeout(ocrDebounceTimer);
  ocrDebounceTimer = setTimeout(() => triggerOCR(), 500);
}

// 2. Use smaller virtual canvas
const VIRTUAL_W = 2000;  // Was 4000
const VIRTUAL_H = 1500;  // Was 3000

// 3. Only redraw changed regions
function drawAtPoint(cx, cy, nowSec) {
  // ... drawing code ...
  
  // Only redraw dirty region instead of full canvas
  const margin = state.brushSize + 10;
  dCtx.save();
  dCtx.clip();
  // Draw only in clipped region
  dCtx.restore();
}
```

---

## 6. Deployment Options

### 🌐 Deployment Comparison Table

| Platform | Cost | Difficulty | GPU Support | Best For |
|----------|------|------------|-------------|----------|
| **Hugging Face Spaces** | FREE | ⭐ Easy | ✅ Free GPU | Demo/Portfolio |
| **Railway.app** | $5-20/mo | ⭐⭐ Medium | ❌ CPU only | Small projects |
| **Google Cloud Run** | $10-30/mo | ⭐⭐⭐ Hard | ❌ CPU only | Scalable apps |
| **AWS EC2** | $30-100/mo | ⭐⭐⭐⭐ Very Hard | ✅ Paid GPU | Production |
| **Render.com** | $7-25/mo | ⭐⭐ Medium | ❌ CPU only | Full-stack apps |

---

### 📦 OPTION 1: Hugging Face Spaces (RECOMMENDED FOR B.TECH PROJECT)

**Why:** Free GPU, designed for ML models, easy to share with instructors

**Steps:**

1. **Create account** at huggingface.co

2. **Create new Space:**
   - Click "New Space"
   - Name: "air-drawing-ocr"
   - SDK: "Docker"
   - Hardware: "CPU basic" (upgrade to GPU after testing)

3. **Prepare files:**
```bash
cd air-drawing-app

# Create app.py (Hugging Face entry point)
cat > app.py << 'EOF'
import os
os.system("uvicorn backend.main:app --host 0.0.0.0 --port 7860")
EOF

# Create README.md for Space
cat > README.md << 'EOF'
---
title: Air Drawing OCR
emoji: ✍️
colorFrom: blue
colorTo: purple
sdk: docker
pinned: false
---

# Air Drawing OCR - B.Tech Project

Hand gesture-based drawing with TrOCR text recognition.

## Features
- Air drawing with webcam
- Local TrOCR model (no API calls)
- PDF viewer with gesture controls
EOF
```

4. **Update Dockerfile for Hugging Face:**
```dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Copy and install dependencies
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY backend/ ./backend/
COPY frontend/ ./frontend/
COPY hand_landmarker.task ./

# Hugging Face Spaces uses port 7860
EXPOSE 7860

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "7860"]
```

5. **Push to Hugging Face:**
```bash
# Install git-lfs for large files
git lfs install

# Initialize repo
git init
git remote add space https://huggingface.co/spaces/YOUR_USERNAME/air-drawing-ocr

# Add files
git add .
git commit -m "Initial commit"

# Push
git push space main
```

6. **Model will auto-download** from Hugging Face Hub on first run

**URL:** `https://huggingface.co/spaces/YOUR_USERNAME/air-drawing-ocr`

---

### 📦 OPTION 2: Railway.app (Easy Full-Stack Deployment)

**Why:** Simple deployment, good for demos, automatic HTTPS

**Steps:**

1. **Sign up** at railway.app with GitHub

2. **Prepare repository:**
```bash
# Ensure .gitignore is correct
echo "venv/" >> .gitignore
echo "__pycache__/" >> .gitignore
echo "artifacts/trocr_large_model/" >> .gitignore

# Commit and push to GitHub
git add .
git commit -m "Prepare for Railway deployment"
git push origin main
```

3. **Deploy on Railway:**
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose your repository
   - Railway auto-detects Dockerfile

4. **Add environment variables:**
   - Go to project settings
   - Add: `PORT=8000`
   - Add: `AIRDRAW_OCR_MODEL=microsoft/trocr-large-handwritten`

5. **Generate domain:**
   - Go to Settings → Networking
   - Click "Generate Domain"
   - Get URL like: `air-drawing-ocr.up.railway.app`

**Cost:** ~$5-10/month

---

### 📦 OPTION 3: Google Cloud Run (Serverless)

**Why:** Pay per use, scales automatically, good for variable traffic

**Steps:**

1. **Install Google Cloud SDK:**
```bash
# macOS
brew install google-cloud-sdk

# Initialize
gcloud init
gcloud auth login
```

2. **Create project:**
```bash
gcloud projects create air-drawing-ocr
gcloud config set project air-drawing-ocr
```

3. **Enable services:**
```bash
gcloud services enable run.googleapis.com
gcloud services enable containerregistry.googleapis.com
```

4. **Build and deploy:**
```bash
cd air-drawing-app

# Build container
gcloud builds submit --tag gcr.io/air-drawing-ocr/app

# Deploy to Cloud Run
gcloud run deploy air-drawing-app \
  --image gcr.io/air-drawing-ocr/app \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --memory 4Gi \
  --cpu 2 \
  --timeout 300 \
  --set-env-vars AIRDRAW_OCR_MODEL=microsoft/trocr-large-handwritten
```

5. **Get URL:**
```bash
gcloud run services describe air-drawing-app --region us-central1 --format 'value(status.url)'
```

**Cost:** ~$10-30/month (with always-on instance)

---

### 📦 OPTION 4: AWS EC2 (Full Control)

**Why:** Complete control, can use GPU, best for production

**Steps:**

1. **Launch EC2 instance:**
   - Go to AWS Console → EC2
   - Click "Launch Instance"
   - Choose: Ubuntu 22.04 LTS
   - Instance type: t3.medium (2 vCPU, 4GB RAM)
   - Storage: 30GB
   - Security group: Allow ports 22 (SSH), 80 (HTTP), 443 (HTTPS)

2. **Connect and setup:**
```bash
# SSH into instance
ssh -i your-key.pem ubuntu@your-instance-ip

# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker ubuntu

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

3. **Clone and run:**
```bash
# Clone your repo
git clone https://github.com/YOUR_USERNAME/air-drawing-app.git
cd air-drawing-app

# Build and run
docker build -t air-drawing-app .
docker run -d -p 80:8000 --name air-drawing air-drawing-app
```

4. **Setup domain (optional):**
   - Buy domain from Namecheap/GoDaddy
   - Point A record to EC2 IP
   - Install nginx + Let's Encrypt for HTTPS

**Cost:** ~$30-50/month

---

## 7. Flowcharts & Diagrams

### 📊 System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER'S BROWSER                           │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    FRONTEND (HTML/JS)                     │   │
│  │                                                           │   │
│  │  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │   │
│  │  │   Webcam    │  │   MediaPipe  │  │  HTML5 Canvas  │  │   │
│  │  │   Stream    │→ │ Hand Tracking│→ │    Drawing     │  │   │
│  │  └─────────────┘  └──────────────┘  └────────────────┘  │   │
│  │                           ↓                               │   │
│  │                  ┌──────────────────┐                     │   │
│  │                  │ Gesture Classify │                     │   │
│  │                  └──────────────────┘                     │   │
│  │                           ↓                               │   │
│  │                  ┌──────────────────┐                     │   │
│  │                  │ Image Preprocess │                     │   │
│  │                  │ (crop, scale)    │                     │   │
│  │                  └──────────────────┘                     │   │
│  └──────────────────────────┬───────────────────────────────┘   │
└────────────────────────────┼────────────────────────────────────┘
                             │ WebSocket
                             │ (base64 PNG)
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│                      BACKEND SERVER (Python)                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    FastAPI + Uvicorn                      │   │
│  │                                                           │   │
│  │  ┌─────────────────┐         ┌──────────────────────┐    │   │
│  │  │  WebSocket      │         │   HTTP Routes        │    │   │
│  │  │  Handler        │         │   /health, /api/*    │    │   │
│  │  └────────┬────────┘         └──────────────────────┘    │   │
│  │           │                                               │   │
│  │           ↓                                               │   │
│  │  ┌─────────────────────────────────────────────────┐     │   │
│  │  │           OCR MODULE (ocr.py)                    │     │   │
│  │  │                                                  │     │   │
│  │  │  ┌──────────────┐  ┌────────────────────────┐  │     │   │
│  │  │  │ Image        │  │  TrOCR Model           │  │     │   │
│  │  │  │ Preprocessing│→ │  (VisionEncoder +      │  │     │   │
│  │  │  │ (OpenCV)     │  │   GPT-2 Decoder)       │  │     │   │
│  │  │  └──────────────┘  └───────────┬────────────┘  │     │   │
│  │  │                                 ↓               │     │   │
│  │  │                    ┌────────────────────────┐   │     │   │
│  │  │                    │  Text Post-processing  │   │     │   │
│  │  │                    │  (clean, normalize)    │   │     │   │
│  │  │                    └────────────────────────┘   │     │   │
│  │  └─────────────────────────────────────────────────┘     │   │
│  └──────────────────────────┬───────────────────────────────┘   │
└────────────────────────────┼────────────────────────────────────┘
                             │ WebSocket
                             │ (JSON response)
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│                         USER'S BROWSER                           │
│                    Display recognized text                       │
└─────────────────────────────────────────────────────────────────┘
```

### 📊 Gesture Recognition Flow

```
Hand Detected → MediaPipe (21 landmarks) → Gesture Classification
                                                    ↓
                                    ┌───────────────┴───────────────┐
                                    │                               │
                            INDEX FINGER UP                  ALL FINGERS DOWN
                                    │                               │
                                    ↓                               ↓
                            ┌───────────────┐              ┌────────────────┐
                            │  DRAW MODE    │              │  ERASE MODE    │
                            │  • Ink on     │              │  • Remove ink  │
                            │    canvas     │              │    at cursor   │
                            └───────────────┘              └────────────────┘
                                    
                            INDEX + MIDDLE UP              3 FINGERS UP
                                    │                               │
                                    ↓                               ↓
                            ┌───────────────┐              ┌────────────────┐
                            │  LIFT MODE    │              │  PAN MODE      │
                            │  • Cursor     │              │  • Move canvas │
                            │    only       │              │    viewport    │
                            └───────────────┘              └────────────────┘
```

### 📊 OCR Processing Pipeline

```
Canvas Image (RGBA)
        ↓
┌───────────────────┐
│ Extract Viewport  │  Get visible region only
└────────┬──────────┘
         ↓
┌───────────────────┐
│ Convert to Binary │  Black ink on white background
└────────┬──────────┘
         ↓
┌───────────────────┐
│ Crop to Content   │  Remove empty space + add padding
└────────┬──────────┘
         ↓
┌───────────────────┐
│ Scale to Target   │  320x120 (word), 640x180 (line), 960x240 (sentence)
└────────┬──────────┘
         ↓
┌───────────────────┐
│ Center on Canvas  │  Place in center of white background
└────────┬──────────┘
         ↓
┌───────────────────┐
│ Convert to Base64 │  Encode as PNG data URL
└────────┬──────────┘
         ↓
    Send via WebSocket
         ↓
┌───────────────────┐
│ Backend Receives  │  Decode base64 to OpenCV image
└────────┬──────────┘
         ↓
┌───────────────────┐
│ Grayscale Convert │  RGB → Gray
└────────┬──────────┘
         ↓
┌───────────────────┐
│ Bilateral Filter  │  Reduce noise while preserving edges
└────────┬──────────┘
         ↓
┌───────────────────┐
│ Binary Threshold  │  Convert to pure black/white
└────────┬──────────┘
         ↓
┌───────────────────┐
│ Pad to Square     │  Maintain aspect ratio for TrOCR
└────────┬──────────┘
         ↓
┌───────────────────┐
│ Dilate Strokes    │  Thicken thin air-drawn lines
└────────┬──────────┘
         ↓
┌───────────────────┐
│ Line Segmentation │  Split into individual lines (sentence mode)
└────────┬──────────┘
         ↓
┌───────────────────┐
│ Resize to 384x384 │  TrOCR input size
└────────┬──────────┘
         ↓
┌───────────────────┐
│ TrOCR Processor   │  Convert to pixel values tensor
└────────┬──────────┘
         ↓
┌───────────────────┐
│ Vision Encoder    │  Extract visual features (ViT)
└────────┬──────────┘
         ↓
┌───────────────────┐
│ Text Decoder      │  Generate text tokens (GPT-2)
└────────┬──────────┘
         ↓
┌───────────────────┐
│ Beam Search       │  Find best token sequence
└────────┬──────────┘
         ↓
┌───────────────────┐
│ Decode Tokens     │  Convert IDs to text
└────────┬──────────┘
         ↓
┌───────────────────┐
│ Post-process      │  Clean whitespace, remove noise
└────────┬──────────┘
         ↓
    Return Text
```

---

## 8. Complete Code Fixes

Now let me create the actual fix files for you to apply:
