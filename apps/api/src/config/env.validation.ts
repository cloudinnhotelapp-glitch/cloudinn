// Validates environment variables at startup so the API refuses to run with missing or unsafe settings.
// Error messages name the faulty setting but never echo its value, so secrets are not printed.
import { z } from 'zod';

// Matches the placeholder text used in .env.example, so an unedited copy is rejected.
const PLACEHOLDER_PATTERN = /YOUR_|REPLACE_WITH/;

// Turns empty strings into "not set" so blank lines in .env behave like missing values.
function blankToUndefined(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? undefined : value;
}

// A required PostgreSQL connection string that must not still be a placeholder.
const postgresUrl = z
  .string({ error: 'is required' })
  .regex(/^postgres(ql)?:\/\//, 'must start with postgresql://')
  .refine((value) => !PLACEHOLDER_PATTERN.test(value), 'still contains placeholder values');

// An optional text setting (blank counts as not set).
const optionalText = z.preprocess(blankToUndefined, z.string().optional());

// Rules for every environment variable the API reads.
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    FRONTEND_ORIGIN: z.url().default('http://localhost:3000'),
    SWAGGER_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),

    // Database connection for the running app (required).
    DATABASE_URL: z.preprocess(blankToUndefined, postgresUrl),

    // Secret used to derive CSRF tokens; must be long and random (protects every state-changing request).
    SESSION_SECRET: z.preprocess(
      blankToUndefined,
      z
        .string({ error: 'is required' })
        .min(64, 'must be at least 64 characters')
        .refine((value) => !PLACEHOLDER_PATTERN.test(value), 'still contains placeholder values'),
    ),
    // Session lifetimes: idle timeout in minutes and absolute maximum in hours.
    SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),
    SESSION_ABSOLUTE_TIMEOUT_HOURS: z.coerce.number().int().min(1).max(72).default(12),
    // Login attempts allowed per IP address per minute on each login endpoint.
    LOGIN_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(10_000).default(10),

    // Guest-document storage: "local" for development; "s3" requires the S3 settings below.
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_PATH: z.preprocess(blankToUndefined, z.string().default('./storage')),
    S3_ENDPOINT: optionalText,
    S3_REGION: optionalText,
    S3_BUCKET: optionalText,
    S3_ACCESS_KEY_ID: optionalText,
    S3_SECRET_ACCESS_KEY: optionalText,
    S3_PRESIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
  })
  // S3 credentials are only required (and must be real) when the S3 driver is selected.
  .superRefine((env, ctx) => {
    if (env.STORAGE_DRIVER !== 's3') return;
    for (const key of ['S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
      const value = env[key];
      if (!value || PLACEHOLDER_PATTERN.test(value)) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'is required when STORAGE_DRIVER=s3' });
      }
    }
  });

// Fully validated environment settings available to the rest of the API.
export type Env = z.infer<typeof envSchema>;

// Parses raw environment variables and throws an error listing each invalid setting by name only.
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    throw new Error(`Invalid environment configuration:\n${problems.join('\n')}`);
  }
  return result.data;
}
