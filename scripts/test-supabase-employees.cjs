const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: './.env' });

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env');
  process.exit(1);
}

console.log('Using Supabase URL:', url);
console.log('Using anon key:', key ? 'present' : 'missing');

const supabase = createClient(url, key);

(async () => {
  try {
    const { data, error } = await supabase.from('employees').select('*').limit(5);
    console.log('error:', error ? error.message : null);
    console.log('data length:', data ? data.length : 0);
    console.log('data:', data);
  } catch (err) {
    console.error('Exception:', err.message || err);
    process.exit(1);
  }
})();