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

Observação: a imagem inclui `templates/`, `static/` e `sites.yaml`. O `docker-compose.yml` também define um fluxo de desenvolvimento com `watch` para sincronizar mudanças visuais sem depender de um arquivo `override`.

### Desenvolvimento visual com Compose
```bash
docker compose up --watch
```
Ou, se o stack já estiver rodando:
```bash
docker compose watch
```

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
  -e MAX_CHECK_WORKERS=8 \
  -e HISTORY_LIMIT=50 \
  site-monitor
```

---

## ⚙️ Configuração

| Variável de Ambiente | Padrão | Descrição |
|----------------------|--------|-----------|
| `CHECK_INTERVAL`     | `30`   | Segundos entre ciclos completos de checagem |
| `REQUEST_TIMEOUT`    | `10`   | Timeout das requisições HTTP em segundos |
| `MAX_CHECK_WORKERS`  | `8`    | Número máximo de checagens paralelas por ciclo |
| `HISTORY_LIMIT`      | `50`   | Quantidade de pontos de histórico mantidos por site |

Observação: como o monitor usa estado em memória e uma thread de background, o container de produção roda com um único worker do Gunicorn para evitar estado duplicado entre processos.

---

## 📦 Estrutura do Projeto

```
site-monitor/
├── app.py                # Backend Flask + lógica de monitoramento
├── templates/
│   └── index.html        # Interface do painel (vanilla JS)
├── static/
│   ├── css/
│   │   └── styles.css    # CSS extraído da página
│   └── js/
│       └── ui.js         # JS da UI (refresh, modal, theme toggle)
├── sites.yaml            # Lista persistida/inicial de sites monitorados
├── requirements.txt      # Dependências Python
├── Dockerfile            # Definição da imagem do container
├── docker-compose.yml    # Runtime padrão + watch para desenvolvimento
└── .dockerignore
```

**Notas rápidas sobre a interface (maio/2026)**

- O CSS foi externalizado para [static/css/styles.css](static/css/styles.css) e o JavaScript para [static/js/ui.js](static/js/ui.js).
- O build Docker copia `templates/`, `static/` e `sites.yaml`; no desenvolvimento com Compose, `templates/` e `static/` são sincronizados com `docker compose watch`.
- Um botão de alternância de tema foi adicionado no cabeçalho: o tema (dark/light) é salvo em `localStorage`.
- A refatoração mantém a mesma API; mudanças visuais são seguras e reversíveis.

## 🛠️ Desenvolvimento local

Para desenvolver e testar localmente (Windows / PowerShell):

```powershell
# criar e ativar venv
python -m venv .venv
.venv\Scripts\Activate.ps1

# instalar dependências de runtime
pip install -r requirements.txt

# iniciar o servidor de desenvolvimento
python app.py

# abrir http://127.0.0.1:5000 no navegador
```

Ou em sistemas Unix (macOS / Linux):

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

## ✅ Executando os testes

Os testes usam `pytest`. Se não estiver instalado no ambiente virtual, instale com:

```bash
pip install pytest
```

Em seguida execute:

```bash
python -m pytest -q
```

Nota: este repositório pode listar `tests/` no `.gitignore` — se os seus testes locais não estiverem sendo comitados, verifique `.gitignore` antes de adicionar os arquivos ao repositório.

## 📡 Endpoints da API

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
