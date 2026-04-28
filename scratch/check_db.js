
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: './dashboard/.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    console.error("Missing env vars");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function checkDB() {
    console.log("Checking Supabase connection...");
    const { data, error } = await supabase.from('exams').select('id, pin_sala, titulo').limit(5);
    if (error) {
        console.error("Error fetching exams:", error);
    } else {
        console.log("Exams in DB:", data);
    }

    const { data: logs, error: logsError } = await supabase.from('camera_logs').select('count', { count: 'exact' });
    console.log("Logs count:", logsError ? logsError : logs);
}

checkDB();
