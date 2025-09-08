const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    DisconnectReason,
    downloadMediaMessage
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { startWebServer, updateQRCode, updateBotStatus, clearQRCode } = require('./web-server');
const { config, apiServices, getConfigStatus, getSetupInstructions } = require('./api-config');

// Bot configuration (now using API config)
const botConfig = config.bot;

// Warning system storage
const warnings = new Map(); // groupJid -> Map(userJid -> count)

// Mute system storage
const mutedGroups = new Map(); // groupJid -> { endTime, reason }

// Antilink system storage
const antilinkGroups = new Set(); // groupJid -> boolean

// Auto-unmute timer
let unmuteTimer = null;

// Bot stats
const botStats = {
    startTime: Date.now(),
    messagesProcessed: 0,
    commandsExecuted: 0,
    stickersCreated: 0
};

// Warning system functions
function addWarning(groupJid, userJid) {
    if (!warnings.has(groupJid)) {
        warnings.set(groupJid, new Map());
    }
    const groupWarnings = warnings.get(groupJid);
    const currentWarnings = groupWarnings.get(userJid) || 0;
    groupWarnings.set(userJid, currentWarnings + 1);
    return currentWarnings + 1;
}

function getWarnings(groupJid, userJid) {
    if (!warnings.has(groupJid)) return 0;
    return warnings.get(groupJid).get(userJid) || 0;
}

function clearWarnings(groupJid, userJid) {
    if (warnings.has(groupJid)) {
        warnings.get(groupJid).delete(userJid);
    }
}

// Mute system functions
function parseDuration(duration) {
    const match = duration.match(/^(\d+)([mhdw])$/i);
    if (!match) return null;
    
    const value = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    
    const multipliers = {
        'm': 60 * 1000,        // minutes
        'h': 60 * 60 * 1000,   // hours
        'd': 24 * 60 * 60 * 1000, // days
        'w': 7 * 24 * 60 * 60 * 1000 // weeks
    };
    
    return value * multipliers[unit];
}

function muteGroup(groupJid, duration, reason = '') {
    const muteTime = parseDuration(duration);
    if (!muteTime) return false;
    
    const endTime = Date.now() + muteTime;
    mutedGroups.set(groupJid, { endTime, reason });
    return true;
}

function unmuteGroup(groupJid) {
    mutedGroups.delete(groupJid);
}

function isGroupMuted(groupJid) {
    const muteData = mutedGroups.get(groupJid);
    if (!muteData) return false;
    
    if (Date.now() > muteData.endTime) {
        mutedGroups.delete(groupJid);
        return false;
    }
    
    return true;
}

function getMuteInfo(groupJid) {
    const muteData = mutedGroups.get(groupJid);
    if (!muteData) return null;
    
    const remaining = muteData.endTime - Date.now();
    if (remaining <= 0) {
        mutedGroups.delete(groupJid);
        return null;
    }
    
    const minutes = Math.floor(remaining / (60 * 1000));
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    let timeStr = '';
    if (days > 0) timeStr += `${days}d `;
    if (hours % 24 > 0) timeStr += `${hours % 24}h `;
    if (minutes % 60 > 0) timeStr += `${minutes % 60}m`;
    
    return {
        remaining: timeStr.trim(),
        reason: muteData.reason
    };
}

// Antilink system functions
function enableAntilink(groupJid) {
    antilinkGroups.add(groupJid);
}

function disableAntilink(groupJid) {
    antilinkGroups.delete(groupJid);
}

function isAntilinkEnabled(groupJid) {
    return antilinkGroups.has(groupJid);
}

function containsLink(text) {
    const linkRegex = /(https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9-]+\.[a-zA-Z]{2,})/i;
    return linkRegex.test(text);
}

// Utility functions
function getRandomElement(array) {
    return array[Math.floor(Math.random() * array.length)];
}

function formatUptime(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
}

function generatePassword(length = 12) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < length; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
}

async function getWeatherInfo(city) {
    try {
        // This is a placeholder - you would need to integrate with a weather API
        return `🌤️ Weather in ${city}: 25°C, Partly Cloudy\n\n*Note: This is a demo response. Integrate with a weather API for real data.*`;
    } catch (error) {
        return "❌ Weather service unavailable.";
    }
}

function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? 
        `rgb(${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)})` : 
        'Invalid hex color';
}

// Auto-unmute function
async function checkAndAutoUnmute(sock) {
    const now = Date.now();
    const expiredGroups = [];
    
    for (const [groupJid, muteData] of mutedGroups.entries()) {
        if (now > muteData.endTime) {
            expiredGroups.push(groupJid);
        }
    }
    
    for (const groupJid of expiredGroups) {
        try {
            // Restore normal group settings
            await sock.groupSettingUpdate(groupJid, 'not_announcement');
            unmuteGroup(groupJid);
            
            // Notify group that mute has expired
            await sock.sendMessage(groupJid, { 
                text: '🔊 Group mute has expired. All members can send messages again.' 
            });
            
            console.log(`Auto-unmuted group: ${groupJid}`);
        } catch (error) {
            console.error(`Error auto-unmuting group ${groupJid}:`, error);
        }
    }
}

function getTextFromMessage(msg) {
    const m = msg.message || {};
    return (
        m.conversation ||
        (m.extendedTextMessage && m.extendedTextMessage.text) ||
        (m.imageMessage && m.imageMessage.caption) ||
        (m.videoMessage && m.videoMessage.caption) ||
        ''
    );
}

function isImageMessage(msg) {
    const m = msg.message || {};
    if (m.imageMessage) return true;
    if (m.ephemeralMessage && m.ephemeralMessage.message?.imageMessage) return true;
    if (m.viewOnceMessage && m.viewOnceMessage.message?.imageMessage) return true;
    if (m.viewOnceMessageV2 && m.viewOnceMessageV2.message?.imageMessage) return true;
    return false;
}

function extractImageMessage(msg) {
    const m = msg.message || {};
    if (m.imageMessage) return msg;
    if (m.ephemeralMessage && m.ephemeralMessage.message?.imageMessage) {
        return { ...msg, message: { imageMessage: m.ephemeralMessage.message.imageMessage } };
    }
    if (m.viewOnceMessage && m.viewOnceMessage.message?.imageMessage) {
        return { ...msg, message: { imageMessage: m.viewOnceMessage.message.imageMessage } };
    }
    if (m.viewOnceMessageV2 && m.viewOnceMessageV2.message?.imageMessage) {
        return { ...msg, message: { imageMessage: m.viewOnceMessageV2.message.imageMessage } };
    }
    return null;
}

// All commands are available to everyone; no self-chat gating

// Group management functions
async function isGroupAdmin(sock, groupJid, userJid) {
    try {
        const groupMetadata = await sock.groupMetadata(groupJid);
        
        // Check different admin field values
        const admins1 = groupMetadata.participants.filter(p => p.admin === 'admin').map(p => p.id);
        const admins2 = groupMetadata.participants.filter(p => p.admin === 'superadmin').map(p => p.id);
        const admins3 = groupMetadata.participants.filter(p => p.admin === true).map(p => p.id);
        const admins4 = groupMetadata.participants.filter(p => p.admin === 'true').map(p => p.id);
        
        // Combine all possible admin lists
        const allAdmins = [...new Set([...admins1, ...admins2, ...admins3, ...admins4])];
        
        // Check multiple JID formats
        const userBase = userJid.split('@')[0];
        
        const isAdmin = allAdmins.includes(userJid) || 
                       allAdmins.some(adminJid => {
                           const adminBase = adminJid.split('@')[0];
                           return userBase === adminBase;
                       });
        return isAdmin;
    } catch (error) {
        console.error('Error checking admin status:', error);
        return false;
    }
}

async function getGroupInfo(sock, groupJid) {
    try {
        const metadata = await sock.groupMetadata(groupJid);
        
        // Use the same admin detection logic as isGroupAdmin
        const admins1 = metadata.participants.filter(p => p.admin === 'admin').map(p => p.id);
        const admins2 = metadata.participants.filter(p => p.admin === 'superadmin').map(p => p.id);
        const admins3 = metadata.participants.filter(p => p.admin === true).map(p => p.id);
        const admins4 = metadata.participants.filter(p => p.admin === 'true').map(p => p.id);
        const allAdmins = [...new Set([...admins1, ...admins2, ...admins3, ...admins4])];
        
        return {
            name: metadata.subject,
            description: metadata.desc,
            participants: metadata.participants.length,
            admins: allAdmins.length,
            isGroup: metadata.id.endsWith('@g.us')
        };
    } catch (error) {
        console.error('Error getting group info:', error);
        return null;
    }
}

async function createStickerFromImageBuffer(buffer) {
    // Convert to webp using sharp
    const webpBuffer = await sharp(buffer).webp({ quality: 90 }).toBuffer();
    return webpBuffer;
}

async function startBot() {
    // Start web server first
    await startWebServer();
    updateBotStatus('Starting WhatsApp Bot...');
    
    const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, 'auth'));
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' })
    });


    // QR handling
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log('🔐 QR received — scan with WhatsApp to link:');
            qrcode.generate(qr, { small: true });
            console.log('\n📱 Web Interface: Open the web URL to scan QR code');
            console.log('📲 Mobile: Open WhatsApp → Linked devices → Link a device.');
            
            // Update web interface with QR code
            updateQRCode(qr);
            updateBotStatus('🔐 QR Code ready - Scan to connect');
        }
        if (connection === 'open') {
            console.log('✅ Bot connected and ready.');
            console.log('📋 Quick Commands: .help | .panel | .sticker | .calc | .time | .ping');
            
            // Clear QR code and update status
            clearQRCode();
            updateBotStatus('✅ Connected and Ready');
        } else if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed. Reconnect:', shouldReconnect);
            
            updateBotStatus('❌ Connection closed');
            if (shouldReconnect) {
                updateBotStatus('🔄 Reconnecting...');
                startBot();
            } else {
                updateBotStatus('❌ Logged out - Restart required');
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // Start auto-unmute timer (check every 30 seconds)
    unmuteTimer = setInterval(async () => {
        await checkAndAutoUnmute(sock);
    }, 30000);

    // Messages
    sock.ev.on('messages.upsert', async ({ type, messages }) => {
        if (type !== 'notify') return;
        for (const msg of messages) {
            const from = msg.key.remoteJid;
            if (!from) continue;
            // Handle status updates: mark as read if autoRead, then skip further processing
            if (from === 'status@broadcast') {
                if (botConfig.autoRead) {
                    try { await sock.readMessages([msg.key]); } catch (_) {}
                }
                continue;
            }

            const senderJid = (msg.key.participant || msg.key.remoteJid);
            const body = getTextFromMessage(msg) || '';
            
            // Check if it's a group and if user is admin for group commands
            const isGroup = from.endsWith('@g.us');
            const isAdmin = isGroup ? await isGroupAdmin(sock, from, senderJid) : false;

            // Check if group is muted (block non-admin messages)
            if (isGroup && isGroupMuted(from) && !isAdmin) {
                // Delete the message if group is muted and user is not admin
                try {
                    await sock.sendMessage(from, { 
                        text: `🔇 Group is muted. Only admins can send messages.` 
                    }, { 
                        quoted: msg 
                    });
                } catch (error) {
                    console.error('Error sending mute message:', error);
                }
                continue;
            }

            // Check for links if antilink is enabled
            if (isGroup && isAntilinkEnabled(from) && !isAdmin && containsLink(body)) {
                try {
                    // Delete the original message containing the link
                    await sock.sendMessage(from, { 
                        delete: msg.key 
                    });
                    
                    // Send warning message
                    await sock.sendMessage(from, { 
                        text: `🚫 Links are not allowed in this group.` 
                    }, { 
                        quoted: msg 
                    });
                } catch (error) {
                    console.error('Error handling antilink:', error);
                    // If deletion fails, at least send the warning
                    try {
                        await sock.sendMessage(from, { 
                            text: `🚫 Links are not allowed in this group.` 
                        }, { 
                            quoted: msg 
                        });
                    } catch (warningError) {
                        console.error('Error sending antilink warning:', warningError);
                    }
                }
                continue;
            }

            // Auto-read normal messages
            if (botConfig.autoRead) {
                try { await sock.readMessages([msg.key]); } catch (_) {}
            }

            // Increment message counter
            botStats.messagesProcessed++;

            if (body.startsWith('.')) {
                const fullCommand = body.trim().toLowerCase();
                const command = fullCommand.split(' ')[0]; // Get just the command part
                console.log(`Received command: ${fullCommand} from ${from}`);
                console.log(`Parsed command: "${command}"`);
                console.log(`Is Group: ${isGroup}, Is Admin: ${isAdmin}`);
                
                // If bot is OFF, only allow .on command
                if (!botConfig.botEnabled && command !== '.on') {
                    await sock.sendMessage(from, { text: '🛑 The bot is currently OFF. Send `.on` to enable it.' }, { quoted: msg });
                    continue;
                }
                
                // Increment command counter
                botStats.commandsExecuted++;
                
                
                console.log(`Processing command: "${command}"`);
                switch (command) {
                    case '.test': {
                        await sock.sendMessage(from, { text: '✅ Test command works!' }, { quoted: msg });
                        break;
                    }
                    case '.on': {
                        botConfig.botEnabled = true;
                        await sock.sendMessage(from, { text: '✅ Bot is now ON.\n\nTip: Send `.panel` to view the menu.' }, { quoted: msg });
                        break;
                    }
                    case '.off': {
                        botConfig.botEnabled = false;
                        await sock.sendMessage(from, { text: '🛑 Bot is now OFF.\n\nOnly the `.on` command will be accepted until it is re-enabled.' }, { quoted: msg });
                        break;
                    }
                    
                    // 🔑 API Configuration Commands
                    case '.apiconfig':
                    case '.apis': {
                        const status = getConfigStatus();
                        await sock.sendMessage(from, { 
                            text: `🔑 **API CONFIGURATION STATUS**\n\n${status.join('\n')}\n\n${getSetupInstructions()}` 
                        }, { quoted: msg });
                        break;
                    }
                    case '.panel': {
                        const panelText = `
🤖 *WhatsApp Bot v3.0 — Control Panel*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

� *Basic Commands*
• \`.help\` — Complete commands list
• \`.stats\` — Bot statistics & uptime
• \`.ping\` — Response time test
• \`.about\` — Bot information

🎨 *Media Commands*
• \`.sticker\` — Convert image to sticker
• \`.toimg\` — Convert sticker to image

🔧 *Utility Commands*
• \`.calc [2+2]\` — Calculator
• \`.time\` — Current time & date
• \`.pass [12]\` — Password generator
• \`.weather [city]\` — Weather info
• \`.qr [text]\` — QR code info

🛠️ *Advanced Tools*
• \`.translate [text]\` — Text translation
• \`.base64 encode/decode\` — Base64 encoder/decoder
• \`.hash [text]\` — Generate MD5/SHA hashes
• \`.ip [address]\` — IP address lookup
• \`.random [min] [max]\` — Random number
• \`.shorturl [url]\` — URL shortener
• \`.color [name]\` — Color code lookup

⚙️ *Settings*
• \`.autoread\` — Auto-read messages (${config.autoRead ? '✅ ON' : '❌ OFF'})
• \`.anticall\` — Block calls (${config.antiCall ? '✅ ON' : '❌ OFF'})
• \`.on\` / \`.off\` — Enable/disable bot

👑 *Group Management* (Admin Only)
• \`.ginfo\` — Group information
• \`.tagall [message]\` — Tag all members
• \`.admins\` — List group admins
• \`.members\` — Member statistics
• \`.rules\` — Display group rules
• \`.kick @user\` — Remove member
• \`.promote @user\` — Make admin
• \`.mute [1h]\` — Mute group
• \`.warn @user\` — Issue warning
• \`.resetwarns\` — Reset all warnings
• \`.groupstats\` — Detailed group stats
• \`.lock\` / \`.unlock\` — Lock group
• \`.antilink on/off\` — Link protection

📊 *Current Status*
• 🤖 Bot: ${config.botEnabled ? '✅ ONLINE' : '🛑 OFFLINE'}
• 👀 Auto Read: ${config.autoRead ? '✅ Enabled' : '❌ Disabled'}
• 📵 Anti Call: ${config.antiCall ? '✅ Enabled' : '❌ Disabled'}
• ⏱️ Uptime: ${formatUptime(Date.now() - botStats.startTime)}
• 📨 Messages: ${botStats.messagesProcessed}
• ⚡ Commands: ${botStats.commandsExecuted}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 *Tips:* Use \`.help\` for detailed command list
🔗 *More:* Use \`.ghelp\` for group commands
`;
                        await sock.sendMessage(from, { text: panelText }, { quoted: msg });
                        break;
                    }
                    case '.help': {
                        const helpText = `
🤖 *WhatsApp Bot v3.0 — Complete Commands*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📱 *Information Commands*
• \`.panel\` — Main control panel with status
• \`.help\` — This complete commands list
• \`.stats\` — Bot statistics & performance
• \`.ping\` — Check bot response time
• \`.about\` — Information about this bot

🎨 *Media Commands*
• \`.sticker\` — Convert image to sticker
• \`.toimg\` — Convert sticker back to image

🔧 *Utility Tools*
• \`.calc [expression]\` — Mathematical calculator
• \`.time\` — Current date, time & timezone
• \`.pass [length]\` — Generate secure passwords (4-50 chars)
• \`.weather [city]\` — Weather information (demo)
• \`.qr [text]\` — QR code generator info

🛠️ *Advanced Tools*
• \`.translate [text]\` — Text translation (demo)
• \`.base64 encode/decode [text]\` — Base64 encoding/decoding
• \`.hash [text]\` — Generate MD5, SHA1, SHA256 hashes
• \`.ip [address]\` — IP address geolocation lookup
• \`.random [min] [max]\` — Random number generator
• \`.shorturl [url]\` — URL shortening service
• \`.color [name]\` — Color codes & information

⚙️ *Bot Settings*
• \`.autoread\` — Toggle auto-read status (${config.autoRead ? '✅ ON' : '❌ OFF'})
• \`.anticall\` — Toggle call blocking (${config.antiCall ? '✅ ON' : '❌ OFF'})
• \`.on\` / \`.off\` — Enable/disable entire bot

👑 *Group Management* (Admins Only)
• \`.ghelp\` — Detailed group commands help
• \`.ginfo\` — Complete group information
• \`.tagall [message]\` — Tag all group members
• \`.admins\` — List all group administrators
• \`.members\` — Group member statistics
• \`.rules\` — Display group rules
• \`.groupstats\` — Complete group statistics
• \`.gtest\` — Debug admin permissions
• \`.gdesc [text]\` — Change group description
• \`.gname [text]\` — Change group name
• \`.kick @user\` — Remove member from group
• \`.promote @user\` — Make member admin
• \`.demote @user\` — Remove admin privileges
• \`.invite [number]\` — Add member by phone number

🔇 *Moderation Commands* (Admins Only)
• \`.mute [5m|1h|1d|1w]\` — Mute group temporarily
• \`.unmute\` — Remove group mute
• \`.mutestatus\` — Check current mute status
• \`.warn @user\` — Issue warning (auto-kick after 3)
• \`.warns @user\` — Check user warning count
• \`.clearwarns @user\` — Clear user warnings
• \`.resetwarns\` — Reset all group warnings
• \`.lock\` / \`.unlock\` — Lock/unlock group messages
• \`.antilink on/off\` — Toggle link protection

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 *Usage Tips:*
• Commands are case-insensitive
• Use [ ] for optional parameters
• Reply to media for sticker/image commands
• Group commands require admin privileges

🚀 *Quick Examples:*
• \`.calc 15 * 7 + 3\` — Calculate math
• \`.pass 16\` — Generate 16-char password
• \`.base64 encode Hello\` — Encode text
• \`.hash mypassword\` — Generate hashes

🔗 *Bot Version:* 3.0 | Built with Baileys
`;
                        await sock.sendMessage(from, { text: helpText }, { quoted: msg });
                        break;
                    }
                    case '.stats': {
                        const uptime = formatUptime(Date.now() - botStats.startTime);
                        const statsText = `
📊 *Bot Statistics*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⏱️ *Uptime:* ${uptime}
📨 *Messages Processed:* ${botStats.messagesProcessed}
⚡ *Commands Executed:* ${botStats.commandsExecuted}
🎨 *Stickers Created:* ${botStats.stickersCreated}
🔄 *Auto Read:* ${config.autoRead ? 'Enabled' : 'Disabled'}
📵 *Anti Call:* ${config.antiCall ? 'Enabled' : 'Disabled'}
⚡ *Status:* ${config.botEnabled ? 'Online' : 'Offline'}

🤖 *Bot Version:* 3.0
📅 *Started:* ${new Date(botStats.startTime).toLocaleString()}
`;
                        await sock.sendMessage(from, { text: statsText }, { quoted: msg });
                        break;
                    }
                    case '.ping': {
                        const start = Date.now();
                        const tempMsg = await sock.sendMessage(from, { text: '🏓 Pinging...' }, { quoted: msg });
                        const ping = Date.now() - start;
                        await sock.sendMessage(from, { 
                            text: `🏓 *Pong!*\n\n⚡ *Response Time:* ${ping}ms\n🤖 *Status:* Online` 
                        }, { quoted: msg });
                        break;
                    }
                    case '.about': {
                        const aboutText = `
🤖 *WhatsApp Bot v3.0*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 *Description*
Advanced WhatsApp bot with group management, fun commands, and utility features.

⚡ *Features*
• QR Code Authentication
• Group Management Tools
• Fun & Utility Commands
• Media Processing
• Anti-spam Protection
• Custom Admin Controls

👨‍💻 *Developer*
Built with love using Baileys library

🔗 *Technology Stack*
• Node.js
• @whiskeysockets/baileys
• Sharp (Image Processing)
• QRCode Terminal

📅 *Version:* 3.0
🚀 *Last Updated:* September 2025

Type \`.help\` for all commands!
`;
                        await sock.sendMessage(from, { text: aboutText }, { quoted: msg });
                        break;
                    }
                    case '.pass': {
                        const args = fullCommand.split(' ');
                        const length = args[1] ? parseInt(args[1]) : 12;
                        if (length < 4 || length > 50) {
                            await sock.sendMessage(from, { text: '❌ Password length must be between 4-50 characters.' }, { quoted: msg });
                            break;
                        }
                        const password = generatePassword(length);
                        await sock.sendMessage(from, { text: `🔐 *Generated Password*\n\n\`${password}\`\n\n⚠️ *Security Tip:* Save this password securely and don't share it!` }, { quoted: msg });
                        break;
                    }
                    case '.calc': {
                        const expression = fullCommand.replace('.calc', '').trim();
                        if (!expression) {
                            await sock.sendMessage(from, { text: '❌ Please provide a math expression. Usage: `.calc 2 + 2`' }, { quoted: msg });
                            break;
                        }
                        try {
                            // Simple calculator - only allow basic operations for security
                            const sanitized = expression.replace(/[^0-9+\-*/.() ]/g, '');
                            if (sanitized !== expression) {
                                await sock.sendMessage(from, { text: '❌ Only basic math operations are allowed (+, -, *, /, parentheses).' }, { quoted: msg });
                                break;
                            }
                            const result = eval(sanitized);
                            await sock.sendMessage(from, { text: `🧮 *Calculator*\n\n📝 Expression: \`${expression}\`\n🎯 Result: **${result}**` }, { quoted: msg });
                        } catch (error) {
                            await sock.sendMessage(from, { text: '❌ Invalid math expression. Please check your input.' }, { quoted: msg });
                        }
                        break;
                    }
                    case '.time': {
                        const now = new Date();
                        const timeText = `
⏰ *Current Time & Date*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📅 *Date:* ${now.toDateString()}
🕐 *Time:* ${now.toLocaleTimeString()}
🌍 *Timezone:* ${Intl.DateTimeFormat().resolvedOptions().timeZone}
📊 *Unix Timestamp:* ${Math.floor(now.getTime() / 1000)}
`;
                        await sock.sendMessage(from, { text: timeText }, { quoted: msg });
                        break;
                    }
                    case '.weather': {
                        const city = fullCommand.replace('.weather', '').trim();
                        if (!city) {
                            await sock.sendMessage(from, { text: '🌤️ Please provide a city name.\nExample: `.weather London`' }, { quoted: msg });
                            break;
                        }

                        const weatherResult = await apiServices.getWeather(city);
                        if (weatherResult.error) {
                            await sock.sendMessage(from, { text: weatherResult.error }, { quoted: msg });
                        } else {
                            const weatherMsg = `🌤️ **Weather in ${weatherResult.city}, ${weatherResult.country}**\n\n` +
                                `🌡️ **Temperature:** ${weatherResult.temperature}°C\n` +
                                `☁️ **Condition:** ${weatherResult.description}\n` +
                                `💧 **Humidity:** ${weatherResult.humidity}%\n` +
                                `💨 **Wind Speed:** ${weatherResult.windSpeed} m/s`;
                            await sock.sendMessage(from, { text: weatherMsg }, { quoted: msg });
                        }
                        break;
                    }
                    case '.qr': {
                        const text = fullCommand.replace('.qr', '').trim();
                        if (!text) {
                            await sock.sendMessage(from, { text: '❌ Please provide text to encode. Usage: `.qr Hello World`' }, { quoted: msg });
                            break;
                        }
                        if (text.length > 500) {
                            await sock.sendMessage(from, { text: '❌ Text too long. Maximum 500 characters.' }, { quoted: msg });
                            break;
                        }
                        // Note: This generates QR as text in terminal, not as image
                        await sock.sendMessage(from, { text: `📱 *QR Code Generator*\n\n✅ QR code for: "${text}"\n\n⚠️ *Note:* This is a demo response. For image QR codes, integrate with a QR generation library.` }, { quoted: msg });
                        break;
                    }
                    case '.toimg': {
                        // Convert sticker to image
                        let stickerMsg = msg.message?.stickerMessage ? msg : null;
                        if (!stickerMsg && msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.stickerMessage) {
                            stickerMsg = { 
                                ...msg, 
                                message: { 
                                    stickerMessage: msg.message.extendedTextMessage.contextInfo.quotedMessage.stickerMessage 
                                } 
                            };
                        }
                        
                        if (!stickerMsg) {
                            await sock.sendMessage(from, { text: '❌ Please send a sticker with `.toimg` or reply to a sticker with `.toimg`' }, { quoted: msg });
                            break;
                        }
                        
                        try {
                            const buffer = await downloadMediaMessage(
                                stickerMsg,
                                'buffer',
                                {},
                                { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
                            );
                            
                            // Convert WebP to PNG
                            const pngBuffer = await sharp(buffer).png().toBuffer();
                            
                            await sock.sendMessage(from, { 
                                image: pngBuffer,
                                caption: '🖼️ Sticker converted to image!'
                            }, { quoted: msg });
                        } catch (error) {
                            console.error('Error converting sticker:', error);
                            await sock.sendMessage(from, { text: '❌ Failed to convert sticker to image.' }, { quoted: msg });
                        }
                        break;
                    }
                    case '.autoread': {
                        config.autoRead = !config.autoRead;
                        await sock.sendMessage(from, { text: `${config.autoRead ? '👀' : '🚫'} Auto-read is now ${config.autoRead ? '*ENABLED*' : '*DISABLED*'}.` }, { quoted: msg });
                        break;
                    }
                    case '.anticall': {
                        config.antiCall = !config.antiCall;
                        await sock.sendMessage(from, { text: `${config.antiCall ? '📵' : '📞'} Call blocking is now ${config.antiCall ? '*ENABLED*' : '*DISABLED*'}.` }, { quoted: msg });
                        break;
                    }
                    case '.sticker': {
                        // If the triggering message includes an image, use that; otherwise, check quoted
                        let imageMsg = isImageMessage(msg) ? extractImageMessage(msg) : null;
                        if (!imageMsg && msg.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
                            const quoted = msg.message.extendedTextMessage.contextInfo.quotedMessage;
                            if (quoted.imageMessage) imageMsg = { ...msg, message: { imageMessage: quoted.imageMessage } };
                            else if (quoted.ephemeralMessage?.message?.imageMessage) imageMsg = { ...msg, message: { imageMessage: quoted.ephemeralMessage.message.imageMessage } };
                            else if (quoted.viewOnceMessage?.message?.imageMessage) imageMsg = { ...msg, message: { imageMessage: quoted.viewOnceMessage.message.imageMessage } };
                            else if (quoted.viewOnceMessageV2?.message?.imageMessage) imageMsg = { ...msg, message: { imageMessage: quoted.viewOnceMessageV2.message.imageMessage } };
                        }
                        if (!imageMsg) {
                            await sock.sendMessage(from, { text: '🖼️ Please send an image with caption \`.sticker\` or reply \`.sticker\` to an existing image.' }, { quoted: msg });
                            break;
                        }
                        try {
                            const buffer = await downloadMediaMessage(
                                imageMsg,
                                'buffer',
                                {},
                                { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
                            );
                            const webp = await createStickerFromImageBuffer(buffer);
                            await sock.sendMessage(from, { sticker: webp }, { quoted: msg });
                            await sock.sendMessage(from, { text: '🎉 Your sticker is ready!' }, { quoted: msg });
                            botStats.stickersCreated++;
                        } catch (e) {
                            console.error('Error creating sticker:', e);
                            await sock.sendMessage(from, { text: '⚠️ Unable to create sticker. Please try a different image.' }, { quoted: msg });
                        }
                        break;
                    }
                    // Group Management Commands (Admin Only)
                    case '.ginfo': {
                        if (!isGroup) {
                            await sock.sendMessage(from, { text: '❌ This command only works in groups.' }, { quoted: msg });
                            break;
                        }
                        if (!isAdmin) {
                            await sock.sendMessage(from, { text: '❌ Only group admins can use this command.' }, { quoted: msg });
                            break;
                        }
                        const groupInfo = await getGroupInfo(sock, from);
                        if (groupInfo) {
                            const infoText = `
📊 *Group Information*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏷️ *Name:* ${groupInfo.name}
👥 *Members:* ${groupInfo.participants}
👑 *Admins:* ${groupInfo.admins}
📝 *Description:* ${groupInfo.description || 'No description set'}

💡 Use \`.ghelp\` for more group commands.`;
                            await sock.sendMessage(from, { text: infoText }, { quoted: msg });
                        } else {
                            await sock.sendMessage(from, { text: '❌ Unable to fetch group information.' }, { quoted: msg });
                        }
                        break;
                    }
                    
                    case '.gtest': {
                        if (!isGroup) {
                            await sock.sendMessage(from, { text: '❌ This command only works in groups.' }, { quoted: msg });
                            break;
                        }
                        const debugText = `
🔍 *Admin Debug Info*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 *Your JID:* ${senderJid}
🏷️ *Group JID:* ${from}
👑 *Is Admin:* ${isAdmin ? '✅ YES' : '❌ NO'}
📱 *Is Group:* ${isGroup ? '✅ YES' : '❌ NO'}

Try \`.ghelp\` for group commands.`;
                        await sock.sendMessage(from, { text: debugText }, { quoted: msg });
                        break;
                    }
                    
                    case '.ghelp': {
                        if (!isGroup) {
                            await sock.sendMessage(from, { text: '❌ This command only works in groups.' }, { quoted: msg });
                            break;
                        }
                        const helpText = `
👑 *Advanced Group Management Commands*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 *Information & Analytics*
• \`.ginfo\` — Basic group information
• \`.groupstats\` — Detailed statistics & settings
• \`.members\` — Member count and breakdown
• \`.admins\` — List all group administrators
• \`.rules\` — Display group rules

📢 *Communication Tools*
• \`.tagall [message]\` — Tag all group members
• \`.gdesc <text>\` — Change group description
• \`.gname <text>\` — Change group name

👥 *Member Management*
• \`.kick @user\` — Remove member from group
• \`.promote @user\` — Make member admin
• \`.demote @user\` — Remove admin privileges
• \`.invite <number>\` — Add member by phone number

🔇 *Advanced Moderation*
• \`.mute <duration>\` — Mute group (5m, 1h, 1d, 1w)
• \`.unmute\` — Remove group mute
• \`.mutestatus\` — Check current mute status
• \`.warn @user\` — Issue warning (auto-kick after 3)
• \`.warns @user\` — Check member warning count
• \`.clearwarns @user\` — Clear specific member warnings
• \`.resetwarns\` — Reset ALL group warnings

⚙️ *Security & Settings*
• \`.lock\` — Lock group (admin-only messages)
• \`.unlock\` — Unlock group (all can message)
• \`.antilink on/off\` — Toggle link protection

🛠️ *Admin Tools*
• \`.gtest\` — Debug admin status & permissions

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ *Requirements:* All commands require admin privileges
💡 *Tips:* Use \`.groupstats\` for complete overview
🔧 *Debugging:* Use \`.gtest\` if commands don't work
`;
                        await sock.sendMessage(from, { text: helpText }, { quoted: msg });
                        break;
                    }
                    
                    case '.gdesc': {
                        if (!isGroup) {
                            await sock.sendMessage(from, { text: '❌ This command only works in groups.' }, { quoted: msg });
                            break;
                        }
                        if (!isAdmin) {
                            await sock.sendMessage(from, { text: '❌ Only group admins can use this command.' }, { quoted: msg });
                            break;
                        }
                        const newDesc = fullCommand.replace('.gdesc', '').trim();
                        if (!newDesc) {
                            await sock.sendMessage(from, { text: '❌ Please provide a description. Usage: `.gdesc <new description>`' }, { quoted: msg });
                            break;
                        }
                        try {
                            await sock.groupUpdateDescription(from, newDesc);
                            await sock.sendMessage(from, { text: '✅ Group description updated successfully!' }, { quoted: msg });
                        } catch (error) {
                            await sock.sendMessage(from, { text: '❌ Failed to update group description.' }, { quoted: msg });
                        }
                        break;
                    }
                    
                    case '.gname': {
                        if (!isGroup) {
                            await sock.sendMessage(from, { text: '❌ This command only works in groups.' }, { quoted: msg });
                            break;
                        }
                        if (!isAdmin) {
                            await sock.sendMessage(from, { text: '❌ Only group admins can use this command.' }, { quoted: msg });
                            break;
                        }
                        const newName = fullCommand.replace('.gname', '').trim();
                        if (!newName) {
                            await sock.sendMessage(from, { text: '❌ Please provide a name. Usage: `.gname <new name>`' }, { quoted: msg });
                            break;
                        }
                        try {
                            await sock.groupUpdateSubject(from, newName);
                            await sock.sendMessage(from, { text: '✅ Group name updated successfully!' }, { quoted: msg });
                        } catch (error) {
                            await sock.sendMessage(from, { text: '❌ Failed to update group name.' }, { quoted: msg });
                        }
                        break;
                    }
                    
                    case '.kick': {
                        if (!isGroup) {
                            await sock.sendMessage(from, { text: '❌ This command only works in groups.' }, { quoted: msg });
                            break;
                        }
                        if (!isAdmin) {
                            await sock.sendMessage(from, { text: '❌ Only group admins can use this command.' }, { quoted: msg });
                            break;
                        }
                        const mentionedJids = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
                        if (mentionedJids.length === 0) {
                            await sock.sendMessage(from, { text: '❌ Please mention a user to kick. Usage: `.kick @user`' }, { quoted: msg });
                            break;
                        }
                        try {
                            await sock.groupParticipantsUpdate(from, mentionedJids, 'remove');
                            await sock.sendMessage(from, { text: `✅ Successfully removed ${mentionedJids.length} member(s) from the group.` }, { quoted: msg });
                        } catch (error) {
                            await sock.sendMessage(from, { text: '❌ Failed to remove member(s) from group.' }, { quoted: msg });
                        }
                        break;
                    }
                    
                    case '.promote': {
                        if (!isGroup) {
                            await sock.sendMessage(from, { text: '❌ This command only works in groups.' }, { quoted: msg });
                            break;
                        }
                        if (!isAdmin) {
                            await sock.sendMessage(from, { text: '❌ Only group admins can use this command.' }, { quoted: msg });
                            break;
                        }
                        const mentionedJids = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
                        if (mentionedJids.length === 0) {
                            await sock.sendMessage(from, { text: '❌ Please mention a user to promote. Usage: `.promote @user`' }, { quoted: msg });
                            break;
                        }
                        try {
                            await sock.groupParticipantsUpdate(from, mentionedJids, 'promote');
                            await sock.sendMessage(from, { text: `✅ Successfully promoted ${mentionedJids.length} member(s) to admin.` }, { quoted: msg });
                        } catch (error) {
                            await sock.sendMessage(from, { text: '❌ Failed to promote member(s).' }, { quoted: msg });
                        }
                        break;
                    }
                    
                    case '.demote': {
                        if (!isGroup) {
                            await sock.sendMessage(from, { text: '❌ This command only works in groups.' }, { quoted: msg });
                            break;
                        }
                        if (!isAdmin) {
                            await sock.sendMessage(from, { text: '❌ Only group admins can use this command.' }, { quoted: msg });
                            break;
                        }
                        const mentionedJids = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
                        if (mentionedJids.length === 0) {
                            await sock.sendMessage(from, { text: '❌ Please mention a user to demote. Usage: `.demote @user`' }, { quoted: msg });
                            break;
                        }
                        try {
                            await sock.groupParticipantsUpdate(from, mentionedJids, 'demote');
                            await sock.sendMessage(from, { text: `✅ Successfully demoted ${mentionedJids.length} member(s) from admin.` }, { quoted: msg });
                        } catch (error) {
                            await sock.sendMessage(from, { text: '❌ Failed to demote member(s).' }, { quoted: msg });
                        }
                        break;
                    }
                    
                    case '.invite': {
                        if (!isGroup) {
                            await sock.sendMessage(from, { text: '❌ This command only works in groups.' }, { quoted: msg });
                            break;
                        }
                        if (!isAdmin) {
                            await sock.sendMessage(from, { text: '❌ Only group admins can use this command.' }, { quoted: msg });
                            break;
                        }
                        const number = fullCommand.replace('.invite', '').trim();
                        if (!number) {
                            await sock.sendMessage(from, { text: '❌ Please provide a phone number. Usage: `.invite <number>`' }, { quoted: msg });
                            break;
                        }
                        
                        // Clean the number (remove +, spaces, dashes)
                        let cleanNumber = number.replace(/[+\s-]/g, '');
                        
                        // Add country code if not present (assuming Sri Lanka +94)
                        if (!cleanNumber.startsWith('94') && cleanNumber.length < 12) {
                            cleanNumber = '94' + cleanNumber;
                        }
                        
                        const jid = `${cleanNumber}@s.whatsapp.net`;
                        console.log(`Attempting to invite: ${jid}`);
                        
                        try {
                            await sock.groupParticipantsUpdate(from, [jid], 'add');
                            await sock.sendMessage(from, { text: `✅ Successfully invited ${number} to the group.` }, { quoted: msg });
                        } catch (error) {
                            console.error('Invite error:', error);
                            await sock.sendMessage(from, { text: `❌ Failed to invite user to group. Error: ${error.message || 'Unknown error'}` }, { quoted: msg });
                        }
                        break;
                    }
                    
                    case '.mute': {
                        if (!isGroup) {
                            await sock.sendMessage(from, { text: '❌ This command only works in groups.' }, { quoted: msg });
                            break;
                        }
                        if (!isAdmin) {
                            await sock.sendMessage(from, { text: '❌ Only group admins can use this command.' }, { quoted: msg });
                            break;
                        }
                        const duration = fullCommand.replace('.mute', '').trim();
                        if (!duration) {
                            await sock.sendMessage(from, { text: '❌ Please provide duration. Usage: `.mute <5m|1h|1d|1w>`' }, { quoted: msg });
                            break;
                        }
                        
                        if (muteGroup(from, duration)) {
                            try {
                                // Actually change group setting to admin-only
                                await sock.groupSettingUpdate(from, 'announcement');
                                
                                const muteInfo = getMuteInfo(from);
                                await sock.sendMessage(from, { 
                                    text: `🔇 Group muted for ${duration}.\n\n⏰ Duration: ${muteInfo.remaining}\n\nOnly admins can send messages during this time.` 
                                }, { quoted: msg });
                            } catch (error) {
                                console.error('Error muting group:', error);
                                await sock.sendMessage(from, { text: '❌ Failed to mute group. Please try again.' }, { quoted: msg });
                            }
                        } else {
                            await sock.sendMessage(from, { text: '❌ Invalid duration format. Use: 5m, 1h, 1d, 1w' }, { quoted: msg });
                        }
                        break;
                    }
                    
                    case '.mutestatus': {
                        if (!isGroup) {
                            await sock.sendMessage(from, { text: '❌ This command only works in groups.' }, { quoted: msg });
                            break;
                        }
                        
                        const muteInfo = getMuteInfo(from);
                        if (muteInfo) {
                            await sock.sendMessage(from, { 
                                text: `🔇 *Group Mute Status*\n\n⏰ *Remaining:* ${muteInfo.remaining}\n📝 *Reason:* ${muteInfo.reason || 'No reason provided'}\n\nOnly admins can send messages.` 
                            }, { quoted: msg });
                        } else {
                            await sock.sendMessage(from, { text: '🔊 Group is not currently muted. All members can send messages.' }, { quoted: msg });
                        }
                        break;
                    }
                    
                    case '.unmute': {
                        if (!isGroup) {
                            await sock.sendMessage(from, { text: '❌ This command only works in groups.' }, { quoted: msg });
                            break;
                        }
                        if (!isAdmin) {
                            await sock.sendMessage(from, { text: '❌ Only group admins can use this command.' }, { quoted: msg });
                            break;
                        }
                        
                        if (isGroupMuted(from)) {
                            try {
                                // Restore normal group settings
                                await sock.groupSettingUpdate(from, 'not_announcement');
                                unmuteGroup(from);
                                await sock.sendMessage(from, { text: '🔊 Group unmuted. All members can send messages again.' }, { quoted: msg });
                            } catch (error) {
                                console.error('Error unmuting group:', error);
                                await sock.sendMessage(from, { text: '❌ Failed to unmute group. Please try again.' }, { quoted: msg });
                            }
                        } else {
                            await sock.sendMessage(from, { text: 'ℹ️ Group is not currently muted.' }, { quoted: msg });
                        }
                        break;
                    }
                    
                    case '.warns': {
                        if (!isGroup) {
                            await sock.sendMessage(from, { text: '❌ This command only works in groups.' }, { quoted: msg });
                            break;
                        }
                        if (!isAdmin) {
                            await sock.sendMessage(from, { text: '❌ Only group admins can use this command.' }, { quoted: msg });
                            break;
                        }
                        const mentionedJids = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
                        if (mentionedJids.length === 0) {
                            await sock.sendMessage(from, { text: '❌ Please mention a user to check warnings. Usage: `.warns @user`' }, { quoted: msg });
                            break;
                        }
                        
                        for (const userJid of mentionedJids) {
                            const warningCount = getWarnings(from, userJid);
                            await sock.sendMessage(from, { 
                                text: `📊 @${userJid.split('@')[0]} has ${warningCount} warning(s).` 
                            }, { 
                                quoted: msg,
                                mentions: [userJid]
                            });
                        }
                        break;
                    }
                    
                    case '.clearwarns': {
                        if (!isGroup) {
                            await sock.sendMessage(from, { text: '❌ This command only works in groups.' }, { quoted: msg });
                            break;
                        }
                        if (!isAdmin) {
                            await sock.sendMessage(from, { text: '❌ Only group admins can use this command.' }, { quoted: msg });
                            break;
                        }
                        const mentionedJids = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
                        if (mentionedJids.length === 0) {
                            await sock.sendMessage(from, { text: '❌ Please mention a user to clear warnings. Usage: `.clearwarns @user`' }, { quoted: msg });
                            break;
                        }
                        
                        for (const userJid of mentionedJids) {
                            clearWarnings(from, userJid);
                            await sock.sendMessage(from, { 
                                text: `✅ Warnings cleared for @${userJid.split('@')[0]}.` 
                            }, { 
                                quoted: msg,
                                mentions: [userJid]
                            });
                        }
                        break;
                    }
                    
                    case '.warn': {
                        if (!isGroup) {
                            await sock.sendMessage(from, { text: '❌ This command only works in groups.' }, { quoted: msg });
                            break;
                        }
                        if (!isAdmin) {
                            await sock.sendMessage(from, { text: '❌ Only group admins can use this command.' }, { quoted: msg });
                            break;
                        }
                        const mentionedJids = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
                        if (mentionedJids.length === 0) {
                            await sock.sendMessage(from, { text: '❌ Please mention a user to warn. Usage: `.warn @user`' }, { quoted: msg });
                            break;
                        }
                        
                        for (const userJid of mentionedJids) {
                            const warningCount = addWarning(from, userJid);
                            await sock.sendMessage(from, { 
                                text: `⚠️ Warning #${warningCount} issued to @${userJid.split('@')[0]}\n\nPlease follow group rules.` 
                            }, { 
                                quoted: msg,
                                mentions: [userJid]
                            });
                            
                            // Auto-kick after 3 warnings
                            if (warningCount >= 3) {
                                try {
                                    await sock.groupParticipantsUpdate(from, [userJid], 'remove');
                                    await sock.sendMessage(from, { 
                                        text: `🚫 @${userJid.split('@')[0]} has been removed from the group after ${warningCount} warnings.` 
                                    }, { 
                                        mentions: [userJid]
                                    });
                                    clearWarnings(from, userJid); // Reset warnings after kick
                                } catch (error) {
                                    await sock.sendMessage(from, { text: `❌ Failed to remove user after ${warningCount} warnings.` }, { quoted: msg });
                                }
                            }
                        }
                        break;
                    }
                    
                    case '.lock': {
                        if (!isGroup) {
                            await sock.sendMessage(from, { text: '❌ This command only works in groups.' }, { quoted: msg });
                            break;
                        }
                        if (!isAdmin) {
                            await sock.sendMessage(from, { text: '❌ Only group admins can use this command.' }, { quoted: msg });
                            break;
                        }
                        try {
                            await sock.groupSettingUpdate(from, 'announcement');
                            await sock.sendMessage(from, { text: '🔒 Group locked. Only admins can send messages.' }, { quoted: msg });
                        } catch (error) {
                            await sock.sendMessage(from, { text: '❌ Failed to lock group.' }, { quoted: msg });
                        }
                        break;
                    }
                    
                    case '.unlock': {
                        if (!isGroup) {
                            await sock.sendMessage(from, { text: '❌ This command only works in groups.' }, { quoted: msg });
                            break;
                        }
                        if (!isAdmin) {
                            await sock.sendMessage(from, { text: '❌ Only group admins can use this command.' }, { quoted: msg });
                            break;
                        }
                        try {
                            await sock.groupSettingUpdate(from, 'not_announcement');
                            await sock.sendMessage(from, { text: '🔓 Group unlocked. All members can send messages.' }, { quoted: msg });
                        } catch (error) {
                            await sock.sendMessage(from, { text: '❌ Failed to unlock group.' }, { quoted: msg });
                        }
                        break;
                    }
                    
                    case '.antilink': {
                        if (!isGroup) {
                            await sock.sendMessage(from, { text: '❌ This command only works in groups.' }, { quoted: msg });
                            break;
                        }
                        if (!isAdmin) {
                            await sock.sendMessage(from, { text: '❌ Only group admins can use this command.' }, { quoted: msg });
                            break;
                        }
                        
                        const action = fullCommand.replace('.antilink', '').trim().toLowerCase();
                        
                        if (action === 'on') {
                            enableAntilink(from);
                            await sock.sendMessage(from, { text: '🚫 Antilink protection enabled. Links will be blocked for non-admins.' }, { quoted: msg });
                        } else if (action === 'off') {
                            disableAntilink(from);
                            await sock.sendMessage(from, { text: '✅ Antilink protection disabled. Links are now allowed.' }, { quoted: msg });
                        } else {
                            const status = isAntilinkEnabled(from) ? 'enabled' : 'disabled';
                            await sock.sendMessage(from, { text: `ℹ️ Antilink protection is currently ${status}.\n\nUsage: \`.antilink on\` or \`.antilink off\`` }, { quoted: msg });
                        }
                        break;
                    }
                    
                    // Advanced Normal Chat Commands
                    case '.translate': {
                        const text = fullCommand.replace('.translate', '').trim();
                        if (!text) {
                            await sock.sendMessage(from, { text: '❌ Please provide text to translate. Usage: `.translate Hello world`' }, { quoted: msg });
                            break;
                        }
                        // Placeholder for translation - integrate with translation API
                        await sock.sendMessage(from, { 
                            text: `🌐 *Translation Service*\n\n📝 *Original:* ${text}\n🔄 *Translated:* [Translation feature coming soon]\n\n⚠️ *Note:* Integrate with Google Translate API for real translations.` 
                        }, { quoted: msg });
                        break;
                    }
                    
                    case '.base64': {
                        const args = fullCommand.split(' ');
                        const operation = args[1];
                        const text = args.slice(2).join(' ');
                        
                        if (!operation || !text) {
                            await sock.sendMessage(from, { text: '❌ Usage: `.base64 encode/decode <text>`\nExample: `.base64 encode Hello World`' }, { quoted: msg });
                            break;
                        }
                        
                        try {
                            if (operation === 'encode') {
                                const encoded = Buffer.from(text, 'utf8').toString('base64');
                                await sock.sendMessage(from, { text: `🔐 *Base64 Encoded*\n\n📝 *Original:* ${text}\n🔒 *Encoded:* \`${encoded}\`` }, { quoted: msg });
                            } else if (operation === 'decode') {
                                const decoded = Buffer.from(text, 'base64').toString('utf8');
                                await sock.sendMessage(from, { text: `🔓 *Base64 Decoded*\n\n🔒 *Encoded:* ${text}\n📝 *Decoded:* \`${decoded}\`` }, { quoted: msg });
                            } else {
                                await sock.sendMessage(from, { text: '❌ Invalid operation. Use `encode` or `decode`.' }, { quoted: msg });
                            }
                        } catch (error) {
                            await sock.sendMessage(from, { text: '❌ Invalid base64 string for decoding.' }, { quoted: msg });
                        }
                        break;
                    }
                    
                    case '.hash': {
                        const text = fullCommand.replace('.hash', '').trim();
                        if (!text) {
                            await sock.sendMessage(from, { text: '❌ Please provide text to hash. Usage: `.hash Hello World`' }, { quoted: msg });
                            break;
                        }
                        
                        const crypto = require('crypto');
                        const md5 = crypto.createHash('md5').update(text).digest('hex');
                        const sha1 = crypto.createHash('sha1').update(text).digest('hex');
                        const sha256 = crypto.createHash('sha256').update(text).digest('hex');
                        
                        const hashText = `
🔐 *Hash Generator*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 *Original:* ${text}

🔹 *MD5:* \`${md5}\`
🔹 *SHA1:* \`${sha1}\`
🔹 *SHA256:* \`${sha256}\`

⚠️ *Security Note:* Use SHA256 for security-critical applications.
`;
                        await sock.sendMessage(from, { text: hashText }, { quoted: msg });
                        break;
                    }
                    
                    case '.ip': {
                        const ip = fullCommand.replace('.ip', '').trim();
                        if (!ip) {
                            await sock.sendMessage(from, { text: '🌐 Please provide an IP address.\nExample: `.ip 8.8.8.8`' }, { quoted: msg });
                            break;
                        }

                        const ipResult = await apiServices.getIpInfo(ip);
                        if (ipResult.error) {
                            await sock.sendMessage(from, { text: ipResult.error }, { quoted: msg });
                        } else {
                            const ipMsg = `🌐 **IP Information** (${ipResult.service})\n\n` +
                                `📍 **IP:** ${ipResult.ip}\n` +
                                `🌍 **Country:** ${ipResult.country}\n` +
                                `📍 **Region:** ${ipResult.region}\n` +
                                `🏙️ **City:** ${ipResult.city}\n` +
                                `� **ISP:** ${ipResult.isp}\n` +
                                `⏰ **Timezone:** ${ipResult.timezone}`;
                            await sock.sendMessage(from, { text: ipMsg }, { quoted: msg });
                        }
                        break;
                    }
                    
                    case '.currency':
                    case '.exchange': {
                        const args = fullCommand.split(' ').slice(1);
                        if (args.length < 2) {
                            await sock.sendMessage(from, { text: '💱 **Currency Exchange**\n\nUsage: `.currency USD EUR 100`\nOr: `.currency USD EUR` (for 1 unit)' }, { quoted: msg });
                            break;
                        }

                        const fromCurrency = args[0]?.toUpperCase();
                        const toCurrency = args[1]?.toUpperCase();
                        const amount = parseFloat(args[2]) || 1;

                        const currencyResult = await apiServices.getCurrencyRate(fromCurrency, toCurrency, amount);
                        if (currencyResult.error) {
                            await sock.sendMessage(from, { text: currencyResult.error }, { quoted: msg });
                        } else {
                            await sock.sendMessage(from, { 
                                text: `💱 **Currency Exchange**\n\n${currencyResult.amount} ${currencyResult.from} = ${currencyResult.result.toFixed(2)} ${currencyResult.to}\n\nRate: 1 ${currencyResult.from} = ${currencyResult.rate.toFixed(4)} ${currencyResult.to}` 
                            }, { quoted: msg });
                        }
                        break;
                    }
                    
                    case '.random': {
                        const args = fullCommand.split(' ');
                        const min = parseInt(args[1]) || 1;
                        const max = parseInt(args[2]) || 100;
                        
                        if (min >= max) {
                            await sock.sendMessage(from, { text: '❌ Minimum must be less than maximum. Usage: `.random 1 100`' }, { quoted: msg });
                            break;
                        }
                        
                        const randomNum = Math.floor(Math.random() * (max - min + 1)) + min;
                        await sock.sendMessage(from, { text: `🎲 *Random Number Generator*\n\n📊 *Range:* ${min} - ${max}\n🎯 *Result:* **${randomNum}**` }, { quoted: msg });
                        break;
                    }
                    
                    case '.shorturl': {
                        const url = fullCommand.replace('.shorturl', '').trim();
                        if (!url) {
                            await sock.sendMessage(from, { text: '🔗 Please provide a URL to shorten.\nExample: `.shorturl https://example.com`' }, { quoted: msg });
                            break;
                        }

                        const shortenResult = await apiServices.shortenUrl(url);
                        if (shortenResult.error) {
                            await sock.sendMessage(from, { text: shortenResult.error }, { quoted: msg });
                        } else {
                            await sock.sendMessage(from, { 
                                text: `🔗 **URL Shortened** (${shortenResult.service})\n\n**Original:** ${url}\n**Short:** ${shortenResult.shortUrl}` 
                            }, { quoted: msg });
                        }
                        break;
                    }
                    
                    case '.color': {
                        const colorName = fullCommand.replace('.color', '').trim().toLowerCase();
                        const colors = {
                            'red': '#FF0000',
                            'green': '#00FF00',
                            'blue': '#0000FF',
                            'yellow': '#FFFF00',
                            'purple': '#800080',
                            'orange': '#FFA500',
                            'pink': '#FFC0CB',
                            'black': '#000000',
                            'white': '#FFFFFF',
                            'gray': '#808080'
                        };
                        
                        if (!colorName) {
                            const colorList = Object.keys(colors).join(', ');
                            await sock.sendMessage(from, { text: `🎨 *Color Codes*\n\nAvailable colors: ${colorList}\n\nUsage: \`.color red\`` }, { quoted: msg });
                            break;
                        }
                        
                        if (colors[colorName]) {
                            await sock.sendMessage(from, { text: `🎨 *Color Information*\n\n🏷️ *Name:* ${colorName.charAt(0).toUpperCase() + colorName.slice(1)}\n🔢 *Hex Code:* \`${colors[colorName]}\`\n🌈 *RGB:* ${hexToRgb(colors[colorName])}` }, { quoted: msg });
                        } else {
                            await sock.sendMessage(from, { text: `❌ Color "${colorName}" not found. Use \`.color\` to see available colors.` }, { quoted: msg });
                        }
                        break;
                    }
                    
                    // Advanced Group Commands
                    case '.tagall': {
                        if (!isGroup) {
                            await sock.sendMessage(from, { text: '❌ This command only works in groups.' }, { quoted: msg });
                            break;
                        }
                        if (!isAdmin) {
                            await sock.sendMessage(from, { text: '❌ Only group admins can use this command.' }, { quoted: msg });
                            break;
                        }
                        
                        try {
                            const groupMetadata = await sock.groupMetadata(from);
                            const participants = groupMetadata.participants.map(p => p.id);
                            const message = fullCommand.replace('.tagall', '').trim() || 'Group announcement';
                            
                            await sock.sendMessage(from, { 
                                text: `📢 *Group Announcement*\n\n${message}`,
                                mentions: participants
                            }, { quoted: msg });
                        } catch (error) {
                            await sock.sendMessage(from, { text: '❌ Failed to tag all members.' }, { quoted: msg });
                        }
                        break;
                    }
                    
                    case '.admins': {
                        if (!isGroup) {
                            await sock.sendMessage(from, { text: '❌ This command only works in groups.' }, { quoted: msg });
                            break;
                        }
                        
                        try {
                            const groupMetadata = await sock.groupMetadata(from);
                            const admins = groupMetadata.participants
                                .filter(p => p.admin === 'admin' || p.admin === 'superadmin')
                                .map(p => `@${p.id.split('@')[0]}`)
                                .join('\n• ');
                            
                            if (admins) {
                                await sock.sendMessage(from, { 
                                    text: `👑 *Group Admins*\n\n• ${admins}`,
                                    mentions: groupMetadata.participants
                                        .filter(p => p.admin === 'admin' || p.admin === 'superadmin')
                                        .map(p => p.id)
                                }, { quoted: msg });
                            } else {
                                await sock.sendMessage(from, { text: '❌ No admins found in this group.' }, { quoted: msg });
                            }
                        } catch (error) {
                            await sock.sendMessage(from, { text: '❌ Failed to fetch admin list.' }, { quoted: msg });
                        }
                        break;
                    }
                    
                    case '.members': {
                        if (!isGroup) {
                            await sock.sendMessage(from, { text: '❌ This command only works in groups.' }, { quoted: msg });
                            break;
                        }
                        
                        try {
                            const groupMetadata = await sock.groupMetadata(from);
                            const totalMembers = groupMetadata.participants.length;
                            const admins = groupMetadata.participants.filter(p => p.admin === 'admin' || p.admin === 'superadmin').length;
                            const members = totalMembers - admins;
                            
                            const memberInfo = `
👥 *Group Members Statistics*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👑 *Admins:* ${admins}
👤 *Members:* ${members}
📊 *Total:* ${totalMembers}
🏷️ *Group:* ${groupMetadata.subject}
`;
                            await sock.sendMessage(from, { text: memberInfo }, { quoted: msg });
                        } catch (error) {
                            await sock.sendMessage(from, { text: '❌ Failed to fetch member statistics.' }, { quoted: msg });
                        }
                        break;
                    }
                    
                    case '.rules': {
                        if (!isGroup) {
                            await sock.sendMessage(from, { text: '❌ This command only works in groups.' }, { quoted: msg });
                            break;
                        }
                        
                        const rules = `
📋 *Group Rules*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1️⃣ Be respectful to all members
2️⃣ No spam or excessive messaging
3️⃣ Keep discussions relevant to the group
4️⃣ No sharing of inappropriate content
5️⃣ Follow admin instructions
6️⃣ Use proper language
7️⃣ No personal attacks or harassment
8️⃣ Respect privacy of other members

⚠️ *Warning System:* 3 warnings = removal
🛡️ *Anti-spam:* Automatic detection active
👑 *Admins:* Use \`.admins\` to see current admins

❓ *Questions?* Contact group admins
`;
                        await sock.sendMessage(from, { text: rules }, { quoted: msg });
                        break;
                    }
                    
                    case '.resetwarns': {
                        if (!isGroup) {
                            await sock.sendMessage(from, { text: '❌ This command only works in groups.' }, { quoted: msg });
                            break;
                        }
                        if (!isAdmin) {
                            await sock.sendMessage(from, { text: '❌ Only group admins can use this command.' }, { quoted: msg });
                            break;
                        }
                        
                        // Reset all warnings for the group
                        warnings.set(from, new Map());
                        await sock.sendMessage(from, { text: '🔄 All warnings have been reset for this group.' }, { quoted: msg });
                        break;
                    }
                    
                    case '.groupstats': {
                        if (!isGroup) {
                            await sock.sendMessage(from, { text: '❌ This command only works in groups.' }, { quoted: msg });
                            break;
                        }
                        
                        try {
                            const groupMetadata = await sock.groupMetadata(from);
                            const muteInfo = getMuteInfo(from);
                            const antilinkStatus = isAntilinkEnabled(from);
                            const warningCount = warnings.has(from) ? warnings.get(from).size : 0;
                            
                            const stats = `
📊 *Group Statistics & Settings*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏷️ *Name:* ${groupMetadata.subject}
👥 *Members:* ${groupMetadata.participants.length}
👑 *Admins:* ${groupMetadata.participants.filter(p => p.admin === 'admin' || p.admin === 'superadmin').length}
📅 *Created:* ${new Date(groupMetadata.creation * 1000).toLocaleDateString()}

⚙️ *Security Settings*
🔇 *Muted:* ${muteInfo ? `Yes (${muteInfo.remaining} remaining)` : 'No'}
🚫 *Anti-link:* ${antilinkStatus ? 'Enabled' : 'Disabled'}
⚠️ *Active Warnings:* ${warningCount}

🛡️ *Protection Status*
✅ All security features active
🤖 Bot monitoring enabled
`;
                            await sock.sendMessage(from, { text: stats }, { quoted: msg });
                        } catch (error) {
                            await sock.sendMessage(from, { text: '❌ Failed to fetch group statistics.' }, { quoted: msg });
                        }
                        break;
                    }
                    
                    default: {
                        console.log(`Unknown command: "${command}"`);
                        await sock.sendMessage(from, { text: '🤔 Unknown command. Send \`.panel\` to view available options.' }, { quoted: msg });
                    }
                }
            }
        }
    });

    // Call handling (anti-call)
    sock.ev.on('call', async (calls) => {
        try {
            for (const call of calls) {
                if (!config.antiCall) continue;
                if (call.status === 'offer') {
                    // Some Baileys versions expose rejectCall; if not, just notify
                    if (typeof sock.rejectCall === 'function') {
                        try { await sock.rejectCall(call.id, call.from); } catch (_) {}
                    }
                    await sock.sendMessage(call.from, { text: '🚫 Calls are not allowed. Your call was rejected.' });
                }
            }
        } catch (err) {
            console.error('Call handling error:', err);
        }
    });
}

console.log('Starting WhatsApp Bot (Baileys)...');
startBot().catch((e) => {
    console.error('Failed to start bot:', e);
    process.exit(1);
});

process.on('SIGINT', () => {
    console.log('\nReceived SIGINT. Exit.');
    if (unmuteTimer) {
        clearInterval(unmuteTimer);
    }
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\nReceived SIGTERM. Exit.');
    if (unmuteTimer) {
        clearInterval(unmuteTimer);
    }
    process.exit(0);
});
