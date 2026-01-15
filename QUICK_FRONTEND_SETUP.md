# Quick Frontend Setup - Session Cookies

## TL;DR - What You Need to Know

✅ Session cookies are now automatically set on login
✅ Token is still returned for localStorage backup
✅ You just need to add ONE thing: `credentials: 'include'`

## 🚀 Quick Setup (5 minutes)

### Step 1: Update All API Calls to Include Credentials

**Before (Old Way):**
```javascript
fetch('/api/endpoint', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` }
})
```

**After (New Way):**
```javascript
fetch('/api/endpoint', {
  method: 'POST',
  credentials: 'include', // ← ADD THIS LINE
  headers: { 'Authorization': `Bearer ${token}` }
})
```

### Step 2: If Using Axios, Add withCredentials

**Before:**
```javascript
const api = axios.create({
  baseURL: '/api'
})
```

**After:**
```javascript
const api = axios.create({
  baseURL: '/api',
  withCredentials: true // ← ADD THIS LINE
})
```

That's it! ✅

## 📋 Login Example (React)

```javascript
async function handleLogin(email, password) {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'include', // ← REQUIRED for cookies
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });

  const data = await response.json();
  
  if (data.success) {
    // Save token for backup (optional but recommended)
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    
    // Browser automatically saved the session cookie
    // Next request will automatically include it!
    
    window.location.href = '/dashboard';
  }
}
```

## 📋 Protected API Call Example

```javascript
async function getProfile() {
  const response = await fetch('/api/users/profile', {
    credentials: 'include', // ← Browser sends session cookie automatically
    headers: {
      'Authorization': `Bearer ${localStorage.getItem('token')}` // ← Backup
    }
  });

  return response.json();
}
```

## 📋 Logout Example

```javascript
async function handleLogout() {
  const response = await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'include' // ← REQUIRED to send session cookie
  });

  if (response.ok) {
    // Clear localStorage
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    
    // Session cookie is automatically cleared by server
    // Browser deletes it automatically
    
    window.location.href = '/login';
  }
}
```

## 🔍 How to Verify It's Working

### In Browser
1. Open DevTools (F12)
2. Go to Application → Cookies
3. Look for `session_token` cookie
4. Should have: httpOnly ✓, Secure ✓, SameSite=Strict ✓

### In Network Tab
1. Do a login request
2. Response headers should show: `Set-Cookie: session_token=...`
3. Subsequent requests should include: `Cookie: session_token=...`

## ⚠️ Common Mistakes

### ❌ Mistake 1: Forgetting credentials: 'include'
```javascript
// WRONG - Cookie not sent
fetch('/api/endpoint', {
  headers: { 'Authorization': `Bearer ${token}` }
})

// RIGHT - Cookie sent automatically
fetch('/api/endpoint', {
  credentials: 'include', // ← This is REQUIRED
  headers: { 'Authorization': `Bearer ${token}` }
})
```

### ❌ Mistake 2: Wrong Axios Config
```javascript
// WRONG
const api = axios.create({
  baseURL: '/api',
  // Missing withCredentials
})

// RIGHT
const api = axios.create({
  baseURL: '/api',
  withCredentials: true // ← Add this
})
```

### ❌ Mistake 3: Accessing httpOnly Cookie
```javascript
// WRONG - Can't access, it's httpOnly!
console.log(document.cookie) // Won't show session_token

// RIGHT - Trust the browser, it sends it automatically
// Just use credentials: 'include' in fetch/axios
```

## 📱 Different Ways to Make API Calls

### Fetch API ✅
```javascript
fetch('/api/endpoint', {
  credentials: 'include',
  headers: { 'Authorization': `Bearer ${token}` }
})
```

### Axios ✅
```javascript
const api = axios.create({ withCredentials: true })
api.get('/endpoint')
```

### SuperAgent ✅
```javascript
request
  .get('/api/endpoint')
  .withCredentials()
```

### jQuery ✅
```javascript
$.ajax({
  url: '/api/endpoint',
  xhrFields: { withCredentials: true }
})
```

## 🔄 Migration Path

### Phase 1 (Now - Recommended)
- Add `credentials: 'include'` to all fetch calls
- Add `withCredentials: true` to axios
- Keep localStorage token for backup
- Test in dev environment

### Phase 2 (Optional)
- Monitor both mechanisms working
- Remove localStorage if not needed
- Keep session cookie as primary

### Phase 3 (Future)
- Consider removing localStorage tokens completely
- Use only session cookies (more secure)
- Or keep both for redundancy

## 🆘 Troubleshooting

**Q: Cookie not being set?**
A: Make sure you have `credentials: 'include'` in the login request

**Q: Cookie being set but not sent in subsequent requests?**
A: Add `credentials: 'include'` to ALL fetch requests, not just login

**Q: "Unauthorized" error on protected endpoints?**
A: 
1. Check cookie is visible in DevTools
2. Ensure `credentials: 'include'` in request
3. Verify Authorization header is also being sent
4. Check token hasn't expired (7 days)

**Q: Logout not working?**
A: 
1. Make sure logout request has `credentials: 'include'`
2. Clear localStorage after logout
3. Redirect to login after response

## 📞 Support

For questions about:
- Session cookies: See `SESSION_COOKIE_IMPLEMENTATION.md`
- Backend changes: Check `COOKIE_IMPLEMENTATION_SUMMARY.md`
- Full implementation details: Read `controllers/auth.js`

---

**Remember**: Just add `credentials: 'include'` to your fetch calls and you're done! 🎉
