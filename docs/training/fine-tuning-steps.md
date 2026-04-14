# Fine-Tuning Steps From `custom_dataset`

This guide shows the complete pipeline for fine-tuning TrOCR from only your custom dataset folder and the Microsoft handwritten base model.

Use this flow when you want to start from:
- `custom_dataset/images/`
- `custom_dataset/labels.csv`
- `microsoft/trocr-large-handwritten`

## What you need on the GPU server

1. Clone or copy the repository.
2. Copy your `custom_dataset/` folder into the repo root.
3. Install the Python dependencies from `training/requirements.txt`.
4. Make sure the server can download Hugging Face models the first time.

## Recommended dataset size

Do not fine-tune with just a handful of images.

- Rough experiment: `200-500` labeled samples
- Better starting point: `1000+` samples
- Validation split: about `10%`
- Test split: about `5%`

If the dataset is small, the model may overfit quickly.

## Step 1: Install dependencies on the GPU server

```bash
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r training/requirements.txt
```

If you are running in a notebook environment on the GPU server, use the notebook cell that installs the same packages.

## Step 2: Download the base model from Hugging Face

Use the notebook cell or this Python code:

```python
from transformers import TrOCRProcessor, VisionEncoderDecoderModel
from pathlib import Path

base_model_dir = Path("artifacts/base_models/microsoft_trocr_large_handwritten")
base_model_dir.mkdir(parents=True, exist_ok=True)

processor = TrOCRProcessor.from_pretrained("microsoft/trocr-large-handwritten")
model = VisionEncoderDecoderModel.from_pretrained("microsoft/trocr-large-handwritten")

processor.save_pretrained(base_model_dir)
model.save_pretrained(base_model_dir)
```

This creates a real local checkpoint. A checkpoint is valid only if it contains a weight file such as `model.safetensors` or `pytorch_model.bin`.

## Step 3: Convert `custom_dataset/labels.csv` into manifests

Your CSV should look like this:

```csv
image,text
20260402T070012849907.png,devansh
20260403T121705489250.png,Devansh Goyal
```

Then convert it into JSONL manifests for training.

Use the notebook cell or this standalone code:

```python
from pathlib import Path
import csv
import json
import random

root = Path.cwd()
labels_csv = root / "custom_dataset" / "labels.csv"
images_dir = root / "custom_dataset" / "images"
manifests_dir = root / "data" / "manifests"

rows = []
with labels_csv.open("r", encoding="utf-8", newline="") as f:
    reader = csv.DictReader(f)
    for row in reader:
        image_name = (row.get("image") or "").strip()
        text = (row.get("text") or "").strip()
        if not image_name or not text:
            continue
        image_path = images_dir / image_name
        if image_path.exists():
            rows.append({"image": str(image_path), "text": text})

random.Random(42).shuffle(rows)
count = len(rows)
count_test = max(1, int(count * 0.05)) if count >= 20 else 0
count_val = max(1, int(count * 0.10))
if count_val + count_test >= count:
    count_val = 1
    count_test = 0
count_train = count - count_val - count_test

train_rows = rows[:count_train]
val_rows = rows[count_train:count_train + count_val]
test_rows = rows[count_train + count_val:]

manifests_dir.mkdir(parents=True, exist_ok=True)
for filename, subset in [("train.jsonl", train_rows), ("val.jsonl", val_rows), ("test.jsonl", test_rows)]:
    with (manifests_dir / filename).open("w", encoding="utf-8") as f:
        for item in subset:
            f.write(json.dumps(item, ensure_ascii=True) + "\n")
```

This creates:
- `data/manifests/train.jsonl`
- `data/manifests/val.jsonl`
- `data/manifests/test.jsonl`

## Step 4: Fine-tune TrOCR on the GPU

The standard training script in this repo is `training/train_trocr.py`.

Run it like this:

```bash
python training/train_trocr.py \
  --train-manifest data/manifests/train.jsonl \
  --val-manifest data/manifests/val.jsonl \
  --test-manifest data/manifests/test.jsonl \
  --model-name artifacts/base_models/microsoft_trocr_large_handwritten \
  --output-dir artifacts/trocr_finetuned \
  --epochs 5 \
  --train-batch-size 4 \
  --eval-batch-size 4 \
  --gradient-accumulation-steps 2 \
  --learning-rate 5e-5 \
  --warmup-ratio 0.1 \
  --max-target-length 64 \
  --dataloader-num-workers 2 \
  --save-total-limit 2 \
  --fp16
```

If your GPU is smaller, reduce `--train-batch-size` to `2` or `1` and increase `--gradient-accumulation-steps`.

## Step 5: Check that the checkpoint has weights

After training, look in:

```text
artifacts/trocr_finetuned/best
```

That folder should contain a weight file such as:
- `model.safetensors`
- `pytorch_model.bin`

If it only has config/tokenizer files, the checkpoint is incomplete.

## Step 6: Make it usable locally in this repo

Copy the best checkpoint files into the deploy folder used by the backend:

```bash
cp artifacts/trocr_finetuned/best/* artifacts/trocr_finetuned/
```

Or set the environment variable to point directly at the trained checkpoint:

```bash
export AIRDRAW_OCR_MODEL=/full/path/to/artifacts/trocr_finetuned/best
```

The backend in `backend/ocr.py` checks `AIRDRAW_OCR_MODEL` first, then the local artifacts folders.

## Step 7: Run the app locally

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Then open:

```text
http://localhost:8000
```

## What to monitor while training

The training script reports:
- `CER` = character error rate
- `WER` = word error rate

Lower is better for both.

## Standard fine-tuning advice

- Start from `microsoft/trocr-large-handwritten`.
- Use fp16 on GPU if supported.
- Keep labels clean and consistent.
- Use many real samples from your app, not just synthetic ones.
- Fine-tune with early validation checks, not only final test metrics.
- Save the best checkpoint, not just the last checkpoint.

## Quick summary

1. Put your data in `custom_dataset/images/` and `custom_dataset/labels.csv`.
2. Download `microsoft/trocr-large-handwritten` locally.
3. Build `train.jsonl`, `val.jsonl`, and `test.jsonl`.
4. Run `training/train_trocr.py` on the GPU server.
5. Verify weights exist in `artifacts/trocr_finetuned/best`.
6. Copy that checkpoint back here and run `uvicorn main:app --reload`.
