# Testing Checklist for Air Drawing PDF Viewer

## 🧪 Complete Feature Testing Guide

### Prerequisites
- ✅ Backend server running (`python backend/main.py`)
- ✅ Frontend server running (open `frontend/pdf-viewer.html`)
- ✅ Webcam connected and working
- ✅ PDF file ready to load

---

## 1️⃣ Basic Setup Tests

### Test 1.1: Load PDF
- [ ] Drag and drop a PDF file onto the drop zone
- [ ] PDF should load and display all pages
- [ ] Page counter should show "1 / [total pages]"
- [ ] Zoom should show "150%"

### Test 1.2: Enable Camera
- [ ] Click "Start Camera" button
- [ ] Camera should activate (green dot appears)
- [ ] Hand skeleton should appear in sidebar when hand is visible
- [ ] Status should show "Camera live"

---

## 2️⃣ Gesture Tests

### Test 2.1: Open Hand Gesture
- [ ] Show open hand (all 4 fingers extended)
- [ ] Gray cursor should appear following index finger
- [ ] Pill should show "✋ Open hand idle"
- [ ] Cursor should move smoothly (no jitter)

### Test 2.2: Fist Gesture (Scrolling)
- [ ] Make a fist (all fingers closed)
- [ ] Move hand up/down
- [ ] PDF should scroll smoothly
- [ ] Pill should show "✊ Scrolling"
- [ ] Release fist → scroll should continue with inertia

### Test 2.3: Point Gesture (Index Finger)
- [ ] Extend only index finger
- [ ] Purple cursor should appear
- [ ] Pill should show "☝️ Cursor"
- [ ] Cursor should follow index finger tip

---

## 3️⃣ Tool Selection Tests

### Test 3.1: Pen Tool
- [ ] Point gesture → hover over "✍️ Pen" button for 0.5 seconds
- [ ] Button should highlight during hover
- [ ] Tool should activate (pill shows "✍️ Index writing")
- [ ] Move finger over PDF → should draw lines
- [ ] Lines should appear in the selected color

### Test 3.2: Highlighter Tool
- [ ] Hover over "🟡 Highlight" button
- [ ] Tool should activate (pill shows "🟡 Highlighter mode")
- [ ] Draw on PDF → should create thick transparent strokes
- [ ] Highlighter should be more transparent than pen

### Test 3.3: Eraser Tool ⭐ NEW
- [ ] Hover over "🧹 Eraser" button
- [ ] Tool should activate (pill shows "🧹 Eraser mode")
- [ ] Red circle cursor should appear (30px radius)
- [ ] Move over existing annotations → they should disappear
- [ ] Both pen strokes and highlights should be erasable
- [ ] Notes panel should update when annotations are erased

### Test 3.4: Search Tool
- [ ] Hover over "🔎 Search" button
- [ ] Transparent overlay should appear
- [ ] Write text in the air with index finger
- [ ] After 3 seconds of no movement → OCR should process
- [ ] Recognized text should appear in search preview
- [ ] PDF should highlight matching text

### Test 3.5: Cursor Tool
- [ ] Hover over "🖱 Cursor" button
- [ ] Tool should switch to cursor mode
- [ ] No drawing should occur when moving finger
- [ ] Purple laser cursor should appear

---

## 4️⃣ Color Selection Tests

### Test 4.1: Change Colors
- [ ] Hover over Yellow button → color should change
- [ ] Hover over Green button → color should change
- [ ] Hover over Blue button → color should change
- [ ] Hover over Pink button → color should change
- [ ] Hover over Purple button → color should change
- [ ] Active color button should have visual indicator
- [ ] Sidebar color swatches should sync with selection

### Test 4.2: Draw with Different Colors
- [ ] Select Pen tool
- [ ] Change to Yellow → draw → should be yellow
- [ ] Change to Green → draw → should be green
- [ ] Change to Blue → draw → should be blue
- [ ] Each stroke should maintain its original color

---

## 5️⃣ Zoom Tests

### Test 5.1: Zoom In
- [ ] Hover over "🔍+ Zoom In" button
- [ ] PDF should zoom in by 20%
- [ ] Zoom indicator should update (e.g., "150%" → "170%")
- [ ] Annotations should scale correctly
- [ ] Maximum zoom: 300%

### Test 5.2: Zoom Out
- [ ] Hover over "🔍- Zoom Out" button
- [ ] PDF should zoom out by 20%
- [ ] Zoom indicator should update
- [ ] Annotations should scale correctly
- [ ] Minimum zoom: 50%

---

## 6️⃣ Brush Size Tests

### Test 6.1: Increase Brush Size
- [ ] Select Pen tool
- [ ] Hover over "🖌️+ Bigger brush" button
- [ ] Draw a stroke → should be thicker
- [ ] Repeat → brush should get progressively thicker
- [ ] Maximum size: 20px
- [ ] Pill should show current size

### Test 6.2: Decrease Brush Size
- [ ] Hover over "🖌️- Smaller brush" button
- [ ] Draw a stroke → should be thinner
- [ ] Repeat → brush should get progressively thinner
- [ ] Minimum size: 1px
- [ ] Pill should show current size

### Test 6.3: Brush Size Persistence
- [ ] Set brush size to 10px
- [ ] Draw a stroke
- [ ] Change to different tool and back
- [ ] Draw another stroke → should still be 10px

---

## 7️⃣ Search Tests

### Test 7.1: Handwriting Search
- [ ] Activate Search tool
- [ ] Write "test" in the air
- [ ] Wait 3 seconds
- [ ] OCR should recognize the text
- [ ] PDF should highlight matching words
- [ ] Search results panel should show pages with matches

### Test 7.2: Clear Search
- [ ] After a search is active
- [ ] Hover over "🧹 Clear Search" button
- [ ] All search highlights should disappear
- [ ] Search preview should clear
- [ ] PDF should return to normal view

### Test 7.3: Search State Reset with Open Hand
- [ ] Activate Search tool (overlay appears)
- [ ] Show open hand gesture
- [ ] Search overlay should close
- [ ] Tool should switch to Cursor mode
- [ ] Pill should show "✋ Search cleared → Cursor mode"

### Test 7.4: Clear Search Highlights with Open Hand Hold
- [ ] Perform a search (highlights visible)
- [ ] Show open hand gesture
- [ ] Hold for 1 second
- [ ] Search highlights should clear
- [ ] Pill should show countdown then "✋ Search highlights cleared!"

---

## 8️⃣ Navigation Tests

### Test 8.1: Page Navigation
- [ ] Click "Previous Page" button → should go to previous page
- [ ] Click "Next Page" button → should go to next page
- [ ] Page counter should update correctly
- [ ] Annotations should persist on each page

### Test 8.2: Scroll Navigation
- [ ] Use fist gesture to scroll
- [ ] Page indicator should update as you scroll
- [ ] Should smoothly transition between pages

### Test 8.3: Keyboard Shortcuts
- [ ] Press Arrow Left → previous page
- [ ] Press Arrow Right → next page
- [ ] Press + → zoom in
- [ ] Press - → zoom out

---

## 9️⃣ Annotation Management Tests

### Test 9.1: Notes Panel
- [ ] Draw some annotations
- [ ] Notes panel should show all annotations
- [ ] Each note should show: color dot, page number, type
- [ ] Click on a note → should navigate to that page

### Test 9.2: Delete Individual Annotation
- [ ] Click "✕" button on a note
- [ ] Annotation should disappear from PDF
- [ ] Note should disappear from panel

### Test 9.3: Clear Page
- [ ] Draw annotations on current page
- [ ] Click "Clear Page" button
- [ ] All annotations on current page should disappear
- [ ] Annotations on other pages should remain

### Test 9.4: Clear All Annotations
- [ ] Draw annotations on multiple pages
- [ ] Click "Clear All Notes" button
- [ ] Confirm dialog should appear
- [ ] All annotations should disappear from all pages
- [ ] Notes panel should show "No annotations yet"

### Test 9.5: Export Annotations
- [ ] Draw some annotations
- [ ] Click "Export Notes" button
- [ ] JSON file should download
- [ ] File should contain highlights and penStrokes data

---

## 🔟 Edge Case Tests

### Test 10.1: No Hand Detected
- [ ] Hide hand from camera
- [ ] All cursors should disappear
- [ ] Gesture pill should disappear
- [ ] No errors in console

### Test 10.2: Rapid Gesture Changes
- [ ] Quickly switch between gestures
- [ ] Should not cause jittery behavior
- [ ] State machine should prevent invalid transitions
- [ ] No fist→point direct transitions

### Test 10.3: Drawing Outside PDF
- [ ] Select Pen tool
- [ ] Move finger outside PDF area
- [ ] Should show "Move onto page to write"
- [ ] No errors should occur

### Test 10.4: Multiple Tool Switches
- [ ] Rapidly hover over different tool buttons
- [ ] Should not activate multiple tools
- [ ] Switch delay should prevent accidental changes
- [ ] Only one tool should be active at a time

### Test 10.5: Search with No PDF
- [ ] Close PDF (refresh page)
- [ ] Try to activate Search tool
- [ ] Should show "Load a PDF before running OCR search"
- [ ] No errors should occur

---

## 1️⃣1️⃣ Performance Tests

### Test 11.1: Smooth Cursor Movement
- [ ] Move hand slowly
- [ ] Cursor should follow smoothly (no jitter)
- [ ] One Euro Filter should be working

### Test 11.2: Drawing Performance
- [ ] Draw long continuous strokes
- [ ] Should render without lag
- [ ] No frame drops

### Test 11.3: Multi-Page Performance
- [ ] Load PDF with 20+ pages
- [ ] Scroll through all pages
- [ ] Should remain smooth
- [ ] No memory leaks

### Test 11.4: Annotation Rendering
- [ ] Add 50+ annotations
- [ ] Zoom in/out
- [ ] All annotations should scale correctly
- [ ] No performance degradation

---

## 1️⃣2️⃣ Browser Compatibility Tests

### Test 12.1: Chrome/Edge
- [ ] All features work
- [ ] No console errors
- [ ] Smooth performance

### Test 12.2: Firefox
- [ ] All features work
- [ ] MediaPipe loads correctly
- [ ] WebSocket connects

### Test 12.3: Safari (if available)
- [ ] Camera permission works
- [ ] Hand tracking works
- [ ] Canvas rendering correct

---

## ✅ TESTING SUMMARY

### Critical Features (Must Work)
- [ ] PDF loading
- [ ] Camera activation
- [ ] Hand gesture detection
- [ ] Pen drawing
- [ ] Eraser tool ⭐ NEW
- [ ] Tool selection via hover

### Important Features (Should Work)
- [ ] Highlighter
- [ ] Color selection
- [ ] Zoom controls
- [ ] Brush size controls
- [ ] Search with OCR
- [ ] Clear search

### Nice-to-Have Features (Good if Working)
- [ ] Scroll inertia
- [ ] Keyboard shortcuts
- [ ] Export annotations
- [ ] Notes panel

---

## 🐛 Bug Reporting Template

If you find any issues, note them here:

**Bug #1:**
- Feature: [e.g., Eraser Tool]
- Steps to reproduce: [e.g., 1. Select eraser, 2. Move over annotation]
- Expected: [e.g., Annotation should disappear]
- Actual: [e.g., Nothing happens]
- Console errors: [paste any errors]

---

## 📊 Test Results

**Date**: _______________
**Tester**: _______________
**Browser**: _______________
**OS**: _______________

**Total Tests**: 100+
**Passed**: _____
**Failed**: _____
**Skipped**: _____

**Overall Status**: ⬜ PASS / ⬜ FAIL

---

## 🎯 Priority Testing Order

1. **First Priority** (5 minutes)
   - Load PDF
   - Enable camera
   - Test open hand cursor
   - Test pen drawing
   - Test eraser ⭐ NEW

2. **Second Priority** (10 minutes)
   - Test all tools (highlighter, search, cursor)
   - Test color selection
   - Test zoom controls
   - Test brush size

3. **Third Priority** (10 minutes)
   - Test search functionality
   - Test clear search
   - Test notes panel
   - Test export

4. **Final Testing** (5 minutes)
   - Test edge cases
   - Test performance
   - Check for console errors

**Total Testing Time**: ~30 minutes

---

**Good luck with testing! 🚀**
