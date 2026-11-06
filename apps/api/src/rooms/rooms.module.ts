// Rooms module: room management (shared by business Admins and the Super Admin) and the room status board.
import { Module } from '@nestjs/common';
import { RoomStatusBoardService } from './room-status-board.service.js';
import { RoomsController, SuperAdminRoomsController } from './rooms.controller.js';
import { RoomsService } from './rooms.service.js';

// Registers the room services and both controllers.
@Module({
  controllers: [RoomsController, SuperAdminRoomsController],
  providers: [RoomsService, RoomStatusBoardService],
  exports: [RoomsService],
})
export class RoomsModule {}
