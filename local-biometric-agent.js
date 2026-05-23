import ZKLib from 'node-zklib';
import cron from 'node-cron';

// ==========================================
// CONFIGURATION - CHANGE THESE SETTINGS
// ==========================================

// 1. The IP of your biometric device on your local office WiFi
const BIOMETRIC_IP = '192.168.1.201'; 
const BIOMETRIC_PORT = 4370;

// 2. The URL of your deployed Hostinger backend
// Replace with your actual live Hostinger domain URL
const HOSTINGER_URL = 'http://147.93.28.144:5010/api/attendance'; 

// ==========================================

async function syncBiometricData() {
    console.log(`[${new Date().toISOString()}] Attempting to connect to biometric machine at ${BIOMETRIC_IP}:${BIOMETRIC_PORT}...`);
    
    let machine;
    try {
        machine = new ZKLib(BIOMETRIC_IP, BIOMETRIC_PORT, 10000, 4000);
        await machine.createSocket();
        
        console.log("Connected! Fetching logs...");
        const attendances = await machine.getAttendances();
        console.log(`Found ${attendances.data.length} total attendance records on machine.`);

        // The user wants to push ALL historical data to Hostinger
        const logsToSync = attendances.data;

        console.log(`Pushing all ${logsToSync.length} logs to Hostinger. This might take a minute...`);

        let successCount = 0;
        let failCount = 0;

        for (const record of logsToSync) {
            const emp_code = record.deviceUserId;
            // Ensure punch_time is a standard ISO string for the database
            let punch_time;
            if (record.recordTime) {
                punch_time = new Date(record.recordTime).toISOString();
            }

            if (!emp_code || !punch_time) continue;

            try {
                // Sending to the POST /attendance route that already exists in your payrollRoutes.ts
                const response = await fetch(HOSTINGER_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        emp_code: emp_code,
                        punch_time: punch_time,
                        punch_state: record.punch_state || null,
                        terminal: 'Local_Sync_Agent'
                    })
                });
                
                if (response.ok) {
                    successCount++;
                } else {
                    failCount++;
                }
            } catch (err) {
                failCount++;
            }
        }

        console.log(`✅ Finished! Successfully pushed ${successCount} punches to Hostinger! (${failCount} failed/duplicates)`);

    } catch (error) {
        console.error('❌ Error during sync:', error.message);
    } finally {
        if (machine) {
            try {
                await machine.disconnect();
            } catch (e) {
                // Ignore disconnect errors
            }
        }
    }
}

// Run immediately once when started
syncBiometricData();

// Then schedule to run automatically every 10 minutes
cron.schedule('*/10 * * * *', () => {
    syncBiometricData();
});

console.log("🚀 Local Biometric Agent Started.");
console.log("It will fetch data from your local device and send it to Hostinger every 10 minutes.");
console.log("KEEP THIS TERMINAL OPEN in your office computer!");
