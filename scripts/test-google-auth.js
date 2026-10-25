#!/usr/bin/env node
/**
 * Test script to verify Google OAuth configuration.
 *
 * Self-contained: reads the repository root `.env` directly (no TypeScript, no dotenv
 * dependency) so `node scripts/test-google-auth.js` works from the repo root.
 */

const fs = require('node:fs');
const path = require('node:path');

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const eq = line.indexOf('=');
        if (eq === -1) return null;
        return [line.slice(0, eq).trim(), line.slice(eq + 1).trim()];
      })
      .filter(Boolean),
  );
}

const env = loadEnv(path.resolve(__dirname, '..', '.env'));

console.log('=== Google OAuth Configuration Test ===\n');

const enabled = env.GOOGLE_OAUTH_ENABLED === 'true';
console.log(`Google OAuth Enabled: ${enabled}`);

if (enabled) {
  console.log(`Google Client ID: ${env.GOOGLE_CLIENT_ID ? '✓ Set' : '✗ Missing'}`);
  console.log(`Google Client Secret: ${env.GOOGLE_CLIENT_SECRET ? '✓ Set' : '✗ Missing'}`);
  console.log(`Google Redirect URI: ${env.GOOGLE_REDIRECT_URI ? env.GOOGLE_REDIRECT_URI : '✗ Missing'}`);

  const missing = [];
  if (!env.GOOGLE_CLIENT_ID) missing.push('GOOGLE_CLIENT_ID');
  if (!env.GOOGLE_CLIENT_SECRET) missing.push('GOOGLE_CLIENT_SECRET');
  if (!env.GOOGLE_REDIRECT_URI) missing.push('GOOGLE_REDIRECT_URI');

  if (missing.length > 0) {
    console.log(`\n❌ Missing required configuration: ${missing.join(', ')}`);
    console.log('\nTo set up Google OAuth:');
    console.log('1. Go to https://console.cloud.google.com');
    console.log('2. Create a new project or select existing');
    console.log('3. Enable "Google OAuth 2.0 API"');
    console.log('4. Create OAuth 2.0 credentials (Web application)');
    console.log(
      '5. Add authorized redirect URI:',
      env.GOOGLE_REDIRECT_URI || 'https://your-domain.com/auth/google/callback',
    );
    console.log('6. Copy Client ID and Client Secret to your .env file');
    process.exit(1);
  } else {
    console.log('\n✅ Google OAuth configuration is complete!');

    // Test URLs
    console.log('\n=== Test URLs ===');
    console.log('Google Authorization URL (example):');
    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: env.GOOGLE_REDIRECT_URI,
      response_type: 'code',
      scope: 'openid email profile',
      state: 'test_state_123',
      access_type: 'offline',
      prompt: 'consent',
    });
    console.log(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);

    console.log('\n=== Next Steps ===');
    console.log('1. Visit the Google Authorization URL in your browser');
    console.log('2. Sign in with Google account');
    console.log('3. You will be redirected back to:', env.GOOGLE_REDIRECT_URI);
    console.log('4. The callback will contain an authorization code');
    console.log('5. The API will exchange code for tokens and create user session');
  }
} else {
  console.log('ℹ️  Google OAuth is disabled. To enable:');
  console.log('   Set GOOGLE_OAUTH_ENABLED=true in .env file');
  console.log('   Configure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI');
}

console.log('\n=== Current Environment ===');
console.log(`NODE_ENV: ${env.NODE_ENV ?? 'development'}`);
console.log(`SMS Provider: ${env.SMS_PROVIDER ?? 'log'}`);
console.log(`Payments Live: ${env.PAYMENTS_LIVE ?? 'false'}`);
console.log(`Dev Endpoints: ${env.ENABLE_DEV_ENDPOINTS ?? 'true'}`);