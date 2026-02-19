# Product Approval Workflow Implementation Guide

## Overview
This guide implements a product approval workflow where:
- **Sellers**: Products require admin approval (isActive: false by default)
- **Admins**: Products go live immediately (isActive: true)
- **Updates**: Seller edits require re-approval

## Implementation Steps (Safe - No Database Reset)

### Step 1: Add isActive Field (MANUAL SQL)

**Option A: Run SQL manually in your database console**
```sql
-- Copy and run this in your PostgreSQL console
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN DEFAULT false;
CREATE INDEX IF NOT EXISTS "products_isActive_idx" ON "products"("isActive");

-- Set existing products based on current status
UPDATE "products" SET "isActive" = true WHERE "status" = 'ACTIVE';
UPDATE "products" SET "isActive" = false WHERE "status" IN ('PENDING', 'INACTIVE');
```

**Option B: Use the SQL file I created**
```bash
# Run the SQL file (from project root)
psql -h your-host -d your-database -f add_isactive_field.sql
```

### Step 2: Verify Database Changes

After running the SQL, verify in your database:
```sql
SELECT status, "isActive", COUNT(*) as count 
FROM "products" 
GROUP BY status, "isActive";
```

### Step 3: Update Prisma Schema (Already Done)

The schema.prisma has been updated with:
```prisma
model Product {
  // ... other fields
  isActive    Boolean       @default(false)  // Product approval status
  // ... rest of model
  @@index([isActive])
}
```

### Step 4: Generate Prisma Client

After manual SQL changes, regenerate the Prisma client:
```bash
npx prisma generate
```

## 🚀 New API Endpoints

### For Sellers (Existing endpoints updated)
```javascript
// Add product - now requires approval for sellers
POST /api/products/add
// Response includes: requiresApproval: true for sellers

// Update product - triggers re-approval for sellers  
PUT /api/products/:id
// Response includes: requiresApproval: true if seller edit
```

### For Admins (New endpoints)
```javascript
// Get pending products
GET /api/admin/products/pending

// Approve single product
POST /api/admin/products/approve/:productId

// Reject single product  
DELETE /api/admin/products/reject/:productId

// Bulk approve products
POST /api/admin/products/approve-bulk
// Body: { "productIds": ["id1", "id2", "id3"] }
```

## 🔧 Workflow Testing

### Test Seller Flow
```bash
# 1. Login as seller
POST /api/sellers/login

# 2. Add product (will be isActive: false)
POST /api/products/add

# 3. Verify product is pending
GET /api/products/my-products
# Should show isActive: false

# 4. Update product (will reset isActive: false)  
PUT /api/products/:id
```

### Test Admin Flow
```bash
# 1. Login as admin
POST /api/auth/login

# 2. View pending products
GET /api/admin/products/pending

# 3. Approve product
POST /api/admin/products/approve/:productId

# 4. Verify product is live
GET /api/products/all
# Should only show isActive: true products
```

## 📋 Key Changes Made

### Product Controller Updates
- ✅ Sellers: Products default to `isActive: false`
- ✅ Admins: Products default to `isActive: true`  
- ✅ Seller edits: Reset `isActive: false`
- ✅ Admin edits: Keep current `isActive` status
- ✅ Public API: Only shows `isActive: true` products

### Admin Controller (New)
- ✅ `getPendingProducts()` - View products awaiting approval
- ✅ `approveProduct()` - Set `isActive: true`
- ✅ `rejectProduct()` - Delete product (or keep with `isActive: false`)
- ✅ `bulkApproveProducts()` - Approve multiple products

### Routes Added
- ✅ `GET /api/admin/products/pending`
- ✅ `POST /api/admin/products/approve/:productId`
- ✅ `DELETE /api/admin/products/reject/:productId`
- ✅ `POST /api/admin/products/approve-bulk`

## 🛡️ Safety Features

### Backwards Compatibility
- ✅ Existing `status` field maintained
- ✅ Current products won't break
- ✅ `getAllProducts()` still works (now filters by `isActive`)

### Data Integrity
- ✅ No database reset required
- ✅ Existing products preserved
- ✅ Manual SQL ensures safe migration

### Access Control
- ✅ Admin-only endpoints protected
- ✅ Sellers can only edit own products
- ✅ Role-based approval workflow

## 🔄 Migration Status

**Current State**: Code updated, awaiting manual SQL execution
**Next Step**: Run the SQL script to add `isActive` field
**After SQL**: Run `npx prisma generate` to update client

This approach ensures zero data loss while implementing the product approval workflow safely!