-- Enable pgvector extension for semantic similarity retrieval
CREATE EXTENSION IF NOT EXISTS vector;

-- Status Enum for email workflow states
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'email_status') THEN
    CREATE TYPE email_status AS ENUM (
      'pending_review',
      'drafted',
      'approved',
      'sent',
      'dismissed',
      'failed'
    );
  END IF;
END $$;

-- Emails table for tracking ingested and processed emails
CREATE TABLE IF NOT EXISTS emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id TEXT NOT NULL UNIQUE,
  thread_id TEXT NOT NULL,
  sender TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status email_status NOT NULL DEFAULT 'pending_review',
  urgency_score SMALLINT NOT NULL DEFAULT 1 CHECK (urgency_score BETWEEN 1 AND 5),
  intent TEXT NOT NULL DEFAULT 'Routine',
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Drafts table for AI generated and human reviewed email drafts
CREATE TABLE IF NOT EXISTS drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id UUID NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  draft_body TEXT NOT NULL,
  rationale TEXT NOT NULL,
  human_edited BOOLEAN NOT NULL DEFAULT false,
  gmail_draft_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Knowledge Docs table for vector similarity / RAG context
CREATE TABLE IF NOT EXISTS knowledge_docs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT DEFAULT 'general',
  embedding vector(768),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_emails_message_id ON emails (message_id);
CREATE INDEX IF NOT EXISTS idx_emails_thread_id ON emails (thread_id);
CREATE INDEX IF NOT EXISTS idx_emails_status ON emails (status);
CREATE INDEX IF NOT EXISTS idx_emails_created_at ON emails (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_drafts_email_id ON drafts (email_id);

-- IVFFlat or HNSW index on vector embeddings for fast retrieval
CREATE INDEX IF NOT EXISTS idx_knowledge_docs_embedding 
  ON knowledge_docs 
  USING hnsw (embedding vector_cosine_ops);

-- Similarity matching function for RAG queries
CREATE OR REPLACE FUNCTION match_knowledge_docs(
  query_embedding vector(768),
  match_threshold float,
  match_count int
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  content TEXT,
  category TEXT,
  similarity float
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    kd.id,
    kd.title,
    kd.content,
    kd.category,
    1 - (kd.embedding <=> query_embedding) AS similarity
  FROM knowledge_docs kd
  WHERE 1 - (kd.embedding <=> query_embedding) > match_threshold
  ORDER BY kd.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Row Level Security (RLS)
ALTER TABLE emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_docs ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users / service role full access
CREATE POLICY "Allow service role full access to emails" ON emails
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow service role full access to drafts" ON drafts
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow service role full access to knowledge_docs" ON knowledge_docs
  FOR ALL USING (true) WITH CHECK (true);
