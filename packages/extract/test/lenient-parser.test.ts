import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parsePartial } from '../src/lenient-parser.js';

describe('parsePartial', () => {
  it('1. complete valid object', () => {
    const r = parsePartial('{"name":"John","age":30}');
    expect(r.complete).toBe(true);
    expect(r.value).toEqual({ name: 'John', age: 30 });
  });

  it('2. complete valid array', () => {
    const r = parsePartial('[1,2,3,4]');
    expect(r.complete).toBe(true);
    expect(r.value).toEqual([1, 2, 3, 4]);
  });

  it('3. empty object', () => {
    const r = parsePartial('{}');
    expect(r.complete).toBe(true);
    expect(r.value).toEqual({});
  });

  it('4. empty array', () => {
    const r = parsePartial('[]');
    expect(r.complete).toBe(true);
    expect(r.value).toEqual([]);
  });

  it('5. nested complete', () => {
    const r = parsePartial('{"a":{"b":[1,2,3]}}');
    expect(r.complete).toBe(true);
    expect(r.value).toEqual({ a: { b: [1, 2, 3] } });
  });

  it('6. missing close brace', () => {
    const r = parsePartial('{"a":1');
    expect(r.complete).toBe(false);
    expect(r.value).toEqual({ a: 1 });
  });

  it('7. truncated string', () => {
    const r = parsePartial('{"a":"hel');
    expect(r.complete).toBe(false);
    expect(r.value).toEqual({ a: 'hel' });
  });

  it('8. truncated number', () => {
    const r = parsePartial('{"a":12');
    expect(r.complete).toBe(false);
    expect(r.value).toEqual({ a: 12 });
  });

  it('9. truncated keyword tru → drop a', () => {
    const r = parsePartial('{"a":tru');
    expect(r.complete).toBe(false);
    expect(r.value).toEqual({});
  });

  it('10. mid-key', () => {
    const r = parsePartial('{"a":1,"b');
    expect(r.complete).toBe(false);
    expect(r.value).toEqual({ a: 1 });
  });

  it('11. trailing comma object', () => {
    const r = parsePartial('{"a":1,}');
    expect(r.complete).toBe(true);
    expect(r.value).toEqual({ a: 1 });
  });

  it('12. trailing comma array', () => {
    const r = parsePartial('[1,2,]');
    expect(r.complete).toBe(true);
    expect(r.value).toEqual([1, 2]);
  });

  it("13. single quotes", () => {
    const r = parsePartial("{'a':'b'}");
    expect(r.complete).toBe(true);
    expect(r.value).toEqual({ a: 'b' });
  });

  it('14. unquoted keys', () => {
    const r = parsePartial('{a:1,b:2}');
    expect(r.complete).toBe(true);
    expect(r.value).toEqual({ a: 1, b: 2 });
  });

  it('15. line comment', () => {
    const r = parsePartial('{"a":1 // comment\n,"b":2}');
    expect(r.complete).toBe(true);
    expect(r.value).toEqual({ a: 1, b: 2 });
  });

  it('16. block comment', () => {
    const r = parsePartial('{"a":/*x*/1}');
    expect(r.complete).toBe(true);
    expect(r.value).toEqual({ a: 1 });
  });

  it('17. BOM', () => {
    const r = parsePartial('\uFEFF{"a":1}');
    expect(r.complete).toBe(true);
    expect(r.value).toEqual({ a: 1 });
  });

  it('18. leading whitespace', () => {
    const r = parsePartial('   {"a":1}');
    expect(r.complete).toBe(true);
    expect(r.value).toEqual({ a: 1 });
  });

  it('19. deeply nested 50 levels', () => {
    const open = '['.repeat(50);
    const close = ']'.repeat(50);
    const r = parsePartial(open + close);
    expect(r.complete).toBe(true);
    let v: unknown = r.value;
    for (let i = 0; i < 49; i++) {
      expect(Array.isArray(v)).toBe(true);
      v = (v as unknown[])[0];
    }
  });

  it('20. unicode escape', () => {
    const r = parsePartial('{"a":"\\u00e9"}');
    expect(r.complete).toBe(true);
    expect(r.value).toEqual({ a: 'é' });
  });

  it('21. surrogate pair emoji', () => {
    const r = parsePartial('{"a":"\\uD83D\\uDE00"}');
    expect(r.complete).toBe(true);
    expect(r.value).toEqual({ a: '😀' });
  });

  it('22. empty string input', () => {
    const r = parsePartial('');
    expect(r.value).toBeUndefined();
    expect(r.complete).toBe(false);
  });

  it('23. just {', () => {
    const r = parsePartial('{');
    expect(r.value).toEqual({});
    expect(r.complete).toBe(false);
  });

  it('24. just [', () => {
    const r = parsePartial('[');
    expect(r.value).toEqual([]);
    expect(r.complete).toBe(false);
  });

  it('25. mid-true tr → undefined; true → true', () => {
    const r1 = parsePartial('tr');
    expect(r1.value).toBeUndefined();
    expect(r1.complete).toBe(false);
    const r2 = parsePartial('true');
    expect(r2.value).toBe(true);
    expect(r2.complete).toBe(true);
  });

  it('26. mixed truncation', () => {
    const r = parsePartial('{"items":[{"a":1},{"a":');
    expect(r.complete).toBe(false);
    expect(r.value).toEqual({ items: [{ a: 1 }] });
  });

  it('27. negative number', () => {
    const r = parsePartial('-3.14');
    expect(r.complete).toBe(true);
    expect(r.value).toBe(-3.14);
  });

  it('28. scientific number', () => {
    const r = parsePartial('1.5e10');
    expect(r.complete).toBe(true);
    expect(r.value).toBe(1.5e10);
  });

  it('29. fuzz: random truncations never throw', () => {
    const valid =
      '{"name":"Alice","age":42,"tags":["x","y","z"],"meta":{"k":true,"l":null,"m":[1,2,3.5]}}';
    fc.assert(
      fc.property(fc.integer({ min: 0, max: valid.length }), (n) => {
        const r = parsePartial(valid.slice(0, n));
        expect(r).toHaveProperty('value');
        expect(r).toHaveProperty('complete');
        expect(r).toHaveProperty('errors');
        expect(Array.isArray(r.errors)).toBe(true);
        expect(typeof r.complete).toBe('boolean');
      }),
      { numRuns: 1000 },
    );
  });

  it('29b. fuzz: arbitrary strings never throw', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const r = parsePartial(s);
        expect(r).toHaveProperty('value');
        expect(r).toHaveProperty('complete');
        expect(r).toHaveProperty('errors');
      }),
      { numRuns: 500 },
    );
  });

  it('30. adversarial }}}', () => {
    const r = parsePartial('}}}');
    expect(r.complete).toBe(false);
    expect(r.value).toBeUndefined();
    // does not throw — that's the point
  });

  it('31. mismatched bracket {"a":1]', () => {
    const r = parsePartial('{"a":1]');
    expect(r.value).toEqual({ a: 1 });
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('32. multiple top-level returns first', () => {
    const r = parsePartial('{"a":1}{"b":2}');
    expect(r.value).toEqual({ a: 1 });
    expect(r.complete).toBe(false);
    expect(r.truncatedAt).toBeGreaterThan(0);
  });

  it('33. truncated escape mid-string', () => {
    const r = parsePartial('{"a":"hello\\');
    expect(r.complete).toBe(false);
    expect((r.value as Record<string, string>).a).toBe('hello');
  });

  it('34. truncated unicode escape', () => {
    const r = parsePartial('{"a":"\\u00');
    expect(r.complete).toBe(false);
    expect(typeof (r.value as Record<string, string>).a).toBe('string');
  });

  it('35. unterminated block comment', () => {
    const r = parsePartial('/* unterminated');
    expect(r.complete).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('36. nested trailing commas', () => {
    const r = parsePartial('{"a":[1,2,],"b":{"c":3,},}');
    expect(r.complete).toBe(true);
    expect(r.value).toEqual({ a: [1, 2], b: { c: 3 } });
  });

  it('37. boolean and null values', () => {
    const r = parsePartial('{"a":true,"b":false,"c":null}');
    expect(r.complete).toBe(true);
    expect(r.value).toEqual({ a: true, b: false, c: null });
  });

  it('38. just a string', () => {
    const r = parsePartial('"hello"');
    expect(r.complete).toBe(true);
    expect(r.value).toBe('hello');
  });

  it('39. truncated false', () => {
    const r = parsePartial('fal');
    expect(r.value).toBeUndefined();
    expect(r.complete).toBe(false);
  });

  it('40. truncated null', () => {
    const r = parsePartial('nul');
    expect(r.value).toBeUndefined();
    expect(r.complete).toBe(false);
  });

  it('41. escape sequences in strings', () => {
    const r = parsePartial('"a\\nb\\tc\\"d"');
    expect(r.value).toBe('a\nb\tc"d');
  });
});
