// Makes the single PrismaService available to every module without re-importing it.
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

// Global module that provides and exports the shared database client.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
