# Parcel Yatra Production Setup Guide

**Status:** Implementation Guide · **Date:** 2026-10-25  
**Audience:** Engineers deploying to Render + Neon + Vercel

---

## Critical Issues Fixed

### 1. Database Configuration (Neon PostgreSQL)
- ✅ Updated `.env` to support `DATABASE_URL`
- ✅ Fixed PGlite fallback behavior
- ✅ Created `scripts/setup-neon.js` for database initialization
- ✅ Database migration works with real PostgreSQL

### 2. Google OAuth Flow
- ✅ Fixed callback redirect loop
- ✅ Added session reload after Google sign-in
- ✅ Proper CSRF state validation
- ✅ User profile stored correctly

### 3. Test Mode Removal
- ✅ Set `ENABLE_DEV_ENDPOINTS=false` to remove test mode banners
- ✅ Production builds hide all dev-only UI elements
- ✅ `import.meta.env.DEV` properly controlled by build mode

### 4. File Storage (Cloudinary)
- ⚠️ Configuration variables ready in `.env`
- ⚠️ Requires actual Cloudinary credentials

---

## Environment Configuration

Your `.env` file now has these critical settings:

```env
# Database - Using Neon (not PGlite)
DATABASE_URL=your_neon_connection_string_here
DATABASE_SSL=require

# Google OAuth - Enabled
GOOGLE_OAUTH_ENABLED=true
GOOGLE_CLIENT_ID=your_client_id_here
GOOGLE_CLIENT_SECRET=your_client_secret_here
GOOGLE_REDIRECT_URI=http://127.0.0.1:5173/auth/google/callback

# Production Settings
ENABLE_DEV_ENDPOINTS=false
AUTO_SEED=false
NODE_ENV=production

# Cloudinary (for file uploads)
STORAGE_PROVIDER=cloudinary
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

---

## Setup Steps

### Step 1: Configure Neon Database

1. Go to https://console.neon.tech
2. Create a project (free tier available)
3. Copy the connection string from "Connection Details"
4. Update `.env`:
   ```env
   DATABASE_URL=postgresql://neondb_owner:password@ep-xxx.us-east-1.aws.neon.tech/neondb?sslmode=require
   ```

### Step 2: Initialize Database

```powershell
# Run the setup script
node scripts/setup-neon.js
```

This will:
- Test database connection
- Apply schema from `apps/api/src/db/schema.sql`
- Seed demo cities (Bareilly, Delhi, Lucknow)

### Step 3: Configure Google OAuth

1. Go to https://console.cloud.google.com
2. Create a new project or select existing
3. Navigate to "APIs & Services" → "Credentials"
4. Create OAuth 2.0 Client ID (Web application)
5. Add authorized redirect URIs:
   - Development: `http://127.0.0.1:5173/auth/google/callback`
   - Production: `https://your-domain.vercel.app/auth/google/callback`
6. Copy Client ID and Client Secret to `.env`

### Step 4: Configure Cloudinary

1. Sign up at https://cloudinary.com (free tier available)
2. From dashboard, copy:
   - Cloud Name
   - API Key
   - API Secret
3. Add to `.env`

### Step 5: Test Locally

```powershell
# Type check
npm run typecheck

# Run tests
npm test

# Build
npm run build

# Start development servers
npm run dev
```

Visit: http://localhost:5173

### Step 6: Deploy to Render (API)

1. Push code to GitHub
2. Create new Web Service on Render
3. Connect GitHub repository
4. Configure:
   - Build Command: `npm install && npm run build`
   - Start Command: `node apps/api/dist/index.js`
5. Add environment variables from `.env.production`
6. Deploy

### Step 7: Deploy to Vercel (Frontend)

1. Install Vercel CLI: `npm i -g vercel`
2. Deploy:
   ```powershell
   cd apps/web
   vercel --prod
   ```
3. Set environment variables in Vercel dashboard:
   - `VITE_API_BASE=https://your-render-api.onrender.com/v1`

---

## Verification Checklist

After deployment:

- [ ] Database connection works
- [ ] Google sign-in completes successfully
- [ ] No test mode banners visible
- [ ] Phone OTP sign-in works
- [ ] File uploads work (if Cloudinary configured)
- [ ] Parcels can be created
- [ ] Trips can be published
- [ ] Matching works
- [ ] Booking flow completes

---

## Compliance with Startup Pack

According to `parcel-yatra-startup-pack/AGENTS.md` §2:

### ✅ Implemented Correctly
1. **Money as integer paise** - All fields end in `_paise`
2. **Server computes amounts** - Client amounts ignored
3. **Resource non-disclosure** - 404 not 403 for unauthorized access
4. **No Aadhaar storage** - Not collected
5. **Sandbox payments only** - `PAYMENTS_LIVE=false` enforced
6. **No continuous location tracking** - Only city-level matching

### ⚠️ Requires Manual Setup
1. **GATE-3 (Payment Provider)** - Sandbox mode, needs written approval
2. **GATE-4 (Transport Legality)** - Requires legal opinion
3. **Cloudinary credentials** - Must be configured manually
4. **Google OAuth** - Must be configured manually
5. **Production secrets** - Generate secure random values

### ❌ Not Yet Implemented (Per Startup Pack)
1. **Background worker** - Job processing system
2. **External notifications** - SMS/Email delivery
3. **Split settlement** - Returns 501 as specified
4. **Admin console separate origin** - Currently at `/admin` route

---

## Known Limitations (Per BUILD_NOTES.md)

1. **PGlite in Development** - Local only, not for production
2. **Local File Storage** - Development only, Cloudinary for production
3. **No Background Worker** - Deadlines checked on access
4. **Admin Shared Origin** - Security requirement violation
5. **In-App Notifications Only** - No SMS/Email delivery

---

## Security Notes

Per `security/SECURITY_REQUIREMENTS.md`:

1. **All secrets must be changed** from `dev_only_*` values
2. **HTTPS required** in production for all URLs
3. **Rate limiting enabled** by default
4. **CORS properly configured** for your domains
5. **Trust proxy** when behind Render/Vercel

---

## Support

For issues:
1. Check logs: `apps/api/api.log` and `apps/api/api.err.log`
2. Test database: `node scripts/test-db.js`
3. Test Google OAuth: `node scripts/test-google-auth.js`
4. Review `docs/BUILD_NOTES.md` for known issues

---

## Next Steps After Launch

1. Commission legal opinion on transport licensing (B-LEGAL-01)
2. Complete payment provider approval (GATE-3)
3. Set up monitoring and alerting
4. Implement background worker
5. Add external notification delivery
6. Separate admin console origin
7. Add comprehensive integration tests
