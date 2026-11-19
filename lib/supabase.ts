import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Polyfill mock WebSocket if missing in Node < 22 to prevent RealtimeClient initialization errors
if (typeof globalThis.WebSocket === "undefined") {
  (globalThis as any).WebSocket = class MockWebSocket {};
}

let cachedClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (cachedClient) {
    return cachedClient;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://mock-supabase-url.supabase.co";
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "mock-service-role-key";

  cachedClient = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return cachedClient;
}

export function setMockSupabaseClient(client: SupabaseClient | null) {
  cachedClient = client;
}
