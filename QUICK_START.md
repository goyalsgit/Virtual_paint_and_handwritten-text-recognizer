# 🚀 Quick Start Guide

## Start the Application (2 minutes)

### Step 1: Start Backend
```bash
cd air-drawing-app
python backend/main.py
```
**Expected Output**: `WebSocket server started on ws://localhost:8765`

### Step 2: Open Frontend
- Open `air-drawing-app/frontend/pdf-viewer.html` in Chrome/Edge
- Or use a local server:
```bash
cd frontend
python -m http.server 8000
# Then open: http://localhost:8000/pdf-viewer.html
```

### Step 3: Load PDF
- Drag and drop any PDF file onto the drop zone
- Or click to browse and select a PDF

### Step 4: Enable Camera
- Click "Start Camera" button
- Allow camera access when prompted
- Wait for green dot (camera active)

### Step 5: Test Gestures
- **Open Hand** (all fingers up) → Gray cursor appears
- **Fist** (all fingers down) → Scroll PDF
- **Point** (index finger only) → Draw/interact

---

## Test New Eraser Tool (1 minute)

1. **Draw something**:
   - Point gesture → hover over "✍️ Pen" button
   - Draw on PDF with index finger

2. **Activate eraser**:
   - Point gesture → hover over "🧹 Eraser" button (0.5 seconds)
   - Red circle cursor appears

3. **Erase**:
   - Move finger over your drawing
   - Annotations disappear within red circle

4. **Done!** ✅

---

## All Virtual Buttons

**Tools** (hover 0.5s):
- 🖱 Cursor - Navigate
- ✍️ Pen - Draw
- 🟡 Highlight - Thick transparent strokes
- 🧹 Eraser - Remove annotations ⭐ NEW
- 🔎 Search - Handwriting recognition

**Colors**:
- 🟡 Yellow
- 🟢 Green
- 🔵 Blue
- 🩷 Pink
- 🟣 Purple

**Controls**:
- 🔍+ Zoom In
- 🔍- Zoom Out
- 🖌️+ Bigger Brush
- 🖌️- Smaller Brush
- 🧹 Clear Search

---

## Gestures Quick Reference

| Gesture | Fingers | Action |
|---------|---------|--------|
| Open Hand | All 4 up | Show cursor, reset search, clear highlights (hold 1s) |
| Fist | All down | Scroll PDF |
| Point | Index only | Draw/erase/interact (based on active tool) |

---

## Troubleshooting

**Camera not working?**
- Check browser permissions
- Try Chrome/Edge (best support)
- Ensure webcam is connected

**Backend not connecting?**
- Check if `python backend/main.py` is running
- Look for "WebSocket server started" message
- Check port 8765 is not in use

**Eraser not working?**
- Make sure you activated eraser tool (hover over button)
- Red circle cursor should be visible
- Try drawing something first, then erase

**Gestures not detected?**
- Ensure good lighting
- Keep hand in camera view
- Show clear hand shapes
- Check hand skeleton in sidebar

---

## Files to Check

**Main Code**: `frontend/js/pdf-viewer/main.js`  
**UI**: `frontend/pdf-viewer.html`  
**Styles**: `frontend/css/pdf-viewer.css`  
**Backend**: `backend/main.py`  

**Documentation**:
- `FINAL_STATUS.md` - Project completion summary
- `ERASER_AND_CODE_REVIEW.md` - Code review and eraser details
- `TESTING_CHECKLIST.md` - Complete testing guide
- `PROJECT_DOCUMENTATION.md` - Full project explanation
- `DEPLOYMENT_GUIDE.md` - How to deploy

---

## Quick Test Checklist

- [ ] Backend running
- [ ] Frontend open
- [ ] PDF loaded
- [ ] Camera active
- [ ] Open hand shows cursor ✅
- [ ] Fist scrolls PDF ✅
- [ ] Pen draws ✅
- [ ] Eraser removes annotations ✅ NEW
- [ ] Colors change ✅
- [ ] Zoom works ✅

---

**Total Setup Time**: 2 minutes  
**Total Test Time**: 5 minutes  
**Ready to Present**: YES ✅

---

**Need Help?** Check `FINAL_STATUS.md` for complete details!
