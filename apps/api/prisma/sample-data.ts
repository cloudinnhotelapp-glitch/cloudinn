// Sample data for local development (owner requests 2026-11-16): three businesses, each with two locations, two floors
// and three room types per location, twelve rooms per location (six per floor; rooms 106 and 206 were added later and are
// added to existing sample locations that lack them), and four business users (Admin, Manager, and a Receptionist
// for each location). Additive and idempotent: a business that already exists (by name) is skipped, nothing is updated
// or deleted (only missing sample rooms are added to an existing sample location). Refuses the test and shadow databases, production, and any database not on this computer (so never Neon).
// The users' random passwords are written only to a local file that Git ignores (sample-logins.local.md at the repository
// root); they are never printed.
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { hashPassword } from '../src/auth/password/argon2id.js';
import { checkPasswordPolicy } from '../src/auth/password/password-policy.js';
import { databaseNameFromUrl, seedRefusalReason } from '../src/common/database/seed-safety.js';

// Stops with a readable message (no secrets) and a failing exit code.
function fail(message: string): never {
  console.error(`Sample data refused: ${message}`);
  process.exit(1);
}

// Loads the repository-root .env file (existing environment variables take priority).
const repoRoot = path.resolve(process.cwd(), '../..');
const rootEnvFile = path.join(repoRoot, '.env');
if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) fail('DATABASE_URL is not set');
let host = '';
try {
  host = new URL(databaseUrl).hostname;
} catch {
  fail('DATABASE_URL could not be read');
}
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) fail('the database is not on this computer (only a local development database may get sample data)');
const protectedDatabaseNames = [process.env.TEST_DATABASE_URL, process.env.SHADOW_DATABASE_URL].map(databaseNameFromUrl);
const urlRefusal = seedRefusalReason({ nodeEnv: process.env.NODE_ENV, databaseName: databaseNameFromUrl(databaseUrl), protectedDatabaseNames });
if (urlRefusal) fail(urlRefusal);

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

// One sample location.
interface SampleLocation {
  name: string;
  code: string;
  address: string;
  phone: string;
}

// One sample business user; "locations" are indexes into the business's locations.
interface SampleUser {
  name: string;
  email: string;
  role: 'ADMIN' | 'MANAGER' | 'RECEPTIONIST';
  locations: number[];
}

// One sample business.
interface SampleBusiness {
  name: string;
  legalName: string;
  contactEmail: string;
  contactPhone: string;
  address: string;
  /** Multiplies the room rates, so the three businesses differ. */
  rateFactor: number;
  locations: [SampleLocation, SampleLocation];
  users: SampleUser[];
}

const BUSINESSES: SampleBusiness[] = [
  {
    name: 'Sea Breeze Resorts',
    legalName: 'Sea Breeze Hospitality Private Limited',
    contactEmail: 'contact@seabreeze.example',
    contactPhone: '+91 484 400 1000',
    address: 'Marine Drive, Kochi, Kerala 682031',
    rateFactor: 1.2,
    locations: [
      { name: 'Sea Breeze Kochi', code: 'SBKOCHI', address: 'Marine Drive, Kochi, Kerala 682031', phone: '+91 484 400 1001' },
      { name: 'Sea Breeze Varkala', code: 'SBVARKALA', address: 'North Cliff, Varkala, Kerala 695141', phone: '+91 470 260 1002' },
    ],
    users: [
      { name: 'Anita Menon', email: 'anita.admin@seabreeze.example', role: 'ADMIN', locations: [0, 1] },
      { name: 'Rahul Nair', email: 'rahul.manager@seabreeze.example', role: 'MANAGER', locations: [0, 1] },
      { name: 'Divya Thomas', email: 'divya.reception@seabreeze.example', role: 'RECEPTIONIST', locations: [0] },
      { name: 'Arjun Pillai', email: 'arjun.reception@seabreeze.example', role: 'RECEPTIONIST', locations: [1] },
    ],
  },
  {
    name: 'Hill Crest Hotels',
    legalName: 'Hill Crest Hotels LLP',
    contactEmail: 'hello@hillcrest.example',
    contactPhone: '+91 4865 230 200',
    address: 'Old Munnar Road, Munnar, Kerala 685612',
    rateFactor: 1,
    locations: [
      { name: 'Hill Crest Munnar', code: 'HCMUNNAR', address: 'Old Munnar Road, Munnar, Kerala 685612', phone: '+91 4865 230 201' },
      { name: 'Hill Crest Ooty', code: 'HCOOTY', address: 'Club Road, Ooty, Tamil Nadu 643001', phone: '+91 423 244 3202' },
    ],
    users: [
      { name: 'Meera Krishnan', email: 'meera.admin@hillcrest.example', role: 'ADMIN', locations: [0, 1] },
      { name: 'Vikram Rao', email: 'vikram.manager@hillcrest.example', role: 'MANAGER', locations: [0, 1] },
      { name: 'Sneha Joseph', email: 'sneha.reception@hillcrest.example', role: 'RECEPTIONIST', locations: [0] },
      { name: 'Karthik Raman', email: 'karthik.reception@hillcrest.example', role: 'RECEPTIONIST', locations: [1] },
    ],
  },
  {
    name: 'City Central Inns',
    legalName: 'City Central Inns Private Limited',
    contactEmail: 'stay@citycentral.example',
    contactPhone: '+91 80 4100 3000',
    address: 'MG Road, Bengaluru, Karnataka 560001',
    rateFactor: 0.9,
    locations: [
      { name: 'City Central Bengaluru', code: 'CCBLR', address: 'MG Road, Bengaluru, Karnataka 560001', phone: '+91 80 4100 3001' },
      { name: 'City Central Chennai', code: 'CCMAA', address: 'Anna Salai, Chennai, Tamil Nadu 600002', phone: '+91 44 4200 3002' },
    ],
    users: [
      { name: 'Priya Sharma', email: 'priya.admin@citycentral.example', role: 'ADMIN', locations: [0, 1] },
      { name: 'Sanjay Kumar', email: 'sanjay.manager@citycentral.example', role: 'MANAGER', locations: [0, 1] },
      { name: 'Lakshmi Iyer', email: 'lakshmi.reception@citycentral.example', role: 'RECEPTIONIST', locations: [0] },
      { name: 'Farhan Ali', email: 'farhan.reception@citycentral.example', role: 'RECEPTIONIST', locations: [1] },
    ],
  },
];

// The room types of every location, with base rates (multiplied by the business's rate factor).
const ROOM_TYPES = [
  { name: 'Standard', description: 'Cosy room with a queen bed.', capacity: 2, rate: 2500, extraBed: 500, maxExtraBeds: 1 },
  { name: 'Deluxe', description: 'Larger room with a king bed and a sitting area.', capacity: 2, rate: 3500, extraBed: 700, maxExtraBeds: 1 },
  { name: 'Suite', description: 'Bedroom and separate living room, for families.', capacity: 4, rate: 6000, extraBed: 1000, maxExtraBeds: 2 },
] as const;

// Twelve rooms on two floors: room number, floor index, and room type name.
const ROOMS: { number: string; floor: 0 | 1; type: (typeof ROOM_TYPES)[number]['name'] }[] = [
  { number: '101', floor: 0, type: 'Standard' },
  { number: '102', floor: 0, type: 'Standard' },
  { number: '103', floor: 0, type: 'Standard' },
  { number: '104', floor: 0, type: 'Deluxe' },
  { number: '105', floor: 0, type: 'Deluxe' },
  { number: '106', floor: 0, type: 'Deluxe' },
  { number: '201', floor: 1, type: 'Deluxe' },
  { number: '202', floor: 1, type: 'Deluxe' },
  { number: '203', floor: 1, type: 'Deluxe' },
  { number: '204', floor: 1, type: 'Suite' },
  { number: '205', floor: 1, type: 'Suite' },
  { number: '206', floor: 1, type: 'Suite' },
];
const FLOORS = ['First Floor', 'Second Floor'];

// A random password that meets the policy for this user.
function passwordFor(user: SampleUser): string {
  for (;;) {
    const password = `Cl-${randomBytes(12).toString('base64url')}-7q`;
    if (checkPasswordPolicy(password, { email: user.email, name: user.name }).length === 0) return password;
  }
}

// Rounds a rate to whole rupees, as text for a decimal column.
const money = (value: number) => (Math.round(value / 10) * 10).toFixed(2);

// The data of one sample room.
function roomData(scope: { businessId: string; locationId: string }, room: (typeof ROOMS)[number], floorId: string, roomTypeId: string, rateFactor: number) {
  const type = ROOM_TYPES.find((entry) => entry.name === room.type)!;
  return {
    ...scope,
    floorId,
    roomTypeId,
    roomNumber: room.number,
    capacity: type.capacity,
    maxExtraBeds: type.maxExtraBeds,
    standardRate: money(type.rate * rateFactor),
    extraBedRate: money(type.extraBed * rateFactor),
  };
}

// Adds the sample rooms an existing sample location lacks (matched by room number), on the sample floor and room type of
// that name; skips a room whose floor or room type is no longer there. Returns how many rooms were added.
async function addMissingRooms(businessId: string, sample: SampleBusiness): Promise<number> {
  let added = 0;
  for (const sampleLocation of sample.locations) {
    const location = await prisma.location.findFirst({ where: { businessId, code: sampleLocation.code }, select: { id: true } });
    if (!location) continue;
    const scope = { businessId, locationId: location.id };
    const [rooms, floors, types] = await Promise.all([
      prisma.room.findMany({ where: { locationId: location.id }, select: { roomNumber: true } }),
      prisma.floor.findMany({ where: { locationId: location.id }, select: { id: true, name: true } }),
      prisma.roomType.findMany({ where: { locationId: location.id }, select: { id: true, name: true } }),
    ]);
    const taken = new Set(rooms.map((room) => room.roomNumber));
    for (const room of ROOMS) {
      if (taken.has(room.number)) continue;
      const floor = floors.find((entry) => entry.name === FLOORS[room.floor]);
      const type = types.find((entry) => entry.name === room.type);
      if (!floor || !type) continue;
      await prisma.room.create({ data: roomData(scope, room, floor.id, type.id, sample.rateFactor) });
      added += 1;
    }
  }
  return added;
}

// Creates one business with everything below it, in one transaction; returns the created logins.
async function createBusiness(sample: SampleBusiness): Promise<{ email: string; password: string; role: string; name: string; locations: string }[]> {
  const passwords = new Map(sample.users.map((user) => [user.email, passwordFor(user)]));
  const hashes = new Map<string, string>();
  for (const [email, password] of passwords) hashes.set(email, await hashPassword(password));

  return prisma.$transaction(async (tx) => {
    const business = await tx.business.create({
      data: { name: sample.name, legalName: sample.legalName, contactEmail: sample.contactEmail, contactPhone: sample.contactPhone, address: sample.address },
    });
    const locationIds: string[] = [];
    for (const sampleLocation of sample.locations) {
      const location = await tx.location.create({
        data: { businessId: business.id, ...sampleLocation, timezone: 'Asia/Kolkata', currencyCode: 'INR', taxRatePercent: '12.00' },
      });
      locationIds.push(location.id);
      const scope = { businessId: business.id, locationId: location.id };
      const floorIds: string[] = [];
      for (const [index, name] of FLOORS.entries()) floorIds.push((await tx.floor.create({ data: { ...scope, name, sortOrder: index + 1 } })).id);
      const typeIds = new Map<string, string>();
      for (const type of ROOM_TYPES) {
        const created = await tx.roomType.create({
          data: { ...scope, name: type.name, description: type.description, defaultCapacity: type.capacity, defaultStandardRate: money(type.rate * sample.rateFactor), defaultExtraBedRate: money(type.extraBed * sample.rateFactor) },
        });
        typeIds.set(type.name, created.id);
      }
      for (const room of ROOMS) await tx.room.create({ data: roomData(scope, room, floorIds[room.floor]!, typeIds.get(room.type)!, sample.rateFactor) });
    }
    const logins: { email: string; password: string; role: string; name: string; locations: string }[] = [];
    for (const user of sample.users) {
      const created = await tx.businessUser.create({
        data: { businessId: business.id, email: user.email, name: user.name, role: user.role, passwordHash: hashes.get(user.email)!, mustChangePassword: false },
      });
      for (const index of user.locations) await tx.userLocationAssignment.create({ data: { businessId: business.id, userId: created.id, locationId: locationIds[index]! } });
      logins.push({ email: user.email, password: passwords.get(user.email)!, role: user.role, name: user.name, locations: user.locations.map((index) => sample.locations[index]!.name).join(', ') });
    }
    await tx.auditLog.create({ data: { actorType: 'SYSTEM', action: 'sample_data.created', entityType: 'Business', entityId: business.id, metadata: { name: sample.name } } });
    return logins;
  });
}

// Creates the missing sample businesses and writes their logins to the local file.
async function main(): Promise<void> {
  const [{ current_database: serverDatabaseName }] = await prisma.$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
  const serverRefusal = seedRefusalReason({ nodeEnv: process.env.NODE_ENV, databaseName: serverDatabaseName, protectedDatabaseNames });
  if (serverRefusal) fail(serverRefusal);

  const created: { business: string; logins: Awaited<ReturnType<typeof createBusiness>> }[] = [];
  for (const sample of BUSINESSES) {
    const existing = await prisma.business.findFirst({ where: { name: sample.name }, select: { id: true } });
    const takenEmail = await prisma.businessUser.findFirst({ where: { email: { in: sample.users.map((user) => user.email) } }, select: { id: true } });
    if (existing || takenEmail) {
      const added = existing ? await addMissingRooms(existing.id, sample) : 0;
      console.log(`"${sample.name}" already exists in "${serverDatabaseName}"; ${added > 0 ? `added ${added} missing rooms` : 'nothing to add'}.`);
      continue;
    }
    created.push({ business: sample.name, logins: await createBusiness(sample) });
    console.log(`Created "${sample.name}": 2 locations, 2 floors, 3 room types, and ${ROOMS.length} rooms per location, and ${sample.users.length} users.`);
  }
  if (created.length === 0) return;

  const file = path.join(repoRoot, `sample-logins.local${existsSync(path.join(repoRoot, 'sample-logins.local.md')) ? `-${Date.now()}` : ''}.md`);
  const lines = [
    '# Sample business logins (local development database only)',
    '',
    `Created ${new Date().toISOString()} in "${serverDatabaseName}". Sign in at http://localhost:3000/login and choose the role. Keep this file private; Git ignores it.`,
    '',
  ];
  for (const entry of created) {
    lines.push(`## ${entry.business}`, '', '| Role | Name | Email | Password | Locations |', '| --- | --- | --- | --- | --- |');
    for (const login of entry.logins) lines.push(`| ${login.role} | ${login.name} | ${login.email} | \`${login.password}\` | ${login.locations} |`);
    lines.push('');
  }
  writeFileSync(file, lines.join('\n'), { encoding: 'utf8', mode: 0o600 });
  console.log(`Logins written to ${path.basename(file)} at the repository root (passwords are not printed here).`);
}

main()
  .catch((error: unknown) => {
    console.error('Sample data failed:', error instanceof Error ? error.message.replace(/postgres(ql)?:\/\/\S+/g, '<redacted>') : 'unknown error');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
