# Code Fixes for Air Drawing App

## Fix 1: PDF Viewer - Add Cursor Tracking for Open Hand

**File:** `frontend/js/pdf-viewer/main.js`

**Find this function (around line 1400):**
```javascript
function handleOpen(lm) {
  if (searchOverlayActive) {
    showPill("🔎 Search pad active", "#22d3ee");
    return;
  }

  if (currentStroke) finishPenStroke();
  prevWristX = null;
  openStableFrames = 0;
  showPill("✋ Open hand idle", "#94a3b8");
}
```

**Replace with:**
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
  
  // ✅ ADD: Reset search state with open hand
  if (activeTool === "search" && !searchOverlayActive) {
    setActiveTool("cursor");  // Switch back to cursor mode
    showPill("✋ Search cleared → Cursor mode", "#22d3ee");
    return;
  }
  
  showPill("✋ Open hand idle", "#94a3b8");
}
```

---

## Fix 2: PDF Viewer - Add Eraser Tool

### Step 1: Update HTML

**File:** `frontend/pdf-viewer.html`

**Find this section (around line 130):**
```html
<!-- Virtual floating toolbar (gesture-selectable) -->
<div class="virtual-toolbar" id="virtual-toolbar">
  <div class="v-btn active" data-tool="cursor">🖱 Cursor</div>
  <div class="v-btn" data-tool="pen">✍️ Pen</div>
  <div class="v-btn" data-tool="search">🔎 Search</div>
</div>
```

**Replace with:**
```html
<!-- Virtual floating toolbar (gesture-selectable) -->
<div class="virtual-toolbar" id="virtual-toolbar">
  <div class="v-btn active" data-tool="cursor">🖱 Cursor</div>
  <div class="v-btn" data-tool="pen">✍️ Pen</div>
  <div class="v-btn" data-tool="eraser">🧹 Eraser</div>
  <div class="v-btn" data-tool="search">🔎 Search</div>
</div>
```

### Step 2: Add Eraser Logic

**File:** `frontend/js/pdf-viewer/main.js`

**Find the `handlePoint()` function (around line 1250) and add this BEFORE the `if (activeTool === "cursor")` block:**

```javascript
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
```

### Step 3: Add Eraser Helper Functions

**File:** `frontend/js/pdf-viewer/main.js`

**Add these functions AFTER the `drawHighlighterCursor()` function (around line 1350):**

```javascript
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

## Fix 3: Main App - Always Show Cursor

**File:** `frontend/js/app.js`

**Find the render loop section where gestures are processed (around line 1050). Add this code AFTER the gesture classification but BEFORE action processing:**

```javascript
  if (result.landmarks && result.landmarks.length > 0) {
    const lm = result.landmarks[0];
    
    // ... existing code for outlier detection ...
    
    const gesture = updateStableGesture(classifyGesture(lm));
    const action = resolvePointerAction(gesture);
    
    // ✅ ADD: Always show cursor position indicator
    if (!outlier && !buttonConsumed && action !== "DRAW" && action !== "ERASE") {
      // Draw a subtle cursor for non-drawing modes
      oCtx.strokeStyle = action === "PAN" ? "#ffaa00" : "#00cccc";
      oCtx.lineWidth = 2;
      oCtx.beginPath();
      oCtx.arc(cx, cy, 8, 0, Math.PI * 2);
      oCtx.stroke();
      
      // Add small dot in center
      oCtx.fillStyle = action === "PAN" ? "#ffaa00" : "#00cccc";
      oCtx.beginPath();
      oCtx.arc(cx, cy, 2, 0, Math.PI * 2);
      oCtx.fill();
    }
    
    // ... rest of action processing ...
  }
```

---

## Fix 4: Optimize Model Loading

**File:** `backend/ocr.py`

**Add this function at the top of the file (after imports):**

```python
import os
from functools import lru_cache

# Add environment variable for model optimization
USE_QUANTIZED_MODEL = os.getenv("USE_QUANTIZED_MODEL", "false").lower() == "true"

def _preferred_trocr_model_ref():
    """Resolve which TrOCR checkpoint to use with optimization support."""
    explicit = os.getenv("AIRDRAW_OCR_MODEL", "").strip()
    if explicit:
        return explicit
    
    # Check for quantized model first (if enabled)
    if USE_QUANTIZED_MODEL:
        quantized_path = PROJECT_ROOT / "artifacts" / "trocr_quantized"
        if _has_model_files(quantized_path):
            print(f"Using quantized model from {quantized_path}")
            return str(quantized_path)
    
    # Original logic
    if _has_model_files(DEFAULT_TROCR_MODEL_DIR):
        return str(DEFAULT_TROCR_MODEL_DIR)
    if _has_model_files(FALLBACK_TROCR_MODEL_DIR):
        return str(FALLBACK_TROCR_MODEL_DIR)
    return DEFAULT_TROCR_MODEL_ID
```

---

## Fix 5: Add .gitignore Fixes

**File:** `.gitignore`

**Replace entire file with:**

```gitignore
# Python
venv/
__pycache__/
*.pyc
*.pyo
*.pyd
.Python
*.so
*.egg
*.egg-info/
dist/
build/

# IDE
.vscode/
.idea/
*.swp
*.swo
*~

# OS
.DS_Store
Thumbs.db

# Project specific
drawing.png

# OCR debug images (auto-generated, can be large)
artifacts/ocr_debug/

# Generated train/val/test manifests
data/manifests/

# Fine-tuned model checkpoints (large; add back if you want to ship them)
artifacts/trocr_airdraw/
artifacts/trocr_airdraw_test/
artifacts/trocr_airdraw_test_local/
artifacts/trocr_large_model/
artifacts/trocr_finetuned/
artifacts/trocr_quantized/

# Environment variables
.env
.env.local

# Logs
*.log
logs/

# Temporary files
*.tmp
*.temp
```

---

## How to Apply These Fixes

### Method 1: Manual Copy-Paste
1. Open each file mentioned above
2. Find the specified section
3. Replace or add the code as indicated

### Method 2: Using Git Patches
```bash
cd air-drawing-app

# Create a new branch for fixes
git checkout -b optimization-fixes

# Apply fixes manually using this guide
# Then commit
git add .
git commit -m "Apply cursor tracking and eraser fixes"
```

### Method 3: Test Individual Fixes
```bash
# Test PDF viewer fixes
# 1. Apply Fix 1 and Fix 2
# 2. Open http://localhost:8000/pdfviewer
# 3. Load a PDF
# 4. Enable camera
# 5. Test open hand gesture - cursor should now be visible
# 6. Select eraser tool - should be able to erase annotations

# Test main app cursor fix
# 1. Apply Fix 3
# 2. Open http://localhost:8000
# 3. Enable camera
# 4. Move hand around - cursor should always be visible
```

---

## Verification Checklist

After applying fixes, verify:

- [ ] PDF Viewer: Open hand shows cursor
- [ ] PDF Viewer: Open hand resets search mode
- [ ] PDF Viewer: Eraser tool appears in toolbar
- [ ] PDF Viewer: Eraser removes pen strokes
- [ ] PDF Viewer: Eraser removes highlights
- [ ] Main App: Cursor visible in all modes
- [ ] Main App: Cursor visible when hand is idle
- [ ] .gitignore: venv/ not tracked
- [ ] .gitignore: __pycache__/ not tracked
- [ ] Model: Loads successfully on startup

---

## Performance Testing

After fixes, test performance:

```bash
# 1. Check model load time
time python -c "from backend.ocr import _get_trocr_engine; _get_trocr_engine()"

# 2. Check OCR response time
# Open browser console, run:
console.time("OCR");
// Trigger OCR
console.timeEnd("OCR");

# 3. Check memory usage
# In terminal:
ps aux | grep uvicorn
```

Expected results:
- Model load: 5-15 seconds (first time)
- OCR response: 1-3 seconds
- Memory usage: 2-4 GB

---

## Troubleshooting

### Issue: Cursor still not showing
**Solution:** Clear browser cache and hard reload (Cmd+Shift+R on Mac, Ctrl+Shift+R on Windows)

### Issue: Eraser not working
**Solution:** Check browser console for errors. Ensure all three parts of Fix 2 are applied.

### Issue: Model not loading
**Solution:** Check that `artifacts/trocr_large_model/` contains model files. If not, model will download from Hugging Face on first run.

### Issue: High memory usage
**Solution:** Consider using quantized model (see optimization guide in PROJECT_DOCUMENTATION.md)
