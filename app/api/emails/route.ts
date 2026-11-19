import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { inMemoryDemoStore } from "@/lib/demo-store";

export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabaseClient();
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const userEmail = searchParams.get("user_email");

    let query = supabase
      .from("emails")
      .select("*, drafts(*)")
      .order("created_at", { ascending: false });

    if (status && status !== "all") {
      query = query.eq("status", status);
    }

    if (userEmail) {
      query = query.ilike("recipient", `%${userEmail}%`);
    }

    const { data, error } = await query;
    if (error || !data) {
      const demoEmails = inMemoryDemoStore.emails;
      const filtered =
        status && status !== "all"
          ? demoEmails.filter((e) => e.status === status)
          : demoEmails;

      return NextResponse.json({ emails: filtered });
    }

    const mapped = (data || []).map((e: any) => ({
      ...e,
      drafts: Array.isArray(e.drafts)
        ? e.drafts.sort(
            (a: any, b: any) =>
              new Date(b.updated_at || b.created_at).getTime() -
              new Date(a.updated_at || a.created_at).getTime()
          )
        : [],
    }));

    return NextResponse.json({ emails: mapped });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
