import { GoogleGenerativeAI } from "@google/generative-ai";
import { sanitizeInboundPrompt } from "./sanitizer";

export type EmailCategory = "Sales" | "Support" | "Urgent" | "Routine" | "Spam";

export interface ClassificationResult {
  category: EmailCategory;
  urgencyScore: number; // 1 to 5
  confidence: number;   // 0.0 to 1.0
  reasoning: string;
  isMaliciousOrSpam: boolean;
  requiresHumanReview: boolean;
}

let mockGeminiModelOverride: any = null;

export function setMockGeminiModel(model: any) {
  mockGeminiModelOverride = model;
}

/**
 * Exponential backoff helper for rate-limited AI API calls (e.g. 429)
 */
export async function withExponentialBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelayMs: number = 200
): Promise<T> {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await fn();
    } catch (error: any) {
      attempt++;
      const isRateLimit =
        error.status === 429 ||
        error.status === 503 ||
        error.message?.includes("429") ||
        error.message?.includes("503") ||
        error.message?.toLowerCase().includes("quota exceeded") ||
        error.message?.toLowerCase().includes("high demand") ||
        error.message?.toLowerCase().includes("rate limit");

      if (isRateLimit && attempt < maxRetries) {
        const delay = initialDelayMs * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw new Error("Exceeded max retries with exponential backoff");
}

/**
 * Heuristic detector for non-English, gibberish, random character strings, or low-quality input
 */
function isGibberishOrLowQuality(subject: string, text: string): boolean {
  const combined = `${subject} ${text}`.trim();
  if (!combined || combined.length === 0) return true;

  // Check for random unspaced strings
  const words = combined.split(/\s+/).filter(Boolean);
  
  // High consonant clustering or random alphanumeric sequences without vowel structure
  let gibberishWordCount = 0;
  for (const word of words) {
    if (word.length > 5) {
      const vowels = (word.match(/[aeiouyAEIOUY]/g) || []).length;
      const ratio = vowels / word.length;
      if (ratio < 0.15 || ratio > 0.85) {
        gibberishWordCount++;
      }
    }
    // Mixed digits and random characters e.g. 902834098 or 09213840912834
    if (/^[0-9a-zA-Z]{12,}$/.test(word) && /\d/.test(word) && /[a-zA-Z]/.test(word)) {
      gibberishWordCount++;
    }
  }

  if (words.length > 0 && (gibberishWordCount / words.length) > 0.35) {
    return true;
  }

  // Check character distribution
  const digitsAndLetters = (combined.match(/[a-zA-Z0-9]/g) || []).length;
  const ratio = digitsAndLetters / combined.length;
  if (combined.length > 15 && ratio < 0.5) return true;

  return false;
}

/**
 * Classifies email intent and scores urgency (1-5) using Google Gemini
 */
export async function classifyEmail(
  subject: string,
  body: string
): Promise<ClassificationResult> {
  // First layer: Prompt guard / Injection sanitizer
  const combinedText = `Subject: ${subject}\n\n${body}`;
  const sanitization = sanitizeInboundPrompt(combinedText);

  // If prompt injection or adversarial payload detected, immediately route as malicious spam
  if (!sanitization.isSafe) {
    return {
      category: "Spam",
      urgencyScore: 5,
      confidence: 0.99,
      reasoning: `Adversarial instructions or prompt injection detected: ${sanitization.threatsDetected.join(", ")}`,
      isMaliciousOrSpam: true,
      requiresHumanReview: true,
    };
  }

  // Check for gibberish or unsupported format
  if (isGibberishOrLowQuality(subject, body)) {
    return {
      category: "Spam",
      urgencyScore: 1,
      confidence: 0.3,
      reasoning: "Low quality or gibberish text detected",
      isMaliciousOrSpam: true,
      requiresHumanReview: true,
    };
  }

  // Model execution with mock override support
  const executeClassification = async (): Promise<ClassificationResult> => {
    if (mockGeminiModelOverride) {
      return await mockGeminiModelOverride.classify(subject, sanitization.sanitizedText);
    }

    const apiKey = process.env.GEMINI_API_KEY || "mock-api-key";
    const genAI = new GoogleGenerativeAI(apiKey);
    const modelName = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
    const model = genAI.getGenerativeModel({ model: modelName });

    const prompt = `You are an executive email triage assistant for a fintech & payments company.
Analyze the following email and respond STRICTLY in JSON format with no markdown blocks:
{
  "category": "Sales" | "Support" | "Urgent" | "Routine" | "Spam",
  "urgencyScore": number (1 to 5),
  "confidence": number (0.0 to 1.0),
  "reasoning": string,
  "requiresHumanReview": boolean
}

Email:
${sanitization.sanitizedText}`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    const cleanJson = responseText.replace(/```json/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleanJson);

    return {
      category: parsed.category || "Routine",
      urgencyScore: Math.max(1, Math.min(5, parsed.urgencyScore || 1)),
      confidence: parsed.confidence || 0.8,
      reasoning: parsed.reasoning || "Standard classification",
      isMaliciousOrSpam: parsed.category === "Spam",
      requiresHumanReview: parsed.requiresHumanReview ?? (parsed.confidence < 0.6),
    };
  };

  try {
    return await withExponentialBackoff(executeClassification, 3, 100);
  } catch (error: any) {
    // If rate limit 429 or 503 high-demand persisted after backoff, return a safe fallback to prevent crash
    if (
      error.status === 429 ||
      error.status === 503 ||
      error.message?.includes("429") ||
      error.message?.includes("503") ||
      error.message?.toLowerCase().includes("high demand")
    ) {
      const combined = (subject + " " + body).toLowerCase();
      let fallbackCategory: "Sales" | "Support" | "Urgent" | "Routine" | "Spam" = "Routine";
      let urgencyScore = 2;

      if (combined.includes("pricing") || combined.includes("quote") || combined.includes("enterprise") || combined.includes("sales")) {
        fallbackCategory = "Sales";
        urgencyScore = 3;
      } else if (combined.includes("urgent") || combined.includes("error") || combined.includes("500") || combined.includes("down")) {
        fallbackCategory = "Urgent";
        urgencyScore = 5;
      }

      return {
        category: fallbackCategory,
        urgencyScore,
        confidence: 0.75,
        reasoning: `Categorized via intelligent heuristic fallback due to temporary Gemini API demand (${error.status || 503})`,
        isMaliciousOrSpam: false,
        requiresHumanReview: true,
      };
    }
    throw error;
  }
}
