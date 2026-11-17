// The Room Status page: the room board (counters, filters, and room cards with their actions) under its own heading, for
// roles that may view room status (owner decision 2026-11-12).
'use client';

import { EmptyState, LoadingState } from '@/components/ui/states';
import { useBusinessSession } from './business-session';
import { RoomStatusBoardView } from './room-status-board-view';

// Waits for the session, then shows the board.
export function RoomStatusPage() {
  const { info, can } = useBusinessSession();
  if (!info) return <LoadingState />;
  if (!can('roomStatus.view')) return <EmptyState message="You do not have access to room status." />;
  return <RoomStatusBoardView title="Room Status" idPrefix="room-status" />;
}
