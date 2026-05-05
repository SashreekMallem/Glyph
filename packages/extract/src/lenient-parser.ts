// Lenient JSON parser for streaming partial output.
// Hand-rolled tokenizer + recursive descent. NEVER throws.
// Returns the deepest valid partial when input is truncated.

export interface ParseResult {
  value: unknown;
  complete: boolean;
  truncatedAt?: number;
  errors: string[];
}

const EOF = -1;

interface ParserState {
  src: string;
  pos: number;
  errors: string[];
  truncated: boolean;
  truncatedAt: number;
}

function isWhitespace(c: number): boolean {
  return c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;
}

function isDigit(c: number): boolean {
  return c >= 0x30 && c <= 0x39;
}

function isIdentStart(c: number): boolean {
  return (
    (c >= 0x41 && c <= 0x5a) ||
    (c >= 0x61 && c <= 0x7a) ||
    c === 0x5f ||
    c === 0x24
  );
}

function isIdentPart(c: number): boolean {
  return isIdentStart(c) || isDigit(c);
}

function peek(s: ParserState, off = 0): number {
  const p = s.pos + off;
  if (p >= s.src.length) return EOF;
  return s.src.charCodeAt(p);
}

function markTruncated(s: ParserState): void {
  if (!s.truncated) {
    s.truncated = true;
    s.truncatedAt = s.pos;
  }
}

function skipWhitespaceAndComments(s: ParserState): void {
  for (;;) {
    while (s.pos < s.src.length && isWhitespace(s.src.charCodeAt(s.pos))) {
      s.pos++;
    }
    if (s.pos >= s.src.length) return;
    const c = s.src.charCodeAt(s.pos);
    if (c === 0x2f && peek(s, 1) === 0x2f) {
      // line comment
      s.pos += 2;
      while (s.pos < s.src.length) {
        const cc = s.src.charCodeAt(s.pos);
        s.pos++;
        if (cc === 0x0a) break;
      }
      continue;
    }
    if (c === 0x2f && peek(s, 1) === 0x2a) {
      // block comment
      s.pos += 2;
      let closed = false;
      while (s.pos < s.src.length) {
        if (
          s.src.charCodeAt(s.pos) === 0x2a &&
          peek(s, 1) === 0x2f
        ) {
          s.pos += 2;
          closed = true;
          break;
        }
        s.pos++;
      }
      if (!closed) {
        markTruncated(s);
        s.errors.push('Unterminated block comment');
      }
      continue;
    }
    return;
  }
}

interface ParsedValue {
  ok: boolean;
  value: unknown;
}

function fail(): ParsedValue {
  return { ok: false, value: undefined };
}

function ok(value: unknown): ParsedValue {
  return { ok: true, value };
}

// Parse a hex-4 escape; returns -1 if invalid/truncated.
function parseHex4(s: ParserState): number {
  if (s.pos + 4 > s.src.length) {
    s.pos = s.src.length;
    return -1;
  }
  let code = 0;
  for (let i = 0; i < 4; i++) {
    const c = s.src.charCodeAt(s.pos + i);
    let d: number;
    if (c >= 0x30 && c <= 0x39) d = c - 0x30;
    else if (c >= 0x41 && c <= 0x46) d = c - 0x41 + 10;
    else if (c >= 0x61 && c <= 0x66) d = c - 0x61 + 10;
    else return -1;
    code = (code << 4) | d;
  }
  s.pos += 4;
  return code;
}

function parseString(s: ParserState, quote: number): ParsedValue {
  // assumes s.pos is at the opening quote
  s.pos++; // skip opening
  let out = '';
  while (s.pos < s.src.length) {
    const c = s.src.charCodeAt(s.pos);
    if (c === quote) {
      s.pos++;
      return ok(out);
    }
    if (c === 0x5c) {
      // backslash
      if (s.pos + 1 >= s.src.length) {
        // truncated escape: treat partial string as value
        markTruncated(s);
        s.pos = s.src.length;
        return ok(out);
      }
      const esc = s.src.charCodeAt(s.pos + 1);
      s.pos += 2;
      switch (esc) {
        case 0x22:
          out += '"';
          break;
        case 0x27:
          out += "'";
          break;
        case 0x5c:
          out += '\\';
          break;
        case 0x2f:
          out += '/';
          break;
        case 0x62:
          out += '\b';
          break;
        case 0x66:
          out += '\f';
          break;
        case 0x6e:
          out += '\n';
          break;
        case 0x72:
          out += '\r';
          break;
        case 0x74:
          out += '\t';
          break;
        case 0x75: {
          const code = parseHex4(s);
          if (code < 0) {
            markTruncated(s);
            return ok(out);
          }
          // Surrogate pair handling
          if (code >= 0xd800 && code <= 0xdbff) {
            if (
              peek(s) === 0x5c &&
              peek(s, 1) === 0x75
            ) {
              s.pos += 2;
              const low = parseHex4(s);
              if (low >= 0xdc00 && low <= 0xdfff) {
                const combined =
                  0x10000 +
                  ((code - 0xd800) << 10) +
                  (low - 0xdc00);
                out += String.fromCodePoint(combined);
              } else if (low < 0) {
                markTruncated(s);
                return ok(out);
              } else {
                out += String.fromCharCode(code);
                out += String.fromCharCode(low);
              }
            } else {
              out += String.fromCharCode(code);
            }
          } else {
            out += String.fromCharCode(code);
          }
          break;
        }
        default:
          out += String.fromCharCode(esc);
          break;
      }
      continue;
    }
    // Regular character (handle astral via surrogate codepoints in JS strings)
    out += s.src[s.pos];
    s.pos++;
  }
  // EOF mid-string: lenient — treat partial as value
  markTruncated(s);
  return ok(out);
}

function parseNumber(s: ParserState): ParsedValue {
  const start = s.pos;
  if (peek(s) === 0x2d) s.pos++; // -
  let sawDigit = false;
  while (s.pos < s.src.length && isDigit(s.src.charCodeAt(s.pos))) {
    s.pos++;
    sawDigit = true;
  }
  if (peek(s) === 0x2e) {
    s.pos++;
    while (s.pos < s.src.length && isDigit(s.src.charCodeAt(s.pos))) {
      s.pos++;
      sawDigit = true;
    }
  }
  const ec = peek(s);
  if (ec === 0x65 || ec === 0x45) {
    const expStart = s.pos;
    s.pos++;
    const sgn = peek(s);
    if (sgn === 0x2b || sgn === 0x2d) s.pos++;
    let expDigit = false;
    while (s.pos < s.src.length && isDigit(s.src.charCodeAt(s.pos))) {
      s.pos++;
      expDigit = true;
    }
    if (!expDigit) {
      // truncated exponent — back up; but if we're at EOF, mark truncated
      if (s.pos >= s.src.length) {
        markTruncated(s);
        s.pos = expStart;
      } else {
        // bad exponent; rewind
        s.pos = expStart;
      }
    }
  }
  if (!sawDigit) {
    s.pos = start;
    return fail();
  }
  const text = s.src.slice(start, s.pos);
  const n = Number(text);
  if (Number.isNaN(n)) {
    return fail();
  }
  return ok(n);
}

// Match keyword among true/false/null. If fully matches, return value.
// If a prefix of one of these (truncation), advance to EOF and return fail+truncated.
// Otherwise, fail without advancing.
function parseKeyword(s: ParserState): ParsedValue {
  const start = s.pos;
  // collect identifier-ish run
  let end = start;
  while (
    end < s.src.length &&
    isIdentPart(s.src.charCodeAt(end))
  ) {
    end++;
  }
  const word = s.src.slice(start, end);
  if (word === 'true') {
    s.pos = end;
    return ok(true);
  }
  if (word === 'false') {
    s.pos = end;
    return ok(false);
  }
  if (word === 'null') {
    s.pos = end;
    return ok(null);
  }
  // Check for truncated prefix at EOF
  if (
    end >= s.src.length &&
    word.length > 0 &&
    ('true'.startsWith(word) ||
      'false'.startsWith(word) ||
      'null'.startsWith(word))
  ) {
    markTruncated(s);
    s.pos = end;
    return fail();
  }
  // Not a keyword
  return fail();
}

function parseIdentifier(s: ParserState): ParsedValue {
  const start = s.pos;
  if (
    s.pos >= s.src.length ||
    !isIdentStart(s.src.charCodeAt(s.pos))
  ) {
    return fail();
  }
  s.pos++;
  while (
    s.pos < s.src.length &&
    isIdentPart(s.src.charCodeAt(s.pos))
  ) {
    s.pos++;
  }
  return ok(s.src.slice(start, s.pos));
}

function parseValue(s: ParserState): ParsedValue {
  skipWhitespaceAndComments(s);
  if (s.pos >= s.src.length) {
    markTruncated(s);
    return fail();
  }
  const c = s.src.charCodeAt(s.pos);
  if (c === 0x7b) return parseObject(s);
  if (c === 0x5b) return parseArray(s);
  if (c === 0x22) return parseString(s, 0x22);
  if (c === 0x27) return parseString(s, 0x27);
  if (c === 0x2d || isDigit(c)) return parseNumber(s);
  if (isIdentStart(c)) return parseKeyword(s);
  return fail();
}

function parseObject(s: ParserState): ParsedValue {
  // s.pos at {
  s.pos++;
  const obj: Record<string, unknown> = {};
  for (;;) {
    skipWhitespaceAndComments(s);
    if (s.pos >= s.src.length) {
      markTruncated(s);
      return ok(obj);
    }
    const c = s.src.charCodeAt(s.pos);
    if (c === 0x7d) {
      s.pos++;
      return ok(obj);
    }
    // parse key
    let key: string | undefined;
    if (c === 0x22 || c === 0x27) {
      const ks = parseString(s, c);
      if (!ks.ok) {
        markTruncated(s);
        return ok(obj);
      }
      // If we hit EOF inside key (truncated), drop key
      if (s.truncated && s.pos >= s.src.length) {
        return ok(obj);
      }
      key = ks.value as string;
    } else if (isIdentStart(c)) {
      const id = parseIdentifier(s);
      if (!id.ok) {
        markTruncated(s);
        return ok(obj);
      }
      key = id.value as string;
    } else {
      // invalid token in object position
      s.errors.push(
        `Unexpected character in object at ${s.pos}: ${s.src[s.pos]}`,
      );
      // attempt recovery: skip until , or }
      while (s.pos < s.src.length) {
        const cc = s.src.charCodeAt(s.pos);
        if (cc === 0x2c) {
          s.pos++;
          break;
        }
        if (cc === 0x7d) {
          s.pos++;
          return ok(obj);
        }
        s.pos++;
      }
      continue;
    }
    skipWhitespaceAndComments(s);
    if (s.pos >= s.src.length) {
      markTruncated(s);
      return ok(obj);
    }
    if (s.src.charCodeAt(s.pos) !== 0x3a) {
      s.errors.push(`Expected ':' after key '${key}' at ${s.pos}`);
      // try to continue: if it's , or }, treat as truncated key
      const nc = s.src.charCodeAt(s.pos);
      if (nc === 0x2c) {
        s.pos++;
        continue;
      }
      if (nc === 0x7d) {
        s.pos++;
        return ok(obj);
      }
      // otherwise drop and break
      markTruncated(s);
      return ok(obj);
    }
    s.pos++; // :
    skipWhitespaceAndComments(s);
    if (s.pos >= s.src.length) {
      markTruncated(s);
      return ok(obj);
    }
    const valBefore = s.pos;
    const v = parseValue(s);
    if (!v.ok) {
      // value failed — if truncated, drop in-progress key
      if (s.truncated || s.pos >= s.src.length) {
        markTruncated(s);
        return ok(obj);
      }
      // skip token and continue
      if (s.pos === valBefore) s.pos++;
      // recover until , or }
      while (s.pos < s.src.length) {
        const cc = s.src.charCodeAt(s.pos);
        if (cc === 0x2c || cc === 0x7d) break;
        s.pos++;
      }
    } else {
      obj[key] = v.value;
      // If after assigning the value, the source is exhausted and we marked truncated,
      // (e.g. truncated string), still keep the key.
    }
    skipWhitespaceAndComments(s);
    if (s.pos >= s.src.length) {
      markTruncated(s);
      return ok(obj);
    }
    const next = s.src.charCodeAt(s.pos);
    if (next === 0x2c) {
      s.pos++;
      continue;
    }
    if (next === 0x7d) {
      s.pos++;
      return ok(obj);
    }
    // mismatched bracket like ]
    if (next === 0x5d) {
      s.errors.push(
        `Mismatched bracket: expected '}' but found ']' at ${s.pos}`,
      );
      s.pos++;
      return ok(obj);
    }
    // unknown — truncate gracefully
    s.errors.push(
      `Unexpected character in object at ${s.pos}: ${s.src[s.pos]}`,
    );
    markTruncated(s);
    return ok(obj);
  }
}

function parseArray(s: ParserState): ParsedValue {
  s.pos++;
  const arr: unknown[] = [];
  for (;;) {
    skipWhitespaceAndComments(s);
    if (s.pos >= s.src.length) {
      markTruncated(s);
      return ok(arr);
    }
    const c = s.src.charCodeAt(s.pos);
    if (c === 0x5d) {
      s.pos++;
      return ok(arr);
    }
    const valBefore = s.pos;
    const truncBefore = s.truncated;
    const v = parseValue(s);
    if (!v.ok) {
      if (s.truncated || s.pos >= s.src.length) {
        markTruncated(s);
        return ok(arr);
      }
      // recover
      if (s.pos === valBefore) s.pos++;
      while (s.pos < s.src.length) {
        const cc = s.src.charCodeAt(s.pos);
        if (cc === 0x2c || cc === 0x5d) break;
        s.pos++;
      }
    } else {
      // If truncation occurred during this element parse, drop the partial.
      // Exception: a string parsed via lenient EOF still produced its partial,
      // which is a legitimate string value — keep strings. We detect this by
      // whether the value is a string (top-level scalar truncation is ok).
      if (
        !truncBefore &&
        s.truncated &&
        s.pos >= s.src.length &&
        typeof v.value !== 'string'
      ) {
        // partial container — drop
        return ok(arr);
      }
      arr.push(v.value);
    }
    skipWhitespaceAndComments(s);
    if (s.pos >= s.src.length) {
      markTruncated(s);
      return ok(arr);
    }
    const next = s.src.charCodeAt(s.pos);
    if (next === 0x2c) {
      s.pos++;
      continue;
    }
    if (next === 0x5d) {
      s.pos++;
      return ok(arr);
    }
    if (next === 0x7d) {
      s.errors.push(
        `Mismatched bracket: expected ']' but found '}' at ${s.pos}`,
      );
      s.pos++;
      return ok(arr);
    }
    s.errors.push(
      `Unexpected character in array at ${s.pos}: ${s.src[s.pos]}`,
    );
    markTruncated(s);
    return ok(arr);
  }
}

export function parsePartial(input: string): ParseResult {
  const errors: string[] = [];
  try {
    if (typeof input !== 'string' || input.length === 0) {
      return {
        value: undefined,
        complete: false,
        truncatedAt: 0,
        errors,
      };
    }
    let src = input;
    // Strip BOM
    if (src.charCodeAt(0) === 0xfeff) {
      src = src.slice(1);
    }
    const s: ParserState = {
      src,
      pos: 0,
      errors,
      truncated: false,
      truncatedAt: 0,
    };
    skipWhitespaceAndComments(s);
    if (s.pos >= s.src.length) {
      return {
        value: undefined,
        complete: false,
        truncatedAt: 0,
        errors,
      };
    }
    const v = parseValue(s);
    if (!v.ok) {
      // Could be truncated keyword or empty
      const truncatedAt = s.truncated ? s.truncatedAt : s.pos;
      return {
        value: undefined,
        complete: false,
        truncatedAt,
        errors,
      };
    }
    skipWhitespaceAndComments(s);
    if (s.pos < s.src.length) {
      // Trailing junk — return first value, mark not complete
      errors.push(
        `Unexpected trailing content at ${s.pos}: ${s.src.slice(s.pos, s.pos + 16)}`,
      );
      return {
        value: v.value,
        complete: false,
        truncatedAt: s.pos,
        errors,
      };
    }
    if (s.truncated) {
      return {
        value: v.value,
        complete: false,
        truncatedAt: s.truncatedAt,
        errors,
      };
    }
    return { value: v.value, complete: true, errors };
  } catch (e) {
    errors.push(
      e instanceof Error ? e.message : String(e),
    );
    return {
      value: undefined,
      complete: false,
      truncatedAt: 0,
      errors,
    };
  }
}
