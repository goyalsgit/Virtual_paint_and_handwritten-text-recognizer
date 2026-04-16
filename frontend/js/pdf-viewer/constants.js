export const MIN_SCALE = 0.5;
export const MAX_SCALE = 4.0;

export const SEARCH_OVERLAY_MIN_STEP_PX = 0.8;
export const SEARCH_OVERLAY_MAX_SEGMENT_PX = 5.0;
export const SEARCH_OVERLAY_IDLE_SEC = 2.2;

export const OCR_WS_URL = (() => {
  const host = window.location.hostname;
  if (!host || host === "localhost" || host === "127.0.0.1") {
    return "ws://localhost:8000/ws";
  }
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${host}/ws`;
})();

export const HOVER_DURATION = 220;
export const HOVER_SWITCH_DELAY = 140;
export const HOVER_LEAVE_GRACE = 120;
export const TOOLBAR_HIT_PADDING = 64;
export const TOOLBAR_STICKY_PADDING = 24;
export const TOOLBAR_SNAP_RADIUS = 120;

export const DEFAULT_CONFIRM_FRAMES = 4;
export const CONFIRM_FRAMES_BY_GESTURE = {
  point: 2,
  fist: 5,
  open: 5,
};
export const SEARCH_OVERLAY_CONFIRM_FRAMES = 1;
export const RELEASE_FRAMES = 3;
export const GUARD_PAIRS = new Set(["fist->point", "point->fist"]);

export const FILTER_PRESETS = {
  pointer: { freq: 60, minCutoff: 2.4, beta: 0.12, dCutoff: 1.0 },
  drawing: { freq: 60, minCutoff: 2.2, beta: 0.1, dCutoff: 1.0 },
  overlay: { freq: 60, minCutoff: 2.4, beta: 0.08, dCutoff: 1.0 },
  scroll: { freq: 60, minCutoff: 1.1, beta: 0.02, dCutoff: 1.0 },
};
