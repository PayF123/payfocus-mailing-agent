import { NextRequest, NextResponse } from "next/server";
import { approveAndSendDraft, HitlActionError } from "@/lib/hitl";
import { getOAuth2Client } from "@/lib/gmail";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authHeader = req.headers.get("authorization") || req.headers.get("x-session-token");
    const userAccessToken = req.headers.get("x-gmail-access-token")?.trim() || undefined;
    const userRefreshToken = req.headers.get("x-gmail-refresh-token")?.trim() || undefined;
    const body = await req.json().catch(() => ({}));

    // Check in-memory demo store first if operating in local preview
    const { inMemoryDemoStore } = await import("@/lib/demo-store");
    const demoEmail = inMemoryDemoStore.emails.find((e) => e.id === params.id);
    if (demoEmail) {
      if (demoEmail.status === "sent") {
        return NextResponse.json(
          { error: `Email ${params.id} has already been approved and sent` },
          { status: 409 }
        );
      }
      demoEmail.status = "sent";
      if (body.editedDraftBody && demoEmail.drafts && demoEmail.drafts[0]) {
        demoEmail.drafts[0].draft_body = body.editedDraftBody;
        demoEmail.drafts[0].human_edited = true;
      }
      return NextResponse.json({
        success: true,
        messageId: `demo_sent_${Date.now()}`,
        status: "sent",
      });
    }

    const oauth2Client =
      userAccessToken || userRefreshToken
        ? getOAuth2Client({ accessToken: userAccessToken, refreshToken: userRefreshToken })
        : undefined;

    const result = await approveAndSendDraft({
      emailId: params.id,
      editedDraftBody: body.editedDraftBody,
      sessionToken: authHeader,
      oauth2Client,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    if (err instanceof HitlActionError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    return NextResponse.json(
      { error: "Internal server error during draft approval", details: err.message },
      { status: 500 }
    );
  }
}
