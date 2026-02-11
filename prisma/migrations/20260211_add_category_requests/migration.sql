-- CreateEnum (only if it doesn't exist)
DO $$ BEGIN
  CREATE TYPE "CategoryStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Check if table exists, if not create it
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT FROM pg_tables WHERE tablename = 'category_requests') THEN
    CREATE TABLE "category_requests" (
      "id" TEXT NOT NULL,
      "categoryName" TEXT NOT NULL,
      "description" TEXT,
      "sampleProduct" TEXT,
      "status" TEXT NOT NULL DEFAULT 'PENDING',
      "requestedBy" TEXT,
      "approvedBy" TEXT,
      "rejectedBy" TEXT,
      "approvalMessage" TEXT,
      "rejectionMessage" TEXT,
      "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "approvedAt" TIMESTAMP(3),
      "rejectedAt" TIMESTAMP(3),
      "updatedAt" TIMESTAMP(3) NOT NULL,

      CONSTRAINT "category_requests_pkey" PRIMARY KEY ("id")
    );

    CREATE UNIQUE INDEX "category_requests_categoryName_key" ON "category_requests"("categoryName");
    CREATE INDEX "category_requests_status_idx" ON "category_requests"("status");
    CREATE INDEX "category_requests_requestedAt_idx" ON "category_requests"("requestedAt");
  END IF;
END $$;

-- Convert status column from TEXT to CategoryStatus enum (safe migration)
-- This preserves all existing data
ALTER TABLE "category_requests" 
  ALTER COLUMN "status" TYPE "CategoryStatus" 
  USING (status::text::"CategoryStatus");
