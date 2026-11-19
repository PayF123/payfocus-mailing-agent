import { describe, it, expect, beforeEach, vi } from "vitest";
import { sanitizeInboundPrompt } from "@/lib/ai/sanitizer";
import { classifyEmail, setMockGeminiModel, withExponentialBackoff } from "@/lib/ai/classifier";
import {
  generateEmailDraft,
  setMockVectorSearch,
  setMockGeminiDraft,
  KnowledgeDocMatch,
} from "@/lib/ai/draft-generator";
import { setMockSupabaseClient } from "@/lib/supabase";
import { PROMPT_INJECTION_EMAIL, GIBBERISH_EMAIL } from "./fixtures/emails";

describe("Phase 3: AI Classification, Prompt Guard & Draft Generation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setMockGeminiModel(null);
    setMockVectorSearch(null);
    setMockGeminiDraft(null);

    // Mock minimal database layer
    const mockDb = {
      from: () => ({
        upsert: () => ({ select: () => ({ single: () => Promise.resolve({ data: {}, error: null }) }) }),
        insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: "draft_123" }, error: null }) }) }),
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "email_123" }, error: null }) }) }),
        update: () => ({ eq: () => Promise.resolve({ data: {}, error: null }) }),
      }),
    };
    setMockSupabaseClient(mockDb as any);
  });

  describe("Happy Path", () => {
    it("should generate an accurate draft citing FAQ vector context for a routine support inquiry", async () => {
      // Mock vector search returning matched documentation
      const mockDocs: KnowledgeDocMatch[] = [
        {
          id: "doc_api_reset",
          title: "API Secret Key Rotation Guide",
          content: "Navigate to Dashboard > Settings > API Keys and click 'Regenerate Secret'.",
          similarity: 0.92,
        },
      ];
      setMockVectorSearch(async () => mockDocs);

      // Mock Gemini draft generator
      setMockGeminiDraft({
        generateDraft: vi.fn().mockResolvedValue({
          draftBody: "Hi Alex,\nTo rotate your API keys, navigate to Dashboard > Settings > API Keys and select 'Regenerate Secret'.\nBest regards,\nPayFocus Support",
          rationale: "Cited 'API Secret Key Rotation Guide' document to explain key regeneration.",
          matchedDocsCount: 1,
          citedSources: ["API Secret Key Rotation Guide"],
          isCautiousFallback: false,
        }),
      });

      const result = await generateEmailDraft({
        emailId: "email_123",
        sender: "alex@client.com",
        subject: "How do I reset my API secret key?",
        body: "I cannot find the reset button in dashboard settings.",
      });

      expect(result.draftBody).toContain("Dashboard > Settings > API Keys");
      expect(result.citedSources).toContain("API Secret Key Rotation Guide");
      expect(result.matchedDocsCount).toBe(1);
      expect(result.isCautiousFallback).toBe(false);
    });
  });

  describe("Negative Cases", () => {
    it("Negative 1: should implement exponential backoff and return graceful fallback when Gemini returns 429", async () => {
      let callCount = 0;
      const failingGeminiCall = async () => {
        callCount++;
        const err: any = new Error("Resource has been exhausted (e.g. check quota)");
        err.status = 429;
        throw err;
      };

      // Ensure exponential backoff retries multiple times
      await expect(
        withExponentialBackoff(failingGeminiCall, 3, 10)
      ).rejects.toThrow("Resource has been exhausted");
      expect(callCount).toBe(3);

      // Verify draft generator produces graceful fallback without crashing
      setMockVectorSearch(async () => []);
      setMockGeminiDraft({
        generateDraft: vi.fn().mockImplementation(async () => {
          const err: any = new Error("429 Too Many Requests");
          err.status = 429;
          throw err;
        }),
      });

      const fallbackResult = await generateEmailDraft({
        emailId: "email_123",
        sender: "user@client.com",
        subject: "Urgent issue",
        body: "My service is failing",
      });

      expect(fallbackResult.isCautiousFallback).toBe(true);
      expect(fallbackResult.draftBody).toContain("Thank you for contacting PayFocus support");
      expect(fallbackResult.rationale).toContain("rate-limiting backoff");
    });
  });

  describe("Edge Cases", () => {
    it("Edge 1 (Adversarial Injection): sanitizer neutralizes input and classifier tags as malicious/spam", async () => {
      const injectionBody = PROMPT_INJECTION_EMAIL.body;

      // 1. Sanitizer detects and redacts payload
      const sanitized = sanitizeInboundPrompt(injectionBody);
      expect(sanitized.isSafe).toBe(false);
      expect(sanitized.threatsDetected.length).toBeGreaterThan(0);
      expect(sanitized.sanitizedText).toContain("[BLOCKED_ADVERSARIAL_PAYLOAD]");

      // 2. Classifier flags as Spam / Malicious without executing adversarial commands
      const classification = await classifyEmail(
        PROMPT_INJECTION_EMAIL.subject,
        injectionBody
      );

      expect(classification.category).toBe("Spam");
      expect(classification.isMaliciousOrSpam).toBe(true);
      expect(classification.requiresHumanReview).toBe(true);
      expect(classification.reasoning).toContain("Adversarial instructions or prompt injection detected");
    });

    it("Edge 2 (Zero Context): when vector search returns 0 docs, generates cautious draft asking for clarification", async () => {
      // Mock 0 vector results
      setMockVectorSearch(async () => []);

      setMockGeminiDraft({
        generateDraft: vi.fn().mockResolvedValue({
          draftBody: "Hello,\nThank you for reaching out. Could you clarify your exact configuration so our team can assist?\nBest regards,\nPayFocus Support",
          rationale: "Zero documentation matches found. Formulated cautious clarification request without hallucinating.",
          matchedDocsCount: 0,
          citedSources: [],
          isCautiousFallback: true,
        }),
      });

      const result = await generateEmailDraft({
        emailId: "email_123",
        sender: "curious@domain.com",
        subject: "Obscure undocumented feature request",
        body: "Does your system support proprietary quantum token encryption protocols?",
      });

      expect(result.matchedDocsCount).toBe(0);
      expect(result.isCautiousFallback).toBe(true);
      expect(result.draftBody).toContain("Could you clarify");
      expect(result.citedSources.length).toBe(0);
    });

    it("Edge 3 (Non-English / Gibberish): routes random strings or unparseable input to manual human review", async () => {
      const result = await classifyEmail(
        GIBBERISH_EMAIL.subject,
        GIBBERISH_EMAIL.body
      );

      expect(result.category).toBe("Spam");
      expect(result.requiresHumanReview).toBe(true);
      expect(result.confidence).toBeLessThanOrEqual(0.5);
      expect(result.reasoning).toContain("gibberish");
    });
  });
});
