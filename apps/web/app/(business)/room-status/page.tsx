// Room status board page (/room-status).
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui/states';
import { RoomStatusBoardView } from '@/features/business/room-status-board-view';

// Renders the page body inside Suspense, because it reads URL data that is only known at request time.
export default function RoomStatusPage() {
  return <Suspense fallback={<LoadingState />}><RoomStatusBoardView /></Suspense>;
}