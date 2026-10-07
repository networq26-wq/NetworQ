import React, { useState, useEffect, useRef } from "react";
import { I } from "../ui/icons";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createChatApi, type ChatMessage } from "./chatApi";
import { placeCall } from "../calls/CallLayer";

export function ChatModal({
  open,
  onClose,
  supabase,
  currentUser,
  partner,
  eventId,
  eventName,
  isDark,
  showToast,
}: {
  open: boolean;
  onClose: () => void;
  supabase: SupabaseClient;
  currentUser: any;
  partner?: {
    id: string;
    name: string;
    avatar_url?: string | null;
    role?: string | null;
    company?: string | null;
  } | null;
  eventId?: string | null;
  eventName?: string | null;
  isDark: boolean;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const [chatId, setChatId] = useState<string | null>(null);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  const chatApi = useRef(createChatApi(supabase)).current;
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<any>(null);
  const channelRef = useRef<any>(null);

  // Initialize Chat & Load History
  useEffect(() => {
    if (!open) return;
    let isMounted = true;

    async function init() {
      try {
        let resolvedChatId: string | null = null;
        if (partner?.id) {
          resolvedChatId = await chatApi.getOrCreateDirectChat(partner.id);
          if (isMounted) setChatId(resolvedChatId);
        }

        const history = await chatApi.loadMessages(resolvedChatId, eventId || null);
        if (isMounted) {
          setMessages(history);
          setHistoryLoaded(true);
          if (resolvedChatId) {
            chatApi.markRead(resolvedChatId).catch(() => {});
          }
        }

        // Subscribe to Realtime messages & typing
        const channel = chatApi.subscribeToChat(
          resolvedChatId,
          eventId || null,
          (newMsg) => {
            if (!isMounted) return;
            setMessages((prev) => {
              if (prev.some((m) => m.id === newMsg.id)) return prev;
              return [...prev, newMsg];
            });
            if (resolvedChatId && newMsg.recipient_id === currentUser?.id) {
              chatApi.markRead(resolvedChatId).catch(() => {});
            }
          },
          (typingUserId, isTyping) => {
            if (!isMounted) return;
            if (partner && typingUserId === partner.id) {
              setPartnerTyping(isTyping);
            }
          }
        );
        channelRef.current = channel;

      } catch (err: any) {
        if (isMounted) setHistoryLoaded(true);
        console.warn("Chat init error:", err);
      }
    }

    init();

    return () => {
      isMounted = false;
      channelRef.current?.unsubscribe();
    };
  }, [open, partner?.id, eventId, currentUser?.id]);

  // Scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, partnerTyping]);

  if (!open) return null;

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);
    if (channelRef.current && currentUser?.id) {
      chatApi.broadcastTyping(channelRef.current, currentUser.id, true);
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        chatApi.broadcastTyping(channelRef.current, currentUser.id, false);
      }, 1500);
    }
  };

  // 📎 photos & files (private chats): upload to the chat's private folder, then send with any typed caption
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const sendAttachment = async (file: File) => {
    if (!partner?.id || !chatId || sending || uploading) return;
    const caption = inputText.trim();
    setUploading(file.type.startsWith("image/") ? "Sending photo…" : `Sending ${file.name}…`);
    try {
      const attachment = await chatApi.uploadAttachment(chatId, file);
      const sent = await chatApi.sendMessage({ chatId, recipientId: partner.id, content: caption, attachment });
      setInputText("");
      setMessages((prev) => (prev.some((m) => m.id === sent.id) ? prev : [...prev, sent]));
    } catch (err: any) {
      showToast(err.message || "Couldn't send the file.", "error");
    } finally {
      setUploading(null);
    }
  };

  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputText).trim();
    if (!text || sending) return;

    try {
      setSending(true);
      setInputText("");

      if (channelRef.current && currentUser?.id) {
        chatApi.broadcastTyping(channelRef.current, currentUser.id, false);
      }

      // Optimistic message
      const tempId = `temp-${Date.now()}`;
      const optimisticMsg: ChatMessage = {
        id: tempId,
        chat_id: chatId,
        event_id: eventId || null,
        sender_id: currentUser?.id,
        recipient_id: partner?.id || null,
        content: text,
        status: "sent",
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, optimisticMsg]);

      const sent = await chatApi.sendMessage({
        chatId: chatId || undefined,
        recipientId: partner?.id,
        eventId: eventId || undefined,
        content: text,
      });

      setMessages((prev) => prev.map((m) => (m.id === tempId ? sent : m)));
    } catch (err: any) {
      console.warn("Send message error:", err);
      showToast(err.message || "Failed to send message", "error");
    } finally {
      setSending(false);
    }
  };

  const title = partner ? partner.name : eventName ? `Room: ${eventName}` : "Chat";
  const subtitle = partner
    ? [partner.role, partner.company].filter(Boolean).join(" · ") || "Connected via NetworQ"
    : "Live Event Chat Room";

  const QUICK_PROMPTS = [
    "Great meeting you!",
    "Would you be up for a coffee this week?",
    "Open to a quick call?",
  ];

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 900,
        background: "rgba(0, 0, 0, 0.65)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "env(safe-area-inset-top, 16px) 16px env(safe-area-inset-bottom, 16px)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 480,
          height: "min(680px, calc(100dvh - 32px))",
          background: isDark ? "#121217" : "#FFFFFF",
          borderRadius: 24,
          border: `1px solid ${isDark ? "rgba(255, 255, 255, 0.12)" : "#E5E5EA"}`,
          boxShadow: "0 24px 48px rgba(0, 0, 0, 0.4)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "14px 18px",
            borderBottom: `1px solid ${isDark ? "rgba(255, 255, 255, 0.08)" : "#E5E5EA"}`,
            background: isDark ? "rgba(255, 255, 255, 0.02)" : "#F9FAFB",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          {partner?.avatar_url ? (
            <img
              src={partner.avatar_url}
              alt={title}
              style={{ width: 44, height: 44, borderRadius: 22, objectFit: "cover" }}
            />
          ) : (
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                background: "linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%)",
                color: "#FFFFFF",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 700,
                fontSize: 16,
              }}
            >
              {(title[0] || "C").toUpperCase()}
            </div>
          )}

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontWeight: 700, fontSize: 16, color: isDark ? "#FFFFFF" : "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {title}
              </span>
            </div>
            <div style={{ fontSize: 12, color: isDark ? "#9CA3AF" : "#6B7280", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {subtitle}
            </div>
          </div>

          {/* Voice & video calls ring the other person anywhere in the app (and by push) */}
          {partner && (
            <div style={{ display: "flex", gap: 6 }}>
              {(["audio", "video"] as const).map((kind) => (
                <button
                  key={kind}
                  onClick={() => placeCall({ id: partner.id, name: partner.name || "NetworQ member", avatar_url: partner.avatar_url || null }, kind)}
                  aria-label={kind === "audio" ? `Call ${partner.name}` : `Video call ${partner.name}`}
                  title={kind === "audio" ? "Voice call" : "Video call"}
                  className="btn-press"
                  style={{ width: 40, height: 40, borderRadius: 20, border: "none", background: isDark ? "rgba(124, 58, 237, 0.2)" : "rgba(124, 58, 237, 0.1)", color: isDark ? "#C4B5FD" : "#7C3AED", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
                >
                  {kind === "audio" ? (
                    <I.Phone size={18} />
                  ) : (
                    <svg width={19} height={19} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="m22 8-6 4 6 4V8Z" />
                      <rect x="2" y="6" width="14" height="12" rx="2" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}

          <button
            onClick={onClose}
            aria-label="Close chat"
            style={{
              background: "none",
              border: "none",
              fontSize: 20,
              color: isDark ? "#9CA3AF" : "#6B7280",
              cursor: "pointer",
              padding: 4,
            }}
          >
            <I.X size={18} />
          </button>
        </div>

        {/* Message Feed */}
        <div
          style={{
            flex: 1,
            padding: "16px 18px",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {!historyLoaded ? (
            <div role="status" aria-label="Loading messages" style={{ display: "flex", flexDirection: "column", gap: 10, padding: "8px 0" }}>
              {[60, 42, 70].map((w, i) => (
                <span key={i} className="nq-skeleton" style={{ alignSelf: i % 2 ? "flex-end" : "flex-start", width: `${w}%`, height: 38, borderRadius: 18 }} />
              ))}
            </div>
          ) : messages.length === 0 ? (
            <div style={{ textAlign: "center", margin: "auto", padding: "20px", color: isDark ? "#6B7280" : "#9CA3AF" }}>
              <div style={{ width: 56, height: 56, borderRadius: 28, margin: "0 auto 10px", display: "flex", alignItems: "center", justifyContent: "center", background: isDark ? "rgba(167,139,250,0.14)" : "rgba(124,58,237,0.08)", color: "#7C3AED" }}><I.Mail size={26} /></div>
              <div style={{ fontWeight: 600, fontSize: 14, color: isDark ? "#E5E7EB" : "#374151" }}>
                Direct Connection Active
              </div>
              <p style={{ fontSize: 12, maxWidth: 280, margin: "6px auto 14px", lineHeight: 1.4 }}>
                Send a message, or start a voice or video call.
              </p>
            </div>
          ) : (
            messages.map((m) => {
              const isMine = m.sender_id === currentUser?.id;
              return (
                <div
                  key={m.id}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: isMine ? "flex-end" : "flex-start",
                  }}
                >
                  <div
                    style={{
                      maxWidth: "80%",
                      padding: "10px 14px",
                      borderRadius: 18,
                      borderBottomRightRadius: isMine ? 4 : 18,
                      borderBottomLeftRadius: isMine ? 18 : 4,
                      background: isMine
                        ? "linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%)"
                        : isDark
                        ? "#1F1F24"
                        : "#F3F4F6",
                      color: isMine ? "#FFFFFF" : isDark ? "#F3F4F6" : "#111827",
                      fontSize: 14,
                      lineHeight: 1.45,
                      wordBreak: "break-word",
                      boxShadow: isMine ? "0 2px 8px rgba(124, 58, 237, 0.25)" : "none",
                    }}
                  >
                    {m.attachment_path && <AttachmentView api={chatApi} m={m} mine={isMine} isDark={isDark} />}
                    {m.content}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "flex-end",
                        gap: 4,
                        fontSize: 10,
                        marginTop: 4,
                        opacity: isMine ? 0.8 : 0.6,
                      }}
                    >
                      <span>
                        {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      {isMine && (
                        <span aria-label={m.status === "read" ? "Read" : "Sent"} style={{ display: "inline-flex" }}><I.Check size={12} strokeWidth={2.4} />{m.status === "read" && <I.Check size={12} strokeWidth={2.4} style={{ marginLeft: -7 }} />}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}

          {partnerTyping && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, color: isDark ? "#A78BFA" : "#7C3AED", fontSize: 12, fontStyle: "italic" }}>
              <span>{partner?.name || "Peer"} is typing</span>
              <span style={{ letterSpacing: 2 }}>...</span>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Quick Prompts Bar */}
        <div
          style={{
            display: "flex",
            gap: 6,
            padding: "8px 14px",
            overflowX: "auto",
            borderTop: `1px solid ${isDark ? "rgba(255, 255, 255, 0.05)" : "#F3F4F6"}`,
            background: isDark ? "rgba(0, 0, 0, 0.2)" : "#FAFAFA",
          }}
        >
          {QUICK_PROMPTS.map((p, i) => (
            <button
              key={i}
              onClick={() => handleSendMessage(p)}
              style={{
                whiteSpace: "nowrap",
                padding: "4px 10px",
                borderRadius: 999,
                border: `1px solid ${isDark ? "rgba(255, 255, 255, 0.1)" : "#E5E5EA"}`,
                background: isDark ? "rgba(255, 255, 255, 0.04)" : "#FFFFFF",
                color: isDark ? "#D1D5DB" : "#4B5563",
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {p}
            </button>
          ))}
        </div>

        {uploading && (
          <div role="status" style={{ padding: "8px 16px", fontSize: 13, color: isDark ? "#C4B5FD" : "#7C3AED", display: "flex", alignItems: "center", gap: 8 }}>
            <span className="nq-spin" style={{ width: 14, height: 14, borderRadius: 7, border: "2px solid rgba(124,58,237,0.3)", borderTopColor: "#7C3AED" }} />
            {uploading}
          </div>
        )}

        {/* Input Bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          style={{
            padding: "12px 14px",
            borderTop: `1px solid ${isDark ? "rgba(255, 255, 255, 0.08)" : "#E5E5EA"}`,
            background: isDark ? "#121217" : "#FFFFFF",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          {partner && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                hidden
                accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
                aria-label="Attach a photo or file"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) sendAttachment(f);
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={!chatId || !!uploading}
                aria-label="Attach a photo or file"
                title="Photo or file"
                style={{ width: 40, height: 40, minWidth: 40, borderRadius: 20, border: "none", background: isDark ? "rgba(255,255,255,0.08)" : "#F3F4F6", color: isDark ? "#C4B5FD" : "#7C3AED", display: "flex", alignItems: "center", justifyContent: "center", cursor: chatId && !uploading ? "pointer" : "default", opacity: chatId && !uploading ? 1 : 0.5 }}
              >
                <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
              </button>
            </>
          )}
          <input
            type="text"
            value={inputText}
            onChange={handleInputChange}
            placeholder={`Message ${title.split(" ")[0]}…`}
            style={{
              flex: 1,
              padding: "10px 14px",
              borderRadius: 14,
              border: `1px solid ${isDark ? "rgba(255, 255, 255, 0.12)" : "#D1D5DB"}`,
              background: isDark ? "rgba(255, 255, 255, 0.05)" : "#F9FAFB",
              color: isDark ? "#FFFFFF" : "#111827",
              fontSize: 14,
              outline: "none",
            }}
          />
          <button
            type="submit"
            disabled={!inputText.trim() || sending}
            style={{
              padding: "10px 18px",
              borderRadius: 14,
              border: "none",
              background: "#7C3AED",
              color: "#FFFFFF",
              fontSize: 14,
              fontWeight: 700,
              cursor: !inputText.trim() || sending ? "default" : "pointer",
              opacity: !inputText.trim() || sending ? 0.5 : 1,
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}

// A photo (preview, tap for full size) or a file card (icon, name, size, tap to open). Links are short-lived.
function AttachmentView({ api, m, mine, isDark }: { api: ReturnType<typeof createChatApi>; m: ChatMessage; mine: boolean; isDark: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const isImage = (m.attachment_type || "").startsWith("image/");
  useEffect(() => {
    let alive = true;
    if (isImage && m.attachment_path) api.fileUrl(m.attachment_path).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [api, m.attachment_path, isImage]);
  const size = m.attachment_size ? (m.attachment_size > 1048576 ? `${(m.attachment_size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(m.attachment_size / 1024))} KB`) : "";
  const open = async () => {
    const u = await api.fileUrl(m.attachment_path!, isImage ? undefined : m.attachment_name || "file");
    if (u) window.open(u, "_blank", "noopener");
  };
  if (isImage) {
    return (
      <>
        <button onClick={() => setFull(true)} aria-label="Open photo" style={{ all: "unset", cursor: "pointer", display: "block", margin: m.content ? "0 0 8px" : 0 }}>
          {url ? (
            <img src={url} alt={m.attachment_name || "Photo"} style={{ display: "block", maxWidth: 240, maxHeight: 300, width: "100%", borderRadius: 12, objectFit: "cover" }} />
          ) : (
            <span className="nq-skeleton" style={{ display: "block", width: 200, height: 150, borderRadius: 12 }} />
          )}
        </button>
        {full && url && (
          <div role="dialog" aria-modal="true" aria-label="Photo" onClick={() => setFull(false)} style={{ position: "fixed", inset: 0, zIndex: 10001, background: "rgba(0,0,0,0.92)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
            <img src={url} alt={m.attachment_name || "Photo"} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 8 }} />
            <button aria-label="Close" onClick={() => setFull(false)} style={{ position: "absolute", top: "calc(var(--safe-top, 0px) + 16px)", right: 16, width: 40, height: 40, borderRadius: 20, border: "none", background: "rgba(255,255,255,0.18)", color: "#FFF", fontSize: 20, cursor: "pointer" }}>
              ×
            </button>
          </div>
        )}
      </>
    );
  }
  const ext = (m.attachment_name || "").split(".").pop()?.toUpperCase().slice(0, 4) || "FILE";
  return (
    <button onClick={open} aria-label={`Open ${m.attachment_name || "file"}`} style={{ all: "unset", boxSizing: "border-box", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, minWidth: 200, maxWidth: 260, padding: 10, margin: m.content ? "0 0 8px" : 0, borderRadius: 12, background: mine ? "rgba(255,255,255,0.16)" : isDark ? "rgba(255,255,255,0.06)" : "#FFFFFF" }}>
      <span aria-hidden style={{ width: 40, height: 40, borderRadius: 10, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, background: mine ? "rgba(255,255,255,0.22)" : "rgba(124,58,237,0.12)", color: mine ? "#FFF" : "#7C3AED" }}>{ext}</span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.attachment_name || "File"}</span>
        <span style={{ display: "block", fontSize: 12, opacity: 0.75 }}>{size ? `${size} · ` : ""}Tap to open</span>
      </span>
    </button>
  );
}
