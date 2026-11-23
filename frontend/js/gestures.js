// ═══════════════════════════════════════════════════════════════════
// GESTURES — Detect hand gestures from MediaPipe landmarks.
//
// Gesture mapping:
//   DRAW  = only index finger up          → draw on canvas
//   LIFT  = index + middle up             → lift pen (break stroke)
//   PAN   = index + middle + ring up      → pan/scroll canvas
//   ERASE = full fist or index/middle tip pinch → erase ink
//   IDLE  = anything else                 → do nothing
//
// The detection uses multi-frame averaging and temporal smoothing
// to prevent accidental gesture switches.
// ═══════════════════════════════════════════════════════════════════

import {
  FINGER_THRESHOLD,
  FINGER_RELEASE_THRESHOLD,
  FINGER_HISTORY_SIZE,
  GESTURE_HISTORY_SIZE,
  GESTURE_STABLE_FRAMES,
  LANDMARK_HISTORY_SIZE,
  state,
} from "./config.js?v=2";

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
  const current = pairs.map(([tip, pip], index) => {
    const extension = lm[pip].y - lm[tip].y;
    const wasUp = state.fingerStates[index];
    const isUp = extension > (wasUp ? FINGER_RELEASE_THRESHOLD : FINGER_THRESHOLD);
    state.fingerStates[index] = isUp;
    return isUp;
  });

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

/** Erase pinch with separate enter/release thresholds to suppress flicker. */
function isIndexMiddlePinch(lm, indexUp, middleUp, ringUp, pinkyUp) {
  const palmWidth = Math.hypot(lm[5].x - lm[17].x, lm[5].y - lm[17].y);
  if (palmWidth < 0.025 || !indexUp || !middleUp) {
    state.rightPinchActive = false;
    return false;
  }
  const fingertipGap = Math.hypot(lm[8].x - lm[12].x, lm[8].y - lm[12].y);
  if (state.rightPinchActive) {
    if (fingertipGap > palmWidth * 0.56 || (ringUp && pinkyUp)) {
      state.rightPinchActive = false;
    }
  } else if (!ringUp && !pinkyUp && fingertipGap <= palmWidth * 0.4) {
    state.rightPinchActive = true;
  }
  return state.rightPinchActive;
}

/** Right-hand thumbs-up: one-shot command to clean the most recent stroke. */
function isRightThumbsUp(lm) {
  const pairs = [[8, 6], [12, 10], [16, 14], [20, 18]];
  const fingersFolded = pairs.every(([tip, pip]) => lm[tip].y >= lm[pip].y - 0.005);
  const palmWidth = Math.hypot(lm[5].x - lm[17].x, lm[5].y - lm[17].y);
  const thumbExtension = Math.hypot(lm[4].x - lm[5].x, lm[4].y - lm[5].y);
  const thumbPointsUp = lm[2].y - lm[4].y > Math.max(0.035, palmWidth * 0.28);
  const thumbIsExtended = thumbExtension > Math.max(0.065, palmWidth * 0.36);
  return fingersFolded && thumbPointsUp && thumbIsExtended;
}

// ─────────────────────────────────────────────────────────────────
// 3. GESTURE CLASSIFICATION
// ─────────────────────────────────────────────────────────────────

/**
 * Classify the current hand posture into a gesture.
 * @param {Array} lm - MediaPipe landmarks
 * @returns {string} "DRAW" | "LIFT" | "PAN" | "ERASE" | "SHAPE_ASSIST" | "IDLE"
 */
export function classifyGesture(lm) {
  const [idx, mid, rng, pky] = fingersUp(lm);

  if (isFullFist(lm))                    return "ERASE";
  if (isRightThumbsUp(lm))               return "SHAPE_ASSIST";
  if (isIndexMiddlePinch(lm, idx, mid, rng, pky)) return "ERASE";
  if (idx && mid && rng && !pky)         return "PAN";
  if (idx && mid && !rng && !pky)        return "LIFT";
  if (idx && !mid && !rng && !pky)       return "DRAW";
  return "IDLE";
}

/** Classify left-hand sentence controls without touching right-hand history. */
export function classifyLeftControlGesture(lm) {
  const fingerJoints = [[8, 6, 5], [12, 10, 9], [16, 14, 13], [20, 18, 17]];
  const fingers = fingerJoints.map(([tip, pip, mcp], index) => {
    const wasUp = state.leftFingerStates[index];
    const proximalX = lm[mcp].x - lm[pip].x;
    const proximalY = lm[mcp].y - lm[pip].y;
    const distalX = lm[tip].x - lm[pip].x;
    const distalY = lm[tip].y - lm[pip].y;
    const proximalLength = Math.hypot(proximalX, proximalY);
    const distalLength = Math.hypot(distalX, distalY);
    const cosine = (proximalX * distalX + proximalY * distalY)
      / Math.max(proximalLength * distalLength, 0.0001);
    const fingerRatio = Math.hypot(lm[tip].x - lm[mcp].x, lm[tip].y - lm[mcp].y)
      / Math.max(proximalLength, 0.001);
    const palmX = lm[9].x - lm[0].x;
    const palmY = lm[9].y - lm[0].y;
    const palmLength = Math.max(Math.hypot(palmX, palmY), 0.001);
    const forward = ((lm[tip].x - lm[mcp].x) * palmX + (lm[tip].y - lm[mcp].y) * palmY) / palmLength;
    const verticalUp = lm[pip].y - lm[tip].y
      > (wasUp ? FINGER_RELEASE_THRESHOLD : FINGER_THRESHOLD);
    const straight = cosine < (wasUp ? -0.15 : -0.35);
    const lengthUp = fingerRatio > (wasUp ? 1.12 : 1.24)
      && forward > proximalLength * 0.12;
    const isUp = straight && (lengthUp || verticalUp);
    state.leftFingerStates[index] = isUp;
    return isUp;
  });
  const raised = fingers.filter(Boolean).length;
  const palmWidth = Math.hypot(lm[5].x - lm[17].x, lm[5].y - lm[17].y);
  const thumbExtension = Math.hypot(lm[4].x - lm[5].x, lm[4].y - lm[5].y);
  const thumbOpen = thumbExtension > Math.max(state.leftThumbOpen ? 0.065 : 0.08, palmWidth * (state.leftThumbOpen ? 0.36 : 0.44));
  state.leftThumbOpen = thumbOpen;

  if (raised === 0 && !thumbOpen) return "CLEAR_SPELL_SELECTION";
  if (raised === 0 && thumbOpen) {
    const thumbVertical = lm[2].y - lm[4].y;
    const thumbDirectionThreshold = Math.max(0.035, palmWidth * 0.28);
    if (thumbVertical > thumbDirectionThreshold) return "COMMIT_WORD";
    if (thumbVertical < -thumbDirectionThreshold) return "POP_WORD";
  }

  // Thumb extended with one or two raised fingers controls canvas history.
  // Check these before numbered choices so the explicit thumb pose wins.
  if (thumbOpen && raised === 1 && fingers[0]) return "UNDO_CANVAS";
  if (thumbOpen && raised === 2 && fingers[0] && fingers[1]) return "REDO_CANVAS";

  // Number gestures are deliberately progressive: index, index+middle,
  // index+middle+ring, then all four fingers. Thumb position is ignored here
  // because users naturally hold it at different angles for the four pose.
  if (raised >= 1 && raised <= 4 && fingers.slice(0, raised).every(Boolean)
      && fingers.slice(raised).every((isUp) => !isUp)) {
    return `SELECT_${raised}`;
  }
  return "IDLE";
}

/** Smooth noisy left-hand control classifications over a short frame window. */
export function updateStableLeftControlGesture(nextGesture) {
  state.leftGestureHistory.push(nextGesture);
  if (state.leftGestureHistory.length > 7) state.leftGestureHistory.shift();

  const counts = new Map();
  for (const gesture of state.leftGestureHistory) {
    counts.set(gesture, (counts.get(gesture) || 0) + 1);
  }

  let dominant = "IDLE";
  let dominantCount = 0;
  for (const [gesture, count] of counts) {
    if (count > dominantCount) {
      dominant = gesture;
      dominantCount = count;
    }
  }

  // Require four matching frames in the rolling window before switching.
  // This ignores brief landmark glitches without making deliberate changes slow.
  if (dominantCount >= 4) state.leftStableGesture = dominant;
  return state.leftStableGesture;
}

/** Require a nearly straight index finger before ink can be laid down. */
export function isIndexClearlyExtended(lm) {
  const mcp = lm[5];
  const pip = lm[6];
  const tip = lm[8];
  const ax = mcp.x - pip.x;
  const ay = mcp.y - pip.y;
  const bx = tip.x - pip.x;
  const by = tip.y - pip.y;
  const aLength = Math.hypot(ax, ay);
  const bLength = Math.hypot(bx, by);
  if (aLength < 0.025 || bLength < 0.025) return false;
  const cosine = (ax * bx + ay * by) / (aLength * bLength);
  return cosine < -0.82; // angle greater than about 145 degrees at the PIP joint
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
  if (gesture === "SHAPE_ASSIST") return "SHAPE_ASSIST";
  if (gesture === "DRAW")  return state.eraserMode ? "ERASE" : "DRAW";
  if (gesture === "LIFT")  return "LIFT";
  if (gesture === "PAN")   return "PAN";
  return "IDLE";
}
