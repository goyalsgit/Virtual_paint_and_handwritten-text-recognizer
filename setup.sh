#!/usr/bin/env bash

set -euo pipefail

python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r backend/requirements.txt
pip install -r training/requirements.txt

echo
echo "Setup complete."
echo "Activate with: source venv/bin/activate"
echo "Run backend with: uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000"
