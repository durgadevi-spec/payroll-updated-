import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

function createFallbackClient(): SupabaseClient {
  const error = new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  const stub = {
    from: () => ({
      select: async () => ({ data: null, error }),
      insert: async () => ({ data: null, error }),
      update: async () => ({ data: null, error }),
      delete: async () => ({ data: null, error }),
      eq: () => stub.from(),
      in: () => stub.from(),
      order: () => stub.from(),
      limit: () => stub.from(),
      upsert: async () => ({ data: null, error }),
    }),
  };

  return stub as unknown as SupabaseClient;
}

export const supabase: SupabaseClient =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : createFallbackClient();
