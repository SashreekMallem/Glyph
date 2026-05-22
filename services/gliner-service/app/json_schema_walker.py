"""Walks a JSON Schema (Draft 7) and compiles it into a GLiNER2 schema.

GLiNER2's fluent builder works in "structures" (sections of fields). JSON
Schema works in nested object/array types. The walker bridges them:

  • A top-level `properties` is the document.
  • Any nested `type: object` becomes a GLiNER2 structure.
  • Any nested `type: array` whose `items` is an object becomes an array
    structure (cardinality info; assembled into a list on the way back).
  • Leaf scalar fields (string/number/integer/boolean) become GLiNER2
    `.field(name, dtype=..., description=...)` calls.

The walker also emits a `field_paths` map so we can reverse-walk extraction
results back into the JSON Schema shape (paths like `experience[0].company`).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable

from .inference_types import GLiNER2Protocol


@dataclass
class CompiledSchema:
    """Result of compiling a JSON Schema for GLiNER2."""

    # The actual GLiNER2 schema dict (what model.extract expects).
    gliner_schema: dict[str, Any]
    # Map: structure_name -> True if it should be an array section.
    cardinality: dict[str, bool] = field(default_factory=dict)
    # Map: structure_name -> json_schema_path (e.g. "personal" or "experience.items")
    structure_paths: dict[str, list[str]] = field(default_factory=dict)
    # Every leaf field path the schema declares, as dot-notation.
    # e.g. ["personal.full_name", "experience[].company", ...]
    declared_paths: list[str] = field(default_factory=list)


_SCALAR_TYPES = {"string", "number", "integer", "boolean"}


def _coerce_dtype(json_type: str | list[str] | None) -> str:
    """Map JSON Schema scalar types to GLiNER2 dtypes.

    GLiNER2 only differentiates "str" vs "list"; we always emit "str" for
    scalars because the model returns text spans (the caller can cast).
    """
    if isinstance(json_type, list):
        json_type = next((t for t in json_type if t in _SCALAR_TYPES), None)
    return "str"


def _flatten_section_name(path: Iterable[str]) -> str:
    """A.b.c -> "a_b_c" so GLiNER2 sees a flat structure name."""
    return "_".join(p for p in path if p)


def _walk_object(
    builder: Any,
    obj_schema: dict[str, Any],
    section_path: list[str],
    cardinality: dict[str, bool],
    structure_paths: dict[str, list[str]],
    declared_paths: list[str],
    is_array: bool,
    parent_dot_path: str,
) -> Any:
    """Emit a single GLiNER2 .structure() block for an object schema.

    Recurses into nested objects/arrays. Returns the builder so the caller
    can chain .build() at the very end.
    """
    section_name = _flatten_section_name(section_path) or "root"
    cardinality[section_name] = is_array
    structure_paths[section_name] = list(section_path)

    sb = builder.structure(section_name)

    properties = obj_schema.get("properties", {})
    if not isinstance(properties, dict):
        return sb

    nested_sections: list[tuple[str, dict[str, Any], bool]] = []

    for field_name, field_schema in properties.items():
        if not isinstance(field_schema, dict):
            continue

        ftype = field_schema.get("type")
        description = field_schema.get("description") or field_schema.get("title") or field_name

        if ftype == "object":
            # Nested object → emit as a separate structure after we finish this one.
            nested_sections.append((field_name, field_schema, False))
            continue

        if ftype == "array":
            items = field_schema.get("items")
            if isinstance(items, dict) and items.get("type") == "object":
                # Array of objects → separate array structure.
                nested_sections.append((field_name, items, True))
                continue
            # Array of scalars → flatten as a single "list" field on this section.
            scalar_dtype = "list"
            dot_path = f"{parent_dot_path}.{field_name}" if parent_dot_path else field_name
            declared_paths.append(f"{dot_path}[]")
            sb = sb.field(
                field_name,
                dtype=scalar_dtype,
                description=str(description),
            )
            continue

        if ftype in _SCALAR_TYPES or ftype is None:
            dot_path = f"{parent_dot_path}.{field_name}" if parent_dot_path else field_name
            declared_paths.append(dot_path)
            sb = sb.field(
                field_name,
                dtype=_coerce_dtype(ftype),
                description=str(description),
            )

    # Emit nested sections after the current one.
    cur = sb
    for nested_name, nested_schema, nested_is_array in nested_sections:
        new_path = section_path + [nested_name]
        cur = _walk_object(
            cur,
            nested_schema,
            new_path,
            cardinality,
            structure_paths,
            declared_paths,
            is_array=nested_is_array,
            parent_dot_path=(
                f"{parent_dot_path}.{nested_name}" if parent_dot_path else nested_name
            ),
        )

    return cur


def compile_schema(model: GLiNER2Protocol, json_schema: dict[str, Any]) -> CompiledSchema:
    """Compile a JSON Schema (Draft 7) into a GLiNER2 schema.

    Raises ValueError if the input isn't a recognizable object schema.
    """
    if not isinstance(json_schema, dict):
        raise ValueError("json_schema must be a dict")
    if json_schema.get("type") not in ("object", None):
        raise ValueError(f"top-level type must be 'object', got {json_schema.get('type')!r}")

    properties = json_schema.get("properties")
    if not isinstance(properties, dict) or not properties:
        raise ValueError("json_schema must declare a non-empty properties map")

    cardinality: dict[str, bool] = {}
    structure_paths: dict[str, list[str]] = {}
    declared_paths: list[str] = []

    builder = model.create_schema()

    # Iterate over top-level properties; each top-level object/array-of-objects
    # becomes its own structure. Top-level scalars are bucketed under a
    # synthetic "root" structure.
    top_level_scalars: dict[str, dict[str, Any]] = {}

    for prop_name, prop_schema in properties.items():
        if not isinstance(prop_schema, dict):
            continue
        ptype = prop_schema.get("type")
        if ptype == "object":
            builder = _walk_object(
                builder,
                prop_schema,
                section_path=[prop_name],
                cardinality=cardinality,
                structure_paths=structure_paths,
                declared_paths=declared_paths,
                is_array=False,
                parent_dot_path=prop_name,
            )
        elif ptype == "array" and isinstance(prop_schema.get("items"), dict) and prop_schema["items"].get("type") == "object":
            builder = _walk_object(
                builder,
                prop_schema["items"],
                section_path=[prop_name],
                cardinality=cardinality,
                structure_paths=structure_paths,
                declared_paths=declared_paths,
                is_array=True,
                parent_dot_path=prop_name,
            )
        else:
            # Scalar top-level field — collect, emit as one root structure at the end.
            top_level_scalars[prop_name] = prop_schema

    if top_level_scalars:
        root_section = "_root"
        cardinality[root_section] = False
        structure_paths[root_section] = []
        sb = builder.structure(root_section)
        for name, sch in top_level_scalars.items():
            description = sch.get("description") or sch.get("title") or name
            ftype = sch.get("type")
            if ftype == "array":
                sb = sb.field(name, dtype="list", description=str(description))
                declared_paths.append(f"{name}[]")
            else:
                sb = sb.field(name, dtype="str", description=str(description))
                declared_paths.append(name)
        builder = sb

    gliner_schema = builder.build()

    return CompiledSchema(
        gliner_schema=gliner_schema,
        cardinality=cardinality,
        structure_paths=structure_paths,
        declared_paths=declared_paths,
    )
