// Client for the server's prospect research + drafting endpoints (api/prospect.js).
import type { SupabaseClient } from "@supabase/supabase-js";

export type FactStatus = "verified" | "unverified" | "inferred";
export interface Fact {
  text: string;
  source: string | null;
  evidence?: string;
  status: FactStatus;
}
export interface Source {
  id: string;
  kind: string;
  url: string | null;
  title: string;
}
export interface Brief {
  company: {
    name: string | null;
    website?: string | null;
    industry?: Fact | null;
    business_model?: Fact | null;
    offerings: Fact[];
    audience: Fact[];
    initiatives: Fact[];
    positioning: Fact[];
    locations: Fact[];
  };
  person: { name?: string; role?: string | null; role_context: Fact[] };
  signals: Fact[];
  potential_needs: { text: string; status: "inferred"; based_on: string[] }[];
}
export interface Research {
  id: string;
  contact_id: string;
  domain: string | null;
  sources: Source[];
  brief: Brief;
  limitations: string[];
  created_at: string;
}
export interface Draft {
  option: "A" | "B" | "C";
  subjects: string[];
  body: string;
  used: { claim: string; source: string }[];
  checked: boolean;
  revised?: boolean;
  warnings: string[];
  words: number;
}
export interface DraftInput {
  contactId: string;
  researchId?: string | null;
  manualContext: string;
  valueProps: string[];
  customValue: string;
  tone: string;
  emailType: string;
  options?: ("A" | "B" | "C")[];
  refine?: { kind: string; subject: string; body: string };
}

export const VALUE_OPTIONS = ["Lead generation", "Digital marketing", "Website development", "CRM implementation", "Performance marketing", "Automation", "Video production", "Branding", "Software development", "Consulting", "Partnership", "Distribution", "Recruitment"];
export const TONES = ["Professional", "Friendly", "Conversational", "Executive", "Direct", "Partnership-focused"];
export const EMAIL_TYPES = ["Networking follow-up", "Sales outreach", "Partnership", "Introduction", "Collaboration", "Meeting follow-up", "Follow-up", "Custom"];
export const REFINEMENTS: { kind: string; label: string }[] = [
  { kind: "shorter", label: "Shorter" },
  { kind: "natural", label: "More natural" },
  { kind: "professional", label: "More professional" },
  { kind: "warmer", label: "Warmer" },
  { kind: "direct", label: "More direct" },
  { kind: "cta", label: "Better CTA" },
  { kind: "less_sales", label: "Less salesy" },
  { kind: "more_context", label: "More context" },
  { kind: "less_personal", label: "Less personalization" },
];
export const OPTION_LABELS: Record<string, string> = { A: "Personal follow-up", B: "Research-based", C: "Value proposition" };

async function post<T>(supabase: SupabaseClient, url: string, body: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your session has expired. Please sign in again.");
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  } catch {
    throw new Error("Couldn't reach NetworQ. Check your connection.");
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json as T;
}

export function createProspectApi(supabase: SupabaseClient, base: string) {
  return {
    research: (contactId: string, edits: Record<string, string>) =>
      post<{ research: Research; contact: Record<string, any> }>(supabase, `${base}/api/prospect/research`, { contactId, edits }),
    draft: (input: DraftInput) => post<{ drafts: Draft[]; tone: string; emailType: string }>(supabase, `${base}/api/prospect/draft`, input),
    autofillOrganization: (website: string) => post<{ profile: Record<string, any>; limitations: string[] }>(supabase, `${base}/api/organization/autofill`, { website }),
  };
}

export type ProspectApi = ReturnType<typeof createProspectApi>;

// Human label for a source id used in a draft
export function sourceLabel(id: string, sources: Source[]): string {
  if (id === "USER") return "Your notes";
  if (id === "CRM") return "Card details";
  if (id === "ORG") return "Your organization";
  const s = sources.find((x) => x.id === id);
  if (!s) return id;
  const kind = s.kind.replace("_", " ");
  return kind === "homepage" ? "Company website" : `${kind[0].toUpperCase()}${kind.slice(1)} page`;
}
