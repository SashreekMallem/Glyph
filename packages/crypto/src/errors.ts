/**
 * Error classes emitted by @glyph/crypto.
 *
 * These are distinct, programmatically-identifiable error types so callers
 * can respond differently to configuration vs. runtime crypto failures.
 * None of these errors include key material or plaintext in their messages.
 */

export class CryptoConfigError extends Error {
  public override readonly name = 'CryptoConfigError';

  public constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, CryptoConfigError.prototype);
  }
}

export class DecryptionError extends Error {
  public override readonly name = 'DecryptionError';

  public constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, DecryptionError.prototype);
  }
}

export class SignatureError extends Error {
  public override readonly name = 'SignatureError';

  public constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, SignatureError.prototype);
  }
}
