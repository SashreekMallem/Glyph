"""Singleton GLiNER2 model loader + inference.

Both `serve.py` (local uvicorn) and `modal_app.py` (Modal) import `run_extract`
from this module — keeping a single source of truth for inference logic.

The model is lazily loaded on first call so unit tests can monkey-patch
`_MODEL` to a fake before the heavyweight import ever runs.
"""

from __future__ import annotations

import logging
import time
from threading import Lock
from typing import Any, Protocol

from .glyph_schemas import get_schema, is_array_section
from .schemas import ExtractResponse, Span

logger = logging.getLogger(__name__)

MODEL_NAME = "fastino/gliner2-large-v1"


class _GLiNER2Protocol(Protocol):
    """Structural type for the subset of the GLiNER2 API we use.

    Real model exposes `.extract(text, schema=...)` returning a list of
    `{section, field, value, start, end, confidence}` dicts (or close to it).
    The exact field names are normalized in `_normalize_predictions`.
    """

    def extract(self, text: str, schema: str) -> list[dict[str, Any]]:
        ...


_MODEL: _GLiNER2Protocol | None = None
_MODEL_LOCK = Lock()


def get_model() -> _GLiNER2Protocol:
    """Lazily load the GLiNER2 model exactly once, thread-safe."""
    global _MODEL
    if _MODEL is not None:
        return _MODEL
    with _MODEL_LOCK:
        if _MODEL is not None:
            return _MODEL
        logger.info("Loading GLiNER2 model %s (first call, may take a minute)...", MODEL_NAME)
        # Local import: keeps unit tests importable without the heavyweight dep.
        from gliner2 import GLiNER2  # type: ignore[import-not-found]

        _MODEL = GLiNER2.from_pretrained(MODEL_NAME)
        logger.info("GLiNER2 model %s loaded.", MODEL_NAME)
        return _MODEL


def is_model_loaded() -> bool:
    return _MODEL is not None


def _normalize_predictions(raw: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Normalize GLiNER2's raw output dicts into a stable internal shape.

    Different gliner2 builds use slightly different key names. We accept any of:
      - section / schema / category
      - field / label / type
      - value / text / span
      - start / start_char
      - end / end_char
      - confidence / score / prob
    """
    normalized: list[dict[str, Any]] = []
    for item in raw:
        section = item.get("section") or item.get("schema") or item.get("category")
        field = item.get("field") or item.get("label") or item.get("type")
        value = item.get("value") or item.get("text") or item.get("span")
        start = item.get("start", item.get("start_char", 0))
        end = item.get("end", item.get("end_char", 0))
        confidence = item.get("confidence", item.get("score", item.get("prob", 1.0)))
        if section is None or field is None or value is None:
            continue
        normalized.append(
            {
                "section": str(section),
                "field": str(field),
                "value": str(value),
                "start": int(start),
                "end": int(end),
                "confidence": float(confidence),
            }
        )
    return normalized


def _assemble_structured(
    doc_type: str, predictions: list[dict[str, Any]]
) -> tuple[dict[str, Any], list[Span]]:
    """Group predictions by section and assemble both `structured` and `spans`.

    For array sections we cluster predictions into entries: a new entry starts
    whenever we see a field name we have already filled for the current entry.
    This is a heuristic — GLiNER2's native grouping is reused when available
    via an `entry_id` field, but we fall back gracefully when it isn't present.
    """
    structured: dict[str, Any] = {}
    spans: list[Span] = []

    # Group by section while preserving prediction order.
    by_section: dict[str, list[dict[str, Any]]] = {}
    for pred in predictions:
        by_section.setdefault(pred["section"], []).append(pred)

    for section, preds in by_section.items():
        if is_array_section(doc_type, section):
            entries: list[dict[str, Any]] = []
            current: dict[str, Any] = {}
            for pred in preds:
                # Honor explicit entry IDs when present.
                entry_id = pred.get("entry_id")
                if entry_id is not None and current.get("__entry_id") not in (None, entry_id):
                    entries.append({k: v for k, v in current.items() if not k.startswith("__")})
                    current = {}
                if pred["field"] in current and entry_id is None:
                    entries.append({k: v for k, v in current.items() if not k.startswith("__")})
                    current = {}
                current[pred["field"]] = pred["value"]
                if entry_id is not None:
                    current["__entry_id"] = entry_id
                spans.append(
                    Span(
                        path=f"{section}[{len(entries)}].{pred['field']}",
                        value=pred["value"],
                        start=pred["start"],
                        end=pred["end"],
                        confidence=pred["confidence"],
                    )
                )
            if current:
                entries.append({k: v for k, v in current.items() if not k.startswith("__")})
            structured[section] = entries
        else:
            obj: dict[str, Any] = structured.setdefault(section, {})
            for pred in preds:
                obj[pred["field"]] = pred["value"]
                spans.append(
                    Span(
                        path=f"{section}.{pred['field']}",
                        value=pred["value"],
                        start=pred["start"],
                        end=pred["end"],
                        confidence=pred["confidence"],
                    )
                )

    return structured, spans


def run_extract(text: str, doc_type: str) -> ExtractResponse:
    """Run GLiNER2 inference end-to-end. Used by both serve.py and modal_app.py."""
    schema = get_schema(doc_type)
    model = get_model()

    started = time.perf_counter()
    raw = model.extract(text, schema=schema)
    duration_ms = int((time.perf_counter() - started) * 1000)

    predictions = _normalize_predictions(raw)
    structured, spans = _assemble_structured(doc_type, predictions)

    if spans:
        confidences = [s.confidence for s in spans]
        min_c = min(confidences)
        avg_c = sum(confidences) / len(confidences)
    else:
        min_c = 0.0
        avg_c = 0.0

    return ExtractResponse(
        spans=spans,
        structured=structured,
        min_confidence=min_c,
        avg_confidence=avg_c,
        duration_ms=duration_ms,
        model=MODEL_NAME,
    )
