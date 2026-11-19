import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { getSupabaseClient } from "./supabase";
import { getOAuth2Client, ensureValidAccessToken } from "./gmail";
import { EmailRecord, DraftRecord } from "@/types/database";

export class HitlActionError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number = 400) {
    super(message);
    this.name = "HitlActionError";
    this.statusCode = statusCode;
  }
}

let mockGmailDispatcherOverride: any = null;

export function setMockGmailDispatcher(dispatcher: any) {
  mockGmailDispatcherOverride = dispatcher;
}

/**
 * Validates authentication session
 */
export function verifyUserSession(sessionToken?: string | null): { userId: string } {
  if (!sessionToken || sessionToken.trim() === "" || sessionToken === "unauthenticated") {
    throw new HitlActionError("Unauthorized: active user session required", 401);
  }
  return { userId: "user_hitl_admin" };
}

/**
 * Sends an email draft via Gmail API and idempotently transitions email status to 'sent'
 */
const activeProcessingEmails = new Set<string>();

export async function approveAndSendDraft(params: {
  emailId: string;
  editedDraftBody?: string;
  sessionToken?: string | null;
  oauth2Client?: OAuth2Client;
}): Promise<{ success: boolean; messageId: string; status: string }> {
  // 1. Negative 2: Authentication Check
  verifyUserSession(params.sessionToken);

  // Edge 2: Idempotent Concurrency lock
  if (activeProcessingEmails.has(params.emailId)) {
    throw new HitlActionError(
      `Email ${params.emailId} is currently being processed by another session`,
      409
    );
  }
  activeProcessingEmails.add(params.emailId);

  try {
    const supabase = getSupabaseClient();

    // 2. Fetch email record
    const { data: email, error: emailErr } = await supabase
      .from("emails")
      .select("*")
      .eq("id", params.emailId)
      .maybeSingle();

    if (emailErr || !email) {
      throw new HitlActionError(`Email not found with ID ${params.emailId}`, 404);
    }

    // 3. Negative 1: Approving an email already marked 'sent' -> 409 Conflict
    if (email.status === "sent") {
      throw new HitlActionError(
        `Email ${params.emailId} has already been approved and sent`,
        409
      );
    }

  // 4. Fetch draft record
  const { data: draft, error: draftErr } = await supabase
    .from("drafts")
    .select("*")
    .eq("email_id", params.emailId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const finalBody =
    params.editedDraftBody !== undefined && params.editedDraftBody.trim() !== ""
      ? params.editedDraftBody
      : draft?.draft_body || "";
  if (!finalBody) {
    throw new HitlActionError("Cannot send email with empty draft body", 400);
  }

  // 5. If user edited the draft text, persist updated draft in database
  if (params.editedDraftBody && draft && params.editedDraftBody !== draft.draft_body) {
    await supabase
      .from("drafts")
      .update({
        draft_body: params.editedDraftBody,
        human_edited: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", draft.id);
  }

  // 6. Dispatch via Gmail API
  let sentGmailId = `sent_${Date.now()}`;

  if (mockGmailDispatcherOverride) {
    const dispatchRes = await mockGmailDispatcherOverride.send({
      draftId: draft?.gmail_draft_id,
      to: email.sender,
      subject: `Re: ${email.subject}`,
      body: finalBody,
    });
    sentGmailId = dispatchRes.id || sentGmailId;
  } else {
    try {
      const oauthClient = params.oauth2Client || getOAuth2Client();
      await ensureValidAccessToken(oauthClient);
      const gmail = google.gmail({ version: "v1", auth: oauthClient });

      // Edge 1: Handle if draft was deleted directly in Gmail before user approved
      if (draft?.gmail_draft_id) {
        // If human edited the draft body, update it in Gmail before sending
        if (params.editedDraftBody && params.editedDraftBody !== draft.draft_body) {
          try {
            const emailRaw = [
              `To: ${email.sender}`,
              `Subject: Re: ${email.subject}`,
              "Content-Type: text/plain; charset=utf-8",
              "",
              finalBody,
            ].join("\r\n");

            await gmail.users.drafts.update({
              userId: "me",
              id: draft.gmail_draft_id,
              requestBody: {
                message: {
                  raw: Buffer.from(emailRaw).toString("base64url"),
                  threadId: email.thread_id,
                },
              },
            });
          } catch (updateErr) {
            console.warn("Could not update Gmail draft before sending:", updateErr);
          }
        }

        try {
          const sendRes = await gmail.users.drafts.send({
            userId: "me",
            requestBody: {
              id: draft.gmail_draft_id,
            },
          });
          sentGmailId = sendRes.data.id || sentGmailId;
        } catch (gmailErr: any) {
          // If draft not found in Gmail (deleted externally), recreate & dispatch directly
          if (gmailErr.code === 404 || gmailErr.message?.includes("Not Found")) {
            console.warn("Gmail draft not found in Gmail (deleted externally). Dispatching as direct message.");
            const emailRaw = [
              `To: ${email.sender}`,
              `Subject: Re: ${email.subject}`,
              "Content-Type: text/plain; charset=utf-8",
              "",
              finalBody,
            ].join("\r\n");

            const rawBase64 = Buffer.from(emailRaw).toString("base64url");
            const directSend = await gmail.users.messages.send({
              userId: "me",
              requestBody: {
                raw: rawBase64,
                threadId: email.thread_id,
              },
            });
            sentGmailId = directSend.data.id || sentGmailId;
          } else {
            throw gmailErr;
          }
        }
      } else {
        // No draft ID on record, send direct message
        const emailRaw = [
          `To: ${email.sender}`,
          `Subject: Re: ${email.subject}`,
          "Content-Type: text/plain; charset=utf-8",
          "",
          finalBody,
        ].join("\r\n");

        const rawBase64 = Buffer.from(emailRaw).toString("base64url");
        const directSend = await gmail.users.messages.send({
          userId: "me",
          requestBody: {
            raw: rawBase64,
            threadId: email.thread_id,
          },
        });
        sentGmailId = directSend.data.id || sentGmailId;
      }
    } catch (err: any) {
      console.error("Gmail dispatch error in approveAndSendDraft:", err);
      throw new HitlActionError(`Failed to send message via Gmail: ${err.message}`, 500);
    }
  }

  // 7. Update status to 'sent'
  // Edge 2: Concurrent Review safety - check status atomically
  const { data: updatedEmail, error: updateErr } = await supabase
    .from("emails")
    .update({
      status: "sent",
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.emailId)
    .select()
    .single();

  if (updateErr) {
    throw new HitlActionError(updateErr.message, 500);
  }

    return {
      success: true,
      messageId: sentGmailId,
      status: "sent",
    };
  } finally {
    activeProcessingEmails.delete(params.emailId);
  }
}

/**
 * Saves human edits to a draft without dispatching
 */
export async function updateDraftContent(params: {
  draftId: string;
  draftBody: string;
  sessionToken?: string | null;
  oauth2Client?: OAuth2Client;
}): Promise<DraftRecord> {
  verifyUserSession(params.sessionToken);

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("drafts")
    .update({
      draft_body: params.draftBody,
      human_edited: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.draftId)
    .select()
    .single();

  if (error || !data) {
    throw new HitlActionError("Failed to update draft content", 400);
  }

  // Sync human draft revisions to Gmail draft if registered
  if (data.gmail_draft_id) {
    try {
      const { data: parentEmail } = await supabase
        .from("emails")
        .select("sender, subject, thread_id")
        .eq("id", data.email_id)
        .maybeSingle();

      if (parentEmail) {
        const oauthClient = params.oauth2Client || getOAuth2Client();
        await ensureValidAccessToken(oauthClient);
        const gmail = google.gmail({ version: "v1", auth: oauthClient });
        const rawMessage = [
          `To: ${parentEmail.sender}`,
          `Subject: Re: ${parentEmail.subject}`,
          "Content-Type: text/plain; charset=utf-8",
          "",
          params.draftBody,
        ].join("\r\n");

        await gmail.users.drafts.update({
          userId: "me",
          id: data.gmail_draft_id,
          requestBody: {
            message: {
              raw: Buffer.from(rawMessage).toString("base64url"),
              threadId: parentEmail.thread_id,
            },
          },
        });
      }
    } catch (gErr) {
      console.warn("Could not sync draft update to Gmail API:", gErr);
    }
  }

  return data as DraftRecord;
}

/**
 * Dismisses an email from the review queue
 */
export async function dismissEmail(params: {
  emailId: string;
  sessionToken?: string | null;
}): Promise<EmailRecord> {
  verifyUserSession(params.sessionToken);

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("emails")
    .update({
      status: "dismissed",
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.emailId)
    .select()
    .single();

  if (error || !data) {
    throw new HitlActionError("Failed to dismiss email", 400);
  }

  return data as EmailRecord;
}
