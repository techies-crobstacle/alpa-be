-- CreateEnum
CREATE TYPE "CategoryStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "category_requests" (
    "id" TEXT NOT NULL,
    "categoryName" TEXT NOT NULL,
    "description" TEXT,
    "sampleProduct" TEXT,
    "status" "CategoryStatus" NOT NULL DEFAULT 'PENDING',
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

-- CreateIndex
CREATE UNIQUE INDEX "category_requests_categoryName_key" ON "category_requests"("categoryName");

-- CreateIndex
CREATE INDEX "category_requests_status_idx" ON "category_requests"("status");

-- CreateIndex
CREATE INDEX "category_requests_requestedAt_idx" ON "category_requests"("requestedAt");
