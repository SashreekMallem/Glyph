# Glyph GLiNER2 Service

Glyph's **Layer 2** — zero-shot span tagging + structured extraction. Wraps the
[GLiNER2](https://huggingface.co/fastino/gliner2-large-v1) model in a small
FastAPI service that the Next.js app calls during document ingest.

> **Internal-only.** This service has **no auth of its own**. The Next.js
> `/api/v1/extract` route handles auth, rate limiting, and billing before
> proxying to us. **Never expose port 8000 to the public internet.**

## Layout

```
services/gliner-service/
├── serve.py            # local dev: python serve.py -> :8000
├── modal_app.py        # Modal serverless deploy (modal deploy modal_app.py)
├── pyproject.toml
└── app/
    ├── main.py         # FastAPI routes
    ├── inference.py    # GLiNER2 singleton + run_extract()
    ├── schemas.py      # Pydantic request/response
    └── glyph_schemas.py # GLiNER2 schema strings per doc_type
```

`serve.py` and `modal_app.py` both call the same `app.inference.run_extract()`
so local dev and serverless behave identically.

## Install

Python 3.10+ required. From this directory:

```bash
pip install -e .
# or with dev tools:
pip install -e ".[dev]"
```

> First boot downloads `fastino/gliner2-large-v1` (~720MB) into your local
> Hugging Face cache (`~/.cache/huggingface`). Subsequent starts are instant.

## Run locally

```bash
python serve.py
```

The server binds to `127.0.0.1:8000` by default. Override with:

```bash
GLINER_HOST=127.0.0.1 GLINER_PORT=8000 GLINER_RELOAD=1 python serve.py
```

CORS is open to `http://localhost:3000` so the Next.js dev server can hit it.

## API

### `GET /healthz`

```bash
curl http://localhost:8000/healthz
```

```json
{ "ok": true, "model_loaded": true, "model": "fastino/gliner2-large-v1" }
```

### `POST /v1/extract`

```bash
curl -X POST http://localhost:8000/v1/extract \
  -H "Content-Type: application/json" \
  -d '{"text":"Jane Doe — jane@example.com","doc_type":"resume"}'
```

Request:

```json
{
  "text": "string — the full document text",
  "doc_type": "resume | contract | invoice",
  "schema_hint": { "...optional..." }
}
```

Response:

```json
{
  "spans": [
    {
      "path": "personal.full_name",
      "value": "Jane Doe",
      "start": 0,
      "end": 8,
      "confidence": 0.93
    }
  ],
  "structured": { "personal": { "full_name": "Jane Doe" } },
  "min_confidence": 0.71,
  "avg_confidence": 0.89,
  "duration_ms": 78,
  "model": "fastino/gliner2-large-v1"
}
```

## Supported doc types

Schemas mirror `packages/schema-library/src/{resume,contract,invoice}.ts`:

- `resume` — personal, summary, experience[], education[], skills[], certifications[]
- `contract` — parties[], dates, payment_terms, obligations[], terms
- `invoice` — header, vendor, bill_to, line_items[], totals, notes

See `app/glyph_schemas.py` for the GLiNER2 schema strings.

## Tests

```bash
# Offline unit tests (fake model, fast):
pytest tests/test_inference.py -v

# Real-model E2E tests (downloads ~720MB on first run):
GLYPH_RUN_E2E=1 pytest tests/test_e2e.py -v
```

## Deploy to Modal (later)

```bash
modal deploy modal_app.py
```

The Modal image bakes the model weights at build time so cold starts stay
fast. `modal_app.py` exposes both an ASGI app (same routes as local) and an
RPC-style `extract_remote(text, doc_type)` for backend-to-backend calls.
