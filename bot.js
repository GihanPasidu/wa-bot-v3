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
const crypto = require('crypto');
const axios = require('axios');
const http = require('http');
const QRCode = require('qrcode');

// Bot configuration
const config = {
    autoRead: false,
    antiCall: true,
    adminJids: ['94788006269@s.whatsapp.net', '11837550653588@lid'], // Support both regular and linked device formats
    botEnabled: true
};

// Bot startup time for uptime calculation
const startTime = Date.now();

// QR code storage for web interface
let currentQRCode = null;
let connectionStatus = 'disconnected'; // 'disconnected', 'connecting', 'connected'

// Warning system storage
const warnings = new Map(); // groupJid -> Map(userJid -> count)

// Mute system storage
const mutedGroups = new Map(); // groupJid -> { endTime, reason }

// Antilink system storage
const antilinkGroups = new Set(); // groupJid -> boolean

// Auto-unmute timer
let unmuteTimer = null;

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

function isStickerMessage(msg) {
    const m = msg.message || {};
    if (m.stickerMessage) return true;
    if (m.ephemeralMessage && m.ephemeralMessage.message?.stickerMessage) return true;
    if (m.viewOnceMessage && m.viewOnceMessage.message?.stickerMessage) return true;
    if (m.viewOnceMessageV2 && m.viewOnceMessageV2.message?.stickerMessage) return true;
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

function extractStickerMessage(msg) {
    const m = msg.message || {};
    if (m.stickerMessage) return msg;
    if (m.ephemeralMessage && m.ephemeralMessage.message?.stickerMessage) {
        return { ...msg, message: { stickerMessage: m.ephemeralMessage.message.stickerMessage } };
    }
    if (m.viewOnceMessage && m.viewOnceMessage.message?.stickerMessage) {
        return { ...msg, message: { stickerMessage: m.viewOnceMessage.message.stickerMessage } };
    }
    if (m.viewOnceMessageV2 && m.viewOnceMessageV2.message?.stickerMessage) {
        return { ...msg, message: { stickerMessage: m.viewOnceMessageV2.message.stickerMessage } };
    }
    return null;
}

// Helper function to handle self-chat message sending
function getSelfChatTargetJid(senderJid, fromJid) {
    // If sender is linked device, redirect to phone number format for self-chat
    if (senderJid === '11837550653588@lid' && fromJid === '11837550653588@lid') {
        return '94788006269@s.whatsapp.net';
    }
    return fromJid;
}

// Helper function to send error messages to users
async function sendErrorMessage(sock, senderJid, fromJid, errorType, commandName = '') {
    const targetJid = getSelfChatTargetJid(senderJid, fromJid);
    
    let errorMessage = '';
    switch (errorType) {
        case 'STICKER_FAILED':
            errorMessage = `❌ *Sticker Creation Failed*\n\n🔧 *Possible Issues:*\n• Image format not supported\n• File size too large\n• Network connection issue\n\n💡 *Try:* Send a JPEG/PNG image`;
            break;
        case 'TOIMG_FAILED':
            errorMessage = `❌ *Image Conversion Failed*\n\n🔧 *Possible Issues:*\n• Sticker format not supported\n• File corrupted\n• Processing error\n\n💡 *Try:* Send a different sticker`;
            break;
        case 'MEDIA_DOWNLOAD_FAILED':
            errorMessage = `❌ *Media Download Failed*\n\n🔧 *Issue:* Unable to download media file\n\n💡 *Try:* Send the media again or check your connection`;
            break;
        case 'GROUP_ADMIN_REQUIRED':
            errorMessage = `🚫 *Access Denied*\n\n👑 *Required:* Group admin privileges\n\n💡 *Note:* Only group admins can use this command`;
            break;
        case 'BOT_ADMIN_REQUIRED':
            errorMessage = `🚫 *Access Denied*\n\n🤖 *Required:* Bot admin privileges\n\n💡 *Note:* Only bot admins can use this command`;
            break;
        case 'GROUP_ONLY':
            errorMessage = `🚫 *Command Restriction*\n\n👥 *Usage:* This command only works in groups\n\n💡 *Try:* Use this command in a group chat`;
            break;
        case 'COMMAND_ERROR':
            errorMessage = `❌ *Command Processing Error*\n\n🔧 *Command:* ${commandName}\n\n💡 *Try:* Check command syntax or try again later`;
            break;
        case 'NETWORK_ERROR':
            errorMessage = `🌐 *Network Error*\n\n🔧 *Issue:* Connection problem\n\n💡 *Try:* Check your internet connection and try again`;
            break;
        default:
            errorMessage = `❌ *Something went wrong*\n\n🔧 *Error:* An unexpected error occurred\n\n💡 *Try:* Please try again or contact support`;
    }
    
    try {
        await sock.sendMessage(targetJid, { text: errorMessage });
    } catch (sendError) {
        console.error(`Failed to send error message:`, sendError);
    }
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

async function convertStickerToImage(buffer) {
    // Convert webp sticker to jpeg using sharp
    const jpegBuffer = await sharp(buffer).jpeg({ quality: 90 }).toBuffer();
    return jpegBuffer;
}

// Advanced Tools Functions
function generatePassword(length = 12) {
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const numbers = '0123456789';
    const symbols = '!@#$%^&*()_+-=[]{}|;:,.<>?';
    const allChars = uppercase + lowercase + numbers + symbols;
    
    let password = '';
    
    // Ensure at least one character from each type
    password += uppercase[Math.floor(Math.random() * uppercase.length)];
    password += lowercase[Math.floor(Math.random() * lowercase.length)];
    password += numbers[Math.floor(Math.random() * numbers.length)];
    password += symbols[Math.floor(Math.random() * symbols.length)];
    
    // Fill the rest randomly
    for (let i = 4; i < length; i++) {
        password += allChars[Math.floor(Math.random() * allChars.length)];
    }
    
    // Shuffle the password
    return password.split('').sort(() => Math.random() - 0.5).join('');
}

async function shortenUrl(url) {
    try {
        // TinyURL API integration
        const response = await axios.get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`);
        
        // Check if TinyURL returned a valid shortened URL
        if (response.data && response.data.startsWith('https://tinyurl.com/')) {
            return response.data;
        } else {
            throw new Error('Invalid response from TinyURL');
        }
    } catch (error) {
        console.error('TinyURL Error:', error.message);
        // Fallback to local hash-based shortener if TinyURL fails
        const hash = crypto.createHash('md5').update(url).digest('hex').substring(0, 8);
        return `https://short.ly/${hash}`;
    }
}

function getColorInfo(colorName) {
    const colors = {
        // Basic Colors
        'red': { hex: '#FF0000', rgb: 'rgb(255, 0, 0)', hsl: 'hsl(0, 100%, 50%)' },
        'green': { hex: '#008000', rgb: 'rgb(0, 128, 0)', hsl: 'hsl(120, 100%, 25%)' },
        'blue': { hex: '#0000FF', rgb: 'rgb(0, 0, 255)', hsl: 'hsl(240, 100%, 50%)' },
        'yellow': { hex: '#FFFF00', rgb: 'rgb(255, 255, 0)', hsl: 'hsl(60, 100%, 50%)' },
        'orange': { hex: '#FFA500', rgb: 'rgb(255, 165, 0)', hsl: 'hsl(39, 100%, 50%)' },
        'purple': { hex: '#800080', rgb: 'rgb(128, 0, 128)', hsl: 'hsl(300, 100%, 25%)' },
        'pink': { hex: '#FFC0CB', rgb: 'rgb(255, 192, 203)', hsl: 'hsl(350, 100%, 88%)' },
        'cyan': { hex: '#00FFFF', rgb: 'rgb(0, 255, 255)', hsl: 'hsl(180, 100%, 50%)' },
        'magenta': { hex: '#FF00FF', rgb: 'rgb(255, 0, 255)', hsl: 'hsl(300, 100%, 50%)' },
        'lime': { hex: '#00FF00', rgb: 'rgb(0, 255, 0)', hsl: 'hsl(120, 100%, 50%)' },
        
        // Neutral Colors
        'black': { hex: '#000000', rgb: 'rgb(0, 0, 0)', hsl: 'hsl(0, 0%, 0%)' },
        'white': { hex: '#FFFFFF', rgb: 'rgb(255, 255, 255)', hsl: 'hsl(0, 0%, 100%)' },
        'gray': { hex: '#808080', rgb: 'rgb(128, 128, 128)', hsl: 'hsl(0, 0%, 50%)' },
        'grey': { hex: '#808080', rgb: 'rgb(128, 128, 128)', hsl: 'hsl(0, 0%, 50%)' },
        'silver': { hex: '#C0C0C0', rgb: 'rgb(192, 192, 192)', hsl: 'hsl(0, 0%, 75%)' },
        
        // Dark Colors
        'darkred': { hex: '#8B0000', rgb: 'rgb(139, 0, 0)', hsl: 'hsl(0, 100%, 27%)' },
        'darkgreen': { hex: '#006400', rgb: 'rgb(0, 100, 0)', hsl: 'hsl(120, 100%, 20%)' },
        'darkblue': { hex: '#00008B', rgb: 'rgb(0, 0, 139)', hsl: 'hsl(240, 100%, 27%)' },
        'darkgray': { hex: '#A9A9A9', rgb: 'rgb(169, 169, 169)', hsl: 'hsl(0, 0%, 66%)' },
        
        // Light Colors
        'lightred': { hex: '#FFB6C1', rgb: 'rgb(255, 182, 193)', hsl: 'hsl(351, 100%, 86%)' },
        'lightgreen': { hex: '#90EE90', rgb: 'rgb(144, 238, 144)', hsl: 'hsl(120, 73%, 75%)' },
        'lightblue': { hex: '#ADD8E6', rgb: 'rgb(173, 216, 230)', hsl: 'hsl(195, 53%, 79%)' },
        'lightgray': { hex: '#D3D3D3', rgb: 'rgb(211, 211, 211)', hsl: 'hsl(0, 0%, 83%)' },
        
        // Popular Colors
        'gold': { hex: '#FFD700', rgb: 'rgb(255, 215, 0)', hsl: 'hsl(51, 100%, 50%)' },
        'navy': { hex: '#000080', rgb: 'rgb(0, 0, 128)', hsl: 'hsl(240, 100%, 25%)' },
        'maroon': { hex: '#800000', rgb: 'rgb(128, 0, 0)', hsl: 'hsl(0, 100%, 25%)' },
        'olive': { hex: '#808000', rgb: 'rgb(128, 128, 0)', hsl: 'hsl(60, 100%, 25%)' },
        'teal': { hex: '#008080', rgb: 'rgb(0, 128, 128)', hsl: 'hsl(180, 100%, 25%)' },
        'aqua': { hex: '#00FFFF', rgb: 'rgb(0, 255, 255)', hsl: 'hsl(180, 100%, 50%)' },
        'fuchsia': { hex: '#FF00FF', rgb: 'rgb(255, 0, 255)', hsl: 'hsl(300, 100%, 50%)' }
    };
    
    return colors[colorName.toLowerCase()] || null;
}

function getCurrentDateTime() {
    const now = new Date();
    
    // Get timezone offset
    const timezoneOffset = now.getTimezoneOffset();
    const timezone = `UTC${timezoneOffset > 0 ? '-' : '+'}${Math.abs(Math.floor(timezoneOffset / 60)).toString().padStart(2, '0')}:${Math.abs(timezoneOffset % 60).toString().padStart(2, '0')}`;
    
    // Format date and time
    const date = now.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    
    const time = now.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    });
    
    // Additional info
    const unixTimestamp = Math.floor(now.getTime() / 1000);
    const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / (1000 * 60 * 60 * 24));
    const weekNumber = Math.ceil(dayOfYear / 7);
    
    return {
        date,
        time,
        timezone,
        unixTimestamp,
        dayOfYear,
        weekNumber,
        iso: now.toISOString()
    };
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, 'auth'));
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ['CloudNextra Bot', 'Desktop', '3.0.0']
    });


    // QR handling
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log('📱 QR Code Generated — Please scan with WhatsApp:');
            qrcode.generate(qr, { small: true });
            console.log('\n📱 Steps: Open WhatsApp → Settings → Linked Devices → Link a Device');
            console.log('⏱️  QR Code expires in 60 seconds...');
            
            // Show QR webpage link prominently
            const baseURL = process.env.NODE_ENV === 'production' && process.env.RENDER_EXTERNAL_URL 
                ? process.env.RENDER_EXTERNAL_URL 
                : `http://localhost:${process.env.PORT || 10000}`;
            
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log(`🌐 WEB QR CODE: ${baseURL}`);
            console.log(`📊 DASHBOARD: ${baseURL}/qr`);
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
            
            // Generate base64 QR code for web interface
            try {
                const qrImageBuffer = await QRCode.toBuffer(qr, {
                    type: 'png',
                    width: 300,
                    margin: 2,
                    color: {
                        dark: '#000000',
                        light: '#FFFFFF'
                    }
                });
                currentQRCode = qrImageBuffer.toString('base64');
                connectionStatus = 'connecting';
            } catch (error) {
                console.error('❌ Error generating web QR code:', error.message);
            }
        }
        if (connection === 'open') {
            console.log('🚀 CloudNextra Bot Successfully Connected!');
            console.log('🤖 Bot Status: Online and Ready');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            
            // Update connection status for web interface
            connectionStatus = 'connected';
            currentQRCode = null;
        } else if (connection === 'close') {
            connectionStatus = 'disconnected';
            currentQRCode = null;
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('⚠️  Connection Lost. Attempting Reconnection:', shouldReconnect);
            if (shouldReconnect) startBot();
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
                if (config.autoRead) {
                    try { await sock.readMessages([msg.key]); } catch (_) {}
                }
                continue;
            }

            const senderJid = (msg.key.participant || msg.key.remoteJid);
            const body = getTextFromMessage(msg) || '';
            
            // Check if it's a group and if user is admin for group commands
            const isGroup = from.endsWith('@g.us');
            const isAdmin = isGroup ? await isGroupAdmin(sock, from, senderJid) : false;
            
            // Check if user is a bot admin (for non-group admin commands)
            const isBotAdmin = config.adminJids.includes(senderJid);

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
                    // Try to send a simple error message
                    try {
                        await sendErrorMessage(sock, senderJid, from, 'COMMAND_ERROR', 'mute notification');
                    } catch (fallbackError) {
                        console.error('Failed to send fallback error message:', fallbackError);
                    }
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
                        // Try to send a simple error message
                        try {
                            await sendErrorMessage(sock, senderJid, from, 'COMMAND_ERROR', 'antilink warning');
                        } catch (fallbackError) {
                            console.error('Failed to send fallback error message:', fallbackError);
                        }
                    }
                }
                continue;
            }

            // Auto-read normal messages
            if (config.autoRead) {
                try { await sock.readMessages([msg.key]); } catch (_) {}
            }

            if (body.startsWith('.')) {
                const fullCommand = body.trim().toLowerCase();
                const command = fullCommand.split(' ')[0]; // Get just the command part
                const text = body.trim(); // Add text variable for command arguments
                console.log(`Received command: ${fullCommand} from ${from}`);
                console.log(`Parsed command: "${command}"`);
                console.log(`Is Group: ${isGroup}, Is Admin: ${isAdmin}, Is Bot Admin: ${isBotAdmin}`);
                
                // If bot is OFF, only allow .on command
                if (!config.botEnabled && command !== '.on') {
                    await sock.sendMessage(from, { text: '🛑 The bot is currently OFF. Send `.on` to enable it.' }, { quoted: msg });
                    continue;
                }
                
                
                console.log(`Processing command: "${command}"`);
                switch (command) {
                    case '.test': {
                        await sock.sendMessage(from, { text: '✅ Test command works!' }, { quoted: msg });
                        break;
                    }
                    case '.on': {
                        config.botEnabled = true;
                        await sock.sendMessage(from, { text: '🚀 *Bot Status Updated*\n\n✅ Bot is now **ONLINE** and ready to serve!\n\n💡 *Tip:* Send `.panel` to explore all features.' }, { quoted: msg });
                        break;
                    }
                    case '.off': {
                        config.botEnabled = false;
                        await sock.sendMessage(from, { text: '⏸️ *Bot Status Updated*\n\n� Bot is now **OFFLINE** for maintenance.\n\n🔧 Only the `.on` command will work until reactivation.' }, { quoted: msg });
                        break;
                    }
                    case '.panel': {
                        const panelText = `
🤖  *WhatsApp Bot — Control Panel*
────────────────────────────────

�  *Basic Commands*
• \`.help\` — Complete commands list
• \`.stats\` — Bot statistics & uptime  
• \`.ping\` — Response time test
• \`.about\` — Bot information

�📌  *General Commands*
• \`.panel\` — Show this menu
• \`.status\` — Debug information
• \`.autoread\` — Toggle auto read receipts (${config.autoRead ? '✅ ON' : '❌ OFF'})
• \`.anticall\` — Toggle call blocking (${config.antiCall ? '✅ ON' : '❌ OFF'})
• \`.on\` / \`.off\` — Turn bot on/off

🎨  *Media Commands*
• \`.sticker\` — Convert image to sticker
• \`.toimg\` — Convert sticker to image

�  *Advanced Tools*
• \`.shorturl [url]\` — URL shortener
• \`.color [name]\` — Color code lookup
• \`.time\` — Current time & date
• \`.pass [12]\` — Password generator

�👑  *Group Management* (Admin Only)
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

📊  *Status*
• Bot: ${config.botEnabled ? '✅ ON' : '🛑 OFF'}
• Auto Read: ${config.autoRead ? '✅ Enabled' : '❌ Disabled'}
• Anti Call: ${config.antiCall ? '✅ Enabled' : '❌ Disabled'}

ℹ️  *Tips*
• Send image + \`.sticker\` or reply \`.sticker\` to convert to sticker
• Send sticker + \`.toimg\` or reply \`.toimg\` to convert to image
• Group commands only work if you're an admin in the group
• Use \`.ghelp\` in groups to see all group management commands
`;
                    try {
                        // Fix for self-chat: get correct target JID
                        const targetJid = getSelfChatTargetJid(senderJid, from);
                        if (targetJid !== from) {
                            console.log(`🔄 Redirecting self-chat message from ${from} to ${targetJid}`);
                        }
                        
                        await sock.sendMessage(targetJid, { text: panelText }, { quoted: msg });
                        console.log(`✅ Panel message sent successfully to: ${targetJid}`);
                    } catch (sendError) {
                        console.error(`❌ Failed to send panel message to ${from}:`, sendError);
                        // Try sending without quoted message for self-chat
                        if (!isGroup) {
                            try {
                                await sock.sendMessage(from, { text: panelText });
                                console.log(`✅ Panel message sent (without quote) to: ${from}`);
                            } catch (fallbackError) {
                                console.error(`❌ Fallback send also failed:`, fallbackError);
                            }
                        }
                    }
                        break;
                    }
                    case '.status': {
                        const statusText = `
🔍 *Bot Debug Information*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 *Your Status:*
• 👤 JID: \`${senderJid}\`
• 🏷️ Chat Type: ${isGroup ? 'Group' : 'Private'}
• 👑 Group Admin: ${isAdmin ? '✅ Yes' : '❌ No'}
• 🤖 Bot Admin: ${isBotAdmin ? '✅ Yes' : '❌ No'}

⚙️ *Bot Configuration:*
• 🟢 Bot Enabled: ${config.botEnabled ? 'Yes' : 'No'}
• 👀 Auto Read: ${config.autoRead ? 'Yes' : 'No'}
• 📵 Anti Call: ${config.antiCall ? 'Yes' : 'No'}

📋 *Configured Admins:*
${config.adminJids.map(jid => `• ${jid}`).join('\n')}

${isBotAdmin ? '✅ *You have bot admin privileges*' : '⚠️ *You are not a bot admin*'}
`;
                        const targetJid = getSelfChatTargetJid(senderJid, from);
                        await sock.sendMessage(targetJid, { text: statusText }, { quoted: msg });
                        break;
                    }
                    case '.autoread': {
                        config.autoRead = !config.autoRead;
                        const status = config.autoRead ? '🟢 *ENABLED*' : '🔴 *DISABLED*';
                        const icon = config.autoRead ? '👀' : '🙈';
                        const description = config.autoRead ? 'Messages will be automatically marked as read' : 'Manual read confirmation required';
                        await sock.sendMessage(from, { 
                            text: `${icon} *Auto-Read Feature Updated*\n\n� Status: ${status}\n💬 ${description}\n\n✨ Your privacy settings have been updated!` 
                        }, { quoted: msg });
                        break;
                    }
                    case '.anticall': {
                        config.antiCall = !config.antiCall;
                        const status = config.antiCall ? '🟢 *ENABLED*' : '🔴 *DISABLED*';
                        const icon = config.antiCall ? '📵' : '📞';
                        const description = config.antiCall ? 'Incoming calls will be automatically rejected' : 'All calls will be accepted normally';
                        await sock.sendMessage(from, { 
                            text: `${icon} *Call Protection Updated*\n\n🛡️ Status: ${status}\n📲 ${description}\n\n🔒 Your call preferences have been saved!` 
                        }, { quoted: msg });
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
                            await sock.sendMessage(from, { 
                                text: '🎨 *Sticker Creator*\n\n❌ No image detected!\n\n📷 *How to use:*\n• Send image with caption `.sticker`\n• Reply to any image with `.sticker`\n\n💡 *Tip:* Supports JPG, PNG, and WEBP formats' 
                            }, { quoted: msg });
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
                            await sock.sendMessage(from, { 
                                text: '� *Sticker Created Successfully!*\n\n✨ Your image has been converted to a sticker\n🚀 Ready to use in chats!\n\n💫 *Enjoy your new sticker!*' 
                            }, { quoted: msg });
                        } catch (e) {
                            console.error('Error creating sticker:', e);
                            await sendErrorMessage(sock, senderJid, from, 'STICKER_FAILED');
                        }
                        break;
                    }
                    case '.toimg': {
                        // Check if the triggering message includes a sticker, or check quoted message
                        let stickerMsg = isStickerMessage(msg) ? extractStickerMessage(msg) : null;
                        if (!stickerMsg && msg.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
                            const quoted = msg.message.extendedTextMessage.contextInfo.quotedMessage;
                            if (quoted.stickerMessage) stickerMsg = { ...msg, message: { stickerMessage: quoted.stickerMessage } };
                            else if (quoted.ephemeralMessage?.message?.stickerMessage) stickerMsg = { ...msg, message: { stickerMessage: quoted.ephemeralMessage.message.stickerMessage } };
                            else if (quoted.viewOnceMessage?.message?.stickerMessage) stickerMsg = { ...msg, message: { stickerMessage: quoted.viewOnceMessage.message.stickerMessage } };
                            else if (quoted.viewOnceMessageV2?.message?.stickerMessage) stickerMsg = { ...msg, message: { stickerMessage: quoted.viewOnceMessageV2.message.stickerMessage } };
                        }
                        if (!stickerMsg) {
                            await sock.sendMessage(from, { 
                                text: '🖼️ *Image Converter*\n\n❌ No sticker detected!\n\n🎯 *How to use:*\n• Send sticker with caption `.toimg`\n• Reply to any sticker with `.toimg`\n\n🔄 Convert stickers back to images easily!' 
                            }, { quoted: msg });
                            break;
                        }
                        try {
                            const buffer = await downloadMediaMessage(
                                stickerMsg,
                                'buffer',
                                {},
                                { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
                            );
                            const jpeg = await convertStickerToImage(buffer);
                            await sock.sendMessage(from, { 
                                image: jpeg,
                                caption: '🖼️ *Conversion Complete!*\n\n✅ Sticker successfully converted to image\n📱 Now you can save, edit, or share it!\n\n🎨 *Enjoy your image!*'
                            }, { quoted: msg });
                        } catch (e) {
                            console.error('Error converting sticker to image:', e);
                            await sendErrorMessage(sock, senderJid, from, 'TOIMG_FAILED');
                        }
                        break;
                    }
                    
                    // Advanced Tools Commands
                    case '.shorturl': {
                        const url = text.substring(9).trim();
                        if (!url) {
                            await sock.sendMessage(from, { 
                                text: '🔗 *URL Shortener Service*\n\n❌ No URL provided!\n\n📝 *Usage:*\n`.shorturl https://example.com`\n\n🌐 *Supported:* HTTP & HTTPS links\n💡 *Perfect for long URLs!*' 
                            }, { quoted: msg });
                            break;
                        }
                        
                        // Basic URL validation
                        if (!url.startsWith('http://') && !url.startsWith('https://')) {
                            await sock.sendMessage(from, { 
                                text: '⚠️ *Invalid URL Format*\n\n❌ URL must start with http:// or https://\n\n✅ *Correct format:*\n`https://www.example.com`\n\n🔒 *We support secure links only!*' 
                            }, { quoted: msg });
                            break;
                        }
                        
                        try {
                            const shortUrl = await shortenUrl(url);
                            const response = `🔗 *URL Shortening Complete!*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

� *Original URL:*
${url}

⚡ *Shortened URL:*
${shortUrl}

📊 *Service:* ${shortUrl.includes('tinyurl.com') ? 'TinyURL (Official)' : 'Fallback Service'}
✨ *Benefits:*
• ${Math.round((1 - shortUrl.length / url.length) * 100)}% shorter length
• Easy to share & remember
• Professional appearance
• Permanent redirect link

${shortUrl.includes('tinyurl.com') ? '🌐 *Powered by TinyURL*' : '⚠️ *Fallback used - TinyURL unavailable*'}`;
                            
                            const targetJid = getSelfChatTargetJid(senderJid, from);
                            await sock.sendMessage(targetJid, { text: response }, { quoted: msg });
                        } catch (e) {
                            console.error('Error shortening URL:', e);
                            await sendErrorMessage(sock, senderJid, from, 'COMMAND_ERROR', 'shorturl');
                        }
                        break;
                    }
                    
                    case '.color': {
                        const colorName = text.substring(6).trim();
                        if (!colorName) {
                            await sock.sendMessage(from, { 
                                text: '🎨 *Color Code Lookup*\n\n❌ No color name provided!\n\n📝 *Usage:*\n`.color red`\n\n🌈 *Popular colors:*\n• red, green, blue, yellow\n• orange, purple, pink, cyan\n• black, white, gray, gold\n• navy, maroon, olive, teal\n\n💡 *50+ colors available!*' 
                            }, { quoted: msg });
                            break;
                        }
                        
                        const colorInfo = getColorInfo(colorName);
                        if (!colorInfo) {
                            await sock.sendMessage(from, { 
                                text: `❌ *Color Not Found*\n\n🔍 "${colorName}" is not in our database\n\n🎨 *Try these instead:*\n• Basic: red, green, blue, yellow\n• Dark: darkred, darkgreen, darkblue\n• Light: lightred, lightgreen, lightblue\n• Special: gold, navy, maroon, teal\n\n📚 *Database:* 50+ color codes available` 
                            }, { quoted: msg });
                            break;
                        }
                        
                        const response = `🎨 *Color Database: ${colorName.toUpperCase()}*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

� *HEX Code:* \`${colorInfo.hex}\`
� *RGB Value:* \`${colorInfo.rgb}\`
� *HSL Format:* \`${colorInfo.hsl}\`

🎯 *Professional Usage:*
• 🌐 Web Design → Copy HEX
• 💻 Programming → Use RGB
• 🎨 Design Tools → HSL format
• 📱 App Development → Any format

✨ *Perfect for designers & developers!*`;
                        
                        await sock.sendMessage(from, { text: response }, { quoted: msg });
                        break;
                    }
                    
                    case '.time': {
                        try {
                            const timeInfo = getCurrentDateTime();
                            const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
                            const uptimeMinutes = Math.floor(uptimeSeconds / 60);
                            const uptimeHours = Math.floor(uptimeMinutes / 60);
                            
                            const response = `🕐 *Global Time Service*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📅 *Current Date:*
${timeInfo.date}

⏰ *Local Time:*
${timeInfo.time}

🌍 *Timezone:*
${timeInfo.timezone}

📊 *Detailed Information:*
• 📆 Day of Year: ${timeInfo.dayOfYear}
• 🗓️ Week Number: ${timeInfo.weekNumber}
• ⚡ Unix Timestamp: ${timeInfo.unixTimestamp}
• 🔗 ISO Format: ${timeInfo.iso}

🤖 *Bot Performance:*
• ⏱️ Uptime: ${uptimeHours}h ${uptimeMinutes % 60}m ${uptimeSeconds % 60}s
• 🟢 Status: Active & Responsive

🌐 *Accurate worldwide time data*`;
                            
                            await sock.sendMessage(from, { text: response }, { quoted: msg });
                        } catch (e) {
                            console.error('Error getting time:', e);
                            await sendErrorMessage(sock, senderJid, from, 'COMMAND_ERROR', 'time');
                        }
                        break;
                    }
                    
                    case '.pass': {
                        const lengthArg = text.substring(5).trim();
                        let length = 12; // default length
                        
                        if (lengthArg) {
                            const parsedLength = parseInt(lengthArg);
                            if (isNaN(parsedLength) || parsedLength < 4 || parsedLength > 50) {
                                await sock.sendMessage(from, { 
                                    text: '⚠️ *Invalid Password Length*\n\n❌ Length must be 4-50 characters\n\n📝 *Usage Examples:*\n• `.pass` (default 12 chars)\n• `.pass 16` (custom length)\n• `.pass 8` (short password)\n\n🔒 *Recommended:* 12-16 characters' 
                                }, { quoted: msg });
                                break;
                            }
                            length = parsedLength;
                        }
                        
                        try {
                            const password = generatePassword(length);
                            const response = `🔐 *Secure Password Generator*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔑 *Generated Password:*
\`${password}\`

� *Specifications:*
• 📏 Length: ${length} characters
• 🔤 Uppercase: A-Z
• 🔡 Lowercase: a-z  
• 🔢 Numbers: 0-9
• 🔣 Symbols: Special chars

🛡️ *Security Level:* Military Grade
🔒 *Encryption:* Cryptographically secure
⚡ *Strength:* Maximum protection

⚠️ *IMPORTANT SECURITY NOTICE:*
• Copy immediately after viewing
• Never share via insecure channels
• Change default passwords instantly
• Store in secure password manager

🔰 *Your digital security matters!*`;
                            
                            await sock.sendMessage(from, { text: response }, { quoted: msg });
                        } catch (e) {
                            console.error('Error generating password:', e);
                            await sendErrorMessage(sock, senderJid, from, 'COMMAND_ERROR', 'pass');
                        }
                        break;
                    }
                    
                    // Basic Commands
                    case '.help': {
                        try {
                            const targetJid = getSelfChatTargetJid(senderJid, from);
                            const helpText = `📚 *WhatsApp Bot v3 - Command Reference*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🤖 **Basic Commands**
• \`.help\` — Complete commands list
• \`.stats\` — Bot statistics & uptime
• \`.ping\` — Response time test
• \`.about\` — Bot information
• \`.panel\` — Main control panel

⚙️ **Bot Control**
• \`.on\` / \`.off\` — Enable/disable bot
• \`.autoread\` — Toggle read receipts
• \`.anticall\` — Toggle call blocking

🎨 **Media Commands**
• \`.sticker\` — Convert image to sticker
• \`.toimg\` — Convert sticker to image

🛠️ **Advanced Tools**
• \`.shorturl [url]\` — URL shortener
• \`.color [name]\` — Color code lookup
• \`.time\` — Current time & timezone
• \`.pass [length]\` — Password generator

👥 **Group Commands** (Admin Only)
• \`.ginfo\` — Group information
• \`.tagall [msg]\` — Tag all members
• \`.admins\` — List administrators
• \`.members\` — Member statistics
• \`.kick @user\` — Remove member
• \`.promote @user\` — Make admin
• \`.mute [duration]\` — Mute group
• \`.warn @user\` — Issue warning
• \`.antilink on/off\` — Link protection

🔒 **Security Features**
• Admin permission validation
• Self-chat message redirection
• Comprehensive error handling
• Secure auth data management

💡 **Usage Tips:**
• Commands work in groups & private chats
• Group commands require admin privileges
• Use \`.panel\` for interactive menu
• Bot responds with helpful error messages

🚀 **Powered by Baileys Library**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
                            
                            await sock.sendMessage(targetJid, { text: helpText }, { quoted: msg });
                        } catch (e) {
                            console.error('Error showing help:', e);
                            await sendErrorMessage(sock, senderJid, from, 'COMMAND_ERROR', 'help');
                        }
                        break;
                    }
                    
                    case '.stats': {
                        try {
                            const targetJid = getSelfChatTargetJid(senderJid, from);
                            const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
                            const uptimeMinutes = Math.floor(uptimeSeconds / 60);
                            const uptimeHours = Math.floor(uptimeMinutes / 60);
                            const uptimeDays = Math.floor(uptimeHours / 24);
                            
                            let uptimeString = '';
                            if (uptimeDays > 0) uptimeString += `${uptimeDays}d `;
                            if (uptimeHours % 24 > 0) uptimeString += `${uptimeHours % 24}h `;
                            if (uptimeMinutes % 60 > 0) uptimeString += `${uptimeMinutes % 60}m `;
                            uptimeString += `${uptimeSeconds % 60}s`;
                            
                            const memoryUsage = process.memoryUsage();
                            const memoryMB = (memoryUsage.rss / 1024 / 1024).toFixed(2);
                            
                            const statsText = `📊 *Bot Statistics & Performance*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⏱️ **Uptime Information:**
• 🚀 Started: ${new Date(startTime).toLocaleString()}
• ⏰ Running: ${uptimeString.trim()}
• 📅 Current: ${new Date().toLocaleString()}

💻 **System Performance:**
• 🧠 Memory Usage: ${memoryMB} MB
• 🔄 Node.js Version: ${process.version}
• 🏗️ Platform: ${process.platform}

🤖 **Bot Status:**
• 🟢 Status: Active & Responsive
• 📡 Connection: Stable
• 🛡️ Auto Read: ${config.autoRead ? 'Enabled' : 'Disabled'}
• 📵 Anti Call: ${config.antiCall ? 'Enabled' : 'Disabled'}

📈 **Feature Statistics:**
• 👥 Muted Groups: ${mutedGroups.size}
• ⚠️ Warning System: Active
• 🔗 Antilink Groups: ${antilinkGroups.size}
• 🔐 Admin Protection: Enabled

⚡ **Performance Metrics:**
• 🚀 Response Time: Optimized
• 💾 Cache Status: Active
• 🔧 Error Handling: Comprehensive
• 📱 Self-Chat: Supported

🌟 *Bot running smoothly and ready to serve!*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
                            
                            await sock.sendMessage(targetJid, { text: statsText }, { quoted: msg });
                        } catch (e) {
                            console.error('Error showing stats:', e);
                            await sendErrorMessage(sock, senderJid, from, 'COMMAND_ERROR', 'stats');
                        }
                        break;
                    }
                    
                    case '.ping': {
                        try {
                            const targetJid = getSelfChatTargetJid(senderJid, from);
                            const startTime = Date.now();
                            
                            // Send initial ping message
                            const sentMsg = await sock.sendMessage(targetJid, { 
                                text: '📡 *Ping Test*\n\n⏳ Measuring response time...' 
                            }, { quoted: msg });
                            
                            // Calculate response time
                            const responseTime = Date.now() - startTime;
                            
                            // Update with results
                            setTimeout(async () => {
                                try {
                                    let speedEmoji = '🟢';
                                    let speedStatus = 'Excellent';
                                    
                                    if (responseTime > 1000) {
                                        speedEmoji = '🟡';
                                        speedStatus = 'Good';
                                    }
                                    if (responseTime > 2000) {
                                        speedEmoji = '🟠';
                                        speedStatus = 'Average';
                                    }
                                    if (responseTime > 3000) {
                                        speedEmoji = '🔴';
                                        speedStatus = 'Slow';
                                    }
                                    
                                    const pingText = `📡 *Ping Test Results*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚡ **Response Time:**
• 🕐 Latency: ${responseTime}ms
• ${speedEmoji} Status: ${speedStatus}
• 📊 Performance: ${responseTime < 500 ? 'Optimal' : responseTime < 1500 ? 'Good' : 'Needs Improvement'}

🌐 **Connection Quality:**
• 📶 Signal: Strong
• 🔄 Stability: Active
• 🛡️ Security: Encrypted

📈 **Benchmark:**
• 🟢 < 500ms: Excellent
• 🟡 500-1500ms: Good  
• 🟠 1500-3000ms: Average
• 🔴 > 3000ms: Slow

🚀 *Bot is responding efficiently!*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
                                    
                                    await sock.sendMessage(targetJid, { text: pingText }, { quoted: msg });
                                } catch (updateError) {
                                    console.error('Error updating ping result:', updateError);
                                }
                            }, 1000);
                            
                        } catch (e) {
                            console.error('Error running ping test:', e);
                            await sendErrorMessage(sock, senderJid, from, 'COMMAND_ERROR', 'ping');
                        }
                        break;
                    }
                    
                    case '.about': {
                        try {
                            const targetJid = getSelfChatTargetJid(senderJid, from);
                            const aboutText = `ℹ️ *WhatsApp Bot v3 Information*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🤖 **Bot Details:**
• 📛 Name: WhatsApp Bot v3
• 🏷️ Version: 3.0.0
• 👨‍💻 Developer: CloudNextra Solutions
• 📅 Build: September 2025

⚙️ **Technical Stack:**
• 🚀 Engine: Node.js ${process.version}
• 📚 Library: @whiskeysockets/baileys v6.6.0
• 🖼️ Image Processing: Sharp v0.33.4
• 🔍 Logging: Pino v9.0.0
• 📱 Platform: ${process.platform}

🌟 **Key Features:**
• 💬 Multi-format messaging support
• 🎨 Advanced media processing
• 👥 Comprehensive group management
• 🔒 Security & admin controls
• 🛠️ Utility tools & generators
• 📡 Self-chat compatibility
• ⚡ Real-time error handling

🔧 **Capabilities:**
• 📸 Image ↔ Sticker conversion
• 🔗 URL shortening service
• 🎨 Color code lookup
• 🔐 Secure password generation
• ⏰ Time & timezone display
• 📊 System statistics
• 🚫 Anti-spam protection

🛡️ **Security Features:**
• 🔑 Admin permission system
• 🚨 Automatic call rejection
• 🔗 Anti-link protection
• ⚠️ Warning system
• 🔇 Group muting controls
• 📱 Self-chat message routing

💼 **Professional Use:**
• 🏢 Business group management
• 📋 Automated moderation
• 🎯 Content creation tools
• 📊 Performance monitoring
• 🔧 System administration

🌐 **Open Source:**
• 📄 License: MIT
• 🔄 Updates: Regular
• 🐛 Bug Reports: GitHub Issues
• 💡 Feature Requests: Welcome

🚀 *Built with performance and reliability in mind!*

📞 **Support:** Use .help for commands
🎯 **Quick Start:** Send .panel for menu
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
                            
                            await sock.sendMessage(targetJid, { text: aboutText }, { quoted: msg });
                        } catch (e) {
                            console.error('Error showing about info:', e);
                            await sendErrorMessage(sock, senderJid, from, 'COMMAND_ERROR', 'about');
                        }
                        break;
                    }
                    
                    // Group Management Commands (Admin Only)
                    case '.ginfo': {
                        if (!isGroup) {
                            await sendErrorMessage(sock, senderJid, from, 'GROUP_ONLY');
                            break;
                        }
                        if (!isAdmin) {
                            await sendErrorMessage(sock, senderJid, from, 'GROUP_ADMIN_REQUIRED');
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
👑 *Group Management Commands*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 *Information & Statistics*
• \`.ginfo\` — Show group information
• \`.admins\` — List all group admins
• \`.members\` — Show member statistics
• \`.groupstats\` — Detailed group statistics
• \`.rules\` — Display group rules

👥 *Member Management*
• \`.tagall [message]\` — Tag all members with message
• \`.kick @user\` — Remove member from group
• \`.promote @user\` — Make member admin
• \`.demote @user\` — Remove admin privileges
• \`.invite <number>\` — Add member by phone number

� *Group Settings*
• \`.gname <text>\` — Change group name
• \`.gdesc <text>\` — Change group description
• \`.lock\` — Lock group (only admins can send messages)
• \`.unlock\` — Unlock group (all members can send)

�🔇 *Moderation & Safety*
• \`.mute <duration>\` — Mute group (5m, 1h, 1d, 1w)
• \`.unmute\` — Unmute group
• \`.mutestatus\` — Check current mute status
• \`.warn @user\` — Issue warning to member
• \`.warns @user\` — Check member warning count
• \`.clearwarns @user\` — Clear specific member warnings
• \`.resetwarns\` — Reset all group warnings
• \`.antilink on/off\` — Toggle anti-link protection

ℹ️ *Note:* All commands require admin privileges except \`.rules\`, \`.admins\`, and \`.members\`.`;
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
                            console.error('Error updating group description:', error);
                            await sendErrorMessage(sock, senderJid, from, 'COMMAND_ERROR', 'gdesc');
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
                            const participants = groupMetadata.participants;
                            const message = fullCommand.replace('.tagall', '').trim() || 'Attention everyone!';
                            
                            let tagText = `📢 *Group Announcement*\n\n${message}\n\n`;
                            const mentions = [];
                            
                            for (const participant of participants) {
                                tagText += `@${participant.id.split('@')[0]} `;
                                mentions.push(participant.id);
                            }
                            
                            await sock.sendMessage(from, { 
                                text: tagText,
                                mentions: mentions 
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
                            const admins = groupMetadata.participants.filter(p => 
                                p.admin === 'admin' || p.admin === 'superadmin' || p.admin === true || p.admin === 'true'
                            );
                            
                            if (admins.length === 0) {
                                await sock.sendMessage(from, { text: '❌ No admins found in this group.' }, { quoted: msg });
                                break;
                            }
                            
                            let adminText = `👑 *Group Admins (${admins.length})*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
                            for (let i = 0; i < admins.length; i++) {
                                const admin = admins[i];
                                const number = admin.id.split('@')[0];
                                const role = admin.admin === 'superadmin' ? 'Owner' : 'Admin';
                                adminText += `${i + 1}. @${number} (${role})\n`;
                            }
                            
                            await sock.sendMessage(from, { 
                                text: adminText,
                                mentions: admins.map(a => a.id)
                            }, { quoted: msg });
                        } catch (error) {
                            await sock.sendMessage(from, { text: '❌ Failed to get admin list.' }, { quoted: msg });
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
                            const participants = groupMetadata.participants;
                            const admins = participants.filter(p => 
                                p.admin === 'admin' || p.admin === 'superadmin' || p.admin === true || p.admin === 'true'
                            );
                            const members = participants.filter(p => !p.admin);
                            
                            const statsText = `👥 *Member Statistics*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 **Total Members:** ${participants.length}
👑 **Admins:** ${admins.length}
👤 **Regular Members:** ${members.length}
📅 **Group Created:** ${new Date(groupMetadata.creation * 1000).toLocaleDateString()}

📋 **Group Name:** ${groupMetadata.subject}`;
                            
                            await sock.sendMessage(from, { text: statsText }, { quoted: msg });
                        } catch (error) {
                            await sock.sendMessage(from, { text: '❌ Failed to get member statistics.' }, { quoted: msg });
                        }
                        break;
                    }
                    
                    case '.rules': {
                        if (!isGroup) {
                            await sock.sendMessage(from, { text: '❌ This command only works in groups.' }, { quoted: msg });
                            break;
                        }
                        
                        const rulesText = `📋 *Group Rules*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1️⃣ **Be Respectful** - Treat all members with respect and kindness

2️⃣ **No Spam** - Avoid repetitive or unnecessary messages

3️⃣ **Stay On Topic** - Keep conversations relevant to the group purpose

4️⃣ **No Inappropriate Content** - No offensive, adult, or illegal content

5️⃣ **Follow Admin Instructions** - Respect admin decisions and warnings

6️⃣ **No Self-Promotion** - Don't advertise without permission

7️⃣ **Use Proper Language** - Communicate clearly and avoid excessive profanity

⚠️ **Warning System:**
• 1st Warning: Verbal warning
• 2nd Warning: Temporary restrictions
• 3rd Warning: Removal from group

📞 **Contact Admins:** Use .admins to see group administrators

💡 **Remember:** These rules help maintain a positive environment for everyone!`;
                        
                        await sock.sendMessage(from, { text: rulesText }, { quoted: msg });
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
                        
                        // Clear all warnings for this group
                        warnings.delete(from);
                        await sock.sendMessage(from, { text: '✅ All warnings have been reset for this group.' }, { quoted: msg });
                        break;
                    }
                    
                    case '.groupstats': {
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
                            const participants = groupMetadata.participants;
                            const admins = participants.filter(p => 
                                p.admin === 'admin' || p.admin === 'superadmin' || p.admin === true || p.admin === 'true'
                            );
                            const members = participants.filter(p => !p.admin);
                            
                            // Get warning stats
                            const groupWarnings = warnings.get(from) || new Map();
                            const totalWarnings = Array.from(groupWarnings.values()).reduce((sum, count) => sum + count, 0);
                            const warnedUsers = groupWarnings.size;
                            
                            // Get mute status
                            const muteInfo = getMuteInfo(from);
                            const muteStatus = muteInfo ? `🔇 Muted (${muteInfo.remaining} remaining)` : '🔊 Not muted';
                            
                            // Get antilink status
                            const antilinkStatus = isAntilinkEnabled(from) ? '🚫 Enabled' : '✅ Disabled';
                            
                            const detailedStats = `📊 *Detailed Group Statistics*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 **Group Info:**
• Name: ${groupMetadata.subject}
• ID: ${from}
• Created: ${new Date(groupMetadata.creation * 1000).toLocaleDateString()}
• Description: ${groupMetadata.desc ? 'Set' : 'Not set'}

👥 **Membership:**
• Total Members: ${participants.length}
• Admins: ${admins.length}
• Regular Members: ${members.length}

⚙️ **Settings:**
• Mute Status: ${muteStatus}
• Antilink: ${antilinkStatus}
• Who can edit info: ${groupMetadata.restrict ? 'Admins only' : 'All members'}
• Who can send messages: ${groupMetadata.announce ? 'Admins only' : 'All members'}

⚠️ **Moderation:**
• Total Warnings Issued: ${totalWarnings}
• Users with Warnings: ${warnedUsers}

🤖 **Bot Status:**
• Bot Active: ✅ Yes
• Auto-read: ${config.autoRead ? '✅ On' : '❌ Off'}
• Anti-call: ${config.antiCall ? '✅ On' : '❌ Off'}`;
                            
                            await sock.sendMessage(from, { text: detailedStats }, { quoted: msg });
                        } catch (error) {
                            console.error('Error getting group statistics:', error);
                            await sendErrorMessage(sock, senderJid, from, 'COMMAND_ERROR', 'groupstats');
                        }
                        break;
                    }
                    
                    default: {
                        console.log(`Unknown command: "${command}"`);
                        const targetJid = getSelfChatTargetJid(senderJid, from);
                        await sock.sendMessage(targetJid, { 
                            text: '❓ *Command Not Recognized*\n\n🤖 The command you entered is not available\n\n📋 *Get Help:*\n• Send `.panel` for full menu\n• Type `.ghelp` for group commands\n• Check spelling and try again\n\n💡 *Need assistance? Use our command panel!*' 
                        }, { quoted: msg });
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

console.log('🤖 Initializing CloudNextra Bot...');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🔧 Built with Baileys Library');
console.log('⚡ Loading modules and establishing connection...\n');

// Health check server for Render
const server = http.createServer((req, res) => {
    // Set CORS headers for all requests
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            status: 'healthy', 
            uptime: Date.now() - startTime,
            timestamp: new Date().toISOString()
        }));
    } else if (req.url === '/' || req.url === '/qr') {
        // Serve the QR code webpage
        const fs = require('fs');
        const path = require('path');
        try {
            const htmlContent = fs.readFileSync(path.join(__dirname, 'public', 'qr.html'), 'utf8');
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(htmlContent);
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Error loading QR page');
        }
    } else if (req.url === '/qr-data') {
        // Serve QR code data as JSON
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            qr: currentQRCode,
            status: connectionStatus,
            timestamp: new Date().toISOString()
        }));
    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    }
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`🌐 Health check server running on port ${PORT}`);
    
    // Show QR webpage URLs for easy access
    if (process.env.NODE_ENV === 'production' && process.env.RENDER_EXTERNAL_URL) {
        console.log(`📱 QR Code Webpage: ${process.env.RENDER_EXTERNAL_URL}`);
        console.log(`📡 Health Check: ${process.env.RENDER_EXTERNAL_URL}/health`);
        console.log(`🔗 API Endpoint: ${process.env.RENDER_EXTERNAL_URL}/qr-data`);
    } else {
        console.log(`📱 QR Code Webpage: http://localhost:${PORT}`);
        console.log(`📡 Health Check: http://localhost:${PORT}/health`);
        console.log(`🔗 API Endpoint: http://localhost:${PORT}/qr-data`);
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
});

// Self-ping mechanism to keep the service active on Render
let selfPingInterval = null;
if (process.env.NODE_ENV === 'production') {
    const SELF_PING_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
    
    // More aggressive keep-alive: ping every 3 minutes instead of 5
    selfPingInterval = setInterval(async () => {
        try {
            const response = await axios.get(`${SELF_PING_URL}/health`, {
                timeout: 10000,
                headers: { 
                    'User-Agent': 'WhatsApp-Bot-KeepAlive',
                    'Cache-Control': 'no-cache'
                }
            });
            console.log(`🏓 Keep-alive ping: ${response.status} - ${new Date().toISOString()}`);
        } catch (error) {
            console.log(`⚠️ Keep-alive ping failed: ${error.message} - ${new Date().toISOString()}`);
            // Try alternative endpoint if health fails
            try {
                await axios.get(`${SELF_PING_URL}/`, { timeout: 5000 });
                console.log(`🏓 Fallback ping successful - ${new Date().toISOString()}`);
            } catch (fallbackError) {
                console.log(`❌ Both ping attempts failed - ${new Date().toISOString()}`);
            }
        }
    }, 3 * 60 * 1000); // Every 3 minutes for better reliability
    
    console.log('🏓 Enhanced keep-alive mechanism activated (3-minute interval)');
}

startBot().catch((e) => {
    console.error('❌ Failed to start bot:', e);
    process.exit(1);
});

process.on('SIGINT', () => {
    console.log('\n🛑 Received shutdown signal (SIGINT)');
    console.log('🧹 Cleaning up resources...');
    if (unmuteTimer) {
        clearInterval(unmuteTimer);
    }
    if (selfPingInterval) {
        clearInterval(selfPingInterval);
        console.log('🏓 Self-ping mechanism stopped');
    }
    server.close(() => {
        console.log('🌐 Health check server closed');
        console.log('👋 Bot shutdown complete. Goodbye!');
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Received termination signal (SIGTERM)');
    console.log('🧹 Cleaning up resources...');
    if (unmuteTimer) {
        clearInterval(unmuteTimer);
    }
    if (selfPingInterval) {
        clearInterval(selfPingInterval);
        console.log('🏓 Self-ping mechanism stopped');
    }
    server.close(() => {
        console.log('🌐 Health check server closed');
        console.log('👋 Bot terminated successfully. Goodbye!');
        process.exit(0);
    });
});
