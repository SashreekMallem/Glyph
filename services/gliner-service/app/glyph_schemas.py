"""GLiNER2 schema definitions mapped from Glyph's Zod schema-library.

Each schema mirrors `packages/schema-library/src/{resume,contract,invoice}.ts`.
GLiNER2 uses a declarative `@section` / `field::type::description` syntax —
sections become object keys, and repeated sections become arrays.

NOTE: GLiNER2's schema parser is whitespace-sensitive. Use 2-space indents and
keep the leading `@section` flush-left. Types we use:
  - str   → string
  - int   → integer
  - float → number
  - bool  → boolean
  - date  → ISO 8601 date string
"""

from __future__ import annotations

from typing import Final

# ---------------------------------------------------------------------------
# Resume — mirrors packages/schema-library/src/resume.ts
# ---------------------------------------------------------------------------
RESUME_SCHEMA: Final[str] = """
@personal
  full_name::str::Person's full legal name
  email::str::Primary email address
  phone::str::Phone number
  linkedin::str::LinkedIn profile URL
  location::str::City, state, or country of residence
  website::str::Personal website or portfolio URL

@summary
  summary::str::Professional summary or objective statement

@experience[]
  company::str::Employer name
  title::str::Job title or position held
  start_date::date::ISO 8601 start date (YYYY-MM-DD)
  end_date::date::ISO 8601 end date or null if present
  location::str::Work location (city, remote, etc.)
  description::str::Description of role and responsibilities
  achievements::str::Notable achievement bullet

@education[]
  institution::str::School or university name
  degree::str::Degree earned (e.g. B.S., M.A., Ph.D.)
  field::str::Field of study or major
  graduation_year::int::Year of graduation
  gpa::float::Grade point average on a 4.0 scale

@skills[]
  category::str::Skill category (e.g. languages, frameworks)
  items::str::Individual skill name

@certifications[]
  name::str::Certification name
  issuer::str::Issuing organization
  issued_date::date::ISO 8601 date certification was issued
  expires_date::date::ISO 8601 expiration date
"""

# ---------------------------------------------------------------------------
# Contract — mirrors packages/schema-library/src/contract.ts
# ---------------------------------------------------------------------------
CONTRACT_SCHEMA: Final[str] = """
@parties[]
  name::str::Party legal name
  role::str::Party role (client, vendor, employer, employee, landlord, tenant, buyer, seller, licensor, licensee, party)
  address::str::Party mailing address
  email::str::Party contact email

@dates
  effective_date::date::ISO 8601 contract effective date
  expiry_date::date::ISO 8601 contract expiry date

@payment_terms
  amount::float::Payment amount
  currency::str::3-letter ISO 4217 currency code
  schedule::str::Payment schedule (upfront, monthly, quarterly, annually, on_delivery, net_30, net_60, net_90, milestone)
  due_days::int::Days until payment is due

@obligations[]
  party::str::Obligated party name
  description::str::Description of the obligation
  deadline::date::ISO 8601 deadline for the obligation

@terms
  governing_law::str::Jurisdiction whose law governs the contract
  confidentiality::bool::Whether a confidentiality clause is present
  termination_notice_days::int::Days of notice required to terminate
"""

# ---------------------------------------------------------------------------
# Invoice — mirrors packages/schema-library/src/invoice.ts
# ---------------------------------------------------------------------------
INVOICE_SCHEMA: Final[str] = """
@header
  invoice_number::str::Unique invoice identifier
  issue_date::date::ISO 8601 issue date
  due_date::date::ISO 8601 payment due date
  currency::str::3-letter ISO 4217 currency code

@vendor
  name::str::Vendor or seller legal name
  address::str::Vendor mailing address
  email::str::Vendor contact email
  phone::str::Vendor phone number
  tax_id::str::Vendor tax identification number

@bill_to
  name::str::Customer or buyer legal name
  address::str::Customer mailing address
  email::str::Customer contact email
  phone::str::Customer phone number
  tax_id::str::Customer tax identification number

@line_items[]
  description::str::Line item description
  quantity::float::Quantity ordered
  unit_price::float::Price per unit
  total::float::Line total (quantity * unit_price)

@totals
  subtotal::float::Sum of all line items before tax
  tax_rate::float::Tax rate as a decimal (0.0 to 1.0)
  tax_amount::float::Total tax amount
  total::float::Grand total after tax

@notes
  notes::str::Additional notes
  payment_instructions::str::Payment instructions
"""


# Section-to-cardinality map so the structured assembler knows when a section
# should become an array (`@section[]`) vs an object (`@section`).
def _parse_cardinality(schema_text: str) -> dict[str, bool]:
    """Return a mapping of section_name -> is_array."""
    cardinality: dict[str, bool] = {}
    for raw in schema_text.splitlines():
        line = raw.strip()
        if line.startswith("@"):
            name = line[1:]
            is_array = name.endswith("[]")
            if is_array:
                name = name[:-2]
            cardinality[name] = is_array
    return cardinality


SCHEMAS: Final[dict[str, str]] = {
    "resume": RESUME_SCHEMA,
    "contract": CONTRACT_SCHEMA,
    "invoice": INVOICE_SCHEMA,
}

CARDINALITY: Final[dict[str, dict[str, bool]]] = {
    name: _parse_cardinality(schema) for name, schema in SCHEMAS.items()
}


def get_schema(doc_type: str) -> str:
    """Return the GLiNER2 schema string for a Glyph document type."""
    if doc_type not in SCHEMAS:
        raise ValueError(
            f"Unknown doc_type {doc_type!r}; expected one of {sorted(SCHEMAS)}"
        )
    return SCHEMAS[doc_type]


def is_array_section(doc_type: str, section: str) -> bool:
    """Return True if a section is a repeated (array) section for this doc_type."""
    return CARDINALITY.get(doc_type, {}).get(section, False)
