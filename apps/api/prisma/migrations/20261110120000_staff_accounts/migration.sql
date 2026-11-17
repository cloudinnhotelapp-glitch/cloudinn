-- Staff accounts: a STAFF role and employee details on business users. Only adds objects and relaxes NOT NULL on email (Staff may sign in with a username instead); no data is removed.
-- AlterEnum
ALTER TYPE "BusinessUserRole" ADD VALUE 'STAFF';

-- AlterTable
ALTER TABLE "business_users" ADD COLUMN     "department" VARCHAR(80),
ADD COLUMN     "designation" VARCHAR(80),
ADD COLUMN     "employeeCode" VARCHAR(40),
ADD COLUMN     "joiningDate" DATE,
ADD COLUMN     "phone" VARCHAR(40),
ADD COLUMN     "username" VARCHAR(60),
ALTER COLUMN "email" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "business_users_username_key" ON "business_users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "business_users_businessId_employeeCode_key" ON "business_users"("businessId", "employeeCode");



-- Every account keeps a way to sign in, and usernames are stored in lowercase like emails.
ALTER TABLE "business_users" ADD CONSTRAINT "business_users_login_identifier_check" CHECK ("email" IS NOT NULL OR "username" IS NOT NULL);
ALTER TABLE "business_users" ADD CONSTRAINT "business_users_username_lowercase_check" CHECK ("username" IS NULL OR "username" = lower("username"));
