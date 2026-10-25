# Complete Deployment Checklist for Parcel Yatra

## Current Status ✅

### API (Render) - WORKING ✅
- **URL**: https://parcelyatrafinal.onrender.com
- **Health**: ✅ Passing (200 OK)
- **Database**: ✅ Neon PostgreSQL connected
- **Storage**: ✅ Cloudinary configured
- **Environment**: ✅ All variables set correctly

### Frontend (Vercel) - NEEDS FIX ❌
- **Issue**: Cannot reach API server
- **Cause**: Missing `VITE_API_BASE` environment variable
- **Fix**: See below

---

## Step-by-Step Fix

### 1. Update Render Environment Variables

Check these are set correctly on Render:

```bash
PUBLIC_API_URL=https://parcelyatrafinal.onrender.com/v1
PUBLIC_WEB_URL=https://parcelyatra.vercel.app
ADMIN_WEB_URL=https://admin-parcelyatra.vercel.app  # If you have separate admin
```

**Note**: Replace `parcelyatra.vercel.app` with your actual Vercel domain

### 2. Update Vercel Environment Variables

Add these in Vercel Dashboard → Settings → Environment Variables:

```bash
VITE_API_BASE=https://parcelyatrafinal.onrender.com/v1
```

Make sure to set it for **all three environments**:
- ✅ Production
- ✅ Preview  
- ✅ Development

### 3. Redeploy Both Services

**Render**:
1. Go to Render dashboard
2. Select API service
3. Click "Manual Deploy" → "Deploy latest commit"

**Vercel**:
1. Go to Vercel dashboard
2. Select project
3. Go to Deployments tab
4. Click latest deployment → ⋯ menu → "Redeploy"

---

## Verification Steps

### 1. Test API Directly

```powershell
# Should return 200 OK with health status
curl https://parcelyatrafinal.onrender.com/v1/health
```

### 2. Test Frontend

1. Visit https://parcelyatra.vercel.app
2. Open browser DevTools (F12) → Network tab
3. Try to sign in
4. Check network requests - should go to `https://parcelyatrafinal.onrender.com/v1/...`

### 3. Test Google OAuth

1. Click "Sign in with Google"
2. Complete Google sign-in
3. Should redirect back to your app and be logged in

### 4. Test File Upload

1. Try creating a parcel with a photo
2. Should upload to Cloudinary (not local storage)
3. Check Cloudinary dashboard to see uploaded files

---

## Your Current Render Environment (Reference)

```
✅ CLOUDINARY_API_KEY=319716853545691
✅ CLOUDINARY_API_SECRET=Istq6l52UHhrEH8YTZzgYhtTPM8
✅ CLOUDINARY_CLOUD_NAME=dqj59es9e
✅ DATABASE_URL=postgresql://...neon.tech/neondb
✅ GOOGLE_CLIENT_ID=130100214583-...apps.googleusercontent.com
✅ GOOGLE_CLIENT_SECRET=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
✅ GOOGLE_OAUTH_ENABLED=true
✅ STORAGE_PROVIDER=cloudinary
✅ NODE_ENV=production
✅ ENABLE_DEV_ENDPOINTS=false
✅ SMS_PROVIDER=fast2sms
✅ FAST2SMS_API_KEY=(configured)
```

**Missing (add these)**:
```
⚠️ PUBLIC_API_URL=https://parcelyatrafinal.onrender.com/v1
⚠️ PUBLIC_WEB_URL=https://parcelyatra.vercel.app
```

---

## What Needs to Be Added

### On Render (API):

1. `PUBLIC_API_URL` - Your API's own URL
2. `PUBLIC_WEB_URL` - Your Vercel frontend URL
3. Optionally `ADMIN_WEB_URL` if you have separate admin site

### On Vercel (Frontend):

1. `VITE_API_BASE` - Points to your Render API URL

---

## Architecture Overview

```
User Browser
    ↓
Vercel (Frontend)
    ↓ API calls via VITE_API_BASE
Render (API)
    ↓
Neon (Database) + Cloudinary (Storage)
```

**Current Problem**: 
- Vercel doesn't know where Render is
- It's trying to call `/v1` on its own domain (fails)

**Solution**:
- Add `VITE_API_BASE` to Vercel
- Frontend will call `https://parcelyatrafinal.onrender.com/v1`
- API responds with data
- ✅ Everything works!

---

## Expected Results After Fix

✅ Landing page loads  
✅ Sign in with phone OTP works  
✅ Sign in with Google works  
✅ User can create parcels  
✅ Travellers can publish trips  
✅ Matching works  
✅ Bookings can be created  
✅ File uploads work (to Cloudinary)  
✅ No "cannot reach server" errors  

---

## Troubleshooting

### If you still get CORS errors:

1. Check `PUBLIC_WEB_URL` is set correctly on Render
2. Make sure it matches your actual Vercel domain
3. Redeploy Render after changing

### If Google OAuth redirect fails:

1. Go to Google Cloud Console
2. Check "Authorized redirect URIs" includes:
   - `https://parcelyatra.vercel.app/auth/google/callback`
3. Update `GOOGLE_REDIRECT_URI` on Render to match

### If file uploads fail:

1. Verify Cloudinary credentials are correct
2. Check Cloudinary dashboard for "parcel_yatra" folder
3. Check Render logs for upload errors

---

## Quick Command Reference

```powershell
# Test API health
curl https://parcelyatrafinal.onrender.com/v1/health

# Set Vercel env var
vercel env add VITE_API_BASE

# Redeploy Vercel
vercel --prod

# Check Vercel logs
vercel logs
```

---

## Summary

**Problem**: Frontend can't reach backend  
**Cause**: Missing `VITE_API_BASE` on Vercel  
**Solution**: Add env var and redeploy  
**Time**: 5 minutes  

Your API is working perfectly. Just need to tell the frontend where it is! 🚀
