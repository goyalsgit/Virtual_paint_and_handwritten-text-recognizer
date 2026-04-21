#!/usr/bin/env python3
"""
Hugging Face Spaces entry point for Air Drawing App
Port 7860 is required by Hugging Face Spaces
"""
import os
import uvicorn

os.environ.setdefault("PORT", "7860")

if __name__ == "__main__":
    uvicorn.run(
        "backend.main:app",
        host="0.0.0.0",
        port=7860,
        log_level="info"
    )
