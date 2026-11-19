import { describe, it, expect, beforeEach } from "vitest";
import { upsertEmail, insertDraft, getEmailByMessageId, DatabaseError } from "@/lib/db";
import { setMockSupabaseClient } from "@/lib/supabase";
import { VALID_SUPPORT_EMAIL, VALID_SALES_EMAIL } from "./fixtures/emails";
import { EmailRecord, DraftRecord } from "@/types/database";

// In-memory mock database store simulating PostgreSQL tables
class MockSupabaseDB {
  emails: Map<string, EmailRecord> = new Map();
  drafts: Map<string, DraftRecord> = new Map();

  from(tableName: string) {
    const self = this;
    return {
      upsert(payload: any, options?: { onConflict?: string }) {
        return {
          select() {
            return {
              single() {
                const conflictKey = options?.onConflict || "message_id";
                let existingKey: string | undefined;

                if (conflictKey === "message_id") {
                  for (const [id, rec] of self.emails.entries()) {
                    if (rec.message_id === payload.message_id) {
                      existingKey = id;
                      break;
                    }
                  }
                }

                const id = existingKey || `email_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
                const record: EmailRecord = {
                  id,
                  message_id: payload.message_id,
                  thread_id: payload.thread_id,
                  sender: payload.sender,
                  recipient: payload.recipient,
                  subject: payload.subject,
                  body: payload.body,
                  status: payload.status,
                  urgency_score: payload.urgency_score,
                  intent: payload.intent,
                  created_at: existingKey ? self.emails.get(existingKey)!.created_at : new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                };
                self.emails.set(id, record);
                return Promise.resolve({ data: record, error: null });
              }
            };
          }
        };
      },
      insert(payload: any) {
        return {
          select() {
            return {
              single() {
                const id = `draft_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
                const record: DraftRecord = {
                  id,
                  email_id: payload.email_id,
                  draft_body: payload.draft_body,
                  rationale: payload.rationale,
                  human_edited: payload.human_edited ?? false,
                  gmail_draft_id: payload.gmail_draft_id || null,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                };
                self.drafts.set(id, record);
                return Promise.resolve({ data: record, error: null });
              }
            };
          }
        };
      },
      select(fields?: string) {
        return {
          eq(column: string, value: any) {
            return {
              maybeSingle() {
                if (tableName === "emails") {
                  for (const record of self.emails.values()) {
                    if ((record as any)[column] === value) {
                      return Promise.resolve({ data: record, error: null });
                    }
                  }
                  return Promise.resolve({ data: null, error: null });
                }
                return Promise.resolve({ data: null, error: null });
              }
            };
          }
        };
      }
    };
  }
}

describe("Phase 1: Foundation, Supabase Schema & Mock Test Harness", () => {
  let mockDb: MockSupabaseDB;

  beforeEach(() => {
    mockDb = new MockSupabaseDB();
    setMockSupabaseClient(mockDb as any);
  });

  describe("Happy Path", () => {
    it("should successfully insert and retrieve a valid support email", async () => {
      const inserted = await upsertEmail(VALID_SUPPORT_EMAIL);
      expect(inserted).toBeDefined();
      expect(inserted.id).toBeDefined();
      expect(inserted.message_id).toBe(VALID_SUPPORT_EMAIL.message_id);
      expect(inserted.status).toBe("pending_review");
      expect(inserted.urgency_score).toBe(3);

      const retrieved = await getEmailByMessageId(VALID_SUPPORT_EMAIL.message_id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.subject).toBe(VALID_SUPPORT_EMAIL.subject);
    });

    it("should successfully insert a draft linked to an existing email", async () => {
      const email = await upsertEmail(VALID_SALES_EMAIL);
      const draft = await insertDraft({
        email_id: email.id,
        draft_body: "Hi, our enterprise tier starts at...",
        rationale: "Quoting enterprise pricing model."
      });

      expect(draft).toBeDefined();
      expect(draft.id).toBeDefined();
      expect(draft.email_id).toBe(email.id);
      expect(draft.human_edited).toBe(false);
    });
  });

  describe("Negative Cases", () => {
    it("should reject email with missing mandatory message_id", async () => {
      await expect(
        upsertEmail({
          ...VALID_SUPPORT_EMAIL,
          message_id: ""
        })
      ).rejects.toThrow(DatabaseError);
    });

    it("should reject email with missing mandatory sender", async () => {
      await expect(
        upsertEmail({
          ...VALID_SUPPORT_EMAIL,
          sender: ""
        })
      ).rejects.toThrow(DatabaseError);
    });

    it("should reject email with malformed status enum", async () => {
      await expect(
        upsertEmail({
          ...VALID_SUPPORT_EMAIL,
          status: "INVALID_STATUS" as any
        })
      ).rejects.toThrow("Invalid email status: 'INVALID_STATUS'");
    });

    it("should reject email with invalid urgency_score (< 1 or > 5)", async () => {
      await expect(
        upsertEmail({
          ...VALID_SUPPORT_EMAIL,
          urgency_score: 99
        })
      ).rejects.toThrow("urgency_score must be between 1 and 5");
    });

    it("should reject draft insertion when foreign key email_id does not exist", async () => {
      const nonExistentEmailId = "non_existent_uuid_12345";
      await expect(
        insertDraft({
          email_id: nonExistentEmailId,
          draft_body: "Attempting draft on orphaned email",
          rationale: "Orphaned test"
        })
      ).rejects.toThrow(/Foreign key violation/);
    });
  });

  describe("Edge Cases", () => {
    it("should handle duplicate message_id upserts concurrently without creating multiple records", async () => {
      const payload1 = { ...VALID_SUPPORT_EMAIL, message_id: "duplicate_msg_concurrent_01", subject: "Initial Subject" };
      const payload2 = { ...VALID_SUPPORT_EMAIL, message_id: "duplicate_msg_concurrent_01", subject: "Updated Subject" };

      // Execute concurrently
      const [res1, res2] = await Promise.all([
        upsertEmail(payload1),
        upsertEmail(payload2)
      ]);

      expect(res1.message_id).toBe("duplicate_msg_concurrent_01");
      expect(res2.message_id).toBe("duplicate_msg_concurrent_01");
      expect(res1.id).toBe(res2.id); // Same ID updated
      expect(mockDb.emails.size).toBe(1); // Exactly 1 record in database
    });

    it("should handle empty email body gracefully without failing", async () => {
      const result = await upsertEmail({
        message_id: "msg_empty_body_01",
        thread_id: "th_empty_01",
        sender: "user@domain.com",
        recipient: "support@domain.com",
        subject: "No body subject",
        body: ""
      });

      expect(result.id).toBeDefined();
      expect(result.body).toBe("");
    });
  });
});
