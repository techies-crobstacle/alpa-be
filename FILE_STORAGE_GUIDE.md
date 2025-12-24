# File and Image Storage Guide for Seller Onboarding

## Overview
The seller onboarding system now uses a hybrid approach for file and image storage:
- **Local storage** (uploads/ directory) for temporary file handling
- **Cloudinary** for permanent cloud storage of images and documents

## Directory Structure
```
uploads/
├── seller-docs/     # Temporary KYC documents (PDF, images)
└── products/        # Temporary product images
```

## Storage Strategy

### 1. KYC Documents (Identity verification, Business documents)
- **Upload Flow**:
  1. Client uploads files via multipart/form-data
  2. Multer saves temporarily to `uploads/seller-docs/`
  3. Files are uploaded to Cloudinary
  4. Local files are deleted after successful upload
  5. Cloudinary URLs are stored in the database

### 2. Product Images
- **Upload Flow**:
  1. Uploaded to `uploads/products/` temporarily
  2. Transferred to Cloudinary
  3. Local files cleaned up
  4. URLs stored in database

### 3. Store Logos & Banners
- Uploaded directly to Cloudinary
- URLs stored in SellerProfile table

## Configuration

### Environment Variables Required
Add these to your `.env` file:

```env
# Cloudinary Configuration
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

### Get Cloudinary Credentials
1. Sign up at https://cloudinary.com/
2. Go to Dashboard
3. Copy your cloud name, API key, and API secret
4. Add to .env file

## Upload Middleware Usage

### For KYC Documents (multiple files)
```javascript
const { uploadSellerDocs } = require('../middlewares/upload');

// In your route
fastify.post('/upload-kyc', 
  { preHandler: uploadSellerDocs.array('documents', 5) },
  sellerOnboarding.uploadKYC
);
```

### For Product Images
```javascript
const { uploadProductImages } = require('../middlewares/upload');

// Single image
fastify.post('/upload-product-image',
  { preHandler: uploadProductImages.single('image') },
  productController.uploadImage
);

// Multiple images
fastify.post('/upload-product-images',
  { preHandler: uploadProductImages.array('images', 10) },
  productController.uploadImages
);
```

## File Type Restrictions

### Seller Documents (KYC)
- **Allowed**: PDF, JPEG, JPG, PNG
- **Max Size**: 5MB per file
- **Use Case**: Identity documents, business licenses, certificates

### Product Images
- **Allowed**: JPEG, JPG, PNG, WEBP
- **Max Size**: 3MB per file
- **Use Case**: Product photos, banners

## Database Storage

### SellerProfile Model
```javascript
{
  kycDocuments: [
    {
      documentType: "driverLicense",
      documentUrl: "https://res.cloudinary.com/.../document.pdf",
      publicId: "alpa/kyc-documents/abc123",
      originalName: "drivers_license.pdf",
      uploadedAt: "2024-01-01T00:00:00.000Z"
    }
  ],
  storeLogo: "https://res.cloudinary.com/.../logo.png",
  storeBanner: "https://res.cloudinary.com/.../banner.jpg",
  bankDetails: { ... } // Sensitive data - consider encryption
}
```

## Security Best Practices

1. **File Validation**: Multer middleware validates file types before upload
2. **Size Limits**: Enforced to prevent abuse
3. **Cloudinary Folders**: Organized by type (kyc-documents, products, etc.)
4. **Local Cleanup**: Temporary files deleted after cloud upload
5. **URL Storage**: Only Cloudinary URLs stored in database

## Alternative: Local File System Only

If you prefer not to use Cloudinary:

1. Comment out Cloudinary upload in `uploadKYC` function
2. Store local file paths in database
3. Serve files through Express static middleware:

```javascript
// In server.js
fastify.register(require('@fastify/static'), {
  root: path.join(__dirname, 'uploads'),
  prefix: '/uploads/',
});
```

**Pros**: No external dependency, full control
**Cons**: Files not backed up, doesn't scale horizontally, manual backups needed

## Backup Strategy

### With Cloudinary
- Automatic backups and CDN
- Files persist even if server fails
- No manual backup needed

### With Local Storage
- Set up regular backups of uploads/ directory
- Consider using:
  - Cloud storage sync (Google Drive, Dropbox)
  - Git LFS for version control
  - rsync to backup server

## Troubleshooting

### "Cannot upload to Cloudinary"
- Check environment variables are set
- Verify API credentials are correct
- Check network connectivity

### "File too large"
- Adjust limits in `middlewares/upload.js`
- Update Cloudinary account settings for larger files

### "Disk space full"
- Ensure temporary files are being deleted
- Check cleanup logic in `uploadKYC` function
- Manually clear uploads/ directory if needed

## Migration from Firebase Storage

The old Firebase Storage implementation has been completely replaced. If you have existing files in Firebase:

1. Download files from Firebase Storage
2. Upload to Cloudinary
3. Update database with new URLs
4. Delete Firebase storage rules and files

## Next Steps

1. Add Cloudinary credentials to `.env`
2. Test file upload with Postman
3. Update frontend to handle multipart/form-data
4. Implement file deletion when seller/product is deleted
5. Add image optimization (resize, compress) in Cloudinary settings
