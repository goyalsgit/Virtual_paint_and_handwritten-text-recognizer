#!/bin/bash

# Air Drawing App - Test Server Startup Script
# This script starts the server and provides testing instructions

echo "=================================================="
echo "  Air Drawing App - Fix #1 Testing"
echo "=================================================="
echo ""

# Check if we're in the right directory
if [ ! -f "backend/main.py" ]; then
    echo "❌ Error: Please run this script from the air-drawing-app directory"
    echo "   cd air-drawing-app"
    echo "   ./START_SERVER_AND_TEST.sh"
    exit 1
fi

# Check if venv exists
if [ ! -d "venv" ]; then
    echo "❌ Error: Virtual environment not found"
    echo "   Run: ./setup.sh"
    exit 1
fi

echo "✅ Starting server..."
echo ""
echo "📝 Testing Instructions:"
echo ""
echo "1. Wait for server to start (you'll see 'Application startup complete')"
echo "2. Open browser: http://localhost:8000/pdfviewer"
echo "3. Upload a PDF file"
echo "4. Click 'Enable Camera' button"
echo "5. Show OPEN HAND (all 5 fingers) to camera"
echo "6. ✅ EXPECTED: Gray cursor should be visible and follow your hand"
echo ""
echo "=================================================="
echo ""

# Activate venv and start server
source venv/bin/activate
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
