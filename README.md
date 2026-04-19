# Air Drawing App

Air Drawing App lets you write in the air with hand gestures and convert that handwriting into text using a local TrOCR model.

Hand tracking runs in the browser with MediaPipe. The Python backend receives the cleaned canvas image and runs OCR.

## Project Structure

```text
air-drawing-app/
├── backend/                 # FastAPI backend and OCR pipeline
├── frontend/                # Browser UI, webcam view, hand tracking, drawing
├── training/                # Dataset split + fine-tuning scripts
├── custom_dataset/          # Your master dataset
│   ├── images/              # All cropped handwriting images
│   └── labels.csv           # Master label file: image,text
├── data/
│   └── manifests/           # Generated train/val/test manifests
├── artifacts/               # OCR debug images and trained checkpoints
├── docs/                    # Extra project and training docs
├── hand_landmarker.task     # MediaPipe hand tracking model
├── setup.sh                 # One-command local setup
└── README.md
```

## What To Commit

Commit these:
- source code
- `custom_dataset/` if you want to share your dataset
- `requirements.txt` files
- `setup.sh`
- `README.md`

Do not commit these:
- `venv/`
- `__pycache__/`
- `artifacts/ocr_debug/`
- large local checkpoints unless you intentionally want them in the repo

`venv/` is ignored on purpose. Other people should recreate it locally.

## Complete Local Setup

### 1. Clone the repo

```bash
git clone <your-repo-url>
cd air-drawing-app
```

### 2. Create the virtual environment and install dependencies

Recommended:

```bash
./setup.sh
```

This script:
- creates `venv/`
- installs backend dependencies
- installs training dependencies

If you want to do it manually:

```bash
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r backend/requirements.txt
pip install -r training/requirements.txt
```

### 3. Run the backend

```bash
source venv/bin/activate
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

Open:

```text
http://localhost:8000
```

PDF viewer route:

```text
http://localhost:8000/pdfviewer
```

### 4. Check that the app is healthy

Open:

```text
http://localhost:8000/health
```

You should see JSON showing:
- backend status
- frontend available
- hand model available
- OCR model status

## How The App Works

### Frontend

The frontend:
- opens your webcam
- tracks your hand using MediaPipe
- lets you draw with gestures
- prepares a clean handwriting image
- sends that image to the backend

Main file:
- `frontend/index.html`

### Backend

The backend:
- serves the frontend
- receives OCR requests over WebSocket
- saves labeled samples to `custom_dataset/`
- preprocesses images for OCR
- runs TrOCR locally

Main files:
- `backend/main.py`
- `backend/ocr.py`

## Dataset Format

This repo now uses a very simple dataset layout:

```text
custom_dataset/
├── images/
│   ├── 20260408T043647061329.png
│   ├── 20260408T043737913034.png
│   └── ...
└── labels.csv
```

`labels.csv` format:

```csv
image,text
20260408T043647061329.png,happy
20260408T043737913034.png,shivam
```

Important rules:
- `image` must be only the filename, not the full path
- the image file must exist inside `custom_dataset/images/`
- `text` must be the exact correct label

## Saving Samples From The App

When you run the app and click `Save Sample`:
- the image is saved into `custom_dataset/images/`
- the label is appended to `custom_dataset/labels.csv`

So this folder is your master dataset.

## Recommended Dataset Practice

For proper training, keep the dataset consistent.

Best practice:
- use only words if you want a word model
- use only lines/sentences if you want a line model

Avoid mixing:
- single letters
- words
- long sentences

in the same training run.

## Generate Train / Val / Test Splits

You said you want to split later. This repo supports that.

Run:

```bash
source venv/bin/activate
python training/prepare_manifests.py
```

This reads:

```text
custom_dataset/labels.csv
```

and creates:

```text
data/manifests/train.jsonl
data/manifests/val.jsonl
data/manifests/test.jsonl
```

You can control ratios:

```bash
python training/prepare_manifests.py --val-ratio 0.1 --test-ratio 0.05
```

## Train Your Local TrOCR Model

### 1. Generate manifests

```bash
python training/prepare_manifests.py
```

### 2. Start training

```bash
python training/train_trocr.py \
  --train-manifest data/manifests/train.jsonl \
  --val-manifest data/manifests/val.jsonl \
  --test-manifest data/manifests/test.jsonl \
  --output-dir artifacts/trocr_airdraw
```

### 3. Training output

Your trained model will be saved in:

```text
artifacts/trocr_airdraw/best
```

## Use The Trained Model In The App

The backend model resolution is already wired.

Priority order used by backend/ocr.py:

1. AIRDRAW_OCR_MODEL environment variable (explicit override)
2. artifacts/trocr_large_model (if model weights exist)
3. artifacts/trocr_airdraw/best (if model weights exist)
4. microsoft/trocr-large-handwritten fallback

Recommended flow:
1. collect data
2. train model
3. save checkpoint into artifacts/trocr_airdraw/best
4. restart backend
5. test in browser

## Test A Checkpoint Manually

```bash
python training/predict_trocr.py \
  --model-dir artifacts/trocr_large_model \
  --image custom_dataset/images/20260408T043647061329.png \
  --mode sentence
```

If you trained your own checkpoint, replace model-dir with artifacts/trocr_airdraw/best.

## Run With Docker

Build:

```bash
docker build -t air-drawing-app .
```

Run:

```bash
docker run -p 8000:8000 air-drawing-app
```

Then open:

```text
http://localhost:8000
```

## Useful Files

- `backend/main.py`: server routes, sample saving, WebSocket OCR
- `backend/ocr.py`: OCR preprocessing and model inference
- `frontend/index.html`: UI and gesture drawing
- `training/prepare_manifests.py`: create train/val/test JSONL files
- `training/train_trocr.py`: fine-tune TrOCR
- `training/predict_trocr.py`: test a trained checkpoint
- `custom_dataset/labels.csv`: your master labels

## Quick Start

```bash
git clone <your-repo-url>
cd air-drawing-app
./setup.sh
source venv/bin/activate
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

Then:
- open `http://localhost:8000`
- save samples
- run `python training/prepare_manifests.py`
- train with `python training/train_trocr.py ...`

## Troubleshooting

### Port 8000 already in use

If startup fails with "address already in use":

```bash
lsof -nP -iTCP:8000 -sTCP:LISTEN
```

Then stop the conflicting process or run on another port:

```bash
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8001
```

### Push fails with large file or HTTP 500

If push fails while uploading multi-GB data, check if model artifacts were committed.
The large model folders are intended to stay local and are ignored by .gitignore.

Useful checks:

```bash
git log --stat origin/main..HEAD
git ls-files artifacts/trocr_large_model artifacts/trocr_finetuned
```

If needed, untrack those folders in a new commit while keeping local files:

```bash
git rm -r --cached artifacts/trocr_large_model artifacts/trocr_finetuned
git commit -m "stop tracking local model artifacts"
git push
```

