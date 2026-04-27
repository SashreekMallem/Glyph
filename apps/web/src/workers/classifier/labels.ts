import type { DocumentType } from "../shared/messages";

/**
 * Candidate label sets per document type for the zero-shot classifier.
 *
 * Hypothesis template used by the pipeline is `"This text is a {}."` —
 * labels should read naturally in that slot ("This text is a party name.").
 */
export const CLASSIFIER_LABELS: Record<DocumentType, string[]> = {
  contract: [
    "party name",
    "payment term",
    "obligation",
    "effective date",
    "expiry date",
    "governing law",
    "termination clause",
    "confidentiality clause",
  ],
  resume: [
    "work experience",
    "education",
    "skills",
    "contact information",
    "summary",
    "certification",
    "achievement",
  ],
  invoice: [
    "vendor information",
    "billing address",
    "line item",
    "payment terms",
    "total amount",
    "due date",
    "tax",
  ],
};

export const MIN_TEXT_LENGTH = 10;
export const CONFIDENCE_THRESHOLD = 0.85;
export const HYPOTHESIS_TEMPLATE = "This text is a {}.";
