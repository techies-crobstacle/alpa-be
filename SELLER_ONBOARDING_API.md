# Seller Onboarding API Documentation - SOW Compliant

## Overview
Complete seller onboarding system for Aboriginal art sellers following SOW requirements:
- ABN validation with Vigil integration
- KYC document verification
- Cultural approval process
- Product upload tracking (1-2 minimum, 5+ recommended)
- Multi-step admin approval → Go Live

## Base URL
```
http://localhost:5000/api/sellers
```

---

## 🎯 SOW Onboarding Flow

```
1. Apply → Email/Phone Verify ✓
2. Submit ABN/KYC Docs (Vigil) ✓
3. Admin Review & Approval ✓
4. Store Setup (Profile + Policy + Payout) ✓
5. Upload Minimum 5 SKUs (allow 1-2 initially) ✓
6. Admin QA + Cultural Approval → Go Live ✓
```

## Status Flow
```
draft → pending_review → approved → active (LIVE!)
```

---

## 📝 Seller Onboarding Flow

### Step 1: Apply as Seller (Email/Phone Verification)
**POST** `/apply`

**Request Body:**
```json
{
  "email": "seller@example.com",
  "phone": "+61412345678",
  "contactPerson": "John Doe"
}
```

**Response:**
```json
{
  "success": true,
  "message": "OTP sent to your email. Please verify to continue.",
  "sellerId": "abc123xyz"
}
```

---

### Step 2: Verify OTP
**POST** `/verify-otp`

**Request Body:**
```json
{
  "sellerId": "abc123xyz",
  "otp": "123456"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Email verified successfully",
  "seller": { ...seller data },
  "token": "jwt_token_here"
}
```

**Important:** Save the `token` - use it in the `Authorization` header for all subsequent requests:
```
Authorization: Bearer {token}
```

---

### Step 2.1: Resend OTP (Optional)
**POST** `/resend-otp`

**Request Body:**
```json
{
  "sellerId": "abc123xyz"
}
```

---

### Step 3: Submit Business Details
**POST** `/business-details`

**Headers:**
```
Authorization: Bearer {token}
```

**Request Body:**
```json
{
  "businessName": "Aboriginal Art Store",
  "abn": "12345678901",
  "businessAddress": {
    "street": "123 Main St",
    "city": "Sydney",
    "state": "NSW",
    "postcode": "2000",
    "country": "Australia"
  }
}
```

---

### Step 3.1: Validate ABN
**POST** `/validate-abn`

**Headers:**
```
Authorization: Bearer {token}
```

**Request Body:**
```json
{
  "abn": "12345678901"
}
```

**Response:**
```json
{
  "success": true,
  "message": "ABN verified successfully",
  "businessInfo": {
    "abn": "12345678901",
    "entityName": "Business Name",
    "entityType": "Individual",
    "status": "Active"
  }
}
```

---

### Step 4: Submit Cultural Information
**POST** `/cultural-info`

**Headers:**
```
Authorization: Bearer {token}
```

**Request Body:**
```json
{
  "artistName": "Traditional Artist Name",
  "clanAffiliation": "Yolngu",
  "culturalStory": "Story about the artwork and cultural significance..."
}
```

---

### Step 5: Submit Store Profile with Logo
**POST** `/store-profile`

**Headers:**
```
Authorization: Bearer {token}
Content-Type: multipart/form-data
```

**Form Data:**
- `storeName` (string): "My Art Store"
- `storeBio` (string): "Description of your store..."
- `logo` (file): Image file (JPG, PNG, max 5MB)

**Example using Postman/Insomnia:**
- Select POST method
- URL: `http://localhost:5000/api/sellers/store-profile`
- Add Authorization header
- Body: form-data
  - Key: `storeName`, Value: "My Art Store"
  - Key: `storeBio`, Value: "Store description"
  - Key: `logo`, Type: File, Select image file

---

### Step 6: Upload KYC Document (with Vigil Verification)
**POST** `/kyc-upload`

**Headers:**
```
Authorization: Bearer {token}
Content-Type: multipart/form-data
```

**Form Data:**
- `documentType` (string): "passport" | "drivers_license" | "medicare"
- `firstName` (string): First name as on ID
- `lastName` (string): Last name as on ID
- `dateOfBirth` (string): Format: YYYY-MM-DD
- `idDocument` (file): PDF or image file (max 5MB)

**Response:**
```json
{
  "success": true,
  "message": "KYC document uploaded and verified successfully",
  "seller": { ...seller data },
  "vigilVerification": {
    "verificationId": "VGL_123456789",
    "verified": true,
    "confidence": 0.95,
    "documentData": {
      "firstName": "John",
      "lastName": "Doe",
      "documentNumber": "ABC123456",
      "expiryDate": "2030-12-31"
    }
  }
}
```

**Note:** Document is verified through Vigil API for identity validation.

---

### Step 7: Submit Bank Details (Optional)
**POST** `/bank-details`

**Headers:**
```
Authorization: Bearer {token}
```

**Request Body:**
```json
{
  "accountName": "John Doe",
  "bsb": "062000",
  "accountNumber": "12345678"
}
```

**Note:** Bank details can be added later. Sellers can skip this and add it before requesting payouts.

---

### Step 8: Submit for Review
**POST** `/submit-for-review`

**Headers:**
```
Authorization: Bearer {token}
```

**No Request Body Required**

**Response:**
```json
{
  "success": true,
  "message": "Application submitted for review successfully!",
  "nextSteps": [
    "Admin will review your application within 2-3 business days",
    "After approval, you can upload products to your store",
    "Minimum 1-2 products required to launch, 5+ recommended",
    "Cultural approval required before going live"
  ],
  "seller": { ...updated seller data }
}
```

**Validation Requirements:**
- ✅ Email verified
- ✅ ABN verified
- ✅ KYC document uploaded (Vigil verified)
- ✅ Store profile completed

**Status Change:** `draft` → `pending_review`

---

## 📊 Seller Profile Management

### Get Seller Profile
**GET** `/profile`

**Headers:**
```
Authorization: Bearer {token}
```

**Response:**
```json
{
  "success": true,
  "seller": {
    "id": "seller123",
    "email": "seller@example.com",
    "contactPerson": "John Doe",
    "businessName": "Aboriginal Art Store",
    "storeName": "My Art Store",
    "onboardingStep": 6,
    "status": "pending_review",
    "emailVerified": true,
    "abnVerified": true,
    "kycStatus": "submitted"
  }
}
```

---

### Update Seller Profile
**PUT** `/profile`

**Headers:**
```
Authorization: Bearer {token}
```

**Request Body (all fields optional):**
```json
{
  "phone": "+61412345679",
  "businessAddress": { ... },
  "storeBio": "Updated store description",
  "culturalStory": "Updated cultural story",
  "artistName": "Updated artist name",
  "clanAffiliation": "Updated clan"
}
```

---

## 👨‍💼 Admin Endpoints

### Get All Sellers
**GET** `/admin/all?status=pending_review`

**Headers:**
```
Authorization: Bearer {admin_token}
```

**Query Parameters:**
- `status` (optional): Filter by status (draft, pending_review, approved, rejected, active)

---

### Get Pending Sellers
**GET** `/admin/pending`

**Headers:**
```
Authorization: Bearer {admin_token}
```

---

### Get Seller Details
**GET** `/admin/:sellerId`

**Headers:**
```
Authorization: Bearer {admin_token}
```

---

### Approve Seller
**POST** `/admin/approve/:sellerId`

**Headers:**
```
Authorization: Bearer {admin_token}
```

---

### Reject Seller
**POST** `/admin/reject/:sellerId`

**Headers:**
```
Authorization: Bearer {admin_token}
```

**Request Body:**
```json
{
  "reason": "Incomplete KYC documentation"
}
```

---

### Update Seller Notes
**PUT** `/admin/notes/:sellerId`

**Headers:**
```
Authorization: Bearer {admin_token}
```

**Request Body:**
```json
{
  "notes": "Admin notes about this seller..."
}
```

---

### Cultural Approval (SOW Requirement - Step 6)
**POST** `/admin/cultural-approval/:sellerId`

**Headers:**
```
Authorization: Bearer {admin_token}
```

**Request Body:**
```json
{
  "approved": true,
  "feedback": "Cultural content is appropriate and respectful. Artist story aligns with clan affiliation."
}
```

**Response:**
```json
{
  "success": true,
  "message": "Cultural approval status updated successfully",
  "seller": {
    "culturalApprovalStatus": "approved",
    "culturalApprovalFeedback": "Cultural content is appropriate...",
    "culturalApprovedBy": "admin_uid",
    "culturalApprovedAt": "2025-12-12T10:30:00Z"
  }
}
```

**Note:** This is a required step before activating the seller (Go Live).

---

### Activate Seller (Go Live - SOW Step 6)
**POST** `/admin/activate/:sellerId`

**Headers:**
```
Authorization: Bearer {admin_token}
```

**Response:**
```json
{
  "success": true,
  "message": "Seller activated successfully! Store is now LIVE and visible to customers.",
  "seller": {
    "status": "active",
    "goLiveAt": "2025-12-12T10:35:00Z",
    "productCount": 5
  }
}
```

**Requirements Before Activation:**
- ✅ Status must be "approved" (admin approved)
- ✅ Minimum 1 product uploaded (1-2 allowed, 5+ recommended)
- ✅ Cultural approval granted
- ✅ All onboarding steps completed

**Status Change:** `approved` → `active` (Store goes LIVE!)

---

### Update Product Count
**POST** `/update-product-count/:sellerId`

**Request Body:**
```json
{
  "count": 5
}
```

**Response:**
```json
{
  "success": true,
  "message": "Product count updated",
  "productCount": 5,
  "minimumProductsUploaded": true
}
```

**Note:** This endpoint is automatically called from the product controller when sellers add or remove products. Tracks whether minimum product requirement is met.

---

## 📦 Seller Status Flow (SOW Compliant)

```
draft (applying, email verification)
  ↓
pending_review (submitted for admin review - SOW Step 3)
  ↓
approved (admin approved, can upload products - SOW Step 4)
  ↓ (upload 1-2 minimum, 5+ recommended products - SOW Step 5)
  ↓ (cultural approval granted - SOW Step 6)
active (LIVE! Store visible to customers - SOW Step 6 Complete)
  ↓
suspended (if needed)
```

**Key Status Differences:**
- **approved**: Seller can upload products, but NOT visible to customers yet
- **active**: Store is LIVE and visible to customers (requires products + cultural approval)

---

## 🔐 Authentication

All authenticated endpoints require a JWT token in the Authorization header:

```
Authorization: Bearer {your_token_here}
```

Get the token from:
1. `/verify-otp` endpoint (after OTP verification)
2. Your authentication system

---

## 📂 Firestore Collections Structure

### `sellers` collection:
```javascript
{
  email: string,
  phone: string,
  contactPerson: string,
  emailVerified: boolean,
  phoneVerified: boolean,
  
  // Business Details
  businessName: string,
  abn: string,
  abnVerified: boolean,
  businessAddress: object,
  
  // Cultural Identity
  artistName: string,
  clanAffiliation: string,
  culturalStory: string,
  
  // Store Profile
  storeName: string,
  storeBio: string,
  storeLogo: string (URL),
  
  // KYC
  idDocument: {
    type: string,
    documentUrl: string,
    fileName: string,
    uploadedAt: timestamp
  },
  kycStatus: string, // pending, submitted, approved, rejected
  
  // Bank Details
  bankDetails: {
    accountName: string,
    bsb: string,
    accountNumber: string,
    verified: boolean
  },
  
  // Status & Tracking
  onboardingStep: number (1-7),
  status: string, // draft, pending_review, approved, rejected, active
  productCount: number,
  minimumProductsUploaded: boolean,
  
  // Cultural Approval (SOW Requirement)
  culturalApprovalStatus: string, // pending, approved, rejected
  culturalApprovalFeedback: string,
  culturalApprovedBy: string (admin UID),
  culturalApprovedAt: timestamp,
  
  // Vigil Verification Data
  vigilVerification: {
    verificationId: string,
    verified: boolean,
    confidence: number,
    documentData: object,
    verifiedAt: timestamp
  },
  
  // Timestamps
  appliedAt: timestamp,
  submittedForReviewAt: timestamp,
  approvedAt: timestamp,
  goLiveAt: timestamp,
  createdAt: timestamp,
  updatedAt: timestamp
}
```

### `otps` collection:
```javascript
{
  sellerId: string,
  userType: "seller",
  otp: string,
  expiresAt: timestamp,
  createdAt: timestamp
}
```

---

## 🚀 Testing with Postman

### Import this Postman Collection:
1. Create new collection: "Seller Onboarding"
2. Add environment variables:
   - `base_url`: http://localhost:5000
   - `seller_token`: (will be set after login)
   - `admin_token`: (your admin token)

### Test Flow:
1. **Apply**: POST {{base_url}}/api/sellers/apply
2. **Verify OTP**: POST {{base_url}}/api/sellers/verify-otp
   - Save token from response to `seller_token`
3. **Business Details**: POST {{base_url}}/api/sellers/business-details
   - Header: Authorization: Bearer {{seller_token}}
4. Continue with remaining steps...

---

## ⚠️ Important Notes

1. **ABN Validation**: 
   - Register for free GUID at: https://abr.business.gov.au
   - Add to `.env`: `ABN_GUID=your_guid_here`
   - Development mode bypasses validation if GUID is not set

2. **Firebase Storage**:
   - Update `.env`: `FIREBASE_STORAGE_BUCKET=your-project-id.appspot.com`
   - Get bucket name from Firebase Console

3. **File Uploads**:
   - Max size: 5MB
   - Accepted: Images (JPG, PNG, GIF) and PDFs
   - Stored in: `sellers/{sellerId}/` folder

4. **Product Requirements**:
   - Recommended: 5+ SKUs before going live
   - Minimum: 1-2 SKUs allowed initially
   - Each product needs 3-5 images

---

## 🐛 Error Handling

All endpoints return consistent error format:
```json
{
  "success": false,
  "message": "Error description here"
}
```

Common errors:
- `400`: Bad request / validation error
- `401`: Unauthorized / invalid token
- `403`: Forbidden / insufficient permissions
- `404`: Not found
- `500`: Server error

---

## 📧 Email Notifications

OTP emails are sent automatically. In development mode (no EMAIL_USER configured), OTPs are logged to console.

---

## 🔥 Firebase Setup

1. Go to Firebase Console
2. Create/select project
3. Generate service account key
4. Save as `serviceAccountKey.json`
5. Enable Firebase Storage
6. Set storage rules for seller uploads

Storage Rules Example:
```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /sellers/{sellerId}/{allPaths=**} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == sellerId;
    }
  }
}
```

---

## ✅ SOW Compliance Checklist

### Complete Implementation of SOW Requirements:

**1. Apply → Email/Phone Verify** ✅
- POST `/apply` - Seller registration
- POST `/verify-otp` - Email verification
- POST `/resend-otp` - Resend OTP if expired

**2. Submit ABN/KYC Docs** ✅
- POST `/business-details` - Business name & ABN
- POST `/validate-abn` - ABN validation with ABR
- POST `/kyc-upload` - KYC document with **Vigil API verification**
- POST `/cultural-info` - Artist/Clan affiliation + cultural story
- POST `/store-profile` - Store logo & bio

**3. Admin Review & Approval** ✅
- GET `/admin/pending` - Get pending sellers
- GET `/admin/:id` - View seller details
- POST `/admin/approve/:id` - Approve seller
- POST `/admin/reject/:id` - Reject seller with reason
- PUT `/admin/notes/:id` - Add admin notes

**4. Store Setup (Profile + Policy + Payout)** ✅
- Store profile completed in step 2
- POST `/bank-details` - **Optional**, can add later for payouts
- Status: `approved` after admin approval

**5. Upload Minimum 5 SKUs** ✅
- **1-2 products minimum allowed** to launch
- **5+ products recommended** (seller notified)
- POST `/update-product-count/:id` - Automatically tracks product count
- `productCount` and `minimumProductsUploaded` fields tracked

**6. Admin QA + Cultural Approval → Go Live** ✅
- POST `/admin/cultural-approval/:id` - Cultural content approval
- POST `/admin/activate/:id` - **Final activation to LIVE**
- Validates: approved status + products uploaded + cultural approval
- Status changes to `active` - Store visible to customers!

---

## 🎯 Complete Seller Journey Example

### Seller Side:

```bash
# Step 1: Apply
POST /api/sellers/apply
{ "email": "artist@example.com", "phone": "+61412345678", "contactPerson": "John Artist" }
→ OTP sent

# Step 2: Verify
POST /api/sellers/verify-otp
{ "sellerId": "abc123", "otp": "123456" }
→ Token received

# Step 3: Business Details
POST /api/sellers/business-details
Authorization: Bearer {token}
{ "businessName": "Aboriginal Art Co", "abn": "51824753556", ... }

# Step 4: Validate ABN
POST /api/sellers/validate-abn
{ "abn": "51824753556" }
→ ABN verified

# Step 5: Cultural Info
POST /api/sellers/cultural-info
{ "artistName": "Traditional Artist", "clanAffiliation": "Yolngu", ... }

# Step 6: Store Profile
POST /api/sellers/store-profile
Content-Type: multipart/form-data
storeName: "My Art Gallery"
storeBio: "Traditional Aboriginal artwork"
logo: [file]

# Step 7: KYC Upload (Vigil Verification)
POST /api/sellers/kyc-upload
documentType: "drivers_license"
firstName: "John"
lastName: "Artist"
dateOfBirth: "1980-01-01"
idDocument: [file]
→ Vigil verifies identity

# Step 8: Bank Details (Optional)
POST /api/sellers/bank-details
{ "accountName": "John Artist", "bsb": "062000", "accountNumber": "12345678" }

# Step 9: Submit for Review
POST /api/sellers/submit-for-review
→ Status: pending_review
```

### Admin Side:

```bash
# Step 10: Admin Reviews
GET /api/sellers/admin/pending
→ See all pending sellers

GET /api/sellers/admin/abc123
→ View seller details, documents, Vigil verification

# Step 11: Admin Approves
POST /api/sellers/admin/approve/abc123
→ Status: approved (seller can now upload products)

# Step 12: Seller Uploads Products
# (This happens in product controller, not seller controller)
# Automatically calls: POST /api/sellers/update-product-count/abc123
→ productCount: 5, minimumProductsUploaded: true

# Step 13: Cultural Approval
POST /api/sellers/admin/cultural-approval/abc123
{
  "approved": true,
  "feedback": "Cultural content is respectful and appropriate"
}
→ culturalApprovalStatus: approved

# Step 14: Go Live!
POST /api/sellers/admin/activate/abc123
→ Status: active ✨
→ Store is LIVE and visible to customers!
```

---

## 📝 Integration Notes

### For Product Controller:

When a seller adds or removes a product, call:

```javascript
// After creating/deleting a product
const axios = require('axios');

// Get seller's current product count
const productCount = await db.collection('products')
  .where('sellerId', '==', sellerId)
  .count()
  .get();

// Update seller's product count
await axios.post(`http://localhost:5000/api/sellers/update-product-count/${sellerId}`, {
  count: productCount.data().count
});
```

### Vigil API Setup:

1. Contact Vigil: https://vigil.com.au/contact
2. Get sandbox credentials for testing
3. Add to `.env`:
```env
VIGIL_API_KEY=your_key
VIGIL_API_SECRET=your_secret
VIGIL_BASE_URL=https://sandbox.vigil.com.au/api/v1
```
4. Test in sandbox, then switch to production URL

---

## 🚀 Quick Start Testing

1. **Start server**: `node server.js`
2. **Apply as seller**: Use Postman/Insomnia
3. **Check console for OTP**
4. **Verify OTP and get token**
5. **Complete all steps with token**
6. **Use admin token to approve**
7. **Cultural approval**
8. **Activate → LIVE!**

---

**Implementation Complete! All SOW requirements met.** ✅
