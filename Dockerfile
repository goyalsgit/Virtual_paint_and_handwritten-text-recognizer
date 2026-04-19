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
# MODEL CONFIGURATION - Choose which model to copy
# ═══════════════════════════════════════════════════════════════

# Option 1: Copy fine-tuned BASE model (400MB - RECOMMENDED for deployment)
COPY artifacts/trocr_base_finetuned/ ./artifacts/trocr_base_finetuned/

# Option 2: Copy fine-tuned LARGE model (2.3GB - best accuracy, slow deployment)
# Uncomment this line and comment out Option 1 to use large model:
# COPY artifacts/trocr_large_model/ ./artifacts/trocr_large_model/

# Optional: copy training dataset to show your work
COPY custom_dataset/  ./custom_dataset/

EXPOSE 8000

# Run from /app so relative paths (frontend/, hand_landmarker.task) resolve correctly
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
