import argparse
import csv
import json
import random
from pathlib import Path


def load_labels_csv(path):
    rows = []
    if not path.exists():
        return rows
    images_dir = path.parent / "images"
    with path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            image_name = (row.get("image") or "").strip()
            text = (row.get("text") or "").strip()
            if not image_name or not text:
                continue
            rows.append(
                {
                    "image": str(images_dir / image_name),
                    "text": text,
                }
            )
    return rows


def write_jsonl(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=True) + "\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--input",
        default="custom_dataset/labels.csv",
        help="Master labels CSV path",
    )
    parser.add_argument(
        "--output-dir",
        default="data/manifests",
        help="Directory where train/val/test manifests will be written",
    )
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--val-ratio", type=float, default=0.1)
    parser.add_argument("--test-ratio", type=float, default=0.05)
    args = parser.parse_args()

    input_path = Path(args.input)
    rows = load_labels_csv(input_path)
    if not rows:
        raise SystemExit(f"No samples found in {input_path}")

    shuffled = list(rows)
    random.Random(args.seed).shuffle(shuffled)
    n_total = len(shuffled)
    n_test = int(n_total * args.test_ratio)
    n_val = int(n_total * args.val_ratio)

    explicit = {
        "test": shuffled[:n_test],
        "val": shuffled[n_test:n_test + n_val],
        "train": shuffled[n_test + n_val:],
    }

    output_dir = Path(args.output_dir)
    write_jsonl(output_dir / "train.jsonl", explicit["train"])
    write_jsonl(output_dir / "val.jsonl", explicit["val"])
    write_jsonl(output_dir / "test.jsonl", explicit["test"])

    print(
        f"train={len(explicit['train'])} val={len(explicit['val'])} test={len(explicit['test'])}"
    )


if __name__ == "__main__":
    main()
