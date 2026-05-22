"""End-to-end test against the real GLiNER2 model.

Skipped by default — the model is ~720MB and these tests are slow. Run
explicitly when you want to validate real inference output:

    GLYPH_RUN_E2E=1 pytest tests/test_e2e.py -v

The test exercises all three doc types with short, realistic samples.
"""

from __future__ import annotations

import os

import pytest

pytestmark = pytest.mark.skipif(
    os.environ.get("GLYPH_RUN_E2E") != "1",
    reason="Set GLYPH_RUN_E2E=1 to run real-model E2E tests (~720MB model download).",
)


RESUME_SAMPLE = """\
Jane Doe
jane.doe@example.com | (415) 555-0123 | San Francisco, CA
https://linkedin.com/in/janedoe

EXPERIENCE
Acme Corp — Senior Software Engineer
2021-03-15 to present
San Francisco, CA
Led the platform team building distributed systems in Rust and Go.

Globex — Software Engineer
2018-06-01 to 2021-03-01
Built backend services in Python.

EDUCATION
Stanford University
B.S. Computer Science, 2018
GPA 3.9
"""

CONTRACT_SAMPLE = """\
SERVICES AGREEMENT

This agreement is entered into on 2025-01-15 between:
  Acme Corp (the "Client"), 123 Main St, San Francisco, CA
  and Studio LLC (the "Vendor"), 456 Oak Ave, Brooklyn, NY

Effective date: 2025-02-01
Expires: 2026-02-01

PAYMENT: Vendor will be paid $50,000 USD, net 30 days.

OBLIGATIONS:
  Vendor shall deliver the final report by 2025-06-30.
  Client shall provide raw data by 2025-03-01.

GOVERNING LAW: This agreement is governed by the laws of California.
Either party may terminate with 30 days notice.
This agreement is confidential.
"""

INVOICE_SAMPLE = """\
INVOICE #INV-2025-0042
Issued: 2025-05-01
Due:    2025-05-31

From: Studio LLC, 456 Oak Ave, Brooklyn, NY, billing@studio.example
To:   Acme Corp, 123 Main St, San Francisco, CA, ap@acme.example

Item                     Qty   Unit    Total
Design services            40  150.00  6000.00
Project management         10  120.00  1200.00

Subtotal:  7200.00
Tax (8.5%): 612.00
Total:     7812.00 USD

Payment by ACH to routing 123456789 account 987654321.
"""


def test_resume_extraction() -> None:
    from app.inference import run_extract

    resp = run_extract(text=RESUME_SAMPLE, doc_type="resume")
    assert resp.model
    assert resp.duration_ms >= 0
    assert resp.structured, "expected non-empty structured output"

    personal = resp.structured.get("personal", {})
    # We don't pin exact values — model output isn't deterministic — but at
    # least one of the obvious fields should be picked up.
    assert any(personal.get(k) for k in ("full_name", "email")), personal


def test_contract_extraction() -> None:
    from app.inference import run_extract

    resp = run_extract(text=CONTRACT_SAMPLE, doc_type="contract")
    assert resp.structured
    parties = resp.structured.get("parties", [])
    assert isinstance(parties, list)
    assert len(parties) >= 1


def test_invoice_extraction() -> None:
    from app.inference import run_extract

    resp = run_extract(text=INVOICE_SAMPLE, doc_type="invoice")
    assert resp.structured
    header = resp.structured.get("header", {})
    assert header or resp.structured.get("line_items"), resp.structured
