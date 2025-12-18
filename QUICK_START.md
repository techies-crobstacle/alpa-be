# 🚀 Quick Start Guide - Seller Onboarding

## Prerequisites Setup

### 1. Update Firebase Storage Bucket
Edit `.env` file:
```env
FIREBASE_STORAGE_BUCKET=your-project-id.appspot.com
```

**How to find it:**
1. Go to Firebase Console (console.firebase.google.com)
2. Select your project
3. Go to Storage
4. Copy the bucket name (format: `projectname.appspot.com`)

---

### 2. Firebase Storage Rules (Important!)
1. Go to Firebase Console → Storage → Rules
2. Replace with:
```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /sellers/{sellerId}/{allPaths=**} {
      allow read: if request.auth != null || request.auth == null;
      allow write: if request.auth != null;
    }
  }
}
```
3. Click "Publish"

---

### 3. (Optional) ABN Validation Setup
For production ABN validation:
1. Visit: https://abr.business.gov.au/
2. Register for free GUID
3. Add to `.env`:
```env
ABN_GUID=your_guid_here
```

**Note:** In development mode, ABN validation works without GUID (bypasses check)

---

## Testing the API

### Option 1: Using Postman/Insomnia

#### Step-by-Step Test:

**1. Apply as Seller**
```
POST http://localhost:5000/api/sellers/apply
Content-Type: application/json

{
  "email": "testseller@example.com",
  "phone": "+61412345678",
  "contactPerson": "John Doe"
}
```

**Response:** Save the `sellerId`

**2. Check Server Console for OTP**
Look for output like:
```
==================================================
📧 DEVELOPMENT MODE - OTP Email
==================================================
To: testseller@example.com
Name: John Doe
OTP: 123456
==================================================
```

**3. Verify OTP**
```
POST http://localhost:5000/api/sellers/verify-otp
Content-Type: application/json

{
  "sellerId": "your_seller_id_here",
  "otp": "123456"
}
```

**Response:** Save the `token`

**4. Business Details**
```
POST http://localhost:5000/api/sellers/business-details
Authorization: Bearer YOUR_TOKEN_HERE
Content-Type: application/json

{
  "businessName": "Aboriginal Art Store",
  "abn": "53004085616",
  "businessAddress": {
    "street": "123 Main St",
    "city": "Sydney",
    "state": "NSW",
    "postcode": "2000",
    "country": "Australia"
  }
}
```

**5. Validate ABN**
```
POST http://localhost:5000/api/sellers/validate-abn
Authorization: Bearer YOUR_TOKEN_HERE
Content-Type: application/json

{
  "abn": "53004085616"
}
```

**6. Cultural Info**
```
POST http://localhost:5000/api/sellers/cultural-info
Authorization: Bearer YOUR_TOKEN_HERE
Content-Type: application/json

{
  "artistName": "Traditional Artist",
  "clanAffiliation": "Yolngu",
  "culturalStory": "Story about the artwork..."
}
```

**7. Store Profile (with file)**
```
POST http://localhost:5000/api/sellers/store-profile
Authorization: Bearer YOUR_TOKEN_HERE
Content-Type: multipart/form-data

Body (form-data):
- storeName: "My Art Gallery"
- storeBio: "Traditional Aboriginal artwork"
- logo: [Select image file]
```

**8. Upload KYC**
```
POST http://localhost:5000/api/sellers/kyc-upload
Authorization: Bearer YOUR_TOKEN_HERE
Content-Type: multipart/form-data

Body (form-data):
- documentType: "passport"
- idDocument: [Select PDF/image file]
```

**9. Bank Details (Optional)**
```
POST http://localhost:5000/api/sellers/bank-details
Authorization: Bearer YOUR_TOKEN_HERE
Content-Type: application/json

{
  "accountName": "John Doe",
  "bsb": "062000",
  "accountNumber": "12345678"
}
```

**10. Submit for Review**
```
POST http://localhost:5000/api/sellers/submit-for-review
Authorization: Bearer YOUR_TOKEN_HERE
```

**11. Check Profile**
```
GET http://localhost:5000/api/sellers/profile
Authorization: Bearer YOUR_TOKEN_HERE
```

---

### Option 2: Using Test Script

```bash
# Start server in one terminal
node server.js

# Run test script in another terminal
node test-seller-onboarding.js
```

Follow prompts and enter OTP from server console.

---

## Admin Testing

### Get Pending Sellers
```
GET http://localhost:5000/api/sellers/admin/pending
Authorization: Bearer ADMIN_TOKEN_HERE
```

### Approve Seller
```
POST http://localhost:5000/api/sellers/admin/approve/SELLER_ID
Authorization: Bearer ADMIN_TOKEN_HERE
```

### Reject Seller
```
POST http://localhost:5000/api/sellers/admin/reject/SELLER_ID
Authorization: Bearer ADMIN_TOKEN_HERE
Content-Type: application/json

{
  "reason": "Incomplete documentation"
}
```

---

## Troubleshooting

### Error: "Email sending error"
- ✅ Check EMAIL_USER and EMAIL_PASSWORD in `.env`
- ✅ In dev mode, OTP is logged to console (this is normal)

### Error: "Failed to upload logo"
- ✅ Check FIREBASE_STORAGE_BUCKET in `.env`
- ✅ Verify Firebase Storage is enabled
- ✅ Check Storage Rules are set correctly

### Error: "ABN validation failed"
- ✅ In dev mode (no ABN_GUID), validation is bypassed
- ✅ For production, register for GUID at abr.business.gov.au

### Error: "Invalid or expired token"
- ✅ Make sure you're using the token from verify-otp response
- ✅ Token format: `Bearer YOUR_TOKEN` in Authorization header

### Error: "Store name already taken"
- ✅ Store names must be unique
- ✅ Try a different store name

---

## File Upload Tips

### Accepted Files:
- **Logo**: JPG, PNG, GIF (max 5MB)
- **KYC**: JPG, PNG, PDF (max 5MB)

### In Postman:
1. Select Body → form-data
2. For text fields: Type = Text
3. For files: Type = File, then click "Select Files"

---

## Common Questions

**Q: Can sellers skip bank details?**
A: Yes! Bank details are optional and can be added later before requesting payouts.

**Q: How many products are required?**
A: Recommended 5+ SKUs, but sellers can launch with 1-2 initially.

**Q: How long is the OTP valid?**
A: 10 minutes. Use resend-otp endpoint if expired.

**Q: Can sellers edit their profile after submission?**
A: Yes, use PUT /api/sellers/profile endpoint (limited fields).

**Q: What happens after admin approval?**
A: Status changes to "approved" and seller can start uploading products.

---

## Quick Commands

```bash
# Start server
node server.js

# Run tests
node test-seller-onboarding.js

# Install dependencies (if needed)
npm install
```

---

## Important URLs

- **Server**: http://localhost:5000
- **Seller API**: http://localhost:5000/api/sellers
- **Admin API**: http://localhost:5000/api/sellers/admin

---

## Status Reference

| Status | Meaning |
|--------|---------|
| `draft` | Initial state, onboarding in progress |
| `pending_review` | Submitted for admin review |
| `approved` | Admin approved, can upload products |
| `rejected` | Admin rejected, check rejectionReason |
| `active` | Live store with products |
| `suspended` | Temporarily suspended |

---

## Next Steps After Setup

1. ✅ Update `.env` with Firebase Storage Bucket
2. ✅ Set Firebase Storage Rules
3. ✅ Test API with Postman
4. ✅ Build frontend multi-step form
5. ✅ Implement email notifications
6. ✅ Add product upload functionality

---

## Support Files

- 📖 Full API Docs: `SELLER_ONBOARDING_API.md`
- 📝 Implementation Summary: `IMPLEMENTATION_SUMMARY.md`
- 🧪 Test Script: `test-seller-onboarding.js`

---

**You're all set! Start testing with the API endpoints above.** 🎉
