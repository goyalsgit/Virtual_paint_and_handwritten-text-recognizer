#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# Model Cleanup Script - Remove Training Files (Keep Model Working)
# ═══════════════════════════════════════════════════════════════

echo "🧹 Model Cleanup Script"
echo "======================="
echo ""

# Check if model directory exists
MODEL_DIR="artifacts/trocr_base_finetuned"

if [ ! -d "$MODEL_DIR" ]; then
    echo "❌ Error: Model directory not found: $MODEL_DIR"
    echo "Please make sure you're in the air-drawing-app directory"
    exit 1
fi

cd "$MODEL_DIR"

echo "📂 Current directory: $(pwd)"
echo ""
echo "📊 Size BEFORE cleanup:"
du -sh .
echo ""

# Count files before
FILES_BEFORE=$(find . -type f | wc -l)
echo "📁 Files before: $FILES_BEFORE"
echo ""

echo "🗑️  Deleting training files (safe to delete)..."
echo "------------------------------------------------"

DELETED=0

# Delete optimizer
if [ -f "optimizer.pt" ]; then
    SIZE=$(du -h optimizer.pt | cut -f1)
    rm optimizer.pt
    echo "✅ Deleted optimizer.pt ($SIZE)"
    DELETED=$((DELETED + 1))
fi

# Delete scheduler
if [ -f "scheduler.pt" ]; then
    SIZE=$(du -h scheduler.pt | cut -f1)
    rm scheduler.pt
    echo "✅ Deleted scheduler.pt ($SIZE)"
    DELETED=$((DELETED + 1))
fi

# Delete scaler
if [ -f "scaler.pt" ]; then
    SIZE=$(du -h scaler.pt | cut -f1)
    rm scaler.pt
    echo "✅ Deleted scaler.pt ($SIZE)"
    DELETED=$((DELETED + 1))
fi

# Delete trainer state
if [ -f "trainer_state.json" ]; then
    rm trainer_state.json
    echo "✅ Deleted trainer_state.json"
    DELETED=$((DELETED + 1))
fi

# Delete training args
if [ -f "training_args.bin" ]; then
    rm training_args.bin
    echo "✅ Deleted training_args.bin"
    DELETED=$((DELETED + 1))
fi

# Delete rng state
if [ -f "rng_state.pth" ]; then
    rm rng_state.pth
    echo "✅ Deleted rng_state.pth"
    DELETED=$((DELETED + 1))
fi

# Delete checkpoint folders
if ls -d checkpoint-* 2>/dev/null | grep -q .; then
    rm -rf checkpoint-*
    echo "✅ Deleted checkpoint-* folders"
    DELETED=$((DELETED + 1))
fi

# Delete runs folder
if [ -d "runs" ]; then
    rm -rf runs
    echo "✅ Deleted runs folder"
    DELETED=$((DELETED + 1))
fi

# Delete pytorch_model.bin if safetensors exists
if [ -f "model.safetensors" ] && [ -f "pytorch_model.bin" ]; then
    SIZE=$(du -h pytorch_model.bin | cut -f1)
    rm pytorch_model.bin
    echo "✅ Deleted pytorch_model.bin ($SIZE) - using safetensors instead"
    DELETED=$((DELETED + 1))
fi

echo ""
echo "📊 Cleanup Results:"
echo "==================="
echo "🗑️  Files deleted: $DELETED"
echo ""

# Count files after
FILES_AFTER=$(find . -type f | wc -l)
echo "📁 Files after: $FILES_AFTER"
echo ""

echo "📊 Size AFTER cleanup:"
du -sh .
echo ""

echo "✅ Essential files kept:"
echo "------------------------"
ls -lh | grep -E "model.safetensors|config.json|tokenizer.json|preprocessor_config.json" | awk '{print $9, "(" $5 ")"}'
echo ""

# Verify model file exists
if [ -f "model.safetensors" ]; then
    echo "✅ model.safetensors exists - Model will work!"
else
    echo "❌ WARNING: model.safetensors not found!"
fi

echo ""
echo "🎉 Cleanup complete!"
echo ""
echo "📝 Next steps:"
echo "  1. Test the model: python backend/main.py"
echo "  2. Open browser: http://localhost:8000"
echo "  3. Draw something and test OCR"
echo "  4. If it works → You're done! ✅"
