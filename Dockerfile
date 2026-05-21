# ── Stage 1: base image ────────────────────────────────────────────────────────
FROM python:3.12-slim

# Metadata
LABEL maintainer="you@example.com"
LABEL description="Site Monitoring Dashboard"

# Environment
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    CHECK_INTERVAL=30 \
    REQUEST_TIMEOUT=10

# Working directory
WORKDIR /app

# Install dependencies first (layer cache)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source
COPY app.py .
COPY templates/ templates/

# Expose port
EXPOSE 5000

# Run with gunicorn (production-ready)
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "2", "--threads", "4", "--timeout", "120", "app:app"]
