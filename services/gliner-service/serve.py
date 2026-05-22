"""Local-dev entrypoint: `python serve.py` to boot uvicorn on :8000.

For production/serverless deployment, see `modal_app.py`. Both paths share
the same inference code in `app/inference.py`.
"""

from __future__ import annotations

import logging
import os

import uvicorn


def main() -> None:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s :: %(message)s",
    )

    host = os.environ.get("GLINER_HOST", "127.0.0.1")
    port = int(os.environ.get("GLINER_PORT", "8000"))
    reload_flag = os.environ.get("GLINER_RELOAD", "0") == "1"

    # NEVER bind to 0.0.0.0 unless behind a private network — this service is
    # internal-only and has no auth of its own.
    uvicorn.run(
        "app.main:app",
        host=host,
        port=port,
        reload=reload_flag,
        log_level=os.environ.get("LOG_LEVEL", "info").lower(),
    )


if __name__ == "__main__":
    main()
