---
title: Air Drawing OCR
emoji: ✍️
colorFrom: blue
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
---

# Air Drawing OCR - B.Tech Project

## 🎯 Overview

An AI-powered air drawing application with gesture control and OCR recognition.

## ✨ Features

- **Virtual Paint**: Draw in the air with hand gestures
- **Media Player**: Control videos with hand gestures
- **PDF Viewer**: Navigate documents with gestures + OCR search
- **Real-time OCR**: TrOCR model for handwriting recognition
- **No API Calls**: Everything runs locally

## 🚀 Technologies

- **Hand Tracking**: MediaPipe
- **OCR**: TrOCR (Vision Transformer + GPT-2)
- **Backend**: FastAPI + PyTorch
- **Frontend**: Vanilla JavaScript
- **Real-time**: WebSocket

## 📖 How to Use

1. Allow camera access
2. Wait for hand tracking to initialize
3. Use gestures:
   - ☝️ Index finger = Draw/Point
   - ✊ Fist = Erase
   - ✌️ Two fingers = Lift pen
   - 🖐️ Three fingers = Pan canvas
4. Write text in the air
5. Pause for auto-OCR

## 🎓 Academic Project

**Type**: B.Tech Final Year Project  
**Domain**: Computer Vision + NLP  
**Model**: Fine-tuned TrOCR Large (2.3GB)

## 🔗 Links

- [GitHub Repository](#)
- [Documentation](./notes/PROJECT_DOCUMENTATION.md)

---

**Note**: Requires webcam access. Works best in good lighting.
