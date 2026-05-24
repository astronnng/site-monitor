# ── Estágio 1: imagem base ─────────────────────────────────────────────────────
FROM python:3.12-slim

# Metadados
LABEL maintainer="you@example.com"
LABEL description="Site Monitoring Dashboard"

# Variáveis de ambiente
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    CHECK_INTERVAL=30 \
    REQUEST_TIMEOUT=10

# Diretório de trabalho
WORKDIR /app

# Instala dependências primeiro (aproveita cache de camadas)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copia o código da aplicação e os assets servidos pelo Flask
COPY app.py .
COPY templates/ templates/
COPY static/ static/
COPY sites.yaml .

# Expõe a porta
EXPOSE 5000

# Executa com gunicorn (configuração pronta para produção)
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "2", "--threads", "4", "--timeout", "120", "app:app"]
