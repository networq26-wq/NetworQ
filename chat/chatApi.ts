import type { SupabaseClient, RealtimeChannel } from "@supabase/supabase-js";

export interface ChatMessage {
  id: string;
  chat_id?: string | null;
  event_id?: string | null;
  sender_id: string;
  recipient_id?: string | null;
  content: string;
  media_url?: string | null;
  status: "sent" | "delivered" | "read";
  read_at?: string | null;
  created_at: string;
}

export function createChatApi(supabase: SupabaseClient) {
  return {
    // Only works for people you're connected with (and haven't blocked) — enforced by the database
    async getOrCreateDirectChat(otherUserId: string): Promise<string> {
      const { data, error } = await supabase.rpc("get_or_create_direct_chat", { p_other_user_id: otherUserId });
      if (error) throw new Error(friendlyChatError(error.message));
      return data as string;
    },

    async loadMessages(chatId: string | null, eventId: string | null = null, limit = 60): Promise<ChatMessage[]> {
      let query = supabase.from("chat_messages").select("*").order("created_at", { ascending: true }).limit(limit);
      if (chatId) {
        query = query.eq("chat_id", chatId);
      } else if (eventId) {
        query = query.eq("event_id", eventId);
      } else {
        return [];
      }
      const { data, error } = await query;
      if (error) {
        console.warn("Error loading messages:", error.message);
        return [];
      }
      return (data || []) as ChatMessage[];
    },

    // The single way to send: send_chat_message validates membership, blocks, length and rate
    async sendMessage(opts: { recipientId?: string; chatId?: string; eventId?: string; content: string; mediaUrl?: string }): Promise<ChatMessage> {
      const { data, error } = await supabase.rpc("send_chat_message", {
        p_recipient_id: opts.recipientId || null,
        p_event_id: opts.recipientId ? null : opts.eventId || null,
        p_content: opts.content,
        p_media_url: opts.mediaUrl || null,
      });
      if (error) throw new Error(friendlyChatError(error.message));
      return data as ChatMessage;
    },

    async markRead(chatId: string): Promise<void> {
      if (!chatId) return;
      await supabase.rpc("mark_chat_read", { p_chat_id: chatId });
    },

    async myChats(): Promise<{ chat_id: string; other_user: string; name: string; avatar: string | null; last_message_at: string; last_message: string | null; unread: number }[]> {
      const { data, error } = await supabase.rpc("my_direct_chats");
      if (error) throw new Error(friendlyChatError(error.message));
      return (data as any[]) || [];
    },

    subscribeToChat(
      chatId: string | null,
      eventId: string | null,
      onMessage: (msg: ChatMessage) => void,
      onTyping?: (userId: string, isTyping: boolean) => void
    ): RealtimeChannel {
      // 1:1 chats use a private channel (only the two members may join); event rooms stay public
      // but carry no message content — messages arrive via postgres_changes, which applies RLS
      const channel = chatId
        ? supabase.channel(`chat:${chatId}`, { config: { private: true } })
        : supabase.channel(`event_chat:${eventId}`);

      channel
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "chat_messages",
            filter: chatId ? `chat_id=eq.${chatId}` : `event_id=eq.${eventId}`,
          },
          (payload) => {
            onMessage(payload.new as ChatMessage);
          }
        )
        .on("broadcast", { event: "typing" }, (payload) => {
          if (onTyping && payload.payload) {
            onTyping(payload.payload.userId, payload.payload.isTyping);
          }
        })
        .subscribe();

      return channel;
    },

    broadcastTyping(channel: RealtimeChannel, userId: string, isTyping: boolean) {
      channel.send({
        type: "broadcast",
        event: "typing",
        payload: { userId, isTyping },
      });
    },
  };
}

function friendlyChatError(raw: string): string {
  if (/not_connected/.test(raw)) return "You can message people once you're connected.";
  if (/unavailable/.test(raw)) return "This person isn't available.";
  if (/rate_limited/.test(raw)) return "You're sending messages too quickly. Wait a moment.";
  if (/message_too_long/.test(raw)) return "That message is too long (4,000 characters max).";
  if (/empty_message/.test(raw)) return "Type a message first.";
  if (/not_a_member|invalid_event/.test(raw)) return "Join this event to chat in its room.";
  return "Couldn't send. Check your connection and try again.";
}
