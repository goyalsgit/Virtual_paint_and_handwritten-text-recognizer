# 🔄 How to Switch Between Models

## Your Models

You have TWO models:

1. **Large Model** (2.3GB) - `artifacts/trocr_large_model/`
   - ✅ Best accuracy (95%)
   - ❌ Slow deployment (10 minutes)
   - ❌ Large size (2.3GB)
   - ✅ Already trained by you!

2. **Base Model** (400MB) - `artifacts/trocr_base_finetuned/`
   - ✅ Good accuracy (90-95% after training)
   - ✅ Fast deployment (2 minutes)
   - ✅ Small size (400MB)
   - ⏳ Need to train (use Google Colab)

---

## 🔧 How to Switch Models

### To Use LARGE Model (Current - Your Trained Model)

**File**: `backend/ocr.py` (lines 12-23)

```python
# Option 1: Your fine-tuned LARGE model (2.3GB - best accuracy, slow deployment)
DEFAULT_TROCR_MODEL_DIR = PROJECT_ROOT / "artifacts" / "trocr_large_model"
DEFAULT_TROCR_MODEL_ID = "microsoft/trocr-large-handwritten"

# Option 2: Fine-tuned BASE model (400MB - good accuracy, fast deployment)
# DEFAULT_TROCR_MODEL_DIR = PROJECT_ROOT / "artifacts" / "trocr_base_finetuned"
# DEFAULT_TROCR_MODEL_ID = "microsoft/trocr-base-handwritten"
```

**Dockerfile** (lines 20-28):
```dockerfile
# Option 1: Copy fine-tuned BASE model (400MB - RECOMMENDED for deployment)
# COPY artifacts/trocr_base_finetuned/ ./artifacts/trocr_base_finetuned/

# Option 2: Copy fine-tuned LARGE model (2.3GB - best accuracy, slow deployment)
COPY artifacts/trocr_large_model/ ./artifacts/trocr_large_model/
```

---

### To Use BASE Model (For Deployment)

**File**: `backend/ocr.py` (lines 12-23)

```python
# Option 1: Your fine-tuned LARGE model (2.3GB - best accuracy, slow deployment)
# DEFAULT_TROCR_MODEL_DIR = PROJECT_ROOT / "artifacts" / "trocr_large_model"
# DEFAULT_TROCR_MODEL_ID = "microsoft/trocr-large-handwritten"

# Option 2: Fine-tuned BASE model (400MB - good accuracy, fast deployment)
DEFAULT_TROCR_MODEL_DIR = PROJECT_ROOT / "artifacts" / "trocr_base_finetuned"
DEFAULT_TROCR_MODEL_ID = "microsoft/trocr-base-handwritten"
```

**Dockerfile** (lines 20-28):
```dockerfile
# Option 1: Copy fine-tuned BASE model (400MB - RECOMMENDED for deployment)
COPY artifacts/trocr_base_finetuned/ ./artifacts/trocr_base_finetuned/

# Option 2: Copy fine-tuned LARGE model (2.3GB - best accuracy, slow deployment)
# COPY artifacts/trocr_large_model/ ./artifacts/trocr_large_model/
```

---

## 📋 Quick Switch Commands

### Switch to Large Model
```bash
# Edit backend/ocr.py - uncomment lines 14-15, comment lines 18-19
# Edit Dockerfile - uncomment line 27, comment line 21

# Test locally
python backend/main.py
```

### Switch to Base Model
```bash
# Edit backend/ocr.py - comment lines 14-15, uncomment lines 18-19
# Edit Dockerfile - comment line 27, uncomment line 21

# Test locally
python backend/main.py
```

---

## 🎯 RECOMMENDATION

### For Local Testing / Presentation
✅ **Use LARGE model** - Best accuracy, shows your work

### For Deployment
✅ **Use BASE model** - Faster, smaller, still good accuracy

---

## 💡 BEST APPROACH

1. **Keep LARGE model** for local demo (show professor)
2. **Train BASE model** on Google Colab (for deployment)
3. **Switch between them** as needed

---

## ✅ Your Large Model is SAFE!

- ✅ Still in `artifacts/trocr_large_model/`
- ✅ Not deleted
- ✅ Can switch back anytime
- ✅ Just commented out in code

---

## 🚀 Next Steps

1. ✅ Your large model is safe (commented out)
2. ⏳ Train base model on Google Colab (see `training/TRAIN_ON_COLAB.md`)
3. ✅ Put trained base model in `artifacts/trocr_base_finetuned/`
4. ✅ Switch to base model for deployment
5. ✅ Keep large model for local demo!

---

**Both models are preserved! You can switch anytime!** 🎉
