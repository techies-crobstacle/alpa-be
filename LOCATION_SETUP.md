# ALPA Marketplace - Location Validation Setup

## Architecture Overview

**Frontend**: Google Places Autocomplete (restrict to Northern Territory, Australia)  
**Backend**: Accept `place_id` → Validate via Geocoding API → Fallback to `manual_review`

---

## 1. Frontend Setup (React/React Native)

### Install Google Places Autocomplete

```bash
npm install @react-google-maps/api
# OR for React Native
npm install react-native-google-places-autocomplete
```

### React Web Implementation

```jsx
import { Autocomplete, useLoadScript } from '@react-google-maps/api';
import { useState } from 'react';

const libraries = ['places'];

function LocationInput() {
  const { isLoaded } = useLoadScript({
    googleMapsApiKey: 'YOUR_GOOGLE_MAPS_API_KEY',
    libraries,
  });

  const [autocomplete, setAutocomplete] = useState(null);
  const [selectedPlace, setSelectedPlace] = useState(null);

  const onLoad = (autocompleteInstance) => {
    setAutocomplete(autocompleteInstance);
  };

  const onPlaceChanged = () => {
    if (autocomplete !== null) {
      const place = autocomplete.getPlace();
      
      // Send place_id to backend for validation
      validateLocation(place.place_id);
    }
  };

  const validateLocation = async (place_id) => {
    const response = await fetch('https://your-api.com/api/validate-location', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userToken}`
      },
      body: JSON.stringify({ place_id })
    });

    const data = await response.json();
    
    if (data.status === 'verified') {
      console.log('✅ Location verified:', data.formattedAddress);
      // Proceed with registration/order
    } else if (data.status === 'manual_review') {
      console.log('⚠️ Location needs manual review:', data.message);
      // Show warning: "Your location will be verified by our team"
      // Still allow user to proceed
    }
  };

  if (!isLoaded) return <div>Loading...</div>;

  return (
    <Autocomplete
      onLoad={onLoad}
      onPlaceChanged={onPlaceChanged}
      restrictions={{ country: 'au' }}
      options={{
        componentRestrictions: { country: 'au' },
        // Restrict to Northern Territory
        bounds: {
          north: -10.9,
          south: -26.0,
          east: 138.0,
          west: 129.0
        },
        strictBounds: false // Allow suggestions outside bounds but prioritize NT
      }}
    >
      <input
        type="text"
        placeholder="Enter your address"
        style={{
          width: '100%',
          height: '40px',
          padding: '0 12px',
          fontSize: '16px'
        }}
      />
    </Autocomplete>
  );
}

export default LocationInput;
```

### React Native Implementation

```jsx
import { GooglePlacesAutocomplete } from 'react-native-google-places-autocomplete';

function LocationInput() {
  const handlePlaceSelect = async (data, details = null) => {
    const place_id = data.place_id;
    
    // Validate with backend
    try {
      const response = await fetch('https://your-api.com/api/validate-location', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userToken}`
        },
        body: JSON.stringify({ place_id })
      });

      const result = await response.json();
      
      if (result.status === 'verified') {
        Alert.alert('✅ Location Verified', result.formattedAddress);
      } else if (result.status === 'manual_review') {
        Alert.alert(
          '⚠️ Manual Review Required',
          'Your location will be verified by our team within 24 hours.'
        );
      }
    } catch (error) {
      console.error('Location validation error:', error);
    }
  };

  return (
    <GooglePlacesAutocomplete
      placeholder='Enter your address'
      onPress={handlePlaceSelect}
      query={{
        key: 'YOUR_GOOGLE_MAPS_API_KEY',
        language: 'en',
        components: 'country:au',
        // Location bias for Northern Territory (Darwin center)
        location: '-12.4634,130.8456',
        radius: 500000 // 500km radius
      }}
      enablePoweredByContainer={false}
      fetchDetails={true}
      styles={{
        textInput: {
          height: 44,
          fontSize: 16,
          borderWidth: 1,
          borderColor: '#ccc',
          borderRadius: 8,
          paddingHorizontal: 12
        }
      }}
    />
  );
}
```

---

## 2. Backend Setup (Already Implemented)

### API Endpoint

**POST** `/api/validate-location`

**Headers:**
```
Authorization: Bearer <user_token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "place_id": "ChIJrTLr-GyugsHRvTZRqk4UfFg"
}
```

**Response - Verified (Location in NT):**
```json
{
  "success": true,
  "status": "verified",
  "message": "Location verified in Northern Territory",
  "formattedAddress": "Darwin NT 0800, Australia",
  "lat": -12.4634,
  "lng": 130.8456,
  "place_id": "ChIJrTLr-GyugsHRvTZRqk4UfFg"
}
```

**Response - Manual Review (Outside NT or Google failed):**
```json
{
  "success": true,
  "status": "manual_review",
  "message": "Location is outside Northern Territory. Will be reviewed manually.",
  "formattedAddress": "Sydney NSW 2000, Australia",
  "place_id": "ChIJP3Sa8ziYEmsRUKgyFmh9AQM"
}
```

---

## 3. Environment Variables

### Backend (.env file)

```env
GOOGLE_MAPS_API_KEY=your_google_maps_api_key_here
```

### Get Google Maps API Key

1. Go to: https://console.cloud.google.com/
2. Create a new project
3. Enable APIs:
   - **Places API** (for frontend autocomplete)
   - **Geocoding API** (for backend validation)
4. Create credentials → API Key
5. Restrict API key:
   - **Frontend key**: Restrict to your domain/app
   - **Backend key**: Restrict to your server IP

---

## 4. User Flow

```
1. User types address
   ↓
2. Frontend: Google Places Autocomplete shows suggestions
   (Biased to Northern Territory, Australia)
   ↓
3. User selects a suggestion
   ↓
4. Frontend: Get place_id from selection
   ↓
5. Frontend: Send place_id to backend /api/validate-location
   ↓
6. Backend: Validate via Google Geocoding API
   ↓
7. Backend Response:
   
   IF location is in Northern Territory:
     → status: "verified" ✅
     → Allow user to proceed immediately
   
   IF location is outside NT OR Google API fails:
     → status: "manual_review" ⚠️
     → Allow user to proceed
     → Flag for admin to review later
   ↓
8. Frontend: Show appropriate message to user
9. Save location data with status in database
```

---

## 5. Database Schema (Firestore)

### Buyers Collection

```javascript
{
  uid: "user123",
  name: "John Doe",
  email: "john@example.com",
  location: {
    place_id: "ChIJrTLr-GyugsHRvTZRqk4UfFg",
    formattedAddress: "Darwin NT 0800, Australia",
    lat: -12.4634,
    lng: 130.8456,
    status: "verified", // or "manual_review"
    validatedAt: "2025-12-20T10:30:00Z"
  }
}
```

### Orders Collection

```javascript
{
  orderId: "order123",
  buyerId: "user123",
  deliveryAddress: {
    place_id: "ChIJrTLr-GyugsHRvTZRqk4UfFg",
    formattedAddress: "Darwin NT 0800, Australia",
    lat: -12.4634,
    lng: 130.8456,
    status: "verified",
    validatedAt: "2025-12-20T10:30:00Z"
  },
  // ... other order fields
}
```

---

## 6. Admin Dashboard (Manual Review)

### Query locations needing review:

```javascript
// Get all users with manual_review status
const usersNeedingReview = await db.collection('buyers')
  .where('location.status', '==', 'manual_review')
  .get();

// Get all orders with manual_review status
const ordersNeedingReview = await db.collection('orders')
  .where('deliveryAddress.status', '==', 'manual_review')
  .get();
```

### Admin can:
1. View the location on Google Maps
2. Approve or reject the location
3. Update status to "verified" or "rejected"

---

## 7. Cost Estimation

### Google Maps API Pricing (Free tier included)

- **Places Autocomplete**: $2.83 per 1,000 requests (Frontend)
- **Geocoding API**: $5.00 per 1,000 requests (Backend)
- **Free monthly credit**: $200 (~71,000 autocomplete requests)

**Recommendation**: Start with free tier, monitor usage

---

## 8. Testing

### Test with Darwin address:
```
Input: "Darwin NT"
Expected: status = "verified"
```

### Test with Sydney address:
```
Input: "Sydney NSW"
Expected: status = "manual_review"
```

### Test with invalid place_id:
```
place_id: "invalid123"
Expected: status = "manual_review"
```

---

## 9. Security Notes

✅ **Backend validation**: Always validate on backend, never trust frontend  
✅ **API key restriction**: Restrict keys to your domain/IP  
✅ **Authentication required**: User token required for /api/validate-location  
✅ **Rate limiting**: Consider adding rate limits to prevent abuse  

---

## Summary

**Frontend**: Uses Google Places Autocomplete (bias to NT, Australia)  
**Backend**: Validates place_id via Geocoding API  
**Fallback**: Always allows with manual_review status  
**User Experience**: Seamless - users can always proceed  
**Admin**: Reviews flagged locations manually  

This approach balances automation with flexibility! 🎉
