import { describe, it, expect } from "vitest";
import { getValidatedEnv } from "@/lib/env";
import vercelConfig from "../vercel.json";

describe("Phase 5: Vercel Optimization, Security & Production Environment", () => {
  describe("Happy Path", () => {
    it("should validate all required environment variables with default values", () => {
      const validated = getValidatedEnv();
      expect(validated).toBeDefined();
      expect(validated.NEXT_PUBLIC_APP_URL).toBe("http://localhost:3000");
      expect(validated.NEXT_PUBLIC_SUPABASE_URL).toContain("supabase.co");
      expect(validated.GEMINI_API_KEY).toBeDefined();
      expect(validated.GOOGLE_CLIENT_ID).toBeDefined();
    });

    it("should correctly configure vercel.json cron jobs and function timeouts", () => {
      expect(vercelConfig.crons).toBeDefined();
      expect(vercelConfig.crons.length).toBeGreaterThan(0);
      expect(vercelConfig.crons[0].path).toBe("/api/emails/sync");
      expect(vercelConfig.crons[0].schedule).toBe("*/5 * * * *");

      // Verify function maxDuration is configured to 60s
      expect(vercelConfig.functions["app/api/**/*"].maxDuration).toBe(60);
    });

    it("should contain comprehensive HTTP security headers in vercel.json", () => {
      const headerObj = vercelConfig.headers.find((h: any) => h.source === "/(.*)");
      expect(headerObj).toBeDefined();
      const headers = headerObj.headers.map((h: any) => h.key);

      expect(headers).toContain("X-Content-Type-Options");
      expect(headers).toContain("X-Frame-Options");
      expect(headers).toContain("X-XSS-Protection");
      expect(headers).toContain("Referrer-Policy");
      expect(headers).toContain("Permissions-Policy");
    });
  });

  describe("Negative Cases", () => {
    it("Negative 1: should reject invalid URLs for NEXT_PUBLIC_SUPABASE_URL", () => {
      expect(() =>
        getValidatedEnv({
          ...process.env,
          NEXT_PUBLIC_SUPABASE_URL: "not-a-valid-url",
        })
      ).toThrow(/Environment validation failed/);
    });

    it("Negative 2: should reject CRON_SECRET if shorter than 8 characters", () => {
      expect(() =>
        getValidatedEnv({
          ...process.env,
          CRON_SECRET: "short",
        })
      ).toThrow(/Environment validation failed/);
    });

    it("Negative 3: should reject invalid NODE_ENV values", () => {
      expect(() =>
        getValidatedEnv({
          ...process.env,
          NODE_ENV: "invalid_env" as any,
        })
      ).toThrow(/Environment validation failed/);
    });
  });

  describe("Edge Cases", () => {
    it("Edge 1: should accept valid production URLs with custom ports or subdomains", () => {
      const custom = getValidatedEnv({
        ...process.env,
        NEXT_PUBLIC_APP_URL: "https://payfocus-agent.vercel.app",
        NEXT_PUBLIC_SUPABASE_URL: "https://xyzcompany.supabase.co",
        CRON_SECRET: "a-very-long-secure-random-cron-secret-32-chars",
      });

      expect(custom.NEXT_PUBLIC_APP_URL).toBe("https://payfocus-agent.vercel.app");
      expect(custom.CRON_SECRET).toBe("a-very-long-secure-random-cron-secret-32-chars");
    });
  });
});
