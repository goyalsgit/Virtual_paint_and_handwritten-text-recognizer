# Air Drawing App

Air-gesture drawing app that converts the drawn handwriting into text with TrOCR (Microsoft).

Hand tracking runs entirely in the browser via MediaPipe. The Python backend receives the cleaned canvas and runs OCR.

Project explanation:
- [Markdown source](docs/project-explanation.md)
- [PDF version](docs/project-explanation.pdf)

Additional documentation:
- [Backend documentation](docs/backend-documentation.md)
- [Colab training guide](docs/training/colab-trocr-guide.md)
- [Fine-tuning steps](docs/training/fine-tuning-steps.md)

---

## Project structure

```text
air-drawing-app/
├── backend/              # FastAPI server and OCR pipeline
├── frontend/             # Browser UI and MediaPipe hand tracking
├── training/             # Training and prediction scripts
├── docs/                 # Project, backend, and training documentation
├── artifacts/            # OCR debug output and local trained models
├── data/                 # Collected samples and generated manifests
├── hand_landmarker.task  # MediaPipe hand tracking model
└── README.md
```

---

## Run locally

```bash
# From the project root
source venv/bin/activate
pip install -r backend/requirements.txt   # first time only

uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

Open **http://localhost:8000**.
Use a modern browser and allow camera permission. Opening the app from a file path or non-localhost host can break webcam access.

---

## Deploy with Docker

Build and run from the **project root**:

```bash
docker build -t air-drawing-app .
docker run -p 8000:8000 air-drawing-app
```

Open **http://localhost:8000**.

The image bundles the frontend, MediaPipe vendor files, `hand_landmarker.task`, and the backend.  
The first OCR request will download `microsoft/trocr-large-handwritten` from Hugging Face (~1.4 GB).  
To pre-bake the model, set `AIRDRAW_OCR_MODEL` to a local path and copy it into the image.

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `AIRDRAW_OCR_MODEL` | *(auto)* | Override the TrOCR model path or HuggingFace ID |
| `PORT` | `8000` | Set if your host overrides the port |

### Deploy to Railway / Render / Fly.io

These platforms auto-detect the root `Dockerfile`. Just push your repo — no extra config needed.  
The WebSocket URL is auto-detected from `window.location`, so it works on any domain with no changes.

---

## OCR behaviour

- Default: `microsoft/trocr-large-handwritten` (downloaded on first use).
- If `artifacts/trocr_airdraw/best/` exists, the backend picks it up automatically.
- Inspect the active backend at `http://localhost:8000/health`.

---

## Training your own model

1. Open the app, write, and click **Save Sample** to collect labeled data.
2. Prepare manifests:
   ```bash
   python training/prepare_manifests.py
   ```
3. Install training deps:
   ```bash
   pip install -r training/requirements.txt
   ```
4. Fine-tune:
   ```bash
   python training/train_trocr.py \
     --train-manifest data/manifests/train.jsonl \
     --val-manifest   data/manifests/val.jsonl \
     --output-dir     artifacts/trocr_airdraw \
     --epochs 5
   ```

Restart the backend — it will use `artifacts/trocr_airdraw/best` automatically.
