// Creates test accounts for the browser (Playwright) tests in the test database only, and writes their random
// passwords to a temporary file outside the repository. Refuses to run against any database not ending in "_test".
import { writeFileSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { todayInTimeZone } from '../../src/common/time/location-date.js';
import { hashPassword } from '../../src/auth/password/argon2id.js';
import { createSuperAdmin, createTenant, randomPassword, uniqueSuffix, type TestTenant } from './fixtures.js';
import { requireTestDatabaseUrl } from './test-database.js';

// Output file path given by the Playwright global setup.
const outputFile = process.argv[2];
if (!outputFile) {
  console.error('Usage: tsx test/support/ui-fixture.ts <output-json-file>');
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: requireTestDatabaseUrl() }) });

// A date "offset" days from today at the fixture hotels (Asia/Kolkata), as a date-only value.
function hotelDay(offset: number): Date {
  return new Date(Date.parse(`${todayInTimeZone('Asia/Kolkata')}T00:00:00Z`) + offset * 86_400_000);
}

// Puts a guest in house in the tenant's first location: checked in "from" days ago (negative) with the expected checkout
// "to" days from today; returns the room number and guest name.
async function inHouseStay(tenant: TestTenant, roomIndex: number, from: number, to: number, name: string): Promise<{ roomNumber: string; guestName: string }> {
  const location = tenant.locations[0]!;
  const roomId = location.roomIds[roomIndex]!;
  const scope = { businessId: tenant.businessId, locationId: location.id };
  const guestName = `${name} ${uniqueSuffix()}`;
  const guest = await prisma.guest.create({ data: { businessId: tenant.businessId, fullName: guestName } });
  const reservation = await prisma.reservation.create({
    data: { ...scope, reservationNumber: `T-${uniqueSuffix()}`, guestId: guest.id, status: 'CHECKED_IN', checkInDate: hotelDay(from), checkOutDate: hotelDay(to), createdByUserId: tenant.users.ADMIN.id },
  });
  const allocation = await prisma.reservationRoom.create({
    data: { ...scope, reservationId: reservation.id, roomId, startDate: hotelDay(from), endDate: hotelDay(to), status: 'CHECKED_IN', nightlyRate: '3000.00' },
  });
  await prisma.stay.create({ data: { ...scope, reservationRoomId: allocation.id, checkedInByUserId: tenant.users.ADMIN.id, expectedCheckOutDate: hotelDay(to) } });
  const room = await prisma.room.update({ where: { id: roomId }, data: { occupancyStatus: 'OCCUPIED' }, select: { roomNumber: true } });
  return { roomNumber: room.roomNumber, guestName };
}

// Creates: a Super Admin with a temporary password, a second Super Admin ready to use the console; a business with two locations (Admin and Manager assigned to both,
// Receptionist to the first, one room needing cleaning); and a business whose users must change their temporary password.
async function main(): Promise<void> {
  const [{ current_database: name }] = await prisma.$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
  if (!name.endsWith('_test')) throw new Error(`Refusing to create UI fixtures in "${name}".`);

  const superAdmin = await createSuperAdmin(prisma, true);
  const consoleAdmin = await createSuperAdmin(prisma, false);
  const hotel = await createTenant(prisma, { locationCount: 2, roomsPerLocation: 3, assignments: { RECEPTIONIST: [0] } });
  await prisma.room.update({ where: { id: hotel.locations[0]!.roomIds[1]! }, data: { housekeepingStatus: 'DIRTY' } });
  const pending = await createTenant(prisma, { mustChangePassword: true });
  // For the location-switcher and calendar tests, kept apart so their bookings and deactivations cannot disturb other tests.
  const branches = await createTenant(prisma, { locationCount: 2, roomsPerLocation: 3 });
  const closing = await createTenant(prisma, { locationCount: 2 });
  const solo = await createTenant(prisma);
  const calendar = await createTenant(prisma, { locationCount: 2, roomsPerLocation: 3, assignments: { RECEPTIONIST: [0] } });
  // For the attendance, theme, favourites, ads, and salary tests; the attendance businesses have an area at each location.
  const attendance = await createTenant(prisma, { locationCount: 2 });
  const attendanceErrors = await createTenant(prisma, { locationCount: 2 });
  for (const tenant of [attendance, attendanceErrors]) {
    await prisma.location.update({ where: { id: tenant.locations[0]!.id }, data: { attendanceLatitude: 10, attendanceLongitude: 76, attendanceRadiusMeters: 100 } });
    await prisma.location.update({ where: { id: tenant.locations[1]!.id }, data: { attendanceLatitude: 11, attendanceLongitude: 77, attendanceRadiusMeters: 100 } });
  }
  const office = await createTenant(prisma);
  // For the Staff login tests: one location with an attendance area.
  const staffPortal = await createTenant(prisma);
  await prisma.location.update({ where: { id: staffPortal.locations[0]!.id }, data: { attendanceLatitude: 10, attendanceLongitude: 76, attendanceRadiusMeters: 100 } });
  const favourites = await createTenant(prisma);
  const sweep = await createTenant(prisma);
  // For the WhatsApp advertisement tests (its own business, so the Ads tests of "office" are not affected).
  const whatsapp = await createTenant(prisma);
  // For the Room Availability Status tests (they leave a walk-in guest in a room, so they must not share rooms with others).
  const availability = await createTenant(prisma, { roomsPerLocation: 3 });
  // For the Property Setup editing tests (they add floors, room types, and rooms, so they get their own business).
  const propertyEdit = await createTenant(prisma);
  // For the room shift tests (a guest moves between rooms, so they get their own rooms).
  const roomShift = await createTenant(prisma, { roomsPerLocation: 3 });
  // For the header's "Check-outs today" notification: one guest due to leave today and one overdue since yesterday.
  const departures = await createTenant(prisma, { roomsPerLocation: 3 });
  const departuresGuests = {
    dueToday: await inHouseStay(departures, 0, -2, 0, 'Departing Guest'),
    overdue: await inHouseStay(departures, 1, -3, -1, 'Overdue Guest'),
  };
  // For the housekeeping tests: a Staff member with a Staff app login at the first location, and a room left needing
  // cleaning by a checkout.
  const housekeeping = await createTenant(prisma, { roomsPerLocation: 3 });
  const housekeepingStaff = { name: `Kavya Cleaner ${uniqueSuffix()}`, username: `kavya.${uniqueSuffix()}`, password: randomPassword() };
  const cleaner = await prisma.businessUser.create({
    data: {
      businessId: housekeeping.businessId,
      role: 'STAFF',
      name: housekeepingStaff.name,
      username: housekeepingStaff.username,
      employeeCode: `HK-${uniqueSuffix().slice(0, 6)}`,
      passwordHash: await hashPassword(housekeepingStaff.password),
      mustChangePassword: false,
    },
  });
  await prisma.userLocationAssignment.create({ data: { businessId: housekeeping.businessId, userId: cleaner.id, locationId: housekeeping.locations[0]!.id } });
  await prisma.room.update({ where: { id: housekeeping.locations[0]!.roomIds[0]! }, data: { housekeepingStatus: 'DIRTY' } });
  await prisma.housekeepingTask.create({ data: { businessId: housekeeping.businessId, locationId: housekeeping.locations[0]!.id, roomId: housekeeping.locations[0]!.roomIds[0]!, source: 'CHECKOUT' } });
  const extra = (tenant: typeof branches) => ({ businessId: tenant.businessId, guestId: tenant.guestId, users: tenant.users, locations: tenant.locations });
  const businessNames = await prisma.business.findMany({ where: { id: { in: [hotel.businessId, pending.businessId] } }, select: { id: true, name: true } });
  const nameOf = (id: string) => businessNames.find((business) => business.id === id)!.name;

  writeFileSync(
    outputFile!,
    JSON.stringify({
      superAdmin: { email: superAdmin.email, password: superAdmin.password },
      consoleAdmin: { email: consoleAdmin.email, password: consoleAdmin.password },
      businessAdmin: hotel.users.ADMIN,
      hotel: {
        businessId: hotel.businessId,
        businessName: nameOf(hotel.businessId),
        users: hotel.users,
        locations: hotel.locations.map(({ id, name: locationName }) => ({ id, name: locationName })),
      },
      pending: { businessId: pending.businessId, businessName: nameOf(pending.businessId), locations: pending.locations.map(({ id, name: n }) => ({ id, name: n })) },
      pendingUser: pending.users.RECEPTIONIST,
      branches: extra(branches),
      closing: extra(closing),
      solo: extra(solo),
      calendar: extra(calendar),
      attendance: extra(attendance),
      attendanceErrors: extra(attendanceErrors),
      office: extra(office),
      favourites: extra(favourites),
      sweep: extra(sweep),
      staffPortal: extra(staffPortal),
      whatsapp: extra(whatsapp),
      availability: extra(availability),
      propertyEdit: extra(propertyEdit),
      roomShift: extra(roomShift),
      departures: { ...extra(departures), guests: departuresGuests },
      housekeeping: { ...extra(housekeeping), staff: housekeepingStaff },
    }),
    { encoding: 'utf8', mode: 0o600 },
  );
  console.log(`UI fixtures created in "${name}".`);
}

// Runs the fixture creation and always closes the connection.
main()
  .catch((error: unknown) => {
    console.error('UI fixture failed:', error instanceof Error ? error.message.replace(/postgres(ql)?:\/\/\S+/g, '<redacted>') : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
