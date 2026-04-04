import argparse
import json
import random
from pathlib import Path


def load_jsonl(path):
    rows = []
    if not path.exists():
        return rows
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
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
        default="data/collected/words_manifest.jsonl",
        help="Collected dataset manifest path",
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
    rows = load_jsonl(input_path)
    if not rows:
        raise SystemExit(f"No samples found in {input_path}")

    explicit = {"train": [], "val": [], "test": []}
    unsplit = []
    for row in rows:
        split = row.get("split")
        if split in explicit:
            explicit[split].append({"image": row["image"], "text": row["text"]})
        else:
            unsplit.append({"image": row["image"], "text": row["text"]})

    random.Random(args.seed).shuffle(unsplit)
    n_total = len(unsplit)
    n_test = int(n_total * args.test_ratio)
    n_val = int(n_total * args.val_ratio)

    explicit["test"].extend(unsplit[:n_test])
    explicit["val"].extend(unsplit[n_test:n_test + n_val])
    explicit["train"].extend(unsplit[n_test + n_val:])

    output_dir = Path(args.output_dir)
    write_jsonl(output_dir / "train.jsonl", explicit["train"])
    write_jsonl(output_dir / "val.jsonl", explicit["val"])
    write_jsonl(output_dir / "test.jsonl", explicit["test"])

    print(
        f"train={len(explicit['train'])} val={len(explicit['val'])} test={len(explicit['test'])}"
    )


if __name__ == "__main__":
    main()
