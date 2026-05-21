# 🛰️ Painel de Monitoramento de Sites

Painel leve e self-hosted para monitoramento de sites, construído com Python (Flask) e Docker.

---

## 🚀 Início Rápido

### Opção A — Docker Compose (recomendado)
```bash
cd site-monitor
docker compose up -d --build
```
Em seguida, abra **http://localhost:5000** no seu navegador.

---

### Opção B — Apenas Docker
```bash
cd site-monitor

# Construir a imagem
docker build -t site-monitor .

# Executar o container
docker run -d \
  --name site-monitor \
  --restart unless-stopped \
  -p 5000:5000 \
  -e CHECK_INTERVAL=30 \
  -e REQUEST_TIMEOUT=10 \
  site-monitor
```

---

## ⚙️ Configuração

| Variável de Ambiente | Padrão | Descrição |
|----------------------|--------|-----------|
| `CHECK_INTERVAL`     | `30`   | Segundos entre ciclos completos de checagem |
| `REQUEST_TIMEOUT`    | `10`   | Timeout das requisições HTTP em segundos |

---

## 📦 Estrutura do Projeto

```
site-monitor/
├── app.py                # Backend Flask + lógica de monitoramento
├── templates/
│   └── index.html        # Interface do painel (vanilla JS)
├── requirements.txt      # Dependências Python
├── Dockerfile            # Definição da imagem do container
├── docker-compose.yml    # Definição do serviço para Compose
└── .dockerignore
```

---

## ➕ Adicionar / Alterar Sites

Edite a lista `SITES` em **`app.py`**:

```python
SITES = [
    {"name": "Meu App",  "url": "https://meuapp.exemplo.com"},
    {"name": "Minha API",  "url": "https://api.exemplo.com/health"},
    ...
]
```

Depois, reconstrua: `docker compose up -d --build`

---

## 📡 Endpoints da API

| Endpoint | Descrição |
|----------|-----------|
| `GET /` | Interface do painel |
| `GET /api/status` | JSON com o status atual de todos os sites + resumo |
| `GET /api/history/<site_name>` | Últimos 50 resultados de checagem de um site |

---

## 🛑 Parar / Remover

```bash
docker compose down          # para e remove o container
docker compose down --rmi all  # também remove a imagem
```
