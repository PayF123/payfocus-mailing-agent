import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  parseGmailMessage,
  ensureValidAccessToken,
  decodeMimeHeader,
  GmailAuthError,
  MAX_SAFE_BODY_BYTES,
  fetchRecentEmails,
  setMockOAuth2Client
} from "@/lib/gmail";
import { GET as syncRoute } from "@/app/api/emails/sync/route";
import { NextRequest } from "next/server";
import { setMockSupabaseClient } from "@/lib/supabase";

describe("Phase 2: Gmail Connector & Resilient Ingestion", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setMockOAuth2Client(null);
  });

  describe("Happy Path", () => {
    it("should fetch and parse a standard multipart MIME email with headers and body", () => {
      const rawMessage = {
        id: "msg_mime_101",
        threadId: "th_mime_101",
        sizeEstimate: 2048,
        payload: {
          headers: [
            { name: "From", value: "client@example.com" },
            { name: "To", value: "support@payfocus.com" },
            { name: "Subject", value: "Inquiry about billing" },
            { name: "Date", value: "Wed, 29 Oct 2026 10:00:00 GMT" },
          ],
          mimeType: "multipart/alternative",
          parts: [
            {
              mimeType: "text/plain",
              body: {
                data: Buffer.from("Hello PayFocus support,\nI need help updating my billing card.").toString("base64url"),
              },
            },
            {
              mimeType: "text/html",
              body: {
                data: Buffer.from("<p>Hello PayFocus support,<br>I need help updating my billing card.</p>").toString("base64url"),
              },
            },
          ],
        },
      };

      const parsed = parseGmailMessage(rawMessage);

      expect(parsed.message_id).toBe("msg_mime_101");
      expect(parsed.thread_id).toBe("th_mime_101");
      expect(parsed.sender).toBe("client@example.com");
      expect(parsed.recipient).toBe("support@payfocus.com");
      expect(parsed.subject).toBe("Inquiry about billing");
      expect(parsed.body).toContain("I need help updating my billing card.");
      expect(parsed.truncated).toBe(false);
    });
  });

  describe("Negative Cases", () => {
    it("Negative 1: should automatically trigger refresh flow when access token is expired", async () => {
      let refreshInvoked = false;
      const mockOAuth2 = {
        getAccessToken: vi.fn().mockImplementation(async () => {
          refreshInvoked = true;
          return { token: "new_refreshed_access_token_xyz" };
        }),
      };

      const token = await ensureValidAccessToken(mockOAuth2 as any);
      expect(refreshInvoked).toBe(true);
      expect(token).toBe("new_refreshed_access_token_xyz");
    });

    it("Negative 2: should cleanly throw GmailAuthError (401) without crashing when refresh token is revoked", async () => {
      const mockOAuth2 = {
        getAccessToken: vi.fn().mockRejectedValue(new Error("invalid_grant: Token has been expired or revoked")),
      };

      await expect(ensureValidAccessToken(mockOAuth2 as any)).rejects.toThrow(GmailAuthError);

      try {
        await ensureValidAccessToken(mockOAuth2 as any);
      } catch (err: any) {
        expect(err.statusCode).toBe(401);
        expect(err.message).toContain("invalid or revoked");
      }
    });

    it("Negative 3: sync route returns clean 401 when unauthorized cron secret is passed", async () => {
      process.env.CRON_SECRET = "super_secret_cron_key";

      const req = new NextRequest("http://localhost:3000/api/emails/sync", {
        headers: {
          authorization: "Bearer wrong_secret",
        },
      });

      const response = await syncRoute(req);
      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.error).toContain("Unauthorized");

      delete process.env.CRON_SECRET;
    });
  });

  describe("Edge Cases", () => {
    it("Edge 1 (Zero Body): email with no body text, only subject or empty attachment", () => {
      const emptyBodyMessage = {
        id: "msg_zero_body_001",
        threadId: "th_zero_001",
        payload: {
          headers: [
            { name: "From", value: "silent@domain.com" },
            { name: "To", value: "support@payfocus.com" },
            { name: "Subject", value: "Zero text email" },
          ],
          parts: [],
        },
      };

      const parsed = parseGmailMessage(emptyBodyMessage);
      expect(parsed.message_id).toBe("msg_zero_body_001");
      expect(parsed.subject).toBe("Zero text email");
      expect(parsed.body).toBe("");
      expect(parsed.truncated).toBe(false);
    });

    it("Edge 2 (Payload Exceeded): email exceeding 4MB safely truncates without timing out or failing", () => {
      // 5MB text string
      const hugeString = "X".repeat(5 * 1024 * 1024);
      const hugeMessage = {
        id: "msg_huge_001",
        threadId: "th_huge_001",
        sizeEstimate: 5 * 1024 * 1024,
        payload: {
          headers: [
            { name: "From", value: "dumper@domain.com" },
            { name: "To", value: "support@payfocus.com" },
            { name: "Subject", value: "Massive memory dump" },
          ],
          body: {
            data: Buffer.from(hugeString).toString("base64url"),
          },
        },
      };

      const parsed = parseGmailMessage(hugeMessage);
      expect(parsed.truncated).toBe(true);
      expect(parsed.body).toContain("[TRUNCATED: Payload exceeded 4MB limit]");
      expect(Buffer.byteLength(parsed.body, "utf-8")).toBeLessThanOrEqual(MAX_SAFE_BODY_BYTES + 100);
    });

    it("Edge 3 (Malformed MIME): decodes headers with RFC 2047 and gracefully handles missing boundaries", () => {
      // RFC 2047 Base64 encoded UTF-8 subject
      const rfcEncodedSubject = "=?UTF-8?B?8J+agCBJbnZhbGlkIGhlYWRlcg==?=";
      const decodedSubject = decodeMimeHeader(rfcEncodedSubject);
      expect(decodedSubject).toContain("Invalid header");

      // Quoted-Printable header
      const qpHeader = "=?ISO-8859-1?Q?J=F6rg?= <jorg@corrupt.com>";
      const decodedQp = decodeMimeHeader(qpHeader);
      expect(decodedQp).toContain("Jörg");

      // Corrupted without valid RFC format
      const brokenHeader = "=?UNKNOWN???Broken=?=";
      const decodedBroken = decodeMimeHeader(brokenHeader);
      expect(decodedBroken).toBe(brokenHeader);
    });
  });
});
