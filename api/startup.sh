#!/bin/bash
set -e
cd /home/site/wwwroot
pip install --quiet --disable-pip-version-check -r requirements.txt
python -m uvicorn server:app --host 0.0.0.0 --port 8000
