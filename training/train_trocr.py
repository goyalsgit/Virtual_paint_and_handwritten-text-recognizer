import argparse
import json
from pathlib import Path

import jiwer
import numpy as np
from PIL import Image
from torch.utils.data import Dataset
from transformers import (
    Seq2SeqTrainer,
    Seq2SeqTrainingArguments,
    TrOCRProcessor,
    VisionEncoderDecoderModel,
    default_data_collator,
)


def load_jsonl(path):
    rows = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


class OCRDataset(Dataset):
    def __init__(self, manifest_path, processor, max_target_length=64):
        self.rows = load_jsonl(manifest_path)
        self.processor = processor
        self.max_target_length = max_target_length
        if not self.rows:
            raise ValueError(f"No rows found in {manifest_path}")

    def __len__(self):
        return len(self.rows)

    def __getitem__(self, idx):
        row = self.rows[idx]
        image = Image.open(row["image"]).convert("RGB")
        pixel_values = self.processor(image, return_tensors="pt").pixel_values.squeeze(0)
        labels = self.processor.tokenizer(
            row["text"],
            padding="max_length",
            max_length=self.max_target_length,
            truncation=True,
        ).input_ids
        labels = [label if label != self.processor.tokenizer.pad_token_id else -100 for label in labels]
        return {"pixel_values": pixel_values, "labels": labels}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--train-manifest", required=True)
    parser.add_argument("--val-manifest", required=True)
    parser.add_argument("--test-manifest", default="")
    parser.add_argument("--model-name", default="microsoft/trocr-large-handwritten")
    parser.add_argument("--output-dir", default="artifacts/trocr_airdraw")
    parser.add_argument("--epochs", type=int, default=5)
    parser.add_argument("--train-batch-size", type=int, default=8)
    parser.add_argument("--eval-batch-size", type=int, default=8)
    parser.add_argument("--gradient-accumulation-steps", type=int, default=1)
    parser.add_argument("--learning-rate", type=float, default=5e-5)
    parser.add_argument("--warmup-ratio", type=float, default=0.1)
    parser.add_argument("--max-target-length", type=int, default=64)
    parser.add_argument("--dataloader-num-workers", type=int, default=2)
    parser.add_argument("--save-total-limit", type=int, default=2)
    parser.add_argument("--fp16", action="store_true")
    parser.add_argument("--bf16", action="store_true")
    args = parser.parse_args()

    if args.fp16 and args.bf16:
        raise SystemExit("Use only one of --fp16 or --bf16")

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    config_to_save = vars(args).copy()
    with (output_dir / "train_config.json").open("w", encoding="utf-8") as f:
        json.dump(config_to_save, f, indent=2)

    processor = TrOCRProcessor.from_pretrained(args.model_name)
    model = VisionEncoderDecoderModel.from_pretrained(args.model_name)
    model.config.decoder_start_token_id = processor.tokenizer.cls_token_id
    model.config.pad_token_id = processor.tokenizer.pad_token_id
    model.config.eos_token_id = processor.tokenizer.sep_token_id
    model.generation_config.decoder_start_token_id = processor.tokenizer.cls_token_id
    model.generation_config.pad_token_id = processor.tokenizer.pad_token_id
    model.generation_config.eos_token_id = processor.tokenizer.sep_token_id
    model.generation_config.max_length = args.max_target_length
    model.generation_config.early_stopping = True
    model.generation_config.no_repeat_ngram_size = 0
    model.generation_config.length_penalty = 1.0
    model.generation_config.num_beams = 4

    train_ds = OCRDataset(args.train_manifest, processor, args.max_target_length)
    val_ds = OCRDataset(args.val_manifest, processor, args.max_target_length)
    test_ds = None
    if args.test_manifest:
        test_ds = OCRDataset(args.test_manifest, processor, args.max_target_length)

    print(
        f"train_samples={len(train_ds)} val_samples={len(val_ds)} "
        f"test_samples={len(test_ds) if test_ds is not None else 0}"
    )

    def compute_metrics(pred):
        pred_ids = pred.predictions
        label_ids = pred.label_ids
        pred_str = processor.batch_decode(pred_ids, skip_special_tokens=True)
        label_ids = np.where(label_ids == -100, processor.tokenizer.pad_token_id, label_ids)
        label_str = processor.batch_decode(label_ids, skip_special_tokens=True)
        cer = jiwer.cer(label_str, pred_str)
        wer = jiwer.wer(label_str, pred_str)
        return {"cer": cer, "wer": wer}

    training_args = Seq2SeqTrainingArguments(
        predict_with_generate=True,
        eval_strategy="epoch",
        save_strategy="epoch",
        logging_strategy="steps",
        logging_steps=50,
        per_device_train_batch_size=args.train_batch_size,
        per_device_eval_batch_size=args.eval_batch_size,
        gradient_accumulation_steps=args.gradient_accumulation_steps,
        num_train_epochs=args.epochs,
        learning_rate=args.learning_rate,
        warmup_ratio=args.warmup_ratio,
        fp16=args.fp16,
        bf16=args.bf16,
        output_dir=str(output_dir),
        save_total_limit=args.save_total_limit,
        load_best_model_at_end=True,
        metric_for_best_model="cer",
        greater_is_better=False,
        report_to=[],
        dataloader_num_workers=args.dataloader_num_workers,
        remove_unused_columns=False,
    )

    trainer = Seq2SeqTrainer(
        model=model,
        args=training_args,
        compute_metrics=compute_metrics,
        train_dataset=train_ds,
        eval_dataset=val_ds,
        data_collator=default_data_collator,
        processing_class=processor,
    )

    trainer.train()
    trainer.save_model(output_dir / "best")
    processor.save_pretrained(output_dir / "best")

    if test_ds is not None:
        test_metrics = trainer.predict(test_ds).metrics
        with (output_dir / "test_metrics.json").open("w", encoding="utf-8") as f:
            json.dump(test_metrics, f, indent=2)
        print(f"test_metrics={json.dumps(test_metrics, ensure_ascii=True)}")


if __name__ == "__main__":
    main()
