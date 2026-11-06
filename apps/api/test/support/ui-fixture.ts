// Creates test accounts for the browser (Playwright) tests in the test database only, and writes their random
// passwords to a temporary file outside the repository. Refuses to run against any database not ending in "_test".
import { writeFileSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { createSuperAdmin, createTenant } from './fixtures.js';
import { requireTestDatabaseUrl } from './test-database.js';

// Output file path given by the Playwright global setup.
const outputFile = process.argv[2];
if (!outputFile) {
  console.error('Usage: tsx test/support/ui-fixture.ts <output-json-file>');
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: requireTestDatabaseUrl() }) });

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
