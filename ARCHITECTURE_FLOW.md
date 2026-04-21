# Air Drawing App - Complete Architecture & Flow Documentation

## Project Overview
A multi-application system with three integrated apps: Virtual Paint, Media Player, and PDF Viewer, all using hand gesture recognition and OCR capabilities.

---

## 1. SYSTEM ARCHITECTURE

### High-Level Architecture:
```
┌─────────────────────────────────────────────────────────────┐
│                        USER                                  │
│                     (Webcam Input)                           │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                   FRONTEND (Browser)                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ Virtual Paint│  │ Media Player │  │  PDF Viewer  │     │
│  │  (index.html)│  │(mediaplayer) │  │ (pdfviewer)  │     │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘     │
│         │                  │                  │              │
│         └──────────────────┴──────────────────┘              │
│                            │                                 │
│                   ┌────────▼────────┐                       │
│                   │  MediaPipe.js   │                       │
│                   │ (Hand Tracking) │                       │
│                   └────────┬────────┘                       │
└────────────────────────────┼────────────────────────────────┘
                             │ WebSocket
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                   BACKEND (FastAPI)                          │
│  ┌──────────────────────────────────────────────────┐       │
│  │              main.py (Server)                     │       │
│  │  - Routes: /, /mediaplayer, /pdfviewer          │       │
│  │  - WebSocket endpoint: /ws                       │       │
│  │  - Static file serving                           │       │
│  └────────────────────┬─────────────────────────────┘       │
│                       │                                      │
│                       ▼                                      │
│  ┌──────────────────────────────────────────────────┐       │
│  │              ocr.py (OCR Engine)                  │       │
│  │  - TrOCR model loading                           │       │
│  │  - Image preprocessing                           │       │
│  │  - Text recognition                              │       │
│  └────────────────────┬─────────────────────────────┘       │
└────────────────────────┼────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                   AI MODELS                                  │
│  ┌──────────────────┐  ┌──────────────────┐               │
│  │  MediaPipe       │  │  TrOCR Large     │               │
│  │  Hand Landmarker │  │  (2.3GB)         │               │
│  │  (7.5MB)         │  │  Fine-tuned      │               │
│  └──────────────────┘  └──────────────────┘               │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. VIRTUAL PAINT - COMPLETE FLOW

### 2.1 Initialization Flow:
```
User Opens Browser (http://localhost:8000/)
    ↓
Load index.html
    ↓
Request Camera Permission
    ↓
Initialize MediaPipe Hand Tracking
    ↓
Load Hand Landmarker Model (7.5MB)
    ↓
Start Video Stream Processing
    ↓
Connect WebSocket to Backend (/ws)
    ↓
Ready for Drawing
```

### 2.2 Drawing Flow:
```
Camera Captures Frame (30 FPS)
    ↓
MediaPipe Processes Frame
    ↓
Detect Hand Landmarks (21 points per hand)
    ↓
Gesture Recognition (app.js)
    ├─ Index Finger Extended? → Draw Mode
    ├─ Fist Closed? → Erase Mode
    ├─ Two Fingers? → Lift Pen
    └─ Three Fingers? → Pan Canvas
    ↓
Update Canvas (HTML5 Canvas API)
    ↓
Draw Stroke with Current Color & Brush Size
    ↓
Store in Undo Stack
```

### 2.3 OCR Flow:
```
User Draws Text on Canvas
    ↓
Auto-OCR Timer (3 seconds of inactivity)
    ↓
Capture Canvas as Image (PNG)
    ↓
Preprocess Image:
    ├─ Crop to ink bounds
    ├─ Add padding
    ├─ Resize to target size
    └─ Convert to grayscale
    ↓
Send via WebSocket to Backend
    ↓
Backend receives image (base64)
    ↓
Decode to OpenCV format
    ↓
Load TrOCR Model (if not loaded)
    ↓
Run OCR Inference
    ↓
Return Recognized Text
    ↓
Display in UI
```

---

## 3. MEDIA PLAYER - COMPLETE FLOW

### 3.1 Initialization Flow:
```
User Clicks "Media Player" Button
    ↓
Navigate to /mediaplayer
    ↓
Load media-player.html
    ↓
Request Camera Permission
    ↓
Initialize MediaPipe Hands
    ↓
Load Hand Tracking Model
    ↓
Start Gesture Recognition Loop
    ↓
Ready for Video Control
```

### 3.2 Video Loading Flow:
```
User Selects Video Source:
    ├─ Local File Upload
    │   ↓
    │   Read File as Blob
    │   ↓
    │   Create Object URL
    │   ↓
    │   Load in <video> element
    │
    └─ YouTube URL
        ↓
        Extract Video ID
        ↓
        Load YouTube IFrame API
        ↓
        Create YouTube Player
        ↓
        Ready for Playback
```

### 3.3 Gesture Control Flow:
```
Camera Captures Frame
    ↓
MediaPipe Detects Hand
    ↓
Extract 21 Landmarks
    ↓
Classify Gesture (media-player.js):
    ├─ Index Finger Only → Pointer Mode
    │   ↓
    │   Calculate Finger Position
    │   ↓
    │   Apply Smoothing (EMA + Rolling Average)
    │   ↓
    │   Update Cursor Position (ABSOLUTE MODE)
    │   ↓
    │   Render Cursor on Screen
    │
    ├─ Index + Middle Together → Click
    │   ↓
    │   Trigger Click Event at Cursor Position
    │
    ├─ Thumbs Up → Volume Up
    │   ↓
    │   Increase Volume by 10%
    │
    ├─ Thumbs Down → Volume Down
    │   ↓
    │   Decrease Volume by 10%
    │
    ├─ Peace Sign (Index + Middle) → Play/Pause
    │   ↓
    │   Toggle Playback State
    │
    ├─ Fist → Seek Backward
    │   ↓
    │   Jump -10 seconds
    │
    └─ Open Palm → Seek Forward
        ↓
        Jump +10 seconds
```

### 3.4 Cursor Positioning (FIXED):
```
Get Index Finger Tip Position (Landmark 8)
    ↓
Flip X Coordinate (mirror camera)
    ↓
Apply EMA Smoothing (α = 0.4)
    ↓
Apply Rolling Average (buffer size = 6)
    ↓
ABSOLUTE POSITIONING MODE:
    ↓
    Map directly to screen coordinates:
    cursor.x = smoothed_x * window.width
    cursor.y = smoothed_y * window.height
    ↓
Apply Lerp for smooth rendering (α = 0.25)
    ↓
Update Cursor DOM Element Position
```

---

## 4. PDF VIEWER - COMPLETE FLOW

### 4.1 PDF Loading Flow:
```
User Uploads PDF File
    ↓
Read File as ArrayBuffer
    ↓
Load PDF.js Library
    ↓
Parse PDF Document
    ↓
Render First Page to Canvas
    ↓
Initialize Gesture Controls
    ↓
Ready for Navigation
```

### 4.2 Gesture Navigation Flow:
```
Detect Hand Gestures:
    ├─ Swipe Right → Previous Page
    ├─ Swipe Left → Next Page
    ├─ Index Finger → Draw/Annotate
    └─ Fist → Erase Annotation
```

### 4.3 OCR Search Flow:
```
User Draws Search Query
    ↓
Capture Drawing as Image
    ↓
Send to Backend via WebSocket
    ↓
OCR Recognition
    ↓
Search Text in PDF
    ↓
Highlight Matches
    ↓
Navigate to First Match
```

---

## 5. BACKEND ARCHITECTURE

### 5.1 Server Routes:
```
FastAPI Application (main.py)
    │
    ├─ GET / → Serve index.html (Virtual Paint)
    ├─ GET /mediaplayer → Serve media-player.html
    ├─ GET /pdfviewer → Serve pdf-viewer.html
    ├─ GET /hand_landmarker.task → Serve model file
    ├─ GET /health → Health check endpoint
    ├─ POST /api/samples → Save training samples
    └─ WebSocket /ws → Real-time OCR communication
```

### 5.2 WebSocket Communication:
```
Client Connects to /ws
    ↓
Server Accepts Connection
    ↓
Client Sends Message:
    {
        "type": "ocr",
        "mode": "sentence",
        "image": "base64_png_data",
        "source_image": "base64_source",
        "preprocessed": false
    }
    ↓
Server Processes:
    ├─ Decode base64 image
    ├─ Convert to OpenCV format
    ├─ Save debug images
    ├─ Run OCR
    └─ Return result
    ↓
Server Sends Response:
    {
        "type": "ocr_result",
        "text": "recognized text",
        "success": true
    }
```

### 5.3 OCR Engine (ocr.py):
```
Initialize OCR Engine
    ↓
Load TrOCR Model:
    ├─ Check if model exists locally
    ├─ If not, download from Hugging Face Hub
    ├─ Load VisionEncoderDecoderModel
    ├─ Load TrOCRProcessor
    └─ Move to GPU if available
    ↓
Preprocess Image:
    ├─ Convert to grayscale
    ├─ Apply thresholding
    ├─ Invert colors (white text on black)
    ├─ Resize to 384x384
    └─ Normalize pixel values
    ↓
Run Inference:
    ├─ Convert to PIL Image
    ├─ Process with TrOCRProcessor
    ├─ Generate text with model
    └─ Decode output tokens
    ↓
Post-process:
    ├─ Clean up text
    ├─ Remove special tokens
    └─ Return final text
```

---

## 6. DATA FLOW DIAGRAMS

### 6.1 Virtual Paint Data Flow:
```
User Hand Movement
    ↓
Webcam Frame (640x480)
    ↓
MediaPipe Processing (21 landmarks)
    ↓
Gesture Classification
    ↓
Canvas Drawing (2D Context)
    ↓
Canvas Image (PNG)
    ↓
WebSocket (base64)
    ↓
Backend OCR Processing
    ↓
TrOCR Model (2.3GB)
    ↓
Recognized Text
    ↓
WebSocket Response
    ↓
UI Display
```

### 6.2 Media Player Data Flow:
```
User Hand Movement
    ↓
Webcam Frame
    ↓
MediaPipe Hand Detection
    ↓
Landmark Extraction (21 points)
    ↓
Gesture Classification
    ↓
Cursor Position Calculation (ABSOLUTE)
    ↓
Smoothing (EMA + Rolling Average)
    ↓
Cursor Rendering
    ↓
User Interaction (Click/Control)
    ↓
Video Player API
    ↓
Video Playback Control
```

---

## 7. KEY TECHNOLOGIES

### Frontend:
- HTML5 Canvas API
- MediaPipe Hands (JavaScript)
- WebSocket API
- PDF.js
- YouTube IFrame API

### Backend:
- FastAPI (Python)
- Uvicorn (ASGI Server)
- OpenCV (Image Processing)
- PyTorch (Deep Learning)
- Transformers (Hugging Face)

### AI Models:
- MediaPipe Hand Landmarker (7.5MB)
- TrOCR Large Fine-tuned (2.3GB)
  - Vision Encoder: ViT (Vision Transformer)
  - Text Decoder: GPT-2

---

## 8. PERFORMANCE METRICS

### Real-time Processing:
- Camera FPS: 30 frames/second
- Hand Detection: ~33ms per frame
- Gesture Recognition: ~5ms per frame
- Canvas Rendering: 60 FPS
- Cursor Update: 60 FPS (requestAnimationFrame)

### OCR Performance:
- Preprocessing: ~50ms
- Model Inference: ~200-500ms (CPU) / ~50-100ms (GPU)
- Total OCR Time: ~300-600ms per request

### Network:
- WebSocket Latency: ~10-50ms (local)
- Image Transfer: ~100-200ms (base64 encoding + network)

---

## 9. GESTURE RECOGNITION DETAILS

### Hand Landmarks (21 Points):
```
0: Wrist
1-4: Thumb (CMC, MCP, IP, TIP)
5-8: Index (MCP, PIP, DIP, TIP)
9-12: Middle (MCP, PIP, DIP, TIP)
13-16: Ring (MCP, PIP, DIP, TIP)
17-20: Pinky (MCP, PIP, DIP, TIP)
```

### Gesture Detection Logic:
```
isFingerExtended(tip, pip):
    return tip.y < pip.y  // Tip above PIP joint

isThumbExtended(landmarks, handedness):
    if handedness == "Right":
        return thumb_tip.x > thumb_ip.x
    else:
        return thumb_tip.x < thumb_ip.x

Pointer Gesture:
    index_extended AND
    NOT middle_extended AND
    NOT ring_extended AND
    NOT pinky_extended AND
    NOT thumb_extended

Click Gesture:
    index_extended AND
    middle_extended AND
    distance(index_tip, middle_tip) < 0.04 AND
    NOT ring_extended AND
    NOT pinky_extended
```

---

## 10. DEPLOYMENT ARCHITECTURE

### Docker Container:
```
┌─────────────────────────────────────┐
│     Docker Container                 │
│  ┌───────────────────────────────┐  │
│  │  Python 3.11                  │  │
│  │  - FastAPI                    │  │
│  │  - Uvicorn                    │  │
│  │  - PyTorch                    │  │
│  │  - Transformers               │  │
│  │  - OpenCV                     │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │  Application Files            │  │
│  │  - backend/                   │  │
│  │  - frontend/                  │  │
│  │  - hand_landmarker.task       │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │  Models (Downloaded)          │  │
│  │  - TrOCR Large (2.3GB)        │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
         │
         ▼
    Port 8000
         │
         ▼
    User Browser
```

---

## 11. SECURITY & PRIVACY

### Data Handling:
- All processing happens locally (no external API calls)
- Webcam data never leaves the browser (except for OCR)
- OCR images sent via WebSocket (local connection)
- No data stored on server (except training samples if saved)
- Models run locally (no cloud inference)

### Privacy Features:
- Camera access requires user permission
- Video stream processed in real-time (not recorded)
- Hand landmarks only (no face detection)
- Optional training sample collection (user-initiated)

---

## 12. ERROR HANDLING

### Frontend Error Handling:
```
Camera Access Denied
    ↓
Show Error Message
    ↓
Provide Instructions

MediaPipe Load Failed
    ↓
Retry Loading
    ↓
Show Fallback UI

WebSocket Disconnected
    ↓
Attempt Reconnection
    ↓
Show Connection Status
```

### Backend Error Handling:
```
Model Load Failed
    ↓
Try Alternative Model
    ↓
Return Error Response

OCR Processing Failed
    ↓
Log Error
    ↓
Return Empty Result

WebSocket Error
    ↓
Close Connection
    ↓
Client Reconnects
```

---

## 13. FUTURE ENHANCEMENTS

### Planned Features:
1. Multi-language OCR support
2. Voice commands integration
3. Collaborative drawing (multi-user)
4. Cloud model deployment option
5. Mobile app version
6. Gesture customization
7. Advanced video editing features
8. Real-time collaboration

---

This documentation provides a complete overview of the system architecture, data flows, and technical implementation details for presentation purposes.
