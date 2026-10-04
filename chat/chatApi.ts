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
    async getOrCreateDirectChat(otherUserId: string): Promise<string> {
      const { data, error } = await supabase.rpc("get_or_create_direct_chat", {
        p_other_user_id: otherUserId,
      });
      if (error) {
        // Fallback query if RPC isn't deployed yet
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Not authenticated");
        const [u1, u2] = user.id < otherUserId ? [user.id, otherUserId] : [otherUserId, user.id];
        const { data: existing } = await supabase
          .from("direct_chats")
          .select("id")
          .eq("user1_id", u1)
          .eq("user2_id", u2)
          .maybeSingle();
        if (existing?.id) return existing.id;
        const { data: inserted, error: insErr } = await supabase
          .from("direct_chats")
          .insert({ user1_id: u1, user2_id: u2 })
          .select("id")
          .single();
        if (insErr) throw insErr;
        return inserted.id;
      }
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

    async sendMessage(opts: {
      recipientId?: string;
      chatId?: string;
      eventId?: string;
      content: string;
      mediaUrl?: string;
    }): Promise<ChatMessage> {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      let resolvedChatId = opts.chatId;
      if (!resolvedChatId && opts.recipientId) {
        resolvedChatId = await this.getOrCreateDirectChat(opts.recipientId);
      }

      const payload = {
        chat_id: resolvedChatId || null,
        event_id: opts.eventId || null,
        sender_id: user.id,
        recipient_id: opts.recipientId || null,
        content: opts.content.trim(),
        media_url: opts.mediaUrl || null,
        status: "sent",
      };

      const { data, error } = await supabase
        .from("chat_messages")
        .insert(payload)
        .select()
        .single();

      if (error) throw error;
      return data as ChatMessage;
    },

    async markRead(chatId: string): Promise<void> {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !chatId) return;
      await supabase
        .from("chat_messages")
        .update({ status: "read", read_at: new Date().toISOString() })
        .eq("chat_id", chatId)
        .eq("recipient_id", user.id)
        .neq("status", "read");
    },

    subscribeToChat(
      chatId: string | null,
      eventId: string | null,
      onMessage: (msg: ChatMessage) => void,
      onTyping?: (userId: string, isTyping: boolean) => void
    ): RealtimeChannel {
      const channelName = chatId ? `chat:${chatId}` : `event_chat:${eventId || "global"}`;
      const channel = supabase.channel(channelName);

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
