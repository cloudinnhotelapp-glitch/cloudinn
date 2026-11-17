// Dashboard favourites of the signed-in user (/api/v1/favourites): a page the role cannot open is never returned or accepted, so a favourite cannot outlive a permission.
import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, Put, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsString, MaxLength } from 'class-validator';
import { FAVOURITE_ITEMS, SESSION_COOKIES, hasPermission, type FavouriteItem, type FavouritesResponse } from '@hms/shared';
import type { BusinessAuthContext } from '../../auth/auth-context.js';
import { BusinessSessionGuard } from '../../auth/business-session.guard.js';
import { CurrentBusinessUser, RequirePermissions } from '../../auth/decorators/auth.decorators.js';
import { PrismaService } from '../../prisma/prisma.service.js';

// The full ordered list of the user's favourites.
export class SaveFavouritesDto {
  @ApiProperty({ type: [String], example: ['guests', 'calendar'] })
  @IsArray()
  @ArrayMaxSize(FAVOURITE_ITEMS.length)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  keys!: string[];
}

// Service reading and replacing one user's favourites, always limited to that user and business.
@Injectable()
export class FavouritesService {
  constructor(private readonly prisma: PrismaService) {}

  // Returns the user's favourites in order, leaving out anything their role can no longer open.
  async get(auth: BusinessAuthContext): Promise<FavouritesResponse> {
    const available = FAVOURITE_ITEMS.filter((item) => hasPermission(auth.role, item.permission));
    const rows = await this.prisma.userFavourite.findMany({ where: { userId: auth.userId, businessId: auth.businessId }, orderBy: { sortOrder: 'asc' } });
    const favourites = rows.map((row) => available.find((item) => item.key === row.itemKey)).filter((item): item is FavouriteItem => item !== undefined);
    return { favourites, available };
  }

  // Replaces the user's favourites with the given ordered list.
  async save(auth: BusinessAuthContext, keys: string[]): Promise<FavouritesResponse> {
    if (new Set(keys).size !== keys.length) throw new BadRequestException(['Each page can be added once.']);
    for (const key of keys) {
      const item = FAVOURITE_ITEMS.find((candidate) => candidate.key === key);
      if (!item) throw new BadRequestException([`Unknown page: ${key.slice(0, 60)}.`]);
      if (!hasPermission(auth.role, item.permission)) throw new ForbiddenException('Your role does not allow this page.');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.userFavourite.deleteMany({ where: { userId: auth.userId, businessId: auth.businessId } });
      await tx.userFavourite.createMany({ data: keys.map((itemKey, sortOrder) => ({ businessId: auth.businessId, userId: auth.userId, itemKey, sortOrder })) });
    });
    return this.get(auth);
  }
}

// Favourites of the signed-in user.
@ApiTags('favourites')
@ApiCookieAuth(SESSION_COOKIES.businessUser.session)
@UseGuards(BusinessSessionGuard)
@RequirePermissions('dashboard.view')
@Controller('favourites')
export class FavouritesController {
  constructor(private readonly favourites: FavouritesService) {}

  // The user's favourites and the pages they may add.
  @Get()
  @ApiOperation({ summary: 'Favourites of the current user' })
  get(@CurrentBusinessUser() auth: BusinessAuthContext): Promise<FavouritesResponse> {
    return this.favourites.get(auth);
  }

  // Saves the whole ordered list (add, remove, and reorder all use this).
  @Put()
  @ApiOperation({ summary: 'Save the favourites of the current user' })
  save(@CurrentBusinessUser() auth: BusinessAuthContext, @Body() body: SaveFavouritesDto): Promise<FavouritesResponse> {
    return this.favourites.save(auth, body.keys);
  }
}
