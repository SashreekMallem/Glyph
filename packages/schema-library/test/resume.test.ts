import { describe, expect, it } from 'vitest';

import { ResumeSchema } from '../src/index.js';
import { validResume } from './fixtures.js';

describe('ResumeSchema', () => {
  it('parses a valid fixture', () => {
    expect(ResumeSchema.parse(validResume).document_type).toBe('resume');
  });

  it('rejects missing personal', () => {
    const { personal: _p, ...bad } = validResume;
    const res = ResumeSchema.safeParse(bad);
    expect(res.success).toBe(false);
  });

  it('rejects invalid email', () => {
    const res = ResumeSchema.safeParse({
      ...validResume,
      personal: { ...validResume.personal, email: 'nope' },
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0]?.path).toEqual(['personal', 'email']);
    }
  });

  it('rejects invalid linkedin URL', () => {
    const res = ResumeSchema.safeParse({
      ...validResume,
      personal: { ...validResume.personal, linkedin: 'not a url' },
    });
    expect(res.success).toBe(false);
  });

  it('rejects gpa above 4', () => {
    const res = ResumeSchema.safeParse({
      ...validResume,
      education: [{ ...validResume.education[0]!, gpa: 5 }],
    });
    expect(res.success).toBe(false);
  });

  it('rejects bad start_date', () => {
    const res = ResumeSchema.safeParse({
      ...validResume,
      experience: [{ ...validResume.experience[0]!, start_date: 'yesterday' }],
    });
    expect(res.success).toBe(false);
  });

  it('rejects empty skill items', () => {
    const res = ResumeSchema.safeParse({
      ...validResume,
      skills: [{ category: 'x', items: [] }],
    });
    expect(res.success).toBe(false);
  });

  it('rejects unknown top-level fields', () => {
    const res = ResumeSchema.safeParse({ ...validResume, extra: 1 });
    expect(res.success).toBe(false);
  });

  it('rejects missing experience array', () => {
    const { experience: _e, ...bad } = validResume;
    const res = ResumeSchema.safeParse(bad);
    expect(res.success).toBe(false);
  });

  it('rejects missing schema_version', () => {
    const { schema_version: _v, ...bad } = validResume;
    const res = ResumeSchema.safeParse(bad);
    expect(res.success).toBe(false);
  });

  it('allows omitting certifications', () => {
    const { certifications: _c, ...slim } = validResume;
    expect(ResumeSchema.safeParse(slim).success).toBe(true);
  });
});
