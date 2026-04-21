# ─────────────────────────────────────────────
# Air Drawing App — Production Dockerfile
# Build from the project root:
#   docker build -t air-drawing-app .
#   docker run -p 8000:8000 air-drawing-app
# ─────────────────────────────────────────────
FROM python:3.11-slim

# System libraries required by OpenCV
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies first (layer caching)
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy the entire project
COPY backend/         ./backend/
COPY frontend/        ./frontend/
COPY hand_landmarker.task ./hand_landmarker.task

# ═══════════════════════════════════════════════════════════════
# MODEL CONFIGURATION - Download model on startup instead of copying
# This avoids Git LFS issues and makes deployment faster
# ═══════════════════════════════════════════════════════════════

# Create directories for model (will be downloaded on first run)
RUN mkdir -p ./artifacts/trocr_large_model ./custom_dataset

# Note: Model will be auto-downloaded from Hugging Face Hub on first startup
# This is faster and avoids large file upload issues

EXPOSE 7860

# Run from /app so relative paths (frontend/, hand_landmarker.task) resolve correctly
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
