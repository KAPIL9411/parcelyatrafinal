# Parcel Yatra Deployment Guide

## Overview
This guide walks you through deploying Parcel Yatra to production with Google Sign-In, Cloudinary storage, and Neon PostgreSQL database.

## Prerequisites

1. **Neon PostgreSQL Database** (free tier available)
   - Sign up at https://neon.tech
   - Create a new project
   - Get connection string from Connection Details

2. **Cloudinary Account** (free: 25GB storage + 25GB bandwidth/month)
   - Sign up at https://cloudinary.com
   - Get Cloud Name, API Key, and API Secret from Dashboard

3. **Google Cloud Platform Project**
   - Create project at https://console.cloud.google.com
   - Enable Google OAuth 2.0 API
   - Create OAuth 2.0 credentials (Web application)
   - Add authorized redirect URI: `https://your-domain.com/auth/google/callback`

4. **Fast2SMS Account** (for SMS/OTP)
   - Sign up at https://fast2sms.com
   - Get API key from Dashboard → Dev API
   - **Important**: Complete DLT registration before production use

5. **Deployment Platforms**
   - **API**: Railway.app (recommended) or Heroku
   - **Web**: Vercel (recommended) or Netlify

## Step 1: Environment Configuration

Copy `.env.production` to `.env` on your deployment platform and fill in all values:

```bash
# Generate secure secrets
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### Required Configurations:

1. **Database** (`DATABASE_URL`)
   - Get from Neon dashboard
   - Format: `postgresql://username:password@host.neon.tech/dbname`

2. **Cloudinary** (`CLOUDINARY_*`)
   - Get from Cloudinary dashboard

3. **Google OAuth** (`GOOGLE_*`)
   - Create project at Google Cloud Console
   - Enable OAuth 2.0 API
   - Add redirect URI: `https://your-domain.com/auth/google/callback`

4. **Fast2SMS** (`FAST2SMS_API_KEY`)
   - Get API key from Fast2SMS dashboard
   - Complete DLT registration for production SMS

5. **URLs** (`PUBLIC_API_URL`, `PUBLIC_WEB_URL`, `ADMIN_WEB_URL`)
   - Set after deploying
   - Admin URL must differ from main web URL

## Step 2: Database Setup

### On Railway (Recommended):
1. Create new project on Railway
2. Add PostgreSQL database service
3. Copy connection string to `DATABASE_URL`
4. Set `DATABASE_SSL=require`
5. Enable `MIGRATE_ON_BOOT=true`

### Manual Setup:
1. Run migrations:
   ```bash
   npm run db:migrate
   ```
2. Seed data (development only):
   ```bash
   npm run db:seed
   ```

## Step 3: Deploy API

### Railway Deployment:
```bash
# Install Railway CLI
npm i -g @railway/cli

# Login and initialize
railway login
railway init

# Link to your project
railway link

# Set environment variables
railway variables set NODE_ENV production
railway variables set DATABASE_URL "your-neon-connection-string"
# ... set all other variables

# Deploy
railway up
```

### Vercel Deployment (Web):
```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel --prod

# Set environment variables in Vercel dashboard:
VITE_API_BASE=https://your-api-url.up.railway.app/v1
```

## Step 4: Google OAuth Setup

1. **Google Cloud Console:**
   - Go to APIs & Services → Credentials
   - Create OAuth 2.0 Client ID (Web application)
   - Authorized JavaScript origins: `https://your-web-url.vercel.app`
   - Authorized redirect URIs: `https://your-web-url.vercel.app/auth/google/callback`

2. **Update Environment:**
   ```
   GOOGLE_OAUTH_ENABLED=true
   GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your-client-secret
   GOOGLE_REDIRECT_URI=https://your-web-url.vercel.app/auth/google/callback
   ```

## Step 5: Cloudinary Setup

1. **Cloudinary Dashboard:**
   - Note your Cloud Name, API Key, and API Secret
   - Set up upload presets if needed

2. **Update Environment:**
   ```
   STORAGE_PROVIDER=cloudinary
   CLOUDINARY_CLOUD_NAME=your-cloud-name
   CLOUDINARY_API_KEY=your-api-key
   CLOUDINARY_API_SECRET=your-api-secret
   ```

## Step 6: SMS Configuration

1. **Fast2SMS:**
   - Complete DLT registration (required for Indian numbers)
   - Approve SMS templates
   - Get API key

2. **Update Environment:**
   ```
   SMS_PROVIDER=fast2sms
   FAST2SMS_API_KEY=your-api-key
   ```

## Step 7: Post-Deployment Verification

1. **Health Check:**
   ```
   GET https://your-api-url.up.railway.app/v1/health
   ```

2. **Google Sign-In Test:**
   - Visit login page
   - Click "Sign in with Google"
   - Complete OAuth flow

3. **File Upload Test:**
   - Upload verification documents
   - Verify files appear in Cloudinary

4. **SMS Test:**
   - Request OTP with phone number
   - Verify SMS delivery

## Step 8: Launch Checklist

### Technical:
- [ ] Database migrations applied
- [ ] Environment variables set
- [ ] Google OAuth configured
- [ ] Cloudinary working
- [ ] SMS delivery tested
- [ ] API health endpoint responding
- [ ] Admin console on separate origin

### Legal/Compliance (Critical):
- [ ] DLT registration complete for SMS
- [ ] Legal documents reviewed by lawyer
- [ ] Grievance officer appointed
- [ ] Privacy policy compliant with DPDP
- [ ] Terms of service finalized
- [ ] Payment provider confirmation (GATE-3)
- [ ] Insurance position clarified

### Monitoring:
- [ ] Error tracking (Sentry/Bugsnag)
- [ ] Log aggregation
- [ ] Uptime monitoring
- [ ] Performance monitoring

## Troubleshooting

### Common Issues:

1. **Database Connection Failed:**
   - Verify `DATABASE_URL` format
   - Check SSL requirements
   - Verify network access from deployment platform

2. **Google OAuth Redirect Mismatch:**
   - Ensure redirect URI exactly matches Google Console
   - Check for trailing slashes
   - Verify HTTPS in production

3. **File Uploads Fail:**
   - Verify Cloudinary credentials
   - Check file size limits (10MB)
   - Verify supported formats (JPEG/PNG)

4. **SMS Not Delivering:**
   - Check Fast2SMS API key
   - Verify DLT registration status
   - Check phone number format (+91XXXXXXXXXX)

5. **Admin Console Access:**
   - Ensure `ADMIN_WEB_URL` differs from `PUBLIC_WEB_URL`
   - Verify staff user roles

## Security Notes

1. **Never commit `.env` files** to version control
2. **Use HTTPS** in production for all URLs
3. **Rotate secrets** periodically
4. **Enable rate limiting** to prevent abuse
5. **Monitor logs** for suspicious activity
6. **Regular backups** of database

## Support

For issues:
1. Check application logs
2. Verify environment variables
3. Test endpoints with curl/Postman
4. Review error messages in browser console

Remember: This is a pilot build with safety rails. Some features (payments, payouts) are intentionally disabled until legal gates are cleared.