"""Modal serverless deployment stub.

Deploy later with:
    modal deploy modal_app.py

This module is intentionally a thin wrapper: all inference logic lives in
`app/inference.py` so local uvicorn and Modal serverless behave identically.
"""

from __future__ import annotations

import modal

# Image: Python 3.11 + project source + GLiNER2 + FastAPI.
# We bake the model weights into the image to avoid cold-download on each
# container start. `from_pretrained` will hit the HF cache during build.
image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "gliner2>=0.1.0",
        "fastapi>=0.115.0",
        "uvicorn[standard]>=0.32.0",
        "pydantic>=2.9.0",
        "python-multipart>=0.0.12",
    )
    .add_local_python_source("app")
    .run_commands(
        # Pre-download model weights at build time so cold starts stay fast.
        'python -c "from gliner2 import GLiNER2; GLiNER2.from_pretrained(\'fastino/gliner2-large-v1\')"'
    )
)

app = modal.App("glyph-gliner-service", image=image)


@app.function(
    gpu="T4",
    timeout=120,
    # Keep one container warm so we don't pay the model-load latency every request.
    min_containers=1,
    max_containers=10,
)
@modal.concurrent(max_inputs=4)
@modal.asgi_app()
def fastapi_app():  # noqa: ANN201 — Modal expects a callable returning an ASGI app
    """Serve the same FastAPI app used in local dev."""
    from app.main import create_app

    return create_app()


@app.function(gpu="T4", timeout=60, min_containers=0)
def extract_remote(text: str, doc_type: str) -> dict:
    """Optional RPC-style entrypoint for direct Modal function calls.

    Mirrors POST /v1/extract; useful for backend-to-backend invocations that
    skip HTTP. Same inference path as the HTTP route.
    """
    from app.inference import run_extract

    return run_extract(text=text, doc_type=doc_type).model_dump()


if __name__ == "__main__":
    # `modal run modal_app.py` will execute this block locally for smoke-testing.
    print("Run `modal deploy modal_app.py` to deploy the serverless service.")
