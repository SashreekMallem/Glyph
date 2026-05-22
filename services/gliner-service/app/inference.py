"""Singleton GLiNER2 model loader + schema-agnostic inference.

Both `serve.py` (local uvicorn) and `modal_app.py` (Modal) import `run_extract`
from this module — single source of truth for inference logic.

This service is intentionally dumb about doc types. Every request carries
its own JSON Schema (looked up or synthesized by Next.js). We compile that
schema into a GLiNER2 fluent schema at request time and run extraction.

Output shape (GLiNER2 1.3.x) when called with `include_confidence=True,
include_spans=True`:

    {
      "<structure_name>": [
        {
          "<field_name>": [
            {"text": str, "confidence": float, "start": int, "end": int},
            ...
          ],
          ...
        },
        ...
      ],
      ...
    }

We map structure names back to their JSON Schema dot-paths via the
`structure_paths` map produced by `compile_schema`, so the assembled
`structured` payload matches the original JSON Schema's nested shape.
"""

from __future__ import annotations

import logging
import time
from threading import Lock
from typing import Any

from .inference_types import GLiNER2Protocol
from .json_schema_walker import CompiledSchema, compile_schema
from .schemas import ExtractResponse, Span

logger = logging.getLogger(__name__)

MODEL_NAME = "fastino/gliner2-large-v1"

_MODEL: GLiNER2Protocol | None = None
_MODEL_LOCK = Lock()


def get_model() -> GLiNER2Protocol:
    """Lazily load the GLiNER2 model exactly once, thread-safe."""
    global _MODEL
    if _MODEL is not None:
        return _MODEL
    with _MODEL_LOCK:
        if _MODEL is not None:
            return _MODEL
        logger.info("Loading GLiNER2 model %s (first call, may take a minute)...", MODEL_NAME)
        from gliner2 import GLiNER2  # type: ignore[import-not-found]

        _MODEL = GLiNER2.from_pretrained(MODEL_NAME)
        logger.info("GLiNER2 model %s loaded.", MODEL_NAME)
        return _MODEL


def is_model_loaded() -> bool:
    return _MODEL is not None


def _coerce_field_predictions(raw: Any) -> list[dict[str, Any]]:
    """A field value is normally `list[{text, confidence, start, end}]`.

    Be defensive against single-dict shapes some gliner2 builds emit and
    ignore stray strings.
    """
    if raw is None:
        return []
    if isinstance(raw, dict):
        return [raw]
    if isinstance(raw, list):
        return [item for item in raw if isinstance(item, dict)]
    return []


def _extract_best_match(matches: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Pick the highest-confidence match from a list of field predictions."""
    valid = [m for m in matches if isinstance(m.get("text"), str)]
    if not valid:
        return None
    return max(valid, key=lambda m: float(m.get("confidence", 0.0)))


def _set_nested(target: dict[str, Any], path: list[str], value: Any) -> None:
    """Set `value` at the nested dot-path inside `target`, creating dicts along the way."""
    cursor = target
    for segment in path[:-1]:
        existing = cursor.get(segment)
        if not isinstance(existing, dict):
            existing = {}
            cursor[segment] = existing
        cursor = existing
    cursor[path[-1]] = value


def _assemble_from_compiled(
    raw: dict[str, Any], compiled: CompiledSchema
) -> tuple[dict[str, Any], list[Span], set[str]]:
    """Walk GLiNER2's nested response back into the JSON Schema shape.

    Returns (structured, spans, filled_paths). `filled_paths` is the set of
    declared paths that actually got a value, so the caller can compute
    `missing_paths` against the original `compiled.declared_paths`.
    """
    structured: dict[str, Any] = {}
    spans: list[Span] = []
    filled: set[str] = set()

    if not isinstance(raw, dict):
        return structured, spans, filled

    for structure_name, entries in raw.items():
        if not isinstance(entries, list):
            continue

        section_path = compiled.structure_paths.get(structure_name)
        if section_path is None:
            # Unknown structure (model hallucinated a section name we didn't ask for).
            continue
        is_array = compiled.cardinality.get(structure_name, False)

        assembled_entries: list[dict[str, Any]] = []

        for entry_idx, entry in enumerate(entries):
            if not isinstance(entry, dict):
                continue
            entry_obj: dict[str, Any] = {}

            for field_name, field_value in entry.items():
                matches = _coerce_field_predictions(field_value)
                best = _extract_best_match(matches)
                if best is None:
                    continue

                value = str(best["text"])
                confidence = float(best.get("confidence", 1.0))
                start = int(best.get("start", 0))
                end = int(best.get("end", 0))

                entry_obj[field_name] = value

                # Compute the wire path used by the caller (Next.js side).
                if section_path:
                    parent_dot = ".".join(section_path)
                else:
                    parent_dot = ""

                if is_array:
                    if parent_dot:
                        path = f"{parent_dot}[{entry_idx}].{field_name}"
                        declared = f"{parent_dot}.{field_name}"
                    else:
                        path = f"[{entry_idx}].{field_name}"
                        declared = field_name
                else:
                    path = f"{parent_dot}.{field_name}" if parent_dot else field_name
                    declared = path

                filled.add(declared)
                spans.append(
                    Span(
                        path=path,
                        value=value,
                        start=start,
                        end=end,
                        confidence=confidence,
                    )
                )

            if entry_obj:
                assembled_entries.append(entry_obj)

        if not assembled_entries:
            continue

        if section_path == []:
            # Synthetic _root structure — flatten its fields onto the top level.
            for e in assembled_entries:
                for k, v in e.items():
                    structured.setdefault(k, v)
            continue

        if is_array:
            _set_nested(structured, section_path, assembled_entries)
        else:
            # Non-array: merge multi-entry returns so we don't drop fields.
            merged: dict[str, Any] = {}
            for e in assembled_entries:
                for k, v in e.items():
                    merged.setdefault(k, v)
            _set_nested(structured, section_path, merged)

    return structured, spans, filled


def run_extract(
    text: str,
    json_schema: dict[str, Any],
    *,
    threshold: float = 0.5,
) -> ExtractResponse:
    """Run GLiNER2 inference against an arbitrary JSON Schema."""
    model = get_model()
    compiled = compile_schema(model, json_schema)

    started = time.perf_counter()
    raw = model.extract(
        text=text,
        schema=compiled.gliner_schema,
        threshold=threshold,
        format_results=True,
        include_confidence=True,
        include_spans=True,
    )
    duration_ms = int((time.perf_counter() - started) * 1000)

    structured, spans, filled = _assemble_from_compiled(raw, compiled)

    missing_paths = [p for p in compiled.declared_paths if p not in filled and not p.endswith("[]")]

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
        missing_paths=missing_paths,
    )
