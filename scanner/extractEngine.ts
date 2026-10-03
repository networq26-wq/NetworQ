import type { ScannedCardDetails } from "./scannerTypes";

export async function fileToDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function downscaleImage(dataUrl: string, maxDim = 1600): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width <= maxDim && height <= maxDim) return resolve(dataUrl);
      if (width > height) {
        height = Math.round((height * maxDim) / width);
        width = maxDim;
      } else {
        width = Math.round((width * maxDim) / height);
        height = maxDim;
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(dataUrl);
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", 0.88));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

export async function extractStructuredCard(
  dataUrl: string,
  callAIFn: (messages: any[], systemPrompt: string, options: any) => Promise<string>
): Promise<ScannedCardDetails | null> {
  const mediaType = dataUrl.slice(5, dataUrl.indexOf(";")) || "image/jpeg";
  const base64 = dataUrl.split(",")[1];
  if (!base64) return null;

  const sysPrompt = `You are a high-precision business card OCR and parser. Extract structured contact and company information.
Return ONLY valid JSON matching this schema:
{
  "person": {
    "firstName": string,
    "lastName": string,
    "title": string,
    "email": string,
    "phone": string
  },
  "company": {
    "companyName": string,
    "domain": string,
    "industry": string,
    "companyPhone": string,
    "companyEmail": string,
    "address": string
  },
  "social": {
    "linkedin": string,
    "instagram": string,
    "twitter": string,
    "facebook": string,
    "youtube": string
  },
  "address": {
    "street": string,
    "city": string,
    "state": string,
    "country": string,
    "postalCode": string
  },
  "other": {
    "website": string,
    "department": string,
    "notes": string
  },
  "ambiguousFields": string[]
}

Rules:
1. Do not guess or fabricate information. Use "" for missing or unclear fields.
2. If text is faint, partially cut off, or questionable, include the field name in "ambiguousFields" (e.g. ["person.email"]).
3. Ensure emails contain "@" and valid domain format; otherwise mark ambiguous.
4. Format phone numbers cleanly with country codes if present.`;

  try {
    const rawResponse = await callAIFn(
      [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:${mediaType};base64,${base64}` } },
            { type: "text", text: "Extract all business card fields into structured segregated JSON." },
          ],
        },
      ],
      sysPrompt,
      { action: "card_scan", max_tokens: 1000 }
    );

    const cleaned = rawResponse
      .replace(/<think>[\s\S]*?<\/think>/g, "")
      .replace(/```json|```/g, "")
      .trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;

    const p = JSON.parse(match[0]);

    // Validation & fallback normalization
    const cleanStr = (v: any) => (typeof v === "string" && v.trim().toLowerCase() !== "null" ? v.trim() : "");

    const firstName = cleanStr(p.person?.firstName);
    const lastName = cleanStr(p.person?.lastName);
    const fullName = [firstName, lastName].filter(Boolean).join(" ");
    const company = cleanStr(p.company?.companyName);
    const email = cleanStr(p.person?.email);
    const phone = cleanStr(p.person?.phone);

    // Require at least one identifying property
    if (!fullName && !email && !phone && !company) {
      return null;
    }

    const ambiguous: string[] = Array.isArray(p.ambiguousFields) ? p.ambiguousFields : [];

    // Simple heuristic check for phone / email validity
    if (email && (!email.includes("@") || !email.includes("."))) {
      ambiguous.push("email");
    }
    if (phone && phone.replace(/\D/g, "").length < 7) {
      ambiguous.push("phone");
    }

    const details: ScannedCardDetails = {
      person: {
        firstName,
        lastName,
        title: cleanStr(p.person?.title),
        email,
        phone,
      },
      company: {
        companyName: company,
        domain: cleanStr(p.company?.domain),
        industry: cleanStr(p.company?.industry),
        companyPhone: cleanStr(p.company?.companyPhone),
        companyEmail: cleanStr(p.company?.companyEmail),
        address: cleanStr(p.company?.address),
      },
      social: {
        linkedin: cleanStr(p.social?.linkedin),
        instagram: cleanStr(p.social?.instagram),
        twitter: cleanStr(p.social?.twitter),
        facebook: cleanStr(p.social?.facebook),
        youtube: cleanStr(p.social?.youtube),
      },
      address: {
        street: cleanStr(p.address?.street),
        city: cleanStr(p.address?.city),
        state: cleanStr(p.address?.state),
        country: cleanStr(p.address?.country),
        postalCode: cleanStr(p.address?.postalCode),
      },
      other: {
        website: cleanStr(p.other?.website) || cleanStr(p.company?.domain),
        department: cleanStr(p.other?.department),
        notes: cleanStr(p.other?.notes),
      },
      needsReviewFields: Array.from(new Set(ambiguous)),
    };

    return details;
  } catch (err) {
    console.warn("Structured extraction error:", err);
    return null;
  }
}

/** Check if card matches any existing contact */
export function findDuplicateContact(
  card: ScannedCardDetails,
  existingContacts: any[]
): any | null {
  const norm = (s?: string) => (s || "").toLowerCase().trim();
  const cardEmail = norm(card.person.email);
  const cardPhone = (card.person.phone || "").replace(/\D/g, "");
  const cardName = norm(`${card.person.firstName} ${card.person.lastName}`.trim());
  const cardCompany = norm(card.company.companyName);

  for (const c of existingContacts) {
    const cEmail = norm(c.email);
    const cPhone = (c.phone || "").replace(/\D/g, "");
    const cName = norm(c.name);
    const cCompany = norm(c.company);

    if (cardEmail && cEmail && cardEmail === cEmail) return c;
    if (cardPhone.length >= 7 && cPhone.length >= 7 && cardPhone === cPhone) return c;
    if (cardName && cName && cardName === cName && cardCompany && cCompany && cardCompany === cCompany) {
      return c;
    }
  }
  return null;
}
