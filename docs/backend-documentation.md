# Air Drawing App - Backend Complete Documentation

**Version:** 1.0  
**Created:** April 8, 2026  
**Purpose:** Comprehensive guide to all backend functions and complete workflow

---

## Table of Contents
1. [Project Overview](#project-overview)
2. [Architecture](#architecture)
3. [Configuration & Paths](#configuration--paths)
4. [Main.py Functions](#mainpy-functions)
5. [OCR.py Functions](#ocrpy-functions)
6. [WebSocket Protocol](#websocket-protocol)
7. [Complete Request Flow](#complete-request-flow)
8. [Error Handling](#error-handling)

---

## Project Overview

### What This Backend Does
- **WebSocket server** that receives hand-drawn canvas images from a browser
- **OCR processing** using Microsoft's TrOCR (Transformer-based Optical Character Recognition) model
- **Returns recognized text** back to the browser in real-time
- **Serves static frontend** files (HTML/JS)
- **Provides health monitoring** and diagnostic endpoints

### What This Backend DOES NOT Do
- Hand tracking (handled by browser with MediaPipe.js)
- Canvas drawing (handled by browser with HTML5 Canvas)
- Webcam access (handled by browser)

---

## Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────┐
│                     Browser Frontend                         │
│  • MediaPipe JS (hand detection)                             │
│  • HTML5 Canvas (drawing surface)                            │
│  • getUserMedia() (webcam access)                            │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       │ WebSocket (TCP)
                       │ Base64 PNG image + metadata
                       │
┌──────────────────────▼──────────────────────────────────────┐
│              Backend Server (FastAPI)                        │
│                                                              │
│  ┌─────────────────────────────────────────────────┐        │
│  │ main.py - Server & WebSocket Management        │        │
│  │ • Routes: /, /health, /hand_landmarker.task    │        │
│  │ • WebSocket: /ws                               │        │
│  │ • Image conversion & preprocessing             │        │
│  │ • Debug logging                                │        │
│  └───────────────────┬─────────────────────────────┘        │
│                      │                                        │
│                      ▼                                        │
│  ┌─────────────────────────────────────────────────┐        │
│  │ ocr.py - OCR Pipeline                          │        │
│  │ • Image preprocessing (crop, grayscale, etc)   │        │
│  │ • Line/word segmentation                       │        │
│  │ • TrOCR model inference                        │        │
│  │ • Text post-processing & cleaning              │        │
│  └───────────────────┬─────────────────────────────┘        │
│                      │                                        │
│                      ▼                                        │
│  ┌─────────────────────────────────────────────────┐        │
│  │ TrOCR Model (Microsoft Transformers)           │        │
│  │ • Model: microsoft/trocr-large-handwritten     │        │
│  │ • Device: GPU (CUDA) or CPU                    │        │
│  │ • Processor: PIL Image → Tensor conversion     │        │
│  │ • Decoder: Beam search (3-5 beams)            │        │
│  └─────────────────────────────────────────────────┘        │
└──────────────────────────────────────────────────────────────┘
```

---

## Configuration & Paths

### Directory Structure
```python
BASE_DIR = Path(__file__).resolve().parent  # /backend
PROJECT_ROOT = BASE_DIR.parent               # /
FRONTEND_DIR = PROJECT_ROOT / "frontend"     # /frontend
STATIC_DIR = FRONTEND_DIR                    # /frontend (served as static)
MODEL_PATH = PROJECT_ROOT / "hand_landmarker.task"  # MediaPipe hand model
DATASET_DIR = PROJECT_ROOT / "data" / "collected"   # Training data
OCR_DEBUG_DIR = PROJECT_ROOT / "artifacts" / "ocr_debug"  # Debug logs
WORDS_DIR = DATASET_DIR / "words"            # Word images
MANIFEST_PATH = DATASET_DIR / "words_manifest.jsonl"
CSV_PATH = DATASET_DIR / "words_manifest.csv"
```

### Model Configuration
```python
DEFAULT_TROCR_MODEL_DIR = PROJECT_ROOT / "artifacts" / "trocr_airdraw" / "best"
DEFAULT_TROCR_MODEL_ID = "microsoft/trocr-large-handwritten"
```
- **LOCAL MODEL (preferred):** Uses fine-tuned model in `artifacts/trocr_airdraw/best/`
- **FALLBACK MODEL:** Downloads from Hugging Face if local not available
- **ENV OVERRIDE:** Set `AIRDRAW_OCR_MODEL` to use custom model path

---

## Main.py Functions

### 1. **base64_to_cv2(b64_string: str) → np.ndarray**

**Purpose:** Convert Base64-encoded PNG image string to OpenCV format

**Input:**
- `b64_string` - Base64 PNG string (with or without data URL prefix)

**Process:**
1. Strip data URL prefix if present (e.g., `data:image/png;base64,`)
2. Decode Base64 string to raw bytes
3. Convert bytes to NumPy array
4. Decode PNG using OpenCV's `imdecode` with `IMREAD_UNCHANGED` flag
   - Preserves all channels including alpha (transparency)

**Output:**
- `np.ndarray` - OpenCV image (BGR or BGRA format)

**Example:**
```python
# From browser: "data:image/png;base64,iVBORw0KGgoAAAANS..."
canvas_image = base64_to_cv2(b64_string)
# Result: (height, width, 3 or 4) ndarray
```

---

### 2. **save_debug_image(image, path: Path) → None**

**Purpose:** Save an OpenCV image as PNG to disk for debugging

**Input:**
- `image` - OpenCV image (np.ndarray)
- `path` - Path object where to save the PNG

**Process:**
1. Return early if image is None
2. Create parent directories if they don't exist
3. Encode image as PNG using `cv2.imencode`
4. Write binary PNG data to disk

**Output:** PNG file written to specified path

**Used For:** Debugging OCR input/output at various preprocessing stages

---

### 3. **save_debug_ocr_bundle(source_canvas, ocr_input, mode: str, preprocessed: bool = False) → None**

**Purpose:** Save complete debugging bundle (images + metadata JSON) for each OCR request

**Input:**
- `source_canvas` - Original canvas image (before processing)
- `ocr_input` - Processed image sent to OCR model
- `mode` - OCR mode: "word", "line", or "sentence"
- `preprocessed` - Boolean flag if image was pre-processed by frontend

**Process:**
1. Create timestamp: `YYYYMMDDTHHMMSSffffff` format
2. Save source canvas as:
   - `latest_source_canvas.png` (always overwritten)
   - `{timestamp}_source_canvas.png` (unique per request)
3. Save OCR input as:
   - `latest_ocr_input.png` (always overwritten)
   - `{timestamp}_ocr_input.png` (unique per request)
4. Create metadata JSON documenting:
   - Mode, preprocessed flag, timestamp
   - Whether source and OCR images exist
5. Write to `latest_request.json`

**Files Created:** In `artifacts/ocr_debug/`
- Useful for troubleshooting failed OCR requests
- Latest files always show the most recent request
- Timestamped files create audit trail

---

### 4. **root() → FileResponse or dict** (GET /)

**Purpose:** Serve the frontend homepage

**Process:**
1. Check if `index.html` exists in `FRONTEND_DIR`
2. If yes: Return `FileResponse` with the HTML file
3. If no: Return JSON status message

**Response:**
- **Success:** Serves HTML file to client
- **Fallback:** `{"status": "Air Drawing OCR Server running"}`

---

### 5. **health() → dict** (GET /health)

**Purpose:** System health check endpoint - reports if all components are available

**Returns:**
```json
{
    "status": "ok",
    "frontend": true,          // Frontend files exist
    "model": true,             // hand_landmarker.task exists
    "ocr": {
        "backend": "trocr",
        "device": "cuda",
        "model_ref": "path/to/local/model or microsoft/trocr-large",
        "local_checkpoint": "path/to/local/model",
        "reason": ""           // Error message if backend unavailable
    }
}
```

**Used For:**
- Monitoring server status
- Verifying all dependencies are loaded
- Checking if GPU (CUDA) is available
- Debugging startup issues

---

### 6. **hand_landmarker() → FileResponse or dict** (GET /hand_landmarker.task)

**Purpose:** Serve MediaPipe hand detection model file to browser

**Process:**
1. Check if `hand_landmarker.task` file exists
2. If yes: Stream file as binary with correct mime type
3. If no: Return error JSON

**Response:**
- **Success:** Binary file (application/octet-stream)
- **Error:** `{"error": "Model file not found"}`

**Used By:** Frontend JavaScript to initialize MediaPipe hand tracking

---

### 7. **websocket_endpoint(websocket: WebSocket) → None** (WebSocket /ws)

**Purpose:** Main WebSocket handler - receives images from browser, runs OCR, returns results

**Flow:**

#### A. Connection Setup
```python
await websocket.accept()
# Client connected - enter message loop
```

#### B. Main Message Loop (while True)
Continuously receives messages from client:

**Message Type 1: PING/PONG (Keep-alive)**
```python
if msg.get("type") == "ping":
    await websocket.send_text(json.dumps({"type": "pong"}))
```
- Browser sends periodic `{"type": "ping"}` to keep connection alive
- Server responds with `{"type": "pong"}`

**Message Type 2: OCR Request**
```python
if msg.get("type") == "ocr":
    mode = msg.get("mode", "sentence")              # "word", "line", "sentence"
    b64_img = msg.get("image", "")                  # Required: base64 PNG
    source_b64 = msg.get("source_image", "")        # Optional: original canvas
    preprocessed = bool(msg.get("preprocessed", False))
```

#### C. Validation & Decoding
```python
# Check if image data present
if not b64_img:
    send error: "No image data received"

# Decode from base64 to OpenCV
canvas = base64_to_cv2(b64_img)
if canvas is None:
    send error: "Could not decode image"
```

#### D. Debugging & OCR Processing
```python
# Save debug bundle (images + metadata)
source_canvas = base64_to_cv2(source_b64) if source_b64 else None
save_debug_ocr_bundle(source_canvas, canvas, mode, preprocessed)

# Run OCR
print(f"Running OCR (mode={mode}, preprocessed={preprocessed}, image={canvas.shape})")
result = run_ocr(canvas, mode=mode, preprocessed=preprocessed)
```
- Calls `run_ocr()` from `ocr.py` which handles all image preprocessing and model inference

#### E. Response Handling
```python
# Success case
if result:
    send: {"type": "ocr_result", "text": result, "success": true}

# Failure case
else:
    send: {"type": "ocr_result", "text": "", "success": false, "message": "Could not recognize text"}
```

#### F. Error Handling
```python
except WebSocketDisconnect:
    # Client disconnected gracefully
    print("Client disconnected")

except Exception as e:
    # Unexpected error - try to notify client
    send: {"type": "error", "message": str(e)}
```

**Request/Response Protocol:**

| Direction | Message | Fields | Notes |
|-----------|---------|--------|-------|
| Browser → Server | OCR Request | `type`: "ocr"<br>`mode`: "word"\|"line"\|"sentence"<br>`image`: base64 PNG<br>`source_image`: (optional)<br>`preprocessed`: bool | Image is required |
| Client → Server | Keep-alive | `type`: "ping" | Every 30-60 seconds |
| Server → Browser | OCR Result | `type`: "ocr_result"<br>`text`: recognized string<br>`success`: bool<br>`message`: (optional error) | Always sent after request |
| Server → Browser | Pong | `type`: "pong" | Response to ping |
| Server → Browser | Error | `type`: "error"<br>`message`: error details | Connection-level errors |

---

## OCR.py Functions

### Image Processing Functions

### 1. **_ensure_bgr(img) → np.ndarray**

**Purpose:** Convert any image format to BGR (OpenCV standard)

**Input:** Image in any format (grayscale, RGB, RGBA, BGR)

**Conversion Logic:**

| Input Format | Output | Process |
|--------------|--------|---------|
| Grayscale (2D) | BGR | `cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)` |
| RGBA (4 channels) | BGR | Alpha blending: $`rgb = rgb \cdot \alpha + white \cdot (1-\alpha)`$ |
| BGR (3 channels) | BGR | Return unchanged |

**Formula for RGBA:**
```
For each pixel:
  α_normalized = alpha_channel / 255
  rgb_blended = rgb_foreground * α + white_background * (1 - α)
Result: Opaque BGR image with white background
```

**Output:** BGR format np.ndarray

---

### 2. **_to_grayscale(img) → np.ndarray**

**Purpose:** Convert image to grayscale with automatic brightness correction

**Process:**
1. If already grayscale, use as-is
2. Otherwise, convert to BGR first, then to grayscale
3. Check if image is inverted (mean < 127 = dark background)
4. If inverted, apply `cv2.bitwise_not()` to flip to normal (dark ink on white)

**Why:** Ensures consistent "dark text on white background" format for OCR

**Output:** Grayscale image (2D array, values 0-255)

---

### 3. **_ink_mask(img) → np.ndarray (boolean)**

**Purpose:** Create binary mask identifying where ink/text is (vs background)

**Process:**

**Option 1: RGBA with Alpha Channel**
```python
if image has 4 channels:
    α = alpha_channel
    transparent_pixels = count where α ≤ 16
    opaque_pixels = count where α > 16
    
    if has both transparent AND opaque pixels:
        # Image was drawn on transparent background
        return mask where α > 16  # Only opaque areas
```

**Option 2: RGB/BGR (Default)**
```python
else:
    grayscale = convert to grayscale
    if dark background:
        flip grayscale
    return mask where gray < 240  # Non-white pixels = ink
```

**Output:** Boolean mask (True = ink, False = background)

---

### 4. **crop_to_content(img, pad=24) → np.ndarray**

**Purpose:** Remove white/empty space around drawn content, keeping only the text area

**Process:**
1. Get ink mask using `_ink_mask()`
2. Find bounding box of all ink pixels:
   ```
   y_min, x_min = top-left corner of ink
   y_max, x_max = bottom-right corner of ink
   ```
3. Expand bounding box by `pad` pixels (default 24) in all directions
4. Clamp to image boundaries (don't go outside)
5. Extract and return cropped region

**Parameters:**
- `img` - Input image
- `pad` - Padding around content (default 24 pixels)

**Output:** Cropped image containing only text with padding

**Example:**
```
Original:  512×512 image, text in center
Ink area:  100×100 pixels at (150, 150)
Crop box:  (126, 126) to (274, 274) with pad=24
Result:    148×148 cropped image
```

---

### 5. **_split_into_lines(img, pad=18) → list[np.ndarray]**

**Purpose:** Split a multi-line handwritten image into individual line segments

**Why:** TrOCR works better on single lines than multi-line text

**Algorithm:**

**Step 1: Detect Text Rows**
```python
# Count ink pixels in each row
row_activity = sum of ink pixels per horizontal row

# Find rows with significant ink (> 5 pixels)
active_rows = rows where activity > threshold

# Group consecutive active rows into ranges
ranges = [(start_row, end_row), ...]
```

**Step 2: Merge Nearby Rows**
```python
# If two groups are close (gap < min_gap), merge them
# min_gap = max(8, pad // 2)
# Avoids false splits in tall letters
```

**Step 3: Extract & Filter Candidates**
For each merged range:
- Find horizontal extent (left-right columns with ink)
- Expand bounds by `pad` pixels
- Calculate total ink pixels in bounding box
- Store as candidate: `{image, width, height, ink_pixels}`

**Step 4: Filter by Size & Ink Content**
```python
max_ink_pixels = maximum ink in any candidate
min_threshold = max(64, 12% of max_ink_pixels)

for candidate:
    if width < 24 or height < 12:
        reject  # Too small
    if ink_pixels < min_threshold:
        reject  # Too faint
    else:
        keep
```

**Output:** List of line images (each is separate word/line segment)

**Visual Example:**
```
Input: Three lines of handwriting
━━━━━━━━━━━━━━━━  ← Line 1
━━━━━━━━━━━━━━━━  ← Line 2
━━━━━━━━━━━━━━━━  ← Line 3

Output: [line1_image, line2_image, line3_image]
```

---

### 6. **_prepare_trocr_image(img, mode="sentence", pad=24, min_width=256, min_height=96, preprocessed=False) → PIL.Image**

**Purpose:** Final image preparation for TrOCR model input

**Process:**

**Step 1: Crop Content**
```python
cropped = crop_to_content(img, pad=pad)
```

**Step 2: Convert to Grayscale**
```python
gray = _to_grayscale(cropped)
```

**Step 3: Apply Filters (if not preprocessed)**
```python
if not preprocessed:
    # Reduce noise with bilateral filter
    if std_deviation > 30:
        gray = bilateral_filter(radius=3, sigma=25)
    
    # Binary thresholding: pixels < 200 = black, else white
    _, gray = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY)
```

**Step 4: Resize with Padding**
```python
current_height, current_width = gray.shape

# Use natural size, enforce minimum
target_height = max(current_height, 64)
target_width = max(current_width, 64)

# If padding needed, center the image on white canvas
if target_height > height or target_width > width:
    canvas = np.full((target_height, target_width), 255, dtype=uint8)
    dy = (target_height - height) // 2
    dx = (target_width - width) // 2
    canvas[dy:dy+height, dx:dx+width] = gray
    gray = canvas
```

**Step 5: Convert to RGB PIL Image**
```python
rgb = cv2.cvtColor(gray, cv2.COLOR_GRAY2RGB)
return PIL.Image.fromarray(rgb)
```

**Output:** PIL Image ready for TrOCR processor

---

### 7. **_save_debug_prepared_images(prepared_images, mode) → None**

**Purpose:** Save intermediate processed images for debugging OCR failures

**Process:**
1. Create `artifacts/ocr_debug/prepared/` directory
2. Delete all existing `latest_*.png` files (cleanup old latest)
3. Generate timestamp: milliseconds since epoch
4. For each prepared image:
   - Save as `latest_{mode}_{idx:02d}.png` (always overwritten)
   - Save as `{timestamp}_{mode}_{idx:02d}.png` (unique copy)

**Output:** Images in `artifacts/ocr_debug/prepared/`

---

### TrOCR Model Class

### 8. **_TrOCREngine Class**

**Purpose:** Wrapper around Microsoft's TrOCR model for handwriting recognition

#### **Constructor: __init__(model_ref)**

**Parameters:**
- `model_ref` - Path to local model or Hugging Face model ID

**Initialization Process:**

**Step 1: Check Dependencies**
```python
try:
    import torch
    import transformers
except:
    self.error = "missing TrOCR dependencies"
    return  # Not available
```

**Step 2: Load PyTorch & Detect Hardware**
```python
self.torch = torch
self.device = "cuda" if torch.cuda.is_available() else "cpu"

# Use float16 on GPU for memory efficiency
if device == "cuda":
    model_kwargs["torch_dtype"] = torch.float16
```

**Step 3: Load Model & Processor**
```python
# Processor: converts PIL image → model input tensors
self.processor = TrOCRProcessor.from_pretrained(model_ref)

# Model: vision encoder + text decoder
self.model = VisionEncoderDecoderModel.from_pretrained(model_ref, **model_kwargs)
self.model.to(device)        # Move to GPU/CPU
self.model.eval()            # Disable dropout, batch norm
self.available = True        # Mark as ready
```

**Attributes Created:**
| Attribute | Type | Meaning |
|-----------|------|---------|
| `model_ref` | str | Model identifier |
| `available` | bool | Is model loaded successfully? |
| `error` | str | Error message if failed |
| `device` | str | "cuda" or "cpu" |
| `processor` | TrOCRProcessor | Image → Tensor converter |
| `model` | VisionEncoderDecoderModel | The AI model |
| `torch` | module | PyTorch library |

---

#### **Method: predict(image, mode="sentence", preprocessed=False) → str**

**Purpose:** Run OCR inference on an image and return recognized text

**Parameters:**
- `image` - Preprocessed OpenCV image
- `mode` - "word", "line", or "sentence"
- `preprocessed` - Skip additional filtering

**Process:**

**Step 1: Check Availability**
```python
if not self.available:
    return ""  # Model not loaded
```

**Step 2: Segmentation**
```python
segments = [image]  # Default: process whole image

if mode in {"line", "sentence"}:
    # Try to split into lines
    line_segments = _split_into_lines(image)
    if line_segments:
        segments = line_segments  # Use split lines
```

**Step 3: Configure Decoder**
```python
decode_config = {
    "word":     {"max_new_tokens": 20,  "num_beams": 3},  # Short, fast
    "line":     {"max_new_tokens": 64,  "num_beams": 4},  # Medium
    "sentence": {"max_new_tokens": 96,  "num_beams": 5},  # Long, slower
}
```

The settings control text generation:
- **max_new_tokens:** Maximum words to generate
- **num_beams:** Beam search width (higher = better quality, slower)

**Step 4: Process Each Segment**
```python
for segment in segments:
    # Prepare image
    prepared = _prepare_trocr_image(segment, mode, preprocessed)
    if prepared is None:
        continue  # Skip empty/invalid segments
    
    # Convert to model input
    pixel_values = processor(images=prepared, return_tensors="pt")
    pixel_values = pixel_values.to(device)
    
    # Run inference
    with torch.inference_mode():  # Disable gradients for speed
        generated_ids = model.generate(
            pixel_values,
            max_new_tokens=decode_config["max_new_tokens"],
            num_beams=decode_config["num_beams"],
            early_stopping=True,           # Stop if perfect confidence
            repetition_penalty=1.2,        # Avoid repeating words
        )
    
    # Decode token IDs to text
    text = processor.batch_decode(generated_ids, skip_special_tokens=True)[0]
    
    # Clean the text
    cleaned = _clean_prediction(text, mode=mode)
    if cleaned:
        outputs.append(cleaned)
```

**Step 5: Save Debug Images & Return**
```python
if not outputs:
    return ""  # No output

_save_debug_prepared_images(prepared_debug_images, mode)

# Join results
joined = " ".join(outputs)

# Final cleaning pass
return _clean_prediction(joined, mode=mode)
```

**Output:** String of recognized text

---

### 9. **_clean_prediction(text, mode="sentence") → str**

**Purpose:** Post-process OCR output to fix common artifacts

**Process:**

**Step 1: Normalize Whitespace**
```python
cleaned = " ".join(text.split()).strip()
# Replaces multiple spaces/newlines with single space
```

**Step 2: Remove Trailing Punctuation**
```python
cleaned = cleaned.strip(".,;:!?\"'`-_=+~")
```

**Step 3: Handle Leading Numbers**
```python
tokens = cleaned.split()

# If first token is digits AND other tokens have letters
if (len(tokens) > 1 and token[0] is all digits and 
    other tokens contain letters):
    tokens = tokens[1:]  # Remove leading digits
    # Example: "123 hello world" → "hello world"
```

**Step 4: Remove Leading Special Characters**
```python
# If first token is non-alphanumeric
if len(tokens) > 1 and token[0] is special chars only:
    tokens = tokens[1:]  # Remove it
    # Example: "!@# hello" → "hello"
```

**Step 5: Final Cleanup**
```python
cleaned = " ".join(tokens).strip(".,;:!?\"'`-_=+~")
return cleaned
```

**Examples:**
```
Input:  "  123   hello  world  !!  "
Step 1: "123 hello world !!"
Step 2: "123 hello world"
Step 3: "hello world"  (remove leading 123)
Step 4: "hello world"  (no special chars to remove)
Output: "hello world"
```

---

### Model Configuration Functions

### 10. **_preferred_trocr_model_ref() → str**

**Purpose:** Determine which TrOCR model to use (in priority order)

**Priority:**
1. **Environment Variable:** `AIRDRAW_OCR_MODEL` if set
2. **Local Model:** If `artifacts/trocr_airdraw/best/` exists
3. **Hugging Face:** Default `microsoft/trocr-large-handwritten`

**Output:** Model path/ID string

---

### 11. **_local_trocr_checkpoint_dir() → str**

**Purpose:** Get path to local TrOCR model directory

**Always Returns:** `PROJECT_ROOT / "artifacts" / "trocr_airdraw" / "best"`

---

### 12. **_get_trocr_engine() → _TrOCREngine**

**Purpose:** Get (or create) the TrOCR engine instance

**Caching:** Uses `@lru_cache(maxsize=1)` - engine loads once and is reused

**Process:**
1. On first call: Create `_TrOCREngine` instance
2. On subsequent calls: Return cached instance
3. Efficient: Model loaded only once per server startup

**Output:** _TrOCREngine instance

---

### 13. **_trocr_dependencies_ready() → tuple(bool, str)**

**Purpose:** Check if PyTorch and Transformers are installed

**Returns:**
```python
(True, "")           # Dependencies installed
(False, "error msg") # Missing or error
```

**Used For:** Health checks without loading full model

---

### 14. **get_ocr_backend_status(load_model=True) → dict**

**Purpose:** Comprehensive status report of OCR backend

**Parameters:**
- `load_model` - If True, check actual model loading; if False, only check dependencies

**Returns (load_model=False):**
```json
{
    "backend": "trocr" or "unavailable",
    "model_ref": "path/to/model or microsoft/trocr-id",
    "local_checkpoint": "path/to/local/model",
    "reason": ""  // Error message if unavailable
}
```

**Returns (load_model=True):**
```json
{
    "backend": "trocr",
    "device": "cuda" or "cpu",
    "model_ref": "actual model used",
    "local_checkpoint": "path",
    "reason": ""  // Error message if unavailable
}
```

**Used By:** `/health` endpoint

---

### 15. **run_ocr(canvas, mode="sentence", preprocessed=False) → str**

**Purpose:** Main entry point - runs OCR on image and returns recognized text

**Process:**
1. Get TrOCR engine instance
2. Check if available
3. Call `engine.predict()` with error handling
4. Return empty string on any exception

**Parameters:**
- `canvas` - OpenCV image to recognize
- `mode` - "word", "line", or "sentence"
- `preprocessed` - Skip additional filtering

**Output:** Recognized text string (empty if failed)

---

## WebSocket Protocol

### Message Format: JSON

All messages are UTF-8 JSON text.

### Client → Server Messages

#### 1. OCR Request
```json
{
    "type": "ocr",
    "mode": "sentence",
    "image": "data:image/png;base64,iVBORw0KGgo...",
    "source_image": "data:image/png;base64,iVBORw0KGgo...",
    "preprocessed": false
}
```

| Field | Required | Type | Values | Notes |
|-------|----------|------|--------|-------|
| type | ✓ | string | "ocr" | Message type |
| mode | ✓ | string | "word"\|"line"\|"sentence" | Affects OCR settings |
| image | ✓ | string | Base64 PNG | Canvas image to recognize |
| source_image | ✗ | string | Base64 PNG | Original before preprocessing |
| preprocessed | ✗ | bool | true\|false | Skip bilateral filter/threshold |

#### 2. Keep-Alive Ping
```json
{
    "type": "ping"
}
```

### Server → Client Messages

#### 1. OCR Result (Success)
```json
{
    "type": "ocr_result",
    "text": "hello world",
    "success": true
}
```

#### 2. OCR Result (Failure)
```json
{
    "type": "ocr_result",
    "text": "",
    "success": false,
    "message": "Could not recognize text"
}
```

#### 3. Keep-Alive Pong
```json
{
    "type": "pong"
}
```

#### 4. Error Response
```json
{
    "type": "error",
    "message": "Connection error or exception message"
}
```

---

## Complete Request Flow

### Step-by-Step Timeline

```
TIME    COMPONENT           ACTION
────────────────────────────────────────────────────────────────

 0ms    Browser            User draws on canvas with hand
        Canvas             Image stored as PNG on canvas

150ms   Browser            Ready to submit
        WebSocket Client   Create JSON message:
                          {
                            "type": "ocr",
                            "mode": "sentence",
                            "image": "data:image/png;base64,..."
                          }

160ms   Network            JSON message transmitted over WebSocket

170ms   Backend            /ws endpoint receives message
        WebSocket Handler  
        └─ Parse JSON      msg = {"type": "ocr", ...}
        └─ Extract fields  mode="sentence", b64_img="..."

180ms   Backend            Image Decoding
        base64_to_cv2()    
        └─ Strip prefix    "data:image/png;base64," removed
        └─ Decode base64   bytes = base64.b64decode(...)
        └─ NumPy array     np_arr = np.frombuffer(...)
        └─ cv2.imdecode    canvas = OpenCV image

190ms   Backend            Debug Logging
        save_debug_ocr_bundle()
        ├─ Save canvas PNG → artifacts/ocr_debug/latest_ocr_input.png
        ├─ Save timestamp   → artifacts/ocr_debug/{ts}_ocr_input.png
        └─ Write metadata   → artifacts/ocr_debug/latest_request.json

200ms   Backend            OCR Processing
        run_ocr() from ocr.py
        │
        ├─ Get _TrOCREngine (cached)
        │
        ├─ PREPROCESSING PIPELINE
        │  crop_to_content()
        │  ├─ _ink_mask()     → Find text pixels
        │  └─ Return cropped  → Remove white space
        │
        │  _to_grayscale()
        │  └─ Convert → Grayscale with auto-brightness
        │
        │  _prepare_trocr_image()
        │  ├─ Bilateral filter (noise reduction)
        │  ├─ Binary threshold (black/white only)
        │  └─ Resize + pad to minimum size
        │
        │  For "line"/"sentence" mode also:
        │  └─ _split_into_lines()
        │     ├─ Detect row activity
        │     ├─ Group into ranges
        │     └─ Extract individual lines
        │
        ├─ MODEL INFERENCE
        │  For each segment:
        │  ├─ processor.process_image() → Tensor
        │  ├─ model.generate() with beam search
        │  │  ├─ max_new_tokens: 20 (word), 64 (line), 96 (sentence)
        │  │  └─ num_beams: 3, 4, 5 (higher = better quality)
        │  ├─ processor.decode() → Text
        │  └─ _clean_prediction() → Remove artifacts
        │
        ├─ POST-PROCESSING
        │  _save_debug_prepared_images()
        │  └─ Save intermediate processed images
        │
        └─ RETURN RESULT
           Full recognized text

350ms   Backend            WebSocket Response
        websocket.send_text()
        └─ Send JSON:
           {
             "type": "ocr_result",
             "text": "hello world",
             "success": true
           }

365ms   Network            JSON response transmitted

375ms   Browser            Response Handler
        WebSocket Client   
        ├─ Parse JSON
        ├─ Check success flag
        ├─ Extract text
        └─ Display to user
        
380ms   UI Update         User sees "hello world" in text field
```

### Processing Flow Diagram

```
INPUT: Base64 PNG from browser
  ↓
DECODE
  │ base64_to_cv2()
  │ └─ Base64 → OpenCV image
  ↓
CROP TO CONTENT
  │ crop_to_content()
  │ └─ _ink_mask() → Find ink pixels
  │ └─ Remove white space padding
  ↓
GRAYSCALE CONVERSION
  │ _to_grayscale()
  │ └─ Auto-correct for inverted image
  ↓
SPLIT INTO LINES (for "line"/"sentence" mode)
  │ _split_into_lines()
  │ ├─ Detect horizontal text rows
  │ ├─ Filter by size and ink content
  │ └─ Return list of line images
  ↓ (or single full image if "word" mode)
FOR EACH SEGMENT
  │ _prepare_trocr_image()
  │ ├─ Apply bilateral filter (noise reduction)
  │ ├─ Binary threshold (black/white)
  │ ├─ Resize with padding to minimum size
  │ └─ PIL Image ready for model
  ↓
MODEL INFERENCE
  │ _TrOCREngine.predict()
  │ ├─ processor() → Convert image to tensor
  │ ├─ model.generate() → Generate tokens
  │ │  (with beam search, 3-5 beams)
  │ ├─ processor.decode() → Token IDs to text
  │ ├─ _clean_prediction() → Remove artifacts
  │ └─ Append to results list
  ↓
COMBINE RESULTS (for multi-line)
  │ Join line outputs with spaces
  │ Final _clean_prediction()
  ↓
OUTPUT: Recognized text string
```

---

## Error Handling

### Backend Error Scenarios

#### 1. Missing Image Data
```
Browser sends: {"type": "ocr", "image": ""}
Server response: {"type": "error", "message": "No image data received"}
```

#### 2. Invalid Base64 / Image Decode Error
```
Browser sends corrupted/invalid image
base64_to_cv2() returns None
Server response: {"type": "error", "message": "Could not decode image"}
```

#### 3. OCR Model Not Available
```
TrOCR dependencies missing or model fails to load
_TrOCREngine.available = False
run_ocr() returns ""
Server response: {"type": "ocr_result", "text": "", "success": false, "message": "Could not recognize text"}
```

#### 4. No Text Detected
```
All preprocessing attempts result in blank image
_prepare_trocr_image() returns None for all segments
run_ocr() returns ""
Server response: {"type": "ocr_result", "text": "", "success": false}
```

#### 5. WebSocket Disconnect
```
Browser closes connection while processing
WebSocketDisconnect exception caught
print("Client disconnected")
Connection closed gracefully
```

#### 6. Unexpected Exception During Processing
```
Any unhandled exception in OCR pipeline
try/except in websocket_endpoint
Server response: {"type": "error", "message": str(exception)}
```

### Debugging

**Debug Files Location:** `artifacts/ocr_debug/`

| File | Contains | When Created |
|------|----------|--------------|
| `latest_source_canvas.png` | Original canvas before preprocessing | Every OCR request |
| `latest_ocr_input.png` | Processed image sent to OCR | Every OCR request |
| `latest_request.json` | Metadata (mode, timestamp, etc.) | Every OCR request |
| `prepared/latest_*.png` | Image at various preprocessing stages | After model inference |
| `{timestamp}_*` | Timestamped copies for audit trail | Every OCR request |

**To Debug Failed OCR:**
1. Check `artifacts/ocr_debug/latest_ocr_input.png` - is text visible?
2. Check `artifacts/ocr_debug/prepared/latest_*.png` - how does preprocessing affect it?
3. Check `artifacts/ocr_debug/latest_request.json` - what mode/settings were used?
4. Check server logs for errors

---

## Performance Characteristics

### Timing Breakdown (Approximate)

| Operation | Device | Time |
|-----------|--------|------|
| Image decode (base64) | CPU | 5-10 ms |
| Preprocessing (crop, grayscale, filter) | CPU | 10-20 ms |
| Line splitting | CPU | 5-15 ms |
| Model preprocessing (tensor conversion) | CPU→GPU | 10-20 ms |
| Model inference (one line, beam=4) | GPU | 50-150 ms |
| Model inference (one line, beam=4) | CPU | 200-500 ms |
| Post-processing & cleanup | CPU | 5-10 ms |
| **Total single line** | GPU | ~100-200 ms |
| **Total single line** | CPU | ~250-600 ms |
| **Total multi-line sentence** | GPU | 300-800 ms |
| **Total multi-line sentence** | CPU | 1-3 seconds |

### Memory Usage

- **Model Size:** ~1.6 GB (uncompressed)
- **Runtime Peak:** 2-3 GB (with batch operations)
- **Per Image:** 100-500 MB temporary tensors

---

## Key Design Decisions

### Why These Choices?

| Design Choice | Reason |
|---------------|--------|
| **WebSocket over HTTP** | Real-time communication, lower latency than polling |
| **Base64 encoding** | Universal browser image format (works in all browsers) |
| **Local model preferred** | Faster inference, no internet required, privacy |
| **Multi-segment processing** | Better accuracy on multi-line text than full image |
| **Beam search (not greedy)** | More accurate text generation (tradeoff: slower) |
| **Binary thresholding** | TrOCR trained on clean black/white documents |
| **Bilateral filtering** | Noise reduction while preserving edges |
| **Alpha blending for RGBA** | Proper transparency handling |
| **Debug image logging** | Essential for troubleshooting failed requests |
| **Caching TrOCR engine** | Model load is expensive (~2 seconds), reuse instance |

---

## Summary Function Reference

### Main.py

| Function | Input | Output | Purpose |
|----------|-------|--------|---------|
| `base64_to_cv2()` | Base64 string | OpenCV image | Decode browser image |
| `save_debug_image()` | Image, Path | File | Save PNG for debugging |
| `save_debug_ocr_bundle()` | Images, metadata | Files + JSON | Save complete debug set |
| **`websocket_endpoint()`** | WebSocket | JSON responses | **Main handler** - runs OCR |
| `root()` | None | HTML or JSON | Serve frontend |
| `health()` | None | Status dict | System status check |
| `hand_landmarker()` | None | Binary file | Serve MediaPipe model |

### OCR.py

| Function | Input | Output | Purpose |
|----------|-------|--------|---------|
| `_ensure_bgr()` | Any image | BGR image | Standardize format |
| `_to_grayscale()` | Image | Grayscale | Convert to gray |
| `_ink_mask()` | Image | Boolean mask | Find text pixels |
| `crop_to_content()` | Image | Cropped image | Remove white space |
| `_split_into_lines()` | Image | List of images | Split multi-line text |
| `_prepare_trocr_image()` | Image | PIL Image | Final model prep |
| `_save_debug_prepared_images()` | Images | Files | Save debug images |
| **`_TrOCREngine`** | Model path | Engine instance | **Model wrapper** |
| **`_TrOCREngine.predict()`** | Image | Text | **Main inference** |
| `_clean_prediction()` | Text | Cleaned text | Fix OCR artifacts |
| `_preferred_trocr_model_ref()` | None | String | Choose model |
| `_get_trocr_engine()` | None | Engine | Get cached instance |
| `get_ocr_backend_status()` | None | Status dict | Health check |
| **`run_ocr()`** | Image | Text | **Main entry point** |

---

## Conclusion

This backend implements a complete **OCR pipeline** for recognizing handwritten text:

1. **Receives** images via WebSocket in real-time
2. **Preprocesses** images (crop, grayscale, denoise, threshold)
3. **Segments** multi-line text into individual lines
4. **Runs** Microsoft TrOCR model for text recognition
5. **Post-processes** results (cleaning and formatting)
6. **Returns** recognized text to browser

The architecture is modular, well-tested, and includes comprehensive debugging capabilities.
