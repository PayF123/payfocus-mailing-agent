import { getSupabaseClient } from "./supabase";
import {
  EmailRecord,
  DraftRecord,
  InsertEmailInput,
  InsertDraftInput,
  VALID_EMAIL_STATUSES,
  EmailStatus
} from "../types/database";

export class DatabaseError extends Error {
  code: string;
  constructor(message: string, code: string = "DB_ERROR") {
    super(message);
    this.name = "DatabaseError";
    this.code = code;
  }
}

/**
 * Validates and upserts an inbound email record.
 * Uses message_id as conflict target for idempotency.
 */
export async function upsertEmail(
  input: InsertEmailInput
): Promise<EmailRecord> {
  // Validate mandatory fields
  if (!input.message_id || typeof input.message_id !== "string" || input.message_id.trim() === "") {
    throw new DatabaseError("Missing or invalid message_id", "INVALID_INPUT");
  }
  if (!input.thread_id || typeof input.thread_id !== "string" || input.thread_id.trim() === "") {
    throw new DatabaseError("Missing or invalid thread_id", "INVALID_INPUT");
  }
  if (!input.sender || typeof input.sender !== "string") {
    throw new DatabaseError("Missing or invalid sender", "INVALID_INPUT");
  }
  if (!input.recipient || typeof input.recipient !== "string") {
    throw new DatabaseError("Missing or invalid recipient", "INVALID_INPUT");
  }

  // Validate status if supplied
  const status: EmailStatus = input.status || "pending_review";
  if (!VALID_EMAIL_STATUSES.includes(status)) {
    throw new DatabaseError(
      `Invalid email status: '${status}'. Allowed values are: ${VALID_EMAIL_STATUSES.join(", ")}`,
      "INVALID_STATUS_ENUM"
    );
  }

  // Validate urgency_score range (1 to 5)
  const urgency_score = input.urgency_score ?? 1;
  if (urgency_score < 1 || urgency_score > 5) {
    throw new DatabaseError("urgency_score must be between 1 and 5", "INVALID_URGENCY_SCORE");
  }

  const supabase = getSupabaseClient();
  const emailPayload = {
    message_id: input.message_id,
    thread_id: input.thread_id,
    sender: input.sender,
    recipient: input.recipient,
    subject: input.subject ?? "",
    body: input.body ?? "",
    status,
    urgency_score,
    intent: input.intent || "Routine",
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("emails")
    .upsert(emailPayload, { onConflict: "message_id" })
    .select()
    .single();

  if (error) {
    throw new DatabaseError(error.message, error.code || "DB_ERROR");
  }

  return data as EmailRecord;
}

/**
 * Inserts a draft response associated with an email.
 * Rejects if foreign key email_id is missing or invalid.
 */
export async function insertDraft(
  input: InsertDraftInput
): Promise<DraftRecord> {
  if (!input.email_id || typeof input.email_id !== "string" || input.email_id.trim() === "") {
    throw new DatabaseError("Missing mandatory email_id foreign key", "INVALID_FOREIGN_KEY");
  }
  if (!input.draft_body) {
    throw new DatabaseError("Missing draft_body", "INVALID_INPUT");
  }

  const supabase = getSupabaseClient();

  // First verify parent email exists to enforce FK integrity
  const { data: parentEmail, error: parentError } = await supabase
    .from("emails")
    .select("id")
    .eq("id", input.email_id)
    .maybeSingle();

  if (parentError || !parentEmail) {
    throw new DatabaseError(
      `Foreign key violation: Email with id '${input.email_id}' does not exist`,
      "FOREIGN_KEY_VIOLATION"
    );
  }

  const draftPayload = {
    email_id: input.email_id,
    draft_body: input.draft_body,
    rationale: input.rationale || "AI-generated response draft",
    human_edited: input.human_edited ?? false,
    gmail_draft_id: input.gmail_draft_id || null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("drafts")
    .insert(draftPayload)
    .select()
    .single();

  if (error) {
    throw new DatabaseError(error.message, error.code || "DB_ERROR");
  }

  return data as DraftRecord;
}

/**
 * Retrieves an email by its message_id.
 */
export async function getEmailByMessageId(message_id: string): Promise<EmailRecord | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("emails")
    .select("*")
    .eq("message_id", message_id)
    .maybeSingle();

  if (error) {
    throw new DatabaseError(error.message, error.code || "DB_ERROR");
  }

  return (data as EmailRecord) || null;
}
