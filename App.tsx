import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "./supabase";
import emailjs from "@emailjs/browser";

const CLAUDE_PROXY = "/api/claude";

async function callClaude(messages, system, max_tokens = 1000) {
  const res = await fetch(CLAUDE_PROXY, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ max_tokens, system, messages }),
  });
  const d = await res.json();
  if (!res.ok || d.type === "error") throw new Error(d.error?.message || `API error ${res.status}`);
  return d.content?.[0]?.text || "";
}

function qrUrl(data) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(data)}`;
}

function genMeetLink() {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  const seg = (n) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `https://meet.google.com/${seg(3)}-${seg(4)}-${seg(3)}`;
}

function avatar(name) {
  const hue = (name?.charCodeAt(0) || 65) * 17 % 360;
  return { bg: `hsl(${hue},60%,88%)`, color: `hsl(${hue},50%,28%)`, letter: name?.[0]?.toUpperCase() || "?" };
}

async function extractCard(base64, mediaType) {
  const sys = `Extract business card info. Return ONLY JSON:
{"name":string,"title":string,"company":string,"email":string,"phone":string,"website":string,"linkedin":string}
Use null for missing fields.`;
  const text = await callClaude([{
    role: "user", content: [
      { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
      { type: "text", text: "Extract business card info as JSON." }
    ]
  }], sys);
  try { return JSON.parse(text.replace(/```json|```/g, "").trim()); } catch { return null; }
}

async function checkAndIncrementUsage(supabaseClient, userId, action: "email_generation" | "card_scan") {
  const { data, error } = await supabaseClient.rpc("increment_ai_usage", { p_user_id: userId, p_action: action });
  if (error) throw new Error(error.message);
  if (!data.allowed) {
    const limit = action === "email_generation" ? 5 : 10;
    throw new Error(`Daily limit reached: ${limit} ${action === "email_generation" ? "email generations" : "card scans"} per day. Try again tomorrow.`);
  }
}

async function genIntroEmail(fromUser, toContact) {
  return await callClaude([{
    role: "user",
    content: `Write a professional follow-up email from ${fromUser.name} (${fromUser.role} at ${fromUser.company}) to ${toContact.name} (${toContact.title || ""} at ${toContact.company || ""}). They just met at a networking event. Include a line about ${fromUser.company}: ${fromUser.bio || "innovative solutions in " + fromUser.sector}. Format: first line = Subject: ..., blank line, then email body. 3 short paragraphs max.`
  }], "You write professional, warm networking follow-up emails. Be concise.");
}

function parseEmailDraft(draft) {
  const lines = draft.split("\n");
  const subjectIdx = lines.findIndex(l => /^subject:/i.test(l.trim()));
  const subject = subjectIdx >= 0 ? lines[subjectIdx].replace(/^subject:\s*/i, "").trim() : "Following up";
  const rest = subjectIdx >= 0 ? lines.slice(subjectIdx + 1) : lines;
  const bodyStart = rest.findIndex(l => l.trim() !== "");
  const body = bodyStart >= 0 ? rest.slice(bodyStart).join("\n").trim() : draft.trim();
  return { subject, body };
}

function loadGISScript(): Promise<void> {
  return new Promise(resolve => {
    if ((window as any).google?.accounts) { resolve(); return; }
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => resolve();
    document.head.appendChild(s);
  });
}

async function createCalendarEvent({ title, description, date, time, attendeeEmail }: {
  title: string; description: string; date: string; time: string; attendeeEmail: string;
}): Promise<{ meetLink: string; eventLink: string }> {
  await loadGISScript();
  return new Promise((resolve, reject) => {
    const client = (window as any).google.accounts.oauth2.initTokenClient({
      client_id: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID,
      scope: "https://www.googleapis.com/auth/calendar.events",
      callback: async (resp: any) => {
        if (resp.error) { reject(new Error(resp.error_description || resp.error)); return; }
        try {
          const start = new Date(`${date}T${time || "10:00"}`);
          const end = new Date(start.getTime() + 60 * 60 * 1000);
          const res = await fetch(
            "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all",
            {
              method: "POST",
              headers: { "Authorization": `Bearer ${resp.access_token}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                summary: title,
                description,
                start: { dateTime: start.toISOString() },
                end: { dateTime: end.toISOString() },
                attendees: [{ email: attendeeEmail }],
                conferenceData: {
                  createRequest: {
                    requestId: `networq-${Date.now()}`,
                    conferenceSolutionKey: { type: "hangoutsMeet" },
                  },
                },
              }),
            }
          );
          if (!res.ok) {
            const err = await res.json();
            reject(new Error(err.error?.message || `Calendar API error ${res.status}`));
            return;
          }
          const event = await res.json();
          const meetLink =
            event.conferenceData?.entryPoints?.find((e: any) => e.entryPointType === "video")?.uri ||
            event.hangoutLink || "";
          resolve({ meetLink, eventLink: event.htmlLink || "" });
        } catch (e: any) { reject(e); }
      },
    });
    client.requestAccessToken({ prompt: "" });
  });
}

// Maps a Supabase contacts row (snake_case) to the app contact object (camelCase)
function dbToContact(row) {
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    company: row.company,
    email: row.email,
    phone: row.phone,
    website: row.website,
    linkedin: row.linkedin,
    event: row.event,
    reference: row.reference,
    reminder: row.reminder,
    reminderDate: row.reminder_date,
    image: row.image,
    addedAt: row.added_at,
    reminderDone: row.reminder_done,
    emailSent: row.email_sent,
    meetLink: row.meet_link,
    meetDate: row.meet_date,
    tags: row.tags || [],
  };
}

const S = {
  page: { minHeight: "100vh", width: "100%", background: "#f4f6fb", fontFamily: "'DM Sans', sans-serif", color: "#1a1d23" },
  card: { background: "#fff", borderRadius: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.07), 0 4px 24px rgba(0,0,0,0.04)", padding: 28 },
  btn: { background: "#1a1d23", color: "#fff", border: "none", borderRadius: 10, padding: "12px 24px", fontSize: 15, fontWeight: 600, cursor: "pointer" },
  btnOutline: { background: "transparent", color: "#1a1d23", border: "1.5px solid #e0e3ed", borderRadius: 10, padding: "11px 22px", fontSize: 15, fontWeight: 500, cursor: "pointer" },
  btnSm: { background: "#1a1d23", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" },
  btnSmOut: { background: "transparent", color: "#6b7280", border: "1px solid #e0e3ed", borderRadius: 8, padding: "7px 14px", fontSize: 13, cursor: "pointer" },
  input: { width: "100%", background: "#f7f8fc", border: "1.5px solid #e0e3ed", borderRadius: 10, padding: "11px 14px", fontSize: 15, color: "#1a1d23", outline: "none", boxSizing: "border-box" },
  label: { fontSize: 13, fontWeight: 600, color: "#6b7280", marginBottom: 6, display: "block" },
};

const SECTORS = ["Technology","Finance","Healthcare","Education","Media","Retail","Manufacturing","Consulting","Real Estate","Other"];

function tagColor(tag) {
  const hue = [...tag].reduce((acc, c) => acc + c.charCodeAt(0), 0) * 47 % 360;
  return { bg: `hsl(${hue},55%,90%)`, color: `hsl(${hue},45%,25%)` };
}

export default function App() {
  const [screen, setScreen] = useState("splash");
  const [currentUser, setCurrentUser] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [windowWidth, setWindowWidth] = useState(typeof window !== "undefined" ? window.innerWidth : 1200);
  const [tab, setTab] = useState("contacts");
  const [viewMode, setViewMode] = useState("table");
  const [searchQ, setSearchQ] = useState("");
  const [sortCol, setSortCol] = useState("addedAt");
  const [sortDir, setSortDir] = useState("desc");
  const [modal, setModal] = useState(null);
  const [signupStep, setSignupStep] = useState(1);
  const [loginErr, setLoginErr] = useState("");
  const [form, setForm] = useState({ name:"", email:"", password:"", company:"", role:"", sector:"", phone:"", linkedin:"", bio:"" });
  const [loginForm, setLoginForm] = useState({ email:"", password:"" });
  const [scanning, setScanning] = useState(false);
  const [scanPreview, setScanPreview] = useState(null);
  const [scanErr, setScanErr] = useState("");
  const [addForm, setAddForm] = useState({ name:"", title:"", company:"", email:"", phone:"", website:"", linkedin:"", event:"", reference:"", reminder:"", reminderDate:"", tags:[] as string[] });
  const [tagInput, setTagInput] = useState("");
  const [selectedTag, setSelectedTag] = useState<string|null>(null);
  const [addStep, setAddStep] = useState("form");
  const [editingContact, setEditingContact] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");
  const [emailModal, setEmailModal] = useState(null);
  const [meetModal, setMeetModal] = useState(null);
  const [generatingEmail, setGeneratingEmail] = useState(false);
  const [generatedEmail, setGeneratedEmail] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [toast, setToast] = useState<{message:string;type:"success"|"error"}|null>(null);
  const [meetDetails, setMeetDetails] = useState({ date:"", time:"", notes:"" });
  const [meetSent, setMeetSent] = useState(false);
  const [meetSending, setMeetSending] = useState(false);
  const [remindersOpen, setRemindersOpen] = useState(true);
  const [profileModal, setProfileModal] = useState(false);
  const [profileForm, setProfileForm] = useState({ name:"", company:"", role:"", sector:"", phone:"", linkedin:"", bio:"" });
  const [savingProfile, setSavingProfile] = useState(false);
  const [botOpen, setBotOpen] = useState(false);
  const [botMessages, setBotMessages] = useState([]);
  const [botInput, setBotInput] = useState("");
  const [botLoading, setBotLoading] = useState(false);
  const fileRef = useRef();
  const qrFileRef = useRef();
  const botEndRef = useRef();

  const showToast = useCallback((message: string, type: "success"|"error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // On mount: show app shell immediately, fetch data in parallel
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setScreen("app");
        const [profileRes, contactsRes] = await Promise.all([
          supabase.from("profiles").select("*").eq("id", session.user.id).single(),
          supabase.from("contacts").select("*").eq("user_id", session.user.id).order("added_at", { ascending: false }),
        ]);
        setCurrentUser({ ...(profileRes.data || {}), email: session.user.email, id: session.user.id });
        setContacts((contactsRes.data || []).map(dbToContact));
        setContactsLoading(false);
      } else {
        setTimeout(() => setScreen("login"), 900);
      }
    })();
  }, []);

  useEffect(() => { botEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [botMessages]);

  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const handleSignup = async () => {
    if (!form.name || !form.email || !form.password || !form.company) return;
    setLoginErr("");
    const { data, error } = await supabase.auth.signUp({ email: form.email, password: form.password });
    if (error) { setLoginErr(error.message); return; }
    await supabase.from("profiles").insert({
      id: data.user.id,
      name: form.name,
      company: form.company,
      role: form.role,
      sector: form.sector,
      phone: form.phone,
      linkedin: form.linkedin,
      bio: form.bio,
    });
    setCurrentUser({ ...form, id: data.user.id });
    setContacts([]);
    setContactsLoading(false);
    setScreen("app");
  };

  const handleLogin = async () => {
    setLoginErr("");
    const { data, error } = await supabase.auth.signInWithPassword({ email: loginForm.email, password: loginForm.password });
    if (error) { setLoginErr("Invalid email or password."); return; }
    setScreen("app");
    setContactsLoading(true);
    const [profileRes, contactsRes] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", data.user.id).single(),
      supabase.from("contacts").select("*").eq("user_id", data.user.id).order("added_at", { ascending: false }),
    ]);
    setCurrentUser({ ...(profileRes.data || {}), email: data.user.email, id: data.user.id });
    setContacts((contactsRes.data || []).map(dbToContact));
    setContactsLoading(false);
  };

  const handleFile = useCallback(async (file) => {
    if (!file?.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      setScanPreview(e.target.result); // show data URL immediately for instant preview
      setScanErr("");
      setScanning(true);
      try {
        const base64 = e.target.result.split(",")[1];

        // Check daily card scan limit before calling Claude
        if (currentUser?.id) {
          await checkAndIncrementUsage(supabase, currentUser.id, "card_scan");
        }

        // Upload to Supabase Storage and extract card data in parallel
        const [imageUrl, cardData] = await Promise.all([
          (async () => {
            if (!currentUser?.id) return e.target.result;
            const ext = file.type.split("/")[1] || "jpg";
            const fileName = `${currentUser.id}/${Date.now()}.${ext}`;
            const blob = await fetch(e.target.result).then(r => r.blob());
            const { error } = await supabase.storage
              .from("card-images")
              .upload(fileName, blob, { contentType: file.type });
            if (error) {
              console.warn("Storage upload failed, falling back to data URL:", error.message);
              return e.target.result;
            }
            return supabase.storage.from("card-images").getPublicUrl(fileName).data.publicUrl;
          })(),
          extractCard(base64, file.type),
        ]);

        setScanPreview(imageUrl); // replace data URL with storage URL

        if (currentUser?.id) {
          await supabase.from("business_card_scans").insert({
            user_id: currentUser.id,
            image_data: imageUrl,
            extracted_data: cardData,
          });
        }

        if (cardData) {
          setAddForm(f => ({ ...f, name: cardData.name||"", title: cardData.title||"", company: cardData.company||"", email: cardData.email||"", phone: cardData.phone||"", website: cardData.website||"", linkedin: cardData.linkedin||"" }));
          setAddStep("preview"); setTab("add");
        } else {
          setScanErr("Could not read card details. Try a clearer photo.");
        }
      } catch (err) {
        console.error("Extraction error:", err);
        setScanErr(err.message || "Extraction failed. Check your API key.");
      } finally {
        setScanning(false);
      }
    };
    reader.readAsDataURL(file);
  }, [currentUser]);

  const handleQrFile = useCallback(async (file) => {
    if (!file?.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      setScanning(true);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const jsQR = require("jsqr");
        const code = jsQR(imageData.data, imageData.width, imageData.height);
        setScanning(false);
        if (code) {
          try {
            const data = JSON.parse(code.data);
            if (data) { setAddForm(f => ({ ...f, ...data })); setAddStep("preview"); setTab("add"); }
          } catch { alert("QR code found but could not read NetworQ profile."); }
        } else { alert("No QR code detected. Try a clearer image."); }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }, []);

  const saveContact = async () => {
    setSaving(true);
    setSaveErr("");
    try {
      const { data, error } = await supabase.from("contacts").insert({
        user_id: currentUser.id,
        name: addForm.name,
        title: addForm.title || null,
        company: addForm.company || null,
        email: addForm.email || null,
        phone: addForm.phone || null,
        website: addForm.website || null,
        linkedin: addForm.linkedin || null,
        event: addForm.event || null,
        reference: addForm.reference || null,
        reminder: addForm.reminder || null,
        reminder_date: addForm.reminderDate || null,
        image: scanPreview,
        reminder_done: false,
        email_sent: false,
        tags: addForm.tags || [],
      }).select().single();
      if (error) {
        console.error("saveContact error:", error);
        setSaveErr(error.message);
        return;
      }
      const newContact = dbToContact(data);
      setContacts(prev => [newContact, ...prev]);
      setAddForm({ name:"", title:"", company:"", email:"", phone:"", website:"", linkedin:"", event:"", reference:"", reminder:"", reminderDate:"", tags:[] });
      setTagInput("");
      setScanPreview(null); setAddStep("form"); setSaveErr(""); setTab("contacts"); setModal(newContact);
    } catch (err) {
      console.error("saveContact exception:", err);
      setSaveErr(err.message || "Failed to save contact.");
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (contact) => {
    setEditingContact(contact);
    setAddForm({
      name: contact.name || "",
      title: contact.title || "",
      company: contact.company || "",
      email: contact.email || "",
      phone: contact.phone || "",
      website: contact.website || "",
      linkedin: contact.linkedin || "",
      event: contact.event || "",
      reference: contact.reference || "",
      reminder: contact.reminder || "",
      reminderDate: contact.reminderDate || "",
      tags: contact.tags || [],
    });
    setTagInput("");
    setScanPreview(contact.image || null);
    setAddStep("form");
    setSaveErr("");
    setModal(null);
    setTab("add");
  };

  const updateContact = async () => {
    setSaving(true);
    setSaveErr("");
    try {
      const { data, error } = await supabase.from("contacts").update({
        name: addForm.name,
        title: addForm.title || null,
        company: addForm.company || null,
        email: addForm.email || null,
        phone: addForm.phone || null,
        website: addForm.website || null,
        linkedin: addForm.linkedin || null,
        event: addForm.event || null,
        reference: addForm.reference || null,
        reminder: addForm.reminder || null,
        reminder_date: addForm.reminderDate || null,
        tags: addForm.tags || [],
      }).eq("id", editingContact.id).select().single();
      if (error) {
        console.error("updateContact error:", error);
        setSaveErr(error.message);
        return;
      }
      const updated = dbToContact(data);
      setContacts(prev => prev.map(c => c.id === updated.id ? updated : c));
      setEditingContact(null);
      setAddForm({ name:"", title:"", company:"", email:"", phone:"", website:"", linkedin:"", event:"", reference:"", reminder:"", reminderDate:"", tags:[] });
      setTagInput("");
      setScanPreview(null); setAddStep("form"); setSaveErr(""); setTab("contacts"); setModal(updated);
    } catch (err) {
      console.error("updateContact exception:", err);
      setSaveErr(err.message || "Failed to update contact.");
    } finally {
      setSaving(false);
    }
  };

  const openEmail = async (contact) => {
    setEmailModal(contact); setEmailSent(false); setGeneratedEmail(""); setGeneratingEmail(true);
    try {
      if (currentUser?.id) {
        await checkAndIncrementUsage(supabase, currentUser.id, "email_generation");
      }
      const text = await genIntroEmail(currentUser, contact);
      setGeneratedEmail(text);
    } catch (err) {
      setGeneratedEmail("");
      showToast(err.message || "Failed to generate email.", "error");
    } finally {
      setGeneratingEmail(false);
    }
  };

  const sendEmail = async () => {
    if (!emailModal.email) {
      showToast("This contact has no email address.", "error");
      return;
    }
    setEmailSending(true);
    try {
      const { subject, body } = parseEmailDraft(generatedEmail);
      await emailjs.send(
        process.env.EXPO_PUBLIC_EMAILJS_SERVICE_ID,
        process.env.EXPO_PUBLIC_EMAILJS_TEMPLATE_ID,
        {
          to_email: emailModal.email,
          to_name: emailModal.name || "",
          from_name: currentUser.name || "",
          reply_to: currentUser.email || "",
          subject,
          message: body,
        },
        process.env.EXPO_PUBLIC_EMAILJS_PUBLIC_KEY
      );
      await supabase.from("follow_up_emails").insert({
        user_id: currentUser.id,
        contact_id: emailModal.id,
        draft: generatedEmail,
        sent: true,
        sent_at: new Date().toISOString(),
      });
      await supabase.from("contacts").update({ email_sent: true }).eq("id", emailModal.id);
      setContacts(prev => prev.map(c => c.id === emailModal.id ? {...c, emailSent: true} : c));
      setEmailSent(true);
      showToast(`Email sent to ${emailModal.email}`, "success");
      setTimeout(() => setEmailModal(null), 2000);
    } catch (err: any) {
      console.error("EmailJS error:", err);
      showToast(err?.text || err?.message || "Failed to send email.", "error");
    } finally {
      setEmailSending(false);
    }
  };

  const sendMeeting = async () => {
    if (!meetModal.email) {
      showToast("This contact has no email address.", "error");
      return;
    }
    setMeetSending(true);
    try {
      const meetDateStr = meetDetails.date + " " + meetDetails.time;
      let link = "";
      let eventLink = "";
      const useGCal = !!process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID &&
        process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID !== "your_google_client_id";

      if (useGCal) {
        // Create real Google Calendar event — sends invite automatically
        const result = await createCalendarEvent({
          title: `Meeting with ${meetModal.name}`,
          description: meetDetails.notes || `Scheduled via NetworQ by ${currentUser.name}`,
          date: meetDetails.date,
          time: meetDetails.time,
          attendeeEmail: meetModal.email,
        });
        link = result.meetLink;
        eventLink = result.eventLink;
      } else {
        // Fallback: generate fake Meet link + send via EmailJS
        link = genMeetLink();
        const messageBody = [
          `Hi ${meetModal.name},`,
          "",
          `I'd like to schedule a meeting with you.`,
          "",
          `📅 Date: ${meetDetails.date}`,
          `🕐 Time: ${meetDetails.time}`,
          `📹 Google Meet: ${link}`,
          meetDetails.notes ? `\nAgenda:\n${meetDetails.notes}` : "",
          "",
          `Looking forward to connecting!`,
          "",
          currentUser.name,
        ].join("\n");
        await emailjs.send(
          process.env.EXPO_PUBLIC_EMAILJS_SERVICE_ID,
          process.env.EXPO_PUBLIC_EMAILJS_TEMPLATE_ID,
          {
            to_email: meetModal.email,
            to_name: meetModal.name || "",
            from_name: currentUser.name || "",
            reply_to: currentUser.email || "",
            subject: `Meeting invite from ${currentUser.name} — ${meetDetails.date} at ${meetDetails.time}`,
            message: messageBody,
          },
          process.env.EXPO_PUBLIC_EMAILJS_PUBLIC_KEY
        );
      }

      await supabase.from("meetings").insert({
        user_id: currentUser.id,
        contact_id: meetModal.id,
        meet_link: link,
        meet_date: meetDetails.date,
        meet_time: meetDetails.time,
        notes: meetDetails.notes || null,
      });
      await supabase.from("contacts").update({ meet_link: link, meet_date: meetDateStr }).eq("id", meetModal.id);
      setContacts(prev => prev.map(c => c.id === meetModal.id ? {...c, meetLink: link, meetDate: meetDateStr} : c));
      setMeetSent(true);
      showToast(
        useGCal ? `Calendar invite sent to ${meetModal.email}` : `Meeting invite sent to ${meetModal.email}`,
        "success"
      );
      setTimeout(() => { setMeetModal(null); setMeetSent(false); setMeetDetails({ date:"", time:"", notes:"" }); }, 2000);
    } catch (err: any) {
      console.error("Meeting invite error:", err);
      showToast(err?.text || err?.message || "Failed to send invite.", "error");
    } finally {
      setMeetSending(false);
    }
  };

  const toggleReminder = async (id) => {
    const contact = contacts.find(c => c.id === id);
    const newVal = !contact.reminderDone;
    await supabase.from("contacts").update({ reminder_done: newVal }).eq("id", id);
    const updated = contacts.map(c => c.id === id ? {...c, reminderDone: newVal} : c);
    setContacts(updated);
    if (modal?.id === id) setModal(updated.find(c => c.id === id));
  };

  const deleteContact = async (id) => {
    await supabase.from("contacts").delete().eq("id", id);
    setContacts(prev => prev.filter(c => c.id !== id));
    setModal(null);
  };

  const exportCSV = () => {
    const cols = ["name","title","company","email","phone","website","linkedin","event","reference","reminder","reminderDate","tags","addedAt","meetLink","meetDate"];
    const headers = ["Name","Title","Company","Email","Phone","Website","LinkedIn","Event","Reference","Reminder","Reminder Date","Tags","Added At","Meet Link","Meet Date"];
    const escape = (v: any) => {
      const s = Array.isArray(v) ? v.join("; ") : String(v ?? "");
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g,'""')}"` : s;
    };
    const rows = [headers.join(","), ...filtered.map(c => cols.map(k => escape(c[k])).join(","))];
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `networq-contacts-${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const openProfileModal = () => {
    setProfileForm({
      name: currentUser?.name || "",
      company: currentUser?.company || "",
      role: currentUser?.role || "",
      sector: currentUser?.sector || "",
      phone: currentUser?.phone || "",
      linkedin: currentUser?.linkedin || "",
      bio: currentUser?.bio || "",
    });
    setProfileModal(true);
  };

  const updateProfile = async () => {
    setSavingProfile(true);
    try {
      const { error } = await supabase.from("profiles").update({
        name: profileForm.name,
        company: profileForm.company,
        role: profileForm.role,
        sector: profileForm.sector,
        phone: profileForm.phone,
        linkedin: profileForm.linkedin,
        bio: profileForm.bio,
      }).eq("id", currentUser.id);
      if (error) { showToast(error.message, "error"); return; }
      setCurrentUser(u => ({ ...u, ...profileForm }));
      setProfileModal(false);
      showToast("Profile updated.", "success");
    } catch (err: any) {
      showToast(err.message || "Failed to update profile.", "error");
    } finally {
      setSavingProfile(false);
    }
  };

  const sendBotMessage = async (msg) => {
    const userMsg = msg || botInput.trim();
    if (!userMsg || botLoading) return;
    setBotInput("");
    const newMessages = [...botMessages, { role:"user", content: userMsg }];
    setBotMessages(newMessages); setBotLoading(true);
    const contactSummary = contacts.slice(0,50).map(c => `${c.name}|${c.company||""}|${c.title||""}|${c.event||""}|${c.email||""}|${c.addedAt?.slice(0,10)}`).join("\n");
    const sys = `You are NetworQ AI assistant for ${currentUser?.name} (${currentUser?.role} at ${currentUser?.company}).
Their ${contacts.length} contacts:\n${contactSummary || "None yet."}
Help find contacts, suggest follow-ups, draft messages, give networking advice. Be concise and friendly.`;
    const reply = await callClaude(newMessages.map(m => ({role:m.role, content:m.content})), sys, 700);
    setBotMessages(prev => [...prev, { role:"assistant", content: reply }]); setBotLoading(false);
  };

  const isMobile = windowWidth < 768;
  const allTags = [...new Set(contacts.flatMap(c => c.tags || []))].sort();
  const today = new Date().toISOString().slice(0, 10);
  const dueReminders = contacts.filter(c => c.reminder && c.reminderDate && !c.reminderDone && c.reminderDate <= today);

  const filtered = contacts
    .filter(c => !searchQ || [c.name, c.company, c.title, c.event, c.email, c.reference].some(v => v?.toLowerCase().includes(searchQ.toLowerCase())))
    .filter(c => !selectedTag || (c.tags || []).includes(selectedTag))
    .sort((a, b) => { const va = a[sortCol]||""; const vb = b[sortCol]||""; return sortDir==="asc" ? va.localeCompare(vb) : vb.localeCompare(va); });

  const toggleSort = (col) => { if (sortCol===col) setSortDir(d => d==="asc"?"desc":"asc"); else { setSortCol(col); setSortDir("asc"); }};

  const CSS = `
    @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Serif+Display&display=swap');
    @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
    @keyframes fadeIn{from{opacity:0}to{opacity:1}}
    @keyframes spin{to{transform:rotate(360deg)}}
    @keyframes slideUp{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:translateY(0)}}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; width: 100%; overflow-y: auto !important; }
    input:focus,textarea:focus,select:focus{border-color:#4f46e5!important;outline:none}
    .tab-btn:hover{background:#eef2ff!important;color:#4f46e5!important}
    .row-hover:hover{background:#f7f8fc!important;cursor:pointer}
    .act-btn:hover{opacity:0.8!important;transform:scale(1.05)}
    .card-c:hover{box-shadow:0 6px 28px rgba(79,70,229,0.13)!important;transform:translateY(-2px)}
    .card-c{transition:all 0.15s}
    button:active{transform:scale(0.97)}
    ::-webkit-scrollbar{width:5px;height:5px}
    ::-webkit-scrollbar-thumb{background:#e0e3ed;border-radius:4px}
    .sort-th:hover{color:#4f46e5!important;cursor:pointer}
  `;

  // ── SPLASH ──
  if (screen === "splash") return (
    <div style={{...S.page, display:"flex", alignItems:"center", justifyContent:"center", minHeight:"100vh", width:"100vw"}}>
      <style>{CSS}</style>
      <div style={{textAlign:"center", animation:"fadeUp 0.8s ease"}}>
        <div style={{width:72,height:72,background:"#1a1d23",borderRadius:20,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 20px",fontSize:32}}>🔗</div>
        <div style={{fontFamily:"'DM Serif Display',serif",fontSize:44,letterSpacing:"-0.02em"}}>NetworQ</div>
        <div style={{color:"#6b7280",marginTop:8,fontSize:16}}>Smart networking, digitally.</div>
        <div style={{marginTop:24,animation:"pulse 1.2s ease infinite",color:"#9ca3af",fontSize:13}}>Loading…</div>
      </div>
    </div>
  );

  // ── LOGIN ──
  if (screen === "login") return (
    <div style={{...S.page, display:"flex", alignItems:"center", justifyContent:"center", padding:20, minHeight:"100vh", width:"100vw"}}>
      <style>{CSS}</style>
      <div style={{width:"100%", maxWidth:420, animation:"fadeUp 0.5s ease"}}>
        <div style={{textAlign:"center", marginBottom:36}}>
          <div style={{width:52,height:52,background:"#1a1d23",borderRadius:14,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px",fontSize:22}}>🔗</div>
          <div style={{fontFamily:"'DM Serif Display',serif",fontSize:32}}>NetworQ</div>
          <div style={{color:"#6b7280",marginTop:6,fontSize:14}}>Sign in to your account</div>
        </div>
        <div style={S.card}>
          <div style={{marginBottom:18}}><label style={S.label}>Email</label><input style={S.input} type="email" placeholder="you@company.com" value={loginForm.email} onChange={e=>setLoginForm(f=>({...f,email:e.target.value}))}/></div>
          <div style={{marginBottom:24}}><label style={S.label}>Password</label><input style={S.input} type="password" placeholder="••••••••" value={loginForm.password} onChange={e=>setLoginForm(f=>({...f,password:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&handleLogin()}/></div>
          {loginErr && <div style={{color:"#ef4444",fontSize:13,marginBottom:16,background:"#fef2f2",padding:"10px 14px",borderRadius:8}}>{loginErr}</div>}
          <button style={{...S.btn,width:"100%"}} onClick={handleLogin}>Sign In</button>
          <div style={{textAlign:"center",marginTop:20,fontSize:14,color:"#6b7280"}}>Don't have an account?{" "}<span style={{color:"#4f46e5",cursor:"pointer",fontWeight:600}} onClick={()=>{setScreen("signup");setSignupStep(1);setLoginErr("");}}>Sign Up</span></div>
        </div>
      </div>
    </div>
  );

  // ── SIGNUP ──
  if (screen === "signup") return (
    <div style={{...S.page, display:"flex", alignItems:"center", justifyContent:"center", padding:20, minHeight:"100vh", width:"100vw"}}>
      <style>{CSS}</style>
      <div style={{width:"100%", maxWidth:480, animation:"fadeUp 0.5s ease"}}>
        <div style={{textAlign:"center", marginBottom:28}}>
          <div style={{fontFamily:"'DM Serif Display',serif",fontSize:28}}>Create your profile</div>
          <div style={{color:"#6b7280",marginTop:6,fontSize:14}}>Step {signupStep} of 2</div>
          <div style={{display:"flex",gap:6,justifyContent:"center",marginTop:12}}>
            {[1,2].map(s=><div key={s} style={{width:32,height:4,borderRadius:2,background:s<=signupStep?"#4f46e5":"#e0e3ed",transition:"background 0.3s"}}/>)}
          </div>
        </div>
        <div style={S.card}>
          {signupStep===1 && <>
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:14,marginBottom:14}}>
              <div><label style={S.label}>Full Name *</label><input style={S.input} placeholder="Priya Sharma" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))}/></div>
              <div><label style={S.label}>Email *</label><input style={S.input} type="email" placeholder="priya@acme.com" value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))}/></div>
            </div>
            <div style={{marginBottom:14}}><label style={S.label}>Password *</label><input style={S.input} type="password" placeholder="Min 8 characters" value={form.password} onChange={e=>setForm(f=>({...f,password:e.target.value}))}/></div>
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:14,marginBottom:14}}>
              <div><label style={S.label}>Phone</label><input style={S.input} placeholder="+91 98765 43210" value={form.phone} onChange={e=>setForm(f=>({...f,phone:e.target.value}))}/></div>
              <div><label style={S.label}>LinkedIn</label><input style={S.input} placeholder="linkedin.com/in/..." value={form.linkedin} onChange={e=>setForm(f=>({...f,linkedin:e.target.value}))}/></div>
            </div>
            <button style={{...S.btn,width:"100%"}} onClick={()=>form.name&&form.email&&form.password&&setSignupStep(2)}>Continue →</button>
            <div style={{textAlign:"center",marginTop:16,fontSize:14,color:"#6b7280"}}>Already have an account?{" "}<span style={{color:"#4f46e5",cursor:"pointer",fontWeight:600}} onClick={()=>{setScreen("login");setLoginErr("");}}>Sign In</span></div>
          </>}
          {signupStep===2 && <>
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:14,marginBottom:14}}>
              <div><label style={S.label}>Company *</label><input style={S.input} placeholder="Acme Corp" value={form.company} onChange={e=>setForm(f=>({...f,company:e.target.value}))}/></div>
              <div><label style={S.label}>Your Role *</label><input style={S.input} placeholder="Founder, CTO..." value={form.role} onChange={e=>setForm(f=>({...f,role:e.target.value}))}/></div>
            </div>
            <div style={{marginBottom:14}}><label style={S.label}>Sector *</label>
              <select style={{...S.input,background:"#f7f8fc"}} value={form.sector} onChange={e=>setForm(f=>({...f,sector:e.target.value}))}>
                <option value="">Select sector…</option>{SECTORS.map(s=><option key={s}>{s}</option>)}
              </select>
            </div>
            <div style={{marginBottom:20}}><label style={S.label}>Company Bio / Pitch (optional)</label>
              <textarea style={{...S.input,height:80,resize:"none"}} placeholder="What does your company do?" value={form.bio} onChange={e=>setForm(f=>({...f,bio:e.target.value}))}/>
            </div>
            {loginErr && <div style={{color:"#ef4444",fontSize:13,marginBottom:16,background:"#fef2f2",padding:"10px 14px",borderRadius:8}}>{loginErr}</div>}
            <div style={{display:"flex",gap:10}}>
              <button style={{...S.btnOutline,flex:1}} onClick={()=>setSignupStep(1)}>← Back</button>
              <button style={{...S.btn,flex:2}} onClick={handleSignup}>Create Account 🎉</button>
            </div>
          </>}
        </div>
      </div>
    </div>
  );

  // ── MAIN APP ──
  const qrData = JSON.stringify({name:currentUser?.name,title:currentUser?.role,company:currentUser?.company,email:currentUser?.email,phone:currentUser?.phone,linkedin:currentUser?.linkedin});

  return (
    <div style={S.page}>
      <style>{CSS}</style>

      {/* NAV */}
      <nav style={{background:"#fff",borderBottom:"1px solid #f0f1f5",padding:"0 24px",display:"flex",alignItems:"center",justifyContent:"space-between",height:60,position:"sticky",top:0,zIndex:50}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:34,height:34,background:"#1a1d23",borderRadius:9,display:"flex",alignItems:"center",justifyContent:"center",fontSize:15}}>🔗</div>
          <span style={{fontFamily:"'DM Serif Display',serif",fontSize:22}}>NetworQ</span>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:isMobile?6:10}}>
          {!isMobile && <div style={{textAlign:"right"}}>
            <div style={{fontSize:13,fontWeight:600}}>{currentUser?.name}</div>
            <div style={{fontSize:11,color:"#6b7280"}}>{currentUser?.company}</div>
          </div>}
          <div onClick={openProfileModal} title="Edit profile" style={{width:36,height:36,borderRadius:"50%",background:"#4f46e5",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:15,cursor:"pointer"}}>{currentUser?.name?.[0]}</div>
          <button onClick={async()=>{await supabase.auth.signOut();setCurrentUser(null);setContacts([]);setScreen("login");}} style={{...S.btnSmOut,fontSize:12}}>{isMobile?"Out":"Sign out"}</button>
        </div>
      </nav>

      <div style={{padding:isMobile?"16px 12px":"28px 24px",paddingBottom:isMobile?"96px":"88px",animation:"fadeUp 0.4s ease"}}>

        {/* ── CONTACTS ── */}
        {tab==="contacts" && (
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:12}}>
              <div>
                <h2 style={{fontFamily:"'DM Serif Display',serif",fontSize:26,margin:0}}>Contacts</h2>
                <div style={{color:"#6b7280",fontSize:14,marginTop:3}}>{contacts.length} connections · {filtered.length} shown</div>
              </div>
              <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",width:isMobile?"100%":"auto"}}>
                <div style={{position:"relative",flex:isMobile?"1":"none"}}>
                  <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",fontSize:14,color:"#9ca3af"}}>🔍</span>
                  <input
                    placeholder="Search…"
                    value={searchQ}
                    onChange={e=>setSearchQ(e.target.value)}
                    style={{...S.input,width:isMobile?"100%":260,paddingLeft:36,fontSize:14}}
                  />
                  {searchQ && <span onClick={()=>setSearchQ("")} style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",cursor:"pointer",color:"#9ca3af",fontSize:18,lineHeight:1}}>×</span>}
                </div>
                {!isMobile && <div style={{display:"flex",background:"#f0f1f5",borderRadius:9,padding:3}}>
                  {[["table","▤"],["cards","⊞"]].map(([m,icon])=>(
                    <button key={m} onClick={()=>setViewMode(m)} style={{border:"none",borderRadius:7,padding:"6px 13px",fontSize:16,cursor:"pointer",background:viewMode===m?"#fff":"transparent",color:viewMode===m?"#4f46e5":"#9ca3af",boxShadow:viewMode===m?"0 1px 4px rgba(0,0,0,0.08)":"none"}}>{icon}</button>
                  ))}
                </div>}
                {!contactsLoading && contacts.length > 0 && (
                  <button style={{...S.btnOutline,fontSize:13,padding:"10px 16px"}} onClick={exportCSV} title={`Export ${filtered.length} contact${filtered.length!==1?"s":""} as CSV`}>
                    ↓{!isMobile && ` Export${selectedTag||searchQ ? ` (${filtered.length})` : ""}`}
                  </button>
                )}
                <button style={{...S.btn,fontSize:13,padding:"10px 18px"}} onClick={()=>{setTab("add");setAddStep("form");setScanPreview(null);}}>{isMobile?"+ Add":"+ Add Contact"}</button>
              </div>
            </div>

            {!contactsLoading && dueReminders.length > 0 && (
              <div style={{background:"#fffbeb",border:"1.5px solid #fde68a",borderRadius:12,padding:"14px 18px",marginBottom:16}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer"}} onClick={()=>setRemindersOpen(o=>!o)}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:16}}>🔔</span>
                    <span style={{fontWeight:700,fontSize:13,color:"#b45309"}}>
                      {dueReminders.length} reminder{dueReminders.length>1?"s":""} due
                    </span>
                    <span style={{fontSize:12,color:"#d97706"}}>
                      {dueReminders.filter(c=>c.reminderDate<today).length>0 &&
                        `· ${dueReminders.filter(c=>c.reminderDate<today).length} overdue`}
                    </span>
                  </div>
                  <span style={{fontSize:12,color:"#d97706",fontWeight:600}}>{remindersOpen?"▲ Hide":"▼ Show"}</span>
                </div>
                {remindersOpen && (
                  <div style={{marginTop:10,display:"flex",flexDirection:"column",gap:6}}>
                    {dueReminders.map(c=>{
                      const overdue = c.reminderDate < today;
                      return (
                        <div key={c.id} style={{background:"#fff",borderRadius:8,padding:"10px 14px",display:"flex",alignItems:"center",gap:12,cursor:"pointer",boxShadow:"0 1px 3px rgba(0,0,0,0.06)"}} onClick={()=>setModal(c)}>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontWeight:600,fontSize:13,marginBottom:2}}>{c.name}</div>
                            <div style={{fontSize:12,color:"#6b7280",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.reminder}</div>
                          </div>
                          <span style={{background:overdue?"#fef2f2":"#fffbeb",color:overdue?"#ef4444":"#d97706",borderRadius:6,padding:"3px 8px",fontSize:11,fontWeight:700,whiteSpace:"nowrap",flexShrink:0}}>
                            {overdue?`Overdue · ${c.reminderDate}`:"Due today"}
                          </span>
                          <button onClick={e=>{e.stopPropagation();toggleReminder(c.id);}}
                            style={{...S.btnSm,background:"#f0fdf4",color:"#16a34a",fontSize:11,padding:"5px 10px",flexShrink:0}}>
                            Done ✓
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {!contactsLoading && allTags.length > 0 && (
              <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:14,alignItems:"center"}}>
                <span style={{fontSize:12,color:"#9ca3af",fontWeight:600,marginRight:2}}>Filter:</span>
                {allTags.map(tag => {
                  const tc = tagColor(tag);
                  const active = selectedTag === tag;
                  return (
                    <span key={tag} onClick={()=>setSelectedTag(active ? null : tag)}
                      style={{background:active?tc.color:tc.bg,color:active?"#fff":tc.color,borderRadius:20,padding:"4px 12px",fontSize:12,fontWeight:600,cursor:"pointer",transition:"all 0.15s",border:`1.5px solid ${tc.color}20`}}>
                      {tag} {active && "×"}
                    </span>
                  );
                })}
              </div>
            )}

            {searchQ && (
              <div style={{marginBottom:14,display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:13,color:"#6b7280"}}>Results for:</span>
                <span style={{background:"#eef2ff",color:"#4f46e5",borderRadius:20,padding:"3px 12px",fontSize:13,fontWeight:600}}>{searchQ}</span>
                <span style={{fontSize:13,color:"#9ca3af"}}>{filtered.length} found</span>
              </div>
            )}

            {contactsLoading ? (
              (viewMode==="table" && !isMobile) ? (
                <div style={{...S.card,padding:0,overflow:"hidden"}}>
                  <div style={{overflowX:"auto"}}>
                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:14}}>
                      <thead>
                        <tr style={{background:"#f7f8fc",borderBottom:"2px solid #f0f1f5"}}>
                          {["Name","Company","Email","Phone","Event","Added","Actions"].map(h=>(
                            <th key={h} style={{padding:"13px 16px",textAlign:"left",fontSize:11,fontWeight:700,color:"#6b7280",letterSpacing:"0.06em",textTransform:"uppercase"}}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[...Array(6)].map((_,i)=>(
                          <tr key={i} style={{borderBottom:"1px solid #f0f1f5"}}>
                            <td style={{padding:"13px 16px"}}>
                              <div style={{display:"flex",alignItems:"center",gap:10}}>
                                <div style={{width:34,height:34,borderRadius:9,background:"#e8eaed",animation:`pulse 1.5s ease ${i*0.1}s infinite`}}/>
                                <div>
                                  <div style={{height:12,width:90+i*8,background:"#e8eaed",borderRadius:6,marginBottom:5,animation:`pulse 1.5s ease ${i*0.1}s infinite`}}/>
                                  <div style={{height:10,width:55,background:"#e8eaed",borderRadius:6,animation:`pulse 1.5s ease ${i*0.1+0.2}s infinite`}}/>
                                </div>
                              </div>
                            </td>
                            {[90,140,80,70,60].map((w,j)=>(
                              <td key={j} style={{padding:"13px 16px"}}><div style={{height:12,width:w,background:"#e8eaed",borderRadius:6,animation:`pulse 1.5s ease ${i*0.1+j*0.05}s infinite`}}/></td>
                            ))}
                            <td style={{padding:"13px 16px"}}>
                              <div style={{display:"flex",gap:6}}>
                                {[0,1,2].map(j=><div key={j} style={{height:28,width:28,background:"#e8eaed",borderRadius:8,animation:`pulse 1.5s ease ${i*0.1+j*0.1}s infinite`}}/>)}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"repeat(auto-fill,minmax(280px,1fr))",gap:16}}>
                  {[...Array(6)].map((_,i)=>(
                    <div key={i} style={{...S.card,padding:20}}>
                      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
                        <div style={{width:44,height:44,borderRadius:12,background:"#e8eaed",animation:`pulse 1.5s ease ${i*0.08}s infinite`}}/>
                        <div>
                          <div style={{height:14,width:110,background:"#e8eaed",borderRadius:6,marginBottom:6,animation:`pulse 1.5s ease ${i*0.08}s infinite`}}/>
                          <div style={{height:11,width:80,background:"#e8eaed",borderRadius:6,animation:`pulse 1.5s ease ${i*0.08+0.15}s infinite`}}/>
                        </div>
                      </div>
                      <div style={{height:11,width:150,background:"#e8eaed",borderRadius:6,marginBottom:8,animation:`pulse 1.5s ease ${i*0.08+0.2}s infinite`}}/>
                      <div style={{height:11,width:90,background:"#e8eaed",borderRadius:6,animation:`pulse 1.5s ease ${i*0.08+0.25}s infinite`}}/>
                    </div>
                  ))}
                </div>
              )
            ) : filtered.length===0 ? (
              <div style={{...S.card,textAlign:"center",padding:"60px 20px",color:"#6b7280"}}>
                <div style={{fontSize:48,marginBottom:16}}>{searchQ?"🔍":"🤝"}</div>
                <div style={{fontFamily:"'DM Serif Display',serif",fontSize:22,color:"#1a1d23",marginBottom:8}}>{searchQ?"No contacts found":"No contacts yet"}</div>
                <div style={{fontSize:15}}>{searchQ?`No results for "${searchQ}"`:"Scan a business card or add manually to get started"}</div>
                {!searchQ && <button style={{...S.btn,marginTop:20}} onClick={()=>setTab("scan")}>Scan a Card</button>}
              </div>
            ) : (viewMode==="table" && !isMobile) ? (
              <div style={{...S.card,padding:0,overflow:"hidden"}}>
                <div style={{overflowX:"auto"}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:14}}>
                    <thead>
                      <tr style={{background:"#f7f8fc",borderBottom:"2px solid #f0f1f5"}}>
                        {[["name","Name"],["company","Company"],["email","Email"],["phone","Phone"],["event","Event"],["addedAt","Added"]].map(([col,label])=>(
                          <th key={col} className="sort-th" onClick={()=>toggleSort(col)}
                            style={{padding:"13px 16px",textAlign:"left",fontSize:11,fontWeight:700,color:sortCol===col?"#4f46e5":"#6b7280",letterSpacing:"0.06em",textTransform:"uppercase",whiteSpace:"nowrap",userSelect:"none"}}>
                            {label} {sortCol===col?(sortDir==="asc"?"↑":"↓"):""}
                          </th>
                        ))}
                        <th style={{padding:"13px 16px",fontSize:11,fontWeight:700,color:"#6b7280",letterSpacing:"0.06em",textTransform:"uppercase"}}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(c => {
                        const av = avatar(c.name);
                        return (
                          <tr key={c.id} className="row-hover" style={{borderBottom:"1px solid #f0f1f5"}} onClick={()=>setModal(c)}>
                            <td style={{padding:"13px 16px"}}>
                              <div style={{display:"flex",alignItems:"center",gap:10}}>
                                <div style={{width:34,height:34,borderRadius:9,background:av.bg,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:14,color:av.color,flexShrink:0}}>{av.letter}</div>
                                <div>
                                  <div style={{fontWeight:600,display:"flex",alignItems:"center",gap:6}}>
                                    {c.reminder&&c.reminderDate&&!c.reminderDone&&c.reminderDate<=today&&(
                                      <span title={c.reminderDate<today?"Overdue reminder":"Reminder due today"} style={{width:7,height:7,borderRadius:"50%",background:c.reminderDate<today?"#ef4444":"#f59e0b",flexShrink:0,display:"inline-block"}}/>
                                    )}
                                    {c.name||"—"}
                                  </div>
                                  {c.title && <div style={{fontSize:11,color:"#9ca3af"}}>{c.title}</div>}
                                </div>
                              </div>
                            </td>
                            <td style={{padding:"13px 16px",color:"#374151",fontWeight:500}}>{c.company||<span style={{color:"#d1d5db"}}>—</span>}</td>
                            <td style={{padding:"13px 16px"}}>{c.email?<a href={`mailto:${c.email}`} onClick={e=>e.stopPropagation()} style={{color:"#4f46e5",textDecoration:"none",fontSize:13}}>{c.email}</a>:<span style={{color:"#d1d5db"}}>—</span>}</td>
                            <td style={{padding:"13px 16px",color:"#6b7280",fontSize:13}}>{c.phone||<span style={{color:"#d1d5db"}}>—</span>}</td>
                            <td style={{padding:"13px 16px"}}>
                              {c.event && <span style={{background:"#eef2ff",color:"#4f46e5",borderRadius:6,padding:"3px 9px",fontSize:12,fontWeight:600,display:"inline-block",marginBottom:4}}>{c.event}</span>}
                              {(c.tags||[]).length>0 && <div style={{display:"flex",flexWrap:"wrap",gap:3}}>{(c.tags||[]).map(t=>{const tc=tagColor(t);return <span key={t} style={{background:tc.bg,color:tc.color,borderRadius:10,padding:"2px 7px",fontSize:11,fontWeight:600}}>{t}</span>})}</div>}
                              {!c.event && !(c.tags||[]).length && <span style={{color:"#d1d5db"}}>—</span>}
                            </td>
                            <td style={{padding:"13px 16px",color:"#9ca3af",fontSize:12}}>{c.addedAt?new Date(c.addedAt).toLocaleDateString():"—"}</td>
                            <td style={{padding:"13px 16px"}} onClick={e=>e.stopPropagation()}>
                              <div style={{display:"flex",gap:6}}>
                                <button className="act-btn" onClick={()=>openEmail(c)} style={{...S.btnSm,background:"#eef2ff",color:"#4f46e5",fontSize:12,padding:"6px 10px"}} title="Email">✉</button>
                                <button className="act-btn" onClick={()=>{setMeetModal(c);setMeetSent(false);}} style={{...S.btnSm,background:"#f0fdf4",color:"#16a34a",fontSize:12,padding:"6px 10px"}} title="Meet">📅</button>
                                <button className="act-btn" onClick={()=>openEdit(c)} style={{...S.btnSm,background:"#f0f4ff",color:"#4f46e5",fontSize:12,padding:"6px 10px"}} title="Edit">✏️</button>
                                <button className="act-btn" onClick={()=>setModal(c)} style={{...S.btnSm,background:"#f7f8fc",color:"#6b7280",fontSize:12,padding:"6px 10px"}} title="View">👁</button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"repeat(auto-fill,minmax(280px,1fr))",gap:16}}>
                {filtered.map(c=>{
                  const av=avatar(c.name);
                  return (
                    <div key={c.id} className="card-c" style={{...S.card,padding:20,cursor:"pointer"}} onClick={()=>setModal(c)}>
                      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
                        <div style={{width:44,height:44,borderRadius:12,background:av.bg,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:18,color:av.color}}>{av.letter}</div>
                        <div>
                          <div style={{fontWeight:700,fontSize:15,display:"flex",alignItems:"center",gap:6}}>
                            {c.reminder&&c.reminderDate&&!c.reminderDone&&c.reminderDate<=today&&(
                              <span title={c.reminderDate<today?"Overdue reminder":"Reminder due today"} style={{width:8,height:8,borderRadius:"50%",background:c.reminderDate<today?"#ef4444":"#f59e0b",flexShrink:0}}/>
                            )}
                            {c.name}
                          </div>
                          <div style={{fontSize:12,color:"#6b7280"}}>{[c.title,c.company].filter(Boolean).join(" · ")}</div>
                        </div>
                      </div>
                      {c.email && <div style={{fontSize:13,color:"#4f46e5",marginBottom:6,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>📧 {c.email}</div>}
                      {c.phone && <div style={{fontSize:13,color:"#6b7280",marginBottom:6}}>📱 {c.phone}</div>}
                      {(c.event || (c.tags||[]).length>0) && (
                        <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:8}}>
                          {c.event && <span style={{background:"#eef2ff",color:"#4f46e5",borderRadius:6,padding:"3px 9px",fontSize:12,fontWeight:600}}>{c.event}</span>}
                          {(c.tags||[]).map(t=>{const tc=tagColor(t);return <span key={t} style={{background:tc.bg,color:tc.color,borderRadius:10,padding:"3px 9px",fontSize:11,fontWeight:600}}>{t}</span>})}
                        </div>
                      )}
                      <div style={{display:"flex",gap:8,marginTop:14}} onClick={e=>e.stopPropagation()}>
                        <button onClick={()=>openEmail(c)} style={{...S.btnSm,background:"#eef2ff",color:"#4f46e5",fontSize:12,padding:"7px 12px",flex:1}}>✉ Email</button>
                        <button onClick={()=>{setMeetModal(c);setMeetSent(false);}} style={{...S.btnSm,background:"#f0fdf4",color:"#16a34a",fontSize:12,padding:"7px 12px",flex:1}}>📅 Meet</button>
                        <button onClick={()=>openEdit(c)} style={{...S.btnSm,background:"#f0f4ff",color:"#4f46e5",fontSize:12,padding:"7px 12px"}}>✏️</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── SCAN ── */}
        {tab==="scan" && (
          <div>
            <h2 style={{fontFamily:"'DM Serif Display',serif",fontSize:26,marginBottom:6}}>Scan Business Card</h2>
            <p style={{color:"#6b7280",fontSize:14,marginBottom:24}}>Upload a photo — AI extracts all contact details automatically.</p>
            <div style={S.card}>
              <div style={{border:"2px dashed #e0e3ed",borderRadius:12,padding:"40px 20px",textAlign:"center",cursor:"pointer"}}
                onClick={()=>fileRef.current?.click()} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();handleFile(e.dataTransfer.files[0]);}}>
                {scanning?(<div><div style={{width:40,height:40,border:"3px solid #e0e3ed",borderTopColor:"#4f46e5",borderRadius:"50%",animation:"spin 0.8s linear infinite",margin:"0 auto 16px"}}/><div style={{color:"#4f46e5",fontWeight:600}}>Reading card with AI…</div></div>
                ):scanPreview?<img src={scanPreview} alt="preview" style={{maxHeight:200,borderRadius:8,maxWidth:"100%"}}/>
                :(<><div style={{fontSize:40,marginBottom:12}}>📇</div><div style={{fontWeight:600,marginBottom:6}}>Drop card image here</div><div style={{color:"#6b7280",fontSize:13}}>or <span style={{color:"#4f46e5"}}>click to browse</span> · PNG, JPG supported</div></>)}
              </div>
              <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>handleFile(e.target.files[0])}/>
              {scanErr && (
                <div style={{marginTop:12,padding:"10px 14px",background:"#fef2f2",borderRadius:8,color:"#ef4444",fontSize:13,display:"flex",alignItems:"center",gap:8}}>
                  <span>⚠️</span><span>{scanErr}</span>
                  <button onClick={()=>{setScanErr("");setScanPreview(null);}} style={{marginLeft:"auto",background:"none",border:"none",color:"#ef4444",cursor:"pointer",fontSize:18,lineHeight:1}}>×</button>
                </div>
              )}
              <div style={{marginTop:20,padding:16,background:"#f7f8fc",borderRadius:10,textAlign:"center"}}>
                <div style={{fontWeight:600,marginBottom:8,fontSize:14}}>📱 Scan a NetworQ QR Code</div>
                <button style={{...S.btnSm,background:"#eef2ff",color:"#4f46e5"}} onClick={()=>qrFileRef.current?.click()}>Upload QR Code</button>
                <input ref={qrFileRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>handleQrFile(e.target.files[0])}/>
              </div>
            </div>
          </div>
        )}

        {/* ── MY QR ── */}
        {tab==="qr" && (
          <div>
            <h2 style={{fontFamily:"'DM Serif Display',serif",fontSize:26,marginBottom:6}}>My QR Code</h2>
            <p style={{color:"#6b7280",fontSize:14,marginBottom:24}}>Share at events — others scan to instantly add you.</p>
            <div style={{...S.card,textAlign:"center"}}>
              <div style={{display:"inline-block",padding:16,background:"#fff",borderRadius:12,border:"1px solid #f0f1f5",boxShadow:"0 2px 12px rgba(0,0,0,0.06)"}}>
                <img src={qrUrl(qrData)} alt="QR Code" style={{width:220,height:220,display:"block"}}/>
              </div>
              <div style={{marginTop:20,fontFamily:"'DM Serif Display',serif",fontSize:22}}>{currentUser?.name}</div>
              <div style={{color:"#6b7280",fontSize:14,marginTop:4}}>{currentUser?.role} · {currentUser?.company}</div>
              <div style={{marginTop:16,padding:"12px 20px",background:"#f7f8fc",borderRadius:10,fontSize:13,color:"#6b7280"}}>
                <div>{currentUser?.email}</div>
                {currentUser?.phone&&<div style={{marginTop:4}}>{currentUser?.phone}</div>}
                {currentUser?.linkedin&&<div style={{marginTop:4}}>{currentUser?.linkedin}</div>}
              </div>
            </div>
          </div>
        )}

        {/* ── ADD ── */}
        {tab==="add" && (
          <div style={{height:"calc(100vh - 80px)",overflowY:"auto",paddingBottom:40}}>
            <h2 style={{fontFamily:"'DM Serif Display',serif",fontSize:26,marginBottom:6}}>{editingContact?"Edit Contact":addStep==="form"?"Add Contact Manually":"Review & Save Contact"}</h2>
            <p style={{color:"#6b7280",fontSize:14,marginBottom:24}}>{editingContact?"Update the contact's details below.":addStep==="form"?"Fill in contact details manually.":"Review extracted info and add event details."}</p>
            <div style={S.card}>
              {scanPreview&&<div style={{marginBottom:20,textAlign:"center"}}><img src={scanPreview} alt="card" style={{maxHeight:140,borderRadius:8,maxWidth:"100%"}}/><div style={{fontSize:12,color:"#6b7280",marginTop:8}}>Scanned card</div></div>}
              <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:14,marginBottom:14}}>
                <div><label style={S.label}>Name</label><input style={S.input} value={addForm.name} onChange={e=>setAddForm(f=>({...f,name:e.target.value}))} placeholder="Jane Doe"/></div>
                <div><label style={S.label}>Title / Role</label><input style={S.input} value={addForm.title} onChange={e=>setAddForm(f=>({...f,title:e.target.value}))} placeholder="CEO"/></div>
                <div><label style={S.label}>Company</label><input style={S.input} value={addForm.company} onChange={e=>setAddForm(f=>({...f,company:e.target.value}))} placeholder="Acme Corp"/></div>
                <div><label style={S.label}>Email</label><input style={S.input} type="email" value={addForm.email} onChange={e=>setAddForm(f=>({...f,email:e.target.value}))} placeholder="jane@acme.com"/></div>
                <div><label style={S.label}>Phone</label><input style={S.input} value={addForm.phone} onChange={e=>setAddForm(f=>({...f,phone:e.target.value}))} placeholder="+91 ..."/></div>
                <div><label style={S.label}>Website</label><input style={S.input} value={addForm.website} onChange={e=>setAddForm(f=>({...f,website:e.target.value}))} placeholder="acme.com"/></div>
                <div style={{gridColumn:"1/-1"}}><label style={S.label}>LinkedIn</label><input style={S.input} value={addForm.linkedin} onChange={e=>setAddForm(f=>({...f,linkedin:e.target.value}))} placeholder="linkedin.com/in/jane"/></div>
              </div>
              <div style={{borderTop:"1px solid #f0f1f5",paddingTop:18,marginBottom:14}}>
                <label style={S.label}>🏷️ Tags</label>
                {(addForm.tags||[]).length > 0 && (
                  <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:8}}>
                    {(addForm.tags||[]).map(tag => {
                      const tc = tagColor(tag);
                      return (
                        <span key={tag} style={{background:tc.bg,color:tc.color,borderRadius:20,padding:"3px 10px",fontSize:12,fontWeight:600,display:"inline-flex",alignItems:"center",gap:4}}>
                          {tag}
                          <span onClick={()=>setAddForm(f=>({...f,tags:(f.tags||[]).filter(t=>t!==tag)}))} style={{cursor:"pointer",fontSize:15,lineHeight:1,opacity:0.7}}>×</span>
                        </span>
                      );
                    })}
                  </div>
                )}
                <input
                  style={{...S.input,fontSize:13}}
                  placeholder="Type a tag, press Enter or comma to add (e.g. investor, client…)"
                  value={tagInput}
                  onChange={e=>setTagInput(e.target.value)}
                  onKeyDown={e=>{
                    if ((e.key==="Enter"||e.key===",")&&tagInput.trim()) {
                      e.preventDefault();
                      const t=tagInput.trim().toLowerCase().replace(/,/g,"");
                      if(t&&!(addForm.tags||[]).includes(t)) setAddForm(f=>({...f,tags:[...(f.tags||[]),t]}));
                      setTagInput("");
                    } else if(e.key==="Backspace"&&!tagInput&&(addForm.tags||[]).length) {
                      setAddForm(f=>({...f,tags:(f.tags||[]).slice(0,-1)}));
                    }
                  }}
                />
              </div>

              <div style={{borderTop:"1px solid #f0f1f5",paddingTop:18}}>
                <div style={{fontSize:13,fontWeight:700,marginBottom:14}}>📍 Event Details</div>
                <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:14,marginBottom:14}}>
                  <div><label style={S.label}>Event Name</label><input style={S.input} value={addForm.event} onChange={e=>setAddForm(f=>({...f,event:e.target.value}))} placeholder="TechSummit 2025"/></div>
                  <div><label style={S.label}>Reminder Date</label><input style={S.input} type="date" value={addForm.reminderDate} onChange={e=>setAddForm(f=>({...f,reminderDate:e.target.value}))}/></div>
                </div>
                <div style={{marginBottom:14}}><label style={S.label}>Reference Note</label><textarea style={{...S.input,height:72,resize:"none"}} value={addForm.reference} onChange={e=>setAddForm(f=>({...f,reference:e.target.value}))} placeholder="e.g. Discussed supply chain robotics…"/></div>
                <div style={{marginBottom:20}}><label style={S.label}>Reminder / Follow-up</label><input style={S.input} value={addForm.reminder} onChange={e=>setAddForm(f=>({...f,reminder:e.target.value}))} placeholder="e.g. Follow up about demo next week"/></div>
              </div>
              {saveErr && (
                <div style={{marginBottom:12,padding:"10px 14px",background:"#fef2f2",borderRadius:8,color:"#ef4444",fontSize:13}}>
                  ⚠️ {saveErr}
                </div>
              )}
              <div style={{display:"flex",gap:10}}>
                {editingContact && (
                  <button style={{...S.btnOutline,flex:1}} onClick={()=>{setEditingContact(null);setAddForm({name:"",title:"",company:"",email:"",phone:"",website:"",linkedin:"",event:"",reference:"",reminder:"",reminderDate:"",tags:[]});setTagInput("");setScanPreview(null);setTab("contacts");}}>
                    Cancel
                  </button>
                )}
                <button
                  style={{...S.btn,flex:2,opacity:(!addForm.name||saving)?0.5:1}}
                  onClick={editingContact ? updateContact : saveContact}
                  disabled={!addForm.name||saving}
                >
                  {saving ? "Saving…" : editingContact ? "Update Contact ✓" : "Save Contact ✓"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── CONTACT DETAIL MODAL ── */}
      {modal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:20,animation:"fadeIn 0.2s ease"}} onClick={()=>setModal(null)}>
          <div style={{...S.card,maxWidth:560,width:"100%",maxHeight:"90vh",overflowY:"auto",animation:"fadeUp 0.25s ease"}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20}}>
              <div style={{display:"flex",alignItems:"center",gap:14}}>
                {(() => { const av=avatar(modal.name); return <div style={{width:52,height:52,borderRadius:14,background:av.bg,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:22,color:av.color}}>{av.letter}</div>; })()}
                <div>
                  <div style={{fontFamily:"'DM Serif Display',serif",fontSize:22}}>{modal.name}</div>
                  <div style={{color:"#6b7280",fontSize:14}}>{[modal.title,modal.company].filter(Boolean).join(" · ")}</div>
                </div>
              </div>
              <button onClick={()=>setModal(null)} style={{...S.btnSmOut,fontSize:18,padding:"4px 10px"}}>×</button>
            </div>
            {modal.image && <img src={modal.image} alt="card" style={{width:"100%",borderRadius:10,marginBottom:16,maxHeight:180,objectFit:"cover"}}/>}
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:12,marginBottom:16}}>
              {[["📧 Email",modal.email],["📱 Phone",modal.phone],["🌐 Website",modal.website],["💼 LinkedIn",modal.linkedin]].map(([l,v])=>v?(
                <div key={l} style={{background:"#f7f8fc",borderRadius:10,padding:"12px 14px"}}>
                  <div style={{fontSize:11,color:"#6b7280",fontWeight:600,marginBottom:4}}>{l}</div>
                  <div style={{fontSize:13,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{v}</div>
                </div>
              ):null)}
            </div>
            {modal.event && <div style={{background:"#eef2ff",borderRadius:10,padding:"12px 14px",marginBottom:12}}><span style={{fontSize:11,fontWeight:700,color:"#4f46e5",letterSpacing:"0.06em"}}>EVENT</span><div style={{fontWeight:600,marginTop:4}}>{modal.event}</div></div>}
            {(modal.tags||[]).length>0 && (
              <div style={{background:"#f7f8fc",borderRadius:10,padding:"12px 14px",marginBottom:12}}>
                <span style={{fontSize:11,fontWeight:700,color:"#6b7280",letterSpacing:"0.06em"}}>TAGS</span>
                <div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:8}}>
                  {(modal.tags||[]).map(t=>{const tc=tagColor(t);return <span key={t} style={{background:tc.bg,color:tc.color,borderRadius:20,padding:"4px 12px",fontSize:12,fontWeight:600}}>{t}</span>})}
                </div>
              </div>
            )}
            {modal.reference && <div style={{background:"#f7f8fc",borderRadius:10,padding:"12px 14px",marginBottom:12}}><span style={{fontSize:11,fontWeight:700,color:"#6b7280",letterSpacing:"0.06em"}}>REFERENCE NOTE</span><div style={{marginTop:4,fontSize:14,lineHeight:1.6}}>{modal.reference}</div></div>}
            {modal.reminder && <div style={{background:"#fffbeb",borderRadius:10,padding:"12px 14px",marginBottom:12,display:"flex",alignItems:"center",gap:12}}>
              <div><span style={{fontSize:11,fontWeight:700,color:"#d97706",letterSpacing:"0.06em"}}>REMINDER</span><div style={{marginTop:4,fontSize:14}}>{modal.reminder} {modal.reminderDate&&<span style={{color:"#6b7280"}}>· {modal.reminderDate}</span>}</div></div>
              <div style={{marginLeft:"auto",cursor:"pointer",width:24,height:24,borderRadius:6,border:`2px solid ${modal.reminderDone?"#4f46e5":"#d1d5db"}`,background:modal.reminderDone?"#4f46e5":"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}} onClick={()=>toggleReminder(modal.id)}>
                {modal.reminderDone&&<span style={{color:"#fff",fontSize:13}}>✓</span>}
              </div>
            </div>}
            {modal.meetDate && <div style={{background:"#f0fdf4",borderRadius:10,padding:"12px 14px",marginBottom:12}}><span style={{fontSize:11,fontWeight:700,color:"#16a34a",letterSpacing:"0.06em"}}>MEETING SCHEDULED</span><div style={{marginTop:4,fontSize:14}}>{modal.meetDate}</div>{modal.meetLink&&<a href={modal.meetLink} target="_blank" rel="noreferrer" style={{fontSize:13,color:"#4f46e5",display:"block",marginTop:4}}>{modal.meetLink}</a>}</div>}
            <div style={{display:"flex",gap:10,marginTop:8,flexWrap:"wrap"}}>
              <button style={{...S.btn,flex:1,fontSize:13,padding:"10px 16px",background:"#eef2ff",color:"#4f46e5"}} onClick={()=>{setModal(null);openEmail(modal);}}>✉ Send Intro Email</button>
              <button style={{...S.btn,flex:1,fontSize:13,padding:"10px 16px",background:"#f0fdf4",color:"#16a34a"}} onClick={()=>{setModal(null);setMeetModal(modal);setMeetSent(false);}}>📅 Schedule Meeting</button>
              <button style={{...S.btnSmOut}} onClick={()=>openEdit(modal)}>✏️ Edit</button>
              <button style={{...S.btnSmOut,color:"#ef4444",borderColor:"#fecaca"}} onClick={()=>deleteContact(modal.id)}>🗑</button>
            </div>
          </div>
        </div>
      )}

      {/* ── EMAIL MODAL ── */}
      {emailModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:20,animation:"fadeIn 0.2s ease"}} onClick={()=>setEmailModal(null)}>
          <div style={{...S.card,maxWidth:560,width:"100%",animation:"fadeUp 0.25s ease"}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div style={{fontFamily:"'DM Serif Display',serif",fontSize:20}}>Intro Email to {emailModal.name}</div>
              <button onClick={()=>setEmailModal(null)} style={{...S.btnSmOut,fontSize:18,padding:"4px 10px"}}>×</button>
            </div>
            <div style={{background:"#f7f8fc",borderRadius:10,padding:"12px 16px",marginBottom:16,fontSize:13,color:"#6b7280"}}>To: <strong style={{color:"#1a1d23"}}>{emailModal.email||"(no email)"}</strong></div>
            {generatingEmail?(
              <div style={{textAlign:"center",padding:"32px 0"}}>
                <div style={{width:36,height:36,border:"3px solid #e0e3ed",borderTopColor:"#4f46e5",borderRadius:"50%",animation:"spin 0.8s linear infinite",margin:"0 auto 14px"}}/>
                <div style={{color:"#4f46e5",fontWeight:600}}>Generating personalised email…</div>
              </div>
            ):emailSent?(
              <div style={{textAlign:"center",padding:"32px 0"}}>
                <div style={{fontSize:48,marginBottom:12}}>✅</div>
                <div style={{fontWeight:700,fontSize:18}}>Email sent!</div>
                <div style={{color:"#6b7280",marginTop:6}}>Intro email delivered to {emailModal.email}</div>
              </div>
            ):(
              <>
                <textarea value={generatedEmail} onChange={e=>setGeneratedEmail(e.target.value)} style={{...S.input,height:220,resize:"none",fontSize:13,lineHeight:1.7,marginBottom:16,fontFamily:"inherit"}}/>
                <div style={{display:"flex",gap:10}}>
                  <button style={{...S.btnOutline,flex:1}} onClick={()=>openEmail(emailModal)} disabled={emailSending}>↺ Regenerate</button>
                  <button style={{...S.btn,flex:2,opacity:emailSending?0.6:1}} onClick={sendEmail} disabled={emailSending}>
                    {emailSending ? "Sending…" : "Send Email ✈"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── MEETING MODAL ── */}
      {meetModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:20,animation:"fadeIn 0.2s ease"}} onClick={()=>setMeetModal(null)}>
          <div style={{...S.card,maxWidth:480,width:"100%",animation:"fadeUp 0.25s ease"}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div style={{fontFamily:"'DM Serif Display',serif",fontSize:20}}>Schedule Meeting</div>
              <button onClick={()=>setMeetModal(null)} style={{...S.btnSmOut,fontSize:18,padding:"4px 10px"}}>×</button>
            </div>
            {meetSent?(
              <div style={{textAlign:"center",padding:"32px 0"}}>
                <div style={{fontSize:48,marginBottom:12}}>🎉</div>
                <div style={{fontWeight:700,fontSize:18}}>Meeting invite sent!</div>
                <div style={{color:"#6b7280",marginTop:6,fontSize:14}}>Google Meet invite sent to {meetModal.email}</div>
              </div>
            ):(
              <>
                <div style={{background:"#f7f8fc",borderRadius:10,padding:"12px 14px",marginBottom:16,fontSize:13}}>Meeting with <strong>{meetModal.name}</strong> · <span style={{color:"#6b7280"}}>{meetModal.email}</span></div>
                <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:14,marginBottom:14}}>
                  <div><label style={S.label}>Date</label><input style={S.input} type="date" value={meetDetails.date} onChange={e=>setMeetDetails(d=>({...d,date:e.target.value}))}/></div>
                  <div><label style={S.label}>Time</label><input style={S.input} type="time" value={meetDetails.time} onChange={e=>setMeetDetails(d=>({...d,time:e.target.value}))}/></div>
                </div>
                <div style={{marginBottom:16}}><label style={S.label}>Agenda / Notes</label><textarea style={{...S.input,height:80,resize:"none"}} value={meetDetails.notes} onChange={e=>setMeetDetails(d=>({...d,notes:e.target.value}))} placeholder="What do you want to discuss?"/></div>
                <div style={{background:"#eef2ff",borderRadius:10,padding:"12px 14px",marginBottom:16,fontSize:13}}><span style={{color:"#4f46e5",fontWeight:600}}>📹 Google Meet link will be auto-generated</span><div style={{color:"#6b7280",marginTop:4}}>An invite with Meet link will be sent to {meetModal.email}</div></div>
                <button
                  style={{...S.btn,width:"100%",opacity:(!meetDetails.date||!meetDetails.time||meetSending)?0.5:1}}
                  onClick={sendMeeting}
                  disabled={!meetDetails.date||!meetDetails.time||meetSending}
                >
                  {meetSending ? "Sending…" : "Send Meeting Invite 📅"}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── BOTTOM TAB BAR ── */}
      <div style={{position:"fixed",bottom:0,left:0,right:0,height:64,background:"#fff",borderTop:"1px solid #f0f1f5",display:"flex",alignItems:"stretch",zIndex:200,boxShadow:"0 -2px 12px rgba(0,0,0,0.06)"}}>
        {[
          {t:"contacts", icon:"📋", label:"Contacts"},
          {t:"scan",     icon:"📷", label:"Scan"},
          {t:"qr",       icon:"⬛", label:"My QR"},
          {t:"add",      icon:"＋", label:"Add"},
        ].map(({t,icon,label})=>(
          <button key={t}
            onClick={()=>{setTab(t);if(t==="add"){setAddStep("form");setScanPreview(null);setEditingContact(null);}if(t==="scan"){setScanErr("");setScanPreview(null);}setEditingContact(null);}}
            style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:3,border:"none",background:"none",cursor:"pointer",color:tab===t?"#4f46e5":"#9ca3af",position:"relative",transition:"color 0.15s"}}>
            {tab===t && <div style={{position:"absolute",top:0,left:"20%",right:"20%",height:2,background:"#4f46e5",borderRadius:"0 0 2px 2px"}}/>}
            <span style={{fontSize:isMobile?22:20}}>{icon}</span>
            <span style={{fontSize:10,fontWeight:tab===t?700:500,letterSpacing:"0.01em"}}>{label}</span>
            {t==="contacts" && dueReminders.length>0 && (
              <span style={{position:"absolute",top:8,left:"55%",background:"#ef4444",color:"#fff",borderRadius:"50%",width:15,height:15,fontSize:9,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",lineHeight:1}}>
                {dueReminders.length > 9 ? "9+" : dueReminders.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── AI BOT ── */}
      <div style={{position:"fixed",bottom:76,right:28,zIndex:500}}>
        {!botOpen && (
          <button onClick={()=>setBotOpen(true)} title="Ask NetworQ AI"
            style={{width:56,height:56,borderRadius:"50%",background:"linear-gradient(135deg,#4f46e5,#7c3aed)",border:"none",cursor:"pointer",boxShadow:"0 4px 20px rgba(79,70,229,0.4)",fontSize:24,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff"}}>
            🤖
          </button>
        )}
        {botOpen && (
          <div style={{width:360,height:520,background:"#fff",borderRadius:20,boxShadow:"0 8px 40px rgba(0,0,0,0.18)",display:"flex",flexDirection:"column",animation:"slideUp 0.25s ease",overflow:"hidden"}}>
            <div style={{background:"linear-gradient(135deg,#4f46e5,#7c3aed)",padding:"16px 18px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <div style={{fontSize:22}}>🤖</div>
                <div>
                  <div style={{color:"#fff",fontWeight:700,fontSize:15}}>NetworQ AI</div>
                  <div style={{color:"rgba(255,255,255,0.7)",fontSize:12}}>Ask about your network</div>
                </div>
              </div>
              <button onClick={()=>setBotOpen(false)} style={{background:"rgba(255,255,255,0.2)",border:"none",color:"#fff",borderRadius:8,width:28,height:28,cursor:"pointer",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
            </div>
            <div style={{flex:1,overflowY:"auto",padding:16,display:"flex",flexDirection:"column",gap:10}}>
              {botMessages.length===0 && (
                <div style={{textAlign:"center",padding:"16px 10px"}}>
                  <div style={{fontSize:32,marginBottom:8}}>👋</div>
                  <div style={{fontWeight:600,marginBottom:6,fontSize:15}}>Hi {currentUser?.name?.split(" ")[0]}!</div>
                  <div style={{color:"#6b7280",fontSize:13,lineHeight:1.6,marginBottom:10}}>Ask me anything about your contacts:</div>
                  {["Who did I meet at TechSummit?","Who should I follow up with?","Draft an email to my latest contact"].map(q=>(
                    <button key={q} onClick={()=>sendBotMessage(q)} style={{display:"block",width:"100%",margin:"5px 0",padding:"8px 12px",background:"#f7f8fc",border:"1px solid #e0e3ed",borderRadius:10,fontSize:12,cursor:"pointer",color:"#4f46e5",textAlign:"left"}}>{q}</button>
                  ))}
                </div>
              )}
              {botMessages.map((m,i)=>(
                <div key={i} style={{
                  padding:"10px 14px",fontSize:14,maxWidth:"82%",lineHeight:1.6,whiteSpace:"pre-wrap",wordBreak:"break-word",
                  alignSelf:m.role==="user"?"flex-end":"flex-start",
                  background:m.role==="user"?"#4f46e5":"#f7f8fc",
                  color:m.role==="user"?"#fff":"#1a1d23",
                  borderRadius:m.role==="user"?"16px 16px 4px 16px":"16px 16px 16px 4px"
                }}>{m.content}</div>
              ))}
              {botLoading && (
                <div style={{padding:"10px 14px",background:"#f7f8fc",borderRadius:"16px 16px 16px 4px",alignSelf:"flex-start",display:"flex",gap:5,alignItems:"center"}}>
                  {[0,1,2].map(i=><div key={i} style={{width:7,height:7,borderRadius:"50%",background:"#4f46e5",animation:`pulse 0.9s ease ${i*0.2}s infinite`}}/>)}
                </div>
              )}
              <div ref={botEndRef}/>
            </div>
            <div style={{padding:"12px 14px",borderTop:"1px solid #f0f1f5",display:"flex",gap:8}}>
              <input
                style={{...S.input,flex:1,fontSize:13,padding:"9px 12px"}}
                placeholder="Ask anything…"
                value={botInput}
                onChange={e=>setBotInput(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&sendBotMessage()}
              />
              <button onClick={()=>sendBotMessage()} disabled={!botInput.trim()||botLoading}
                style={{...S.btnSm,background:"#4f46e5",padding:"9px 14px",opacity:(!botInput.trim()||botLoading)?0.5:1}}>↑</button>
            </div>
          </div>
        )}
      </div>

      {/* ── PROFILE MODAL ── */}
      {profileModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",zIndex:400,display:"flex",alignItems:"center",justifyContent:"center",padding:20,animation:"fadeIn 0.2s ease"}} onClick={()=>setProfileModal(false)}>
          <div style={{...S.card,maxWidth:520,width:"100%",maxHeight:"90vh",overflowY:"auto",animation:"fadeUp 0.25s ease"}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div style={{fontFamily:"'DM Serif Display',serif",fontSize:22}}>Edit Profile</div>
              <button onClick={()=>setProfileModal(false)} style={{...S.btnSmOut,fontSize:18,padding:"4px 10px"}}>×</button>
            </div>
            <div style={{background:"#f7f8fc",borderRadius:10,padding:"10px 14px",marginBottom:20,fontSize:13,color:"#6b7280"}}>
              📧 {currentUser?.email} <span style={{marginLeft:8,fontSize:11}}>(email cannot be changed)</span>
            </div>
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:14,marginBottom:14}}>
              <div><label style={S.label}>Full Name *</label><input style={S.input} value={profileForm.name} onChange={e=>setProfileForm(f=>({...f,name:e.target.value}))} placeholder="Your name"/></div>
              <div><label style={S.label}>Phone</label><input style={S.input} value={profileForm.phone} onChange={e=>setProfileForm(f=>({...f,phone:e.target.value}))} placeholder="+91 98765 43210"/></div>
              <div><label style={S.label}>Company *</label><input style={S.input} value={profileForm.company} onChange={e=>setProfileForm(f=>({...f,company:e.target.value}))} placeholder="Acme Corp"/></div>
              <div><label style={S.label}>Your Role *</label><input style={S.input} value={profileForm.role} onChange={e=>setProfileForm(f=>({...f,role:e.target.value}))} placeholder="Founder, CTO…"/></div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:14,marginBottom:14}}>
              <div><label style={S.label}>Sector</label>
                <select style={{...S.input,background:"#f7f8fc"}} value={profileForm.sector} onChange={e=>setProfileForm(f=>({...f,sector:e.target.value}))}>
                  <option value="">Select sector…</option>{SECTORS.map(s=><option key={s}>{s}</option>)}
                </select>
              </div>
              <div><label style={S.label}>LinkedIn</label><input style={S.input} value={profileForm.linkedin} onChange={e=>setProfileForm(f=>({...f,linkedin:e.target.value}))} placeholder="linkedin.com/in/…"/></div>
            </div>
            <div style={{marginBottom:20}}><label style={S.label}>Company Bio / Pitch</label>
              <textarea style={{...S.input,height:80,resize:"none"}} value={profileForm.bio} onChange={e=>setProfileForm(f=>({...f,bio:e.target.value}))} placeholder="What does your company do?"/>
            </div>
            <div style={{display:"flex",gap:10}}>
              <button style={{...S.btnOutline,flex:1}} onClick={()=>setProfileModal(false)}>Cancel</button>
              <button style={{...S.btn,flex:2,opacity:(!profileForm.name||savingProfile)?0.5:1}} onClick={updateProfile} disabled={!profileForm.name||savingProfile}>
                {savingProfile ? "Saving…" : "Save Profile ✓"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── TOAST ── */}
      {toast && (
        <div style={{
          position:"fixed", bottom:76, left:"50%", transform:"translateX(-50%)",
          background: toast.type === "success" ? "#16a34a" : "#ef4444",
          color:"#fff", padding:"12px 24px", borderRadius:12, fontSize:14,
          fontWeight:600, zIndex:600, animation:"fadeUp 0.3s ease",
          boxShadow:"0 4px 20px rgba(0,0,0,0.18)", whiteSpace:"nowrap",
          display:"flex", alignItems:"center", gap:8,
        }}>
          <span>{toast.type === "success" ? "✅" : "❌"}</span>
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}
