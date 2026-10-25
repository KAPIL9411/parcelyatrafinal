#!/usr/bin/env node
/**
 * Fix all production issues for Parcel Yatra
 * 1. Database configuration for Neon
 * 2. Google OAuth setup
 * 3. Cloudinary configuration
 * 4. Remove test mode banners
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';

console.log('=== Fixing Production Issues for Parcel Yatra ===\n');

// Read current .env
const envPath = resolve(process.cwd(), '.env');
let envContent = '';

if (existsSync(envPath)) {
  envContent = readFileSync(envPath, 'utf8');
} else {
  console.log('❌ .env file not found, creating from example...');
  const examplePath = resolve(process.cwd(), '.env.example');
  if (existsSync(examplePath)) {
    envContent = readFileSync(examplePath, 'utf8');
  } else {
    console.log('❌ .env.example not found either');
    process.exit(1);
  }
}

// Parse env file
const envLines = envContent.split('\n');
const newEnvLines = [];

console.log('🔧 Updating environment configuration...\n');

for (let line of envLines) {
  const trimmed = line.trim();
  
  // Skip comments for processing (we'll add them back)
  if (trimmed.startsWith('#')) {
    newEnvLines.push(line);
    continue;
  }
  
  const eqIndex = trimmed.indexOf('=');
  if (eqIndex === -1) {
    newEnvLines.push(line);
    continue;
  }
  
  const key = trimmed.slice(0, eqIndex).trim();
  const value = trimmed.slice(eqIndex + 1).trim();
  
  switch (key) {
    case 'NODE_ENV':
      newEnvLines.push('NODE_ENV=production');
      console.log(`  ✅ Set NODE_ENV=production`);
      break;
      
    case 'DATABASE_URL':
      if (!value || value === 'your_neon_database_url_here') {
        console.log(`  ⚠️  DATABASE_URL needs to be set to your Neon URL`);
        console.log(`     Get it from: https://console.neon.tech -> Project -> Connection Details`);
        newEnvLines.push('# DATABASE_URL=postgresql://neondb_owner:npg_XXXXXXX@ep-XXXXXXX-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require');
      } else {
        newEnvLines.push(line);
        console.log(`  ✅ DATABASE_URL is set`);
      }
      break;
      
    case 'ENABLE_DEV_ENDPOINTS':
      newEnvLines.push('ENABLE_DEV_ENDPOINTS=false');
      console.log(`  ✅ Disabled dev endpoints (removes test mode)`);
      break;
      
    case 'AUTO_SEED':
      newEnvLines.push('AUTO_SEED=false');
      console.log(`  ✅ Disabled auto-seed for production`);
      break;
      
    case 'GOOGLE_OAUTH_ENABLED':
      newEnvLines.push('GOOGLE_OAUTH_ENABLED=true');
      console.log(`  ✅ Enabled Google OAuth`);
      break;
      
    case 'GOOGLE_CLIENT_ID':
      if (!value || value.includes('CHANGE_ME') || value.includes('your_google')) {
        console.log(`  ⚠️  GOOGLE_CLIENT_ID needs to be set`);
        console.log(`     Get it from: https://console.cloud.google.com -> APIs & Services -> Credentials`);
        newEnvLines.push('# GOOGLE_CLIENT_ID=your_google_client_id_here');
      } else {
        newEnvLines.push(line);
        console.log(`  ✅ GOOGLE_CLIENT_ID is set`);
      }
      break;
      
    case 'GOOGLE_CLIENT_SECRET':
      if (!value || value.includes('CHANGE_ME') || value.includes('your_google')) {
        console.log(`  ⚠️  GOOGLE_CLIENT_SECRET needs to be set`);
        console.log(`     Get it from: https://console.cloud.google.com -> APIs & Services -> Credentials`);
        newEnvLines.push('# GOOGLE_CLIENT_SECRET=your_google_client_secret_here');
      } else {
        newEnvLines.push(line);
        console.log(`  ✅ GOOGLE_CLIENT_SECRET is set`);
      }
      break;
      
    case 'GOOGLE_REDIRECT_URI':
      // Update redirect URI for production
      const newRedirect = 'https://parcel-yatra.vercel.app/auth/google/callback';
      newEnvLines.push(`GOOGLE_REDIRECT_URI=${newRedirect}`);
      console.log(`  ✅ Set Google redirect URI to: ${newRedirect}`);
      break;
      
    case 'STORAGE_PROVIDER':
      newEnvLines.push('STORAGE_PROVIDER=cloudinary');
      console.log(`  ✅ Set storage provider to Cloudinary`);
      break;
      
    case 'CLOUDINARY_CLOUD_NAME':
      if (!value || value.includes('CHANGE_ME') || value.includes('your_cloud')) {
        console.log(`  ⚠️  CLOUDINARY_CLOUD_NAME needs to be set`);
        console.log(`     Get it from: https://cloudinary.com -> Dashboard`);
        newEnvLines.push('# CLOUDINARY_CLOUD_NAME=your_cloud_name_here');
      } else {
        newEnvLines.push(line);
        console.log(`  ✅ CLOUDINARY_CLOUD_NAME is set`);
      }
      break;
      
    case 'CLOUDINARY_API_KEY':
      if (!value || value.includes('CHANGE_ME') || value.includes('your_api')) {
        console.log(`  ⚠️  CLOUDINARY_API_KEY needs to be set`);
        console.log(`     Get it from: https://cloudinary.com -> Dashboard`);
        newEnvLines.push('# CLOUDINARY_API_KEY=your_api_key_here');
      } else {
        newEnvLines.push(line);
        console.log(`  ✅ CLOUDINARY_API_KEY is set`);
      }
      break;
      
    case 'CLOUDINARY_API_SECRET':
      if (!value || value.includes('CHANGE_ME') || value.includes('your_api')) {
        console.log(`  ⚠️  CLOUDINARY_API_SECRET needs to be set`);
        console.log(`     Get it from: https://cloudinary.com -> Dashboard`);
        newEnvLines.push('# CLOUDINARY_API_SECRET=your_api_secret_here');
      } else {
        newEnvLines.push(line);
        console.log(`  ✅ CLOUDINARY_API_SECRET is set`);
      }
      break;
      
    case 'PAYMENT_PROVIDER':
      newEnvLines.push('PAYMENT_PROVIDER=sandbox_provider');
      console.log(`  ✅ Set payment provider to sandbox_provider`);
      break;
      
    case 'SMS_PROVIDER':
      // Keep Fast2SMS as configured
      newEnvLines.push(line);
      console.log(`  ✅ Using SMS provider: ${value}`);
      break;
      
    default:
      newEnvLines.push(line);
  }
}

// Write updated .env file
writeFileSync(envPath, newEnvLines.join('\n'));
console.log('\n✅ Updated .env file');

// Create .env.production for deployment
const productionEnv = newEnvLines
  .map(line => {
    // Remove comments for production (except important ones)
    if (line.trim().startsWith('#') && line.includes('CHANGE_ME')) {
      return line;
    }
    if (line.trim().startsWith('#') && !line.includes('DATABASE_URL') && !line.includes('GOOGLE') && !line.includes('CLOUDINARY')) {
      return '';
    }
    return line;
  })
  .filter(line => line.trim().length > 0)
  .join('\n');

writeFileSync(resolve(process.cwd(), '.env.production'), productionEnv);
console.log('✅ Created .env.production for deployment');

console.log('\n=== NEXT STEPS ===\n');
console.log('1. SETUP GOOGLE OAUTH:');
console.log('   a. Go to https://console.cloud.google.com');
console.log('   b. Create a new project or select existing');
console.log('   c. Enable "Google OAuth 2.0 API"');
console.log('   d. Create OAuth 2.0 credentials (Web application)');
console.log('   e. Add authorized redirect URI: https://parcel-yatra.vercel.app/auth/google/callback');
console.log('   f. Copy Client ID and Client Secret to .env file\n');

console.log('2. SETUP CLOUDINARY:');
console.log('   a. Go to https://cloudinary.com and sign up');
console.log('   b. From dashboard, copy: Cloud Name, API Key, API Secret');
console.log('   c. Add them to .env file\n');

console.log('3. SETUP NEON DATABASE:');
console.log('   a. Go to https://console.neon.tech');
console.log('   b. Create a new project or use existing');
console.log('   c. Copy "Connection string" from Connection Details');
console.log('   d. Add to .env file as DATABASE_URL\n');

console.log('4. RUN DATABASE MIGRATION:');
console.log('   node scripts/setup-neon.js\n');

console.log('5. TEST THE APPLICATION:');
console.log('   npm run build');
console.log('   npm start\n');

console.log('6. DEPLOY TO RENDER:');
console.log('   a. Push code to GitHub');
console.log('   b. Connect repo to Render');
console.log('   c. Add all environment variables from .env.production');
console.log('   d. Deploy!\n');

console.log('=== QUICK CHECK ===\n');
console.log('Run these commands to verify:');
console.log('1. Test Google OAuth: node scripts/test-google-auth.js');
console.log('2. Test database: node scripts/test-db.js');
console.log('3. Build project: npm run build');
console.log('4. Run tests: npm test');