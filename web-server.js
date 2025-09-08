const express = require('express');
const qrcode = require('qrcode');
const app = express();
const PORT = process.env.PORT || 3000;

// Global variables to store QR code
let currentQRCode = null;
let botStatus = 'Starting...';
let lastUpdate = new Date();

// Middleware
app.use(express.static('public'));
app.use(express.json());

// Serve QR code page
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>WhatsApp Bot - QR Code Scanner</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                max-width: 600px;
                margin: 0 auto;
                padding: 20px;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                min-height: 100vh;
            }
            .container {
                background: rgba(255, 255, 255, 0.1);
                border-radius: 15px;
                padding: 30px;
                text-align: center;
                backdrop-filter: blur(10px);
                box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.37);
            }
            .qr-container {
                background: white;
                border-radius: 10px;
                padding: 20px;
                margin: 20px 0;
                display: inline-block;
            }
            .status {
                padding: 10px;
                border-radius: 5px;
                margin: 10px 0;
                font-weight: bold;
            }
            .status.connecting { background: rgba(255, 193, 7, 0.3); }
            .status.connected { background: rgba(40, 167, 69, 0.3); }
            .status.error { background: rgba(220, 53, 69, 0.3); }
            .refresh-btn {
                background: #28a745;
                color: white;
                border: none;
                padding: 10px 20px;
                border-radius: 5px;
                cursor: pointer;
                font-size: 16px;
                margin: 10px;
            }
            .refresh-btn:hover { background: #218838; }
            h1 { margin-bottom: 10px; }
            .subtitle { margin-bottom: 30px; opacity: 0.9; }
            .instructions {
                background: rgba(255, 255, 255, 0.1);
                border-radius: 10px;
                padding: 20px;
                margin: 20px 0;
                text-align: left;
            }
            .step {
                margin: 10px 0;
                padding: 5px 0;
            }
            .step strong { color: #ffd700; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🤖 WhatsApp Bot</h1>
            <p class="subtitle">QR Code Scanner & Status</p>
            
            <div class="status" id="status">Loading...</div>
            
            <div class="qr-container" id="qrContainer">
                <p>Loading QR Code...</p>
            </div>
            
            <button class="refresh-btn" onclick="refreshQR()">🔄 Refresh QR Code</button>
            <button class="refresh-btn" onclick="checkStatus()">📊 Check Status</button>
            
            <div class="instructions">
                <h3>📱 How to Connect:</h3>
                <div class="step"><strong>1.</strong> Open WhatsApp on your phone</div>
                <div class="step"><strong>2.</strong> Go to Settings → Linked Devices</div>
                <div class="step"><strong>3.</strong> Tap "Link a Device"</div>
                <div class="step"><strong>4.</strong> Scan the QR code above</div>
                <div class="step"><strong>5.</strong> Wait for connection confirmation</div>
            </div>
            
            <p><small>Last updated: <span id="lastUpdate">${lastUpdate.toLocaleString()}</span></small></p>
        </div>

        <script>
            async function refreshQR() {
                document.getElementById('qrContainer').innerHTML = '<p>Loading QR Code...</p>';
                try {
                    const response = await fetch('/qr');
                    const data = await response.json();
                    
                    if (data.qr) {
                        document.getElementById('qrContainer').innerHTML = 
                            '<img src="' + data.qr + '" alt="QR Code" style="max-width: 100%; height: auto;">';
                    } else {
                        document.getElementById('qrContainer').innerHTML = 
                            '<p>' + (data.message || 'No QR code available') + '</p>';
                    }
                } catch (error) {
                    document.getElementById('qrContainer').innerHTML = 
                        '<p>Error loading QR code: ' + error.message + '</p>';
                }
            }

            async function checkStatus() {
                try {
                    const response = await fetch('/status');
                    const data = await response.json();
                    
                    const statusElement = document.getElementById('status');
                    statusElement.textContent = data.status;
                    statusElement.className = 'status ' + data.class;
                    
                    document.getElementById('lastUpdate').textContent = new Date().toLocaleString();
                } catch (error) {
                    console.error('Error checking status:', error);
                }
            }

            // Auto-refresh every 30 seconds
            setInterval(checkStatus, 30000);
            
            // Initial load
            checkStatus();
            refreshQR();
        </script>
    </body>
    </html>
    `);
});

// API endpoints
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        botStatus: botStatus
    });
});

app.get('/qr', async (req, res) => {
    try {
        if (currentQRCode) {
            const qrDataURL = await qrcode.toDataURL(currentQRCode);
            res.json({ qr: qrDataURL, timestamp: lastUpdate });
        } else {
            res.json({ message: 'No QR code available. Bot might be connected or starting.', timestamp: lastUpdate });
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to generate QR code', details: error.message });
    }
});

app.get('/status', (req, res) => {
    let statusClass = 'connecting';
    if (botStatus.includes('Connected') || botStatus.includes('Ready')) {
        statusClass = 'connected';
    } else if (botStatus.includes('Error') || botStatus.includes('Failed')) {
        statusClass = 'error';
    }
    
    res.json({ 
        status: botStatus, 
        class: statusClass, 
        timestamp: lastUpdate,
        hasQR: !!currentQRCode
    });
});

// Functions to be called from bot.js
function updateQRCode(qr) {
    currentQRCode = qr;
    lastUpdate = new Date();
    console.log('🌐 QR Code updated - Visit web interface to scan');
}

function updateBotStatus(status) {
    botStatus = status;
    lastUpdate = new Date();
    console.log('📊 Bot Status:', status);
}

function clearQRCode() {
    currentQRCode = null;
    lastUpdate = new Date();
    console.log('🗑️ QR Code cleared');
}

// Start web server
function startWebServer() {
    return new Promise((resolve) => {
        const server = app.listen(PORT, () => {
            console.log('🌐 Web interface running at:');
            console.log(`   Local: http://localhost:${PORT}`);
            if (process.env.RAILWAY_STATIC_URL) {
                console.log(`   Railway: ${process.env.RAILWAY_STATIC_URL}`);
            }
            console.log('📱 Open this URL to scan QR code for WhatsApp connection');
            resolve(server);
        });
    });
}

module.exports = {
    startWebServer,
    updateQRCode,
    updateBotStatus,
    clearQRCode
};
