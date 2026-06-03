import ZKLib from 'node-zklib';
import cron from 'node-cron';
import fs from 'fs';

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

        // Read the last sync time to avoid duplicating records
        let lastSyncTime = 0;
        try {
            if (fs.existsSync('last-sync.txt')) {
                const timeStr = fs.readFileSync('last-sync.txt', 'utf8');
                lastSyncTime = new Date(timeStr.trim()).getTime();
            }
        } catch (e) {
            console.log("No previous sync time found. Syncing recent data...");
        }

        // Filter logs that happened AFTER the last sync time
        const newLogs = attendances.data.filter(record => {
            if (!record.recordTime) return false;
            const logTime = new Date(record.recordTime).getTime();
            return logTime > lastSyncTime;
        });

        console.log(`Found ${newLogs.length} NEW logs since last sync. Pushing to Hostinger...`);

        if (newLogs.length === 0) {
            console.log("✅ Nothing to sync right now.");
            return;
        }

        let successCount = 0;
        let failCount = 0;
        let maxTime = lastSyncTime;

        for (const record of newLogs) {
            const emp_code = record.deviceUserId;
            // Ensure punch_time is a standard ISO string for the database
            let punch_time;
            let currentLogTime = 0;
            if (record.recordTime) {
                punch_time = new Date(record.recordTime).toISOString();
                currentLogTime = new Date(record.recordTime).getTime();
            }

            if (!emp_code || !punch_time) continue;

            try {
                // Sending to the POST /attendance route
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
                    // Update the latest time we successfully synced
                    if (currentLogTime > maxTime) {
                        maxTime = currentLogTime;
                    }
                } else {
                    failCount++;
                }
            } catch (err) {
                failCount++;
            }
        }

        // Save the new last sync time
        if (maxTime > lastSyncTime) {
            fs.writeFileSync('last-sync.txt', new Date(maxTime).toISOString());
        }

        console.log(`✅ Finished! Successfully pushed ${successCount} new punches to Hostinger! (${failCount} failed)`);

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
