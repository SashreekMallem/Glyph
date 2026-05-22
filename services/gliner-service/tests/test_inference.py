"""Offline unit tests — mock the GLiNER2 model and verify our adapters.

These tests run without downloading model weights and without the gliner2
package installed. They focus on:
  - Schema lookup + cardinality parsing
  - Prediction normalization across possible key-name variants
  - Structured assembly (objects vs arrays, span paths, entry boundaries)
  - HTTP routes via FastAPI's TestClient
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from app import inference
from app.glyph_schemas import CARDINALITY, SCHEMAS, get_schema, is_array_section
from app.inference import (
    _assemble_structured,
    _normalize_predictions,
    run_extract,
)
from app.main import create_app


class FakeModel:
    """Tiny stand-in for GLiNER2."""

    def __init__(self, predictions: list[dict[str, Any]]):
        self._predictions = predictions
        self.calls: list[tuple[str, str]] = []

    def extract(self, text: str, schema: str) -> list[dict[str, Any]]:
        self.calls.append((text, schema))
        return self._predictions


@pytest.fixture(autouse=True)
def _reset_model_singleton(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(inference, "_MODEL", None)


# ---------------------------------------------------------------------------
# Schema metadata
# ---------------------------------------------------------------------------


def test_schemas_cover_all_doc_types() -> None:
    assert set(SCHEMAS) == {"resume", "contract", "invoice"}


def test_get_schema_returns_string() -> None:
    for doc_type in ("resume", "contract", "invoice"):
        schema = get_schema(doc_type)
        assert isinstance(schema, str)
        assert "@" in schema


def test_get_schema_rejects_unknown() -> None:
    with pytest.raises(ValueError):
        get_schema("manifesto")


def test_cardinality_resume() -> None:
    assert is_array_section("resume", "experience") is True
    assert is_array_section("resume", "education") is True
    assert is_array_section("resume", "personal") is False


def test_cardinality_contract_invoice() -> None:
    assert CARDINALITY["contract"]["parties"] is True
    assert CARDINALITY["contract"]["payment_terms"] is False
    assert CARDINALITY["invoice"]["line_items"] is True
    assert CARDINALITY["invoice"]["vendor"] is False


# ---------------------------------------------------------------------------
# Prediction normalization
# ---------------------------------------------------------------------------


def test_normalize_handles_variant_keys() -> None:
    raw = [
        {
            "section": "personal",
            "field": "full_name",
            "value": "Jane Doe",
            "start": 0,
            "end": 8,
            "confidence": 0.9,
        },
        {
            "schema": "personal",
            "label": "email",
            "text": "jane@x.com",
            "start_char": 10,
            "end_char": 20,
            "score": 0.8,
        },
    ]
    out = _normalize_predictions(raw)
    assert len(out) == 2
    assert out[0]["field"] == "full_name"
    assert out[1]["field"] == "email"
    assert out[1]["confidence"] == 0.8


def test_normalize_drops_incomplete_rows() -> None:
    raw = [{"section": "personal", "field": "email"}]  # missing value
    assert _normalize_predictions(raw) == []


# ---------------------------------------------------------------------------
# Structured assembly
# ---------------------------------------------------------------------------


def test_assemble_object_section() -> None:
    preds = [
        {"section": "personal", "field": "full_name", "value": "Jane", "start": 0, "end": 4, "confidence": 0.9},
        {"section": "personal", "field": "email", "value": "j@x.com", "start": 5, "end": 12, "confidence": 0.8},
    ]
    structured, spans = _assemble_structured("resume", preds)
    assert structured == {"personal": {"full_name": "Jane", "email": "j@x.com"}}
    assert [s.path for s in spans] == ["personal.full_name", "personal.email"]


def test_assemble_array_section_splits_on_repeat() -> None:
    preds = [
        {"section": "experience", "field": "company", "value": "Acme", "start": 0, "end": 4, "confidence": 0.9},
        {"section": "experience", "field": "title", "value": "Eng", "start": 5, "end": 8, "confidence": 0.9},
        {"section": "experience", "field": "company", "value": "Globex", "start": 9, "end": 15, "confidence": 0.9},
        {"section": "experience", "field": "title", "value": "Lead", "start": 16, "end": 20, "confidence": 0.9},
    ]
    structured, spans = _assemble_structured("resume", preds)
    assert structured["experience"] == [
        {"company": "Acme", "title": "Eng"},
        {"company": "Globex", "title": "Lead"},
    ]
    assert [s.path for s in spans] == [
        "experience[0].company",
        "experience[0].title",
        "experience[1].company",
        "experience[1].title",
    ]


def test_assemble_array_honors_entry_id() -> None:
    preds = [
        {"section": "experience", "field": "company", "value": "A", "start": 0, "end": 1, "confidence": 1.0, "entry_id": 1},
        {"section": "experience", "field": "company", "value": "B", "start": 2, "end": 3, "confidence": 1.0, "entry_id": 2},
    ]
    structured, _ = _assemble_structured("resume", preds)
    assert structured["experience"] == [{"company": "A"}, {"company": "B"}]


# ---------------------------------------------------------------------------
# run_extract end-to-end (with fake model)
# ---------------------------------------------------------------------------


def test_run_extract_with_fake_model(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeModel(
        [
            {"section": "personal", "field": "full_name", "value": "Jane Doe", "start": 0, "end": 8, "confidence": 0.93},
            {"section": "personal", "field": "email", "value": "jane@x.com", "start": 10, "end": 20, "confidence": 0.71},
        ]
    )
    monkeypatch.setattr(inference, "_MODEL", fake)

    resp = run_extract(text="Jane Doe — jane@x.com", doc_type="resume")
    assert resp.model == inference.MODEL_NAME
    assert resp.structured["personal"]["full_name"] == "Jane Doe"
    assert resp.min_confidence == pytest.approx(0.71)
    assert resp.avg_confidence == pytest.approx(0.82)
    assert len(resp.spans) == 2
    assert fake.calls[0][0] == "Jane Doe — jane@x.com"


def test_run_extract_empty_predictions(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(inference, "_MODEL", FakeModel([]))
    resp = run_extract(text="nothing to extract", doc_type="invoice")
    assert resp.spans == []
    assert resp.structured == {}
    assert resp.min_confidence == 0.0
    assert resp.avg_confidence == 0.0


# ---------------------------------------------------------------------------
# HTTP routes (no real model)
# ---------------------------------------------------------------------------


def test_healthz(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(inference, "_MODEL", FakeModel([]))
    app = create_app()
    with TestClient(app) as client:
        r = client.get("/healthz")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["model"] == inference.MODEL_NAME


def test_extract_route(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeModel(
        [
            {"section": "personal", "field": "full_name", "value": "Jane Doe", "start": 0, "end": 8, "confidence": 0.93},
        ]
    )
    monkeypatch.setattr(inference, "_MODEL", fake)

    app = create_app()
    with TestClient(app) as client:
        r = client.post(
            "/v1/extract",
            json={"text": "Jane Doe", "doc_type": "resume"},
        )
    assert r.status_code == 200
    body = r.json()
    assert body["structured"]["personal"]["full_name"] == "Jane Doe"
    assert body["spans"][0]["path"] == "personal.full_name"
    assert body["model"] == inference.MODEL_NAME


def test_extract_rejects_unknown_doc_type() -> None:
    app = create_app()
    with TestClient(app) as client:
        r = client.post(
            "/v1/extract",
            json={"text": "anything", "doc_type": "manifesto"},
        )
    # Pydantic Literal validation fires before our handler runs.
    assert r.status_code == 422
