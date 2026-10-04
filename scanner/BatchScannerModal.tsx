import React, { useState, useEffect, useRef } from "react";
import { I } from "../ui/icons";
import type { BatchScanItem, ScannedCardDetails } from "./scannerTypes";
import { fileToDataUrl, downscaleImage, extractStructuredCard, findDuplicateContact } from "./extractEngine";
import { haptic } from "../ui/haptics";

interface BatchScannerModalProps {
  open: boolean;
  onClose: () => void;
  initialFiles?: File[];
  isDark: boolean;
  existingContacts: any[];
  callAI: (messages: any[], systemPrompt: string, options: any) => Promise<string>;
  onSaveContact: (contactData: any, isUpdate?: boolean, existingId?: string) => Promise<void>;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}

export function BatchScannerModal({
  open,
  onClose,
  initialFiles,
  isDark,
  existingContacts,
  callAI,
  onSaveContact,
  showToast,
}: BatchScannerModalProps) {
  const [items, setItems] = useState<BatchScanItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isProcessingQueue, setIsProcessingQueue] = useState(false);
  const [selectedItem, setSelectedItem] = useState<BatchScanItem | null>(null);
  const [mergeConflict, setMergeConflict] = useState<{ item: BatchScanItem; existing: any } | null>(null);

  // Voice note state
  const [isListeningVoice, setIsListeningVoice] = useState(false);
  const [voiceNoteText, setVoiceNoteText] = useState("");
  const speechRecRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Add initial files to queue
  useEffect(() => {
    if (initialFiles && initialFiles.length > 0) {
      addFilesToQueue(initialFiles);
    }
  }, [initialFiles]);

  const addFilesToQueue = async (files: File[]) => {
    const newItems: BatchScanItem[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const previewUrl = await fileToDataUrl(file);
      newItems.push({
        id: `card_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
        file,
        previewUrl,
        status: "waiting",
        progressPercent: 0,
      });
    }
    setItems((prev) => [...prev, ...newItems]);
    if (!selectedItem && newItems.length > 0) {
      setSelectedItem(newItems[0]);
    }
  };

  // Queue runner
  useEffect(() => {
    if (isProcessingQueue) return;
    const nextItem = items.find((it) => it.status === "waiting");
    if (!nextItem) return;

    processItem(nextItem);
  }, [items, isProcessingQueue]);

  const processItem = async (item: BatchScanItem) => {
    setIsProcessingQueue(true);
    setItems((prev) =>
      prev.map((it) => (it.id === item.id ? { ...it, status: "processing", progressPercent: 20 } : it))
    );

    try {
      // 1. Downscale
      const scaled = await downscaleImage(item.previewUrl);
      setItems((prev) =>
        prev.map((it) => (it.id === item.id ? { ...it, progressPercent: 45 } : it))
      );

      // 2. Extract structured card
      const extracted = await extractStructuredCard(scaled, callAI);
      setItems((prev) =>
        prev.map((it) => (it.id === item.id ? { ...it, progressPercent: 85 } : it))
      );

      if (!extracted) {
        setItems((prev) =>
          prev.map((it) =>
            it.id === item.id
              ? { ...it, status: "failed", error: "Could not detect card details" }
              : it
          )
        );
      } else {
        // 3. Duplicate detection
        const dup = findDuplicateContact(extracted, existingContacts);
        const finalStatus = extracted.needsReviewFields.length > 0 ? "needs_review" : "complete";

        setItems((prev) =>
          prev.map((it) =>
            it.id === item.id
              ? {
                  ...it,
                  status: finalStatus,
                  progressPercent: 100,
                  extracted,
                  duplicateMatch: dup ? { id: dup.id, name: dup.name, company: dup.company, email: dup.email, phone: dup.phone } : undefined,
                }
              : it
          )
        );
        haptic();
      }
    } catch (err: any) {
      setItems((prev) =>
        prev.map((it) =>
          it.id === item.id
            ? { ...it, status: "failed", error: err.message || "Extraction failed" }
            : it
        )
      );
    } finally {
      setIsProcessingQueue(false);
    }
  };

  // Voice note speech recognition
  const toggleVoiceNote = () => {
    if (isListeningVoice) {
      speechRecRef.current?.stop();
      setIsListeningVoice(false);
      return;
    }

    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) {
      showToast("Speech recognition not supported on this device", "info");
      return;
    }

    try {
      const rec = new SpeechRec();
      rec.lang = "en-US";
      rec.interimResults = false;
      rec.onstart = () => setIsListeningVoice(true);
      rec.onresult = (ev: any) => {
        const text = ev.results?.[0]?.[0]?.transcript || "";
        if (text && selectedItem?.extracted) {
          const currentNotes = selectedItem.extracted.other.notes;
          const updatedNotes = currentNotes ? `${currentNotes}\n[Voice Note]: ${text}` : `[Voice Note]: ${text}`;
          setSelectedItem({
            ...selectedItem,
            extracted: {
              ...selectedItem.extracted,
              other: {
                ...selectedItem.extracted.other,
                notes: updatedNotes,
              },
            },
          });
          showToast("Voice note appended to contact", "success");
        }
      };
      rec.onerror = () => setIsListeningVoice(false);
      rec.onend = () => setIsListeningVoice(false);
      speechRecRef.current = rec;
      rec.start();
    } catch {
      setIsListeningVoice(false);
    }
  };

  const handleSaveSelected = async (isUpdate = false, existingId?: string) => {
    if (!selectedItem?.extracted) return;
    const c = selectedItem.extracted;
    const fullName = `${c.person.firstName} ${c.person.lastName}`.trim() || c.company.companyName || "New Contact";

    const payload = {
      name: fullName,
      title: c.person.title || null,
      company: c.company.companyName || null,
      email: c.person.email || null,
      phone: c.person.phone || null,
      website: c.other.website || c.company.domain || null,
      linkedin: c.social.linkedin || null,
      address: [c.address.street, c.address.city, c.address.state, c.address.country].filter(Boolean).join(", ") || null,
      notes: c.other.notes || null,
      image: selectedItem.previewUrl,
    };

    try {
      await onSaveContact(payload, isUpdate, existingId);
      showToast(isUpdate ? "Contact updated successfully!" : "Contact saved to CRM!", "success");
      haptic();

      // Mark this item as saved / remove from pending queue
      setItems((prev) => prev.filter((it) => it.id !== selectedItem.id));
      const remaining = items.filter((it) => it.id !== selectedItem.id);
      setSelectedItem(remaining[0] || null);
      setMergeConflict(null);
    } catch (err: any) {
      showToast(err.message || "Failed to save contact", "error");
    }
  };

  if (!open) return null;

  const total = items.length;
  const processed = items.filter((it) => it.status === "complete" || it.status === "needs_review" || it.status === "failed").length;
  const activeExtracted = selectedItem?.extracted;

  return (
    <div
      className="nq-backdrop"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0,0,0,0.75)",
        backdropFilter: "blur(12px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "max(16px, calc(var(--safe-top, 0px) + 12px)) max(16px, calc(var(--safe-right, 0px) + 12px)) max(16px, calc(var(--safe-bottom, 0px) + 12px)) max(16px, calc(var(--safe-left, 0px) + 12px))",
        boxSizing: "border-box",
      }}
    >
      <div
        className="nq-pop"
        style={{
          width: "100%",
          maxWidth: 960,
          maxHeight: "min(92dvh, calc(100dvh - var(--safe-top, 0px) - var(--safe-bottom, 0px) - 24px))",
          background: isDark ? "#121826" : "#FFFFFF",
          color: isDark ? "#F8FAFC" : "#0F172A",
          borderRadius: 24,
          border: `1px solid ${isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)"}`,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5)",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "18px 24px",
            borderBottom: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>
              Batch Card Scanner & Extraction
            </h3>
            {total > 0 && (
              <p style={{ margin: "4px 0 0", fontSize: 13, color: isDark ? "#94A3B8" : "#64748B" }}>
                Processing {processed} / {total} cards
              </p>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input
              type="file"
              ref={fileInputRef}
              multiple
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => {
                if (e.target.files) addFilesToQueue(Array.from(e.target.files));
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{
                padding: "8px 14px",
                borderRadius: 12,
                border: "none",
                background: "rgba(124,58,237,0.15)",
                color: "#A78BFA",
                fontWeight: 700,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              + Add More Files
            </button>
            <button
              onClick={onClose}
              style={{
                background: "transparent",
                border: "none",
                color: isDark ? "#94A3B8" : "#64748B",
                fontSize: 20,
                cursor: "pointer",
                padding: "4px 8px",
              }}
            >
              <I.X size={18} />
            </button>
          </div>
        </div>

        {/* Body (Left: Queue list, Right: Segregated details & actions) */}
        <div style={{ display: "flex", flex: 1, minHeight: 460, overflow: "hidden" }}>
          {/* Queue Sidebar */}
          <div
            style={{
              width: 280,
              borderRight: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"}`,
              overflowY: "auto",
              padding: 12,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {items.map((it, idx) => {
              const isSelected = selectedItem?.id === it.id;
              const statusColors: Record<string, string> = {
                waiting: "#64748B",
                processing: "#7C3AED",
                complete: "#10B981",
                needs_review: "#F59E0B",
                failed: "#EF4444",
              };
              const statusLabels: Record<string, string> = {
                waiting: "Waiting",
                processing: `${it.progressPercent}%`,
                complete: "Extracted",
                needs_review: "Needs Review",
                failed: "Failed",
              };

              return (
                <div
                  key={it.id}
                  onClick={() => setSelectedItem(it)}
                  style={{
                    padding: 8,
                    borderRadius: 14,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    background: isSelected
                      ? isDark
                        ? "rgba(124,58,237,0.25)"
                        : "rgba(124,58,237,0.1)"
                      : "transparent",
                    border: isSelected
                      ? "1.5px solid #7C3AED"
                      : `1px solid ${isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)"}`,
                  }}
                >
                  <img
                    src={it.previewUrl}
                    alt="Card"
                    style={{ width: 44, height: 44, borderRadius: 8, objectFit: "cover" }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {it.extracted?.person.firstName
                        ? `${it.extracted.person.firstName} ${it.extracted.person.lastName}`
                        : `Card #${idx + 1}`}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                      <span
                        style={{
                          display: "inline-flex", alignItems: "center", justifyContent: "center", lineHeight: 1.2, whiteSpace: "nowrap", flexShrink: 0,
                          fontSize: 10,
                          fontWeight: 700,
                          padding: "2px 6px",
                          borderRadius: 6,
                          background: `${statusColors[it.status]}22`,
                          color: statusColors[it.status],
                        }}
                      >
                        {statusLabels[it.status]}
                      </span>
                      {it.duplicateMatch && (
                        <span style={{ fontSize: 10, color: "#F59E0B", fontWeight: 700 }}>
                          Duplicate
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Details / Review Area */}
          <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
            {!selectedItem ? (
              <div style={{ textAlign: "center", padding: 60, color: isDark ? "#64748B" : "#94A3B8" }}>
                Select a card from the queue or upload cards to begin.
              </div>
            ) : selectedItem.status === "processing" ? (
              <div style={{ textAlign: "center", padding: 60 }}>
                <div style={{ marginBottom: 12, display: "flex", justifyContent: "center" }}><I.Zap size={34} color="#7C3AED" /></div>
                <div style={{ fontSize: 17, fontWeight: 700 }}>AI Extracting Business Card details…</div>
                <div style={{ fontSize: 13, color: isDark ? "#94A3B8" : "#64748B", marginTop: 4 }}>
                  Segregating Person, Company, Social, and Address fields without hallucination.
                </div>
              </div>
            ) : selectedItem.status === "failed" ? (
              <div style={{ textAlign: "center", padding: 40 }}>
                <div style={{ marginBottom: 8, display: "flex", justifyContent: "center" }}><I.Alert size={30} color="#EF4444" /></div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#EF4444" }}>{selectedItem.error}</div>
                <button
                  onClick={() => processItem(selectedItem)}
                  style={{
                    marginTop: 16,
                    padding: "8px 18px",
                    borderRadius: 12,
                    background: "#7C3AED",
                    color: "#FFF",
                    border: "none",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Retry Extraction
                </button>
              </div>
            ) : activeExtracted ? (
              <div>
                {/* Duplicate Notification Banner (Part 25 & 26) */}
                {selectedItem.duplicateMatch && (
                  <div
                    style={{
                      padding: "12px 16px",
                      borderRadius: 14,
                      background: isDark ? "rgba(245,158,11,0.15)" : "#FEF3C7",
                      border: "1px solid rgba(245,158,11,0.4)",
                      marginBottom: 18,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: "#D97706" }}>
                        <I.Alert size={15} style={{ marginRight: 6 }} />Possible duplicate contact
                      </div>
                      <div style={{ fontSize: 12, color: isDark ? "#FDE68A" : "#92400E", marginTop: 2 }}>
                        Matches existing contact: <b>{selectedItem.duplicateMatch.name}</b> ({selectedItem.duplicateMatch.company || "No company"})
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={() => handleSaveSelected(true, selectedItem.duplicateMatch?.id)}
                        style={{
                          padding: "6px 12px",
                          borderRadius: 8,
                          background: "#D97706",
                          color: "#FFF",
                          border: "none",
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        Update Existing
                      </button>
                      <button
                        onClick={() => handleSaveSelected(false)}
                        style={{
                          padding: "6px 12px",
                          borderRadius: 8,
                          background: "transparent",
                          color: isDark ? "#FCD34D" : "#B45309",
                          border: "1px solid rgba(245,158,11,0.5)",
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        Save as Separate
                      </button>
                    </div>
                  </div>
                )}

                {/* Structured Segregation Sections (Part 23 & 24) */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  {/* Person Section */}
                  <div
                    style={{
                      padding: 16,
                      borderRadius: 16,
                      background: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
                      border: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"}`,
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 800, color: "#7C3AED", textTransform: "uppercase", marginBottom: 12 }}>
                      <I.User size={15} style={{ marginRight: 6 }} />Person
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <FieldInput
                        label="First Name"
                        value={activeExtracted.person.firstName}
                        isDark={isDark}
                        onChange={(v) => updateField("person.firstName", v)}
                      />
                      <FieldInput
                        label="Last Name"
                        value={activeExtracted.person.lastName}
                        isDark={isDark}
                        onChange={(v) => updateField("person.lastName", v)}
                      />
                      <FieldInput
                        label="Job Title"
                        value={activeExtracted.person.title}
                        isDark={isDark}
                        onChange={(v) => updateField("person.title", v)}
                      />
                      <FieldInput
                        label="Email"
                        value={activeExtracted.person.email}
                        isDark={isDark}
                        isAmbiguous={activeExtracted.needsReviewFields.includes("email")}
                        onChange={(v) => updateField("person.email", v)}
                      />
                      <FieldInput
                        label="Phone"
                        value={activeExtracted.person.phone}
                        isDark={isDark}
                        isAmbiguous={activeExtracted.needsReviewFields.includes("phone")}
                        onChange={(v) => updateField("person.phone", v)}
                      />
                    </div>
                  </div>

                  {/* Company Section */}
                  <div
                    style={{
                      padding: 16,
                      borderRadius: 16,
                      background: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
                      border: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"}`,
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 800, color: "#06B6D4", textTransform: "uppercase", marginBottom: 12 }}>
                      <I.Building size={15} style={{ marginRight: 6 }} />Company
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <FieldInput
                        label="Company Name"
                        value={activeExtracted.company.companyName}
                        isDark={isDark}
                        onChange={(v) => updateField("company.companyName", v)}
                      />
                      <FieldInput
                        label="Website / Domain"
                        value={activeExtracted.company.domain || activeExtracted.other.website}
                        isDark={isDark}
                        onChange={(v) => updateField("company.domain", v)}
                      />
                      <FieldInput
                        label="Industry"
                        value={activeExtracted.company.industry}
                        isDark={isDark}
                        onChange={(v) => updateField("company.industry", v)}
                      />
                      <FieldInput
                        label="Company Phone"
                        value={activeExtracted.company.companyPhone}
                        isDark={isDark}
                        onChange={(v) => updateField("company.companyPhone", v)}
                      />
                    </div>
                  </div>

                  {/* Social & Address Section */}
                  <div
                    style={{
                      padding: 16,
                      borderRadius: 16,
                      background: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
                      border: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"}`,
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 800, color: "#10B981", textTransform: "uppercase", marginBottom: 12 }}>
                      <I.Globe size={15} style={{ marginRight: 6 }} />Social
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <FieldInput
                        label="LinkedIn"
                        value={activeExtracted.social.linkedin}
                        isDark={isDark}
                        onChange={(v) => updateField("social.linkedin", v)}
                      />
                      <FieldInput
                        label="Twitter / X"
                        value={activeExtracted.social.twitter}
                        isDark={isDark}
                        onChange={(v) => updateField("social.twitter", v)}
                      />
                      <FieldInput
                        label="Instagram"
                        value={activeExtracted.social.instagram}
                        isDark={isDark}
                        onChange={(v) => updateField("social.instagram", v)}
                      />
                    </div>
                  </div>

                  {/* Address Section */}
                  <div
                    style={{
                      padding: 16,
                      borderRadius: 16,
                      background: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
                      border: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"}`,
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 800, color: "#F59E0B", textTransform: "uppercase", marginBottom: 12 }}>
                      <I.MapPin size={15} style={{ marginRight: 6 }} />Address
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <FieldInput
                        label="Street"
                        value={activeExtracted.address.street}
                        isDark={isDark}
                        onChange={(v) => updateField("address.street", v)}
                      />
                      <FieldInput
                        label="City / State"
                        value={[activeExtracted.address.city, activeExtracted.address.state].filter(Boolean).join(", ")}
                        isDark={isDark}
                        onChange={(v) => updateField("address.city", v)}
                      />
                      <FieldInput
                        label="Country & Postal"
                        value={[activeExtracted.address.country, activeExtracted.address.postalCode].filter(Boolean).join(" ")}
                        isDark={isDark}
                        onChange={(v) => updateField("address.country", v)}
                      />
                    </div>
                  </div>
                </div>

                {/* Voice Note & CRM Notes */}
                <div
                  style={{
                    marginTop: 16,
                    padding: 16,
                    borderRadius: 16,
                    background: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
                    border: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"}`,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: "#A78BFA", textTransform: "uppercase" }}>
                      <I.Mic size={15} style={{ marginRight: 6 }} />Notes & voice memos
                    </span>
                    <button
                      onClick={toggleVoiceNote}
                      style={{
                        padding: "6px 12px",
                        borderRadius: 20,
                        border: "none",
                        background: isListeningVoice ? "#EF4444" : "#7C3AED",
                        color: "#FFF",
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      {isListeningVoice ? <><I.Dot size={12} color="#EF4444" style={{ marginRight: 6 }} />Listening…</> : <><I.Mic size={15} style={{ marginRight: 6 }} />Record voice memo</>}
                    </button>
                  </div>
                  <textarea
                    rows={3}
                    value={activeExtracted.other.notes}
                    onChange={(e) => updateField("other.notes", e.target.value)}
                    placeholder="Meeting context, conversation highlights, potential opportunity..."
                    style={{
                      width: "100%",
                      padding: 10,
                      borderRadius: 10,
                      background: isDark ? "#0B0F19" : "#FFFFFF",
                      color: isDark ? "#F8FAFC" : "#0F172A",
                      border: `1px solid ${isDark ? "rgba(255,255,255,0.12)" : "#CBD5E1"}`,
                      fontSize: 13,
                      boxSizing: "border-box",
                      resize: "vertical",
                    }}
                  />
                </div>

                {/* Bottom Action Footer */}
                <div style={{ marginTop: 24, display: "flex", justifyContent: "flex-end", gap: 12 }}>
                  <button
                    onClick={() => handleSaveSelected(false)}
                    style={{
                      padding: "12px 24px",
                      borderRadius: 14,
                      border: "none",
                      background: "#7C3AED",
                      color: "#FFFFFF",
                      fontSize: 14,
                      fontWeight: 800,
                      cursor: "pointer",
                      boxShadow: "0 4px 14px rgba(124,58,237,0.35)",
                    }}
                  >
                    <I.Check size={16} style={{ marginRight: 6 }} />Save contact
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );

  function updateField(path: string, val: string) {
    if (!selectedItem?.extracted) return;
    const parts = path.split(".");
    const ext = { ...selectedItem.extracted };
    let cur: any = ext;
    for (let i = 0; i < parts.length - 1; i++) {
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = val;
    setSelectedItem({ ...selectedItem, extracted: ext });
  }
}

function FieldInput({
  label,
  value,
  onChange,
  isDark,
  isAmbiguous,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  isDark: boolean;
  isAmbiguous?: boolean;
}) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: isDark ? "#94A3B8" : "#64748B" }}>
          {label}
        </label>
        {isAmbiguous && (
          <span style={{ fontSize: 10, color: "#F59E0B", fontWeight: 700 }}><I.Alert size={11} style={{ marginRight: 3, verticalAlign: "-1px" }} />Needs review</span>
        )}
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          padding: "8px 10px",
          borderRadius: 8,
          border: isAmbiguous
            ? "1.5px solid #F59E0B"
            : `1px solid ${isDark ? "rgba(255,255,255,0.12)" : "#CBD5E1"}`,
          background: isDark ? "#0B0F19" : "#FFFFFF",
          color: isDark ? "#F8FAFC" : "#0F172A",
          fontSize: 13,
          boxSizing: "border-box",
        }}
      />
    </div>
  );
}
