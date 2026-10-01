// Typed wrappers around the Event Radar RPCs (supabase/migrations/20261002_event_radar.sql).
import type { SupabaseClient } from "@supabase/supabase-js";

export interface RadarSettings {
  radar_on: boolean;
  visible: boolean;
  show_distance: boolean;
  show_profile: boolean;
}

export interface RadarEvent {
  id: string;
  name: string;
  venue: string | null;
  starts_at: string | null;
  ends_at: string | null;
  join_code: string | null;
  source: "listed" | "user";
  external_id: string | null;
  is_owner: boolean;
  attendee_count?: number;
  settings?: RadarSettings;
}

export interface PublicProfile {
  user_id: string;
  name: string;
  title: string | null;
  company: string | null;
  avatar: string | null;
  show_distance: boolean;
}

export interface ResolvedToken extends PublicProfile {
  token: string;
  expires_at: string;
}

export interface IncomingRequest {
  id: string;
  from_user: string;
  name: string;
  title: string | null;
  company: string | null;
  avatar: string | null;
  created_at: string;
}

export type RequestStatus = "pending" | "accepted" | "declined";

const FRIENDLY: Record<string, string> = {
  invalid_code: "That event code doesn't exist. Check it and try again.",
  too_many_attempts: "Too many wrong codes today. Try again tomorrow.",
  not_a_member: "You're not part of this event.",
  radar_off: "Turn Radar on to see people nearby.",
  not_authenticated: "Please sign in again.",
  cannot_connect_to_self: "That's you!",
  request_not_found: "This request is no longer available.",
};

export class RadarError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

function toRadarError(err: { message?: string } | null | undefined): RadarError {
  const raw = err?.message || "unknown";
  const code = Object.keys(FRIENDLY).find((k) => raw.includes(k)) || "unknown";
  return new RadarError(code, FRIENDLY[code] || "Something went wrong. Please try again.");
}

async function call<T>(supabase: SupabaseClient, fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw toRadarError(error);
  if (data && typeof data === "object" && "error" in data && typeof (data as any).error === "string") {
    throw toRadarError({ message: (data as any).error });
  }
  return data as T;
}

export function createRadarApi(supabase: SupabaseClient) {
  return {
    myEvents: () => call<RadarEvent[]>(supabase, "my_events"),
    createEvent: (name: string, venue?: string, startsAt?: string | null, endsAt?: string | null) =>
      call<RadarEvent>(supabase, "create_event", { p_name: name, p_venue: venue || null, p_starts_at: startsAt || null, p_ends_at: endsAt || null }),
    joinByCode: (code: string) => call<RadarEvent>(supabase, "join_event_by_code", { p_code: code }),
    joinListed: (externalId: string, name: string, venue?: string | null, startsAt?: string | null) =>
      call<RadarEvent>(supabase, "join_listed_event", { p_external_id: externalId, p_name: name, p_venue: venue || null, p_starts_at: startsAt || null }),
    leave: (eventId: string) => call<void>(supabase, "leave_event", { p_event_id: eventId }),
    updateSettings: (eventId: string, s: RadarSettings) =>
      call<RadarSettings>(supabase, "update_radar_settings", {
        p_event_id: eventId,
        p_radar_on: s.radar_on,
        p_visible: s.visible,
        p_show_distance: s.show_distance,
        p_show_profile: s.show_profile,
      }),
    issueToken: (eventId: string) => call<{ token: string | null; expires_at: string }>(supabase, "issue_radar_token", { p_event_id: eventId }),
    resolveTokens: (eventId: string, tokens: string[]) =>
      call<{ people: ResolvedToken[]; hidden_count: number }>(supabase, "resolve_radar_tokens", { p_event_id: eventId, p_tokens: tokens.slice(0, 64) }),
    listAttendees: (eventId: string) =>
      call<{ people: PublicProfile[]; hidden_count: number }>(supabase, "list_event_attendees", { p_event_id: eventId }),
    sendRequest: (eventId: string, toUser: string) => call<{ id: string; status: RequestStatus }>(supabase, "send_connection_request", { p_event_id: eventId, p_to_user: toUser }),
    myRequests: (eventId: string) =>
      call<{ incoming: IncomingRequest[]; outgoing: { id: string; to_user: string; status: RequestStatus }[] }>(supabase, "my_connection_requests", { p_event_id: eventId }),
    respond: (requestId: string, accept: boolean) => call<{ status: RequestStatus }>(supabase, "respond_connection_request", { p_request_id: requestId, p_accept: accept }),
  };
}

export type RadarApi = ReturnType<typeof createRadarApi>;
