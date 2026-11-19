import { GoogleGenerativeAI } from "@google/generative-ai";
import { getSupabaseClient } from "../supabase";
import { sanitizeInboundPrompt } from "./sanitizer";
import { createGmailDraft } from "../gmail";
import { insertDraft, upsertEmail } from "../db";
import { withExponentialBackoff } from "./classifier";
import { generateEmbedding768 } from "./embeddings";

export interface KnowledgeDocMatch {
  id: string;
  title: string;
  content: string;
  similarity: number;
}

export interface GeneratedDraftResult {
  draftBody: string;
  rationale: string;
  matchedDocsCount: number;
  citedSources: string[];
  gmailDraftId?: string;
  isCautiousFallback: boolean;
}

let mockVectorSearchOverride: any = null;
let mockGeminiDraftOverride: any = null;

export function setMockVectorSearch(fn: any) {
  mockVectorSearchOverride = fn;
}

export function setMockGeminiDraft(model: any) {
  mockGeminiDraftOverride = model;
}

/**
 * Retrieves matching knowledge base articles using vector cosine similarity + hybrid keyword ranking
 */
export async function queryKnowledgeDocs(
  queryText: string,
  threshold: number = 0.35,
  limit: number = 3
): Promise<KnowledgeDocMatch[]> {
  if (mockVectorSearchOverride) {
    return await mockVectorSearchOverride(queryText, threshold, limit);
  }

  const supabase = getSupabaseClient();
  const queryEmbedding = await generateEmbedding768(queryText);

  const resultsMap = new Map<string, KnowledgeDocMatch>();

  // 1. Vector cosine similarity search via pgvector RPC
  try {
    const { data: vectorMatches } = await supabase.rpc("match_knowledge_docs", {
      query_embedding: queryEmbedding,
      match_threshold: threshold,
      match_count: limit,
    });

    if (Array.isArray(vectorMatches)) {
      for (const m of vectorMatches) {
        resultsMap.set(m.id, {
          id: m.id,
          title: m.title,
          content: m.content,
          similarity: Number(m.similarity || 0.7),
        });
      }
    }
  } catch {
    // Continue to hybrid keyword fallback
  }

  // 2. Hybrid keyword & semantic token matching across knowledge_docs
  try {
    const { data: allDocs } = await supabase
      .from("knowledge_docs")
      .select("id, title, content, category")
      .limit(50);

    if (Array.isArray(allDocs) && allDocs.length > 0) {
      const stopWords = new Set([
        "the", "and", "for", "with", "that", "this", "from", "have", "are",
        "was", "can", "you", "your", "our", "how", "what", "please", "hello",
        "team", "payfocus", "need", "would", "like", "about",
      ]);

      const queryTokens = (queryText || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 3 && !stopWords.has(w));

      if (queryTokens.length > 0) {
        for (const doc of allDocs) {
          const haystack = `${doc.title} ${doc.category || ""} ${doc.content}`.toLowerCase();
          let matchedTokens = 0;
          for (const token of queryTokens) {
            if (haystack.includes(token)) {
              matchedTokens++;
            }
          }
          if (matchedTokens > 0) {
            const keywordScore = Math.min(0.95, 0.45 + (matchedTokens / Math.min(queryTokens.length, 6)) * 0.5);
            const existing = resultsMap.get(doc.id);
            if (!existing || keywordScore > existing.similarity) {
              resultsMap.set(doc.id, {
                id: doc.id,
                title: doc.title,
                content: doc.content,
                similarity: Number(keywordScore.toFixed(2)),
              });
            }
          }
        }
      }
    }
  } catch {
    // Ignore if table not accessible in mock tests
  }

  return Array.from(resultsMap.values())
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

/**
 * Drafts context-aware email responses using RAG context or safe fallback
 */
export async function generateEmailDraft(params: {
  emailId: string;
  sender: string;
  subject: string;
  body: string;
  threadId?: string;
  oauth2Client?: any;
}): Promise<GeneratedDraftResult> {
  // 1. Sanitize prompt
  const sanitized = sanitizeInboundPrompt(params.body);

  // 2. Query Knowledge Base for context
  const matchedDocs = await queryKnowledgeDocs(params.subject + " " + sanitized.sanitizedText);

  // Edge Case 2: Zero Context handling
  const hasContext = matchedDocs && matchedDocs.length > 0;
  
  const generateDraftWithAI = async (): Promise<GeneratedDraftResult> => {
    if (mockGeminiDraftOverride) {
      return await mockGeminiDraftOverride.generateDraft({
        subject: params.subject,
        body: sanitized.sanitizedText,
        matchedDocs,
        hasContext,
      });
    }

    const apiKey = process.env.GEMINI_API_KEY || "mock-api-key";
    const genAI = new GoogleGenerativeAI(apiKey);
    const modelName = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
    const model = genAI.getGenerativeModel({ model: modelName });

    let systemContext = "";
    if (hasContext) {
      systemContext = `Reference the following verified company knowledge documents to answer the inquiry accurately:\n${matchedDocs
        .map((d) => `[Document: ${d.title}]\n${d.content}`)
        .join("\n\n")}`;
    } else {
      systemContext = `NOTICE: No verified internal documentation matched this inquiry. 
DO NOT hallucinate facts, pricing, or technical policies. 
Generate a polite, professional, cautious response acknowledging receipt and asking clarifying questions to route to the appropriate human specialist.`;
    }

    const prompt = `You are an AI email assistant for PayFocus.
${systemContext}

Inbound Email:
From: ${params.sender}
Subject: ${params.subject}
Body:
${sanitized.sanitizedText}

Write a professional email draft response matching our helpful and concise company tone.
Return strictly JSON with keys "draftBody", "rationale", and "citedSources":
{
  "draftBody": string,
  "rationale": string,
  "citedSources": string[]
}`;

    const res = await model.generateContent(prompt);
    const text = res.response.text().replace(/```json/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(text);

    const resolvedCitations: string[] =
      Array.isArray(parsed.citedSources) && parsed.citedSources.length > 0
        ? parsed.citedSources
        : hasContext
        ? matchedDocs.map((d) => d.title)
        : [];

    const baseRationale = parsed.rationale || "Context-grounded response draft";
    const enrichedRationale =
      hasContext && resolvedCitations.length > 0 && !baseRationale.includes(resolvedCitations[0])
        ? `Referenced Knowledge Base (${resolvedCitations.join(", ")}): ${baseRationale}`
        : baseRationale;

    return {
      draftBody: parsed.draftBody,
      rationale: enrichedRationale,
      matchedDocsCount: matchedDocs.length,
      citedSources: resolvedCitations,
      isCautiousFallback: !hasContext,
    };
  };

  let draftResult: GeneratedDraftResult;

  try {
    draftResult = await withExponentialBackoff(generateDraftWithAI, 3, 100);
  } catch (error: any) {
    if (
      error.status === 429 ||
      error.status === 503 ||
      error.message?.includes("429") ||
      error.message?.includes("503") ||
      error.message?.toLowerCase().includes("quota") ||
      error.message?.toLowerCase().includes("high demand")
    ) {
      if (hasContext && matchedDocs.length > 0) {
        const topDoc = matchedDocs[0];
        draftResult = {
          draftBody: `Hi,\n\nThank you for reaching out to PayFocus regarding "${params.subject}".\n\nBased on our ${topDoc.title}:\n${topDoc.content}\n\nPlease let us know if you would like to discuss this further or need any additional details.\n\nBest regards,\nPayFocus Team`,
          rationale: `Referenced Knowledge Base (${topDoc.title}) during high-demand fallback`,
          matchedDocsCount: matchedDocs.length,
          citedSources: matchedDocs.map((d) => d.title),
          isCautiousFallback: false,
        };
      } else {
        // Graceful fallback for rate-limiting when no context docs matched
        draftResult = {
          draftBody: `Hi,\n\nThank you for contacting PayFocus support. We have received your message regarding "${params.subject}".\nA customer support specialist is reviewing your inquiry and will follow up shortly.\n\nBest regards,\nPayFocus Support`,
          rationale: "Automated cautious fallback draft due to AI rate-limiting backoff",
          matchedDocsCount: 0,
          citedSources: [],
          isCautiousFallback: true,
        };
      }
    } else {
      throw error;
    }
  }

  // 3. Create Gmail Draft if oauth2Client provided (NEVER auto-send directly!)
  if (params.oauth2Client) {
    try {
      const gmailDraft = await createGmailDraft(params.oauth2Client, {
        to: params.sender,
        subject: `Re: ${params.subject}`,
        body: draftResult.draftBody,
        threadId: params.threadId,
      });
      draftResult.gmailDraftId = gmailDraft.draftId;
    } catch (err) {
      console.error("Failed to persist draft in Gmail API:", err);
    }
  }

  // 4. Save Draft into Supabase Database
  await insertDraft({
    email_id: params.emailId,
    draft_body: draftResult.draftBody,
    rationale: draftResult.rationale,
    human_edited: false,
    gmail_draft_id: draftResult.gmailDraftId,
  });

  // Update email status to 'drafted'
  const supabase = getSupabaseClient();
  await supabase
    .from("emails")
    .update({
      status: "drafted",
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.emailId);

  return draftResult;
}
