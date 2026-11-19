import { z } from "zod";

const envSchema = z.object({
  // Next.js & App Environment
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),

  // Supabase Database & Auth
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().default("https://mock-supabase-url.supabase.co"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).default("mock-anon-key"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).default("mock-service-role-key"),

  // Google Gemini AI
  GEMINI_API_KEY: z.string().min(1).default("mock-gemini-key"),

  // Google OAuth2 for Gmail REST API
  GOOGLE_CLIENT_ID: z.string().min(1).default("mock-client-id"),
  GOOGLE_CLIENT_SECRET: z.string().min(1).default("mock-client-secret"),
  GOOGLE_REDIRECT_URI: z.string().url().default("https://developers.google.com/oauthplayground"),
  GOOGLE_REFRESH_TOKEN: z.string().optional().default("mock-refresh-token"),

  // Security & Cron
  CRON_SECRET: z.string().min(8).optional().default("mock_secure_cron_secret"),
});

export type Env = z.infer<typeof envSchema>;

export function getValidatedEnv(customEnv?: Record<string, string | undefined>): Env {
  const envToValidate = customEnv || process.env;
  const result = envSchema.safeParse(envToValidate);

  if (!result.success) {
    console.error("Invalid environment variables:", result.error.format());
    throw new Error(`Environment validation failed: ${JSON.stringify(result.error.issues)}`);
  }

  return result.data;
}

export const env = getValidatedEnv();
