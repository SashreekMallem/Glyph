"""Offline unit tests — mock the GLiNER2 model and verify the schema-agnostic
walker + extractor.

Tests cover:
  - JSON Schema → GLiNER2 fluent compilation
  - Cardinality derivation from `type: "array"` vs `type: "object"`
  - Nested-dict response walked back into the JSON Schema shape
  - missing_paths computation
  - HTTP routes via FastAPI's TestClient
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from app import inference
from app.json_schema_walker import compile_schema
from app.main import create_app


# ---------------------------------------------------------------------------
# Test doubles
# ---------------------------------------------------------------------------


class FakeStructureBuilder:
    def __init__(self, parent: "FakeSchemaBuilder", name: str) -> None:
        self._parent = parent
        self._name = name

    def field(self, *args: Any, **_kwargs: Any) -> "FakeStructureBuilder":
        if args:
            self._parent._fields.setdefault(self._name, []).append(args[0])
        return self

    def structure(self, name: str) -> "FakeStructureBuilder":
        return self._parent.structure(name)

    def build(self) -> dict[str, Any]:
        return self._parent.build()


class FakeSchemaBuilder:
    def __init__(self) -> None:
        self._sections: list[str] = []
        self._fields: dict[str, list[str]] = {}

    def structure(self, name: str) -> FakeStructureBuilder:
        if name not in self._sections:
            self._sections.append(name)
        return FakeStructureBuilder(self, name)

    def build(self) -> dict[str, Any]:
        return {"sections": self._sections, "fields": self._fields}


class FakeModel:
    def __init__(self, response: dict[str, Any]) -> None:
        self._response = response
        self.calls: list[dict[str, Any]] = []

    def create_schema(self) -> FakeSchemaBuilder:
        return FakeSchemaBuilder()

    def extract(self, **kwargs: Any) -> dict[str, Any]:
        self.calls.append(kwargs)
        return self._response


@pytest.fixture(autouse=True)
def _reset_model_singleton(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(inference, "_MODEL", None)


# ---------------------------------------------------------------------------
# Fixtures: sample JSON Schemas
# ---------------------------------------------------------------------------


def _resume_like_schema() -> dict[str, Any]:
    """A small JSON Schema with one object section and one array-of-objects section."""
    return {
        "type": "object",
        "properties": {
            "personal": {
                "type": "object",
                "properties": {
                    "full_name": {"type": "string", "description": "Person's full legal name"},
                    "email": {"type": "string", "description": "Primary email address"},
                },
            },
            "experience": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "company": {"type": "string", "description": "Employer"},
                        "title": {"type": "string", "description": "Job title"},
                    },
                },
            },
        },
    }


def _ad_hoc_schema() -> dict[str, Any]:
    """A schema for a totally novel doc type — proves nothing is hardcoded."""
    return {
        "type": "object",
        "properties": {
            "patient": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Patient name"},
                    "species": {"type": "string", "description": "Animal species"},
                },
            },
            "visits": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "date": {"type": "string", "description": "Visit date"},
                        "diagnosis": {"type": "string", "description": "Vet diagnosis"},
                    },
                },
            },
        },
    }


def _match(text: str, conf: float, start: int, end: int) -> dict[str, Any]:
    return {"text": text, "confidence": conf, "start": start, "end": end}


# ---------------------------------------------------------------------------
# compile_schema
# ---------------------------------------------------------------------------


def test_compile_rejects_non_object_top_level() -> None:
    model = FakeModel({})
    with pytest.raises(ValueError):
        compile_schema(model, {"type": "string"})


def test_compile_rejects_empty_properties() -> None:
    model = FakeModel({})
    with pytest.raises(ValueError):
        compile_schema(model, {"type": "object", "properties": {}})


def test_compile_resume_like_schema() -> None:
    model = FakeModel({})
    compiled = compile_schema(model, _resume_like_schema())
    # Both top-level sections registered.
    assert "personal" in compiled.cardinality
    assert "experience" in compiled.cardinality
    # Cardinality derived from JSON Schema type.
    assert compiled.cardinality["personal"] is False
    assert compiled.cardinality["experience"] is True
    # Declared paths captured.
    assert "personal.full_name" in compiled.declared_paths
    assert "personal.email" in compiled.declared_paths
    assert "experience.company" in compiled.declared_paths


def test_compile_ad_hoc_schema_works_too() -> None:
    """Proves nothing is doc-type specific — vet records work without code changes."""
    model = FakeModel({})
    compiled = compile_schema(model, _ad_hoc_schema())
    assert compiled.cardinality == {"patient": False, "visits": True}
    assert set(compiled.declared_paths) == {
        "patient.name",
        "patient.species",
        "visits.date",
        "visits.diagnosis",
    }


def test_compile_top_level_scalars_collected_into_root() -> None:
    model = FakeModel({})
    schema = {
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "Document title"},
            "tags": {"type": "array", "items": {"type": "string"}},
        },
    }
    compiled = compile_schema(model, schema)
    assert "_root" in compiled.cardinality
    assert compiled.cardinality["_root"] is False
    assert "title" in compiled.declared_paths
    assert "tags[]" in compiled.declared_paths


# ---------------------------------------------------------------------------
# _assemble_from_compiled — walk model output back into JSON Schema shape
# ---------------------------------------------------------------------------


def test_assemble_collapses_single_entry_object_section() -> None:
    model = FakeModel({})
    compiled = compile_schema(model, _resume_like_schema())
    raw: dict[str, Any] = {
        "personal": [
            {
                "full_name": [_match("Jane Doe", 0.99, 0, 8)],
                "email": [_match("jane@x.com", 0.97, 10, 20)],
            }
        ]
    }
    structured, spans, filled = inference._assemble_from_compiled(raw, compiled)
    assert structured == {
        "personal": {"full_name": "Jane Doe", "email": "jane@x.com"}
    }
    assert filled == {"personal.full_name", "personal.email"}
    assert {s.path for s in spans} == {"personal.full_name", "personal.email"}


def test_assemble_preserves_array_section_entries() -> None:
    model = FakeModel({})
    compiled = compile_schema(model, _resume_like_schema())
    raw: dict[str, Any] = {
        "experience": [
            {
                "company": [_match("Acme", 0.95, 0, 4)],
                "title": [_match("Engineer", 0.9, 5, 13)],
            },
            {
                "company": [_match("Globex", 0.96, 20, 26)],
                "title": [_match("Lead", 0.92, 27, 31)],
            },
        ]
    }
    structured, spans, _filled = inference._assemble_from_compiled(raw, compiled)
    assert structured["experience"] == [
        {"company": "Acme", "title": "Engineer"},
        {"company": "Globex", "title": "Lead"},
    ]
    paths = {s.path for s in spans}
    assert "experience[0].company" in paths
    assert "experience[1].title" in paths


def test_assemble_picks_highest_confidence_match() -> None:
    model = FakeModel({})
    compiled = compile_schema(model, _resume_like_schema())
    raw: dict[str, Any] = {
        "personal": [
            {
                "full_name": [
                    _match("Jane", 0.5, 0, 4),
                    _match("Jane Doe", 0.97, 0, 8),
                ],
            }
        ]
    }
    structured, _, _ = inference._assemble_from_compiled(raw, compiled)
    assert structured["personal"]["full_name"] == "Jane Doe"


def test_assemble_ignores_unknown_structure_names() -> None:
    """Model hallucinates a section we didn't ask for — drop it silently."""
    model = FakeModel({})
    compiled = compile_schema(model, _resume_like_schema())
    raw: dict[str, Any] = {
        "personal": [{"full_name": [_match("Jane", 0.9, 0, 4)]}],
        "ghost_section": [{"x": [_match("y", 0.9, 0, 1)]}],
    }
    structured, _, _ = inference._assemble_from_compiled(raw, compiled)
    assert "ghost_section" not in structured
    assert structured["personal"]["full_name"] == "Jane"


# ---------------------------------------------------------------------------
# run_extract — end-to-end with fake model
# ---------------------------------------------------------------------------


def test_run_extract_with_fake_model(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeModel(
        {
            "personal": [
                {
                    "full_name": [_match("Jane Doe", 0.93, 0, 8)],
                    "email": [_match("jane@x.com", 0.71, 10, 20)],
                }
            ]
        }
    )
    monkeypatch.setattr(inference, "_MODEL", fake)

    resp = inference.run_extract(
        text="Jane Doe — jane@x.com",
        json_schema=_resume_like_schema(),
    )
    assert resp.structured["personal"]["full_name"] == "Jane Doe"
    assert resp.min_confidence == pytest.approx(0.71)
    assert resp.avg_confidence == pytest.approx(0.82)
    assert len(resp.spans) == 2
    # The fake model recorded extract kwargs.
    assert fake.calls[0]["text"] == "Jane Doe — jane@x.com"
    assert fake.calls[0]["include_confidence"] is True


def test_run_extract_reports_missing_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    """Schema declares more fields than the model fills — they show up as missing."""
    fake = FakeModel(
        {"personal": [{"full_name": [_match("Jane Doe", 0.93, 0, 8)]}]}
    )
    monkeypatch.setattr(inference, "_MODEL", fake)

    resp = inference.run_extract(text="Jane Doe", json_schema=_resume_like_schema())
    # `personal.email` and the entire `experience.*` block are missing.
    assert "personal.email" in resp.missing_paths
    assert "experience.company" in resp.missing_paths
    assert "experience.title" in resp.missing_paths
    assert "personal.full_name" not in resp.missing_paths


def test_run_extract_empty_predictions(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(inference, "_MODEL", FakeModel({}))
    resp = inference.run_extract(text="nothing", json_schema=_resume_like_schema())
    assert resp.spans == []
    assert resp.structured == {}
    assert resp.min_confidence == 0.0


def test_run_extract_ad_hoc_schema(monkeypatch: pytest.MonkeyPatch) -> None:
    """The Python service has no idea what 'veterinary' means — it just walks the schema."""
    fake = FakeModel(
        {
            "patient": [
                {
                    "name": [_match("Whiskers", 0.95, 0, 8)],
                    "species": [_match("Cat", 0.9, 10, 13)],
                }
            ],
            "visits": [
                {
                    "date": [_match("2026-05-22", 0.88, 20, 30)],
                    "diagnosis": [_match("ear infection", 0.85, 32, 45)],
                }
            ],
        }
    )
    monkeypatch.setattr(inference, "_MODEL", fake)

    resp = inference.run_extract(
        text="Whiskers — Cat — 2026-05-22 — ear infection",
        json_schema=_ad_hoc_schema(),
    )
    assert resp.structured["patient"]["name"] == "Whiskers"
    assert resp.structured["visits"][0]["diagnosis"] == "ear infection"
    assert resp.missing_paths == []


# ---------------------------------------------------------------------------
# HTTP routes
# ---------------------------------------------------------------------------


def test_healthz(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(inference, "_MODEL", FakeModel({}))
    app = create_app()
    with TestClient(app) as client:
        r = client.get("/healthz")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["model"] == inference.MODEL_NAME


def test_extract_route_with_schema(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeModel(
        {"personal": [{"full_name": [_match("Jane Doe", 0.93, 0, 8)]}]}
    )
    monkeypatch.setattr(inference, "_MODEL", fake)

    app = create_app()
    with TestClient(app) as client:
        r = client.post(
            "/v1/extract",
            json={
                "text": "Jane Doe",
                "json_schema": _resume_like_schema(),
            },
        )
    assert r.status_code == 200
    body = r.json()
    assert body["structured"]["personal"]["full_name"] == "Jane Doe"
    assert body["spans"][0]["path"] == "personal.full_name"


def test_extract_route_rejects_invalid_schema(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(inference, "_MODEL", FakeModel({}))
    app = create_app()
    with TestClient(app) as client:
        r = client.post(
            "/v1/extract",
            json={"text": "anything", "json_schema": {"type": "string"}},
        )
    assert r.status_code == 400
