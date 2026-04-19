# Training Guide

This folder contains the full TrOCR training pipeline used by this project.

## Files in this folder

- training/prepare_manifests.py
- training/train_trocr.py
- training/predict_trocr.py
- training/requirements.txt

## End-to-end training flow

1. Collect labeled samples from the app.
2. Verify custom_dataset/labels.csv and custom_dataset/images are correct.
3. Build train/val/test manifests.
4. Fine-tune TrOCR on those manifests.
5. Test the trained checkpoint.

## Install dependencies

```bash
pip install -r training/requirements.txt
```

## Build manifests

This reads custom_dataset/labels.csv and writes:

- data/manifests/train.jsonl
- data/manifests/val.jsonl
- data/manifests/test.jsonl

```bash
python training/prepare_manifests.py
```

Optional split ratios:

```bash
python training/prepare_manifests.py --val-ratio 0.1 --test-ratio 0.05
```

## Fine-tune TrOCR

```bash
python training/train_trocr.py \
  --train-manifest data/manifests/train.jsonl \
  --val-manifest data/manifests/val.jsonl \
  --test-manifest data/manifests/test.jsonl \
  --output-dir artifacts/trocr_airdraw
```

Best checkpoint is saved under:

- artifacts/trocr_airdraw/best

## Test a checkpoint

Use one sample image from custom_dataset/images:

```bash
python training/predict_trocr.py \
  --model-dir artifacts/trocr_large_model \
  --image custom_dataset/images/20260408T043647061329.png \
  --mode sentence
```

You can replace model-dir with your own trained checkpoint, for example:

```bash
python training/predict_trocr.py \
  --model-dir artifacts/trocr_airdraw/best \
  --image custom_dataset/images/20260408T043647061329.png \
  --mode sentence
```
