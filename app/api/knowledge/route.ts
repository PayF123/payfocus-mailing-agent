import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { generateEmbedding768, STARTER_KNOWLEDGE_DOCS } from "@/lib/ai/embeddings";

export async function GET() {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("knowledge_docs")
      .select("id, title, content, category, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ docs: data || [] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = getSupabaseClient();
    const body = await req.json().catch(() => ({}));

    // Handle 1-click starter template seeding
    if (body.action === "seed_defaults") {
      const { data: existing } = await supabase
        .from("knowledge_docs")
        .select("title");

      const existingTitles = new Set((existing || []).map((d: any) => d.title));
      const toInsert = [];

      for (const doc of STARTER_KNOWLEDGE_DOCS) {
        if (!existingTitles.has(doc.title)) {
          const embedding = await generateEmbedding768(`${doc.title}\n${doc.category}\n${doc.content}`);
          toInsert.push({
            title: doc.title,
            category: doc.category,
            content: doc.content,
            embedding,
          });
        }
      }

      if (toInsert.length > 0) {
        const { error: insertErr } = await supabase
          .from("knowledge_docs")
          .insert(toInsert);

        if (insertErr) {
          return NextResponse.json({ error: insertErr.message }, { status: 500 });
        }
      }

      const { data: allDocs } = await supabase
        .from("knowledge_docs")
        .select("id, title, content, category, created_at")
        .order("created_at", { ascending: false });

      return NextResponse.json({
        success: true,
        seededCount: toInsert.length,
        docs: allDocs || [],
      });
    }

    // Handle creating a custom knowledge base document
    const title = (body.title || "").trim();
    const content = (body.content || "").trim();
    const category = (body.category || "General FAQ").trim();

    if (!title || !content) {
      return NextResponse.json(
        { error: "Both title and content are required." },
        { status: 400 }
      );
    }

    const embedding = await generateEmbedding768(`${title}\n${category}\n${content}`);

    const { data, error } = await supabase
      .from("knowledge_docs")
      .insert({
        title,
        category,
        content,
        embedding,
      })
      .select("id, title, content, category, created_at")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, doc: data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

