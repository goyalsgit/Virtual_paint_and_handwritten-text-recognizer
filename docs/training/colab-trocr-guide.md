# Colab TrOCR Guide

Use this when you want to train the strongest practical model for this app in Google Colab and then bring the trained checkpoint back into this repo.

## Best model to start from

Recommended:

```text
microsoft/trocr-large-handwritten
```

Why:

- It is the larger official TrOCR handwritten checkpoint.
- It is already fine-tuned on IAM handwriting.
- It is the strongest practical starting point for English handwritten text recognition in this repo.

If Colab runs out of memory, use:

```text
microsoft/trocr-base-handwritten
```

## Before opening Colab

Make sure your repo contains:

- `data/collected/words_manifest.jsonl`
- `data/collected/words/train/...`
- `data/collected/words/val/...`
- optionally `data/collected/words/test/...`

If your repo is local only, upload it to Google Drive or GitHub first.

## Colab runtime

In Colab:

1. Open `Runtime -> Change runtime type`
2. Select `GPU`
3. Save

## Cell 1: Mount Google Drive

```python
from google.colab import drive
drive.mount("/content/drive")
```

## Cell 2: Go to your repo

If your repo is in Google Drive:

```bash
%cd /content/drive/MyDrive/air-drawing-app
```

If your repo is on GitHub:

```bash
%cd /content
!git clone <YOUR_REPO_URL> air-drawing-app
%cd /content/air-drawing-app
```

## Cell 3: Install training dependencies

```bash
!pip install -r training/requirements.txt
```

## Cell 4: Build manifests from your labeled samples

```bash
!python training/prepare_manifests.py
```

This creates:

- `data/manifests/train.jsonl`
- `data/manifests/val.jsonl`
- `data/manifests/test.jsonl`

## Cell 5: Start training

Recommended command for Colab GPU:

```bash
!python training/train_trocr.py \
  --train-manifest data/manifests/train.jsonl \
  --val-manifest data/manifests/val.jsonl \
  --test-manifest data/manifests/test.jsonl \
  --model-name microsoft/trocr-large-handwritten \
  --output-dir artifacts/trocr_airdraw \
  --epochs 8 \
  --train-batch-size 2 \
  --eval-batch-size 2 \
  --gradient-accumulation-steps 8 \
  --learning-rate 3e-5 \
  --warmup-ratio 0.1 \
  --fp16
```

If you get CUDA out-of-memory, use one of these changes:

- change `microsoft/trocr-large-handwritten` to `microsoft/trocr-base-handwritten`
- lower `--train-batch-size` from `2` to `1`
- lower `--gradient-accumulation-steps` only if training becomes too slow

## Cell 6: Check final metrics

After training, inspect:

- `artifacts/trocr_airdraw/test_metrics.json`
- `artifacts/trocr_airdraw/train_config.json`

## Cell 7: Test one image quickly

```bash
!python training/predict_trocr.py \
  --model-dir artifacts/trocr_airdraw/best \
  --image data/collected/words/train/20260402T070012849907.png \
  --mode sentence
```

Replace the image path with any sample you want to test.

## Cell 8: Zip the trained model

```bash
!cd artifacts && zip -r trocr_airdraw_best.zip trocr_airdraw/best
```

The file will be:

```text
artifacts/trocr_airdraw_best.zip
```

## What to give back

Bring back either:

- `artifacts/trocr_airdraw/best/`

or:

- `artifacts/trocr_airdraw_best.zip`

Once that folder is placed in this repo at:

```text
artifacts/trocr_airdraw/best
```

the backend will automatically start using it.

If that folder is missing, the app now defaults to:

```text
microsoft/trocr-large-handwritten
```

## Minimal success criteria

Your model is good enough for the first integration if:

- prediction quality is clearly better than the base TrOCR model on your saved samples
- `CER` goes down across epochs
- `WER` is reasonable on your validation or test split

## Practical advice

- Train only on clean labeled canvas images from this app.
- Keep labels exact.
- Prefer one word or one short line per sample.
- Add more real app samples before changing models again.
