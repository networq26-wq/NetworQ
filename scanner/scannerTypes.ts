// Structured data segregation for scanned cards matching Part 23 of Master Spec

export interface ScannedPerson {
  firstName: string;
  lastName: string;
  title: string;
  email: string;
  phone: string;
}

export interface ScannedCompany {
  companyName: string;
  domain: string;
  industry: string;
  companyPhone: string;
  companyEmail: string;
  address: string;
}

export interface ScannedSocial {
  linkedin: string;
  instagram: string;
  twitter: string;
  facebook: string;
  youtube: string;
}

export interface ScannedAddress {
  street: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
}

export interface ScannedCardDetails {
  person: ScannedPerson;
  company: ScannedCompany;
  social: ScannedSocial;
  address: ScannedAddress;
  other: {
    qrData?: string;
    website: string;
    department: string;
    notes: string;
    event?: string;
  };
  needsReviewFields: string[];
  rawText?: string;
}

export type BatchItemStatus = "waiting" | "processing" | "complete" | "needs_review" | "failed";

export interface BatchScanItem {
  id: string;
  file: File | Blob;
  previewUrl: string;
  status: BatchItemStatus;
  progressPercent: number;
  extracted?: ScannedCardDetails;
  error?: string;
  duplicateMatch?: {
    id: string;
    name: string;
    company?: string;
    email?: string;
    phone?: string;
  };
}
