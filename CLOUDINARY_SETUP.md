# Quick Setup: Cloudinary for File Storage

## Step 1: Sign Up for Cloudinary (Free Tier)

1. Go to https://cloudinary.com/users/register/free
2. Sign up with your email or Google account
3. Verify your email address

## Step 2: Get Your Credentials

1. After login, you'll see your **Dashboard**
2. You'll find these three values:
   - **Cloud Name**: e.g., `dxyz123abc`
   - **API Key**: e.g., `123456789012345`
   - **API Secret**: e.g., `abcdefghijklmnopqrstuvwxyz123`

## Step 3: Add to .env File

Open your `.env` file and add:

```env
CLOUDINARY_CLOUD_NAME=your_cloud_name_here
CLOUDINARY_API_KEY=your_api_key_here
CLOUDINARY_API_SECRET=your_api_secret_here
```

**Replace** `your_cloud_name_here`, `your_api_key_here`, and `your_api_secret_here` with your actual values from the dashboard.

## Step 4: Restart Your Server

```bash
# Stop the server (Ctrl+C)
# Start again
node server.js
```

## Step 5: Test Upload

Use Postman to test the KYC upload endpoint:

### Request Setup
- **Method**: POST
- **URL**: http://localhost:5000/seller/upload-kyc
- **Headers**: 
  - `Authorization: Bearer YOUR_JWT_TOKEN`
- **Body**: 
  - Type: `form-data`
  - Add files with key `documents` (you can select multiple files)

### Expected Response
```json
{
  "success": true,
  "message": "KYC documents uploaded successfully",
  "documents": [
    {
      "documentType": "documents",
      "documentUrl": "https://res.cloudinary.com/dxyz123abc/image/upload/v1234567890/alpa/kyc-documents/doc-123.pdf",
      "publicId": "alpa/kyc-documents/doc-123",
      "originalName": "drivers_license.pdf",
      "uploadedAt": "2024-01-01T12:00:00.000Z"
    }
  ],
  "sellerProfile": { ... }
}
```

## Cloudinary Free Tier Limits

- **Storage**: 25 GB
- **Bandwidth**: 25 GB/month
- **Transformations**: 25 credits/month
- **Files**: Unlimited

This should be more than enough for development and small-scale production!

## Troubleshooting

### "Invalid API key or secret"
- Double-check your credentials in .env
- Make sure there are no spaces or quotes around the values
- Restart your server after changing .env

### "Upload failed"
- Check your internet connection
- Verify Cloudinary account is active
- Check file size (must be under 5MB for documents)

### "Cannot find module 'cloudinary'"
```bash
npm install cloudinary
```

## Optional: Configure Upload Presets

In your Cloudinary Dashboard:

1. Go to **Settings** → **Upload**
2. Scroll to **Upload presets**
3. Create a new preset with:
   - **Mode**: Unsigned (for public uploads) or Signed (more secure)
   - **Folder**: alpa (to organize files)
   - **Auto-tagging**: Enable for better organization

## Alternative: Use Cloudinary Upload Widget

For frontend uploads, you can use Cloudinary's widget:

```html
<script src="https://upload-widget.cloudinary.com/global/all.js"></script>
<script>
  var myWidget = cloudinary.createUploadWidget({
    cloudName: 'your_cloud_name', 
    uploadPreset: 'your_upload_preset'
  }, (error, result) => { 
    if (!error && result && result.event === "success") { 
      console.log('Upload successful! URL:', result.info.secure_url);
    }
  });
  
  document.getElementById("upload_widget").addEventListener("click", function(){
    myWidget.open();
  }, false);
</script>
```

This allows direct uploads from the browser without going through your backend!

## Need Help?

- Cloudinary Documentation: https://cloudinary.com/documentation
- Cloudinary Node.js SDK: https://cloudinary.com/documentation/node_integration
- API Reference: https://cloudinary.com/documentation/image_upload_api_reference
