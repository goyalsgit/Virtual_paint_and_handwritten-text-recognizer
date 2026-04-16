import { HandLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";
import {
  MIN_SCALE,
  MAX_SCALE,
  SEARCH_OVERLAY_MIN_STEP_PX,
  SEARCH_OVERLAY_MAX_SEGMENT_PX,
  SEARCH_OVERLAY_IDLE_SEC,
  OCR_WS_URL,
  HOVER_DURATION,
  HOVER_SWITCH_DELAY,
  HOVER_LEAVE_GRACE,
  TOOLBAR_HIT_PADDING,
  TOOLBAR_STICKY_PADDING,
  TOOLBAR_SNAP_RADIUS,
  DEFAULT_CONFIRM_FRAMES,
  CONFIRM_FRAMES_BY_GESTURE,
  SEARCH_OVERLAY_CONFIRM_FRAMES,
  RELEASE_FRAMES,
  GUARD_PAIRS,
} from "./constants.js";
import { createViewerFilters } from "./filters.js";

// ─── PDF.js Setup ──────────────────────────────────────────────
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

// ─── DOM References ────────────────────────────────────────────
const cursorCanvas = document.getElementById("cursor-canvas");
const cursorCtx = cursorCanvas.getContext("2d");
const webcamVideo = document.getElementById("webcam");
const handCanvasEl = document.getElementById("hand-canvas");
const handCtx = handCanvasEl.getContext("2d");
const dropZone = document.getElementById("drop-zone");
const pdfContainer = document.getElementById("pdf-container");
const pdfArea = document.getElementById("pdf-area");
const pageInfo = document.getElementById("page-info");
const zoomInfo = document.getElementById("zoom-info");
const startBtn = document.getElementById("start-btn");
const statusDot = document.getElementById("status-dot");
const camLabel = document.getElementById("cam-label");
const gestureBadge = document.getElementById("gesture-badge");
const toolbar = document.getElementById("toolbar");
const gesturePill = document.getElementById("gesture-pill");
const pillText = document.getElementById("pill-text");
const pillDot = gesturePill.querySelector(".dot");
const notesList = document.getElementById("notes-list");
const virtualBtns = document.querySelectorAll(".v-btn");
const searchPreview = document.getElementById("search-preview");
const searchStatus = document.getElementById("search-status");
const searchResults = document.getElementById("search-results");
const searchToolbarBtn = document.getElementById("btn-search");
const searchRunBtn = document.getElementById("btn-run-search");
const searchClearBtn = document.getElementById("btn-clear-search");
const searchOverlayLayer = document.getElementById("search-overlay-layer");
const searchOverlayCanvas = document.getElementById("search-overlay-canvas");
const searchOverlayCtx = searchOverlayCanvas.getContext("2d");
const searchOverlayHint = document.getElementById("search-overlay-hint");
const virtualToolbar = document.getElementById("virtual-toolbar");
const clickControlsToggleBtn = document.getElementById("btn-toggle-click-controls");

// ─── App State ─────────────────────────────────────────────────
let pdfDoc = null;
let totalPages = 0;
let scale = 1.5;

// Current visible page (for display; tracked via intersection observer)
let currentPage = 1;

// Page wrappers array: [{ wrapper, pdfCanvas, hlCanvas, inkCanvas, pageNum }]
let pageElements = [];

// Search and OCR state
let searchQuery = "";
let searchResultsCache = [];
let pageTextCache = new Map();
let searchInFlight = false;
let searchOverlayActive = false;
let searchOverlayDirty = false;
let searchOverlaySubmitting = false;
let searchOverlayLastDrawAt = 0;
let searchOverlayPrevX = null;
let searchOverlayPrevY = null;
let ocrSocket = null;
let ocrSocketReady = false;
let ocrRequestPending = null;

// Tool state
let activeTool = "cursor"; // cursor | pen | highlighter | search
let activeColor = "#FFD700";

// Annotations storage
// highlights: { pageNum: [{ x, y, w, h, color, id, timestamp }] }
// penStrokes: { pageNum: [{ points: [{x,y}], color, id, timestamp }] }
let highlights = {};
let penStrokes = {};
let annotationIdCounter = 0;

// Drawing state
let currentStroke = null;

// Virtual button hover detection
let hoverTimer = null;
// Legacy dwell timestamp retained for optional debug instrumentation.
let hoverStartTime = 0;
let currentHoveredBtn = null;
let hoverSwitchCandidate = null;
let hoverSwitchSince = 0;
let hoverLeaveSince = 0;
let clickControlsEnabled = false;

// ─── MediaPipe State ───────────────────────────────────────────
let handLandmarker = null;
let webcamRunning = false;
let lastVideoTime = -1;

// ─── Gesture State Machine ─────────────────────────────────────
let rawGesture = "none";
let rawCount = 0;
let activeGesture = "none";
let releaseCount = 0;

// Transition guards: prevent direct fist->point transitions
let lastActiveGesture = "none";
let guardCooldown = 0;

// ─── Gesture Data ──────────────────────────────────────────────
let prevWristY = null;
let prevWristX = null;
let openStableFrames = 0;
// Legacy pagination cooldown placeholder (currently inactive in open-hand mode).
let pageCooldown = 0;
let lastLandmarks = null;

// ─── Scroll Inertia ────────────────────────────────────────────
let scrollVelocity = 0;
let scrollInertiaActive = false;
let scrollInertiaRAF = null;

// ═══════════════════════════════════════════════════════════════
// ONE EURO FILTER — Adaptive low-pass filter for anti-jitter
// ═══════════════════════════════════════════════════════════════
const {
  ptrFilterX,
  ptrFilterY,
  drawFilterX,
  drawFilterY,
  overlayFilterX,
  overlayFilterY,
  scrollFilter,
} = createViewerFilters();

// ═══════════════════════════════════════════════════════════════
// GESTURE CLASSIFICATION (angle-invariant)
// ═══════════════════════════════════════════════════════════════
function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
}

function isFingerExtended(tip, pip, mcp, wrist) {
  // Use distance ratio: if tip is further from wrist than MCP, finger is extended
  const tipDist = dist(tip, wrist);
  const mcpDist = dist(mcp, wrist);
  return tipDist > mcpDist * 1.05;
}

function classifyGesture(lm) {
  const wrist = lm[0];
  const thumbTip = lm[4], thumbIP = lm[3], thumbMCP = lm[2];
  const idxTip = lm[8], idxPIP = lm[6], idxMCP = lm[5];
  const midTip = lm[12], midPIP = lm[10], midMCP = lm[9];
  const ringTip = lm[16], ringPIP = lm[14], ringMCP = lm[13];
  const pinkTip = lm[20], pinkPIP = lm[18], pinkMCP = lm[17];

  const idxUp = isFingerExtended(idxTip, idxPIP, idxMCP, wrist);
  const midUp = isFingerExtended(midTip, midPIP, midMCP, wrist);
  const ringUp = isFingerExtended(ringTip, ringPIP, ringMCP, wrist);
  const pinkUp = isFingerExtended(pinkTip, pinkPIP, pinkMCP, wrist);

  // Gesture set: open > fist > point > none
  // "point" = index-finger pointer + writing/drawing.

  // Open hand: all 4 fingers up
  if (idxUp && midUp && ringUp && pinkUp) {
    return "open";
  }

  // Fist: all 4 fingers down
  if (!idxUp && !midUp && !ringUp && !pinkUp) {
    return "fist";
  }

  // Two-finger gesture is intentionally ignored to avoid accidental drawing.
  if (idxUp && midUp && !ringUp && !pinkUp) {
    return "none";
  }

  // Three-finger gesture is also ignored.
  if (idxUp && midUp && ringUp && !pinkUp) {
    return "none";
  }

  // Point: index up with other fingers folded.
  if (idxUp && !midUp && !ringUp && !pinkUp) {
    return "point";
  }

  return "none";
}

// ═══════════════════════════════════════════════════════════════
// GESTURE STATE MACHINE WITH HYSTERESIS
// ═══════════════════════════════════════════════════════════════
function updateGestureState(raw) {
  if (guardCooldown > 0) guardCooldown--;

  if (raw === rawGesture) {
    rawCount++;
  } else {
    rawGesture = raw;
    rawCount = 1;
  }

  // Check if raw differs from active
  if (raw !== activeGesture) {
    releaseCount++;
  } else {
    releaseCount = 0;
  }

  // Release current gesture if held different for RELEASE_FRAMES
  if (releaseCount >= RELEASE_FRAMES && activeGesture !== "none") {
    onGestureExit(activeGesture);
    lastActiveGesture = activeGesture;
    guardCooldown = 3; // guard frames after exit
    activeGesture = "none";
    releaseCount = 0;
  }

  // Activate new gesture if confirmed for CONFIRM_FRAMES
  const confirmFrames = (searchOverlayActive && raw === "point")
    ? SEARCH_OVERLAY_CONFIRM_FRAMES
    : (CONFIRM_FRAMES_BY_GESTURE[raw] || DEFAULT_CONFIRM_FRAMES);

  if (rawCount >= confirmFrames && raw !== activeGesture && raw !== "none") {
    // Check transition guard
    const transition = `${lastActiveGesture}->${raw}`;
    if (GUARD_PAIRS.has(transition) && guardCooldown > 0) {
      // Block this transition during guard period
      return activeGesture;
    }

    if (activeGesture !== "none") {
      onGestureExit(activeGesture);
    }
    activeGesture = raw;
    onGestureEnter(activeGesture);
    releaseCount = 0;
  }

  return activeGesture;
}

function onGestureEnter(g) {
  if (g === "open") {
    prevWristX = null;
    openStableFrames = 0;
  }
  if (g === "fist") {
    prevWristY = null;
    scrollVelocity = 0;
    scrollFilter.reset();
    stopInertia();
  }
  if (g === "point") {
    // Index mode supports pointer + drawing, reset filters on re-entry.
    clearVirtualHover();
    ptrFilterX.reset();
    ptrFilterY.reset();
    drawFilterX.reset();
    drawFilterY.reset();
    if (searchOverlayActive) {
      searchOverlayPrevX = null;
      searchOverlayPrevY = null;
      overlayFilterX.reset();
      overlayFilterY.reset();
    }
  }
}

function onGestureExit(g) {
  if (g === "point" || g === "peace") {
    if (searchOverlayActive) {
      searchOverlayPrevX = null;
      searchOverlayPrevY = null;
      overlayFilterX.reset();
      overlayFilterY.reset();
    } else if (currentStroke) {
      finishPenStroke();
    }
  }
  if (g === "open") {
    prevWristX = null;
    openStableFrames = 0;
  }
  if (g === "fist") {
    startInertia();
    prevWristY = null;
  }
  // Clear virtual hover
  clearVirtualHover();
  cursorCtx.clearRect(0, 0, cursorCanvas.width, cursorCanvas.height);
}

// ═══════════════════════════════════════════════════════════════
// PDF RENDERING (Multi-page continuous)
// ═══════════════════════════════════════════════════════════════
async function renderAllPages() {
  if (!pdfDoc) return;

  pdfContainer.innerHTML = "";
  pageElements = [];

  for (let i = 1; i <= totalPages; i++) {
    const page = await pdfDoc.getPage(i);
    const viewport = page.getViewport({ scale });

    // Create wrapper
    const wrapper = document.createElement("div");
    wrapper.className = "page-wrapper";
    wrapper.style.width = viewport.width + "px";
    wrapper.style.height = viewport.height + "px";
    wrapper.dataset.page = i;

    // PDF canvas
    const pdfCanvas = document.createElement("canvas");
    pdfCanvas.className = "pdf-canvas";
    pdfCanvas.width = viewport.width;
    pdfCanvas.height = viewport.height;
    wrapper.appendChild(pdfCanvas);

    // Highlight canvas
    const hlCanvas = document.createElement("canvas");
    hlCanvas.className = "hl-canvas";
    hlCanvas.width = viewport.width;
    hlCanvas.height = viewport.height;
    wrapper.appendChild(hlCanvas);

    // Ink canvas
    const inkCanvas = document.createElement("canvas");
    inkCanvas.className = "ink-canvas";
    inkCanvas.width = viewport.width;
    inkCanvas.height = viewport.height;
    wrapper.appendChild(inkCanvas);

    // Search canvas
    const searchCanvas = document.createElement("canvas");
    searchCanvas.className = "search-canvas";
    searchCanvas.width = viewport.width;
    searchCanvas.height = viewport.height;
    wrapper.appendChild(searchCanvas);

    // Page number badge
    const badge = document.createElement("div");
    badge.className = "page-num-badge";
    badge.textContent = `Page ${i}`;
    wrapper.appendChild(badge);

    pdfContainer.appendChild(wrapper);

    const entry = { wrapper, pdfCanvas, hlCanvas, inkCanvas, searchCanvas, pageNum: i };
    pageElements.push(entry);

    // Render PDF page
    const ctx = pdfCanvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport }).promise;

    // Redraw annotations
    redrawHighlights(i);
    redrawPenStrokes(i);
    redrawSearchHighlights(i);
  }

  updatePageInfo();
  setupIntersectionObserver();
}

async function rerenderAtScale() {
  if (!pdfDoc) return;

  for (let i = 0; i < pageElements.length; i++) {
    const el = pageElements[i];
    const page = await pdfDoc.getPage(el.pageNum);
    const viewport = page.getViewport({ scale });

    el.wrapper.style.width = viewport.width + "px";
    el.wrapper.style.height = viewport.height + "px";

    [el.pdfCanvas, el.hlCanvas, el.inkCanvas, el.searchCanvas].forEach(c => {
      c.width = viewport.width;
      c.height = viewport.height;
    });

    const ctx = el.pdfCanvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport }).promise;

    redrawHighlights(el.pageNum);
    redrawPenStrokes(el.pageNum);
    redrawSearchHighlights(el.pageNum);
  }

  zoomInfo.textContent = `${Math.round(scale * 100)}%`;
}

function setupIntersectionObserver() {
  const observer = new IntersectionObserver(
    (entries) => {
      let maxRatio = 0;
      let maxPage = currentPage;
      entries.forEach(entry => {
        if (entry.intersectionRatio > maxRatio) {
          maxRatio = entry.intersectionRatio;
          maxPage = parseInt(entry.target.dataset.page);
        }
      });
      if (maxRatio > 0.1) {
        currentPage = maxPage;
        updatePageInfo();
      }
    },
    { root: pdfArea, threshold: [0, 0.1, 0.25, 0.5, 0.75, 1.0] }
  );

  pageElements.forEach(el => observer.observe(el.wrapper));
}

function updatePageInfo() {
  pageInfo.textContent = `${currentPage} / ${totalPages}`;
  zoomInfo.textContent = `${Math.round(scale * 100)}%`;
}

function scrollToPage(pageNum) {
  const el = pageElements[pageNum - 1];
  if (!el) return;
  el.wrapper.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ═══════════════════════════════════════════════════════════════
// OCR + SEARCH
// ═══════════════════════════════════════════════════════════════
function normalizeSearchText(text) {
  return (text || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function setSearchStatus(message, color) {
  searchStatus.textContent = message;
  if (color) {
    searchStatus.style.color = color;
  } else {
    searchStatus.style.color = "var(--muted)";
  }
}

function updateSearchPreview(text) {
  const value = (text || "").trim();
  searchPreview.textContent = value || "Click search to open a transparent writing pad, write the query in air, then pause.";
  searchPreview.classList.toggle("empty", !value);
}

function resizeSearchOverlayCanvas() {
  searchOverlayCanvas.width = window.innerWidth;
  searchOverlayCanvas.height = window.innerHeight;
}

function clearSearchOverlayDrawing() {
  searchOverlayCtx.clearRect(0, 0, searchOverlayCanvas.width, searchOverlayCanvas.height);
  searchOverlayDirty = false;
  searchOverlayLastDrawAt = 0;
  searchOverlayPrevX = null;
  searchOverlayPrevY = null;
  searchOverlayHint.style.opacity = "1";
  overlayFilterX.reset();
  overlayFilterY.reset();
}

function closeSearchOverlay() {
  searchOverlayActive = false;
  searchOverlayLayer.classList.remove("active");
  clearSearchOverlayDrawing();
}

function openSearchOverlay() {
  if (!pdfDoc) {
    setSearchStatus("Load a PDF before running OCR search.");
    return false;
  }

  resizeSearchOverlayCanvas();
  clearSearchOverlayDrawing();
  searchOverlayActive = true;
  searchOverlaySubmitting = false;
  searchOverlayLayer.classList.add("active");
  updateSearchPreview("Waiting for handwritten query...");
  setSearchStatus(`Write query in the transparent layer, then pause ${SEARCH_OVERLAY_IDLE_SEC.toFixed(1)}s.`, "var(--accent2)");
  showPill("🔎 Search Pad Open", "#22d3ee");
  return true;
}

function drawSearchOverlayDot(x, y) {
  searchOverlayCtx.save();
  searchOverlayCtx.beginPath();
  searchOverlayCtx.fillStyle = "rgba(255, 255, 255, 0.98)";
  searchOverlayCtx.shadowColor = "rgba(8, 9, 13, 0.78)";
  searchOverlayCtx.shadowBlur = 4;
  searchOverlayCtx.arc(x, y, 3.2, 0, Math.PI * 2);
  searchOverlayCtx.fill();
  searchOverlayCtx.restore();
}

function drawSearchOverlaySegment(fromX, fromY, toX, toY) {
  searchOverlayCtx.save();
  searchOverlayCtx.lineWidth = 5.2;
  searchOverlayCtx.strokeStyle = "rgba(255, 255, 255, 0.98)";
  searchOverlayCtx.shadowColor = "rgba(8, 9, 13, 0.8)";
  searchOverlayCtx.shadowBlur = 3;
  searchOverlayCtx.beginPath();
  searchOverlayCtx.moveTo(fromX, fromY);
  searchOverlayCtx.lineTo(toX, toY);
  searchOverlayCtx.stroke();
  searchOverlayCtx.restore();
}

function addSearchOverlayPoint(sx, sy) {
  const x = Math.max(0, Math.min(searchOverlayCanvas.width, sx));
  const y = Math.max(0, Math.min(searchOverlayCanvas.height, sy));

  searchOverlayCtx.globalCompositeOperation = "source-over";
  searchOverlayCtx.lineCap = "round";
  searchOverlayCtx.lineJoin = "round";

  if (searchOverlayPrevX === null || searchOverlayPrevY === null) {
    drawSearchOverlayDot(x, y);
    searchOverlayHint.style.opacity = "0.35";
  } else {
    const dx = x - searchOverlayPrevX;
    const dy = y - searchOverlayPrevY;
    const distance = Math.hypot(dx, dy);

    if (distance < SEARCH_OVERLAY_MIN_STEP_PX) {
      return;
    }

    const steps = Math.max(1, Math.ceil(distance / SEARCH_OVERLAY_MAX_SEGMENT_PX));
    let fromX = searchOverlayPrevX;
    let fromY = searchOverlayPrevY;

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const targetX = searchOverlayPrevX + dx * t;
      const targetY = searchOverlayPrevY + dy * t;
      const toX = fromX + (targetX - fromX) * 0.52;
      const toY = fromY + (targetY - fromY) * 0.52;
      drawSearchOverlaySegment(fromX, fromY, toX, toY);
      fromX = toX;
      fromY = toY;
    }
  }

  searchOverlayPrevX = x;
  searchOverlayPrevY = y;
  searchOverlayDirty = true;
  searchOverlayLastDrawAt = now();
}

async function submitSearchOverlay() {
  if (!searchOverlayActive || searchOverlaySubmitting || searchInFlight) {
    return;
  }

  if (!searchOverlayDirty || !canvasHasInk(searchOverlayCanvas)) {
    closeSearchOverlay();
    updateSearchPreview("");
    setSearchStatus("No search text captured.", "var(--warn)");
    return;
  }

  searchOverlaySubmitting = true;

  const ocrCanvas = document.createElement("canvas");
  ocrCanvas.width = searchOverlayCanvas.width;
  ocrCanvas.height = searchOverlayCanvas.height;
  const ocrCtx = ocrCanvas.getContext("2d");

  // Build a high-contrast binary image for OCR quality.
  const src = searchOverlayCtx.getImageData(0, 0, searchOverlayCanvas.width, searchOverlayCanvas.height);
  const out = ocrCtx.createImageData(ocrCanvas.width, ocrCanvas.height);
  for (let i = 0; i < src.data.length; i += 4) {
    const alpha = src.data[i + 3];
    const ink = alpha > 20;
    const value = ink ? 0 : 255;
    out.data[i] = value;
    out.data[i + 1] = value;
    out.data[i + 2] = value;
    out.data[i + 3] = 255;
  }
  ocrCtx.putImageData(out, 0, 0);

  closeSearchOverlay();
  updateSearchPreview("Recognizing handwritten query...");
  setSearchStatus("Recognizing query...", "var(--accent2)");

  try {
    searchInFlight = true;
    const recognized = await requestOcrFromCanvas(ocrCanvas, "sentence");
    const trimmed = recognized.trim();

    if (!trimmed) {
      updateSearchPreview("");
      setSearchStatus("OCR could not recognize a query.", "var(--warn)");
      return;
    }

    updateSearchPreview(trimmed);
    setSearchStatus(`Recognized: "${trimmed}"`, "var(--accent2)");
    await searchPdfByText(trimmed);
  } catch (err) {
    updateSearchPreview("");
    setSearchStatus(err.message || "OCR search failed.", "var(--danger)");
  } finally {
    searchInFlight = false;
    searchOverlaySubmitting = false;
    setActiveTool("cursor");
  }
}

function maybeAutoSubmitSearchOverlay() {
  if (!searchOverlayActive || searchOverlaySubmitting || searchInFlight || !searchOverlayDirty) {
    return;
  }
  if (now() - searchOverlayLastDrawAt >= SEARCH_OVERLAY_IDLE_SEC) {
    submitSearchOverlay();
  }
}

function canvasHasInk(canvas) {
  if (!canvas) return false;
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  if (!width || !height) return false;
  const data = ctx.getImageData(0, 0, width, height).data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 20) return true;
  }
  return false;
}

function redrawSearchHighlights(pageNum) {
  const el = pageElements[pageNum - 1];
  if (!el || !el.searchCanvas) return;
  if (!searchQuery) return;

  const ctx = el.searchCanvas.getContext("2d");
  const W = el.searchCanvas.width;
  const H = el.searchCanvas.height;
  ctx.clearRect(0, 0, W, H);

  const cached = pageTextCache.get(pageNum);
  if (!cached) return;

  const normalizedQuery = normalizeSearchText(searchQuery);
  const rects = buildSearchRects(cached.page, cached.page.getViewport({ scale }), cached.textContent, normalizedQuery);
  if (!rects.length) return;

  ctx.save();
  ctx.fillStyle = "rgba(251, 191, 36, 0.22)";
  ctx.strokeStyle = "rgba(251, 191, 36, 0.95)";
  ctx.lineWidth = 2;

  rects.forEach(rect => {
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  });

  ctx.restore();
}

function clearSearchResults() {
  if (searchOverlayActive) {
    closeSearchOverlay();
  }
  searchQuery = "";
  searchResultsCache = [];
  pageTextCache.clear();
  updateSearchPreview("");
  setSearchStatus("No search run yet.");
  searchResults.innerHTML = "";
  pageElements.forEach(el => {
    if (!el.searchCanvas) return;
    el.searchCanvas.getContext("2d").clearRect(0, 0, el.searchCanvas.width, el.searchCanvas.height);
  });
}

async function performOcrSearch() {
  if (searchOverlayActive) {
    await submitSearchOverlay();
    return;
  }
  setActiveTool("search");
}

function renderSearchResultsList() {
  if (!searchResultsCache.length) {
    searchResults.innerHTML = "";
    return;
  }

  searchResults.innerHTML = "";
  searchResultsCache.forEach(result => {
    const item = document.createElement("div");
    item.className = "search-hit";
    item.innerHTML = `
      <div>
        <strong>Page ${result.pageNum}</strong>
        <span>${result.snippet || "Matched text"}</span>
      </div>
      <div style="color: var(--accent2); font-size: 0.66rem; font-weight: 700; white-space: nowrap;">${result.hitCount} hit${result.hitCount === 1 ? "" : "s"}</div>
    `;
    item.addEventListener("click", () => scrollToPage(result.pageNum));
    searchResults.appendChild(item);
  });
}

function handleOcrSocketMessage(event) {
  let msg = null;
  try {
    msg = JSON.parse(event.data);
  } catch (err) {
    return;
  }

  if (!ocrRequestPending) {
    return;
  }

  if (msg.type === "ocr_result") {
    const pending = ocrRequestPending;
    ocrRequestPending = null;
    pending.resolve((msg.text || "").trim());
    return;
  }

  if (msg.type === "error") {
    const pending = ocrRequestPending;
    ocrRequestPending = null;
    pending.reject(new Error(msg.message || "OCR failed"));
  }
}

function ensureOcrSocket() {
  if (ocrSocket && ocrSocket.readyState === WebSocket.OPEN) {
    ocrSocketReady = true;
    return Promise.resolve(ocrSocket);
  }

  if (ocrSocket && ocrSocket.readyState === WebSocket.CONNECTING) {
    return new Promise((resolve, reject) => {
      ocrSocket.addEventListener("open", () => resolve(ocrSocket), { once: true });
      ocrSocket.addEventListener("error", () => reject(new Error("Could not connect to OCR backend")), { once: true });
    });
  }

  return new Promise((resolve, reject) => {
    try {
      ocrSocket = new WebSocket(OCR_WS_URL);
      ocrSocketReady = false;

      ocrSocket.addEventListener("open", () => {
        ocrSocketReady = true;
        resolve(ocrSocket);
      }, { once: true });

      ocrSocket.addEventListener("message", handleOcrSocketMessage);

      ocrSocket.addEventListener("close", () => {
        ocrSocketReady = false;
        ocrSocket = null;
        if (ocrRequestPending) {
          ocrRequestPending.reject(new Error("OCR backend disconnected"));
          ocrRequestPending = null;
        }
      });

      ocrSocket.addEventListener("error", () => {
        ocrSocketReady = false;
        reject(new Error("Could not connect to OCR backend"));
      }, { once: true });
    } catch (err) {
      reject(err);
    }
  });
}

async function requestOcrFromCanvas(canvas, mode = "sentence") {
  const socket = await ensureOcrSocket();
  const image = canvas.toDataURL("image/png");

  return new Promise((resolve, reject) => {
    if (ocrRequestPending) {
      reject(new Error("OCR is already running"));
      return;
    }

    ocrRequestPending = { resolve, reject };

    try {
      socket.send(JSON.stringify({
        type: "ocr",
        mode,
        image,
        source_image: image,
        preprocessed: false,
      }));
    } catch (err) {
      ocrRequestPending = null;
      reject(err);
    }
  });
}

function buildSearchRects(page, viewport, textContent, normalizedQuery) {
  const tokens = normalizedQuery.split(/\s+/).filter(token => token.length >= 2);
  const rects = [];

  textContent.items.forEach(item => {
    const itemText = normalizeSearchText(item.str);
    if (!itemText) {
      return;
    }

    const matched = itemText.includes(normalizedQuery) ||
      tokens.some(token => itemText.includes(token));

    if (!matched) {
      return;
    }

    const [x1, y1] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
    const width = Math.max(18, item.width * scale);
    const height = Math.max(10, (item.height || 10) * scale * 1.2);
    rects.push({
      x: Math.max(0, x1),
      y: Math.max(0, y1 - height),
      w: Math.min(viewport.width - x1, width),
      h: height,
    });
  });

  return rects;
}

async function getPageTextContent(pageNum) {
  if (pageTextCache.has(pageNum)) {
    return pageTextCache.get(pageNum);
  }

  const page = await pdfDoc.getPage(pageNum);
  const textContent = await page.getTextContent({ normalizeWhitespace: true });
  const payload = { page, textContent };
  pageTextCache.set(pageNum, payload);
  return payload;
}

async function searchPdfByText(query) {
  if (!pdfDoc) {
    setSearchStatus("Load a PDF before searching.");
    return;
  }

  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    setSearchStatus("OCR returned no searchable text.");
    return;
  }

  searchQuery = query.trim();
  updateSearchPreview(searchQuery);
  setSearchStatus(`Searching for "${searchQuery}"...`, "var(--accent2)");

  searchResultsCache = [];
  pageElements.forEach(el => {
    if (el.searchCanvas) {
      el.searchCanvas.getContext("2d").clearRect(0, 0, el.searchCanvas.width, el.searchCanvas.height);
    }
  });

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const { page, textContent } = await getPageTextContent(pageNum);
    const pageText = normalizeSearchText(textContent.items.map(item => item.str).join(" "));
    if (!pageText.includes(normalizedQuery) && !normalizedQuery.split(/\s+/).some(token => token.length >= 2 && pageText.includes(token))) {
      continue;
    }

    const viewport = page.getViewport({ scale });
    const rects = buildSearchRects(page, viewport, textContent, normalizedQuery);
    const firstIndex = pageText.indexOf(normalizedQuery);
    const snippet = firstIndex >= 0
      ? textContent.items.map(item => item.str).join(" ").replace(/\s+/g, " ").trim().slice(Math.max(0, firstIndex - 35), Math.min(pageText.length, firstIndex + normalizedQuery.length + 60))
      : textContent.items.map(item => item.str).join(" ").replace(/\s+/g, " ").trim().slice(0, 120);

    searchResultsCache.push({
      pageNum,
      hitCount: rects.length,
      snippet,
    });
    redrawSearchHighlights(pageNum);
  }

  renderSearchResultsList();

  if (searchResultsCache.length) {
    setSearchStatus(`Found ${searchResultsCache.length} page${searchResultsCache.length === 1 ? "" : "s"} for "${searchQuery}".`, "var(--success)");
    scrollToPage(searchResultsCache[0].pageNum);
  } else {
    setSearchStatus(`No PDF matches found for "${searchQuery}".`, "var(--warn)");
  }
}

// ═══════════════════════════════════════════════════════════════
// HIGHLIGHT SYSTEM
// ═══════════════════════════════════════════════════════════════
function getPageUnderCursor(tip) {
  // Convert normalized tip to screen coordinates
  const sx = (1 - tip.x) * window.innerWidth;
  const sy = tip.y * window.innerHeight;

  for (const el of pageElements) {
    const rect = el.wrapper.getBoundingClientRect();
    if (sx >= rect.left && sx <= rect.right && sy >= rect.top && sy <= rect.bottom) {
      return el;
    }
  }
  // Fallback: return the current page element
  return pageElements[currentPage - 1] || null;
}

function screenToPage(tip, pageEl) {
  const rect = pageEl.wrapper.getBoundingClientRect();
  const sx = (1 - tip.x) * window.innerWidth;
  const sy = tip.y * window.innerHeight;
  return {
    x: (sx - rect.left) / rect.width,
    y: (sy - rect.top) / rect.height
  };
}

// Highlighter strokes are stored in highlights as freehand paths (like pen but thicker + transparent)
function addHighlighterPoint(pageNum, normX, normY) {
  if (!highlights[pageNum]) highlights[pageNum] = [];
  if (!currentStroke) {
    currentStroke = {
      points: [],
      color: activeColor,
      pageNum: pageNum,
      id: annotationIdCounter++,
      timestamp: Date.now(),
      type: "highlighter"
    };
    highlights[pageNum].push(currentStroke);
  }
  currentStroke.points.push({ x: normX, y: normY });
  redrawHighlights(pageNum);
}

function redrawHighlights(pageNum) {
  const el = pageElements[pageNum - 1];
  if (!el) return;
  const ctx = el.hlCanvas.getContext("2d");
  const W = el.hlCanvas.width, H = el.hlCanvas.height;
  ctx.clearRect(0, 0, W, H);

  (highlights[pageNum] || []).forEach(h => {
    if (!h.points || h.points.length < 2) return;
    ctx.beginPath();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 18; // thick highlighter
    ctx.strokeStyle = h.color;
    ctx.globalAlpha = 0.35;

    const first = h.points[0];
    ctx.moveTo(first.x * W, first.y * H);
    for (let i = 1; i < h.points.length; i++) {
      ctx.lineTo(h.points[i].x * W, h.points[i].y * H);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  });
}

// ═══════════════════════════════════════════════════════════════
// PEN / INK SYSTEM
// ═══════════════════════════════════════════════════════════════
function addPenPoint(pageNum, normX, normY) {
  if (!penStrokes[pageNum]) penStrokes[pageNum] = [];
  if (!currentStroke) {
    currentStroke = {
      points: [],
      color: activeColor,
      pageNum: pageNum,
      id: annotationIdCounter++,
      timestamp: Date.now()
    };
    penStrokes[pageNum].push(currentStroke);
  }
  currentStroke.points.push({ x: normX, y: normY });
  redrawPenStrokes(pageNum);
}

function finishPenStroke() {
  if (currentStroke && currentStroke.points.length >= 2) {
    refreshNotesPanel();
  }
  currentStroke = null;
}

function redrawPenStrokes(pageNum) {
  const el = pageElements[pageNum - 1];
  if (!el) return;
  const ctx = el.inkCanvas.getContext("2d");
  const W = el.inkCanvas.width, H = el.inkCanvas.height;
  ctx.clearRect(0, 0, W, H);

  const strokes = penStrokes[pageNum] || [];
  strokes.forEach(stroke => {
    if (stroke.points.length < 2) return;
    ctx.beginPath();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 3;
    ctx.strokeStyle = stroke.color;
    ctx.globalAlpha = 0.85;

    const first = stroke.points[0];
    ctx.moveTo(first.x * W, first.y * H);
    for (let i = 1; i < stroke.points.length; i++) {
      const p = stroke.points[i];
      ctx.lineTo(p.x * W, p.y * H);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  });
}

// ═══════════════════════════════════════════════════════════════
// SCROLL INERTIA SYSTEM
// ═══════════════════════════════════════════════════════════════
function startInertia() {
  if (Math.abs(scrollVelocity) < 0.5) return;
  scrollInertiaActive = true;
  inertiaStep();
}

function stopInertia() {
  scrollInertiaActive = false;
  if (scrollInertiaRAF) {
    cancelAnimationFrame(scrollInertiaRAF);
    scrollInertiaRAF = null;
  }
}

function inertiaStep() {
  if (!scrollInertiaActive) return;
  scrollVelocity *= 0.92;
  if (Math.abs(scrollVelocity) < 0.3) {
    scrollInertiaActive = false;
    scrollVelocity = 0;
    return;
  }
  pdfArea.scrollTop += scrollVelocity;
  scrollInertiaRAF = requestAnimationFrame(inertiaStep);
}

// ═══════════════════════════════════════════════════════════════
// VIRTUAL TOOLBAR HOVER SYSTEM
// ═══════════════════════════════════════════════════════════════
function clearVirtualHover() {
  if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
  hoverStartTime = 0;
  currentHoveredBtn = null;
  hoverSwitchCandidate = null;
  hoverSwitchSince = 0;
  hoverLeaveSince = 0;
  virtualBtns.forEach(b => b.classList.remove("hover-highlight"));
}

function isPointInsidePaddedRect(sx, sy, rect, padding) {
  return sx >= rect.left - padding && sx <= rect.right + padding &&
    sy >= rect.top - padding && sy <= rect.bottom + padding;
}

function getNearestVirtualButton(sx, sy) {
  let bestBtn = null;
  let bestScore = Number.POSITIVE_INFINITY;

  virtualBtns.forEach(btn => {
    const rect = btn.getBoundingClientRect();
    const cx = (rect.left + rect.right) / 2;
    const cy = (rect.top + rect.bottom) / 2;
    const centerDistance = Math.hypot(sx - cx, sy - cy);
    const insideExpanded = isPointInsidePaddedRect(sx, sy, rect, TOOLBAR_HIT_PADDING);

    if (!insideExpanded && centerDistance > TOOLBAR_SNAP_RADIUS) {
      return;
    }

    const score = insideExpanded ? centerDistance * 0.6 : centerDistance + 60;
    if (score < bestScore) {
      bestScore = score;
      bestBtn = btn;
    }
  });

  return bestBtn;
}

function beginVirtualHover(btn) {
  clearVirtualHover();
  currentHoveredBtn = btn;
  hoverStartTime = performance.now();
  btn.classList.add("hover-highlight");

  hoverTimer = setTimeout(() => {
    if (currentHoveredBtn !== btn) {
      return;
    }

    const tool = btn.dataset.tool;
    if (tool) {
      setActiveTool(tool);
      if (tool === "search") {
        showPill("🔎 Search mode", "#22d3ee");
      } else if (tool === "cursor") {
        showPill("🖱 Cursor mode", "#22d3ee");
      } else {
        showPill(`🎯 ${tool.charAt(0).toUpperCase() + tool.slice(1)} selected`, "#22d3ee");
      }
    }
    clearVirtualHover();
  }, HOVER_DURATION);
}

function checkVirtualToolbarHover(sx, sy) {
  const toolbarEl = document.getElementById("virtual-toolbar");
  const toolbarRect = toolbarEl.getBoundingClientRect();

  // Quick check: is cursor in the toolbar region?
  if (sx < toolbarRect.left - TOOLBAR_HIT_PADDING - TOOLBAR_SNAP_RADIUS ||
      sx > toolbarRect.right + TOOLBAR_HIT_PADDING + TOOLBAR_SNAP_RADIUS ||
      sy < toolbarRect.top - TOOLBAR_HIT_PADDING - TOOLBAR_SNAP_RADIUS ||
      sy > toolbarRect.bottom + TOOLBAR_HIT_PADDING + TOOLBAR_SNAP_RADIUS) {
    clearVirtualHover();
    return false;
  }

  if (currentHoveredBtn) {
    const stickyRect = currentHoveredBtn.getBoundingClientRect();
    if (isPointInsidePaddedRect(sx, sy, stickyRect, TOOLBAR_HIT_PADDING + TOOLBAR_STICKY_PADDING)) {
      hoverLeaveSince = 0;
      hoverSwitchCandidate = null;
      hoverSwitchSince = 0;
      return true;
    }
  }

  const hovered = getNearestVirtualButton(sx, sy);
  const nowMs = performance.now();

  if (hovered && hovered === currentHoveredBtn) {
    hoverLeaveSince = 0;
    hoverSwitchCandidate = null;
    hoverSwitchSince = 0;
    return true;
  }

  if (hovered && !currentHoveredBtn) {
    beginVirtualHover(hovered);
    return true;
  }

  if (hovered && currentHoveredBtn && hovered !== currentHoveredBtn) {
    hoverLeaveSince = 0;
    if (hoverSwitchCandidate !== hovered) {
      hoverSwitchCandidate = hovered;
      hoverSwitchSince = nowMs;
      return true;
    }

    if (nowMs - hoverSwitchSince < HOVER_SWITCH_DELAY) {
      return true;
    }

    beginVirtualHover(hovered);
    return true;
  }

  if (!hovered && currentHoveredBtn) {
    if (!hoverLeaveSince) {
      hoverLeaveSince = nowMs;
      return true;
    }

    if (nowMs - hoverLeaveSince < HOVER_LEAVE_GRACE) {
      return true;
    }
  }

  clearVirtualHover();
  return false;
}

function toggleClickControls(enabled) {
  clickControlsEnabled = enabled;
  virtualToolbar.classList.toggle("clickable", clickControlsEnabled);
  clickControlsToggleBtn.textContent = clickControlsEnabled
    ? "Disable Click Controls"
    : "Enable Click Controls";
}

// ═══════════════════════════════════════════════════════════════
// GESTURE HANDLERS
// ═══════════════════════════════════════════════════════════════
const now = () => performance.now() / 1000; // seconds

function handlePoint(lm) {
  // Index finger action depends on selected mode.
  const tip = lm[8];
  const t = now();
  const rawSx = (1 - tip.x) * cursorCanvas.width;
  const rawSy = tip.y * cursorCanvas.height;
  let sx = rawSx;
  let sy = rawSy;

  // Apply pointer-specific One Euro Filter
  sx = ptrFilterX.filter(sx, t);
  sy = ptrFilterY.filter(sy, t);

  cursorCtx.clearRect(0, 0, cursorCanvas.width, cursorCanvas.height);

  // Check virtual toolbar hover (tool selection via dwell)
  const isHoveringToolbar = checkVirtualToolbarHover(sx, sy);

  if (isHoveringToolbar) {
    if (searchOverlayActive) {
      searchOverlayPrevX = null;
      searchOverlayPrevY = null;
    } else if (currentStroke) {
      finishPenStroke();
    }
    drawLaserCursor(sx, sy, "#a78bfa");
    showPill("🎯 Hover to select tool", "#22d3ee");
    return;
  }

  if (activeTool === "search" && searchOverlayActive) {
    const overlayX = overlayFilterX.filter(rawSx, t);
    const overlayY = overlayFilterY.filter(rawSy, t);
    addSearchOverlayPoint(overlayX, overlayY);
    drawPenCursor(overlayX, overlayY, "#22d3ee");
    showPill("🔎 Writing Search Query", "#22d3ee");
    return;
  }

  if (activeTool === "cursor") {
    if (currentStroke) finishPenStroke();
    drawLaserCursor(sx, sy, "#a78bfa");
    showPill("☝️ Cursor", "#a78bfa");
    return;
  }

  const pageEl = getPageUnderCursor(tip);
  if (!pageEl) {
    if (currentStroke) finishPenStroke();
    if (activeTool === "pen") {
      drawPenCursor(sx, sy, activeColor);
      showPill("✍️ Move onto page to write", "#22d3ee");
    } else {
      drawHighlighterCursor(sx, sy, activeColor);
      showPill("🟡 Move onto page to highlight", "#22d3ee");
    }
    return;
  }

  const coords = screenToPage(tip, pageEl);
  // Use drawing-specific filters (separate from pointer)
  const filteredX = drawFilterX.filter(coords.x, t);
  const filteredY = drawFilterY.filter(coords.y, t);

  // Calculate screen position for cursor display
  const rect = pageEl.wrapper.getBoundingClientRect();
  const screenX = rect.left + filteredX * rect.width;
  const screenY = rect.top + filteredY * rect.height;

  cursorCtx.clearRect(0, 0, cursorCanvas.width, cursorCanvas.height);

  if (activeTool === "pen") {
    addPenPoint(pageEl.pageNum, filteredX, filteredY);
    drawPenCursor(screenX, screenY, activeColor);
    showPill("✍️ Index writing", activeColor);
  } else {
    // highlighter
    addHighlighterPoint(pageEl.pageNum, filteredX, filteredY);
    drawHighlighterCursor(screenX, screenY, activeColor);
    showPill("🟡 Index highlight", activeColor);
  }
}

// Unused fallback path (kept for future gesture experiments).
function handlePeace() {
  // Two-finger gesture intentionally does nothing.
  if (currentStroke) finishPenStroke();
  cursorCtx.clearRect(0, 0, cursorCanvas.width, cursorCanvas.height);
  showPill("✌️ Two-finger disabled", "#94a3b8");
}

function drawLaserCursor(sx, sy, color) {
  // Outer glow
  const gradient = cursorCtx.createRadialGradient(sx, sy, 0, sx, sy, 18);
  gradient.addColorStop(0, `${color}66`);
  gradient.addColorStop(1, `${color}00`);
  cursorCtx.fillStyle = gradient;
  cursorCtx.fillRect(sx - 18, sy - 18, 36, 36);

  // Outer ring
  cursorCtx.beginPath();
  cursorCtx.arc(sx, sy, 8, 0, Math.PI * 2);
  cursorCtx.strokeStyle = `${color}b3`;
  cursorCtx.lineWidth = 1.5;
  cursorCtx.stroke();

  // Inner dot
  cursorCtx.beginPath();
  cursorCtx.arc(sx, sy, 3, 0, Math.PI * 2);
  cursorCtx.fillStyle = color;
  cursorCtx.fill();
}

function drawPenCursor(sx, sy, color) {
  // Soft halo for easier hand-location feedback.
  const gradient = cursorCtx.createRadialGradient(sx, sy, 0, sx, sy, 18);
  gradient.addColorStop(0, `${color}55`);
  gradient.addColorStop(1, `${color}00`);
  cursorCtx.fillStyle = gradient;
  cursorCtx.fillRect(sx - 18, sy - 18, 36, 36);

  // High-contrast outer ring
  cursorCtx.beginPath();
  cursorCtx.arc(sx, sy, 11, 0, Math.PI * 2);
  cursorCtx.strokeStyle = "rgba(255, 255, 255, 0.9)";
  cursorCtx.lineWidth = 1.2;
  cursorCtx.stroke();

  // Color ring
  cursorCtx.beginPath();
  cursorCtx.arc(sx, sy, 7.5, 0, Math.PI * 2);
  cursorCtx.strokeStyle = color;
  cursorCtx.lineWidth = 1.8;
  cursorCtx.stroke();

  // Filled center dot
  cursorCtx.beginPath();
  cursorCtx.arc(sx, sy, 3.8, 0, Math.PI * 2);
  cursorCtx.fillStyle = color;
  cursorCtx.globalAlpha = 0.95;
  cursorCtx.fill();
  cursorCtx.globalAlpha = 1;
}

function drawHighlighterCursor(sx, sy, color) {
  // Wide translucent bar cursor
  cursorCtx.globalAlpha = 0.3;
  cursorCtx.fillStyle = color;
  cursorCtx.fillRect(sx - 12, sy - 12, 24, 24);
  cursorCtx.globalAlpha = 1;

  // Small center dot
  cursorCtx.beginPath();
  cursorCtx.arc(sx, sy, 3, 0, Math.PI * 2);
  cursorCtx.fillStyle = color;
  cursorCtx.fill();
}

function handleFist(lm) {
  if (searchOverlayActive) {
    showPill("🔎 Search pad active", "#22d3ee");
    return;
  }

  const wy = lm[0].y;
  const t = now();

  if (prevWristY !== null) {
    const rawDy = wy - prevWristY;

    // Dead-zone: ignore micro-movements
    if (Math.abs(rawDy) < 0.005) {
      prevWristY = wy;
      showPill("✊ Scroll (hold)", "#fbbf24");
      return;
    }

    // Apply filter to velocity
    const filteredDy = scrollFilter.filter(rawDy, t);

    // Velocity accumulator with exponential smoothing
    const rawVelocity = filteredDy * 1200;
    scrollVelocity = scrollVelocity * 0.6 + rawVelocity * 0.4;

    // Cap velocity
    scrollVelocity = Math.max(-60, Math.min(60, scrollVelocity));

    pdfArea.scrollTop += scrollVelocity;
  }

  prevWristY = wy;
  showPill("✊ Scrolling", "#fbbf24");
}

function handleOpen(lm) {
  if (searchOverlayActive) {
    showPill("🔎 Search pad active", "#22d3ee");
    return;
  }

  // Open hand intentionally performs no action.
  if (currentStroke) finishPenStroke();
  prevWristX = null;
  openStableFrames = 0;
  showPill("✋ Open hand idle", "#94a3b8");
}

// ═══════════════════════════════════════════════════════════════
// HAND SKELETON DRAWING (sidebar camera)
// ═══════════════════════════════════════════════════════════════
const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],
  [13,17],[0,17],[17,18],[18,19],[19,20]
];

function drawSkeleton(lm) {
  const w = handCanvasEl.width, h = handCanvasEl.height;
  handCtx.clearRect(0, 0, w, h);
  handCtx.drawImage(webcamVideo, 0, 0, w, h);

  // Connections
  handCtx.lineWidth = 2;
  HAND_CONNECTIONS.forEach(([a, b]) => {
    handCtx.strokeStyle = "rgba(74, 222, 128, 0.6)";
    handCtx.beginPath();
    handCtx.moveTo((1 - lm[a].x) * w, lm[a].y * h);
    handCtx.lineTo((1 - lm[b].x) * w, lm[b].y * h);
    handCtx.stroke();
  });

  // Joints
  lm.forEach((pt, i) => {
    handCtx.beginPath();
    const r = i === 8 ? 5 : (i === 4 ? 4 : 2.5);
    handCtx.arc((1 - pt.x) * w, pt.y * h, r, 0, Math.PI * 2);
    handCtx.fillStyle = i === 8 ? "#fbbf24" : (i === 4 ? "#22d3ee" : "#60a5fa");
    handCtx.fill();
  });
}

// ═══════════════════════════════════════════════════════════════
// GESTURE PILL INDICATOR
// ═══════════════════════════════════════════════════════════════
let pillTimer = null;

function showPill(text, color) {
  pillText.textContent = text;
  pillDot.style.background = color;
  gesturePill.classList.add("visible");

  // Also update sidebar badge
  gestureBadge.textContent = text;
  gestureBadge.style.color = color;
  gestureBadge.style.display = "block";

  clearTimeout(pillTimer);
  pillTimer = setTimeout(() => {
    gesturePill.classList.remove("visible");
    gestureBadge.style.display = "none";
  }, 1000);
}

// ═══════════════════════════════════════════════════════════════
// NOTES PANEL
// ═══════════════════════════════════════════════════════════════
function refreshNotesPanel() {
  const allNotes = [];

  // Collect highlights
  Object.entries(highlights).forEach(([pageNum, items]) => {
    items.forEach(h => {
      allNotes.push({
        type: "highlight",
        color: h.color,
        page: parseInt(pageNum),
        id: h.id,
        timestamp: h.timestamp
      });
    });
  });

  // Collect pen strokes
  Object.entries(penStrokes).forEach(([pageNum, items]) => {
    items.forEach(s => {
      if (s.points.length >= 2) {
        allNotes.push({
          type: "pen",
          color: s.color,
          page: parseInt(pageNum),
          id: s.id,
          timestamp: s.timestamp
        });
      }
    });
  });

  // Sort by timestamp
  allNotes.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  if (allNotes.length === 0) {
    notesList.innerHTML = '<div class="notes-empty">No annotations yet</div>';
    return;
  }

  notesList.innerHTML = "";
  allNotes.forEach(note => {
    const item = document.createElement("div");
    item.className = "note-item";
    item.innerHTML = `
      <div class="note-color-dot" style="background:${note.color}"></div>
      <div class="note-info">
        <span class="note-page">Page ${note.page}</span>
        <span class="note-type">${note.type === "highlight" ? "Highlight" : "Pen stroke"}</span>
      </div>
      <button class="note-delete" data-id="${note.id}" data-type="${note.type}" data-page="${note.page}" title="Delete">✕</button>
    `;

    // Click to navigate
    item.addEventListener("click", (e) => {
      if (e.target.classList.contains("note-delete")) return;
      scrollToPage(note.page);
    });

    // Delete button
    item.querySelector(".note-delete").addEventListener("click", (e) => {
      e.stopPropagation();
      deleteAnnotation(note.type, note.page, note.id);
    });

    notesList.appendChild(item);
  });
}

function deleteAnnotation(type, page, id) {
  if (type === "highlight") {
    highlights[page] = (highlights[page] || []).filter(h => h.id !== id);
    redrawHighlights(page);
  } else {
    penStrokes[page] = (penStrokes[page] || []).filter(s => s.id !== id);
    redrawPenStrokes(page);
  }
  refreshNotesPanel();
}

function clearAllAnnotations() {
  highlights = {};
  penStrokes = {};
  pageElements.forEach(el => {
    el.hlCanvas.getContext("2d").clearRect(0, 0, el.hlCanvas.width, el.hlCanvas.height);
    el.inkCanvas.getContext("2d").clearRect(0, 0, el.inkCanvas.width, el.inkCanvas.height);
  });
  refreshNotesPanel();
}

function exportAnnotations() {
  const data = {
    exportDate: new Date().toISOString(),
    highlights,
    penStrokes
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "pdf-annotations.json";
  a.click();
  URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════════════
// DETECTION LOOP
// ═══════════════════════════════════════════════════════════════
function resizeCursorCanvas() {
  cursorCanvas.width = window.innerWidth;
  cursorCanvas.height = window.innerHeight;
  resizeSearchOverlayCanvas();
}
resizeCursorCanvas();
window.addEventListener("resize", resizeCursorCanvas);

async function detectLoop() {
  if (!webcamRunning || !handLandmarker) {
    requestAnimationFrame(detectLoop);
    return;
  }

  if (webcamVideo.currentTime === lastVideoTime) {
    requestAnimationFrame(detectLoop);
    return;
  }

  lastVideoTime = webcamVideo.currentTime;
  handCanvasEl.width = webcamVideo.videoWidth;
  handCanvasEl.height = webcamVideo.videoHeight;

  const results = handLandmarker.detectForVideo(webcamVideo, performance.now());

  if (results.landmarks && results.landmarks.length > 0) {
    const lm = results.landmarks[0];
    lastLandmarks = lm;
    drawSkeleton(lm);

    const raw = classifyGesture(lm);
    const stable = updateGestureState(raw);

    // Dispatch to handler
    switch (stable) {
      case "point": handlePoint(lm); break;
      case "fist": handleFist(lm); break;
      case "open": handleOpen(lm); break;
      default:
        cursorCtx.clearRect(0, 0, cursorCanvas.width, cursorCanvas.height);
        break;
    }
  } else {
    // No hand detected
    if (activeGesture !== "none") {
      onGestureExit(activeGesture);
      lastActiveGesture = activeGesture;
      activeGesture = "none";
    }
    rawGesture = "none";
    rawCount = 0;
    releaseCount = 0;
    prevWristX = null;
    prevWristY = null;
    openStableFrames = 0;
    ptrFilterX.reset();
    ptrFilterY.reset();
    drawFilterX.reset();
    drawFilterY.reset();
    scrollFilter.reset();
    if (currentStroke) finishPenStroke();

    // Clear sidebar cam
    handCtx.clearRect(0, 0, handCanvasEl.width, handCanvasEl.height);
    handCtx.drawImage(webcamVideo, 0, 0, handCanvasEl.width, handCanvasEl.height);

    cursorCtx.clearRect(0, 0, cursorCanvas.width, cursorCanvas.height);
  }

  maybeAutoSubmitSearchOverlay();

  requestAnimationFrame(detectLoop);
}

// ═══════════════════════════════════════════════════════════════
// CAMERA & MEDIAPIPE INIT
// ═══════════════════════════════════════════════════════════════
async function initHandLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
  );
  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "GPU"
    },
    runningMode: "VIDEO",
    numHands: 1
  });
}

async function startWebcam() {
  startBtn.disabled = true;
  startBtn.textContent = "⏳ Loading model...";
  try {
    await initHandLandmarker();
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: 640, height: 480 }
    });
    webcamVideo.srcObject = stream;
    webcamVideo.addEventListener("loadeddata", () => {
      webcamRunning = true;
      statusDot.classList.add("active");
      camLabel.textContent = "Camera live";
      startBtn.textContent = "✅ Camera On";
      detectLoop();
    });
  } catch (err) {
    console.error("Camera error:", err);
    startBtn.textContent = "❌ Camera failed";
    startBtn.disabled = false;
  }
}

// ═══════════════════════════════════════════════════════════════
// LOAD PDF
// ═══════════════════════════════════════════════════════════════
async function loadPDF(src) {
  try {
    pdfDoc = await pdfjsLib.getDocument(src).promise;
    totalPages = pdfDoc.numPages;
    currentPage = 1;
    highlights = {};
    penStrokes = {};
    annotationIdCounter = 0;
    pageTextCache.clear();
    clearSearchResults();

    dropZone.style.display = "none";
    pdfContainer.style.display = "flex";
    toolbar.style.display = "flex";

    await renderAllPages();
    refreshNotesPanel();
  } catch (err) {
    console.error("PDF load error:", err);
    alert("Failed to load PDF. Please try another file.");
  }
}

// ═══════════════════════════════════════════════════════════════
// EVENT LISTENERS
// ═══════════════════════════════════════════════════════════════
function isPdfFile(file) {
  if (!file) return false;
  const type = (file.type || "").toLowerCase();
  const name = (file.name || "").toLowerCase();
  return type === "application/pdf" || name.endsWith(".pdf");
}

function handlePdfSelection(file) {
  if (!file) return;
  if (!isPdfFile(file)) {
    alert("Please select a valid PDF file.");
    return;
  }
  loadPDF(URL.createObjectURL(file));
}

// Drag & drop
dropZone.addEventListener("dragover", e => {
  e.preventDefault();
  dropZone.classList.add("drag-over");
});
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
dropZone.addEventListener("drop", e => {
  e.preventDefault();
  dropZone.classList.remove("drag-over");
  const file = e.dataTransfer.files[0];
  handlePdfSelection(file);
});

// File input
document.getElementById("file-input").addEventListener("change", e => {
  const file = e.target.files[0];
  handlePdfSelection(file);
  e.target.value = "";
});

// Toolbar: navigation
document.getElementById("btn-prev").addEventListener("click", () => {
  if (pdfDoc && currentPage > 1) scrollToPage(currentPage - 1);
});
document.getElementById("btn-next").addEventListener("click", () => {
  if (pdfDoc && currentPage < totalPages) scrollToPage(currentPage + 1);
});

// Toolbar: zoom
document.getElementById("btn-zoom-in").addEventListener("click", () => {
  scale = Math.min(MAX_SCALE, scale + 0.2);
  if (pdfDoc) rerenderAtScale();
});
document.getElementById("btn-zoom-out").addEventListener("click", () => {
  scale = Math.max(MIN_SCALE, scale - 0.2);
  if (pdfDoc) rerenderAtScale();
});

// OCR search controls
searchToolbarBtn.addEventListener("click", performOcrSearch);
searchRunBtn.addEventListener("click", performOcrSearch);
searchClearBtn.addEventListener("click", clearSearchResults);
clickControlsToggleBtn.addEventListener("click", () => {
  toggleClickControls(!clickControlsEnabled);
  showPill(
    clickControlsEnabled ? "🖱️ Click Controls ON" : "🖱️ Click Controls OFF",
    "#22d3ee"
  );
});

virtualBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    const tool = btn.dataset.tool;
    if (tool) {
      setActiveTool(tool);
      if (tool === "search") {
        showPill("🔎 Search mode", "#22d3ee");
      } else if (tool === "cursor") {
        showPill("🖱 Cursor mode", "#22d3ee");
      } else {
        showPill(`🎯 ${tool.charAt(0).toUpperCase() + tool.slice(1)} selected`, "#22d3ee");
      }
    }
  });
});

// Toolbar: tool buttons
document.querySelectorAll(".tb-tool-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    setActiveTool(btn.dataset.tool);
  });
});

function setActiveTool(tool) {
  if (tool === "search" && !pdfDoc) {
    setSearchStatus("Load a PDF before running OCR search.");
    showPill("📄 Load PDF first", "#fbbf24");
    return;
  }

  activeTool = tool;

  // Finish any pending stroke when switching tools
  if (tool !== "pen" && tool !== "highlighter" && currentStroke) {
    finishPenStroke();
  }

  if (tool !== "search" && searchOverlayActive) {
    closeSearchOverlay();
  }

  if (tool === "search" && !searchOverlayActive) {
    openSearchOverlay();
  }

  // Update toolbar buttons
  document.querySelectorAll(".tb-tool-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.tool === tool);
  });
  // Update virtual toolbar buttons
  virtualBtns.forEach(b => {
    b.classList.toggle("active", b.dataset.tool === tool);
  });
}

// Toolbar: clear page
document.getElementById("btn-clear").addEventListener("click", () => {
  highlights[currentPage] = [];
  penStrokes[currentPage] = [];
  redrawHighlights(currentPage);
  redrawPenStrokes(currentPage);
  refreshNotesPanel();
});

// Color swatches
document.querySelectorAll(".swatch").forEach(sw => {
  sw.addEventListener("click", () => {
    document.querySelectorAll(".swatch").forEach(s => s.classList.remove("selected"));
    sw.classList.add("selected");
    activeColor = sw.dataset.color;
  });
});

// Camera button
startBtn.addEventListener("click", startWebcam);

// Notes panel actions
document.getElementById("btn-export-notes").addEventListener("click", exportAnnotations);
document.getElementById("btn-clear-all-notes").addEventListener("click", () => {
  if (confirm("Clear all annotations from all pages?")) {
    clearAllAnnotations();
  }
});

// Keyboard shortcuts
document.addEventListener("keydown", e => {
  if (!pdfDoc) return;
  if (e.key === "ArrowLeft" || e.key === "PageUp") {
    e.preventDefault();
    if (currentPage > 1) scrollToPage(currentPage - 1);
  } else if (e.key === "ArrowRight" || e.key === "PageDown") {
    e.preventDefault();
    if (currentPage < totalPages) scrollToPage(currentPage + 1);
  } else if (e.key === "+" || e.key === "=") {
    e.preventDefault();
    scale = Math.min(MAX_SCALE, scale + 0.2);
    rerenderAtScale();
  } else if (e.key === "-") {
    e.preventDefault();
    scale = Math.max(MIN_SCALE, scale - 0.2);
    rerenderAtScale();
  }
});

// Track scroll for page indicator
pdfArea.addEventListener("scroll", () => {
  // Find which page is most visible
  let bestPage = 1;
  let bestOverlap = 0;
  const areaRect = pdfArea.getBoundingClientRect();

  pageElements.forEach(el => {
    const rect = el.wrapper.getBoundingClientRect();
    const overlap = Math.max(0,
      Math.min(rect.bottom, areaRect.bottom) - Math.max(rect.top, areaRect.top)
    );
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestPage = el.pageNum;
    }
  });

  if (bestPage !== currentPage) {
    currentPage = bestPage;
    updatePageInfo();
  }
});

// Init
toggleClickControls(false);
setActiveTool("cursor");
console.log("GesturePDF Pro ready — drop a PDF and enable camera.");
