// Room-types module: one service shared by the business-user and Super Admin room-type endpoints.
import { Module } from '@nestjs/common';
import { RoomTypesController, SuperAdminRoomTypesController } from './room-types.controller.js';
import { RoomTypesService } from './room-types.service.js';

// Registers the room-type service and both controllers.
@Module({
  controllers: [RoomTypesController, SuperAdminRoomTypesController],
  providers: [RoomTypesService],
  exports: [RoomTypesService],
})
export class RoomTypesModule {}
