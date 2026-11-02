#!/usr/bin/env node
/**
 * Test database connection
 */

import pg from 'pg';
import { config } from '../apps/api/src/config.ts';

async function testDb() {
  console.log('=== Testing Database Connection ===\n');
  
  if (!config.DATABASE_URL) {
    console.log('❌ DATABASE_URL is not set in environment');
    console.log('Please set DATABASE_URL to your Neon PostgreSQL connection string');
    console.log('Example: postgresql://username:password@ep-neon-host.neon.tech/dbname');
    process.exit(1);
  }
  
  console.log(`Using DATABASE_URL: ${config.DATABASE_URL.replace(/:[^:]*@/, ':****@')}`);
  
  const pool = new pg.Pool({
    connectionString: config.DATABASE_URL,
    ssl: config.DATABASE_SSL === 'disable' ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000,
  });
  
  try {
    const client = await pool.connect();
    console.log('✅ Connected to database successfully');
    
    const result = await client.query('SELECT version() as version, current_database() as db, current_user as user');
    console.log(`\nDatabase Info:`);
    console.log(`  Version: ${result.rows[0].version.split(' ').slice(0, 4).join(' ')}`);
    console.log(`  Database: ${result.rows[0].db}`);
    console.log(`  User: ${result.rows[0].user}`);
    
    // Check if schema exists
    const schemaCheck = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'users'
      ) as users_table_exists
    `);
    
    if (schemaCheck.rows[0].users_table_exists) {
      console.log('✅ Schema exists (users table found)');
      
      // Count users
      const userCount = await client.query('SELECT COUNT(*) as count FROM users');
      console.log(`  Total users: ${userCount.rows[0].count}`);
    } else {
      console.log('⚠️  Schema not found (users table missing)');
      console.log('Run: npm run db:migrate');
    }
    
    client.release();
    await pool.end();
    console.log('\n✅ Database test completed successfully');
    
  } catch (error) {
    console.error('\n❌ Database connection failed:', error.message);
    console.log('\nTroubleshooting:');
    console.log('1. Check if DATABASE_URL is correct');
    console.log('2. Ensure Neon database is running');
    console.log('3. Check firewall/network settings');
    console.log('4. Verify SSL settings (usually require sslmode=require)');
    process.exit(1);
  }
}

testDb().catch(console.error);