import { NextRequest, NextResponse } from "next/server";
import { updateDraftContent, HitlActionError } from "@/lib/hitl";
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

    if (!body.draftBody) {
      return NextResponse.json({ error: "Missing draftBody" }, { status: 400 });
    }

    // Check in-memory demo store first if operating in local preview
    const { inMemoryDemoStore } = await import("@/lib/demo-store");
    for (const email of inMemoryDemoStore.emails) {
      const draft = email.drafts.find((d) => d.id === params.id);
      if (draft) {
        draft.draft_body = body.draftBody;
        draft.human_edited = true;
        draft.updated_at = new Date().toISOString();
        return NextResponse.json({ success: true, draft });
      }
    }

    const oauth2Client =
      userAccessToken || userRefreshToken
        ? getOAuth2Client({ accessToken: userAccessToken, refreshToken: userRefreshToken })
        : undefined;

    const result = await updateDraftContent({
      draftId: params.id,
      draftBody: body.draftBody,
      sessionToken: authHeader,
      oauth2Client,
    });

    return NextResponse.json({ success: true, draft: result });
  } catch (err: any) {
    if (err instanceof HitlActionError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    return NextResponse.json(
      { error: "Internal server error during draft save", details: err.message },
      { status: 500 }
    );
  }
}
