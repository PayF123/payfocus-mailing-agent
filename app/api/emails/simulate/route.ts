import { NextRequest, NextResponse } from "next/server";
import { upsertEmail } from "@/lib/db";
import { classifyEmail } from "@/lib/ai/classifier";
import { generateEmailDraft } from "@/lib/ai/draft-generator";

export const maxDuration = 60;

/**
 * Direct endpoint to test Gemini AI classification and RAG draft generation
 * without requiring Google Cloud OAuth or live Gmail API credentials.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const {
      sender = "prospective.client@company.com",
      recipient = "support@payfocus.com",
      subject = "Question about API webhooks",
      emailBody = "Hi Support, how do we verify HMAC-SHA256 signatures on PayFocus webhook events in Node.js?",
    } = body;

    const message_id = `inbound_gemini_${Date.now()}`;
    const thread_id = `th_${Date.now()}`;

    // 1. Run Google Gemini AI Classifier & Urgency Scorer
    const classification = await classifyEmail(subject, emailBody);

    // 2. Persist inbound email in Supabase
    const savedEmail = await upsertEmail({
      message_id,
      thread_id,
      sender,
      recipient,
      subject,
      body: emailBody,
      status: "pending_review",
      urgency_score: classification.urgencyScore,
      intent: classification.category,
    });

    // 3. Run Google Gemini AI Context-Aware Draft Generator
    const draftResult = await generateEmailDraft({
      emailId: savedEmail.id,
      sender,
      subject,
      body: emailBody,
      threadId: thread_id,
      oauth2Client: null, // Zero Gmail OAuth required for pure AI test
    });

    return NextResponse.json({
      success: true,
      message: "Email successfully ingested, classified, and drafted by Google Gemini AI!",
      email: {
        id: savedEmail.id,
        sender,
        subject,
        classification: {
          category: classification.category,
          urgencyScore: classification.urgencyScore,
          confidence: classification.confidence,
          reasoning: classification.reasoning,
        },
      },
      draft: {
        body: draftResult.draftBody,
        rationale: draftResult.rationale,
        isCautiousFallback: draftResult.isCautiousFallback,
      },
    });
  } catch (error: any) {
    console.error("Gemini AI Test Route Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to process email with Gemini AI",
      },
      { status: 500 }
    );
  }
}

