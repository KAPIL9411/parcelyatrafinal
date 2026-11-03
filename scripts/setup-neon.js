#!/usr/bin/env node
/**
 * Setup Neon database for Parcel Yatra
 * Run this after creating your Neon database
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';
import 'dotenv/config';

async function setupNeon() {
  console.log('=== Setting up Neon Database for Parcel Yatra ===\n');
  
  // Load environment
  const envPath = resolve(process.cwd(), '.env');
  let env = {};
  
  try {
    const envContent = readFileSync(envPath, 'utf8');
    env = Object.fromEntries(
      envContent
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'))
        .map(line => {
          const eq = line.indexOf('=');
          if (eq === -1) return null;
          return [line.slice(0, eq).trim(), line.slice(eq + 1).trim()];
        })
        .filter(Boolean)
    );
  } catch (error) {
    console.log('⚠️  Could not read .env file, using process.env');
  }
  
  const DATABASE_URL = process.env.DATABASE_URL || env.DATABASE_URL;
  
  if (!DATABASE_URL) {
    console.log('❌ DATABASE_URL is not set');
    console.log('\nPlease set DATABASE_URL in your .env file:');
    console.log('DATABASE_URL=postgresql://neondb_owner:npg_XXXXXXX@ep-XXXXXXX-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require');
    console.log('\nGet your connection string from:');
    console.log('1. Go to Neon console (https://console.neon.tech)');
    console.log('2. Select your project');
    console.log('3. Click "Connection Details"');
    console.log('4. Copy "Connection string"');
    process.exit(1);
  }
  
  console.log(`Connecting to: ${DATABASE_URL.replace(/:[^:]*@/, ':****@')}\n`);
  
  const pool = new pg.Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });
  
  try {
    const client = await pool.connect();
    console.log('✅ Connected to Neon database');
    
    // Read schema file
    const schemaPath = resolve(process.cwd(), 'apps/api/src/db/schema.sql');
    const schema = readFileSync(schemaPath, 'utf8');
    
    console.log('📋 Applying schema...');
    
    // Split by statements and execute each
    const statements = schema
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0);
    
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      try {
        await client.query(stmt + ';');
        console.log(`  ✅ Applied statement ${i + 1}/${statements.length}`);
      } catch (error) {
        console.log(`  ⚠️  Statement ${i + 1} failed (might already exist):`, error.message);
      }
    }
    
    // Seed data if AUTO_SEED is enabled
    if (env.AUTO_SEED === 'true' || process.env.AUTO_SEED === 'true') {
      console.log('\n🌱 Seeding demo data...');
      
      // Insert demo cities (Bareilly, Delhi, Lucknow)
      await client.query(`
        INSERT INTO cities (id, name, state, lat, lng, is_serviceable) VALUES
        ('c0000000-0000-4000-8000-000000000001', 'Bareilly', 'Uttar Pradesh', 28.3640, 79.4154, true),
        ('c0000000-0000-4000-8000-000000000002', 'Delhi', 'Delhi', 28.6139, 77.2090, true),
        ('c0000000-0000-4000-8000-000000000003', 'Lucknow', 'Uttar Pradesh', 26.8467, 80.9462, true)
        ON CONFLICT DO NOTHING;
      `);
      
      console.log('  ✅ Added demo cities');
      
      // Note: Users will be created automatically when they sign in with OTP
      // Google OAuth users will also be created automatically
    }
    
    client.release();
    await pool.end();
    
    console.log('\n🎉 Database setup completed successfully!');
    console.log('\nNext steps:');
    console.log('1. Start the API: npm run dev:api');
    console.log('2. Start the web app: npm run dev:web');
    console.log('3. Visit http://localhost:5173');
    console.log('4. Sign in with Google or phone OTP');
    
  } catch (error) {
    console.error('\n❌ Database setup failed:', error.message);
    console.log('\nCommon issues:');
    console.log('1. Check your Neon connection string');
    console.log('2. Ensure database exists in Neon');
    console.log('3. Check if IP is allowed in Neon settings');
    console.log('4. Verify SSL configuration');
    process.exit(1);
  }
}

setupNeon().catch(console.error);