export type EmailStatus =
  | "pending_review"
  | "drafted"
  | "approved"
  | "sent"
  | "dismissed"
  | "failed";

export const VALID_EMAIL_STATUSES: EmailStatus[] = [
  "pending_review",
  "drafted",
  "approved",
  "sent",
  "dismissed",
  "failed",
];

export interface EmailRecord {
  id: string;
  message_id: string;
  thread_id: string;
  sender: string;
  recipient: string;
  subject: string;
  body: string;
  status: EmailStatus;
  urgency_score: number;
  intent: string;
  created_at: string;
  updated_at: string;
}

export interface DraftRecord {
  id: string;
  email_id: string;
  draft_body: string;
  rationale: string;
  human_edited: boolean;
  gmail_draft_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeDocRecord {
  id: string;
  title: string;
  content: string;
  category: string;
  embedding?: number[];
  created_at: string;
}

export interface InsertEmailInput {
  message_id: string;
  thread_id: string;
  sender: string;
  recipient: string;
  subject: string;
  body: string;
  status?: EmailStatus;
  urgency_score?: number;
  intent?: string;
}

export interface InsertDraftInput {
  email_id: string;
  draft_body: string;
  rationale: string;
  human_edited?: boolean;
  gmail_draft_id?: string | null;
}
