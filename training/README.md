# Training Guide

This project now keeps only the TrOCR path for handwritten text recognition.

Use these files:

- `training/COLAB_TROCR_GUIDE.md`
- `training/prepare_manifests.py`
- `training/prepare_iam_manifests.py`
- `training/train_trocr.py`
- `training/predict_trocr.py`

## Recommended path

1. Collect labeled samples from the app.
2. Build `train/val/test` manifests.
3. Fine-tune TrOCR.
4. Place the final checkpoint in `artifacts/trocr_airdraw/best`.

## Install training dependencies

```bash
pip install -r training/requirements.txt
```

## Build manifests from your own app data

```bash
python training/prepare_manifests.py
```

## Build manifests from IAM

```bash
python training/prepare_iam_manifests.py \
  --iam-root /path/to/iam \
  --output-dir data/iam_manifests
```

## Fine-tune TrOCR on your own data

```bash
python training/train_trocr.py \
  --train-manifest data/manifests/train.jsonl \
  --val-manifest data/manifests/val.jsonl \
  --test-manifest data/manifests/test.jsonl \
  --output-dir artifacts/trocr_airdraw
```

## Fine-tune TrOCR on IAM

```bash
python training/train_trocr.py \
  --train-manifest data/iam_manifests/train.jsonl \
  --val-manifest data/iam_manifests/val.jsonl \
  --test-manifest data/iam_manifests/test.jsonl \
  --output-dir artifacts/trocr_iam
```

## Test a checkpoint

```bash
python training/predict_trocr.py \
  --model-dir artifacts/trocr_airdraw/best \
  --image data/collected/words/train/20260402T070012849907.png \
  --mode sentence
```
