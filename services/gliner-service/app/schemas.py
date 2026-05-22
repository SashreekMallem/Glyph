"""Pydantic request/response models for the GLiNER service.

These are the wire-level contract Next.js calls. Keep field names stable —
breaking changes here ripple into apps/web/src/server/services/extract.ts.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

DocType = Literal["resume", "contract", "invoice"]

# Pydantic v2 reserves the `model_` namespace by default. We want `model` as a
# valid field name on response bodies (it's part of the wire contract), so we
# clear the reserved namespaces on those models.
_ALLOW_MODEL_FIELD = ConfigDict(protected_namespaces=())


class ExtractRequest(BaseModel):
    """POST /v1/extract request body."""

    text: str = Field(..., min_length=1, description="The full document text")
    doc_type: DocType = Field(..., description="Glyph document type")
    schema_hint: dict[str, Any] | None = Field(
        default=None,
        description="Optional Zod-equivalent schema JSON; reserved for future overrides.",
    )


class Span(BaseModel):
    """A single extracted span with provenance into the source text."""

    path: str = Field(..., description="Dot-path inside the structured object, e.g. personal.full_name")
    value: str = Field(..., description="Extracted surface form")
    start: int = Field(..., ge=0, description="Inclusive character offset into text")
    end: int = Field(..., ge=0, description="Exclusive character offset into text")
    confidence: float = Field(..., ge=0.0, le=1.0)


class ExtractResponse(BaseModel):
    """POST /v1/extract response body."""

    model_config = _ALLOW_MODEL_FIELD

    spans: list[Span]
    structured: dict[str, Any]
    min_confidence: float = Field(..., ge=0.0, le=1.0)
    avg_confidence: float = Field(..., ge=0.0, le=1.0)
    duration_ms: int = Field(..., ge=0)
    model: str


class HealthResponse(BaseModel):
    """GET /healthz response body."""

    model_config = _ALLOW_MODEL_FIELD

    ok: bool
    model_loaded: bool
    model: str
