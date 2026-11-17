-- Advertisements sent to consenting guests on WhatsApp (owner decision 2026-11-11). Additive only: new enums, two new
-- guest columns (consent off by default), and three new tables. No existing data is changed or removed.

-- CreateEnum
CREATE TYPE "AdWhatsAppSendStatus" AS ENUM ('SENDING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "AdWhatsAppRecipientStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- AlterTable
ALTER TABLE "guests" ADD COLUMN     "whatsappOffersConsent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "whatsappOffersConsentAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "business_whatsapp_settings" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "phoneNumberId" VARCHAR(40) NOT NULL,
    "templateName" VARCHAR(512) NOT NULL,
    "templateLanguage" VARCHAR(15) NOT NULL,
    "accessTokenEncrypted" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "business_whatsapp_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_whatsapp_sends" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "advertisementId" UUID NOT NULL,
    "sentByUserId" UUID NOT NULL,
    "status" "AdWhatsAppSendStatus" NOT NULL DEFAULT 'SENDING',
    "totalCount" INTEGER NOT NULL,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "error" VARCHAR(300),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ad_whatsapp_sends_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_whatsapp_recipients" (
    "id" UUID NOT NULL,
    "sendId" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "guestId" UUID NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "status" "AdWhatsAppRecipientStatus" NOT NULL DEFAULT 'PENDING',
    "providerMessageId" VARCHAR(128),
    "error" VARCHAR(300),
    "attemptedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ad_whatsapp_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "business_whatsapp_settings_businessId_key" ON "business_whatsapp_settings"("businessId");

-- CreateIndex
CREATE INDEX "ad_whatsapp_sends_businessId_status_idx" ON "ad_whatsapp_sends"("businessId", "status");

-- CreateIndex
CREATE INDEX "ad_whatsapp_sends_advertisementId_createdAt_idx" ON "ad_whatsapp_sends"("advertisementId", "createdAt");

-- CreateIndex
CREATE INDEX "ad_whatsapp_recipients_sendId_status_idx" ON "ad_whatsapp_recipients"("sendId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ad_whatsapp_recipients_sendId_phone_key" ON "ad_whatsapp_recipients"("sendId", "phone");

-- AddForeignKey
ALTER TABLE "business_whatsapp_settings" ADD CONSTRAINT "business_whatsapp_settings_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_whatsapp_sends" ADD CONSTRAINT "ad_whatsapp_sends_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_whatsapp_sends" ADD CONSTRAINT "ad_whatsapp_sends_advertisementId_fkey" FOREIGN KEY ("advertisementId") REFERENCES "advertisements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_whatsapp_sends" ADD CONSTRAINT "ad_whatsapp_sends_sentByUserId_businessId_fkey" FOREIGN KEY ("sentByUserId", "businessId") REFERENCES "business_users"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_whatsapp_recipients" ADD CONSTRAINT "ad_whatsapp_recipients_sendId_fkey" FOREIGN KEY ("sendId") REFERENCES "ad_whatsapp_sends"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_whatsapp_recipients" ADD CONSTRAINT "ad_whatsapp_recipients_guestId_businessId_fkey" FOREIGN KEY ("guestId", "businessId") REFERENCES "guests"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Consistency checks: a consent date only with consent; counts never negative and never more than the total.
ALTER TABLE "guests" ADD CONSTRAINT "guests_whatsapp_consent_at_check" CHECK ("whatsappOffersConsentAt" IS NULL OR "whatsappOffersConsent");
ALTER TABLE "ad_whatsapp_sends" ADD CONSTRAINT "ad_whatsapp_sends_counts_check" CHECK ("totalCount" >= 0 AND "sentCount" >= 0 AND "failedCount" >= 0 AND "skippedCount" >= 0 AND "sentCount" + "failedCount" <= "totalCount");
