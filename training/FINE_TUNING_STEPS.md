# Fine-Tuning Steps

This guide shows how to fine-tune the word-level OCR model in this repo using your collected air-drawing samples.

## What this repo already has

- Collected samples manifest: `data/collected/words_manifest.jsonl`
- Split generator: `training/prepare_manifests.py`
- TrOCR training script: `training/train_trocr.py`

Use this flow when you want to recognize full words like `hello`, `devansh`, or `open ai`.

## Before you start

1. Activate your virtual environment.

```bash
source venv/bin/activate
```

2. Install training dependencies.

```bash
pip install -r training/requirements.txt
```

3. Check that your collected manifest exists.

```bash
ls data/collected/words_manifest.jsonl
```

## Recommended dataset size

Do not fine-tune with only a few examples.

- Minimum for a rough experiment: `200-500` labeled word images
- Better starting point: `1000+` samples
- Keep around `10%` for validation
- Keep around `5-10%` for test

Right now this repo appears to have only a very small number of samples collected, so first collect more examples from the app.

## Step 1: Collect labeled samples

Use the app and save clean word images with labels.

Each row in `data/collected/words_manifest.jsonl` should look like this:

```json
{"image": "data/collected/words/train/sample.png", "text": "hello", "split": "train"}
```

Important:

- The `image` path must exist
- The `text` value must be the correct word
- The `split` should be `train`, `val`, or `test`

## Step 2: Build training manifests

If your data already includes `split`, the script will keep those assignments.
If some rows do not include a split, the script will automatically divide them.

Run:

```bash
python training/prepare_manifests.py
```

This creates:

- `data/manifests/train.jsonl`
- `data/manifests/val.jsonl`
- `data/manifests/test.jsonl`

## Step 3: Inspect the generated files

Check the first few rows:

```bash
sed -n '1,5p' data/manifests/train.jsonl
sed -n '1,5p' data/manifests/val.jsonl
sed -n '1,5p' data/manifests/test.jsonl
```

Each row should look like:

```json
{"image": "data/collected/words/train/sample.png", "text": "hello"}
```

## Step 4: Start fine-tuning TrOCR

Run the training command:

```bash
python training/train_trocr.py \
  --train-manifest data/manifests/train.jsonl \
  --val-manifest data/manifests/val.jsonl \
  --output-dir artifacts/trocr_airdraw \
  --epochs 5
```

## Step 5: Find the trained model

After training finishes, the best checkpoint will be saved here:

- `artifacts/trocr_airdraw/best`

That folder contains the model and processor files used for inference.
This repo's backend will automatically use that checkpoint when it exists.

## Step 6: What metrics to watch

This training script reports:

- `CER` = character error rate
- `WER` = word error rate

Lower is better for both.

As a rough rule:

- High `WER` means the predicted words are still often wrong
- Falling `CER` means the model is learning spelling and stroke patterns better

## Step 7: Improve the model

If results are weak, improve data quality before changing the model.

- Add more real app samples
- Keep labels perfectly correct
- Include different writing speeds and stroke sizes
- Include common words users will actually draw
- Keep images tightly cropped and clean
- Avoid mixing too many single-letter samples into a word model

## Useful rerun command

After collecting more data, rerun the same two commands:

```bash
python training/prepare_manifests.py
python training/train_trocr.py \
  --train-manifest data/manifests/train.jsonl \
  --val-manifest data/manifests/val.jsonl \
  --output-dir artifacts/trocr_airdraw \
  --epochs 5
```

## Quick summary

1. Collect many labeled word images in `data/collected/words_manifest.jsonl`
2. Run `python training/prepare_manifests.py`
3. Run `python training/train_trocr.py --train-manifest data/manifests/train.jsonl --val-manifest data/manifests/val.jsonl --output-dir artifacts/trocr_airdraw --epochs 5`
4. Use the model saved in `artifacts/trocr_airdraw/best`
