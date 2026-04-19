# Test Fix #1: PDF Viewer Cursor Tracking for Open Hand

## What Was Fixed
- Added cursor tracking when open hand gesture is detected
- Added search state reset with open hand gesture

## How to Test

### Step 1: Start the Server
```bash
cd air-drawing-app
source venv/bin/activate
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

### Step 2: Open PDF Viewer
```
Open browser: http://localhost:8000/pdfviewer
```

### Step 3: Test Cursor Visibility
1. Click "Enable Camera" button
2. Wait for hand tracking to initialize
3. Show **open hand** (all 5 fingers extended) to camera
4. **EXPECTED:** You should see a **gray cursor** following your index finger
5. **BEFORE FIX:** Cursor was invisible

### Step 4: Test Search State Reset
1. Click "OCR Search" button (or select Search tool)
2. Search overlay should open
3. Close overlay without searching
4. Show **open hand** gesture
5. **EXPECTED:** Tool should switch back to "Cursor mode"
6. Pill should show: "✋ Search cleared → Cursor mode"

## Visual Verification

### Open Hand Cursor
- **Color:** Gray (#94a3b8)
- **Style:** Laser cursor (circle with dot in center)
- **Behavior:** Follows index finger smoothly
- **Pill Text:** "✋ Open hand idle"

### Search Reset
- **Trigger:** Open hand when in search mode
- **Result:** Switches to cursor mode
- **Pill Text:** "✋ Search cleared → Cursor mode"

## Success Criteria

✅ **Pass:** Cursor is visible when showing open hand  
✅ **Pass:** Cursor follows hand movement smoothly  
✅ **Pass:** Search mode resets to cursor mode with open hand  
✅ **Pass:** No JavaScript errors in browser console  

❌ **Fail:** Cursor still invisible with open hand  
❌ **Fail:** JavaScript errors appear  
❌ **Fail:** Search mode doesn't reset  

## Rollback Instructions (If Test Fails)

If the fix doesn't work or causes issues:

```bash
cd air-drawing-app
git checkout frontend/js/pdf-viewer/main.js
```

Or manually revert the `handleOpen()` function to:

```javascript
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
```

## Status

- [x] Fix Applied
- [ ] Tested Locally
- [ ] Verified Working
- [ ] Ready for Next Fix

## Notes

- This fix adds ~20 lines of code
- Uses existing filter functions (ptrFilterX, ptrFilterY)
- Uses existing cursor drawing function (drawLaserCursor)
- No new dependencies required
- Should not affect other gestures

---

**Next Fix:** Fix #2 - Add Eraser Tool to PDF Viewer
