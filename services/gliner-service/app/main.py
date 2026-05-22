"""FastAPI app — wires HTTP routes to the inference singleton.

This service is internal-only. The Next.js `/api/v1/extract` route proxies to
us after handling auth, rate limiting, and billing. NEVER expose this port
publicly.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .inference import MODEL_NAME, get_model, is_model_loaded, run_extract
from .schemas import ExtractRequest, ExtractResponse, HealthResponse

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Eagerly load the model on startup so the first request isn't slow."""
    try:
        get_model()
    except Exception:  # noqa: BLE001 — log and continue; /healthz will report
        logger.exception("Failed to preload GLiNER2 model; will retry on first request.")
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title="Glyph GLiNER2 Service",
        description="Internal Layer 2 zero-shot span tagging + structured extraction.",
        version="0.1.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000"],
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
    )

    @app.get("/healthz", response_model=HealthResponse)
    async def healthz() -> HealthResponse:
        return HealthResponse(
            ok=True,
            model_loaded=is_model_loaded(),
            model=MODEL_NAME,
        )

    @app.post("/v1/extract", response_model=ExtractResponse)
    async def extract(req: ExtractRequest) -> ExtractResponse:
        try:
            return run_extract(text=req.text, doc_type=req.doc_type)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        except Exception as e:  # noqa: BLE001
            logger.exception("Inference failed")
            raise HTTPException(status_code=500, detail=f"Inference failed: {e}") from e

    return app


app = create_app()
