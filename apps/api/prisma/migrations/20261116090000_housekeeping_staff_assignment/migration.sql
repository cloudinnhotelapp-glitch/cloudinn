-- Phase 8 (owner decision 2026-11-16): housekeeping tasks are assigned to registered staff of the location, and record
-- who completed them. Additive only: two nullable columns, an index, and two foreign keys.
-- AlterTable
ALTER TABLE "housekeeping_tasks" ADD COLUMN     "assignedStaffId" UUID,
ADD COLUMN     "completedByUserId" UUID;

-- CreateIndex
CREATE INDEX "housekeeping_tasks_assignedStaffId_status_idx" ON "housekeeping_tasks"("assignedStaffId", "status");

-- AddForeignKey
ALTER TABLE "housekeeping_tasks" ADD CONSTRAINT "housekeeping_tasks_assignedStaffId_fkey" FOREIGN KEY ("assignedStaffId") REFERENCES "business_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "housekeeping_tasks" ADD CONSTRAINT "housekeeping_tasks_completedByUserId_fkey" FOREIGN KEY ("completedByUserId") REFERENCES "business_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


