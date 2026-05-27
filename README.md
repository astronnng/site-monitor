# Painel de Monitoramento de Sites

Painel leve e self-hosted para acompanhar disponibilidade, latência e histórico recente de sites e endpoints HTTP. O projeto usa Flask no backend, interface web simples no frontend e pode rodar localmente ou em Docker.

## O que ele faz

- Monitora múltiplos sites em background.
- Exibe status `UP`, `DOWN` e `PENDING`.
- Mostra latência média e histórico recente por site.
- Permite adicionar, editar e remover sites pela interface.
- Persiste a lista monitorada em `sites.yaml`.

## Como funciona hoje

- O monitor roda em memória e executa checagens em paralelo.
- O backend reaproveita conexões HTTP para reduzir overhead.
- O endpoint `GET /api/status` já devolve o histórico recente de cada site, evitando múltiplas chamadas extras do frontend.
- Em produção, o container usa `1` worker do Gunicorn para evitar inconsistência de estado entre processos.

## Início rápido

### Docker Compose

```bash
docker compose up -d --build
```

Depois, abra `http://localhost:5000`.

### Desenvolvimento com watch

```bash
docker compose up --watch
```

Se o stack já estiver ativo:

```bash
docker compose watch
```

### Docker puro

```bash
docker build -t site-monitor .

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

## Configuração

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `CHECK_INTERVAL` | `30` | Intervalo, em segundos, entre ciclos completos de monitoramento |
| `REQUEST_TIMEOUT` | `10` | Timeout de cada requisição HTTP |
| `MAX_CHECK_WORKERS` | `8` | Número máximo de checagens paralelas por ciclo |
| `HISTORY_LIMIT` | `50` | Quantidade máxima de pontos de histórico por site |
| `SITES_FILE` | `sites.yaml` | Arquivo YAML usado para persistir a lista de sites |
| `START_MONITOR` | `1` | Define se a thread de monitoramento deve iniciar automaticamente |

## Estrutura do projeto

```text
site-monitor/
├── app.py
├── sites.yaml
├── templates/
│   └── index.html
├── static/
│   ├── css/
│   │   └── styles.css
│   └── js/
│       └── ui.js
├── tests/
│   ├── conftest.py
│   └── test_api.py
├── Dockerfile
├── docker-compose.yml
└── requirements.txt
```

## Desenvolvimento local

### Windows / PowerShell

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python app.py
```

### macOS / Linux

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Depois, acesse `http://127.0.0.1:5000`.

## Testes

```bash
python -m pytest -q
```

Se estiver usando o ambiente virtual do projeto no Windows:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

## Gerenciamento dos sites

Você pode gerenciar os sites pela interface web ou editando `sites.yaml` diretamente.

Exemplo:

```yaml
- name: Meu App
  url: https://meuapp.exemplo.com
- name: Minha API
  url: https://api.exemplo.com/health
```

Se alterar `sites.yaml` manualmente em ambiente containerizado, reconstrua ou reinicie o serviço para carregar a nova lista inicial.

## API

| Endpoint | Descrição |
|----------|-----------|
| `GET /` | Renderiza o painel |
| `GET /api/status` | Retorna snapshot atual, resumo e histórico recente por site |
| `GET /api/history/<site_name>` | Retorna o histórico recente de um site |
| `POST /api/sites` | Adiciona um novo site |
| `PUT /api/sites/<site_name>` | Atualiza nome e URL de um site |
| `DELETE /api/sites/<site_name>` | Remove um site |

### Exemplo de resposta de `/api/status`

```json
{
  "sites": [
    {
      "name": "Meu App",
      "url": "https://meuapp.exemplo.com",
      "status": "UP",
      "status_code": 200,
      "latency_ms": 123,
      "checked_at": "2026-05-27T12:00:00Z",
      "history": [
        {
          "status": "UP",
          "latency_ms": 123,
          "checked_at": "2026-05-27T12:00:00Z"
        }
      ]
    }
  ],
  "summary": {
    "total": 1,
    "up": 1,
    "down": 0,
    "avg_latency_ms": 123
  },
  "generated_at": "2026-05-27T12:00:00Z"
}
```

## Parar o ambiente

```bash
docker compose down
```

Para remover também as imagens:

```bash
docker compose down --rmi all
```
