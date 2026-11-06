// Builds isolated test data (a business with locations, rooms, users, and a guest) with unique names and random passwords.
// Each test creates its own tenant, so tests never need to delete or truncate anything.
import { randomBytes, randomUUID } from 'node:crypto';
import type { BusinessRole } from '@hms/shared';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { hashPassword } from '../../src/auth/password/argon2id.js';

// Creates a random password that satisfies the policy (generated at run time; nothing is hard-coded).
export function randomPassword(): string {
  return `Pw-${randomBytes(12).toString('base64url')}-9a`;
}

// Creates a short unique suffix for names and emails.
export function uniqueSuffix(): string {
  return randomUUID().slice(0, 8);
}

// A created business user together with the plaintext password kept only in test memory.
export interface TestUser {
  id: string;
  email: string;
  password: string;
  role: BusinessRole;
}

// One created location with its rooms.
export interface TestLocation {
  id: string;
  name: string;
  roomIds: string[];
}

// Everything created for one test tenant.
export interface TestTenant {
  businessId: string;
  locations: TestLocation[];
  users: Record<BusinessRole, TestUser>;
  guestId: string;
}

// Options for building a tenant.
export interface TenantOptions {
  locationCount?: number;
  roomsPerLocation?: number;
  /** Which location indexes each role is assigned to (default: every role gets every location). */
  assignments?: Partial<Record<BusinessRole, number[]>>;
  mustChangePassword?: boolean;
}

// Creates a business with locations, a floor and room type per location, rooms, one user per role, and a guest.
export async function createTenant(prisma: PrismaClient, options: TenantOptions = {}): Promise<TestTenant> {
  const suffix = uniqueSuffix();
  const locationCount = options.locationCount ?? 1;
  const roomsPerLocation = options.roomsPerLocation ?? 2;
  const business = await prisma.business.create({ data: { name: `Test Hotel ${suffix}` } });

  const locations: TestLocation[] = [];
  for (let i = 0; i < locationCount; i++) {
    const location = await prisma.location.create({
      data: {
        businessId: business.id,
        name: `Location ${i + 1} ${suffix}`,
        code: `L${i + 1}${suffix.slice(0, 4)}`.toUpperCase(),
        timezone: 'Asia/Kolkata',
        currencyCode: 'INR',
        taxRatePercent: '12.00',
      },
    });
    const floor = await prisma.floor.create({ data: { businessId: business.id, locationId: location.id, name: 'Ground' } });
    const roomType = await prisma.roomType.create({
      data: { businessId: business.id, locationId: location.id, name: 'Deluxe', defaultStandardRate: '3000.00' },
    });
    const roomIds: string[] = [];
    for (let r = 0; r < roomsPerLocation; r++) {
      const room = await prisma.room.create({
        data: {
          businessId: business.id,
          locationId: location.id,
          floorId: floor.id,
          roomTypeId: roomType.id,
          roomNumber: `${101 + r}`,
          capacity: 2,
          standardRate: '3000.00',
          extraBedRate: '500.00',
        },
      });
      roomIds.push(room.id);
    }
    locations.push({ id: location.id, name: location.name, roomIds });
  }

  const roles: BusinessRole[] = ['ADMIN', 'MANAGER', 'RECEPTIONIST'];
  const users = {} as Record<BusinessRole, TestUser>;
  for (const role of roles) {
    const password = randomPassword();
    const email = `${role.toLowerCase()}.${suffix}@hotel.test`;
    const user = await prisma.businessUser.create({
      data: {
        businessId: business.id,
        email,
        name: `${role} User`,
        role,
        passwordHash: await hashPassword(password),
        mustChangePassword: options.mustChangePassword ?? false,
      },
    });
    const indexes = options.assignments?.[role] ?? locations.map((_, index) => index);
    for (const index of indexes) {
      await prisma.userLocationAssignment.create({
        data: { businessId: business.id, userId: user.id, locationId: locations[index]!.id },
      });
    }
    users[role] = { id: user.id, email, password, role };
  }

  const guest = await prisma.guest.create({ data: { businessId: business.id, fullName: `Guest ${suffix}` } });
  return { businessId: business.id, locations, users, guestId: guest.id };
}

// A created Super Admin with the plaintext password kept only in test memory.
export interface TestSuperAdmin {
  id: string;
  email: string;
  password: string;
}

// Creates a Super Admin directly in the test database.
export async function createSuperAdmin(prisma: PrismaClient, mustChangePassword = true): Promise<TestSuperAdmin> {
  const password = randomPassword();
  const email = `sa.${uniqueSuffix()}@platform.test`;
  const admin = await prisma.superAdmin.create({
    data: { email, name: 'Test Super Admin', passwordHash: await hashPassword(password), mustChangePassword },
  });
  return { id: admin.id, email, password };
}
