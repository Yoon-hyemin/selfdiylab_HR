import { Client } from '@neondatabase/serverless';
import { readFileSync, existsSync } from 'node:fs';

if (!process.env.DATABASE_URL && existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/run-sql.js <path-to-sql-file>'); process.exit(1); }
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL not set (checked env and .env.local)'); process.exit(1); }

const client = new Client(process.env.DATABASE_URL);
await client.connect();
try {
  await client.query(readFileSync(file, 'utf8'));
  console.log('OK: executed', file);
} finally {
  await client.end();
}
