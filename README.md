# boltpayroll

[![Open in Bolt](https://bolt.new/static/open-in-bolt.svg)](https://bolt.new/~/sb1-fjp6djyh)

## Database setup

This app stores payroll data in PostgreSQL. The repository includes the main payroll schema in `supabase/migrations/20260415053044_create_payroll_system_schema.sql`.

### Environment variables

Copy `.env.example` to `.env` and fill in your database URLs.

- `PAYROLL_DATABASE_URL` — payroll data and core tables
- `LMS_DATABASE_URL` — leave and permissions integration
- `TIMESHEET_DATABASE_URL` or `DATABASE_URL` — timesheet submission integration
- `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` — optional if you want to connect the frontend directly to Supabase

> If a password contains `@`, encode it as `%40` in the URL.

### Run the app

The frontend proxies `/api` requests to the local API server on port `3000`, so you must start both:

```bash
npm run api
npm run dev
```

Or run both together:

```bash
npm run dev:all
```

### Run migrations

Install dependencies and run the migration script:

```bash
npm install
npm run migrate
```

This will apply the payroll schema to the configured payroll database and create integration tables in the LMS / timesheet databases when those URLs are set.
