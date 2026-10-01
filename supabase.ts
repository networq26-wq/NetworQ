import { createClient } from "@supabase/supabase-js";

export const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  "https://jpuxmkkuzqojqeatespa.supabase.co";
export const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpwdXhta2t1enFvanFlYXRlc3BhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5OTA5MDEsImV4cCI6MjEwMzU2NjkwMX0.eO4xWQyVlA0KzvnJugFADiVrahWXTRDEUq-k5uRcPp0";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
