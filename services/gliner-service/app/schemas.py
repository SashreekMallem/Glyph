"""Pydantic request/response models for the GLiNER service.

Wire contract Next.js calls. The Python service is schema-agnostic — every
request carries its own JSON Schema (looked up or synthesized by Next.js).
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

# Pydantic v2 reserves the `model_` namespace by default. We keep `model` as a
# valid wire field, so clear the reserved namespaces on responses.
_ALLOW_MODEL_FIELD = ConfigDict(protected_namespaces=())


class ExtractRequest(BaseModel):
    """POST /v1/extract request body.

    The caller (Next.js) is responsible for picking the JSON Schema — either
    by looking it up in `document_types` / `schema_blocks`, or by asking
    Gemini to synthesize one for an unknown doc type. We just compile and
    extract against whatever JSON Schema arrives.
    """

    text: str = Field(..., min_length=1, description="The full document text")
    json_schema: dict[str, Any] = Field(
        ...,
        description="JSON Schema Draft 7. Must be type:object with a populated properties map.",
    )
    threshold: float = Field(
        default=0.5,
        ge=0.0,
        le=1.0,
        description="GLiNER2 inference threshold; lower = more spans, more false positives.",
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
    # Fields the caller asked about but GLiNER2 couldn't fill — Next.js uses
    # this to decide which regions to fall back on (Gemini) or flag as gaps.
    missing_paths: list[str] = Field(default_factory=list)


class HealthResponse(BaseModel):
    """GET /healthz response body."""

    model_config = _ALLOW_MODEL_FIELD

    ok: bool
    model_loaded: bool
    model: str
