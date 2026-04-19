# Testing Guide - Fix by Fix

## 🎯 Current Fix: #1 - PDF Viewer Cursor Tracking

---

## 📋 Quick Start

```bash
cd air-drawing-app
./START_SERVER_AND_TEST.sh
```

Wait for: `Application startup complete`

Then open: **http://localhost:8000/pdfviewer**

---

## 🧪 Test Fix #1: Open Hand Cursor + Search Reset

### What You're Testing
**Problem 1:** Cursor disappears when showing open hand  
**Fix 1:** Cursor should now be visible and track your hand

**Problem 2:** No way to clear search highlights with gesture  
**Fix 2:** Hold open hand for 1 second to clear highlights

### Step-by-Step Test

#### 1. Setup (2 minutes)
```
✓ Server running (see terminal)
✓ Browser open to http://localhost:8000/pdfviewer
✓ PDF uploaded (drag & drop any PDF)
✓ Camera enabled (click "Enable Camera" button)
✓ Hand tracking active (green skeleton visible in sidebar)
```

#### 2. Test Open Hand Cursor (1 minute)
```
Action: Show OPEN HAND to camera
        (All 5 fingers extended, palm facing camera)

Expected Results:
✓ Gray cursor appears on screen
✓ Cursor follows your index finger
✓ Cursor moves smoothly (not jittery)
✓ Pill shows: "✋ Open hand idle"
✓ No errors in browser console (F12)
```

#### 3. Test Search Reset (1 minute)
```
Action 1: Click "OCR Search" button
Expected: Search overlay opens

Action 2: Press Escape or click outside
Expected: Overlay closes but tool still "search"

Action 3: Show OPEN HAND
Expected: 
✓ Tool switches to "cursor" mode
✓ Pill shows: "✋ Search cleared → Cursor mode"
```

#### 4. Test Search Highlight Clearing (2 minutes) - NEW!
```
Action 1: Click "OCR Search" button
Action 2: Write a common word in air (e.g., "the")
Action 3: Wait for search to complete
Expected: Yellow highlights appear on PDF pages

Action 4: Show OPEN HAND and HOLD for 1 second
Expected:
✓ Pill shows countdown: "✋ Hold to clear search (1s)"
✓ After 1 second: "✋ Search highlights cleared!"
✓ All yellow highlights disappear
✓ PDF returns to normal state
✓ Search results panel clears
```

---

## ✅ Success Criteria

## ✅ Success Criteria

### PASS if:
- [x] Cursor visible with open hand
- [x] Cursor follows hand smoothly
- [x] Pill text correct
- [x] Search mode resets
- [x] Search highlights clear with 1-second hold
- [x] Countdown shows in pill
- [x] Virtual clear search button works (hover 0.5s)
- [x] 5 color buttons visible and working
- [x] Color changes when hovering color button
- [x] Sidebar color swatch synchronizes
- [x] No JavaScript errors

### FAIL if:
- [ ] Cursor still invisible
- [ ] JavaScript errors in console
- [ ] Cursor doesn't follow hand
- [ ] Search mode doesn't reset

---

## 🐛 Troubleshooting

### Issue: Server won't start
```bash
# Check if port 8000 is in use
lsof -i :8000

# Kill process if needed
kill -9 <PID>

# Try again
./START_SERVER_AND_TEST.sh
```

### Issue: Camera not working
```
1. Check browser permissions (click lock icon in address bar)
2. Allow camera access
3. Refresh page
4. Try different browser (Chrome recommended)
```

### Issue: Hand tracking not working
```
1. Ensure good lighting
2. Keep hand 30-60cm from camera
3. Show palm clearly to camera
4. Check sidebar - should see green skeleton
```

### Issue: Cursor still not visible
```
1. Open browser console (F12)
2. Look for JavaScript errors
3. Check if drawLaserCursor function exists
4. Verify ptrFilterX and ptrFilterY are defined
```

---

## 📊 Test Results Template

Copy this and fill it out:

```
=== FIX #1 TEST RESULTS ===

Date: ___________
Time: ___________
Browser: ___________

Setup:
[ ] Server started successfully
[ ] PDF viewer loaded
[ ] PDF uploaded
[ ] Camera enabled
[ ] Hand tracking working

Test 1: Open Hand Cursor
[ ] Cursor visible: YES / NO
[ ] Cursor follows hand: YES / NO
[ ] Cursor smooth: YES / NO
[ ] Pill text correct: YES / NO

Test 2: Search Reset
[ ] Search mode activates: YES / NO
[ ] Open hand resets mode: YES / NO
[ ] Pill text correct: YES / NO

Console Errors:
[ ] No errors
[ ] Errors found: ___________

Overall Result:
[ ] ✅ PASS - Fix works perfectly
[ ] ⚠️ PARTIAL - Works but has issues: ___________
[ ] ❌ FAIL - Doesn't work: ___________

Notes:
___________________________________________
___________________________________________

Next Action:
[ ] Apply Fix #2
[ ] Rollback Fix #1
[ ] Debug issues
```

---

## 🔄 What to Do Next

### If Fix #1 PASSES ✅
```bash
# Update status
echo "Fix #1: ✅ TESTED AND WORKING" >> FIX_STATUS.md

# Ready for Fix #2
echo "Ready to apply Fix #2: Eraser Tool"
```

### If Fix #1 FAILS ❌
```bash
# Rollback
git checkout frontend/js/pdf-viewer/main.js

# Or manually revert (see TEST_FIX_1.md)

# Debug
# 1. Check browser console for errors
# 2. Verify all functions exist
# 3. Check if filters are initialized
```

---

## 📹 Visual Checklist

### What You Should See

#### Before Fix (Original Code)
```
Open Hand Gesture → No cursor visible ❌
```

#### After Fix #1 (New Code)
```
Open Hand Gesture → Gray cursor visible ✅
                  → Cursor follows hand ✅
                  → Smooth movement ✅
```

### Cursor Appearance
```
Style: Circle with dot in center
Color: Gray (#94a3b8)
Size: ~16px diameter
Behavior: Follows index finger tip
```

---

## 🎬 Testing Video Checklist

If recording for instructor:

1. **Show setup**
   - Terminal with server running
   - Browser with PDF viewer
   - Camera enabled

2. **Demonstrate problem** (if you have original code)
   - Show open hand
   - Point out missing cursor

3. **Demonstrate fix**
   - Show open hand
   - Cursor now visible
   - Cursor follows hand

4. **Show search reset**
   - Activate search mode
   - Show open hand
   - Mode resets to cursor

5. **Show console**
   - No errors
   - Clean execution

---

## 📞 Need Help?

### Check These First
1. `TEST_FIX_1.md` - Detailed fix documentation
2. `FIX_STATUS.md` - Current status
3. Browser console (F12) - Error messages
4. Terminal - Server logs

### Common Issues
- **Port in use:** Kill process on port 8000
- **Camera blocked:** Check browser permissions
- **Hand not detected:** Improve lighting
- **Cursor jittery:** Normal, filters will smooth it

---

## ⏭️ After Testing

### Update FIX_STATUS.md
```bash
# Mark Fix #1 as tested
# Add your test results
# Note any issues
# Decide: Apply Fix #2 or Rollback
```

### Prepare for Fix #2
```bash
# If Fix #1 works:
# Read FIXES_TO_APPLY.md - Fix #2
# Understand what will change
# Be ready to test eraser tool
```

---

**Current Status:** Fix #1 Applied, Ready for Testing  
**Next Step:** Run `./START_SERVER_AND_TEST.sh` and test!  
**Time Needed:** ~5 minutes

Good luck! 🚀
