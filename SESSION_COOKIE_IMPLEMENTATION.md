# Session Cookie Authentication Implementation

## Overview
The application now uses a **dual authentication mechanism** for maximum security and flexibility:
1. **httpOnly Session Cookie** - For server-side verification (more secure)
2. **localStorage Token (Authorization Header)** - For client-side fallback

## Security Features

### Session Cookie (Primary)
- ✅ **httpOnly**: Cannot be accessed by JavaScript (prevents XSS attacks)
- ✅ **secure**: Only sent over HTTPS in production
- ✅ **sameSite: 'strict'**: Prevents CSRF attacks
- ✅ **7-day expiration**: Same as JWT token

### localStorage Token (Fallback)
- Used if session cookie is unavailable
- Provides continuity across page refreshes and app restarts
- Standard Authorization: Bearer header

## Implementation Flow

### 1. Login
```
POST /api/auth/login
Body: { email, password }

Response:
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": { ... }
}

HTTP Headers Set:
Set-Cookie: session_token=eyJhbGciOiJIUzI1NiIs...; 
  HttpOnly; 
  Secure; 
  SameSite=Strict; 
  Path=/; 
  Max-Age=604800000
```

Frontend actions:
1. Save token to localStorage (backup)
2. Browser automatically stores session cookie
3. Both can be used for subsequent requests

### 2. Authenticated Requests

The system checks in this order:
1. **Session Cookie** (httpOnly) ← Most secure
2. **Authorization Header** (Bearer token) ← Fallback

```javascript
// If using fetch API with credentials
fetch('/api/endpoint', {
  method: 'POST',
  credentials: 'include',  // ← IMPORTANT: Include cookies
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}` // ← Backup
  },
  body: JSON.stringify(data)
})
```

### 3. Logout
```
POST /api/auth/logout

Response:
{
  "success": true,
  "message": "Logout successful. Session cookie cleared."
}

HTTP Headers Set:
Set-Cookie: session_token=; 
  HttpOnly; 
  Max-Age=0;  ← Clears the cookie
  Path=/;
```

Frontend actions:
1. Clear localStorage token
2. Browser automatically deletes session cookie
3. Redirect to login page

## Client-Side Implementation

### React Example
```javascript
// Login
async function handleLogin(email, password) {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'include', // ← Allow cookies
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  
  const data = await response.json();
  
  if (data.success) {
    // Save token for backup
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    
    // Redirect to dashboard
    window.location.href = '/dashboard';
  }
}

// Protected Route
async function fetchUserData() {
  const token = localStorage.getItem('token');
  
  const response = await fetch('/api/users/profile', {
    credentials: 'include', // ← Include session cookie
    headers: {
      'Authorization': `Bearer ${token}` // ← Backup token
    }
  });
  
  return response.json();
}

// Logout
async function handleLogout() {
  await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'include'
  });
  
  // Clear localStorage
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  
  // Redirect to login
  window.location.href = '/login';
}
```

### Vue Example
```javascript
// In your API client (axios)
import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true // ← Include cookies and headers
});

// Add auth header interceptor
api.interceptors.request.use(config => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;
```

## Environment Configuration

The cookie behavior changes based on environment:

```javascript
secure: process.env.NODE_ENV === 'production', 
  // true in production (HTTPS only)
  // false in development (HTTP allowed)

domain: process.env.NODE_ENV === 'production' ? undefined : 'localhost'
  // undefined in production (uses current domain)
  // 'localhost' in development
```

## Cookie Storage Locations

### Browser Storage
1. **Session Cookie**: Automatically managed by browser
   - Cleared when browser closes (if no maxAge)
   - Sent with every request to same domain
   - Can't be accessed by JavaScript

2. **localStorage**: Manual management
   - Persists until explicitly deleted
   - Can be accessed by JavaScript
   - Can be stolen via XSS (mitigated by session cookie)

## Troubleshooting

### Cookies Not Being Set
1. Check `credentials: 'include'` in fetch/axios
2. Ensure CORS has `credentials: true`
3. Verify cookie domain matches request domain
4. Check browser cookie settings

### "Unauthorized" After Login
1. Verify token is in cookie or localStorage
2. Check token hasn't expired (7 days)
3. Ensure Authorization header is sent correctly
4. Check JWT_SECRET matches server

### Session Lost After Page Refresh
1. Session cookie should persist (check browser settings)
2. localStorage token acts as backup
3. Both tokens have same 7-day expiration
4. If both missing, user needs to login again

## Security Best Practices

✅ Do's:
- Always use `credentials: 'include'` in requests
- Store both cookie and localStorage token
- Clear both on logout
- Use HTTPS in production
- Monitor token expiration

❌ Don'ts:
- Don't access session cookie from JavaScript (it's httpOnly for a reason)
- Don't send token in URL parameters
- Don't ignore CORS credentials requirement
- Don't mix HTTP and HTTPS in production
- Don't store sensitive data in localStorage (session cookie is safer)

## API Endpoints

### Authentication
- `POST /api/auth/signup` - Register new user
- `POST /api/auth/verify-otp` - Verify OTP
- `POST /api/auth/resend-otp` - Resend OTP
- `POST /api/auth/login` - Login (sets session cookie)
- `POST /api/auth/logout` - Logout (clears session cookie)
- `POST /api/auth/forgot-password` - Request password reset
- `POST /api/auth/reset-password` - Reset password

All protected endpoints accept either:
- Session cookie (automatic)
- Authorization: Bearer {token} header

## Testing with cURL

```bash
# Login
curl -c cookies.txt -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password123"}'

# Use cookie in request
curl -b cookies.txt http://localhost:5000/api/users/profile

# Logout
curl -b cookies.txt -X POST http://localhost:5000/api/auth/logout
```

## Migration Notes

### From Token-Only to Cookie+Token
No breaking changes! The implementation is backward compatible:
- Existing localStorage tokens still work
- New session cookies provide additional security
- Both mechanisms work independently

### For Frontend Developers
Update your API calls to include `credentials: 'include'`:

**Before:**
```javascript
fetch('/api/endpoint', {
  headers: { 'Authorization': `Bearer ${token}` }
})
```

**After:**
```javascript
fetch('/api/endpoint', {
  credentials: 'include', // ← Add this
  headers: { 'Authorization': `Bearer ${token}` }
})
```

This ensures cookies are sent automatically and fall back to the header token if needed.
