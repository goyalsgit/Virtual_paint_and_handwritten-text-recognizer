// ═══════════════════════════════════════════════════════════════════
// GESTURES — Detect hand gestures from MediaPipe landmarks.
//
// Gesture mapping:
//   DRAW  = only index finger up          → draw on canvas
//   LIFT  = index + middle up             → lift pen (break stroke)
//   PAN   = index + middle + ring up      → pan/scroll canvas
//   ERASE = full fist (all fingers down)  → erase ink
//   IDLE  = anything else                 → do nothing
//
// The detection uses multi-frame averaging and temporal smoothing
// to prevent accidental gesture switches.
// ═══════════════════════════════════════════════════════════════════

import {
  FINGER_THRESHOLD,
  FINGER_HISTORY_SIZE,
  GESTURE_HISTORY_SIZE,
  GESTURE_STABLE_FRAMES,
  LANDMARK_HISTORY_SIZE,
  state,
} from "./config.js";

// ─────────────────────────────────────────────────────────────────
// 1. FINGER DETECTION
// ─────────────────────────────────────────────────────────────────

/**
 * Check which fingers are raised (index, middle, ring, pinky).
 * Uses multi-frame averaging: a finger is "up" only if it was up
 * in the majority of recent frames. This prevents flickering.
 *
 * @param {Array} lm - MediaPipe hand landmarks (21 points)
 * @returns {boolean[]} [indexUp, middleUp, ringUp, pinkyUp]
 */
export function fingersUp(lm) {
  // Each pair: [fingertip landmark, PIP joint landmark]
  // A finger is "up" if its tip is higher (lower Y) than its PIP joint.
  const pairs = [[8, 6], [12, 10], [16, 14], [20, 18]];
  const current = pairs.map(([tip, pip]) => lm[tip].y < lm[pip].y - FINGER_THRESHOLD);

  // Add to history buffer
  state.fingerHistory.push(current);
  if (state.fingerHistory.length > FINGER_HISTORY_SIZE) {
    state.fingerHistory.shift();
  }

  // Need enough history for averaging
  if (state.fingerHistory.length < FINGER_HISTORY_SIZE) {
    return current;
  }

  // Majority vote: finger is "up" if it was up in >50% of recent frames
  return [0, 1, 2, 3].map((fingerIdx) => {
    let upCount = 0;
    for (const frame of state.fingerHistory) {
      if (frame[fingerIdx]) upCount++;
    }
    return upCount >= Math.ceil(FINGER_HISTORY_SIZE / 2);
  });
}

// ─────────────────────────────────────────────────────────────────
// 2. THUMB & FIST DETECTION
// ─────────────────────────────────────────────────────────────────

/** Check if the thumb is folded into the palm. */
function isThumbClosed(lm) {
  const foldedAcrossPalm = lm[4].x > lm[3].x - 0.01;
  const nearPalm = Math.abs(lm[4].x - lm[2].x) < 0.12;
  const belowIndexBase = lm[4].y > lm[5].y - 0.01;
  return foldedAcrossPalm && nearPalm && belowIndexBase;
}

/** Check if all fingers + thumb are closed (full fist). */
function isFullFist(lm) {
  const pairs = [[8, 6], [12, 10], [16, 14], [20, 18]];
  const allFolded = pairs.every(([tip, pip]) => lm[tip].y >= lm[pip].y - 0.005);
  return allFolded && isThumbClosed(lm);
}

// ─────────────────────────────────────────────────────────────────
// 3. GESTURE CLASSIFICATION
// ─────────────────────────────────────────────────────────────────

/**
 * Classify the current hand posture into a gesture.
 * @param {Array} lm - MediaPipe landmarks
 * @returns {string} "DRAW" | "LIFT" | "PAN" | "ERASE" | "IDLE"
 */
export function classifyGesture(lm) {
  const [idx, mid, rng, pky] = fingersUp(lm);

  if (isFullFist(lm))                    return "ERASE";
  if (idx && mid && rng && !pky)         return "PAN";
  if (idx && mid && !rng && !pky)        return "LIFT";
  if (idx && !mid && !rng && !pky)       return "DRAW";
  return "IDLE";
}

// ─────────────────────────────────────────────────────────────────
// 4. GESTURE STABILIZATION
// ─────────────────────────────────────────────────────────────────

/**
 * Smooth the gesture over time using weighted voting.
 * Requires GESTURE_STABLE_FRAMES consecutive frames to switch.
 * This prevents accidental mode switches during fast movement.
 */
export function updateStableGesture(nextGesture) {
  state.gestureHistory.push(nextGesture);
  if (state.gestureHistory.length > GESTURE_HISTORY_SIZE) {
    state.gestureHistory.shift();
  }

  // Weighted voting: recent frames have more weight
  const counts = {};
  let maxCount = 0;
  let dominant = nextGesture;

  for (let i = 0; i < state.gestureHistory.length; i++) {
    const g = state.gestureHistory[i];
    const weight = i + 1; // newer = heavier
    counts[g] = (counts[g] || 0) + weight;
    if (counts[g] > maxCount) {
      maxCount = counts[g];
      dominant = g;
    }
  }

  // Track how long the dominant gesture has been stable
  if (state.gestureCandidate === dominant) {
    state.gestureCandidateFrames++;
  } else {
    state.gestureCandidate = dominant;
    state.gestureCandidateFrames = 1;
  }

  // Hysteresis: harder to switch away from current gesture
  const required = (state.stableGesture === dominant) ? 2 : GESTURE_STABLE_FRAMES;
  if (state.gestureCandidateFrames >= required) {
    state.stableGesture = dominant;
  }

  return state.stableGesture;
}

// ─────────────────────────────────────────────────────────────────
// 5. OUTLIER REJECTION
// ─────────────────────────────────────────────────────────────────

/**
 * Check if the current landmarks are a sudden jump (outlier/jitter).
 * If the index finger tip moved >25% of the frame in one step,
 * it's probably noise — not real hand movement.
 */
export function isLandmarkOutlier(lm) {
  if (state.landmarkHistory.length < 2) return false;

  const tip = lm[8]; // index finger tip
  let sumDist = 0;
  for (const prev of state.landmarkHistory) {
    sumDist += Math.hypot(tip.x - prev[8].x, tip.y - prev[8].y);
  }
  return (sumDist / state.landmarkHistory.length) > 0.25;
}

/** Add a landmark frame to the history buffer. */
export function addToLandmarkHistory(lm) {
  state.landmarkHistory.push(lm);
  if (state.landmarkHistory.length > LANDMARK_HISTORY_SIZE) {
    state.landmarkHistory.shift();
  }
}

// ─────────────────────────────────────────────────────────────────
// 6. ACTION RESOLVER
// ─────────────────────────────────────────────────────────────────

/**
 * Convert a gesture into a pointer action.
 * If eraser mode is ON, DRAW gesture becomes ERASE.
 */
export function resolvePointerAction(gesture) {
  if (gesture === "ERASE") return "ERASE";
  if (gesture === "DRAW")  return state.eraserMode ? "ERASE" : "DRAW";
  if (gesture === "LIFT")  return "LIFT";
  if (gesture === "PAN")   return "PAN";
  return "IDLE";
}
