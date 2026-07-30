import { Client } from '@neondatabase/serverless';
import { readFileSync, existsSync } from 'node:fs';

if (!process.env.DATABASE_URL && existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set (checked env and .env.local)');
  process.exit(1);
}

const client = new Client(process.env.DATABASE_URL);
await client.connect();

try {
  const checks = [
    { table: 'members', expected: 5 },
    { table: 'jobs', expected: 2 },
    { table: 'candidates', expected: 3 },
    { table: 'okrs', expected: 3 },
    { table: 'evals', expected: 4 },
    { table: 'oneonones', expected: 3 },
    { table: 'holidays', expected: 8 },
  ];

  console.log('\nVerifying seed data row counts:\n');

  let allPassed = true;
  for (const check of checks) {
    const result = await client.query(`SELECT count(*) as count FROM ${check.table}`);
    const actual = parseInt(result.rows[0].count, 10);
    const passed = actual === check.expected;
    allPassed = allPassed && passed;

    const status = passed ? 'PASS' : 'FAIL';
    console.log(`${status}: ${check.table.padEnd(15)} ${actual} (expected ${check.expected})`);
  }

  console.log('');
  if (allPassed) {
    console.log('All checks passed!');
    process.exit(0);
  } else {
    console.log('Some checks failed!');
    process.exit(1);
  }
} finally {
  await client.end();
}
