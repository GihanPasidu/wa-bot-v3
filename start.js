#!/usr/bin/env node

// 🚀 Production Startup Script
// Handles graceful startup and port conflicts

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 WhatsApp Bot - Production Startup');
console.log('====================================\n');

// Check if process is already running
function checkExistingProcess() {
    const pidFile = path.join(__dirname, '.bot.pid');
    
    if (fs.existsSync(pidFile)) {
        const pid = fs.readFileSync(pidFile, 'utf8').trim();
        try {
            process.kill(pid, 0); // Check if process exists
            console.log(`⚠️ Bot is already running (PID: ${pid})`);
            console.log('🔄 Killing existing process...');
            process.kill(pid, 'SIGTERM');
            setTimeout(() => {
                if (fs.existsSync(pidFile)) {
                    fs.unlinkSync(pidFile);
                }
                startBot();
            }, 2000);
            return true;
        } catch (e) {
            // Process doesn't exist, remove stale PID file
            fs.unlinkSync(pidFile);
        }
    }
    return false;
}

function startBot() {
    console.log('🤖 Starting WhatsApp Bot...\n');
    
    const bot = spawn('node', ['bot.js'], {
        stdio: 'inherit',
        env: { ...process.env, NODE_ENV: 'production' }
    });
    
    // Write PID file
    const pidFile = path.join(__dirname, '.bot.pid');
    fs.writeFileSync(pidFile, bot.pid.toString());
    
    bot.on('close', (code) => {
        console.log(`\n🛑 Bot process exited with code ${code}`);
        
        // Clean up PID file
        if (fs.existsSync(pidFile)) {
            fs.unlinkSync(pidFile);
        }
        
        if (code !== 0) {
            console.log('🔄 Restarting in 5 seconds...');
            setTimeout(() => {
                startBot();
            }, 5000);
        }
    });
    
    bot.on('error', (err) => {
        console.error('❌ Bot startup error:', err);
        process.exit(1);
    });
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
        console.log('\n📤 Graceful shutdown...');
        bot.kill('SIGINT');
        process.exit(0);
    });
    
    process.on('SIGTERM', () => {
        console.log('\n📤 Graceful shutdown...');
        bot.kill('SIGTERM');
        process.exit(0);
    });
}

// Start the bot
if (!checkExistingProcess()) {
    startBot();
}
