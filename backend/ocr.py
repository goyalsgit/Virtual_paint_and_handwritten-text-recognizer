import os   
import re
import time
from functools import lru_cache
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_TROCR_MODEL_DIR = PROJECT_ROOT / "artifacts" / "trocr_airdraw" / "best"
DEFAULT_TROCR_MODEL_ID = "microsoft/trocr-large-handwritten"
OCR_DEBUG_DIR = PROJECT_ROOT / "artifacts" / "ocr_debug"


def _ensure_bgr(img):
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


def _to_grayscale(img):
    if img is None:
        return None
    if len(img.shape) == 2:
        gray = img
    else:
        bgr = _ensure_bgr(img)
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    if np.mean(gray) < 127:
        gray = cv2.bitwise_not(gray)
    return gray


def _ink_mask(img):
    if img is None:
        return None

    if len(img.shape) == 3 and img.shape[2] == 4:
        alpha = img[:, :, 3]
        transparent_pixels = np.count_nonzero(alpha <= 16)
        opaque_pixels = np.count_nonzero(alpha > 16)
        if 0 < transparent_pixels < alpha.size and opaque_pixels > 0:
            return alpha > 16

    working = _ensure_bgr(img)
    gray = cv2.cvtColor(working, cv2.COLOR_BGR2GRAY)
    if np.mean(gray) < 127:
        gray = cv2.bitwise_not(gray)
    return gray < 240


def crop_to_content(img, pad=24):
    if img is None:
        return None

    working = _ensure_bgr(img)
    mask = _ink_mask(img)

    coords = np.column_stack(np.where(mask.astype(np.uint8)))
    if coords.size == 0:
        return None

    y1, x1 = coords.min(axis=0)
    y2, x2 = coords.max(axis=0)
    y1 = max(0, y1 - pad)
    x1 = max(0, x1 - pad)
    y2 = min(working.shape[0], y2 + pad + 1)
    x2 = min(working.shape[1], x2 + pad + 1)
    return working[y1:y2, x1:x2]


def _split_into_lines(img, pad=18):
    working = _ensure_bgr(img)
    mask = _ink_mask(img)
    if working is None or mask is None:
        return []

    row_activity = mask.sum(axis=1)
    if not np.any(row_activity):
        return []

    row_threshold = 5
    active_rows = row_activity > row_threshold

    ranges = []
    start = None
    for idx, active in enumerate(active_rows):
        if active and start is None:
            start = idx
        elif not active and start is not None:
            ranges.append([start, idx - 1])
            start = None
    if start is not None:
        ranges.append([start, len(active_rows) - 1])

    if not ranges:
        return []

    merged = []
    min_gap = max(8, pad // 2)
    for start_y, end_y in ranges:
        if not merged or start_y - merged[-1][1] > min_gap:
            merged.append([start_y, end_y])
        else:
            merged[-1][1] = end_y

    candidates = []
    for start_y, end_y in merged:
        segment = mask[start_y:end_y + 1, :]
        col_activity = segment.sum(axis=0)
        active_cols = np.where(col_activity > 0)[0]
        if active_cols.size == 0:
            continue
        x1 = max(0, int(active_cols[0]) - pad)
        x2 = min(working.shape[1], int(active_cols[-1]) + pad + 1)
        y1 = max(0, int(start_y) - pad)
        y2 = min(working.shape[0], int(end_y) + pad + 1)
        ink_pixels = int(mask[y1:y2, x1:x2].sum())
        candidates.append(
            {
                "image": working[y1:y2, x1:x2],
                "width": x2 - x1,
                "height": y2 - y1,
                "ink_pixels": ink_pixels,
            }
        )

    if not candidates:
        return []

    max_ink_pixels = max(candidate["ink_pixels"] for candidate in candidates)
    min_ink_pixels = max(64, int(max_ink_pixels * 0.12))

    lines = []
    for candidate in candidates:
        if candidate["width"] < 24 or candidate["height"] < 12:
            continue
        if candidate["ink_pixels"] < min_ink_pixels:
            continue
        lines.append(candidate["image"])

    return lines


def _prepare_trocr_image(
    img,
    mode="sentence",
    pad=24,
    min_width=256,
    min_height=96,
    preprocessed=False,
):
    cropped = crop_to_content(img, pad=pad)
    if cropped is None:
        return None

    gray = _to_grayscale(cropped)
    if not preprocessed:
        if np.std(gray) > 30:
            gray = cv2.bilateralFilter(gray, 3, 25, 25)
        _, gray = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY)

    # Use the natural dimensions of the cropped ink, only enforcing a small minimum
    height, width = gray.shape[:2]
    target_height = max(height, 64)
    target_width = max(width, 64)

    if target_height > height or target_width > width:
        canvas = np.full((target_height, target_width), 255, dtype=np.uint8)
        dy = (target_height - height) // 2
        dx = (target_width - width) // 2
        canvas[dy:dy + height, dx:dx + width] = gray
        gray = canvas

    rgb = cv2.cvtColor(gray, cv2.COLOR_GRAY2RGB)
    return Image.fromarray(rgb)


def _save_debug_prepared_images(prepared_images, mode):
    if not prepared_images:
        return

    OCR_DEBUG_DIR.mkdir(parents=True, exist_ok=True)
    prepared_dir = OCR_DEBUG_DIR / "prepared"
    prepared_dir.mkdir(parents=True, exist_ok=True)

    for old_file in prepared_dir.glob("latest_*.png"):
        try:
            old_file.unlink()
        except OSError:
            pass

    timestamp = str(int(time.time() * 1000))
    for idx, image in enumerate(prepared_images):
        latest_path = prepared_dir / f"latest_{mode}_{idx:02d}.png"
        image.save(latest_path)
        image.save(prepared_dir / f"{timestamp}_{mode}_{idx:02d}.png")


class _TrOCREngine:
    def __init__(self, model_ref):
        self.model_ref = str(model_ref)
        self.available = False
        self.error = ""
        self.device = "cpu"
        self.processor = None
        self.model = None
        self.torch = None

        try:
            import torch
            from transformers import TrOCRProcessor, VisionEncoderDecoderModel
        except Exception as exc:
            self.error = f"missing TrOCR dependencies: {exc}"
            return

        try:
            self.torch = torch
            self.device = "cuda" if torch.cuda.is_available() else "cpu"
            model_kwargs = {}
            if self.device == "cuda":
                model_kwargs["torch_dtype"] = torch.float16

            self.processor = TrOCRProcessor.from_pretrained(self.model_ref)
            self.model = VisionEncoderDecoderModel.from_pretrained(
                self.model_ref,
                **model_kwargs,
            )
            self.model.to(self.device)
            self.model.eval()
            self.available = True
        except Exception as exc:
            self.error = f"could not load TrOCR model: {exc}"

    def predict(self, image, mode="sentence", preprocessed=False):
        if not self.available:
            return ""

        segments = [image]
        if mode in {"line", "sentence"}:
            line_segments = _split_into_lines(image)
            if line_segments:
                segments = line_segments

        outputs = []
        prepared_debug_images = []
        decode_config = {
            "word": {"max_new_tokens": 20, "num_beams": 3},
            "line": {"max_new_tokens": 64, "num_beams": 4},
            "sentence": {"max_new_tokens": 96, "num_beams": 5},
        }.get(mode, {"max_new_tokens": 72, "num_beams": 4})

        for segment in segments:
            prepared = _prepare_trocr_image(
                segment,
                mode=mode,
                preprocessed=preprocessed,
            )
            if prepared is None:
                continue
            prepared_debug_images.append(prepared.copy())

            pixel_values = self.processor(
                images=prepared,
                return_tensors="pt",
            ).pixel_values.to(self.device)

            with self.torch.inference_mode():
                generated_ids = self.model.generate(
                    pixel_values,
                    max_new_tokens=decode_config["max_new_tokens"],
                    num_beams=decode_config["num_beams"],
                    early_stopping=True,
                    repetition_penalty=1.2,
                )

            text = self.processor.batch_decode(generated_ids, skip_special_tokens=True)[0]
            cleaned = _clean_prediction(text, mode=mode)
            if cleaned:
                outputs.append(cleaned)

        if not outputs:
            return ""

        _save_debug_prepared_images(prepared_debug_images, mode)
        joined = " ".join(outputs) if mode == "sentence" else " ".join(outputs)
        return _clean_prediction(joined, mode=mode)


def _clean_prediction(text, mode="sentence"):
    cleaned = " ".join((text or "").split()).strip()
    if not cleaned:
        return ""

    cleaned = cleaned.strip(".,;:!?\"'`-_=+~")
    tokens = cleaned.split()
    if (
        len(tokens) > 1
        and re.fullmatch(r"\d+", tokens[0])
        and any(re.search(r"[A-Za-z]", token) for token in tokens[1:])
    ):
        tokens = tokens[1:]
    if len(tokens) > 1 and re.fullmatch(r"[^A-Za-z0-9]+", tokens[0] or ""):
        tokens = tokens[1:]
    cleaned = " ".join(tokens).strip(".,;:!?\"'`-_=+~")
    return cleaned


def _preferred_trocr_model_ref():
    explicit = os.getenv("AIRDRAW_OCR_MODEL", "").strip()
    if explicit:
        return explicit
    if DEFAULT_TROCR_MODEL_DIR.exists():
        return str(DEFAULT_TROCR_MODEL_DIR)
    return DEFAULT_TROCR_MODEL_ID


def _local_trocr_checkpoint_dir():
    return str(DEFAULT_TROCR_MODEL_DIR)


@lru_cache(maxsize=1)
def _get_trocr_engine():
    return _TrOCREngine(_preferred_trocr_model_ref())


def _trocr_dependencies_ready():
    try:
        import torch  # noqa: F401
        import transformers  # noqa: F401
        return True, ""
    except Exception as exc:
        return False, str(exc)


def get_ocr_backend_status(load_model=True):
    model_ref = _preferred_trocr_model_ref()
    local_checkpoint = _local_trocr_checkpoint_dir()

    if not load_model:
        deps_ready, deps_error = _trocr_dependencies_ready()
        return {
            "backend": "trocr" if deps_ready else "unavailable",
            "model_ref": model_ref,
            "local_checkpoint": local_checkpoint,
            "reason": "" if deps_ready else f"missing TrOCR dependencies: {deps_error}",
        }

    engine = _get_trocr_engine()
    if engine.available:
        return {
            "backend": "trocr",
            "device": engine.device,
            "model_ref": engine.model_ref,
            "local_checkpoint": local_checkpoint,
            "reason": "",
        }

    return {
        "backend": "unavailable",
        "model_ref": model_ref,
        "local_checkpoint": local_checkpoint,
        "reason": engine.error or "TrOCR unavailable",
    }


def run_ocr(canvas, mode="sentence", preprocessed=False):
    engine = _get_trocr_engine()
    if not engine.available:
        return ""
    try:
        return engine.predict(canvas, mode=mode, preprocessed=preprocessed)
    except Exception:
        return ""

#git change