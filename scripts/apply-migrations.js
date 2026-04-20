import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const migrationsPath = path.join(projectRoot, 'supabase', 'migrations');

const dbConfig = [
  {
    name: 'Payroll DB',
    url: process.env.PAYROLL_DATABASE_URL,
  },
  {
    name: 'LMS DB',
    url: process.env.LMS_DATABASE_URL,
  },
  {
    name: 'Timesheet DB',
    url: process.env.TIMESHEET_DATABASE_URL || process.env.DATABASE_URL,
  },
];

async function getMigrationFiles() {
  const files = await fs.readdir(migrationsPath);
  return files
    .filter(file => file.endsWith('.sql'))
    .sort(); // Sort by filename to ensure proper order
}

function makeClientConfig(rawConnectionString) {
  let connectionString = rawConnectionString;
  const lowered = connectionString.toLowerCase();
  const sslModes = ['sslmode=require', 'sslmode=prefer', 'sslmode=verify-ca'];
  const hasLegacySsl = sslModes.some(mode => lowered.includes(mode));

  if (hasLegacySsl) {
    connectionString = connectionString.replace(/([?&])sslmode=(require|prefer|verify-ca)(&|$)/gi, (match, sep, mode, tail) => {
      return sep === '?' ? (tail ? '?' : '') : (tail ? sep : '');
    }).replace(/[?&]$/, '');
  }

  const config = { connectionString };

  if (hasLegacySsl) {
    config.ssl = { rejectUnauthorized: false };
  }

  return config;
}

function isIdempotentError(error) {
  const msg = String(error.message || '').toLowerCase();
  return msg.includes('already exists') || msg.includes('duplicate') || msg.includes('duplicate key value');
}

async function applyMigration({ name, url, files }) {
  if (!url) {
    console.log(`Skipping ${name}: no connection string provided.`);
    return;
  }

  const client = new Client(makeClientConfig(url));

  try {
    await client.connect();
    await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;');

    for (const file of files) {
      const sqlFilePath = path.join(migrationsPath, file);
      console.log(`\nApplying migration for ${name} from ${file}`);

      const sql = await fs.readFile(sqlFilePath, 'utf8');
      try {
        await client.query(sql);
        console.log(`✅ ${name} migration applied successfully for ${file}.`);
      } catch (error) {
        if (isIdempotentError(error)) {
          console.warn(`⚠️  ${name} already appears to be migrated for ${file}: ${error.message}`);
        } else {
          throw error;
        }
      }
    }
  } catch (error) {
    console.error(`✖ Failed to apply migration for ${name}:`, error.message || error);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

async function main() {
  console.log('Starting database migrations...');

  const migrationFiles = await getMigrationFiles();

  for (const db of dbConfig) {
    await applyMigration({ ...db, files: migrationFiles });
  }

  console.log('\nDone.');
}

main().catch(error => {
  console.error('Migration script failed:', error);
  process.exit(1);
});
