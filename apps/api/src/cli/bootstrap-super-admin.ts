// Operator command that creates the first production Super Admin, once:
//   NODE_ENV=production BOOTSTRAP_DATABASE_URL=<direct URL> node dist/cli/bootstrap-super-admin.js --production --confirm-database=<name>
// Order of checks: arguments and environment (before connecting), the database name reported by the server, an empty
// super_admins table, then the email, name, and a hidden password typed twice. The account is created with
// mustChangePassword=true and a SYSTEM audit entry. It never reads .env and never prints the password, hash, or URL.
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { describeFailure, readBootstrapSettings } from '../super-admin/bootstrap/bootstrap-cli-options.js';
import { BootstrapRefusedError, checkIdentity, countSuperAdmins, createFirstSuperAdmin, DEFAULT_SUPER_ADMIN_NAME } from '../super-admin/bootstrap/first-super-admin.js';
import { promptHidden, promptVisible } from './prompts.js';

// Runs the bootstrap and returns the process exit code (0 created, 1 refused or failed).
async function main(): Promise<number> {
  const { settings, problems } = readBootstrapSettings(process.argv.slice(2), process.env);
  if (!settings) {
    console.error('Refused before connecting; nothing was changed:');
    for (const problem of problems) console.error(`  - ${problem}`);
    return 1;
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: settings.databaseUrl }) });
  try {
    // Confirms the database by the name the server itself reports.
    const [{ current_database: databaseName }] = await prisma.$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
    if (databaseName !== settings.confirmDatabase) {
      throw new BootstrapRefusedError(`Connected database is "${databaseName}", which does not match --confirm-database. Nothing was changed.`);
    }
    if ((await countSuperAdmins(prisma)) > 0) {
      throw new BootstrapRefusedError(`"${databaseName}" already has a Super Admin. The first-admin bootstrap runs only once; nothing was changed.`);
    }
    console.log(`Connected to "${databaseName}". No Super Admin exists yet; creating the first one.`);

    const identity = checkIdentity(settings.email ?? (await promptVisible('Super Admin email: ')), settings.name ?? (await promptVisible(`Full name [${DEFAULT_SUPER_ADMIN_NAME}]: `)));
    if (identity.problems.length > 0) throw new BootstrapRefusedError(identity.problems.join(' '));

    console.log('Temporary password: 12-128 characters, not common, not containing the email name or the person\'s name. It must be changed at first sign-in.');
    const password = await promptHidden('Temporary password (hidden): ');
    const repeated = await promptHidden('Repeat the temporary password (hidden): ');
    if (password !== repeated) throw new BootstrapRefusedError('The two passwords do not match. Nothing was changed.');

    const created = await createFirstSuperAdmin(prisma, { email: identity.email, name: identity.name, password });
    console.log(`Created the first Super Admin ${created.email} in "${databaseName}". Sign in at the Super Admin login; a password change is required at first sign-in.`);
    return 0;
  } catch (error) {
    console.error(describeFailure(error));
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

process.exitCode = await main();
