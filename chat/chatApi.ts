import type { SupabaseClient, RealtimeChannel } from "@supabase/supabase-js";

export interface ChatMessage {
  id: string;
  chat_id?: string | null;
  event_id?: string | null;
  sender_id: string;
  recipient_id?: string | null;
  content: string;
  media_url?: string | null;
  attachment_path?: string | null;
  attachment_name?: string | null;
  attachment_type?: string | null;
  attachment_size?: number | null;
  status: "sent" | "delivered" | "read";
  read_at?: string | null;
  created_at: string;
}

export type Attachment = { path: string; name: string; type: string; size: number };
const MAX_FILE = 10 * 1024 * 1024;

async function shrinkImage(file: File, maxSide = 1600): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return await new Promise((res) => canvas.toBlob((b) => res(b || file), "image/jpeg", 0.85));
  } catch {
    return file; // e.g. HEIC on browsers that can't decode it — send the original
  }
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
    async sendMessage(opts: { recipientId?: string; chatId?: string; eventId?: string; content: string; mediaUrl?: string; attachment?: Attachment | null }): Promise<ChatMessage> {
      const { data, error } = await supabase.rpc("send_chat_message", {
        p_recipient_id: opts.recipientId || null,
        p_event_id: opts.recipientId ? null : opts.eventId || null,
        p_content: opts.content,
        p_media_url: opts.mediaUrl || null,
        ...(opts.attachment
          ? { p_attachment_path: opts.attachment.path, p_attachment_name: opts.attachment.name, p_attachment_type: opts.attachment.type, p_attachment_size: opts.attachment.size }
          : {}),
      });
      if (error) throw new Error(friendlyChatError(error.message));
      return data as ChatMessage;
    },

    // Photos are shrunk before upload (fast on mobile data); files go as they are. Private bucket, chat folder.
    async uploadAttachment(chatId: string, file: File): Promise<Attachment> {
      if (file.size > MAX_FILE) throw new Error("That file is over 10 MB. Please send a smaller one.");
      const blob = /^image\/(jpeg|png|webp|heic)$/.test(file.type) && file.size > 900_000 ? await shrinkImage(file) : file;
      const type = blob === file ? file.type || "application/octet-stream" : "image/jpeg";
      const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-80) || "file";
      const name = blob === file ? file.name : file.name.replace(/\.[a-z0-9]+$/i, "") + ".jpg";
      const path = `${chatId}/${crypto.randomUUID()}-${blob === file ? safe : safe.replace(/\.[a-z0-9]+$/i, "") + ".jpg"}`;
      const { error } = await supabase.storage.from("chat-files").upload(path, blob, { contentType: type, upsert: false });
      if (error) throw new Error(/mime|type/i.test(error.message) ? "That kind of file can't be sent. Try a photo, PDF or Office document." : "Couldn't upload the file. Please try again.");
      return { path, name: name.slice(0, 200), type, size: blob.size };
    },

    // Short-lived link to view/download (only the two people in the chat can get one)
    async fileUrl(path: string, download?: string): Promise<string | null> {
      const { data, error } = await supabase.storage.from("chat-files").createSignedUrl(path, 3600, download ? { download } : undefined);
      return error ? null : data.signedUrl;
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
  if (/invalid_attachment/.test(raw)) return "That file couldn't be attached. Please try again.";
  if (/attachments_direct_only/.test(raw)) return "Files can be sent in private chats.";
  if (/attachment_too_large/.test(raw)) return "That file is over 10 MB.";
  if (/not_connected/.test(raw)) return "You can message people once you're connected.";
  if (/unavailable/.test(raw)) return "This person isn't available.";
  if (/rate_limited/.test(raw)) return "You're sending messages too quickly. Wait a moment.";
  if (/message_too_long/.test(raw)) return "That message is too long (4,000 characters max).";
  if (/empty_message/.test(raw)) return "Type a message first.";
  if (/not_a_member|invalid_event/.test(raw)) return "Join this event to chat in its room.";
  return "Couldn't send. Check your connection and try again.";
}
