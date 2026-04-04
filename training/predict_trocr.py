import argparse
from pathlib import Path

import cv2
import numpy as np
import torch
from PIL import Image
from transformers import TrOCRProcessor, VisionEncoderDecoderModel


def ensure_bgr(img):
    if img is None:
        return None
    if len(img.shape) == 2:
        return cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    if img.shape[2] == 4:
        alpha = img[:, :, 3].astype(np.float32) / 255.0
        rgb = img[:, :, :3].astype(np.float32)
        white = np.full_like(rgb, 255.0)
        blended = rgb * alpha[:, :, None] + white * (1.0 - alpha[:, :, None])
        return blended.astype(np.uint8)
    return img


def to_grayscale(img):
    if img is None:
        return None
    if len(img.shape) == 2:
        gray = img
    else:
        bgr = ensure_bgr(img)
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    if np.mean(gray) < 127:
        gray = cv2.bitwise_not(gray)
    return gray


def crop_to_content(img, pad=24):
    if img is None:
        return None

    working = ensure_bgr(img)
    gray = cv2.cvtColor(working, cv2.COLOR_BGR2GRAY)
    if np.mean(gray) < 127:
        gray = cv2.bitwise_not(gray)
    mask = gray < 245

    coords = np.column_stack(np.where(mask))
    if coords.size == 0:
        return None

    y1, x1 = coords.min(axis=0)
    y2, x2 = coords.max(axis=0)
    y1 = max(0, y1 - pad)
    x1 = max(0, x1 - pad)
    y2 = min(working.shape[0], y2 + pad + 1)
    x2 = min(working.shape[1], x2 + pad + 1)
    return working[y1:y2, x1:x2]


def prepare_image(path, min_width=256, min_height=96):
    img = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
    cropped = crop_to_content(img)
    if cropped is None:
        raise SystemExit(f"No handwriting found in {path}")

    gray = to_grayscale(cropped)
    height, width = gray.shape[:2]
    canvas = np.full((max(min_height, height), max(min_width, width)), 255, dtype=np.uint8)
    dy = (canvas.shape[0] - height) // 2
    dx = (canvas.shape[1] - width) // 2
    canvas[dy:dy + height, dx:dx + width] = gray
    rgb = cv2.cvtColor(canvas, cv2.COLOR_GRAY2RGB)
    return Image.fromarray(rgb)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", default="microsoft/trocr-large-handwritten")
    parser.add_argument("--image", required=True)
    parser.add_argument("--mode", default="sentence", choices=["word", "line", "sentence"])
    args = parser.parse_args()

    device = "cuda" if torch.cuda.is_available() else "cpu"
    processor = TrOCRProcessor.from_pretrained(args.model_dir)
    model = VisionEncoderDecoderModel.from_pretrained(args.model_dir).to(device)
    model.eval()

    image = prepare_image(Path(args.image))
    pixel_values = processor(image, return_tensors="pt").pixel_values.to(device)
    max_new_tokens = {"word": 16, "line": 48, "sentence": 64}[args.mode]

    with torch.inference_mode():
        generated_ids = model.generate(
            pixel_values,
            max_new_tokens=max_new_tokens,
            num_beams=1,
        )

    text = processor.batch_decode(generated_ids, skip_special_tokens=True)[0]
    print(" ".join(text.split()).strip())


if __name__ == "__main__":
    main()
