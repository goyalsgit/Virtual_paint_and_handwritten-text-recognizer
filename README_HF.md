---
title: Air Drawing OCR
emoji: ✍️
colorFrom: blue
colorTo: purple
sdk: docker
app_port: 8000
pinned: false
---

# ✍️ Air Drawing OCR - B.Tech Project

## 🎯 Project Overview

An AI-powered air drawing application that converts hand-drawn text to digital text using:
- **MediaPipe** for hand tracking
- **TrOCR** (Vision Transformer + GPT-2) for OCR
- **WebSocket** for real-time communication
- **No API calls** - Everything runs locally

## 🚀 Features

### 1. Virtual Paint Canvas
- ✍️ Draw with index finger in the air
- ✊ Erase with fist gesture
- 🖐️ Pan canvas with open hand
- ↩️ Undo/redo support
- 🎨 Multiple drawing tools

### 2. OCR Recognition
- 🤖 Fine-tuned TrOCR model
- 📝 Word, line, and sentence modes
- ⚡ Auto-OCR after pause
- 💾 Training sample collection

### 3. PDF Viewer
- 📄 Gesture-controlled navigation
- 🖊️ Pen and highlighter tools
- 🔍 OCR-based search
- 🧹 Eraser tool
- 💾 Annotation export

## 🎓 Academic Context

**Project Type:** B.Tech Final Year Project  
**Domain:** Computer Vision + Natural Language Processing  
**Technologies:** Python, JavaScript, PyTorch, Transformers, OpenCV, MediaPipe  
**Model:** TrOCR Large (Fine-tuned on custom dataset)

## 📖 How to Use

1. **Allow camera access** when prompted
2. **Wait for hand tracking** to initialize (5-10 seconds)
3. **Use gestures:**
   - ☝️ Index finger = Draw
   - ✊ Fist = Erase
   - ✌️ Two fingers = Lift pen
   - 🖐️ Open hand = Pan canvas / Show cursor
4. **Write text** in the air
5. **Pause for 3 seconds** - Auto-OCR will recognize text
6. **Save samples** to improve the model

## 🏗️ Architecture

```
Browser (MediaPipe) → WebSocket → FastAPI → TrOCR → Text Output
```

## 📊 Technical Details

- **Model:** microsoft/trocr-large-handwritten (fine-tuned)
- **Framework:** FastAPI + PyTorch
- **Hand Tracking:** MediaPipe (21 landmarks)
- **Image Processing:** OpenCV
- **Real-time Communication:** WebSocket
- **Training Dataset:** 227 custom images

## 🎥 Demo

1. Open the app
2. Allow camera access
3. Show your hand to the camera
4. Draw text in the air with your index finger
5. Wait 3 seconds for OCR recognition
6. See the recognized text appear!

## ⚠️ Requirements

- **Webcam** - Required for hand tracking
- **Good lighting** - Better accuracy
- **Modern browser** - Chrome/Firefox/Safari
- **HTTPS** - Required for webcam access (provided by Hugging Face)

## 🔧 Technical Stack

### Backend
- Python 3.11
- FastAPI
- PyTorch
- Transformers (Hugging Face)
- OpenCV
- MediaPipe

### Frontend
- Vanilla JavaScript
- HTML5 Canvas
- WebSocket
- PDF.js

### Model
- TrOCR Large (2.3GB)
- Fine-tuned on 227 custom images
- Trained for air-drawn text recognition

## 📚 Documentation

- [Complete Project Documentation](./docs/PROJECT_DOCUMENTATION.md)
- [Deployment Guide](./docs/DEPLOYMENT_GUIDE.md)
- [Training Guide](./training/TRAIN_ON_COLAB.md)

## 🎓 B.Tech Project Highlights

### Key Achievements
- ✅ Fine-tuned TrOCR model on custom dataset
- ✅ Real-time hand tracking with MediaPipe
- ✅ WebSocket-based communication
- ✅ No external API calls (all local processing)
- ✅ PDF viewer with gesture control
- ✅ Training data collection system

### Challenges Solved
- Hand gesture classification
- Air-drawn text preprocessing
- Real-time OCR performance
- WebSocket state management
- PDF annotation system

## 👨‍💻 Developer

**Name:** [Your Name]  
**University:** [Your University]  
**Project:** B.Tech Final Year Project  
**Year:** 2026

## 📝 License

MIT License - See LICENSE file for details

---

**Note:** This application requires webcam access and works best in good lighting conditions. The first load may take 30-60 seconds as the model initializes.

## 🆘 Troubleshooting

**Camera not working?**
- Ensure HTTPS is enabled (Hugging Face provides this)
- Check browser permissions
- Try a different browser

**Hand tracking not working?**
- Ensure good lighting
- Show your full hand to the camera
- Keep hand within frame

**OCR not recognizing text?**
- Write clearly and slowly
- Use larger strokes
- Wait 3 seconds after writing
- Ensure good contrast (dark strokes on light background)

---

🚀 **Deployed on Hugging Face Spaces**
