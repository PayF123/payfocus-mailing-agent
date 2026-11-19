import { GoogleGenerativeAI } from "@google/generative-ai";

export const EMBEDDING_DIMENSION = 768;

/**
 * Generates a deterministic 768-dimensional normalized vector from text tokens
 * Used as a fast, zero-latency fallback if Gemini embedding endpoint is unreachable
 * or returns a different dimension.
 */
export function computeDeterministicEmbedding(text: string): number[] {
  const vec = new Array<number>(EMBEDDING_DIMENSION).fill(0);
  const normalized = (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2);

  if (normalized.length === 0) {
    vec[0] = 1;
    return vec;
  }

  for (const word of normalized) {
    // Hash word into multiple buckets (n-gram style projection)
    let h1 = 2166136261;
    let h2 = 16777619;
    for (let i = 0; i < word.length; i++) {
      const c = word.charCodeAt(i);
      h1 ^= c;
      h1 = Math.imul(h1, 16777619);
      h2 ^= c;
      h2 = Math.imul(h2, 2166136261);
    }
    const idx1 = Math.abs(h1) % EMBEDDING_DIMENSION;
    const idx2 = Math.abs(h2) % EMBEDDING_DIMENSION;
    vec[idx1] += 1.0;
    vec[idx2] += 0.5;
  }

  // L2 normalize so cosine similarity works accurately
  let norm = 0;
  for (let i = 0; i < EMBEDDING_DIMENSION; i++) {
    norm += vec[i] * vec[i];
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < EMBEDDING_DIMENSION; i++) {
    vec[i] = Number((vec[i] / norm).toFixed(6));
  }

  return vec;
}

/**
 * Generates a 768-dimensional embedding vector using Google Gemini text-embedding-004,
 * falling back to deterministic token projection if offline or in test mode.
 */
export async function generateEmbedding768(text: string): Promise<number[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "mock-api-key" || process.env.NODE_ENV === "test") {
    return computeDeterministicEmbedding(text);
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "text-embedding-004" });
    const result = await model.embedContent(text);
    const values = result?.embedding?.values;
    if (Array.isArray(values) && values.length === EMBEDDING_DIMENSION) {
      return values;
    }
  } catch {
    // Fallback to deterministic 768-dim semantic vector
  }

  return computeDeterministicEmbedding(text);
}

/**
 * Starter knowledge base templates for demo & initial workspace setup
 */
export const STARTER_KNOWLEDGE_DOCS = [
  {
    title: "PayFocus Enterprise Pricing & Volume Tiers (2026)",
    category: "Sales & Pricing",
    content: `PayFocus offers three transparent payment processing tiers:
1. Standard Growth Tier (Up to 50 employees or 50,000 monthly transactions): 1.9% + $0.20 per transaction. Includes automated payroll disbursements, standard dashboard access, and 24/5 email support.
2. Scale Tier (50 to 250 employees or 50,000–200,000 monthly transactions): 1.25% + $0.10 per transaction. Includes T+1 priority settlement, multi-currency payouts, and priority Slack/email support.
3. Enterprise Custom Tier (250+ employees or 200,000+ monthly transactions): Custom volume rates starting at 0.85% + $0.05 per transaction, dedicated Account Manager, custom SLA (99.99% uptime guarantee), and free sandbox migration assistance.`,
  },
  {
    title: "API Secret Key Rotation & Zero-Downtime Dual-Key Policy",
    category: "Technical & API",
    content: `Merchants can rotate production API secret keys at any time with zero service downtime using our Dual-Key Rolling Window:
1. Go to PayFocus Dashboard > Settings > API & Credentials.
2. Click "Generate Secondary Secret Key" to issue a new live secret key while keeping your primary key active for a 24-hour overlap window.
3. Deploy the new secret key to your production environment variables and verify webhook signatures.
4. Once traffic is switched over, click "Revoke Previous Secret Key" in the dashboard.`,
  },
  {
    title: "Refunds, Chargebacks & Settlement Timelines SLA",
    category: "Billing & Refunds",
    content: `Settlement & Refund Policy:
- Standard Settlement: Payouts settle on a T+2 rolling schedule. Verified Scale and Enterprise merchants receive T+1 next-business-day settlement.
- Customer Refunds: Full or partial refunds initiated via Dashboard or POST /v1/refunds are processed immediately and reflect on the customer's card/bank statement within 3 to 5 business days. PayFocus charges $0 fee on refund processing.
- Chargeback Disputes: Evidence submission window is 7 business days via the Dispute Resolution Center.`,
  },
  {
    title: "Uptime SLA & Production Incident Response Protocol",
    category: "SLA & Support",
    content: `PayFocus guarantees 99.99% API and Checkout uptime for Enterprise merchants:
- Severity P1 (Critical Production Outage / HTTP 500 spike): Under 15-minute response time from our 24/7 On-Call SRE team, with real-time updates at status.payfocus.com.
- Severity P2 (Degraded latency or webhook delay): Under 1-hour response time.
- Severity P3 (General technical or billing inquiry): Under 4 business hours.`,
  },
  {
    title: "Merchant KYB Onboarding & Sandbox Testing Guide",
    category: "General FAQ",
    content: `To activate live payment processing on PayFocus:
1. Submit KYB documents (Certificate of Incorporation, Tax ID / GST / EIN, and Beneficial Owner ID) in Settings > Compliance.
2. Standard KYB verification completes within 24 business hours.
3. While KYB is under review, developers have full access to Sandbox Mode using test API keys (pf_test_*) and test card numbers.`,
  },
];

