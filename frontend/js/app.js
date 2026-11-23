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
} from "./config.js?v=2";

import { PointFilter } from "./pointer-filter.js";
import { drawCleanShape, maskCleanShape, recognizeCleanShape } from "./shape-assist.js?v=5";

import {
  classifyGesture, updateStableGesture,
  classifyLeftControlGesture, updateStableLeftControlGesture,
  isLandmarkOutlier, addToLandmarkHistory, isIndexClearlyExtended,
  resolvePointerAction,
} from "./gestures.js?v=3";

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
const spellStatus = document.getElementById("spell-status");
const spellSuggestion = document.getElementById("spell-suggestion");
const spellSuggestionRow = document.getElementById("spell-suggestion-row");
const spellCaption = document.getElementById("spell-caption");
const spellCorrectedText = document.getElementById("spell-corrected-text");
const spellCorrectionList = document.getElementById("spell-correction-list");
const spellActions = document.getElementById("spell-actions");
const spellFeedback = document.getElementById("spell-feedback");
const acceptCorrectionBtn = document.getElementById("btn-accept-correction");
const keepOriginalBtn = document.getElementById("btn-keep-original");
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
const sentenceTextEl = document.getElementById("sentence-text");
const sentenceHintEl = document.getElementById("sentence-hint");
const nextWordPanel = document.getElementById("next-word-panel");
const nextWordStatus = document.getElementById("next-word-status");
const nextWordOptions = document.getElementById("next-word-options");
const commitWordBtn = document.getElementById("btn-commit-word");
const popWordBtn = document.getElementById("btn-pop-word");
const clearSentenceBtn = document.getElementById("btn-clear-sentence");

// Pointer smoother (reduces hand tracking jitter)
const pointerFilter = new PointFilter();
let operationNoticeTimer = null;
let operationNoticeId = 0;
let activeStrokePoints = [];
let activeStrokeBaseImage = null;
let activeStrokeColor = null;
let activeStrokeBrushSize = 0;
let latestCompletedStroke = null;
let shapeCleanupInProgress = false;
let cleanedShapeRegions = [];
let shapeUndoStack = [];
let shapeRedoStack = [];
let currentOcrRawText = "";
let currentOcrSuggestedText = "";
let currentOcrIsContinuous = false;
let currentOcrCanCommit = false;
let nextWordSuggestions = [];
let selectedNextWordIndex = -1;
let nextWordRequestId = 0;
let nextWordTimeoutId = null;
const nextWordCache = new Map();
let lastRightPointerAction = "IDLE";
let waitForRightDrawRearm = false;


// ═══════════════════════════════════════════════════════════════════
// 2. HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function hideSpellSuggestions() {
  spellStatus.hidden = true;
  spellStatus.textContent = "";
  spellSuggestion.hidden = true;
  spellActions.hidden = true;
  spellCorrectionList.replaceChildren();
  spellFeedback.textContent = "";
}

function cancelOperationNotification() {
  operationNoticeId++;
  if (operationNoticeTimer !== null) {
    window.clearTimeout(operationNoticeTimer);
    operationNoticeTimer = null;
  }
}

function showOperationNotification(message, restoreText = "") {
  cancelOperationNotification();
  const noticeId = operationNoticeId;
  ocrText.textContent = message;
  ocrBar.style.display = "flex";
  operationNoticeTimer = window.setTimeout(() => {
    if (noticeId !== operationNoticeId || ocrText.textContent !== message) return;
    ocrText.textContent = restoreText;
    if (!restoreText && spellSuggestion.hidden && spellActions.hidden) {
      ocrBar.style.display = "none";
    }
    operationNoticeTimer = null;
  }, 5000);
}

function showOcrResult(rawText, suggestedText = rawText, corrections = [], continuous = false, spellcheckAvailable = null, canCommit = true, llmSpellcheckStatus = null) {
  cancelOperationNotification();
  dismissNextWordSuggestions();
  currentOcrRawText = rawText;
  currentOcrSuggestedText = suggestedText || rawText;
  currentOcrIsContinuous = continuous;
  currentOcrCanCommit = canCommit;
  updateAddWordButton();
  ocrText.textContent = rawText;
  spellCorrectedText.textContent = currentOcrSuggestedText;
  spellCorrectionList.replaceChildren();
  spellFeedback.textContent = "";

  const hasSuggestion = currentOcrSuggestedText !== rawText;
  const hasCandidates = corrections.some((correction) => (correction.candidates || []).length > 0);
  spellSuggestion.hidden = !hasSuggestion && !hasCandidates;
  spellSuggestionRow.hidden = !hasSuggestion;
  spellActions.hidden = !hasSuggestion && !hasCandidates;
  const llmNeedsSetupNotice = llmSpellcheckStatus === "not_configured" || llmSpellcheckStatus === "unavailable";
  spellStatus.hidden = (hasSuggestion || hasCandidates) && !llmNeedsSetupNotice;
  spellCaption.textContent = hasSuggestion ? "Suggestion" : "Alternatives";
  acceptCorrectionBtn.textContent = hasSuggestion ? "Use suggestion" : "Use selected word";
  keepOriginalBtn.textContent = hasSuggestion ? "Keep original" : "Keep recognized";
  if (llmSpellcheckStatus === "not_configured") {
    spellStatus.textContent = "Local spell check ran. Add OPENAI_API_KEY to the backend to enable AI suggestions.";
  } else if (llmSpellcheckStatus === "unavailable") {
    spellStatus.textContent = "AI suggestions are temporarily unavailable; local spell check is still active.";
  } else if (spellcheckAvailable === true) {
    spellStatus.textContent = "Spell check ran: no safe suggestions for this text.";
  } else if (spellcheckAvailable === false) {
    spellStatus.textContent = "Spell checker unavailable — install backend requirements.";
  } else {
    spellStatus.textContent = "Spell check status unavailable — restart the backend from the spellchecker branch.";
  }

  for (const correction of corrections) {
    const item = document.createElement("div");
    item.className = "spell-correction-item";
    const words = document.createElement("span");
    words.textContent = `${correction.original} →`;
    item.appendChild(words);

    let selectedSuggestion = correction.suggestion;
    for (const [candidateIndex, candidate] of (correction.candidates || [correction.suggestion]).entries()) {
      const candidateBtn = document.createElement("button");
      candidateBtn.type = "button";
      candidateBtn.className = "spell-candidate-btn";
      candidateBtn.dataset.candidateIndex = String(candidateIndex + 1);
      candidateBtn.textContent = `${candidateIndex + 1} · ${candidate}`;
      candidateBtn.setAttribute("aria-pressed", String(candidate === selectedSuggestion));
      candidateBtn.addEventListener("click", () => {
        currentOcrSuggestedText = currentOcrRawText.replace(correction.original, candidate);
        selectedSuggestion = candidate;
        spellCorrectedText.textContent = currentOcrSuggestedText;
        spellSuggestionRow.hidden = false;
        spellCaption.textContent = "Selected";
        acceptCorrectionBtn.textContent = "Use selected word";
        item.querySelectorAll(".spell-candidate-btn").forEach((button) => {
          button.setAttribute("aria-pressed", String(button === candidateBtn));
        });
        sentenceHintEl.textContent = `Selected “${candidate}”. Left thumbs up adds it; thumbs down removes the last sentence word.`;
      });
      item.appendChild(candidateBtn);
    }

    if (correction.suggestion === correction.original) {
      spellCorrectionList.appendChild(item);
      continue;
    }

    const rememberBtn = document.createElement("button");
    rememberBtn.type = "button";
    rememberBtn.className = "remember-word-btn";
    rememberBtn.textContent = "Remember original";
    rememberBtn.dataset.word = correction.original.toLocaleLowerCase();
    rememberBtn.addEventListener("click", () => {
      if (!state.wsReady || !state.ws || state.ws.readyState !== WebSocket.OPEN) {
        spellFeedback.textContent = "Backend is offline; word was not saved.";
        return;
      }
      rememberBtn.disabled = true;
      rememberBtn.textContent = "Saving…";
      state.ws.send(JSON.stringify({ type: "add_word", word: correction.original }));
    });
    item.appendChild(rememberBtn);
    spellCorrectionList.appendChild(item);
  }
  ocrBar.style.display = "flex";
}

acceptCorrectionBtn.onclick = () => {
  ocrText.textContent = currentOcrSuggestedText;
  if (currentOcrIsContinuous) {
    state.continuousTextBuffer = currentOcrSuggestedText;
    state.continuousSuggestedBuffer = currentOcrSuggestedText;
  }
  hideSpellSuggestions();
};

keepOriginalBtn.onclick = () => {
  currentOcrSuggestedText = currentOcrRawText;
  spellCorrectedText.textContent = currentOcrRawText;
  if (currentOcrIsContinuous) {
    state.continuousSuggestedBuffer = state.continuousTextBuffer;
  }
  hideSpellSuggestions();
};

function renderSentence() {
  sentenceTextEl.textContent = state.sentenceWords.length
    ? state.sentenceWords.join(" ")
    : "Your sentence will appear here";
  popWordBtn.disabled = state.sentenceWords.length === 0;
}

function updateAddWordButton() {
  const canAddPrediction = !currentOcrCanCommit && selectedNextWordIndex >= 0
    && selectedNextWordIndex < nextWordSuggestions.length;
  commitWordBtn.disabled = !currentOcrCanCommit && !canAddPrediction;
  commitWordBtn.textContent = canAddPrediction ? "＋ Add next word" : "＋ Add word";
}

function dismissNextWordSuggestions() {
  nextWordRequestId++;
  if (nextWordTimeoutId !== null) {
    window.clearTimeout(nextWordTimeoutId);
    nextWordTimeoutId = null;
  }
  nextWordSuggestions = [];
  selectedNextWordIndex = -1;
  nextWordPanel.hidden = true;
  nextWordOptions.replaceChildren();
  nextWordStatus.textContent = "";
  updateAddWordButton();
}

function quickNextWordSuggestions(sentenceWords) {
  const words = sentenceWords.map((word) => word.toLocaleLowerCase());
  const last = words.at(-1) || "";
  const previous = words.at(-2) || "";
  const lastTwo = words.slice(-2).join(" ");

  // Conjunctions start a new clause or join another item. Predict from that
  // grammatical position instead of repeating generic choices from the
  // sentence's first word (for example, "I have and" needs a clause subject).
  if (last === "and") return ["I", "the", "a", "we"];
  if (last === "but") return ["I", "it", "we", "they"];
  if (last === "because") return ["I", "it", "we", "the"];
  if (["have", "has", "had"].includes(last)) return ["a", "the", "been", "to"];
  if (["will", "can", "could", "should", "would", "must"].includes(last)) {
    return ["go", "make", "help", "learn"];
  }
  if (["do", "does", "did"].includes(last)) return ["not", "you", "this", "it"];
  if (last === "been") return ["working", "waiting", "there", "a"];
  if (["am", "is", "are", "was", "were", "be", "been"].includes(last)) {
    return ["happy", "ready", "going", "learning"];
  }
  if (["i", "we", "you", "they"].includes(last)) {
    return last === "i" ? ["am", "will", "can", "like"] : ["are", "will", "can", "like"];
  }
  if (["he", "she", "it"].includes(last)) return ["is", "will", "can", "has"];
  if (["a", "an", "the"].includes(last)) return ["good", "new", "small", "beautiful"];
  if (["in", "on", "at", "from", "with", "to", "for"].includes(last)) return ["the", "my", "this", "school"];
  if (lastTwo === "i am" || (previous === "am" && words.length === 2)) {
    return ["happy", "going", "learning", "working"];
  }
  if (words.length >= 3 && words[0] === "i" && words[1] === "am") return ["from", "and", "a", "who"];
  if (words.length >= 2 && ["i", "you", "we", "they", "he", "she", "it"].includes(words[0])) {
    return ["and", "because", "but", "today"];
  }
  return ["and", "the", "is", "to"];
}

function renderNextWordOptions(words) {
  nextWordSuggestions = words.slice(0, 4);
  selectedNextWordIndex = -1;
  nextWordOptions.replaceChildren();
  nextWordSuggestions.forEach((word, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "next-word-option";
    button.textContent = `${index + 1} · ${word}`;
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => selectNextWordOption(index));
    nextWordOptions.appendChild(button);
  });
  updateAddWordButton();
}

function selectNextWordOption(index) {
  if (index < 0 || index >= nextWordSuggestions.length) return false;
  selectedNextWordIndex = index;
  nextWordOptions.querySelectorAll(".next-word-option").forEach((button, buttonIndex) => {
    button.setAttribute("aria-pressed", String(buttonIndex === index));
  });
  updateAddWordButton();
  sentenceHintEl.textContent = `Selected “${nextWordSuggestions[index]}”. Left thumbs up appends it to the sentence.`;
  return true;
}

function requestNextWordSuggestions() {
  if (!state.sentenceWords.length) {
    dismissNextWordSuggestions();
    return;
  }
  const requestId = ++nextWordRequestId;
  if (nextWordTimeoutId !== null) window.clearTimeout(nextWordTimeoutId);
  nextWordPanel.hidden = false;
  const context = state.sentenceWords.join(" ");
  const cached = nextWordCache.get(context);
  if (cached?.length) {
    renderNextWordOptions(cached);
    nextWordStatus.textContent = "Choose with left hand 1–4, then thumbs up to append:";
  } else {
    renderNextWordOptions(quickNextWordSuggestions(state.sentenceWords));
    nextWordStatus.textContent = "Quick suggestions · asking AI for more context-aware choices…";
  }
  sentenceHintEl.textContent = "Left hand: 1–4 chooses a next word · thumbs up appends it · thumbs down removes the last word.";
  if (!state.wsReady || !state.ws || state.ws.readyState !== WebSocket.OPEN) {
    if (cached?.length) return;
    nextWordStatus.textContent = "Showing quick suggestions; backend is offline.";
    return;
  }
  try {
    state.ws.send(JSON.stringify({ type: "next_word_suggestions", request_id: requestId, sentence: context }));
    nextWordTimeoutId = window.setTimeout(() => {
      if (requestId !== nextWordRequestId) return;
      nextWordTimeoutId = null;
      nextWordStatus.textContent = nextWordSuggestions.length
        ? "Quick suggestions are ready; AI did not respond. Restart the backend if this keeps happening."
        : "No suggestions returned. Check the backend connection and API key.";
    }, 7000);
  } catch (_error) {
    nextWordStatus.textContent = "Showing quick suggestions; the backend request failed.";
  }
}

function showNextWordSuggestions(message) {
  if (message.request_id !== nextWordRequestId) return;
  if (nextWordTimeoutId !== null) {
    window.clearTimeout(nextWordTimeoutId);
    nextWordTimeoutId = null;
  }
  const received = (message.suggestions || []).filter((word) => typeof word === "string").slice(0, 4);
  if (selectedNextWordIndex >= 0) {
    nextWordStatus.textContent = "Your selection is kept; AI suggestions are ready for the next word.";
    return;
  }
  nextWordPanel.hidden = false;
  if (received.length) {
    nextWordCache.set(state.sentenceWords.join(" "), received);
    renderNextWordOptions(received);
    nextWordStatus.textContent = "Choose with left hand 1–4, then thumbs up to append:";
    sentenceHintEl.textContent = "Left hand: 1–4 chooses a next word · thumbs up appends it · thumbs down removes the last word.";
  } else if (message.status === "not_configured") {
    nextWordStatus.textContent = nextWordSuggestions.length
      ? "Showing quick suggestions; OPENAI_API_KEY is not configured for AI prediction."
      : "Set OPENAI_API_KEY in the backend to enable AI prediction.";
  } else if (message.status === "unavailable") {
    nextWordStatus.textContent = nextWordSuggestions.length
      ? "Showing quick suggestions; AI prediction is temporarily unavailable."
      : "Next-word prediction is temporarily unavailable.";
  } else {
    nextWordStatus.textContent = nextWordSuggestions.length
      ? "Showing quick suggestions; the AI returned no choices."
      : "No next-word suggestions were returned.";
  }
  updateAddWordButton();
}

function appendSelectedNextWord() {
  if (selectedNextWordIndex < 0 || selectedNextWordIndex >= nextWordSuggestions.length) return false;
  const word = nextWordSuggestions[selectedNextWordIndex];
  state.sentenceWords.push(word);
  renderSentence();
  dismissNextWordSuggestions();
  clearDrawingForNextWord();
  showOperationNotification(`Added “${word}” from next-word suggestions.`);
  sentenceHintEl.textContent = "Added predicted word. Choose another suggestion or draw the next word.";
  requestNextWordSuggestions();
  return true;
}

function clearDrawingForNextWord() {
  dCtx.clearRect(0, 0, VIRTUAL_W, VIRTUAL_H);
  cleanedShapeRegions = [];
  discardShapeAssistStroke();
  state.continuousTextBuffer = "";
  state.continuousSuggestedBuffer = "";
  state.lastDrawT = 0;
  state.lastOcrT = Date.now() / 1000;
  currentOcrCanCommit = false;
  commitWordBtn.disabled = true;
  hideSpellSuggestions();
  // Keep the right-hand gesture classifier stable through the left-hand
  // commit gesture, but discard the current stroke and pointer smoothing.
  // Require a deliberate pen-up/other action before drawing the next word,
  // otherwise the held drawing pose can leave a stray mark after the clear.
  state.prevX = null;
  state.prevY = null;
  reacquireIndexTipPointer();
  state.landmarkHistory = [];
  state.panStartX = null;
  state.panStartY = null;
  state.activeCanvasAction = "IDLE";
  waitForRightDrawRearm = true;
}

function commitCurrentWord() {
  if (!currentOcrCanCommit) {
    if (appendSelectedNextWord()) return true;
    sentenceHintEl.textContent = "Write a word and wait for OCR before committing it.";
    return false;
  }

  const selectedText = (currentOcrSuggestedText || currentOcrRawText).trim();
  const words = selectedText.split(/\s+/).filter(Boolean);
  if (!words.length) return false;

  pushUndoSnapshot();
  state.sentenceWords.push(...words);
  renderSentence();
  clearDrawingForNextWord();
  showOperationNotification(`Added “${words.join(" ")}”. Write the next word.`);
  sentenceHintEl.textContent = `Added ${words.length === 1 ? "word" : "words"}. Lift your right index+middle fingers, then draw the next word.`;
  requestNextWordSuggestions();
  return true;
}

function popLastSentenceWord() {
  const removed = state.sentenceWords.pop();
  renderSentence();
  if (removed) {
    showOperationNotification(`Removed “${removed}” from the sentence.`, spellSuggestion.hidden ? "" : currentOcrRawText);
    sentenceHintEl.textContent = `Removed “${removed}” from the sentence.`;
    requestNextWordSuggestions();
    return true;
  }
  sentenceHintEl.textContent = "There is no sentence word to remove yet.";
  return false;
}

function chooseSpellCandidate(index) {
  if (!nextWordPanel.hidden && nextWordSuggestions.length) {
    if (selectNextWordOption(index - 1)) return true;
  }
  if (!currentOcrCanCommit || spellSuggestion.hidden) return false;
  const firstCorrection = spellCorrectionList.querySelector(".spell-correction-item");
  const candidate = firstCorrection?.querySelector(`[data-candidate-index="${index}"]`);
  if (!candidate) {
    sentenceHintEl.textContent = `There is no spelling choice ${index} for this result.`;
    return false;
  }
  candidate.click();
  return true;
}

function clearSpellSelection() {
  if (selectedNextWordIndex >= 0) {
    selectedNextWordIndex = -1;
    nextWordOptions.querySelectorAll(".next-word-option").forEach((button) => button.setAttribute("aria-pressed", "false"));
    nextWordStatus.textContent = "Selection cleared. Choose a next word with left hand 1–4.";
    updateAddWordButton();
    sentenceHintEl.textContent = "Next-word choice cleared. Use left hand 1–4 to choose again.";
    return true;
  }
  if (!currentOcrCanCommit || !spellCorrectionList.querySelector(".spell-candidate-btn[aria-pressed='true']")) {
    sentenceHintEl.textContent = "There is no selected spelling option to clear.";
    return false;
  }

  currentOcrSuggestedText = currentOcrRawText;
  spellCorrectedText.textContent = currentOcrRawText;
  spellSuggestionRow.hidden = true;
  spellCaption.textContent = "Alternatives";
  spellCorrectionList.querySelectorAll(".spell-candidate-btn").forEach((button) => {
    button.setAttribute("aria-pressed", "false");
  });
  sentenceHintEl.textContent = "Spelling choice cleared. Choose 1–4 again, use thumbs up to add, or thumbs down to remove the last word.";
  return true;
}

async function handleLeftControlGesture(landmarks, nowMs) {
  const rawGesture = classifyLeftControlGesture(landmarks);
  const gesture = updateStableLeftControlGesture(rawGesture);
  if (gesture !== state.leftGestureCandidate) {
    state.leftGestureCandidate = gesture;
    state.leftGestureSince = nowMs;
    state.leftGestureConsumed = false;
  }
  if (gesture === "IDLE" || state.leftGestureConsumed || nowMs - state.leftGestureSince < 650) return;

  state.leftGestureConsumed = true;
  state.lastLeftGesture = gesture;
  if (gesture.startsWith("SELECT_")) {
    const index = Number(gesture.slice("SELECT_".length));
    if (chooseSpellCandidate(index)) sentenceHintEl.textContent = `Left hand selected option ${index}. Use thumbs up to add the word.`;
  } else if (gesture === "COMMIT_WORD") {
    commitCurrentWord();
  } else if (gesture === "POP_WORD") {
    popLastSentenceWord();
  } else if (gesture === "CLEAR_SPELL_SELECTION") {
    clearSpellSelection();
  } else if (gesture === "UNDO_CANVAS") {
    await undoLastAction();
    sentenceHintEl.textContent = "Canvas undo performed with left thumb + index.";
  } else if (gesture === "REDO_CANVAS") {
    await redoLastAction();
    sentenceHintEl.textContent = "Canvas redo performed with left thumb + index + middle.";
  }
}

/** Update the mode label in the toolbar. */
function setMode(m) {
  state.mode = m;
  const map = {
    DRAW:  { text: "● DRAWING",  color: "#00dd55" },
    ERASE: { text: "◌ ERASING",  color: "#2255ff" },
    LIFT:  { text: "✦ PEN UP",   color: "#00cccc" },
    PAN:   { text: "✊ PANNING",  color: "#ffaa00" },
    SHAPE_ASSIST: { text: "✦ SHAPE ASSIST", color: "#5eead4" },
    IDLE:  { text: "◌ READY",    color: "#555"    },
  };
  const entry = map[m] || map.IDLE;
  modeLabel.textContent = entry.text;
  modeLabel.style.color = entry.color;
}

/** Reset all stroke and gesture tracking state. */
function resetStrokeState() {
  finalizeShapeAssistStroke();
  state.prevX = null;
  state.prevY = null;
  reacquireIndexTipPointer();
  state.stableGesture = "IDLE";
  state.gestureCandidate = "IDLE";
  state.gestureCandidateFrames = 0;
  state.fingerHistory = [];
  state.fingerStates = [false, false, false, false];
  state.gestureHistory = [];
  state.landmarkHistory = [];
  state.activeCanvasAction = "IDLE";
  lastRightPointerAction = "IDLE";
}

/** Break the current stroke (next draw will start a new line). */
function breakStrokePath() {
  finalizeShapeAssistStroke();
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
function pushUndoSnapshot(snapshot = null) {
  try {
    const dataUrl = snapshot || drawCanvas.toDataURL("image/png");
    state.undoStack.push(dataUrl);
    shapeUndoStack.push(cleanedShapeRegions.map((item) => ({
      shape: JSON.parse(JSON.stringify(item.shape)),
      brushSize: item.brushSize,
    })));
    if (state.undoStack.length > MAX_UNDO_STEPS) {
      state.undoStack.shift();
      shapeUndoStack.shift();
    }
    state.redoStack = [];
    shapeRedoStack = [];
    return dataUrl;
  } catch (e) {
    console.warn("Could not save undo snapshot:", e);
    return null;
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

function finalizeShapeAssistStroke() {
  if (activeStrokePoints.length >= 2 && activeStrokeBaseImage) {
    latestCompletedStroke = {
      points: activeStrokePoints,
      baseImage: activeStrokeBaseImage,
      color: activeStrokeColor || [...COLORS[state.colorIdx].rgb],
      brushSize: activeStrokeBrushSize || state.brushSize,
    };
  }
  activeStrokePoints = [];
  activeStrokeBaseImage = null;
  activeStrokeColor = null;
  activeStrokeBrushSize = 0;
}

function discardShapeAssistStroke() {
  activeStrokePoints = [];
  activeStrokeBaseImage = null;
  activeStrokeColor = null;
  activeStrokeBrushSize = 0;
  latestCompletedStroke = null;
}

async function cleanLatestShape() {
  const stroke = latestCompletedStroke;
  if (!stroke) {
    showOperationNotification("Draw a simple shape, then use Shape Assist to clean it.");
    return;
  }
  const shape = recognizeCleanShape(stroke.points, stroke.brushSize);
  if (!shape) {
    showOperationNotification("Shape not recognized. Close the outline and try a slower, steady stroke.");
    return;
  }
  if (!stroke.baseImage) {
    showOperationNotification("Could not prepare the shape for cleanup.");
    return;
  }

  shapeCleanupInProgress = true;
  latestCompletedStroke = null;
  pushUndoSnapshot();
  try {
    await restoreCanvasFromDataUrl(stroke.baseImage);
    drawCleanShape(dCtx, shape, stroke.color, stroke.brushSize);
    cleanedShapeRegions.push({ shape, brushSize: stroke.brushSize });
    state.activeCanvasAction = "IDLE";
    showOperationNotification(`Cleaned ${shape.type}.`);
  } catch (error) {
    console.error("Shape assist failed:", error);
    showOperationNotification("Could not clean that shape. The original was kept.");
  } finally {
    shapeCleanupInProgress = false;
  }
}

/** Undo the last drawing action. */
async function undoLastAction() {
  if (shapeCleanupInProgress) return;
  if (!state.undoStack.length) {
    modeLabel.textContent = "NOTHING TO UNDO";
    modeLabel.style.color = "#ffcc66";
    return;
  }
  try {
    state.redoStack.push(drawCanvas.toDataURL("image/png"));
    shapeRedoStack.push(cleanedShapeRegions.map((item) => ({
      shape: JSON.parse(JSON.stringify(item.shape)),
      brushSize: item.brushSize,
    })));
    if (state.redoStack.length > MAX_UNDO_STEPS) {
      state.redoStack.shift();
      shapeRedoStack.shift();
    }
  } catch (e) { /* ignore */ }

  discardShapeAssistStroke();
  await restoreCanvasFromDataUrl(state.undoStack.pop());
  cleanedShapeRegions = shapeUndoStack.pop() || [];
  breakStrokePath();
  state.activeCanvasAction = "IDLE";
  setMode("IDLE");
}

/** Redo a previously undone action. */
async function redoLastAction() {
  if (shapeCleanupInProgress) return;
  if (!state.redoStack.length) {
    modeLabel.textContent = "NOTHING TO REDO";
    modeLabel.style.color = "#ffcc66";
    return;
  }
  try {
    state.undoStack.push(drawCanvas.toDataURL("image/png"));
    shapeUndoStack.push(cleanedShapeRegions.map((item) => ({
      shape: JSON.parse(JSON.stringify(item.shape)),
      brushSize: item.brushSize,
    })));
    if (state.undoStack.length > MAX_UNDO_STEPS) {
      state.undoStack.shift();
      shapeUndoStack.shift();
    }
  } catch (e) { /* ignore */ }

  discardShapeAssistStroke();
  await restoreCanvasFromDataUrl(state.redoStack.pop());
  cleanedShapeRegions = shapeRedoStack.pop() || [];
  breakStrokePath();
  state.activeCanvasAction = "IDLE";
  setMode("IDLE");
}

/** Track current action type for undo grouping. */
function beginCanvasAction(action, beforeActionSnapshot = null) {
  if (action !== "DRAW" && action !== "ERASE") {
    state.activeCanvasAction = action;
    return;
  }
  if (state.activeCanvasAction !== action) {
    pushUndoSnapshot(beforeActionSnapshot);
  }
  state.activeCanvasAction = action;
}

/** Draw a line/dot at the given screen position. */
function drawAtPoint(cx, cy, nowSec) {
  if (shapeCleanupInProgress) return;
  const startsStroke = state.prevX === null;
  if (startsStroke && (!nextWordPanel.hidden || currentOcrCanCommit)) {
    dismissNextWordSuggestions();
    currentOcrCanCommit = false;
    hideSpellSuggestions();
    updateAddWordButton();
  }
  const vx = cx + state.panX;
  const vy = cy + state.panY;
  let baseImage = null;
  if (startsStroke) {
    try { baseImage = drawCanvas.toDataURL("image/png"); } catch (_error) { /* cleanup is unavailable if snapshot fails */ }
  }
  beginCanvasAction("DRAW", baseImage);
  setMode("DRAW");

  // Convert screen coords → virtual canvas coords
  if (startsStroke) {
    activeStrokePoints = [{ x: vx, y: vy }];
    activeStrokeBaseImage = baseImage;
    activeStrokeColor = [...COLORS[state.colorIdx].rgb];
    activeStrokeBrushSize = state.brushSize;
    latestCompletedStroke = null;
  } else if (activeStrokePoints.length) {
    const lastPoint = activeStrokePoints[activeStrokePoints.length - 1];
    if (Math.hypot(vx - lastPoint.x, vy - lastPoint.y) >= 2) activeStrokePoints.push({ x: vx, y: vy });
  }

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
    if (activeStrokePoints.length) {
      const lastPoint = activeStrokePoints[activeStrokePoints.length - 1];
      if (Math.hypot(vx - lastPoint.x, vy - lastPoint.y) >= 2) activeStrokePoints.push({ x: vx, y: vy });
    }
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
  if (shapeCleanupInProgress) return;
  beginCanvasAction("ERASE");
  setMode("ERASE");
  breakStrokePath();
  latestCompletedStroke = null;
  activeStrokePoints = [];
  activeStrokeBaseImage = null;

  const vx = cx + state.panX;
  const vy = cy + state.panY;

  cleanedShapeRegions = cleanedShapeRegions.filter(({ shape }) => {
    let left; let right; let top; let bottom;
    if (shape.points?.length) {
      left = Math.min(...shape.points.map((point) => point.x));
      right = Math.max(...shape.points.map((point) => point.x));
      top = Math.min(...shape.points.map((point) => point.y));
      bottom = Math.max(...shape.points.map((point) => point.y));
    } else if (shape.type === "rectangle") {
      ({ left, top } = shape);
      right = left + shape.width;
      bottom = top + shape.height;
    } else if (shape.type === "ellipse" || shape.type === "dot") {
      const rx = shape.radiusX ?? shape.radius;
      const ry = shape.radiusY ?? shape.radius;
      left = shape.centerX - rx; right = shape.centerX + rx;
      top = shape.centerY - ry; bottom = shape.centerY + ry;
    } else if (shape.type === "line") {
      left = Math.min(shape.start.x, shape.end.x); right = Math.max(shape.start.x, shape.end.x);
      top = Math.min(shape.start.y, shape.end.y); bottom = Math.max(shape.start.y, shape.end.y);
    }
    return !(vx >= left - ERASER_RADIUS && vx <= right + ERASER_RADIUS
      && vy >= top - ERASER_RADIUS && vy <= bottom + ERASER_RADIUS);
  });

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

function maskCleanedShapesForOcr(ctx, offsetX = 0, offsetY = 0) {
  for (const item of cleanedShapeRegions) {
    maskCleanShape(ctx, item.shape, item.brushSize, offsetX, offsetY);
  }
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
  maskCleanedShapesForOcr(offCtx, state.panX, state.panY);
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
  maskCleanedShapesForOcr(offCtx, state.panX, state.panY);
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
  maskCleanedShapesForOcr(offCtx);
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
    currentOcrCanCommit = false;
    commitWordBtn.disabled = true;
    hideSpellSuggestions();
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
    currentOcrCanCommit = false;
    commitWordBtn.disabled = true;
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
    currentOcrCanCommit = false;
    commitWordBtn.disabled = true;
    state.inFlightContinuous = false;
    hideSpellSuggestions();
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
    currentOcrCanCommit = false;
    commitWordBtn.disabled = true;
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

      if (msg.type === "word_added") {
        document.querySelectorAll(".remember-word-btn").forEach((button) => {
          if (button.dataset.word === String(msg.word || "").toLocaleLowerCase()) {
            button.textContent = "Saved";
            button.disabled = true;
          }
        });
        spellFeedback.textContent = `Added “${msg.word}” to your word list.`;
      }

      if (msg.type === "word_add_error") {
        document.querySelectorAll(".remember-word-btn").forEach((button) => {
          if (button.dataset.word === String(msg.word || "").toLocaleLowerCase()) {
            button.disabled = false;
            button.textContent = "Remember original";
          }
        });
        spellFeedback.textContent = msg.message || "Could not save that word.";
      }

      if (msg.type === "next_word_suggestions") {
        showNextWordSuggestions(msg);
      }

      if (msg.type === "ocr_result") {
        state.ocrInFlight = false;
        if (msg.success && msg.text) {
          const rawSegment = msg.text;
          const suggestedSegment = msg.suggested_text || rawSegment;
          const wasContinuous = state.inFlightContinuous;
          let rawText = rawSegment;
          let suggestedText = suggestedSegment;
          if (state.inFlightContinuous) {
            state.continuousTextBuffer = (state.continuousTextBuffer + " " + rawSegment).trim();
            state.continuousSuggestedBuffer = (state.continuousSuggestedBuffer + " " + suggestedSegment).trim();
            rawText = state.continuousTextBuffer;
            suggestedText = state.continuousSuggestedBuffer;
            dCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
            cleanedShapeRegions = [];
            discardShapeAssistStroke();
            resetStrokeState();
          }
          showOcrResult(rawText, suggestedText, msg.corrections || [], wasContinuous, msg.spellcheck_available, true, msg.llm_spellcheck_status);
          state.inFlightContinuous = false;
        } else {
          const wasContinuous = state.inFlightContinuous;
          const failureText = wasContinuous
            ? state.continuousTextBuffer + " [Could not recognize]"
            : "Could not recognize — try writing larger";
          showOcrResult(failureText, failureText, [], wasContinuous, msg.spellcheck_available, false);
          state.inFlightContinuous = false;
        }
      }

      if (msg.type === "error") {
        state.ocrInFlight = false;
        state.inFlightContinuous = false;
        showOcrResult(msg.message || "OCR failed", "", [], false, msg.spellcheck_available, false);
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
      modelAssetPath: `${BACKEND_URL}/hand_landmarker.task`,
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numHands: 2,
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
  const loadingTitle = document.querySelector("#loading h2");
  const loadingMessage = document.querySelector("#loading p");
  loadingTitle.textContent = "Requesting camera access...";
  loadingMessage.textContent = "Choose Allow in the browser prompt. If no prompt appears, allow Camera in site settings, then refresh.";

  let stream;
  if (md && typeof md.getUserMedia === "function") {
    let cameraRequestTimedOut = false;
    let timeoutId;
    const cameraRequest = md.getUserMedia(constraints).then((result) => {
      if (cameraRequestTimedOut) {
        result.getTracks().forEach((track) => track.stop());
        throw new Error("Camera request timed out. Allow camera access in browser site settings, then refresh.");
      }
      return result;
    });
    try {
      stream = await Promise.race([
        cameraRequest,
        new Promise((_, reject) => {
          timeoutId = window.setTimeout(() => {
            cameraRequestTimedOut = true;
            reject(new Error("Camera request timed out. Allow camera access in browser site settings, then refresh."));
          }, 20000);
        }),
      ]);
    } finally {
      window.clearTimeout(timeoutId);
    }
  } else {
    const legacy = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
    if (!legacy) throw new Error("No camera API available.");
    stream = await Promise.race([
      new Promise((res, rej) => legacy.call(navigator, constraints, res, rej)),
      new Promise((_, reject) => window.setTimeout(() => reject(
        new Error("Camera request timed out. Allow camera access in browser site settings, then refresh."),
      ), 20000)),
    ]);
  }

  loadingTitle.textContent = "Starting camera...";
  video.srcObject = stream;
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  try {
    await Promise.race([
      video.readyState >= HTMLMediaElement.HAVE_METADATA
        ? Promise.resolve()
        : new Promise((resolve, reject) => {
          video.addEventListener("loadedmetadata", resolve, { once: true });
          video.addEventListener("error", () => reject(new Error("The camera stream could not be read.")), { once: true });
        }),
      new Promise((_, reject) => window.setTimeout(() => reject(
        new Error("Camera connected but did not start. Close other apps using the camera, then refresh."),
      ), 10000)),
    ]);
    await video.play();
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
    throw error;
  }
}


// ═══════════════════════════════════════════════════════════════════
// 10. SKELETON DRAWING (hand wireframe on overlay)
// ═══════════════════════════════════════════════════════════════════

function drawSkeleton(lm, W, H, color = "rgba(0,200,0,0.6)") {
  const connections = [
    [0,1],[1,2],[2,3],[3,4],
    [0,5],[5,6],[6,7],[7,8],
    [0,9],[9,10],[10,11],[11,12],
    [0,13],[13,14],[14,15],[15,16],
    [0,17],[17,18],[18,19],[19,20],
    [5,9],[9,13],[13,17],
  ];

  oCtx.strokeStyle = color;
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
    oCtx.fillStyle = i === 8 ? color.replace("0.6", "1") : color;
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
    cleanedShapeRegions = [];
    discardShapeAssistStroke();
    ocrBar.style.display = "none";
    ocrText.textContent = "";
    state.continuousTextBuffer = "";
    state.continuousSuggestedBuffer = "";
    hideSpellSuggestions();
    state.lastDrawT = 0;
    resetStrokeState();
  },
};


// ═══════════════════════════════════════════════════════════════════
// 12. MAIN RENDER LOOP — Runs every frame via requestAnimationFrame
// ═══════════════════════════════════════════════════════════════════

let lastVideoTime = -1;
let pointerReacquireUntil = 0;

function reacquireIndexTipPointer(now = performance.now(), durationMs = 120) {
  pointerFilter.reset();
  pointerReacquireUntil = now + durationMs;
}

/** Keep the filtered cursor anchored to the currently detected index tip. */
function validatePointerAgainstIndexTip(rawX, rawY, filteredX, filteredY, width, height, now) {
  // Keep smoothing visually tight to the fingertip; the previous 12–26 px
  // allowance was large enough to make the ink visibly trail the hand.
  const maxOffset = clamp(Math.round(Math.hypot(width, height) * 0.0015), 2, 4);
  const offset = Math.hypot(filteredX - rawX, filteredY - rawY);
  if (now < pointerReacquireUntil || !Number.isFinite(offset)) {
    // A tool change or invalid sample immediately reacquires landmark 8.
    pointerFilter.reset();
    if (!Number.isFinite(offset) && now >= pointerReacquireUntil) pointerReacquireUntil = now + 80;
    return [rawX, rawY];
  }
  if (offset <= maxOffset) return [filteredX, filteredY];

  // Preserve a little filtering while projecting the cursor back inside a
  // tight radius around the current fingertip.
  const scale = maxOffset / offset;
  return [
    Math.round(rawX + (filteredX - rawX) * scale),
    Math.round(rawY + (filteredY - rawY) * scale),
  ];
}

function detectedPhysicalHandSide(result, handIndex) {
  const groups = result.handednesses || result.handedness || [];
  const label = groups[handIndex]?.[0]?.categoryName || groups[handIndex]?.[0]?.displayName;
  // On this camera/browser combination the task labels match the user's
  // physical hands; keep them direct (the preview is mirrored with CSS only).
  if (label === "Left") return "Left";
  if (label === "Right") return "Right";
  return null;
}

function wristDistance(landmarks, track) {
  if (!track) return Infinity;
  return Math.hypot(landmarks[0].x - track.x, landmarks[0].y - track.y);
}

function assignHandsToRoles(result, hands) {
  const labels = hands.map((_, index) => detectedPhysicalHandSide(result, index));
  let rightIndex = -1;
  let leftIndex = -1;

  if (hands.length >= 2) {
    const labeledRight = labels.indexOf("Right");
    const labeledLeft = labels.indexOf("Left");
    if (labeledRight >= 0 && labeledLeft >= 0 && labeledRight !== labeledLeft) {
      // Prefer clear per-frame handedness labels over proximity. Tracks can
      // cross or become stale when one hand briefly leaves camera view.
      rightIndex = labeledRight;
      leftIndex = labeledLeft;
    } else if (labels.filter(Boolean).length === 1) {
      // If only one label is usable, the other detected hand must be the
      // opposite side; do not let an old wrist track swap their roles.
      const knownIndex = labels.findIndex(Boolean);
      if (labels[knownIndex] === "Right") {
        rightIndex = knownIndex;
        leftIndex = knownIndex === 0 ? 1 : 0;
      } else {
        leftIndex = knownIndex;
        rightIndex = knownIndex === 0 ? 1 : 0;
      }
    } else {
      const candidates = [[0, 1], [1, 0]]; // [right index, left index]
      const tracksReady = state.handTracks.Right && state.handTracks.Left;
      if (tracksReady || labels.some(Boolean)) {
        const cost = ([right, left]) => {
          let total = 0;
          for (const [index, side] of [[right, "Right"], [left, "Left"]]) {
            const track = state.handTracks[side];
            if (track) total += wristDistance(hands[index], track);
            if (labels[index] && labels[index] !== side) total += tracksReady ? 0.12 : 0.5;
          }
          return total;
        };
        [rightIndex, leftIndex] = candidates.reduce((best, candidate) => cost(candidate) < cost(best) ? candidate : best);
      } else {
        [rightIndex, leftIndex] = candidates[0];
      }
    }
  } else if (hands.length === 1) {
    const label = labels[0];
    if (label) {
      // A fresh one-hand frame should keep its detected physical identity;
      // never reassign it to the other hand based on a stale track.
      if (label === "Right") rightIndex = 0;
      else leftIndex = 0;
    } else if (state.handTracks.Right || state.handTracks.Left) {
      const side = wristDistance(hands[0], state.handTracks.Right) <= wristDistance(hands[0], state.handTracks.Left) ? "Right" : "Left";
      if (side === "Right") rightIndex = 0;
      else leftIndex = 0;
    } else {
      rightIndex = 0;
    }
  }

  for (const side of ["Right", "Left"]) {
    if (state.handTracks[side]) state.handTracks[side].missed++;
  }
  for (const [index, side] of [[rightIndex, "Right"], [leftIndex, "Left"]]) {
    if (index < 0) continue;
    state.handTracks[side] = { x: hands[index][0].x, y: hands[index][0].y, missed: 0 };
  }
  for (const side of ["Right", "Left"]) {
    if (state.handTracks[side]?.missed > 20) state.handTracks[side] = null;
  }

  return { rightIndex, leftIndex };
}

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

  const hands = result.landmarks || [];
  const { rightIndex, leftIndex } = assignHandsToRoles(result, hands);

  if (leftIndex >= 0) {
    const leftLm = hands[leftIndex];
    drawSkeleton(leftLm, W, H, "rgba(94,234,212,0.85)");
    handleLeftControlGesture(leftLm, now);
  } else {
    state.leftGestureHistory = [];
    state.leftStableGesture = "IDLE";
    state.leftFingerStates = [false, false, false, false];
    state.leftThumbOpen = false;
    state.leftGestureCandidate = "IDLE";
    state.leftGestureSince = now;
    state.leftGestureConsumed = false;
  }

  // ── RIGHT HAND: existing drawing, erase, pan, and lift behavior ─
  if (rightIndex >= 0) {
    const lm = hands[rightIndex];
    const gesture = updateStableGesture(classifyGesture(lm));
    const action = resolvePointerAction(gesture);
    if (waitForRightDrawRearm && action !== "DRAW") waitForRightDrawRearm = false;

    // A fist and a pointed index finger have very different landmark shapes.
    // Start a fresh pointer/stroke when switching between drawing and erasing
    // so smoothing never blends the old pose's fingertip into the new one.
    if (action !== lastRightPointerAction) {
      reacquireIndexTipPointer(now);
      state.landmarkHistory = [];
      breakStrokePath();
      state.panStartX = null;
      state.panStartY = null;
      lastRightPointerAction = action;
      if (action === "SHAPE_ASSIST") void cleanLatestShape();
    }

    const outlier = isLandmarkOutlier(lm);
    drawSkeleton(lm, W, H, "rgba(0,200,0,0.65)");
    state.handPresent = true;
    state.handLossCounter = 0;
    state.lastHandActiveT = nowSec;
    handLossEl.style.display = "none";

    const rawX = clamp(Math.round((1 - lm[8].x) * W), 0, W - 1);
    const rawY = clamp(Math.round(lm[8].y * H), 0, H - 1);
    let cx = rawX;
    let cy = rawY;
    if (outlier) {
      // Don't blend a bad landmark into the filter or the next outlier check.
      pointerFilter.reset();
      state.landmarkHistory = [];
      breakStrokePath();
    } else {
      const [filteredX, filteredY] = pointerFilter.filter(rawX, rawY, now);
      [cx, cy] = validatePointerAgainstIndexTip(rawX, rawY, filteredX, filteredY, W, H, now);
      addToLandmarkHistory(lm);
    }
    // The joined index+middle pose is the pen-up gesture. Keep its cursor
    // marker exactly on landmark 8 (index fingertip), without filter lag.
    if (action === "LIFT") {
      cx = rawX;
      cy = rawY;
    }
    const buttonConsumed = action !== "SHAPE_ASSIST" && !outlier && checkVirtualButtonDwell(cx, cy, vbtnCallbacks);

    if (outlier || buttonConsumed) {
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
      if (waitForRightDrawRearm) {
        breakStrokePath();
        setMode("IDLE");
      } else if (!isIndexClearlyExtended(lm)) {
        breakStrokePath();
        setMode("IDLE");
      } else {
        drawAtPoint(cx, cy, nowSec);
      }
    } else if (action === "PAN") {
      breakStrokePath();
      state.activeCanvasAction = "PAN";
      setMode("PAN");
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
      oCtx.strokeStyle = "#00cccc";
      oCtx.lineWidth = 2;
      oCtx.beginPath();
      oCtx.moveTo(cx - 10, cy); oCtx.lineTo(cx + 10, cy);
      oCtx.moveTo(cx, cy - 10); oCtx.lineTo(cx, cy + 10);
      oCtx.stroke();
    } else if (action === "SHAPE_ASSIST") {
      state.panStartX = null;
      state.panStartY = null;
      setMode("SHAPE_ASSIST");
      breakStrokePath();
    } else {
      state.panStartX = null;
      state.panStartY = null;
      state.activeCanvasAction = "IDLE";
      setMode("IDLE");
      breakStrokePath();
    }
  } else {
    // Left-hand-only frames never draw or move the right-hand pointer.
    if (state.handPresent) {
      reacquireIndexTipPointer(now);
      state.landmarkHistory = [];
      breakStrokePath();
      lastRightPointerAction = "IDLE";
    }
    state.handPresent = false;
    state.panStartX = null;
    state.panStartY = null;
    if (leftIndex >= 0) {
      state.fingerHistory = [];
      state.fingerStates = [false, false, false, false];
      state.gestureHistory = [];
      state.stableGesture = "IDLE";
      state.gestureCandidate = "IDLE";
      state.gestureCandidateFrames = 0;
      state.handLossCounter = 0;
      handLossEl.style.display = "none";
    } else {
      state.handLossCounter++;
      if (state.handLossCounter >= 6 && state.handLossCounter < LOST_HAND_RESET_FRAMES) {
        handLossEl.textContent = "Right hand not detected — draw with your right hand";
        handLossEl.style.display = "block";
      }
      if (state.handLossCounter >= LOST_HAND_RESET_FRAMES) {
        setMode("IDLE");
        resetStrokeState();
        handLossEl.style.display = "none";
      }
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
  if (shapeCleanupInProgress) return;
  pushUndoSnapshot();
  dCtx.clearRect(0, 0, VIRTUAL_W, VIRTUAL_H);
  cleanedShapeRegions = [];
  discardShapeAssistStroke();
  ocrBar.style.display = "none";
  ocrText.textContent = "";
  state.continuousTextBuffer = "";
  state.continuousSuggestedBuffer = "";
  currentOcrCanCommit = false;
  commitWordBtn.disabled = true;
  hideSpellSuggestions();
  state.lastDrawT = 0;
  resetStrokeState();
};

commitWordBtn.addEventListener("click", commitCurrentWord);
popWordBtn.addEventListener("click", popLastSentenceWord);
clearSentenceBtn.addEventListener("click", () => {
  state.sentenceWords.length = 0;
  dismissNextWordSuggestions();
  renderSentence();
  showOperationNotification("Sentence cleared.");
  sentenceHintEl.textContent = "Sentence cleared. Draw a word, wait for OCR, and add it with left thumbs up.";
});

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
renderSentence();

async function init() {
  try {
    await setupCamera();
    document.querySelector("#loading h2").textContent = "Loading hand tracking model...";
    document.querySelector("#loading p").textContent = "This may take a moment the first time.";
    await setupMediaPipe();
    document.getElementById("loading").style.display = "none";
    connectWS();
    renderLoop();
  } catch (err) {
    const loadingTitle = document.querySelector("#loading h2");
    const loadingMessage = document.querySelector("#loading p");
    loadingTitle.textContent = err.name === "NotAllowedError" ? "Camera access is blocked" : "Hand tracking could not start";
    loadingMessage.textContent = err.message || "Check camera permissions and your internet connection, then refresh.";
    console.error(err);
  }
}

init();
