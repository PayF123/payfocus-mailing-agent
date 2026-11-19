import { NextRequest, NextResponse } from "next/server";
import { getOAuth2Client, fetchRecentEmails, GmailAuthError } from "@/lib/gmail";
import { upsertEmail } from "@/lib/db";

export const maxDuration = 60; // 60 seconds serverless timeout

export async function GET(req: NextRequest) {
  // Authorization check for Vercel Cron or webhook caller
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { error: "Unauthorized: Invalid or missing authorization token" },
      { status: 401 }
    );
  }

  try {
    const userEmail = req.nextUrl.searchParams.get("user_email")?.trim() || null;
    const userAccessToken = req.headers.get("x-gmail-access-token")?.trim() || undefined;
    const userRefreshToken = req.headers.get("x-gmail-refresh-token")?.trim() || undefined;

    if (
      userEmail &&
      !userEmail.toLowerCase().includes("personalarijeet") &&
      !userAccessToken &&
      !userRefreshToken
    ) {
      return NextResponse.json(
        {
          error: `No active Gmail OAuth token found for ${userEmail}. Please sign out and click 'Continue with Google' to authorize Gmail access for this account.`,
        },
        { status: 401 }
      );
    }

    const oauth2Client = getOAuth2Client(
      userAccessToken || userRefreshToken
        ? { accessToken: userAccessToken, refreshToken: userRefreshToken }
        : undefined
    );
    const limitParam = req.nextUrl.searchParams.get("limit");
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 5, 1), 20) : 5;
    const emails = await fetchRecentEmails(oauth2Client, "is:unread", limit);

    const ingested = [];
    const errors = [];

    const { classifyEmail } = await import("@/lib/ai/classifier");
    const { generateEmailDraft } = await import("@/lib/ai/draft-generator");

    const { getSupabaseClient } = await import("@/lib/supabase");
    const supabase = getSupabaseClient();
    const messageIds = emails.map((e) => e.message_id);

    // Fast check: find emails already ingested to skip redundant Gemini AI calls
    const { data: existingRows } = messageIds.length > 0
      ? await supabase.from("emails").select("id, message_id").in("message_id", messageIds)
      : { data: [] };

    const existingMap = new Map((existingRows || []).map((r: any) => [r.message_id, r.id]));

    for (const email of emails) {
      try {
        if (existingMap.has(email.message_id)) {
          ingested.push({
            id: existingMap.get(email.message_id),
            message_id: email.message_id,
            alreadyIngested: true,
          });
          continue;
        }
        // 1. Classify with Google Gemini AI
        let urgency_score = 1;
        let intent = "Routine";
        try {
          const classification = await classifyEmail(email.subject, email.body);
          urgency_score = classification.urgencyScore;
          intent = classification.category;
        } catch (aiErr) {
          console.warn("AI Classification failed, using fallback:", aiErr);
        }

        // 2. Upsert inbound email into Supabase
        const normalizedRecipient =
          userEmail && !email.recipient?.toLowerCase().includes(userEmail.toLowerCase())
            ? userEmail
            : email.recipient;

        const saved = await upsertEmail({
          message_id: email.message_id,
          thread_id: email.thread_id,
          sender: email.sender,
          recipient: normalizedRecipient,
          subject: email.subject,
          body: email.body,
          status: "pending_review",
          urgency_score,
          intent,
        });

        // 3. Generate context-aware AI draft response only if not already drafted
        const { getSupabaseClient } = await import("@/lib/supabase");
        const supabase = getSupabaseClient();
        const { data: existingDraft } = await supabase
          .from("drafts")
          .select("id")
          .eq("email_id", saved.id)
          .limit(1)
          .maybeSingle();

        if (!existingDraft) {
          try {
            await generateEmailDraft({
              emailId: saved.id,
              sender: email.sender,
              subject: email.subject,
              body: email.body,
              threadId: email.thread_id,
              oauth2Client,
            });
          } catch (draftErr) {
            console.warn("AI Draft generation failed:", draftErr);
          }
        }

        ingested.push({ id: saved.id, message_id: saved.message_id, intent, urgency_score, truncated: email.truncated });
      } catch (err: any) {
        errors.push({ message_id: email.message_id, error: err.message });
      }
    }

    return NextResponse.json({
      success: true,
      syncedCount: emails.length,
      ingestedCount: ingested.length,
      ingested,
      errors,
    });
  } catch (error: any) {
    if (error instanceof GmailAuthError) {
      return NextResponse.json(
        { error: error.message, code: "GMAIL_AUTH_ERROR" },
        { status: error.statusCode }
      );
    }

    console.error("Email sync error:", error);
    return NextResponse.json(
      { error: "Internal Server Error during email sync", details: error.message },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
