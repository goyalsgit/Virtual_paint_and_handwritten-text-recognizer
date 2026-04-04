import argparse
import json
import random
from pathlib import Path


def read_split_ids(path: Path) -> set[str]:
    ids = set()
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            ids.add(line.split()[0])
    return ids


def words_image_path(words_root: Path, word_id: str) -> Path:
    parts = word_id.split("-")
    if len(parts) < 3:
        raise ValueError(f"Unexpected IAM word id: {word_id}")
    folder_a = parts[0]
    folder_b = f"{parts[0]}-{parts[1]}"
    return words_root / folder_a / folder_b / f"{word_id}.png"


def parse_words_txt(words_txt: Path, words_root: Path) -> list[dict]:
    rows = []
    with words_txt.open("r", encoding="utf-8") as f:
        for raw_line in f:
            line = raw_line.rstrip("\n")
            if not line or line.startswith("#"):
                continue

            parts = line.split()
            if len(parts) < 9:
                continue
            if parts[1] != "ok":
                continue

            word_id = parts[0]
            text = " ".join(parts[8:]).strip()
            if not text:
                continue

            image_path = words_image_path(words_root, word_id)
            if not image_path.exists():
                continue

            rows.append(
                {
                    "id": word_id,
                    "image": str(image_path),
                    "text": text,
                }
            )
    return rows


def split_rows(rows: list[dict], seed: int, val_ratio: float, test_ratio: float) -> dict[str, list[dict]]:
    shuffled = list(rows)
    random.Random(seed).shuffle(shuffled)

    n_total = len(shuffled)
    n_test = int(n_total * test_ratio)
    n_val = int(n_total * val_ratio)

    return {
        "test": shuffled[:n_test],
        "val": shuffled[n_test:n_test + n_val],
        "train": shuffled[n_test + n_val:],
    }


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps({"image": row["image"], "text": row["text"]}, ensure_ascii=True) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Prepare IAM word-level manifests for TrOCR fine-tuning."
    )
    parser.add_argument(
        "--iam-root",
        required=True,
        help="Path to extracted IAM dataset root containing ascii/ and words/",
    )
    parser.add_argument(
        "--output-dir",
        default="data/iam_manifests",
        help="Output directory for train/val/test JSONL manifests",
    )
    parser.add_argument(
        "--train-ids",
        default="",
        help="Optional file with IAM ids for train split",
    )
    parser.add_argument(
        "--val-ids",
        default="",
        help="Optional file with IAM ids for validation split",
    )
    parser.add_argument(
        "--test-ids",
        default="",
        help="Optional file with IAM ids for test split",
    )
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--val-ratio", type=float, default=0.1)
    parser.add_argument("--test-ratio", type=float, default=0.05)
    args = parser.parse_args()

    iam_root = Path(args.iam_root)
    words_txt = iam_root / "ascii" / "words.txt"
    words_root = iam_root / "words"
    if not words_txt.exists():
        raise SystemExit(f"Missing file: {words_txt}")
    if not words_root.exists():
        raise SystemExit(f"Missing folder: {words_root}")

    rows = parse_words_txt(words_txt, words_root)
    if not rows:
        raise SystemExit("No valid IAM word samples found.")

    split_files = [args.train_ids, args.val_ids, args.test_ids]
    use_explicit_splits = any(split_files)

    if use_explicit_splits and not all(split_files):
        raise SystemExit("If using explicit split files, provide train, val, and test ids.")

    if use_explicit_splits:
        train_ids = read_split_ids(Path(args.train_ids))
        val_ids = read_split_ids(Path(args.val_ids))
        test_ids = read_split_ids(Path(args.test_ids))
        split_map = {"train": [], "val": [], "test": []}

        for row in rows:
            row_id = row["id"]
            if row_id in train_ids:
                split_map["train"].append(row)
            elif row_id in val_ids:
                split_map["val"].append(row)
            elif row_id in test_ids:
                split_map["test"].append(row)
    else:
        split_map = split_rows(rows, args.seed, args.val_ratio, args.test_ratio)

    output_dir = Path(args.output_dir)
    write_jsonl(output_dir / "train.jsonl", split_map["train"])
    write_jsonl(output_dir / "val.jsonl", split_map["val"])
    write_jsonl(output_dir / "test.jsonl", split_map["test"])

    print(
        f"Prepared IAM manifests: train={len(split_map['train'])} "
        f"val={len(split_map['val'])} test={len(split_map['test'])}"
    )


if __name__ == "__main__":
    main()
