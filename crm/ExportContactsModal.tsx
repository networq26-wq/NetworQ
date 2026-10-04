import React, { useState } from "react";

export function ExportContactsModal({
  open,
  onClose,
  contacts,
  isDark,
  showToast,
}: {
  open: boolean;
  onClose: () => void;
  contacts: any[];
  isDark: boolean;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}) {
  const [exporting, setExporting] = useState(false);

  if (!open) return null;

  const handleExportCsv = (format: "universal" | "hubspot" | "google") => {
    try {
      setExporting(true);
      let headers = ["Name", "Title", "Company", "Email", "Phone", "Location", "Tags", "Notes", "Date Met"];
      if (format === "google") {
        headers = ["First Name", "Last Name", "Job Title", "Company", "E-mail 1 - Value", "Phone 1 - Value", "Notes"];
      } else if (format === "hubspot") {
        headers = ["First Name", "Last Name", "Job Title", "Company Name", "Email", "Phone Number", "Lead Status"];
      }

      const rows = contacts.map((c) => {
        const parts = (c.name || "Unknown").split(" ");
        const first = parts[0] || "";
        const last = parts.slice(1).join(" ") || "";
        if (format === "google") {
          return [first, last, c.role || "", c.company || "", c.email || "", c.phone || "", c.notes || ""];
        }
        if (format === "hubspot") {
          return [first, last, c.role || "", c.company || "", c.email || "", c.phone || "", "New"];
        }
        return [
          c.name || "",
          c.role || "",
          c.company || "",
          c.email || "",
          c.phone || "",
          c.location || "",
          (c.tags || []).join("; "),
          (c.notes || "").replace(/\n/g, " "),
          c.created_at ? new Date(c.created_at).toLocaleDateString() : "",
        ];
      });

      const csvContent =
        "data:text/csv;charset=utf-8," +
        [headers.map((h) => `"${h}"`).join(","), ...rows.map((r) => r.map((cell) => `"${String(cell || "").replace(/"/g, '""')}"`).join(","))].join("\n");

      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", `NetworQ_Contacts_${format}_${new Date().toISOString().split("T")[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast(`Exported ${contacts.length} contacts to CSV (${format.toUpperCase()})!`, "success");
    } catch (err: any) {
      showToast("Export failed: " + err.message, "error");
    } finally {
      setExporting(false);
    }
  };

  const handleExportVcf = () => {
    try {
      setExporting(true);
      const vCards = contacts
        .map((c) => {
          const parts = (c.name || "").split(" ");
          const first = parts[0] || "";
          const last = parts.slice(1).join(" ") || "";
          return [
            "BEGIN:VCARD",
            "VERSION:3.0",
            `FN:${c.name || "Contact"}`,
            `N:${last};${first};;;`,
            c.company ? `ORG:${c.company}` : "",
            c.role ? `TITLE:${c.role}` : "",
            c.email ? `EMAIL;TYPE=INTERNET,WORK:${c.email}` : "",
            c.phone ? `TEL;TYPE=CELL:${c.phone}` : "",
            c.notes ? `NOTE:${c.notes}` : "",
            "END:VCARD",
          ]
            .filter(Boolean)
            .join("\r\n");
        })
        .join("\r\n\r\n");

      const blob = new Blob([vCards], { type: "text/vcard;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `NetworQ_All_Contacts_${new Date().toISOString().split("T")[0]}.vcf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showToast(`Exported ${contacts.length} contacts to vCard (.vcf)!`, "success");
    } catch (err: any) {
      showToast("vCard export failed: " + err.message, "error");
    } finally {
      setExporting(false);
    }
  };

  const bg = isDark ? "#0D111A" : "#FFFFFF";
  const cardBg = isDark ? "#161B26" : "#F8FAFC";
  const border = isDark ? "rgba(255,255,255,0.1)" : "#E2E8F0";
  const text = isDark ? "#F8FAFC" : "#0F172A";
  const textMuted = isDark ? "#94A3B8" : "#64748B";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0,0,0,0.75)",
        backdropFilter: "blur(14px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "max(16px, calc(var(--safe-top, 0px) + 12px)) max(16px, calc(var(--safe-right, 0px) + 12px)) max(16px, calc(var(--safe-bottom, 0px) + 12px)) max(16px, calc(var(--safe-left, 0px) + 12px))",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 520,
          background: bg,
          color: text,
          borderRadius: 24,
          border: `1px solid ${border}`,
          padding: 24,
          boxShadow: "0 25px 60px -12px rgba(0,0,0,0.6)",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>Export Contacts</div>
            <div style={{ fontSize: 12, color: textMuted }}>Export {contacts.length} collected professionals</div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              border: "none",
              background: isDark ? "rgba(255,255,255,0.08)" : "#E2E8F0",
              color: text,
              cursor: "pointer",
              fontSize: 16,
            }}
          >
            ×
          </button>
        </div>

        {/* Options */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button
            onClick={() => handleExportCsv("universal")}
            disabled={exporting}
            style={{
              padding: "16px",
              borderRadius: 16,
              border: `1px solid ${border}`,
              background: cardBg,
              color: text,
              display: "flex",
              alignItems: "center",
              gap: 14,
              cursor: "pointer",
              textAlign: "left",
              transition: "transform 0.15s ease",
            }}
          >
            <span style={{ fontSize: 26 }}>📊</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>Universal CSV (Excel / Notion / Sheets)</div>
              <div style={{ fontSize: 12, color: textMuted }}>Standard spreadsheet with all tags, notes, and metadata</div>
            </div>
            <span style={{ fontSize: 18, color: "#7C3AED" }}>→</span>
          </button>

          <button
            onClick={handleExportVcf}
            disabled={exporting}
            style={{
              padding: "16px",
              borderRadius: 16,
              border: `1px solid ${border}`,
              background: cardBg,
              color: text,
              display: "flex",
              alignItems: "center",
              gap: 14,
              cursor: "pointer",
              textAlign: "left",
              transition: "transform 0.15s ease",
            }}
          >
            <span style={{ fontSize: 26 }}>📱</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>Apple & Android Contacts (vCard .vcf)</div>
              <div style={{ fontSize: 12, color: textMuted }}>Import directly into iPhone / Android phone address book</div>
            </div>
            <span style={{ fontSize: 18, color: "#7C3AED" }}>→</span>
          </button>

          <button
            onClick={() => handleExportCsv("google")}
            disabled={exporting}
            style={{
              padding: "16px",
              borderRadius: 16,
              border: `1px solid ${border}`,
              background: cardBg,
              color: text,
              display: "flex",
              alignItems: "center",
              gap: 14,
              cursor: "pointer",
              textAlign: "left",
              transition: "transform 0.15s ease",
            }}
          >
            <span style={{ fontSize: 26 }}>🔵</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>Google Contacts CSV</div>
              <div style={{ fontSize: 12, color: textMuted }}>Pre-formatted for contacts.google.com import</div>
            </div>
            <span style={{ fontSize: 18, color: "#7C3AED" }}>→</span>
          </button>

          <button
            onClick={() => handleExportCsv("hubspot")}
            disabled={exporting}
            style={{
              padding: "16px",
              borderRadius: 16,
              border: `1px solid ${border}`,
              background: cardBg,
              color: text,
              display: "flex",
              alignItems: "center",
              gap: 14,
              cursor: "pointer",
              textAlign: "left",
              transition: "transform 0.15s ease",
            }}
          >
            <span style={{ fontSize: 26 }}>🟠</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>HubSpot & CRM CSV</div>
              <div style={{ fontSize: 12, color: textMuted }}>Headers aligned for HubSpot and Salesforce lead import</div>
            </div>
            <span style={{ fontSize: 18, color: "#7C3AED" }}>→</span>
          </button>
        </div>
      </div>
    </div>
  );
}
