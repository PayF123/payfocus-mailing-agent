import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  approveAndSendDraft,
  updateDraftContent,
  dismissEmail,
  verifyUserSession,
  setMockGmailDispatcher,
  HitlActionError,
} from "@/lib/hitl";
import { POST as approveRoute } from "@/app/api/drafts/[id]/approve/route";
import { setMockSupabaseClient } from "@/lib/supabase";
import { NextRequest } from "next/server";
import { EmailRecord, DraftRecord } from "@/types/database";

class MockSupabaseHITL {
  emails: Map<string, EmailRecord> = new Map();
  drafts: Map<string, DraftRecord> = new Map();

  from(tableName: string) {
    const self = this;
    return {
      select() {
        return {
          eq(col: string, val: any) {
            return {
              maybeSingle() {
                if (tableName === "emails") {
                  for (const rec of self.emails.values()) {
                    if ((rec as any)[col] === val) return Promise.resolve({ data: rec, error: null });
                  }
                  return Promise.resolve({ data: null, error: null });
                }
                if (tableName === "drafts") {
                  for (const rec of self.drafts.values()) {
                    if ((rec as any)[col] === val) return Promise.resolve({ data: rec, error: null });
                  }
                  return Promise.resolve({ data: null, error: null });
                }
                return Promise.resolve({ data: null, error: null });
              },
              order() {
                const getSingle = () => {
                  for (const rec of self.drafts.values()) {
                    if ((rec as any)[col] === val) return Promise.resolve({ data: rec, error: null });
                  }
                  return Promise.resolve({ data: null, error: null });
                };
                return {
                  limit() {
                    return { maybeSingle: getSingle };
                  },
                  maybeSingle: getSingle,
                };
              },
            };
          },
        };
      },
      update(values: any) {
        return {
          eq(col: string, val: any) {
            const doUpdate = () => {
              if (tableName === "emails") {
                const rec = self.emails.get(val);
                if (rec) {
                  const updated = { ...rec, ...values };
                  self.emails.set(val, updated);
                  return { data: updated, error: null };
                }
              }
              if (tableName === "drafts") {
                const rec = self.drafts.get(val);
                if (rec) {
                  const updated = { ...rec, ...values };
                  self.drafts.set(val, updated);
                  return { data: updated, error: null };
                }
              }
              return { data: null, error: new Error("Record not found") };
            };

            const result = doUpdate();
            return {
              then(resolve: any) {
                return Promise.resolve(result).then(resolve);
              },
              select() {
                return {
                  single() {
                    return Promise.resolve(result);
                  },
                };
              },
            };
          },
        };
      },
    };
  }
}

describe("Phase 4: Human-in-the-Loop (HITL) Web Dashboard", () => {
  let mockDb: MockSupabaseHITL;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockDb = new MockSupabaseHITL();
    setMockSupabaseClient(mockDb as any);
    setMockGmailDispatcher(null);

    // Seed test email & draft
    mockDb.emails.set("email_hitl_01", {
      id: "email_hitl_01",
      message_id: "msg_hitl_01",
      thread_id: "th_hitl_01",
      sender: "alex@client.com",
      recipient: "support@payfocus.com",
      subject: "Help needed with API",
      body: "How do I reset key?",
      status: "drafted",
      urgency_score: 3,
      intent: "Support",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    mockDb.drafts.set("draft_hitl_01", {
      id: "draft_hitl_01",
      email_id: "email_hitl_01",
      draft_body: "Original draft body text",
      rationale: "AI rationale explanation",
      human_edited: false,
      gmail_draft_id: "gm_draft_100",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  });

  describe("Happy Path", () => {
    it("should allow human to edit draft text, click Approve & Send, dispatch via Gmail and mark email as SENT", async () => {
      let dispatchCalled = false;
      setMockGmailDispatcher({
        send: vi.fn().mockImplementation(async (params: any) => {
          dispatchCalled = true;
          expect(params.body).toBe("Polished draft text by human");
          return { id: "gmail_sent_msg_999" };
        }),
      });

      const result = await approveAndSendDraft({
        emailId: "email_hitl_01",
        editedDraftBody: "Polished draft text by human",
        sessionToken: "Bearer valid_admin_session",
      });

      expect(dispatchCalled).toBe(true);
      expect(result.success).toBe(true);
      expect(result.status).toBe("sent");

      // Verify email status was updated to 'sent' in database
      const storedEmail = mockDb.emails.get("email_hitl_01");
      expect(storedEmail?.status).toBe("sent");

      // Verify draft was marked as human_edited
      const storedDraft = mockDb.drafts.get("draft_hitl_01");
      expect(storedDraft?.human_edited).toBe(true);
      expect(storedDraft?.draft_body).toBe("Polished draft text by human");
    });
  });

  describe("Negative Cases", () => {
    it("Negative 1: should return 409 Conflict when attempting to approve an email already marked SENT", async () => {
      // Mark email as already sent
      mockDb.emails.get("email_hitl_01")!.status = "sent";

      await expect(
        approveAndSendDraft({
          emailId: "email_hitl_01",
          sessionToken: "Bearer valid_token",
        })
      ).rejects.toThrow(HitlActionError);

      try {
        await approveAndSendDraft({
          emailId: "email_hitl_01",
          sessionToken: "Bearer valid_token",
        });
      } catch (err: any) {
        expect(err.statusCode).toBe(409);
        expect(err.message).toContain("already been approved and sent");
      }
    });

    it("Negative 2: should return 401 Unauthorized for unauthenticated or missing session", async () => {
      await expect(
        approveAndSendDraft({
          emailId: "email_hitl_01",
          sessionToken: null,
        })
      ).rejects.toThrow(HitlActionError);

      try {
        await approveAndSendDraft({
          emailId: "email_hitl_01",
          sessionToken: "unauthenticated",
        });
      } catch (err: any) {
        expect(err.statusCode).toBe(401);
        expect(err.message).toContain("Unauthorized");
      }
    });

    it("Negative 3: approve API route returns 401 response without valid auth headers", async () => {
      const req = new NextRequest("http://localhost:3000/api/drafts/email_hitl_01/approve", {
        method: "POST",
        headers: {
          "x-session-token": "unauthenticated",
        },
      });

      const response = await approveRoute(req, { params: { id: "email_hitl_01" } });
      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.error).toContain("Unauthorized");
    });
  });

  describe("Edge Cases", () => {
    it("Edge 1 (Draft Deleted in Gmail): handles graceful fallback if draft was removed in Gmail before user approved", async () => {
      let messageSentDirectly = false;
      const mockOAuthClient = {
        getAccessToken: vi.fn().mockResolvedValue({ token: "mock_token" }),
      } as any;

      // Spy on google.gmail to simulate 404 on drafts.send and fallback to messages.send
      const { google } = await import("googleapis");
      vi.spyOn(google, "gmail").mockReturnValue({
        users: {
          drafts: {
            send: vi.fn().mockRejectedValue({ code: 404, message: "Draft Not Found in Gmail" }),
          },
          messages: {
            send: vi.fn().mockImplementation(async () => {
              messageSentDirectly = true;
              return { data: { id: "direct_dispatched_msg_101" } };
            }),
          },
        },
      } as any);

      const res = await approveAndSendDraft({
        emailId: "email_hitl_01",
        sessionToken: "Bearer valid_token",
        oauth2Client: mockOAuthClient,
      });

      expect(res.success).toBe(true);
      expect(res.status).toBe("sent");
    });

    it("Edge 2 (Concurrent Review): handles two tabs approving the same email simultaneously without duplicate send", async () => {
      let dispatchCount = 0;
      setMockGmailDispatcher({
        send: vi.fn().mockImplementation(async () => {
          dispatchCount++;
          // Simulate latency
          await new Promise((resolve) => setTimeout(resolve, 20));
          return { id: `msg_sent_${dispatchCount}` };
        }),
      });

      // Tab 1 and Tab 2 fire simultaneously
      const promise1 = approveAndSendDraft({
        emailId: "email_hitl_01",
        sessionToken: "Bearer valid_token",
      });

      // Second call slightly delayed simulating simultaneous race
      const promise2 = new Promise((resolve, reject) => {
        setTimeout(async () => {
          try {
            resolve(await approveAndSendDraft({
              emailId: "email_hitl_01",
              sessionToken: "Bearer valid_token",
            }));
          } catch (e) {
            reject(e);
          }
        }, 10);
      });

      const results = await Promise.allSettled([promise1, promise2]);

      // Exactly one succeeds, the other gets rejected with 409 Conflict
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
      expect((rejected[0] as any).reason.statusCode).toBe(409);
    });
  });
});
