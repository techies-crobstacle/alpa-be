-- AlterTable: add subDisplayId to sub_orders
ALTER TABLE "sub_orders" ADD COLUMN "subDisplayId" TEXT;

-- Backfill existing rows: format {parentOrder.displayId}-A, -B, -C, ...
UPDATE "sub_orders" AS so
SET "subDisplayId" = o."displayId" || '-' || chr(64 + ranked.rn)
FROM (
  SELECT
    id,
    "parentOrderId",
    ROW_NUMBER() OVER (
      PARTITION BY "parentOrderId"
      ORDER BY "createdAt" ASC
    ) AS rn
  FROM "sub_orders"
) AS ranked
JOIN "orders" o ON o.id = ranked."parentOrderId"
WHERE so.id = ranked.id;

-- Add unique constraint
ALTER TABLE "sub_orders" ADD CONSTRAINT "sub_orders_subDisplayId_key" UNIQUE ("subDisplayId");
