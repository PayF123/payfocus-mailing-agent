# Mailing AI Agent 🤖✉️

A product-ready, Human-in-the-Loop (HITL) Mailing AI Agent built with **Next.js 14 (App Router)**, **Supabase (`pgvector` & RLS)**, **Google Gemini 1.5**, and the **Gmail REST API**.

---

## 🌟 Key Features

1. **Automated Resilient Ingestion:**
   - Synchronizes unread messages using `googleapis` with automatic OAuth2 token refreshing.
   - Multipart MIME parsing (RFC 2047 Base64 & Quoted-Printable charset decoding).
   - Serverless payload safety guard that truncates large email bodies at 4MB to prevent Vercel 4.5MB serverless timeouts.
   - Scheduled via Vercel Cron every 5 minutes (`/api/emails/sync`) secured with `CRON_SECRET`.

2. **Adversarial Prompt Guard & Sanitizer:**
   - Regex-based security scanner targeting prompt injections, system overrides, instruction resetting, credential extraction, and script injection.
   - Neutralizes threatening payloads into `[BLOCKED_ADVERSARIAL_PAYLOAD]` and flags emails as malicious spam.

3. **AI Classification & Triage:**
   - Powered by Google Gemini 1.5 with exponential backoff for rate-limit protection (HTTP 429).
   - Categorizes emails into `Sales`, `Support`, `Urgent`, `Routine`, `Spam`.
   - Scores urgency on a scale of 1 to 5.
   - Heuristic detection for non-English, high consonant clustering, and random string gibberish to route to human review.

4. **Vector RAG & Safe Draft Creation:**
   - Queries `knowledge_docs` using PostgreSQL `pgvector` cosine similarity.
   - Zero-context anti-hallucination guard: if no internal documents match, produces polite clarification inquiries rather than fabricating policies.
   - Creates drafts in Gmail API via `gmail.users.drafts.create` (**Never sends directly without human operator approval**).

5. **Human-in-the-Loop (HITL) Dashboard:**
   - Review queue filtered by status (`All`, `Pending Review`, `Drafted`, `Sent`, `Dismissed`).
   - Detailed thread inspection with original message, AI rationale, and urgency badges.
   - Inline draft editor with optimistic UI updates.
   - Concurrent review safety: atomic in-flight locking prevents double-dispatch races across multiple browser tabs.
   - External Gmail deletion recovery: if a draft was deleted directly in Gmail before approval, gracefully falls back to direct message send.

---

## 🛠️ Tech Stack & Architecture

- **Framework:** Next.js 14+ (App Router, TypeScript, Tailwind CSS, Lucide Icons)
- **Database & Vectors:** Supabase PostgreSQL with `pgvector` extension and Row-Level Security (RLS)
- **AI Engine:** Google Gemini 1.5 Flash via `@google/generative-ai`
- **Email Service:** `googleapis` Gmail REST API with offline refresh flow
- **Validation:** Zod for strictly typed environment variables
- **Testing:** Vitest + `@testing-library/react` + jsdom

---

## 🚀 Setup & Deployment Guide

### 1. Supabase Setup
1. Create a Supabase project at [supabase.com](https://supabase.com).
2. Open the SQL Editor in Supabase and execute the script in `supabase/schema.sql`.
   - Enables `pgvector` extension.
   - Creates `emails`, `drafts`, and `knowledge_docs` tables.
   - Creates HNSW index and `match_knowledge_docs` similarity matching function.
   - Configures Row-Level Security (RLS).

### 2. Google Cloud OAuth Setup
1. In Google Cloud Console, enable the **Gmail API**.
2. Configure the OAuth Consent Screen and create **OAuth 2.0 Client IDs** (Web application).
3. Set Authorized Redirect URI: `https://developers.google.com/oauthplayground` (or your domain callback).
4. Obtain a `refresh_token` with scope `https://www.googleapis.com/auth/gmail.modify`.

### 3. Google Gemini Setup
1. Get an API key from Google AI Studio ([aistudio.google.com](https://aistudio.google.com)).

### 4. Environment Variables Configuration
Copy `.env.example` to `.env.local` and set:

```env
# Next.js App
NODE_ENV=production
NEXT_PUBLIC_APP_URL=https://your-domain.vercel.app

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Google Gemini AI
GEMINI_API_KEY=your-gemini-api-key

# Google OAuth2 / Gmail API
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=https://developers.google.com/oauthplayground
GOOGLE_REFRESH_TOKEN=your-refresh-token

# Security & Cron
CRON_SECRET=your-secure-random-cron-secret-at-least-8-chars
```

### 5. Running Locally
```bash
# Install dependencies
npm install

# Run automated tests
npm test

# Run Next.js dev server
npm run dev
```

### 6. Deploying to Vercel
1. Import repository into Vercel.
2. In Project Settings > Environment Variables, populate all keys from step 4.
3. Deploy! Vercel automatically configures the 5-minute cron job defined in `vercel.json`.

---

## 🧪 Comprehensive Automated Test Matrix

Run the test suite:
```bash
npm test
```

- **Phase 1 (`tests/phase1.test.ts`):** 9 tests (Schema, valid insert, foreign key checks, duplicate upsert idempotency).
- **Phase 2 (`tests/phase2.test.ts`):** 7 tests (MIME parsing, OAuth token refresh, 401 on revoked token, 4MB payload truncation, RFC 2047 headers).
- **Phase 3 (`tests/phase3.test.ts`):** 5 tests (RAG FAQ draft citing, 429 rate limit backoff, prompt injection neutralization, zero-context anti-hallucination, gibberish detection).
- **Phase 4 (`tests/phase4.test.ts`):** 6 tests (Approve & send, 409 sent conflict, 401 unauthenticated, Gmail 404 deletion recovery, concurrent review locking).
- **Phase 5 (`tests/phase5.test.ts`):** 7 tests (Zod environment validation, vercel.json cron and security headers, custom domain handling).

**Total Test Coverage:** **34 / 34 Tests Passing (100%)**
