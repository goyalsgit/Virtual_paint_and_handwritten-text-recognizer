# Complete Deployment Guide for Air Drawing App
## B.Tech Project - Step-by-Step Instructions

---

## 📋 Pre-Deployment Checklist

Before deploying, ensure:

- [ ] All code fixes from `FIXES_TO_APPLY.md` are applied
- [ ] `.gitignore` is updated (venv/ and __pycache__/ excluded)
- [ ] Model files are NOT in git (2.3GB would block push)
- [ ] Application runs locally without errors
- [ ] WebSocket connection works
- [ ] OCR recognition works

---

## 🚀 RECOMMENDED: Hugging Face Spaces (FREE + GPU)

### Why This is Best for B.Tech Project:
✅ **FREE** with GPU support  
✅ **Easy to share** - Just send URL to instructor  
✅ **Designed for ML models** - Perfect for TrOCR  
✅ **No credit card required**  
✅ **Auto-scales** - Handles multiple users  
✅ **HTTPS included** - Webcam will work  

### Step-by-Step Deployment:

#### 1. Create Hugging Face Account
```
1. Go to https://huggingface.co/join
2. Sign up with email or GitHub
3. Verify your email
4. Complete profile (add your name, university)
```

#### 2. Create New Space
```
1. Click your profile → "New Space"
2. Fill in details:
   - Owner: your-username
   - Space name: air-drawing-ocr
   - License: MIT
   - Select SDK: Docker
   - Hardware: CPU basic (free)
   - Visibility: Public
3. Click "Create Space"
```

#### 3. Prepare Your Code

**A. Create `app.py` in project root:**
```bash
cd air-drawing-app
cat > app.py << 'EOF'
#!/usr/bin/env python3
"""
Hugging Face Spaces entry point for Air Drawing OCR
"""
import os
import sys

# Hugging Face Spaces uses port 7860
os.environ.setdefault("PORT", "7860")

# Start the FastAPI server
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "backend.main:app",
        host="0.0.0.0",
        port=7860,
        log_level="info"
    )
EOF
```

**B. Create `README.md` for Space:**
```bash
cat > README.md << 'EOF'
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

## 🎯 Project Overview

An AI-powered air drawing application that converts hand-drawn text to digital text using:
- **MediaPipe** for hand tracking
- **TrOCR** (Vision Transformer + GPT-2) for OCR
- **WebSocket** for real-time communication
- **No API calls** - Everything runs locally

## 🚀 Features

1. **Air Drawing Canvas**
   - Draw with index finger
   - Erase with fist gesture
   - Pan canvas with 3 fingers
   - Undo/redo support

2. **OCR Recognition**
   - Fine-tuned TrOCR model
   - Word, line, and sentence modes
   - Auto-OCR after pause
   - Training sample collection

3. **PDF Viewer**
   - Gesture-controlled navigation
   - Pen and highlighter tools
   - OCR-based search
   - Annotation export

## 🎓 Academic Context

**Project Type:** B.Tech Final Year Project  
**Domain:** Computer Vision + Natural Language Processing  
**Technologies:** Python, JavaScript, PyTorch, Transformers, OpenCV  

## 📖 How to Use

1. **Allow camera access** when prompted
2. **Wait for hand tracking** to initialize
3. **Use gestures:**
   - ☝️ Index finger = Draw
   - ✊ Fist = Erase
   - ✌️ Two fingers = Lift pen
   - 🖐️ Three fingers = Pan canvas
4. **Write text** in the air
5. **Pause for 3 seconds** - Auto-OCR will recognize text
6. **Save samples** to improve the model

## 🏗️ Architecture

```
Browser (MediaPipe) → WebSocket → FastAPI → TrOCR → Text Output
```

## 📚 Technical Details

- **Model:** microsoft/trocr-large-handwritten (fine-tuned)
- **Framework:** FastAPI + PyTorch
- **Hand Tracking:** MediaPipe (21 landmarks)
- **Image Processing:** OpenCV
- **Real-time Communication:** WebSocket

## 🔗 Links

- [GitHub Repository](#)
- [Project Documentation](./PROJECT_DOCUMENTATION.md)
- [Deployment Guide](./DEPLOYMENT_GUIDE.md)

## 👨‍💻 Developer

[Your Name]  
[Your University]  
[Your Email]

---

**Note:** This application requires webcam access and works best in good lighting conditions.
EOF
```

**C. Update Dockerfile for Hugging Face:**
```bash
cat > Dockerfile << 'EOF'
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY backend/ ./backend/
COPY frontend/ ./frontend/
COPY hand_landmarker.task ./hand_landmarker.task
COPY app.py ./app.py

# Create directories for artifacts
RUN mkdir -p artifacts/ocr_debug artifacts/trocr_large_model custom_dataset/images

# Hugging Face Spaces uses port 7860
EXPOSE 7860

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD python -c "import requests; requests.get('http://localhost:7860/health')"

# Run the application
CMD ["python", "app.py"]
EOF
```

**D. Create `.dockerignore`:**
```bash
cat > .dockerignore << 'EOF'
# Don't send these to Docker build context
venv/
__pycache__/
*.pyc
.DS_Store
.git/
.gitignore
*.md
training/
docs/
artifacts/ocr_debug/
artifacts/trocr_large_model/
data/manifests/
custom_dataset/images/
*.log
.env
EOF
```

#### 4. Push to Hugging Face

**A. Install Git LFS (for large files):**
```bash
# macOS
brew install git-lfs

# Initialize
git lfs install
```

**B. Initialize and push:**
```bash
cd air-drawing-app

# Initialize git if not already done
git init

# Add Hugging Face remote
git remote add space https://huggingface.co/spaces/YOUR_USERNAME/air-drawing-ocr

# Add all files
git add .

# Commit
git commit -m "Initial deployment to Hugging Face Spaces"

# Push to Hugging Face
git push space main
```

**If you get authentication error:**
```bash
# Create access token at https://huggingface.co/settings/tokens
# Then use:
git remote set-url space https://YOUR_USERNAME:YOUR_TOKEN@huggingface.co/spaces/YOUR_USERNAME/air-drawing-ocr
git push space main
```

#### 5. Monitor Deployment

```
1. Go to your Space page: https://huggingface.co/spaces/YOUR_USERNAME/air-drawing-ocr
2. Click "Logs" tab to see build progress
3. Wait 5-10 minutes for first build
4. Once "Running" status appears, click "App" tab
5. Test the application!
```

#### 6. Upgrade to GPU (Optional but Recommended)

```
1. Go to Space Settings
2. Click "Hardware"
3. Select "T4 small" (FREE for public spaces)
4. Click "Save"
5. Space will restart with GPU
```

### Troubleshooting Hugging Face Deployment:

**Issue: Build fails with "No space left on device"**
```
Solution: Remove large files from git:
git rm --cached artifacts/trocr_large_model/*
git commit -m "Remove large model files"
git push space main
```

**Issue: Application starts but shows "Connection refused"**
```
Solution: Check that port 7860 is used in app.py and Dockerfile
```

**Issue: Webcam not working**
```
Solution: Hugging Face Spaces provides HTTPS automatically, so webcam should work.
If not, check browser permissions.
```

**Issue: Model download fails**
```
Solution: Model will auto-download from Hugging Face Hub on first run.
Check logs for download progress. May take 5-10 minutes.
```

---

## 🌐 ALTERNATIVE: Railway.app (Paid but Simple)

### Cost: ~$5-10/month

### Step-by-Step:

#### 1. Prepare Repository
```bash
cd air-drawing-app

# Ensure .gitignore is correct
cat > .gitignore << 'EOF'
venv/
__pycache__/
*.pyc
.DS_Store
artifacts/trocr_large_model/
artifacts/ocr_debug/
.env
EOF

# Commit and push to GitHub
git add .
git commit -m "Prepare for Railway deployment"
git push origin main
```

#### 2. Deploy on Railway
```
1. Go to https://railway.app
2. Sign up with GitHub
3. Click "New Project"
4. Select "Deploy from GitHub repo"
5. Choose your air-drawing-app repository
6. Railway auto-detects Dockerfile
7. Click "Deploy"
```

#### 3. Configure Environment
```
1. Go to project → Variables
2. Add:
   - PORT=8000
   - AIRDRAW_OCR_MODEL=microsoft/trocr-large-handwritten
3. Click "Save"
```

#### 4. Generate Domain
```
1. Go to Settings → Networking
2. Click "Generate Domain"
3. Get URL like: air-drawing-ocr.up.railway.app
4. Share this URL!
```

---

## ☁️ ALTERNATIVE: Google Cloud Run (Serverless)

### Cost: ~$10-30/month

### Prerequisites:
```bash
# Install Google Cloud SDK
brew install google-cloud-sdk

# Initialize
gcloud init
gcloud auth login
```

### Deployment Steps:

#### 1. Create Project
```bash
gcloud projects create air-drawing-ocr-PROJECT_ID
gcloud config set project air-drawing-ocr-PROJECT_ID
```

#### 2. Enable Services
```bash
gcloud services enable run.googleapis.com
gcloud services enable containerregistry.googleapis.com
gcloud services enable cloudbuild.googleapis.com
```

#### 3. Build Container
```bash
cd air-drawing-app

# Submit build to Cloud Build
gcloud builds submit --tag gcr.io/air-drawing-ocr-PROJECT_ID/app
```

#### 4. Deploy to Cloud Run
```bash
gcloud run deploy air-drawing-app \
  --image gcr.io/air-drawing-ocr-PROJECT_ID/app \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --memory 4Gi \
  --cpu 2 \
  --timeout 300 \
  --max-instances 10 \
  --set-env-vars AIRDRAW_OCR_MODEL=microsoft/trocr-large-handwritten
```

#### 5. Get URL
```bash
gcloud run services describe air-drawing-app \
  --region us-central1 \
  --format 'value(status.url)'
```

---

## 🖥️ ALTERNATIVE: AWS EC2 (Full Control)

### Cost: ~$30-50/month

### Step-by-Step:

#### 1. Launch EC2 Instance
```
1. Go to AWS Console → EC2
2. Click "Launch Instance"
3. Choose: Ubuntu 22.04 LTS
4. Instance type: t3.medium (2 vCPU, 4GB RAM)
5. Storage: 30GB SSD
6. Security group:
   - SSH (22) - Your IP
   - HTTP (80) - 0.0.0.0/0
   - HTTPS (443) - 0.0.0.0/0
7. Create/select key pair
8. Launch instance
```

#### 2. Connect to Instance
```bash
# SSH into instance
ssh -i your-key.pem ubuntu@your-instance-public-ip
```

#### 3. Setup Server
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker ubuntu

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Install Git
sudo apt install -y git

# Logout and login again for docker group to take effect
exit
```

#### 4. Deploy Application
```bash
# SSH back in
ssh -i your-key.pem ubuntu@your-instance-public-ip

# Clone repository
git clone https://github.com/YOUR_USERNAME/air-drawing-app.git
cd air-drawing-app

# Build and run
docker build -t air-drawing-app .
docker run -d -p 80:8000 --name air-drawing --restart unless-stopped air-drawing-app

# Check logs
docker logs -f air-drawing
```

#### 5. Setup Domain (Optional)
```bash
# Install nginx
sudo apt install -y nginx

# Configure nginx
sudo nano /etc/nginx/sites-available/air-drawing

# Add this configuration:
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}

# Enable site
sudo ln -s /etc/nginx/sites-available/air-drawing /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

# Install SSL certificate (Let's Encrypt)
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

---

## 📊 Deployment Comparison

| Feature | Hugging Face | Railway | Cloud Run | AWS EC2 |
|---------|-------------|---------|-----------|---------|
| **Cost** | FREE | $5-10/mo | $10-30/mo | $30-50/mo |
| **Setup Time** | 10 min | 5 min | 20 min | 30 min |
| **GPU Support** | ✅ Free | ❌ | ❌ | ✅ Paid |
| **Auto-scaling** | ✅ | ✅ | ✅ | ❌ |
| **HTTPS** | ✅ Auto | ✅ Auto | ✅ Auto | Manual |
| **Best For** | ML Projects | Quick Deploy | Production | Full Control |

---

## 🎓 For Your B.Tech Project Presentation

### What to Show Your Instructor:

1. **Live Demo URL** (from Hugging Face Spaces)
2. **GitHub Repository** with clean code
3. **Documentation** (PROJECT_DOCUMENTATION.md)
4. **Architecture Diagram** (from documentation)
5. **Performance Metrics:**
   - Model accuracy
   - Response time
   - Supported gestures

### Presentation Tips:

```
1. Start with problem statement
2. Explain why local model (no API)
3. Show live demo:
   - Hand tracking
   - Air drawing
   - OCR recognition
   - PDF viewer
4. Explain architecture
5. Show code highlights:
   - Gesture classification
   - Image preprocessing
   - TrOCR integration
6. Discuss challenges and solutions
7. Future improvements
```

---

## 🔧 Post-Deployment Maintenance

### Monitor Application:
```bash
# Check if app is running
curl https://your-app-url/health

# Expected response:
{
  "status": "ok",
  "frontend": true,
  "model": true,
  "ocr": {
    "backend": "trocr",
    "device": "cuda",
    "model_ref": "microsoft/trocr-large-handwritten"
  }
}
```

### Update Deployment:
```bash
# Make code changes locally
git add .
git commit -m "Update: description of changes"

# Push to deployment
git push space main  # For Hugging Face
# OR
git push origin main  # For Railway/Cloud Run (auto-deploys)
```

### Check Logs:
```bash
# Hugging Face: Click "Logs" tab in Space
# Railway: Click "Deployments" → "View Logs"
# Cloud Run: gcloud run services logs read air-drawing-app
# AWS EC2: docker logs -f air-drawing
```

---

## ✅ Final Checklist

Before submitting your project:

- [ ] Application deployed and accessible via URL
- [ ] All features working (drawing, OCR, PDF viewer)
- [ ] Documentation complete
- [ ] GitHub repository clean (no venv/, no large files)
- [ ] README.md has clear instructions
- [ ] Demo video recorded (optional but recommended)
- [ ] Presentation slides prepared
- [ ] Code comments added
- [ ] Performance tested with multiple users

---

## 🆘 Emergency Troubleshooting

### App won't start:
```bash
# Check logs for errors
# Common issues:
# 1. Port already in use → Change port in config
# 2. Model download failed → Check internet connection
# 3. Missing dependencies → Rebuild Docker image
```

### OCR not working:
```bash
# Test model loading:
python -c "from backend.ocr import _get_trocr_engine; print(_get_trocr_engine().available)"

# Should print: True
```

### WebSocket connection fails:
```bash
# Check CORS settings in backend/main.py
# Ensure allow_origins includes your deployment URL
```

---

## 📞 Support

If you encounter issues:

1. Check logs first
2. Review documentation
3. Search GitHub issues
4. Ask on Hugging Face forums
5. Contact: [your-email]

---

**Good luck with your B.Tech project! 🎓🚀**
