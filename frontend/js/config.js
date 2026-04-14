// ═══════════════════════════════════════════════════════════════════
// CONFIG — All constants, colors, and shared application state.
//
// Every module imports from this file.
// The "state" object is shared — changes in any module are visible
// in all other modules (JavaScript objects are passed by reference).
// ═══════════════════════════════════════════════════════════════════

// ── Server URLs ─────────────────────────────────────────────────────
export const WS_URL = (() => {
  const host = window.location.hostname;
  if (!host || host === "localhost" || host === "127.0.0.1") {
    return "ws://localhost:8000/ws";
  }
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${host}/ws`;
})();

export const BACKEND_URL = (() => {
  if (window.location.origin && window.location.origin !== "null") {
    return window.location.origin;
  }
  return WS_URL.replace("ws://", "http://").replace("wss://", "https://").replace("/ws", "");
})();

// ── MediaPipe model sources ─────────────────────────────────────────
export const MEDIAPIPE_CDN_MODULE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/vision_bundle.mjs";
export const MEDIAPIPE_CDN_WASM   = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm";
export const MEDIAPIPE_LOCAL_MODULE = "/static/vendor/mediapipe/vision_bundle.mjs";
export const MEDIAPIPE_LOCAL_WASM   = "/static/vendor/mediapipe/wasm";

// ── Drawing colors ──────────────────────────────────────────────────
export const COLORS = [
  { name: "Black",  hex: "#111111", rgb: [17, 17, 17] },
  { name: "White",  hex: "#ffffff", rgb: [255, 255, 255] },
  { name: "Red",    hex: "#ff3333", rgb: [255, 60, 60] },
  { name: "Green",  hex: "#33dd55", rgb: [60, 210, 60] },
  { name: "Blue",   hex: "#4488ff", rgb: [100, 150, 255] },
  { name: "Yellow", hex: "#ffee33", rgb: [255, 230, 40] },
  { name: "Orange", hex: "#ff9922", rgb: [255, 170, 40] },
  { name: "Pink",   hex: "#ff88ff", rgb: [255, 130, 200] },
  { name: "Cyan",   hex: "#22eeff", rgb: [40, 230, 230] },
];

// ── Virtual canvas (the surface you draw on; bigger than the screen) ──
export const VIRTUAL_W = 3840;
export const VIRTUAL_H = 2160;

// ── Drawing settings ────────────────────────────────────────────────
export const DEFAULT_BRUSH_SIZE = 10;
export const ERASER_RADIUS      = 22;
export const DRAW_DEADZONE      = 0.3;   // minimum distance to register a stroke
export const MAX_UNDO_STEPS     = 20;

// ── Hand tracking settings ──────────────────────────────────────────
export const LOST_HAND_RESET_FRAMES = 15;  // frames without hand before full reset
export const GESTURE_STABLE_FRAMES  = 3;   // frames to confirm a gesture change
export const FINGER_THRESHOLD       = 0.05;
export const FINGER_HISTORY_SIZE    = 3;   // frames for finger-up averaging
export const GESTURE_HISTORY_SIZE   = 3;   // frames for gesture smoothing
export const LANDMARK_HISTORY_SIZE  = 3;   // frames for outlier detection

// ── Virtual button settings ─────────────────────────────────────────
export const VBTN_RADIUS      = 16;   // button circle radius (pixels)
export const VBTN_MARGIN_LEFT = 32;   // distance from left edge
export const VBTN_MARGIN_TOP  = 50;   // distance from top of canvas area
export const VBTN_SPACING     = 42;   // vertical gap between buttons
export const DWELL_TIME_MS    = 500;  // how long to hover to select (ms)

// ═══════════════════════════════════════════════════════════════════
// SHARED STATE — All mutable application state lives here.
// Every module imports this same object and reads/writes it.
// ═══════════════════════════════════════════════════════════════════
export const state = {
  // Drawing
  colorIdx: 0,              // index into COLORS array
  brushSize: DEFAULT_BRUSH_SIZE,
  eraserMode: false,
  prevX: null,              // previous stroke position (virtual canvas coords)
  prevY: null,
  mode: "IDLE",             // current UI mode label

  // Timestamps (seconds)
  lastDrawT: 0,
  lastOcrT: 0,
  lastHandActiveT: 0,

  // Hand tracking
  handPresent: false,
  handLossCounter: 0,

  // Gesture stability
  stableGesture: "IDLE",
  gestureCandidate: "IDLE",
  gestureCandidateFrames: 0,
  activeCanvasAction: "IDLE",

  // History buffers
  fingerHistory: [],
  gestureHistory: [],
  landmarkHistory: [],
  undoStack: [],
  redoStack: [],

  // Panning
  panX: 0,
  panY: 0,
  panStartX: null,
  panStartY: null,

  // Modes
  focusMode: false,

  // OCR
  ocrInFlight: false,
  continuousTextBuffer: "",
  inFlightContinuous: false,

  // WebSocket
  ws: null,
  wsReady: false,
  wsReconnectAttempts: 0,
  wsReconnectTimer: null,

  // MediaPipe
  landmarker: null,
  visionModule: null,

  // Virtual buttons
  dwellButtonIdx: -1,
  dwellStartTime: 0,
  lastSelectedFlash: { idx: -1, time: 0 },
  virtualButtons: [],
};
