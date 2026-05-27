# ── Estágio 1: build do CSS ────────────────────────────────────────────────────
FROM node:20-alpine AS css-builder

WORKDIR /app

COPY package.json ./
COPY package-lock.json ./
COPY tailwind.config.js ./
COPY postcss.config.js ./
COPY templates/ templates/
COPY static/js/ static/js/
COPY static/css/src.css static/css/src.css

RUN npm ci
RUN npm run build:css

# ── Estágio 2: imagem de runtime ───────────────────────────────────────────────
FROM python:3.12-slim

# Metadados
LABEL maintainer="you@example.com"
LABEL description="Site Monitoring Dashboard"

# Variáveis de ambiente
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    CHECK_INTERVAL=30 \
    REQUEST_TIMEOUT=10 \
    MAX_CHECK_WORKERS=8 \
    HISTORY_LIMIT=50

# Diretório de trabalho
WORKDIR /app

# Instala dependências primeiro (aproveita cache de camadas)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copia o código da aplicação e os assets servidos pelo Flask
COPY app.py .
COPY templates/ templates/
COPY static/js/ static/js/
COPY --from=css-builder /app/static/css/app.css static/css/app.css
COPY sites.yaml .

# Expõe a porta
EXPOSE 5000

# Executa com gunicorn (configuração pronta para produção)
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "1", "--threads", "8", "--timeout", "120", "app:app"]
