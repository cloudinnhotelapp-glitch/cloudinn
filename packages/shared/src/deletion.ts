// Shapes for the Super Admin's Delete action on management records (businesses, business users, locations, floors,
// room types, rooms). Records are deleted physically only when nothing refers to them; records with history are
// archived (kept, but hidden from normal lists and no longer usable); records that cannot be removed safely are blocked.

// What a Delete would do to the record right now.
export type DeletionAction = 'DELETE' | 'ARCHIVE' | 'BLOCKED';

// One kind of linked record and how many there are (for the confirmation dialog).
export interface LinkedRecordCount {
  label: string;
  count: number;
}

// Answer of the "deletion check" endpoints, shown in the confirmation dialog before the user confirms.
export interface DeletionCheck {
  action: DeletionAction;
  /** Plain-language explanation of what will happen (or why it cannot happen). */
  summary: string;
  /** Reasons the record cannot be deleted or archived now; empty unless action is BLOCKED. */
  blockers: string[];
  /** Linked records that will be kept (shown for context). */
  linked: LinkedRecordCount[];
}

// Answer of a successful DELETE request.
export interface DeletionResult {
  outcome: 'DELETED' | 'ARCHIVED';
  message: string;
}
