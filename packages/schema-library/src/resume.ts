import { z } from 'zod';

const PersonalSchema = z
  .object({
    full_name: z.string().min(1),
    email: z.string().email(),
    phone: z.string().min(1).optional(),
    linkedin: z.string().url().optional(),
    location: z.string().min(1).optional(),
    website: z.string().url().optional(),
  })
  .strict();

const ExperienceSchema = z
  .object({
    company: z.string().min(1),
    title: z.string().min(1),
    start_date: z.string().date(),
    end_date: z.string().date().optional(),
    location: z.string().min(1).optional(),
    description: z.string().min(1),
    achievements: z.array(z.string().min(1)).optional(),
  })
  .strict();

const EducationSchema = z
  .object({
    institution: z.string().min(1),
    degree: z.string().min(1),
    field: z.string().min(1).optional(),
    graduation_year: z
      .number()
      .int()
      .gte(1900)
      .lte(2100)
      .optional(),
    gpa: z.number().min(0).max(4).optional(),
  })
  .strict();

const SkillGroupSchema = z
  .object({
    category: z.string().min(1),
    items: z.array(z.string().min(1)).min(1),
  })
  .strict();

const CertificationSchema = z
  .object({
    name: z.string().min(1),
    issuer: z.string().min(1),
    issued_date: z.string().date().optional(),
    expires_date: z.string().date().optional(),
  })
  .strict();

export const ResumeSchema = z
  .object({
    document_type: z.literal('resume'),
    schema_version: z.string().min(1),

    personal: PersonalSchema,
    summary: z.string().min(1).optional(),
    experience: z.array(ExperienceSchema),
    education: z.array(EducationSchema),
    skills: z.array(SkillGroupSchema),
    certifications: z.array(CertificationSchema).optional(),
  })
  .strict();

export type Resume = z.infer<typeof ResumeSchema>;
