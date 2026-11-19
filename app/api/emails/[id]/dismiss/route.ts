import { NextRequest, NextResponse } from "next/server";
import { dismissEmail, HitlActionError } from "@/lib/hitl";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authHeader = req.headers.get("authorization") || req.headers.get("x-session-token");

    // Check in-memory demo store first if operating in local preview
    const { inMemoryDemoStore } = await import("@/lib/demo-store");
    const demoEmail = inMemoryDemoStore.emails.find((e) => e.id === params.id);
    if (demoEmail) {
      demoEmail.status = "dismissed";
      return NextResponse.json({ success: true, email: demoEmail });
    }

    const result = await dismissEmail({
      emailId: params.id,
      sessionToken: authHeader,
    });

    return NextResponse.json({ success: true, email: result });
  } catch (err: any) {
    if (err instanceof HitlActionError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    return NextResponse.json(
      { error: "Internal server error during email dismissal", details: err.message },
      { status: 500 }
    );
  }
}
