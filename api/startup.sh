#!/bin/bash
set -e
cd /home/site/wwwroot

# Use pre-installed packages from CI build (skip slow runtime pip install)
export PYTHONPATH="/home/site/wwwroot/.python_packages/lib/site-packages:${PYTHONPATH:-}"

python -m uvicorn server:app --host 0.0.0.0 --port "${PORT:-8000}"
