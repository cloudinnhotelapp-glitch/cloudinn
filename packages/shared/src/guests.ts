// Guest shapes shared by the API and the web app (Phase 6.1). Guests belong to a business (not to one location), so every
// location of the business sees the same guest list. Dates are ISO strings, exactly as they arrive in JSON.

// Identity document kinds, mirrored from the database enum GuestDocumentType.
export const GUEST_DOCUMENT_TYPES = ['PASSPORT', 'NATIONAL_ID', 'DRIVING_LICENSE', 'VISA', 'OTHER'] as const;

// One identity document kind.
export type GuestDocumentType = (typeof GUEST_DOCUMENT_TYPES)[number];

// Display labels for identity document kinds.
export const GUEST_DOCUMENT_TYPE_LABELS: Readonly<Record<GuestDocumentType, string>> = {
  PASSPORT: 'Passport',
  NATIONAL_ID: 'National ID',
  DRIVING_LICENSE: 'Driving licence',
  VISA: 'Visa',
  OTHER: 'Other ID',
};

// One row of the guest list. The ID number is masked (last 4 characters only); the full number is on the detail view.
export interface GuestSummary {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  country: string | null;
  nationality: string | null;
  idDocumentType: GuestDocumentType | null;
  /** For example "•••• 4321"; null when no ID number is recorded. */
  idDocumentNumberMasked: string | null;
  reservationCount: number;
  createdAt: string;
}

// The full guest profile. `notes` is present only for roles allowed to read restricted notes (`notesVisible` says which).
export interface GuestDetail extends Omit<GuestSummary, 'idDocumentNumberMasked'> {
  addressLine: string | null;
  state: string | null;
  postalCode: string | null;
  /** Date only, "YYYY-MM-DD". */
  dateOfBirth: string | null;
  idDocumentNumber: string | null;
  notesVisible: boolean;
  notes: string | null;
  /** Uploaded ID files (Phase 6.2 adds uploads); deleted files are not counted. */
  documentCount: number;
  updatedAt: string;
}

// Largest ID file the server accepts (5 MB), and the most stored files one guest may have.
export const GUEST_DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;
export const GUEST_DOCUMENT_MAX_PER_GUEST = 20;

// File kinds accepted for ID documents: JPG/JPEG, PNG, and PDF (the server checks the extension, the browser's type,
// and the file's actual content).
export const GUEST_DOCUMENT_CONTENT_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const;
export type GuestDocumentContentType = (typeof GUEST_DOCUMENT_CONTENT_TYPES)[number];

// Value for a file input's "accept" attribute.
export const GUEST_DOCUMENT_ACCEPT = '.jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf';

// One uploaded ID file of a guest (metadata only: the file itself is fetched through the authorized content endpoint,
// never through a public link).
export interface GuestDocumentSummary {
  id: string;
  documentType: GuestDocumentType;
  /** The name the file had on the uploader's computer (cleaned up; shown for recognition only, never used for storage). */
  fileName: string;
  contentType: GuestDocumentContentType;
  sizeBytes: number;
  uploadedBy: { id: string; name: string };
  location: { id: string; name: string };
  uploadedAt: string;
}