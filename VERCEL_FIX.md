# Fix "Cannot Reach Server" Error on Vercel

## Problem Identified ✅
Your Render API is working perfectly: https://parcelyatrafinal.onrender.com/v1/health returns 200 OK

**The issue**: Your Vercel frontend doesn't know where your API is!

## Solution: Configure Vercel Environment Variable

### Option 1: Via Vercel Dashboard (Recommended)

1. Go to https://vercel.com/dashboard
2. Select your project (parcel-yatra or similar)
3. Go to **Settings** → **Environment Variables**
4. Add this variable:

```
Name: VITE_API_BASE
Value: https://parcelyatrafinal.onrender.com/v1
```

5. Click **Save**
6. Go to **Deployments** tab
7. Click on the latest deployment → **⋯** menu → **Redeploy**

### Option 2: Via Vercel CLI

```powershell
# Install Vercel CLI if not installed
npm i -g vercel

# Navigate to web app
cd apps/web

# Set environment variable
vercel env add VITE_API_BASE

# When prompted, enter: https://parcelyatrafinal.onrender.com/v1
# Select: Production, Preview, Development (all three)

# Redeploy
vercel --prod
```

---

## Why This Fixes It

Your frontend code (`apps/web/src/lib/api.ts`) uses:

```typescript
export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/v1';
```

- **In development**: It falls back to `/v1` which Vite proxies to `http://127.0.0.1:3000`
- **In production (Vercel)**: Without `VITE_API_BASE`, it tries to call `/v1` on Vercel's domain (which doesn't exist)

By setting `VITE_API_BASE=https://parcelyatrafinal.onrender.com/v1`, your frontend will correctly connect to your Render API.

---

## Verify It's Working

After redeploying:

1. Visit your Vercel URL: https://parcelyatra.vercel.app (or your actual URL)
2. Open browser console (F12)
3. Try signing in
4. You should see API calls going to `https://parcelyatrafinal.onrender.com/v1/...`
5. No more "cannot reach server" error!

---

## Current Status

✅ **API (Render)**: Working perfectly
- URL: https://parcelyatrafinal.onrender.com
- Database: Connected (Neon PostgreSQL)
- Storage: Cloudinary configured
- Health check: Passing

❌ **Frontend (Vercel)**: Not configured
- Missing: VITE_API_BASE environment variable
- Result: Trying to call `/v1` on Vercel domain (fails)

---

## Additional: Update CORS if Needed

If after the above fix you get CORS errors, you need to update your Render environment:

Add to Render environment variables:
```
PUBLIC_WEB_URL=https://parcelyatra.vercel.app
```

(Replace with your actual Vercel URL)

Then redeploy on Render.
