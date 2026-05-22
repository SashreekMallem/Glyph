"""Structural Protocol types for the GLiNER2 surface we use.

Kept in its own module so the walker and inference can both import without
circular dependencies.
"""

from __future__ import annotations

from typing import Any, Protocol


class StructureBuilderProtocol(Protocol):
    def field(
        self,
        name: str,
        dtype: str = "list",
        choices: list[str] | None = None,
        description: str | None = None,
        threshold: float | None = None,
    ) -> "StructureBuilderProtocol":
        ...

    def structure(self, name: str) -> "StructureBuilderProtocol":
        ...

    def build(self) -> dict[str, Any]:
        ...


class GLiNER2Protocol(Protocol):
    def create_schema(self) -> StructureBuilderProtocol:
        ...

    def extract(
        self,
        text: str,
        schema: dict[str, Any],
        threshold: float = 0.5,
        format_results: bool = True,
        include_confidence: bool = False,
        include_spans: bool = False,
        max_len: int | None = None,
    ) -> dict[str, Any]:
        ...
