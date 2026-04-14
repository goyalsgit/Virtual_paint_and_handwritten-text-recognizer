// ═══════════════════════════════════════════════════════════════════
// VIRTUAL BUTTONS — Floating gesture-activated UI on the canvas.
//
// Color swatches and tool buttons are drawn on the overlay canvas
// (on the left edge of the screen). To select one:
//   1. Point your index finger at a button
//   2. Hold for 0.5 seconds (a green ring fills up)
//   3. The button activates with a flash
//
// This lets you change colors without touching the keyboard.
// ═══════════════════════════════════════════════════════════════════

import {
  COLORS,
  VBTN_RADIUS,
  VBTN_MARGIN_LEFT,
  VBTN_MARGIN_TOP,
  VBTN_SPACING,
  DWELL_TIME_MS,
  state,
} from "./config.js";

// ─────────────────────────────────────────────────────────────────
// 1. BUILD THE BUTTON LIST
// ─────────────────────────────────────────────────────────────────

/**
 * Create the virtual button array.
 * Call this once at startup. The buttons are:
 *   - 9 color swatches (one per COLORS entry)
 *   - Eraser toggle
 *   - Undo
 *   - Clear canvas
 */
export function initVirtualButtons() {
  state.virtualButtons = [];
  let y = VBTN_MARGIN_TOP;

  // One button per color
  for (let i = 0; i < COLORS.length; i++) {
    state.virtualButtons.push({
      type: "color",
      index: i,
      color: COLORS[i].hex,
      label: COLORS[i].name,
      x: VBTN_MARGIN_LEFT,
      y: y,
    });
    y += VBTN_SPACING;
  }

  y += 12; // small gap before tool buttons

  // Tool buttons
  state.virtualButtons.push({
    type: "eraser", label: "⌫", color: "#3355ff",
    x: VBTN_MARGIN_LEFT, y: y,
  });
  y += VBTN_SPACING;

  state.virtualButtons.push({
    type: "undo", label: "↩", color: "#777777",
    x: VBTN_MARGIN_LEFT, y: y,
  });
  y += VBTN_SPACING;

  state.virtualButtons.push({
    type: "clear", label: "✕", color: "#ff4444",
    x: VBTN_MARGIN_LEFT, y: y,
  });
}

// ─────────────────────────────────────────────────────────────────
// 2. DRAW THE BUTTONS ON THE OVERLAY CANVAS
// ─────────────────────────────────────────────────────────────────

/**
 * Render all virtual buttons on the given canvas context.
 * Called every frame in the render loop.
 *
 * @param {CanvasRenderingContext2D} ctx - the overlay canvas context
 */
export function drawVirtualButtons(ctx) {
  const buttons = state.virtualButtons;
  if (!buttons.length) return;

  const now = Date.now();

  // ── Semi-transparent backdrop strip ──
  const firstY = buttons[0].y;
  const lastY = buttons[buttons.length - 1].y;
  const stripW = VBTN_RADIUS * 2 + 24;
  const stripH = lastY - firstY + VBTN_RADIUS * 2 + 28;

  ctx.fillStyle = "rgba(10, 10, 20, 0.35)";
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(
      VBTN_MARGIN_LEFT - VBTN_RADIUS - 8,
      firstY - VBTN_RADIUS - 10,
      stripW, stripH, 12
    );
    ctx.fill();
  } else {
    // Fallback for browsers without roundRect
    ctx.fillRect(
      VBTN_MARGIN_LEFT - VBTN_RADIUS - 8,
      firstY - VBTN_RADIUS - 10,
      stripW, stripH
    );
  }

  // ── Draw each button ──
  for (let i = 0; i < buttons.length; i++) {
    const btn = buttons[i];

    // Is this button the currently active one?
    const isActive =
      (btn.type === "color" && btn.index === state.colorIdx && !state.eraserMode) ||
      (btn.type === "eraser" && state.eraserMode);

    // Flash animation timing
    const flashAge = now - state.lastSelectedFlash.time;
    const isFlashing = state.lastSelectedFlash.idx === i && flashAge < 350;

    // Color disc
    ctx.beginPath();
    ctx.arc(btn.x, btn.y, VBTN_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = btn.color;
    ctx.fill();

    // White ring around the active button
    if (isActive) {
      ctx.beginPath();
      ctx.arc(btn.x, btn.y, VBTN_RADIUS + 3, 0, Math.PI * 2);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    // Green progress ring while hovering (dwell countdown)
    if (state.dwellButtonIdx === i && state.dwellStartTime > 0) {
      const elapsed = now - state.dwellStartTime;
      const progress = Math.min(elapsed / DWELL_TIME_MS, 1);
      ctx.beginPath();
      ctx.arc(
        btn.x, btn.y, VBTN_RADIUS + 6,
        -Math.PI / 2,                        // start at top
        -Math.PI / 2 + progress * Math.PI * 2 // sweep clockwise
      );
      ctx.strokeStyle = "#00ff88";
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // Flash burst when a button is activated
    if (isFlashing) {
      const alpha = 1 - flashAge / 350;
      ctx.beginPath();
      ctx.arc(btn.x, btn.y, VBTN_RADIUS + 8 + flashAge * 0.03, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(0, 255, 136, ${alpha.toFixed(2)})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Icon label for tool buttons (eraser, undo, clear)
    if (btn.type !== "color") {
      ctx.fillStyle = "#fff";
      ctx.font = "bold 14px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(btn.label, btn.x, btn.y);
    }

    // Show the color name below the active swatch
    if (btn.type === "color" && isActive) {
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.font = "9px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(btn.label, btn.x, btn.y + VBTN_RADIUS + 3);
    }
  }
}

// ─────────────────────────────────────────────────────────────────
// 3. DWELL DETECTION (hover to activate)
// ─────────────────────────────────────────────────────────────────

/**
 * Check if the finger is hovering over a virtual button.
 * After DWELL_TIME_MS (500ms), the button action fires.
 *
 * @param {number} cx - finger X position (screen coords)
 * @param {number} cy - finger Y position (screen coords)
 * @param {Object} callbacks - action handlers:
 *   { selectColor(idx), toggleEraser(), undo(), clear() }
 * @returns {boolean} true if finger is over a button (suppresses drawing)
 */
export function checkVirtualButtonDwell(cx, cy, callbacks) {
  const now = Date.now();
  const buttons = state.virtualButtons;
  let hoveredIdx = -1;

  // Which button (if any) is the finger over?
  for (let i = 0; i < buttons.length; i++) {
    const dist = Math.hypot(cx - buttons[i].x, cy - buttons[i].y);
    if (dist <= VBTN_RADIUS + 10) {
      hoveredIdx = i;
      break;
    }
  }

  // Not over any button → reset and allow normal drawing
  if (hoveredIdx === -1) {
    state.dwellButtonIdx = -1;
    state.dwellStartTime = 0;
    return false;
  }

  // Started hovering a new button → begin dwell timer
  if (state.dwellButtonIdx !== hoveredIdx) {
    state.dwellButtonIdx = hoveredIdx;
    state.dwellStartTime = now;
    return true; // suppress drawing while hovering
  }

  // Still hovering the same button → check if dwell time is met
  const elapsed = now - state.dwellStartTime;
  if (elapsed >= DWELL_TIME_MS) {
    const btn = buttons[hoveredIdx];
    state.lastSelectedFlash = { idx: hoveredIdx, time: now };
    state.dwellButtonIdx = -1;
    state.dwellStartTime = 0;

    // Fire the action
    if (btn.type === "color")  callbacks.selectColor(btn.index);
    if (btn.type === "eraser") callbacks.toggleEraser();
    if (btn.type === "undo")   callbacks.undo();
    if (btn.type === "clear")  callbacks.clear();
  }

  return true; // suppress drawing while hovering
}
