// ═══════════════════════════════════════════════════════════════════
// AIR DRAWING APP — Main Application
//
// This is the entry point. It ties everything together:
//   1. DOM elements        — references to HTML elements
//   2. Drawing             — ink on the canvas
//   3. Undo / Redo         — snapshot-based history
//   4. OCR                 — send drawings to the server for text recognition
//   5. WebSocket           — real-time connection to the backend
//   6. Camera & MediaPipe  — webcam + hand tracking setup
//   7. Render loop         — runs every frame, processes hand gestures
//   8. Event listeners     — toolbar button clicks
//   9. Init                — starts everything
// ═══════════════════════════════════════════════════════════════════

import {
  WS_URL, BACKEND_URL,
  MEDIAPIPE_CDN_MODULE, MEDIAPIPE_CDN_WASM,
  MEDIAPIPE_LOCAL_MODULE, MEDIAPIPE_LOCAL_WASM,
  COLORS, VIRTUAL_W, VIRTUAL_H,
  DEFAULT_BRUSH_SIZE, ERASER_RADIUS, DRAW_DEADZONE, MAX_UNDO_STEPS,
  LOST_HAND_RESET_FRAMES,
  state,
} from "./config.js";

import { PointFilter } from "./pointer-filter.js";

import {
  classifyGesture, updateStableGesture,
  isLandmarkOutlier, addToLandmarkHistory,
  resolvePointerAction,
} from "./gestures.js";

import {
  initVirtualButtons, drawVirtualButtons, checkVirtualButtonDwell,
} from "./virtual-buttons.js";


// ═══════════════════════════════════════════════════════════════════
// 1. DOM ELEMENTS
// ═══════════════════════════════════════════════════════════════════

const video          = document.getElementById("webcam");
const drawCanvas     = document.getElementById("draw-canvas");
const overCanvas     = document.getElementById("overlay-canvas");
const dCtx           = drawCanvas.getContext("2d", { willReadFrequently: true });
const oCtx           = overCanvas.getContext("2d");
const modeLabel      = document.getElementById("mode-label");
const ocrBar         = document.getElementById("ocr-bar");
const ocrText        = document.getElementById("ocr-text");
const connStatus     = document.getElementById("conn-status");
const sampleInput    = document.getElementById("sample-label");
const sampleStatus   = document.getElementById("sample-status");
const eraseBtn       = document.getElementById("btn-erase");
const undoBtn        = document.getElementById("btn-undo");
const redoBtn        = document.getElementById("btn-redo");
const focusBtn       = document.getElementById("btn-focus");
const pdfViewerBtn   = document.getElementById("btn-pdf-viewer");
const canvasWrapper  = document.getElementById("canvas-wrapper");
const handLossEl     = document.getElementById("hand-loss-indicator");
const colorBtnsEl    = document.getElementById("color-btns");

// Pointer smoother (reduces hand tracking jitter)
const pointerFilter = new PointFilter();


// ═══════════════════════════════════════════════════════════════════
// 2. HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Update the mode label in the toolbar. */
function setMode(m) {
  state.mode = m;
  const map = {
    DRAW:  { text: "● DRAWING",  color: "#00dd55" },
    ERASE: { text: "◌ ERASING",  color: "#2255ff" },
    LIFT:  { text: "✦ PEN UP",   color: "#00cccc" },
    PAN:   { text: "✊ PANNING",  color: "#ffaa00" },
    IDLE:  { text: "◌ READY",    color: "#555"    },
  };
  const entry = map[m] || map.IDLE;
  modeLabel.textContent = entry.text;
  modeLabel.style.color = entry.color;
}

/** Reset all stroke and gesture tracking state. */
function resetStrokeState() {
  state.prevX = null;
  state.prevY = null;
  pointerFilter.reset();
  state.stableGesture = "IDLE";
  state.gestureCandidate = "IDLE";
  state.gestureCandidateFrames = 0;
  state.fingerHistory = [];
  state.gestureHistory = [];
  state.landmarkHistory = [];
  state.activeCanvasAction = "IDLE";
}

/** Break the current stroke (next draw will start a new line). */
function breakStrokePath() {
  state.prevX = null;
  state.prevY = null;
}

/** Toggle eraser mode on/off. */
function setEraserMode(enabled) {
  state.eraserMode = enabled;
  eraseBtn.classList.toggle("active", enabled);
  resetStrokeState();
}

/** Toggle focus/whiteboard mode (hides webcam, white background). */
function setFocusMode(enabled) {
  state.focusMode = enabled;
  canvasWrapper.classList.toggle("focus-mode", enabled);
  focusBtn.classList.toggle("active", enabled);
  if (enabled) {
    state.colorIdx = 0;
    setEraserMode(false);
    syncColorButtons();
  }
}

/** Sync HTML color buttons to match state.colorIdx. */
function syncColorButtons() {
  document.querySelectorAll(".color-btn").forEach(b => b.classList.remove("active"));
  colorBtnsEl.children[state.colorIdx]?.classList.add("active");
}


// ═══════════════════════════════════════════════════════════════════
// 3. BUILD COLOR BUTTONS (HTML toolbar)
// ═══════════════════════════════════════════════════════════════════

colorBtnsEl.style.cssText = "display:flex;gap:6px;align-items:center";
COLORS.forEach((c, i) => {
  const btn = document.createElement("div");
  btn.className = "color-btn" + (i === 0 ? " active" : "");
  btn.style.background = c.hex;
  btn.title = c.name;
  btn.onclick = () => {
    state.colorIdx = i;
    setEraserMode(false);
    syncColorButtons();
  };
  colorBtnsEl.appendChild(btn);
});


// ═══════════════════════════════════════════════════════════════════
// 4. DRAWING FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

/** Push a canvas snapshot for undo. */
function pushUndoSnapshot() {
  try {
    state.undoStack.push(drawCanvas.toDataURL("image/png"));
    if (state.undoStack.length > MAX_UNDO_STEPS) state.undoStack.shift();
    state.redoStack = [];
  } catch (e) {
    console.warn("Could not save undo snapshot:", e);
  }
}

/** Restore the canvas from a data URL. */
function restoreCanvasFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      dCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
      dCtx.globalCompositeOperation = "source-over";
      dCtx.drawImage(img, 0, 0, drawCanvas.width, drawCanvas.height);
      resolve();
    };
    img.onerror = () => reject(new Error("Could not restore canvas"));
    img.src = dataUrl;
  });
}

/** Undo the last drawing action. */
async function undoLastAction() {
  if (!state.undoStack.length) {
    modeLabel.textContent = "NOTHING TO UNDO";
    modeLabel.style.color = "#ffcc66";
    return;
  }
  try {
    state.redoStack.push(drawCanvas.toDataURL("image/png"));
    if (state.redoStack.length > MAX_UNDO_STEPS) state.redoStack.shift();
  } catch (e) { /* ignore */ }

  await restoreCanvasFromDataUrl(state.undoStack.pop());
  breakStrokePath();
  state.activeCanvasAction = "IDLE";
  setMode("IDLE");
}

/** Redo a previously undone action. */
async function redoLastAction() {
  if (!state.redoStack.length) {
    modeLabel.textContent = "NOTHING TO REDO";
    modeLabel.style.color = "#ffcc66";
    return;
  }
  try {
    state.undoStack.push(drawCanvas.toDataURL("image/png"));
    if (state.undoStack.length > MAX_UNDO_STEPS) state.undoStack.shift();
  } catch (e) { /* ignore */ }

  await restoreCanvasFromDataUrl(state.redoStack.pop());
  breakStrokePath();
  state.activeCanvasAction = "IDLE";
  setMode("IDLE");
}

/** Track current action type for undo grouping. */
function beginCanvasAction(action) {
  if (action !== "DRAW" && action !== "ERASE") {
    state.activeCanvasAction = action;
    return;
  }
  if (state.activeCanvasAction !== action) {
    pushUndoSnapshot();
  }
  state.activeCanvasAction = action;
}

/** Draw a line/dot at the given screen position. */
function drawAtPoint(cx, cy, nowSec) {
  beginCanvasAction("DRAW");
  setMode("DRAW");

  // Convert screen coords → virtual canvas coords
  const vx = cx + state.panX;
  const vy = cy + state.panY;

  dCtx.globalCompositeOperation = "source-over";
  const col = COLORS[state.colorIdx].rgb;
  dCtx.strokeStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
  dCtx.fillStyle   = `rgb(${col[0]},${col[1]},${col[2]})`;
  dCtx.lineWidth = state.brushSize;
  dCtx.lineCap = "round";
  dCtx.lineJoin = "round";

  if (state.prevX === null) {
    state.prevX = vx;
    state.prevY = vy;
  }

  const dx = vx - state.prevX;
  const dy = vy - state.prevY;
  const dist = Math.hypot(dx, dy);

  if (dist >= DRAW_DEADZONE) {
    // Draw a line from previous position
    dCtx.beginPath();
    dCtx.moveTo(state.prevX, state.prevY);
    dCtx.lineTo(vx, vy);
    dCtx.stroke();

    // Interpolate dots for long segments to avoid gaps
    if (dist > 12) {
      const steps = Math.ceil(dist / 6);
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        dCtx.beginPath();
        dCtx.arc(state.prevX + dx * t, state.prevY + dy * t, state.brushSize / 2, 0, Math.PI * 2);
        dCtx.fill();
      }
    } else {
      dCtx.beginPath();
      dCtx.arc(vx, vy, state.brushSize / 2, 0, Math.PI * 2);
      dCtx.fill();
    }

    state.prevX = vx;
    state.prevY = vy;
  }

  state.lastDrawT = nowSec;

  // Draw cursor on overlay (screen space)
  oCtx.strokeStyle = "#000";
  oCtx.lineWidth = 2;
  oCtx.beginPath();
  oCtx.arc(cx, cy, state.brushSize / 2 + 2, 0, Math.PI * 2);
  oCtx.stroke();
  oCtx.fillStyle = `rgb(${col.join(",")})`;
  oCtx.beginPath();
  oCtx.arc(cx, cy, state.brushSize / 2, 0, Math.PI * 2);
  oCtx.fill();
}

/** Erase ink at the given screen position. */
function eraseAtPoint(cx, cy, nowSec) {
  beginCanvasAction("ERASE");
  setMode("ERASE");
  breakStrokePath();

  const vx = cx + state.panX;
  const vy = cy + state.panY;

  dCtx.globalCompositeOperation = "destination-out";
  dCtx.beginPath();
  dCtx.arc(vx, vy, ERASER_RADIUS, 0, Math.PI * 2);
  dCtx.fill();
  dCtx.globalCompositeOperation = "source-over";

  // Eraser cursor on overlay
  oCtx.strokeStyle = "#3355ff";
  oCtx.lineWidth = 2;
  oCtx.beginPath();
  oCtx.arc(cx, cy, ERASER_RADIUS, 0, Math.PI * 2);
  oCtx.stroke();

  state.lastDrawT = nowSec;
}


// ═══════════════════════════════════════════════════════════════════
// 5. PAN & RESIZE
// ═══════════════════════════════════════════════════════════════════

function applyPan() {
  drawCanvas.style.transform = `translate(${-state.panX}px, ${-state.panY}px)`;
  const vpW = overCanvas.width || canvasWrapper.clientWidth;
  const vpH = overCanvas.height || canvasWrapper.clientHeight;
  const pctX = Math.round((state.panX / (VIRTUAL_W - vpW)) * 100) || 0;
  const pctY = Math.round((state.panY / (VIRTUAL_H - vpH)) * 100) || 0;
  const el = document.getElementById("pan-indicator");
  if (el) el.textContent = `Canvas: ${pctX}% → ${pctY}% ↓`;
}

function resizeCanvases() {
  const W = canvasWrapper.clientWidth;
  const H = canvasWrapper.clientHeight;
  drawCanvas.width = VIRTUAL_W;
  drawCanvas.height = VIRTUAL_H;
  overCanvas.width = W;
  overCanvas.height = H;
  applyPan();
}
resizeCanvases();
window.addEventListener("resize", resizeCanvases);


// ═══════════════════════════════════════════════════════════════════
// 6. OCR — Build images and send to server
// ═══════════════════════════════════════════════════════════════════

/** Check if the visible viewport has any ink. */
function canvasHasInk() {
  const vpW = overCanvas.width;
  const vpH = overCanvas.height;
  const data = dCtx.getImageData(state.panX, state.panY, vpW, vpH).data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 20) return true;
  }
  return false;
}

/** Convert visible viewport ink to black-on-white image (base64 PNG). */
function buildOcrImage() {
  const vpW = overCanvas.width;
  const vpH = overCanvas.height;
  const src = dCtx.getImageData(state.panX, state.panY, vpW, vpH);
  const out = new ImageData(src.width, src.height);

  for (let i = 0; i < src.data.length; i += 4) {
    if (src.data[i + 3] > 20) {
      out.data[i] = 0;
      out.data[i + 1] = 0;
      out.data[i + 2] = 0;
      out.data[i + 3] = 255; // full opacity for clean black ink
    }
  }

  const off = document.createElement("canvas");
  off.width = src.width;
  off.height = src.height;
  const offCtx = off.getContext("2d");
  offCtx.fillStyle = "#ffffff";
  offCtx.fillRect(0, 0, off.width, off.height);
  offCtx.putImageData(out, 0, 0);
  return off.toDataURL("image/png");
}

/** Get raw canvas image (white background, visible viewport). */
function buildRawCanvasImage() {
  const vpW = overCanvas.width;
  const vpH = overCanvas.height;
  const off = document.createElement("canvas");
  off.width = vpW;
  off.height = vpH;
  const offCtx = off.getContext("2d");
  offCtx.fillStyle = "#ffffff";
  offCtx.fillRect(0, 0, vpW, vpH);
  offCtx.drawImage(drawCanvas, state.panX, state.panY, vpW, vpH, 0, 0, vpW, vpH);
  return off.toDataURL("image/png");
}

/** Build OCR image from the ENTIRE virtual canvas (not just viewport). */
function buildOcrImageAll() {
  const src = dCtx.getImageData(0, 0, VIRTUAL_W, VIRTUAL_H);
  const out = new ImageData(src.width, src.height);
  let hasInk = false;

  for (let i = 0; i < src.data.length; i += 4) {
    if (src.data[i + 3] > 20) {
      out.data[i] = 0;
      out.data[i + 1] = 0;
      out.data[i + 2] = 0;
      out.data[i + 3] = 255;
      hasInk = true;
    }
  }
  if (!hasInk) return null;

  const off = document.createElement("canvas");
  off.width = src.width;
  off.height = src.height;
  const offCtx = off.getContext("2d");
  offCtx.fillStyle = "#ffffff";
  offCtx.fillRect(0, 0, off.width, off.height);
  offCtx.putImageData(out, 0, 0);
  return off.toDataURL("image/png");
}

/** Crop a canvas to its ink bounding box with padding. */
function cropInkCanvas(canvas, padding = 20) {
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;

  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 20) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;

  minX = Math.max(0, minX - padding);
  minY = Math.max(0, minY - padding);
  maxX = Math.min(width - 1, maxX + padding);
  maxY = Math.min(height - 1, maxY + padding);

  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;
  const cropped = document.createElement("canvas");
  cropped.width = cropW;
  cropped.height = cropH;
  cropped.getContext("2d").putImageData(ctx.getImageData(minX, minY, cropW, cropH), 0, 0);
  return cropped;
}

function getOcrTargetSize(mode, cropped) {
  if (mode === "word") {
    return {
      width: Math.max(320, Math.round(cropped.width * 1.35)),
      height: Math.max(120, Math.round(cropped.height * 1.35)),
    };
  }
  if (mode === "line") {
    return {
      width: Math.max(640, Math.round(cropped.width * 1.4)),
      height: Math.max(180, Math.round(cropped.height * 1.45)),
    };
  }
  return {
    width: Math.max(960, Math.round(cropped.width * 1.5)),
    height: Math.max(240, Math.round(cropped.height * 1.6)),
  };
}

/** Build a training-quality image (cropped, scaled, centered on white). */
function buildTrainingImage(mode = "sentence") {
  const maskDataUrl = buildOcrImage();
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const temp = document.createElement("canvas");
      temp.width = img.width;
      temp.height = img.height;
      temp.getContext("2d").drawImage(img, 0, 0);

      const cropped = cropInkCanvas(temp, 24);
      if (!cropped) { reject(new Error("No handwriting found")); return; }

      const target = getOcrTargetSize(mode, cropped);
      const final = document.createElement("canvas");
      final.width = target.width;
      final.height = target.height;
      const fCtx = final.getContext("2d");
      fCtx.fillStyle = "#ffffff";
      fCtx.fillRect(0, 0, final.width, final.height);
      fCtx.imageSmoothingEnabled = true;

      const maxW = Math.round(final.width * 0.84);
      const maxH = Math.round(final.height * 0.72);
      const scale = Math.min(maxW / cropped.width, maxH / cropped.height);
      const dw = Math.max(1, Math.round(cropped.width * scale));
      const dh = Math.max(1, Math.round(cropped.height * scale));
      const dx = Math.round((final.width - dw) / 2);
      const dy = Math.round((final.height - dh) / 2);
      fCtx.drawImage(cropped, dx, dy, dw, dh);

      resolve(final.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error("Could not prepare training image"));
    img.src = maskDataUrl;
  });
}

/** Send the current drawing for OCR via WebSocket. */
async function triggerOCR() {
  if (state.ocrInFlight || !state.wsReady) {
    if (!state.wsReady) {
      ocrText.textContent = "Not connected to server";
      ocrBar.style.display = "flex";
    }
    return;
  }
  if (!canvasHasInk()) {
    ocrText.textContent = "Draw some text first";
    ocrBar.style.display = "flex";
    return;
  }

  try {
    state.ocrInFlight = true;
    const modeSelect = document.getElementById("ocr-mode").value;
    state.inFlightContinuous = (modeSelect === "continuous");
    const modeVal = state.inFlightContinuous ? "word" : modeSelect;

    const b64 = await buildTrainingImage(modeVal);
    const sourceImage = buildRawCanvasImage();
    state.lastOcrT = Date.now() / 1000;

    state.ws.send(JSON.stringify({
      type: "ocr",
      mode: modeVal,
      image: b64,
      source_image: sourceImage,
      preprocessed: true,
    }));

    ocrText.textContent = state.inFlightContinuous
      ? (state.continuousTextBuffer + " Recognizing...").trim()
      : "Recognizing...";
    ocrBar.style.display = "flex";
  } catch (e) {
    state.ocrInFlight = false;
    ocrText.textContent = `Could not prepare handwriting: ${e.message}`;
    ocrBar.style.display = "flex";
  }
}

/** Scan the full virtual canvas for OCR. */
async function triggerOCRAll() {
  if (state.ocrInFlight || !state.wsReady) return;

  const b64 = buildOcrImageAll();
  if (!b64) {
    ocrText.textContent = "Nothing written on canvas";
    ocrBar.style.display = "flex";
    return;
  }

  try {
    state.ocrInFlight = true;
    state.inFlightContinuous = false;
    const modeVal = document.getElementById("ocr-mode").value === "continuous"
      ? "sentence"
      : document.getElementById("ocr-mode").value;

    state.lastOcrT = Date.now() / 1000;
    state.ws.send(JSON.stringify({
      type: "ocr",
      mode: modeVal,
      image: b64,
      source_image: b64,
      preprocessed: true,
    }));
    ocrText.textContent = "Scanning full canvas...";
    ocrBar.style.display = "flex";
  } catch (e) {
    state.ocrInFlight = false;
    ocrText.textContent = `OCR All failed: ${e.message}`;
    ocrBar.style.display = "flex";
  }
}

/** Auto-OCR: fires after 3.5s of inactivity + 2s hand absent + 6s cooldown. */
function checkAutoOCR() {
  const now = Date.now() / 1000;
  const inactiveLong = state.lastDrawT > 0 && (now - state.lastDrawT) > 3.5;
  const handGone     = (now - state.lastHandActiveT) > 2.0;
  const cooldownOk   = (now - state.lastOcrT) > 6.0;

  if (!state.ocrInFlight && inactiveLong && handGone && cooldownOk && canvasHasInk()) {
    triggerOCR();
    state.lastDrawT = 0;
  }
}


// ═══════════════════════════════════════════════════════════════════
// 7. DOWNLOAD & SAVE SAMPLE
// ═══════════════════════════════════════════════════════════════════

function downloadCanvas() {
  const data = dCtx.getImageData(0, 0, VIRTUAL_W, VIRTUAL_H).data;
  let minX = VIRTUAL_W, minY = VIRTUAL_H, maxX = -1, maxY = -1;

  for (let y = 0; y < VIRTUAL_H; y++) {
    for (let x = 0; x < VIRTUAL_W; x++) {
      if (data[(y * VIRTUAL_W + x) * 4 + 3] > 20) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) { alert("Nothing to download — draw something first."); return; }

  const pad = 40;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(VIRTUAL_W - 1, maxX + pad);
  maxY = Math.min(VIRTUAL_H - 1, maxY + pad);

  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const off = document.createElement("canvas");
  off.width = w;
  off.height = h;
  const offCtx = off.getContext("2d");
  offCtx.fillStyle = "#ffffff";
  offCtx.fillRect(0, 0, w, h);
  offCtx.drawImage(drawCanvas, minX, minY, w, h, 0, 0, w, h);

  const link = document.createElement("a");
  link.download = `airdraw_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.png`;
  link.href = off.toDataURL("image/png");
  link.click();
}

async function saveCurrentSample() {
  const text = sampleInput.value.trim();
  if (!text) {
    sampleStatus.textContent = "Enter the correct text before saving";
    sampleStatus.style.color = "#ff8888";
    sampleInput.focus();
    return;
  }
  if (!canvasHasInk()) {
    sampleStatus.textContent = "Draw something first, then save the sample";
    sampleStatus.style.color = "#ff8888";
    return;
  }

  const rawMode = document.getElementById("ocr-mode").value;
  const saveMode = rawMode === "continuous" ? "word" : rawMode;
  sampleStatus.textContent = "Preparing sample...";
  sampleStatus.style.color = "#88aaff";

  try {
    const image = await buildTrainingImage(saveMode);
    const res = await fetch(`${BACKEND_URL}/api/samples`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image, text, source: "browser-ui", mode: saveMode }),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.detail || "Could not save");

    sampleStatus.textContent = `Saved sample: ${text}`;
    sampleStatus.style.color = "#00e896";
    sampleInput.value = "";
  } catch (e) {
    sampleStatus.textContent = e.message || "Could not save";
    sampleStatus.style.color = "#ff8888";
  }
}


// ═══════════════════════════════════════════════════════════════════
// 8. WEBSOCKET — Connection to the Python backend
// ═══════════════════════════════════════════════════════════════════

function connectWS() {
  if (state.wsReconnectTimer) {
    clearTimeout(state.wsReconnectTimer);
    state.wsReconnectTimer = null;
  }

  try {
    state.ws = new WebSocket(WS_URL);

    state.ws.onopen = () => {
      state.wsReady = true;
      state.wsReconnectAttempts = 0;
      connStatus.textContent = "● Connected";
      connStatus.className = "connected";
      console.log("WS connected to", WS_URL);
    };

    state.ws.onclose = () => {
      state.wsReady = false;
      state.ocrInFlight = false;
      connStatus.textContent = "● Offline";
      connStatus.className = "disconnected";
      state.wsReconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, state.wsReconnectAttempts - 1), 30000);
      state.wsReconnectTimer = setTimeout(connectWS, delay);
    };

    state.ws.onerror = () => {
      state.wsReady = false;
      state.ocrInFlight = false;
    };

    state.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      if (msg.type === "ocr_result") {
        state.ocrInFlight = false;
        if (msg.success && msg.text) {
          if (state.inFlightContinuous) {
            state.continuousTextBuffer = (state.continuousTextBuffer + " " + msg.text).trim();
            ocrText.textContent = state.continuousTextBuffer;
            dCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
            resetStrokeState();
          } else {
            ocrText.textContent = msg.text;
          }
        } else {
          ocrText.textContent = state.inFlightContinuous
            ? state.continuousTextBuffer + " [Could not recognize]"
            : "Could not recognize — try writing larger";
        }
        ocrBar.style.display = "flex";
      }

      if (msg.type === "error") {
        state.ocrInFlight = false;
        ocrText.textContent = msg.message || "OCR failed";
        ocrBar.style.display = "flex";
      }
    };
  } catch (e) {
    state.wsReady = false;
    state.wsReconnectAttempts++;
    const delay = Math.min(3000 * state.wsReconnectAttempts, 30000);
    state.wsReconnectTimer = setTimeout(connectWS, delay);
  }
}


// ═══════════════════════════════════════════════════════════════════
// 9. CAMERA & MEDIAPIPE SETUP
// ═══════════════════════════════════════════════════════════════════

async function ensureMediaPipeLoaded() {
  if (state.visionModule?.FilesetResolver && state.visionModule?.HandLandmarker) {
    return state.visionModule;
  }

  // Try CDN first
  try {
    document.querySelector("#loading h2").textContent = "Loading hand model (CDN)...";
    state.visionModule = await import(MEDIAPIPE_CDN_MODULE);
    if (state.visionModule?.FilesetResolver && state.visionModule?.HandLandmarker) {
      console.log("MediaPipe loaded from CDN");
      return state.visionModule;
    }
  } catch (e) {
    console.warn("CDN import failed:", e);
  }

  // Fallback to local
  try {
    document.querySelector("#loading h2").textContent = "Loading hand model (local)...";
    state.visionModule = await import(MEDIAPIPE_LOCAL_MODULE);
    if (state.visionModule?.FilesetResolver && state.visionModule?.HandLandmarker) {
      console.log("MediaPipe loaded from local vendor");
      state.visionModule.__useLocalWasm = true;
      return state.visionModule;
    }
  } catch (e) {
    console.warn("Local import failed:", e);
  }

  throw new Error("MediaPipe could not be loaded. Check your internet connection.");
}

async function setupMediaPipe() {
  const visionLib = await ensureMediaPipeLoaded();
  const { HandLandmarker, FilesetResolver } = visionLib;

  if (!HandLandmarker || !FilesetResolver) {
    throw new Error("MediaPipe loaded incorrectly.");
  }

  const wasmPath = visionLib.__useLocalWasm ? MEDIAPIPE_LOCAL_WASM : MEDIAPIPE_CDN_WASM;
  const vision = await FilesetResolver.forVisionTasks(wasmPath);

  state.landmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numHands: 1,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}

async function setupCamera() {
  const host = window.location.hostname;
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0";

  if (!window.isSecureContext && !isLocal) {
    throw new Error("Camera needs localhost or HTTPS.");
  }

  const constraints = { video: { width: 1280, height: 720, facingMode: "user" }, audio: false };
  const md = navigator.mediaDevices;

  let stream;
  if (md && typeof md.getUserMedia === "function") {
    stream = await md.getUserMedia(constraints);
  } else {
    const legacy = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
    if (!legacy) throw new Error("No camera API available.");
    stream = await new Promise((res, rej) => legacy.call(navigator, constraints, res, rej));
  }

  video.srcObject = stream;
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  await new Promise(resolve => video.onloadedmetadata = resolve);
  video.play();
}


// ═══════════════════════════════════════════════════════════════════
// 10. SKELETON DRAWING (hand wireframe on overlay)
// ═══════════════════════════════════════════════════════════════════

function drawSkeleton(lm, W, H) {
  const connections = [
    [0,1],[1,2],[2,3],[3,4],
    [0,5],[5,6],[6,7],[7,8],
    [0,9],[9,10],[10,11],[11,12],
    [0,13],[13,14],[14,15],[15,16],
    [0,17],[17,18],[18,19],[19,20],
    [5,9],[9,13],[13,17],
  ];

  oCtx.strokeStyle = "rgba(0,200,0,0.6)";
  oCtx.lineWidth = 1.5;
  for (const [a, b] of connections) {
    oCtx.beginPath();
    oCtx.moveTo((1 - lm[a].x) * W, lm[a].y * H);
    oCtx.lineTo((1 - lm[b].x) * W, lm[b].y * H);
    oCtx.stroke();
  }

  for (let i = 0; i < 21; i++) {
    oCtx.beginPath();
    oCtx.arc((1 - lm[i].x) * W, lm[i].y * H, i === 8 ? 7 : 3, 0, Math.PI * 2);
    oCtx.fillStyle = i === 8 ? "#00ff66" : "#008800";
    oCtx.fill();
  }
}


// ═══════════════════════════════════════════════════════════════════
// 11. VIRTUAL BUTTON CALLBACKS
// ═══════════════════════════════════════════════════════════════════

// These callbacks are passed to checkVirtualButtonDwell()
// so it can trigger actions without importing drawing functions.
const vbtnCallbacks = {
  selectColor(idx) {
    state.colorIdx = idx;
    setEraserMode(false);
    syncColorButtons();
  },
  toggleEraser() {
    setEraserMode(!state.eraserMode);
  },
  undo() {
    undoLastAction();
  },
  clear() {
    pushUndoSnapshot();
    dCtx.clearRect(0, 0, VIRTUAL_W, VIRTUAL_H);
    ocrBar.style.display = "none";
    ocrText.textContent = "";
    state.continuousTextBuffer = "";
    state.lastDrawT = 0;
    resetStrokeState();
  },
};


// ═══════════════════════════════════════════════════════════════════
// 12. MAIN RENDER LOOP — Runs every frame via requestAnimationFrame
// ═══════════════════════════════════════════════════════════════════

let lastVideoTime = -1;

function renderLoop() {
  requestAnimationFrame(renderLoop);

  if (!state.landmarker || video.readyState < 2) return;

  const W = overCanvas.width;
  const H = overCanvas.height;
  const now = performance.now();

  if (video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;

  // Run hand detection
  const result = state.landmarker.detectForVideo(video, now);

  // Clear overlay and draw virtual buttons
  oCtx.clearRect(0, 0, W, H);
  drawVirtualButtons(oCtx);

  const nowSec = Date.now() / 1000;

  // ── HAND DETECTED ──────────────────────────────────────────────
  if (result.landmarks && result.landmarks.length > 0) {
    const lm = result.landmarks[0];

    // Check for jitter outliers (skip actions but still track hand)
    const outlier = isLandmarkOutlier(lm);

    addToLandmarkHistory(lm);
    drawSkeleton(lm, W, H);
    state.handPresent = true;
    state.handLossCounter = 0;
    state.lastHandActiveT = nowSec;
    handLossEl.style.display = "none";

    // Get smoothed pointer position
    const rawX = clamp(Math.round((1 - lm[8].x) * W), 0, W - 1);
    const rawY = clamp(Math.round(lm[8].y * H), 0, H - 1);
    const [cx, cy] = pointerFilter.filter(rawX, rawY, now);

    // Classify gesture and resolve action
    const gesture = updateStableGesture(classifyGesture(lm));
    const action = resolvePointerAction(gesture);

    // Check if finger is hovering over a virtual button
    const buttonConsumed = !outlier && checkVirtualButtonDwell(cx, cy, vbtnCallbacks);

    // ── Process action ─────────────────────────────────────────
    if (outlier || buttonConsumed) {
      // Skip drawing — show hover cursor instead
      breakStrokePath();
      state.panStartX = null;
      state.panStartY = null;
      oCtx.strokeStyle = buttonConsumed ? "#00ff88" : "#ffaa00";
      oCtx.lineWidth = 2;
      oCtx.beginPath();
      oCtx.arc(cx, cy, 8, 0, Math.PI * 2);
      oCtx.stroke();

    } else if (action === "ERASE") {
      state.panStartX = null;
      state.panStartY = null;
      eraseAtPoint(cx, cy, nowSec);

    } else if (action === "DRAW") {
      state.panStartX = null;
      state.panStartY = null;
      drawAtPoint(cx, cy, nowSec);

    } else if (action === "PAN") {
      breakStrokePath();
      state.activeCanvasAction = "PAN";
      setMode("PAN");

      // Use palm center (landmark 9) for pan — more stable
      const palmX = clamp(Math.round((1 - lm[9].x) * W), 0, W - 1);
      const palmY = clamp(Math.round(lm[9].y * H), 0, H - 1);

      if (state.panStartX !== null) {
        const dx = palmX - state.panStartX;
        const dy = palmY - state.panStartY;
        state.panX = Math.max(0, Math.min(VIRTUAL_W - W, state.panX - dx));
        state.panY = Math.max(0, Math.min(VIRTUAL_H - H, state.panY - dy));
        applyPan();
      }
      state.panStartX = palmX;
      state.panStartY = palmY;

      // Open palm indicator
      oCtx.strokeStyle = "#ffaa00";
      oCtx.lineWidth = 2;
      oCtx.beginPath();
      oCtx.arc(cx, cy, 18, 0, Math.PI * 2);
      oCtx.stroke();

    } else if (action === "LIFT") {
      state.panStartX = null;
      state.panStartY = null;
      state.activeCanvasAction = "LIFT";
      setMode("LIFT");
      breakStrokePath();

      // Crosshair cursor
      oCtx.strokeStyle = "#00cccc";
      oCtx.lineWidth = 2;
      oCtx.beginPath();
      oCtx.moveTo(cx - 10, cy); oCtx.lineTo(cx + 10, cy);
      oCtx.moveTo(cx, cy - 10); oCtx.lineTo(cx, cy + 10);
      oCtx.stroke();

    } else {
      // IDLE
      state.panStartX = null;
      state.panStartY = null;
      state.activeCanvasAction = "IDLE";
      setMode("IDLE");
      breakStrokePath();
    }

  // ── NO HAND DETECTED ───────────────────────────────────────────
  } else {
    state.handPresent = false;
    state.handLossCounter++;
    state.panStartX = null;
    state.panStartY = null;

    if (state.handLossCounter >= 6 && state.handLossCounter < LOST_HAND_RESET_FRAMES) {
      handLossEl.style.display = "block";
    }
    if (state.handLossCounter >= LOST_HAND_RESET_FRAMES) {
      setMode("IDLE");
      resetStrokeState();
      handLossEl.style.display = "none";
    }
  }

  checkAutoOCR();
}


// ═══════════════════════════════════════════════════════════════════
// 13. EVENT LISTENERS — Toolbar button clicks
// ═══════════════════════════════════════════════════════════════════

eraseBtn.onclick = () => setEraserMode(!state.eraserMode);
undoBtn.onclick  = () => undoLastAction();
redoBtn.onclick  = () => redoLastAction();
focusBtn.onclick = () => setFocusMode(!state.focusMode);
if (pdfViewerBtn) {
  pdfViewerBtn.onclick = () => { window.location.href = "/pdfviewer"; };
}

document.getElementById("btn-clear").onclick = () => {
  pushUndoSnapshot();
  dCtx.clearRect(0, 0, VIRTUAL_W, VIRTUAL_H);
  ocrBar.style.display = "none";
  ocrText.textContent = "";
  state.continuousTextBuffer = "";
  state.lastDrawT = 0;
  resetStrokeState();
};

document.getElementById("brush-range").oninput = function () {
  state.brushSize = parseInt(this.value);
  document.getElementById("brush-val").textContent = state.brushSize + "px";
};

document.getElementById("btn-ocr").onclick      = () => triggerOCR();
document.getElementById("btn-ocr-all").onclick   = () => triggerOCRAll();
document.getElementById("btn-save-sample").onclick = () => saveCurrentSample();
document.getElementById("btn-reset-view").onclick = () => { state.panX = 0; state.panY = 0; applyPan(); };
document.getElementById("btn-download").onclick   = () => downloadCanvas();

sampleInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); saveCurrentSample(); }
});


// ═══════════════════════════════════════════════════════════════════
// 14. INIT — Start everything
// ═══════════════════════════════════════════════════════════════════

// Build virtual buttons on the overlay canvas
initVirtualButtons();

async function init() {
  try {
    await setupCamera();
    await setupMediaPipe();
    document.getElementById("loading").style.display = "none";
    connectWS();
    renderLoop();
  } catch (err) {
    document.querySelector("#loading h2").textContent = "Error: " + err.message;
    console.error(err);
  }
}

init();
