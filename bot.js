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
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const ffprobeStatic = require('ffprobe-static');

// Bot configuration
const config = {
    autoRead: false,
    antiCall: true,
    adminJids: ['94788006269@s.whatsapp.net','94767219661@s.whatsapp.net', '11837550653588@lid'], // Support both regular and linked device formats
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

// Individual user mute system storage
const mutedUsers = new Map(); // groupJid -> Map(userJid -> { endTime, reason })

// Antilink system storage
const antilinkGroups = new Set(); // groupJid -> boolean

// Auto-unmute timer
let unmuteTimer = null;

// Persistent auth storage for Render deployments
const PERSISTENT_AUTH_KEYS = [
    'BAILEYS_CREDS',
    'BAILEYS_KEYS'
];

// Enhanced auth persistence with multiple storage methods
function backupAuthToEnv(authState) {
    try {
        if (authState.creds) {
            console.log('🔐 Backing up authentication credentials...');
            // Store in a persistent location that survives deployments
            const authBackupDir = '/tmp/auth-backup';
            if (!fs.existsSync(authBackupDir)) {
                fs.mkdirSync(authBackupDir, { recursive: true });
            }
            
            // Save to persistent tmp location
            fs.writeFileSync(path.join(authBackupDir, 'creds-backup.json'), JSON.stringify(authState.creds, null, 2));
            
            // Also save a timestamp
            fs.writeFileSync(path.join(authBackupDir, 'backup-timestamp.txt'), Date.now().toString());
            
            console.log('✅ Authentication data backed up successfully');
        }
    } catch (error) {
        console.error('❌ Error backing up auth data:', error);
    }
}

function restoreAuthFromBackup() {
    try {
        const authBackupDir = '/tmp/auth-backup';
        const credsBackupPath = path.join(authBackupDir, 'creds-backup.json');
        const timestampPath = path.join(authBackupDir, 'backup-timestamp.txt');
        
        if (fs.existsSync(credsBackupPath)) {
            const backupAge = Date.now() - parseInt(fs.readFileSync(timestampPath, 'utf8') || '0');
            const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
            
            if (backupAge < maxAge) {
                console.log('🔄 Restoring authentication from backup...');
                const credsData = JSON.parse(fs.readFileSync(credsBackupPath, 'utf8'));
                return { creds: credsData };
            } else {
                console.log('⏰ Auth backup is too old, will generate new QR code');
                // Clean up old backup
                fs.unlinkSync(credsBackupPath);
                fs.unlinkSync(timestampPath);
            }
        }
        
        console.log('📝 No valid auth backup found, will need fresh authentication');
        return null;
    } catch (error) {
        console.error('❌ Error restoring auth backup:', error);
        return null;
    }
}

// Enhanced auth state management with persistence
async function getAuthState() {
    const authDir = './auth';
    
    // Ensure auth directory exists
    if (!fs.existsSync(authDir)) {
        fs.mkdirSync(authDir, { recursive: true });
        console.log('📁 Created auth directory');
    }
    
    try {
        // First try to use existing auth files
        const authState = await useMultiFileAuthState(authDir);
        
        // Check if we have valid credentials
        if (authState.creds && Object.keys(authState.creds).length > 0) {
            console.log('✅ Using existing authentication data');
            return authState;
        }
        
        // If no valid local auth, try to restore from backup
        const restoredAuth = restoreAuthFromBackup();
        if (restoredAuth) {
            // Write restored data to files
            fs.writeFileSync(path.join(authDir, 'creds.json'), JSON.stringify(restoredAuth.creds, null, 2));
            console.log('🔄 Restored authentication from backup storage');
            
            // Return fresh auth state with restored data
            return await useMultiFileAuthState(authDir);
        }
        
        console.log('🆕 No existing authentication found, will generate new QR code');
        return authState;
        
    } catch (error) {
        console.error('❌ Error setting up auth state:', error);
        // Fallback to fresh auth state
        return await useMultiFileAuthState(authDir);
    }
}

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

// Individual user mute system functions
function muteUser(groupJid, userJid, duration, reason = '') {
    console.log(`🔇 Attempting to mute user: ${userJid} for ${duration} in group: ${groupJid}`);
    const muteTime = parseDuration(duration);
    if (!muteTime) {
        console.log(`❌ Invalid duration format: ${duration}`);
        return false;
    }
    
    if (!mutedUsers.has(groupJid)) {
        mutedUsers.set(groupJid, new Map());
        console.log(`📝 Created new mute map for group: ${groupJid}`);
    }
    
    const endTime = Date.now() + muteTime;
    const muteEndDate = new Date(endTime).toISOString();
    mutedUsers.get(groupJid).set(userJid, { endTime, reason });
    
    console.log(`✅ User ${userJid} muted until: ${muteEndDate}, reason: ${reason || 'No reason provided'}`);
    console.log(`📊 Total muted users in group ${groupJid}: ${mutedUsers.get(groupJid).size}`);
    
    return true;
}

function unmuteUser(groupJid, userJid) {
    console.log(`🔊 Attempting to unmute user: ${userJid} in group: ${groupJid}`);
    if (!mutedUsers.has(groupJid)) {
        console.log(`❌ No muted users found for group: ${groupJid}`);
        return false;
    }
    
    const groupMutes = mutedUsers.get(groupJid);
    const wasMuted = groupMutes.has(userJid);
    const result = groupMutes.delete(userJid);
    
    console.log(`${result ? '✅' : '❌'} Unmute result: ${result}, was previously muted: ${wasMuted}`);
    
    // Clean up empty group maps
    if (groupMutes.size === 0) {
        mutedUsers.delete(groupJid);
        console.log(`🗑️ Cleaned up empty group mute map for: ${groupJid}`);
    } else {
        console.log(`📊 Remaining muted users in group ${groupJid}: ${groupMutes.size}`);
    }
    
    return result;
}

function isUserMuted(groupJid, userJid) {
    console.log(`🔍 Checking mute status for user: ${userJid} in group: ${groupJid}`);
    
    if (!mutedUsers.has(groupJid)) {
        console.log(`❌ No muted users found for group: ${groupJid}`);
        return false;
    }
    
    const groupMutes = mutedUsers.get(groupJid);
    const muteData = groupMutes.get(userJid);
    if (!muteData) {
        console.log(`❌ User ${userJid} not found in muted list for group ${groupJid}`);
        return false;
    }
    
    const now = Date.now();
    const timeLeft = muteData.endTime - now;
    console.log(`⏰ User ${userJid} mute expires in: ${Math.floor(timeLeft / 60000)} minutes`);
    
    if (now > muteData.endTime) {
        console.log(`⏰ Mute expired for user: ${userJid}, removing from muted list`);
        groupMutes.delete(userJid);
        if (groupMutes.size === 0) {
            mutedUsers.delete(groupJid);
        }
        return false;
    }
    
    console.log(`✅ User ${userJid} is currently muted`);
    return true;
}

function getUserMuteInfo(groupJid, userJid) {
    if (!mutedUsers.has(groupJid)) return null;
    
    const groupMutes = mutedUsers.get(groupJid);
    const muteData = groupMutes.get(userJid);
    if (!muteData) return null;
    
    const remaining = muteData.endTime - Date.now();
    if (remaining <= 0) {
        groupMutes.delete(userJid);
        if (groupMutes.size === 0) {
            mutedUsers.delete(groupJid);
        }
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

function getMutedUsersList(groupJid) {
    if (!mutedUsers.has(groupJid)) return [];
    
    const groupMutes = mutedUsers.get(groupJid);
    const mutedList = [];
    
    for (const [userJid, muteData] of groupMutes.entries()) {
        const remaining = muteData.endTime - Date.now();
        if (remaining > 0) {
            const minutes = Math.floor(remaining / (60 * 1000));
            const hours = Math.floor(minutes / 60);
            const days = Math.floor(hours / 24);
            
            let timeStr = '';
            if (days > 0) timeStr += `${days}d `;
            if (hours % 24 > 0) timeStr += `${hours % 24}h `;
            if (minutes % 60 > 0) timeStr += `${minutes % 60}m`;
            
            mutedList.push({
                userJid,
                remaining: timeStr.trim(),
                reason: muteData.reason
            });
        } else {
            // Clean up expired mutes
            groupMutes.delete(userJid);
        }
    }
    
    // Clean up empty group maps
    if (groupMutes.size === 0) {
        mutedUsers.delete(groupJid);
    }
    
    return mutedList;
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
    
    // Check for expired group mutes
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
    
    // Check for expired individual user mutes
    const expiredUsers = [];
    
    for (const [groupJid, groupMutes] of mutedUsers.entries()) {
        for (const [userJid, muteData] of groupMutes.entries()) {
            if (now > muteData.endTime) {
                expiredUsers.push({ groupJid, userJid });
            }
        }
    }
    
    for (const { groupJid, userJid } of expiredUsers) {
        try {
            unmuteUser(groupJid, userJid);
            
            // Notify user that their mute has expired
            await sock.sendMessage(groupJid, { 
                text: `🔊 @${userJid.split('@')[0]} your mute has expired. You can send messages again.`,
                mentions: [userJid]
            });
            
            console.log(`Auto-unmuted user ${userJid} in group ${groupJid}`);
        } catch (error) {
            console.error(`Error auto-unmuting user ${userJid} in group ${groupJid}:`, error);
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

function isGifMessage(msg) {
    const m = msg.message || {};
    
    // Check for video message with gifPlayback flag OR just video (WhatsApp sends GIFs as MP4)
    if (m.videoMessage) {
        // Accept any video that might be a GIF (including MP4)
        if (m.videoMessage.gifPlayback || m.videoMessage.mimetype?.includes('mp4')) return true;
    }
    
    if (m.ephemeralMessage && m.ephemeralMessage.message?.videoMessage) {
        const video = m.ephemeralMessage.message.videoMessage;
        if (video.gifPlayback || video.mimetype?.includes('mp4')) {
            return true;
        }
    }
    if (m.viewOnceMessage && m.viewOnceMessage.message?.videoMessage) {
        const video = m.viewOnceMessage.message.videoMessage;
        if (video.gifPlayback || video.mimetype?.includes('mp4')) {
            return true;
        }
    }
    if (m.viewOnceMessageV2 && m.viewOnceMessageV2.message?.videoMessage) {
        const video = m.viewOnceMessageV2.message.videoMessage;
        if (video.gifPlayback || video.mimetype?.includes('mp4')) {
            return true;
        }
    }
    
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

function extractGifMessage(msg) {
    const m = msg.message || {};
    if (m.videoMessage && m.videoMessage.gifPlayback) return msg;
    if (m.ephemeralMessage && m.ephemeralMessage.message?.videoMessage?.gifPlayback) {
        return { ...msg, message: { videoMessage: m.ephemeralMessage.message.videoMessage } };
    }
    if (m.viewOnceMessage && m.viewOnceMessage.message?.videoMessage?.gifPlayback) {
        return { ...msg, message: { videoMessage: m.viewOnceMessage.message.videoMessage } };
    }
    if (m.viewOnceMessageV2 && m.viewOnceMessageV2.message?.videoMessage?.gifPlayback) {
        return { ...msg, message: { videoMessage: m.viewOnceMessageV2.message.videoMessage } };
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
    const isUserAdmin = config.adminJids.includes(senderJid);
    
    let errorMessage = '';
    switch (errorType) {
        case 'STICKER_FAILED':
            if (isUserAdmin) {
                errorMessage = `❌ *Sticker Creation Failed*\n\n🔧 *Admin Debug Info:*\n• Image format: Check if JPEG/PNG/WEBP\n• File size: Max 10MB recommended\n• Processing: Sharp library error\n• Network: API connectivity issue\n\n💡 *Admin Actions:* Check server logs, verify Sharp installation`;
            } else {
                errorMessage = `❌ *Sticker Creation Failed*\n\n🔧 *What to try:*\n• Send a clear JPEG or PNG image\n• Make sure image isn't too large\n• Try again in a moment\n\n💡 *Tip:* JPG and PNG work best!`;
            }
            break;
        case 'TOIMG_FAILED':
            if (isUserAdmin) {
                errorMessage = `❌ *Image Conversion Failed*\n\n🔧 *Admin Debug Info:*\n• Sticker format: WebP/AVIF conversion issue\n• Buffer processing: Sharp conversion error\n• Memory: Possible memory limitation\n\n💡 *Admin Actions:* Check memory usage, verify file integrity`;
            } else {
                errorMessage = `❌ *Image Conversion Failed*\n\n� *What to try:*\n• Reply to a different sticker\n• Make sure it's an animated sticker\n• Try again in a moment\n\n💡 *Tip:* Some stickers work better than others!`;
            }
            break;
        case 'TOGIF_FAILED':
            if (isUserAdmin) {
                errorMessage = `❌ *GIF Conversion Failed*\n\n🔧 *Admin Debug Info:*\n• Sticker format: WebP to GIF conversion issue\n• Animation: Possible animation processing error\n• Memory: Buffer processing limitation\n• Sharp: GIF encoding error\n\n💡 *Admin Actions:* Check Sharp GIF support, verify memory usage`;
            } else {
                errorMessage = `❌ *GIF Conversion Failed*\n\n🔧 *What to try:*\n• Try with a different sticker\n• Animated stickers work better\n• Try again in a moment\n\n💡 *Tip:* Some stickers may not convert to GIF format!`;
            }
            break;
        case 'MEDIA_DOWNLOAD_FAILED':
            if (isUserAdmin) {
                errorMessage = `❌ *Media Download Failed*\n\n🔧 *Admin Debug Info:*\n• Baileys API: Download stream error\n• Network: Connection timeout\n• File: Corrupted or unavailable\n• Server: WhatsApp media server issue\n\n💡 *Admin Actions:* Check network logs, verify Baileys version`;
            } else {
                errorMessage = `❌ *Media Download Failed*\n\n� *What to try:*\n• Send the media file again\n• Check your internet connection\n• Try a different file\n\n💡 *Tip:* Sometimes media files expire, try sending fresh ones!`;
            }
            break;
        case 'GROUP_ADMIN_REQUIRED':
            if (isUserAdmin) {
                errorMessage = `🚫 *Group Admin Required*\n\n👑 *Bot Admin Info:*\nYou have bot admin privileges, but this command requires group admin status in this specific chat.\n\n🔧 *Details:*\n• Command: ${commandName}\n• User: Bot Admin\n• Missing: Group Admin Role\n\n💡 *Solution:* Ask a group admin to promote you in this group`;
            } else {
                errorMessage = `🚫 *Access Denied*\n\n👑 *Required:* Group admin privileges\n\n💡 *Note:* Only group admins can use this command\n\n🤝 *Ask:* Group admins to help you with this request`;
            }
            break;
        case 'BOT_ADMIN_REQUIRED':
            if (isUserAdmin) {
                errorMessage = `⚠️ *Verification Error*\n\n🤖 *Bot Admin Notice:*\nYou should have access to this command. This might be a bug.\n\n� *Debug Info:*\n• Your JID: ${senderJid}\n• Admin List: ${config.adminJids.join(', ')}\n• Command: ${commandName}\n\n💡 *Contact:* Developer for investigation`;
            } else {
                errorMessage = `�🚫 *Access Denied*\n\n🤖 *Required:* Bot administrator privileges\n\n💡 *Note:* This command is restricted to bot admins only\n\n🤝 *Contact:* A bot administrator if you need this feature`;
            }
            break;
        case 'GROUP_ONLY':
            if (isUserAdmin) {
                errorMessage = `🚫 *Group Command Only*\n\n👥 *Admin Info:*\nThis command is designed for group chats only.\n\n🔧 *Technical:*\n• Command: ${commandName}\n• Context: Private/Direct Message\n• Required: Group Chat Context\n\n💡 *Usage:* Use this command in a group where you're admin`;
            } else {
                errorMessage = `🚫 *Command Restriction*\n\n👥 *Usage:* This command only works in groups\n\n💡 *Try:* Use this command in a group chat where you're an admin`;
            }
            break;
        case 'COMMAND_ERROR':
            if (isUserAdmin) {
                errorMessage = `❌ *Command Processing Error*\n\n🔧 *Admin Debug Info:*\n• Command: ${commandName}\n• Error Type: Processing failure\n• Possible Causes: Syntax error, API failure, server issue\n• Timestamp: ${new Date().toISOString()}\n\n💡 *Admin Actions:* Check server logs, verify command syntax`;
            } else {
                errorMessage = `❌ *Command Error*\n\n🔧 *Command:* ${commandName}\n\n💡 *Try:* Check your command spelling and try again\n\n🤝 *Help:* Contact an admin if this keeps happening`;
            }
            break;
        case 'NETWORK_ERROR':
            if (isUserAdmin) {
                errorMessage = `🌐 *Network Error*\n\n🔧 *Admin Debug Info:*\n• Connection: API timeout or failure\n• Status: Network connectivity issue\n• Service: External API unreachable\n• Time: ${new Date().toLocaleString()}\n\n💡 *Admin Actions:* Check internet connection, verify API endpoints`;
            } else {
                errorMessage = `🌐 *Network Error*\n\n🔧 *Issue:* Connection problem\n\n💡 *Try:* Check your internet and try again in a moment\n\n⏰ *Usually fixes itself:* Network issues are often temporary`;
            }
            break;
        default:
            if (isUserAdmin) {
                errorMessage = `❌ *Unknown Error (Admin)*\n\n🔧 *Debug Info:*\n• Error Type: ${errorType}\n• Command: ${commandName}\n• User: Bot Admin\n• JID: ${senderJid}\n\n💡 *Admin Actions:* Check logs, report to developer if persistent`;
            } else {
                errorMessage = `❌ *Something went wrong*\n\n🔧 *Error:* An unexpected error occurred\n\n💡 *Try:* Please try again in a moment\n\n🤝 *Contact:* An admin if this problem continues`;
            }
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

// Set FFmpeg path
ffmpeg.setFfmpegPath(ffmpegStatic);
ffmpeg.setFfprobePath(ffprobeStatic.path);

// Function to convert MP4 video to animated WebP sticker
async function convertMP4ToAnimatedWebP(buffer) {
    return new Promise((resolve, reject) => {
        console.log('🎬 Starting MP4 to animated WebP conversion...');
        const tempVideoPath = path.join(__dirname, `temp_video_${Date.now()}.mp4`);
        const tempGifPath = path.join(__dirname, `temp_gif_${Date.now()}.gif`);
        
        try {
            // Write video buffer to temporary file
            console.log('📁 Writing video buffer to temp file...');
            fs.writeFileSync(tempVideoPath, buffer);
            console.log('✅ Video file written successfully');
            
            // Convert MP4 to GIF first using FFmpeg with optimized settings for smaller file size
            console.log('🔄 Starting FFmpeg MP4 to GIF conversion...');
            ffmpeg(tempVideoPath)
                .output(tempGifPath)
                .outputOptions([
                    '-vf', 'scale=512:512:force_original_aspect_ratio=decrease',
                    '-t', '5',     // Limit to 5 seconds (shorter duration)
                    '-r', '10',    // 10 FPS (lower framerate for smaller size)
                    '-f', 'gif'
                ])
                .on('start', (commandLine) => {
                    console.log('🚀 FFmpeg command started:', commandLine);
                })
                .on('progress', (progress) => {
                    console.log('⏳ Processing:', progress.percent + '%');
                })
                .on('end', async () => {
                    try {
                        console.log('✅ FFmpeg conversion completed, reading GIF...');
                        // Read the GIF and convert to animated WebP using Sharp with optimized settings
                        const gifBuffer = fs.readFileSync(tempGifPath);
                        console.log('📊 GIF file size:', gifBuffer.length, 'bytes');
                        
                        console.log('🔄 Converting GIF to animated WebP with Sharp...');
                        const webpBuffer = await sharp(gifBuffer, { animated: true })
                            .resize(512, 512, { 
                                fit: 'contain', 
                                background: { r: 0, g: 0, b: 0, alpha: 0 } 
                            })
                            .webp({ 
                                quality: 60,     // Lower quality for smaller file size
                                effort: 6,       // Higher effort for better compression
                                method: 6        // Better compression method
                            })
                            .toBuffer();
                        
                        console.log('✅ Sharp conversion completed, WebP size:', webpBuffer.length, 'bytes');
                        
                        // Check if file is still too large
                        if (webpBuffer.length > 500000) { // 500KB limit
                            console.log('⚠️ File still too large, applying additional compression...');
                            // Try with even lower quality and smaller size
                            const compressedWebpBuffer = await sharp(gifBuffer, { animated: true })
                                .resize(400, 400, { 
                                    fit: 'contain', 
                                    background: { r: 0, g: 0, b: 0, alpha: 0 } 
                                })
                                .webp({ 
                                    quality: 40,     // Much lower quality
                                    effort: 6,
                                    method: 6
                                })
                                .toBuffer();
                            
                            console.log('✅ Compressed WebP size:', compressedWebpBuffer.length, 'bytes');
                            
                            // Clean up temporary files
                            if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
                            if (fs.existsSync(tempGifPath)) fs.unlinkSync(tempGifPath);
                            console.log('🧹 Temporary files cleaned up');
                            
                            resolve(compressedWebpBuffer);
                        } else {
                            // Clean up temporary files
                            if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
                            if (fs.existsSync(tempGifPath)) fs.unlinkSync(tempGifPath);
                            console.log('🧹 Temporary files cleaned up');
                            
                            resolve(webpBuffer);
                        }
                    } catch (error) {
                        console.error('❌ Error during Sharp conversion:', error);
                        // Clean up on error
                        if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
                        if (fs.existsSync(tempGifPath)) fs.unlinkSync(tempGifPath);
                        reject(error);
                    }
                })
                .on('error', (err) => {
                    console.error('❌ FFmpeg conversion error:', err);
                    // Clean up temporary files on error
                    if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
                    if (fs.existsSync(tempGifPath)) fs.unlinkSync(tempGifPath);
                    reject(err);
                })
                .run();
        } catch (error) {
            console.error('❌ File operation error:', error);
            reject(error);
        }
    });
}

async function createStickerFromImageBuffer(buffer) {
    // Convert to webp using sharp with proper sticker dimensions and optimized compression
    const webpBuffer = await sharp(buffer)
        .resize(512, 512, { 
            fit: 'contain', 
            background: { r: 0, g: 0, b: 0, alpha: 0 } 
        })
        .webp({ 
            quality: 80,    // Good quality but compressed
            effort: 6,      // Higher effort for better compression
            method: 6       // Better compression method
        })
        .toBuffer();
    
    // Check if file is too large for WhatsApp
    if (webpBuffer.length > 500000) { // 500KB limit
        console.log('⚠️ Static sticker too large, applying compression...');
        // Try with lower quality
        const compressedBuffer = await sharp(buffer)
            .resize(512, 512, { 
                fit: 'contain', 
                background: { r: 0, g: 0, b: 0, alpha: 0 } 
            })
            .webp({ 
                quality: 60,    // Lower quality for smaller file
                effort: 6,
                method: 6
            })
            .toBuffer();
        console.log('✅ Compressed static sticker size:', compressedBuffer.length, 'bytes');
        return compressedBuffer;
    }
    
    return webpBuffer;
}

async function createAnimatedStickerFromGif(buffer) {
    try {
        // Check file format - could be GIF or MP4 (WhatsApp sends GIFs as MP4)
        const firstBytes = buffer.toString('ascii', 0, 10);
        let isActualGif = firstBytes.startsWith('GIF');
        let isMp4 = buffer.includes(Buffer.from('ftyp')) || firstBytes.includes('ftyp');
        
        if (isMp4) {
            // For MP4 videos, convert directly to animated WebP
            const animatedWebpBuffer = await convertMP4ToAnimatedWebP(buffer);
            return animatedWebpBuffer;
        }
        
        // Handle actual GIF files with Sharp
        if (isActualGif) {
            const animatedWebpBuffer = await sharp(buffer)
                .resize(512, 512, { 
                    fit: 'contain', 
                    background: { r: 0, g: 0, b: 0, alpha: 0 } 
                })
                .webp({ quality: 90 })
                .toBuffer();
            return animatedWebpBuffer;
        }
        
        // If we can't determine the format, try generic conversion with Sharp
        const webpBuffer = await sharp(buffer)
            .resize(512, 512, { 
                fit: 'contain', 
                background: { r: 0, g: 0, b: 0, alpha: 0 } 
            })
            .webp({ quality: 90 })
            .toBuffer();
        return webpBuffer;
        
    } catch (error) {
        throw new Error('Failed to convert media to sticker format: ' + error.message);
    }
}

async function convertStickerToImage(buffer) {
    // Convert webp sticker to jpeg using sharp
    const jpegBuffer = await sharp(buffer).jpeg({ quality: 90 }).toBuffer();
    return jpegBuffer;
}

async function convertStickerToGif(buffer) {
    // Convert WebP sticker to GIF
    try {
        console.log('🔄 Attempting WebP to GIF conversion with Sharp...');
        
        // First, let's check if it's an animated WebP
        const metadata = await sharp(buffer).metadata();
        console.log('📊 Sticker metadata:', {
            format: metadata.format,
            width: metadata.width,
            height: metadata.height,
            pages: metadata.pages
        });
        
        if (metadata.pages && metadata.pages > 1) {
            // It's animated - Sharp can handle this
            console.log('🎬 Detected animated WebP with', metadata.pages, 'frames');
            const gifBuffer = await sharp(buffer, { animated: true })
                .gif()
                .toBuffer();
            console.log('✅ Animated WebP to GIF conversion successful');
            return gifBuffer;
        } else {
            // Static sticker - convert normally
            console.log('🖼️ Detected static WebP');
            const gifBuffer = await sharp(buffer)
                .gif()
                .toBuffer();
            console.log('✅ Static WebP to GIF conversion successful');
            return gifBuffer;
        }
    } catch (error) {
        console.error('❌ WebP to GIF conversion failed:', error.message);
        
        // Fallback: try converting through PNG first
        try {
            console.log('🔄 Trying fallback PNG conversion...');
            const pngBuffer = await sharp(buffer)
                .png()
                .toBuffer();
            
            // Then convert PNG to GIF
            const gifBuffer = await sharp(pngBuffer)
                .gif()
                .toBuffer();
            console.log('✅ PNG fallback conversion successful');
            return gifBuffer;
        } catch (pngError) {
            console.error('❌ PNG intermediate conversion also failed:', pngError.message);
            throw new Error('Failed to convert sticker to GIF format: ' + pngError.message);
        }
    }
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
    // Sri Lanka timezone (GMT+5:30)
    const sriLankaOffset = 5.5 * 60; // 5 hours 30 minutes in minutes
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const sriLankaTime = new Date(utc + (sriLankaOffset * 60000));
    
    // Sri Lanka timezone info
    const timezone = 'GMT+5:30 (Sri Lanka Standard Time)';
    
    // Format date and time for Sri Lanka
    const date = sriLankaTime.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    
    const time = sriLankaTime.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    });
    
    // Additional info
    const unixTimestamp = Math.floor(sriLankaTime.getTime() / 1000);
    const dayOfYear = Math.floor((sriLankaTime - new Date(sriLankaTime.getFullYear(), 0, 0)) / (1000 * 60 * 60 * 24));
    const weekNumber = Math.ceil(dayOfYear / 7);
    
    return {
        date,
        time,
        timezone,
        unixTimestamp,
        dayOfYear,
        weekNumber,
        iso: sriLankaTime.toISOString(),
        location: 'Sri Lanka',
        localeDateString: sriLankaTime.toLocaleDateString(),
        localeString: sriLankaTime.toLocaleString()
    };
}

// Helper function to get Sri Lanka time as Date object
function getSriLankaTime() {
    const sriLankaOffset = 5.5 * 60; // 5 hours 30 minutes in minutes
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    return new Date(utc + (sriLankaOffset * 60000));
}

async function startBot() {
    // Use enhanced auth state management with persistence
    const { state, saveCreds } = await getAuthState();
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ['CloudNextra Bot', 'Desktop', '3.0.0']
    });

    // Enhanced credentials saving with backup
    const originalSaveCreds = saveCreds;
    const enhancedSaveCreds = async () => {
        await originalSaveCreds();
        // Backup auth data for persistence across deployments
        backupAuthToEnv({ creds: state.creds, keys: state.keys });
    };

    // QR handling with persistence awareness
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
            
            // Backup authentication data on successful connection
            try {
                backupAuthToEnv({ creds: state.creds, keys: state.keys });
                console.log('💾 Authentication data backed up for persistence');
            } catch (error) {
                console.error('❌ Failed to backup auth data:', error);
            }
        } else if (connection === 'close') {
            connectionStatus = 'disconnected';
            currentQRCode = null;
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('⚠️  Connection Lost. Attempting Reconnection:', shouldReconnect);
            if (shouldReconnect) startBot();
        }
    });

    sock.ev.on('creds.update', enhancedSaveCreds);

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

            // Check if individual user is muted (block their messages)
            if (isGroup && isUserMuted(from, senderJid)) {
                console.log(`🔇 Silently blocking message from muted user: ${senderJid} in group: ${from}`);
                
                try {
                    // Silently delete the muted user's message (no warning message)
                    await sock.sendMessage(from, { 
                        delete: msg.key 
                    });
                    console.log(`✅ Successfully deleted message from muted user: ${senderJid} (silent mode)`);
                } catch (error) {
                    console.error('Error deleting muted user message:', error);
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
                    
                    // Send simple warning message (not a reply)
                    await sock.sendMessage(from, { 
                        text: `🚫 Links are not allowed in this group.` 
                    });
                } catch (error) {
                    console.error('Error handling antilink:', error);
                    // If deletion fails, at least send the warning
                    try {
                        await sock.sendMessage(from, { 
                            text: `🚫 Links are not allowed in this group.` 
                        });
                    } catch (warningError) {
                        console.error('Error sending antilink warning:', warningError);
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
                    await sock.sendMessage(from, { text: '🛑 The bot is currently OFF. Only bot admins can send `.on` to enable it.' }, { quoted: msg });
                    continue;
                }
                
                
                console.log(`Processing command: "${command}"`);
                switch (command) {
                    case '.test': {
                        await sock.sendMessage(from, { text: '✅ Test command works!' }, { quoted: msg });
                        break;
                    }
                    case '.on': {
                        if (!isBotAdmin) {
                            await sendErrorMessage(sock, senderJid, from, 'BOT_ADMIN_REQUIRED', '.on');
                            break;
                        }
                        config.botEnabled = true;
                        await sock.sendMessage(from, { text: '🚀 *Bot Status Updated*\n\n✅ Bot is now **ONLINE** and ready to serve!\n\n💡 *Tip:* Send `.panel` to explore all features.' }, { quoted: msg });
                        break;
                    }
                    case '.off': {
                        if (!isBotAdmin) {
                            await sendErrorMessage(sock, senderJid, from, 'BOT_ADMIN_REQUIRED', '.off');
                            break;
                        }
                        config.botEnabled = false;
                        await sock.sendMessage(from, { text: '⏸️ *Bot Status Updated*\n\n🛑 Bot is now **OFFLINE** for maintenance.\n\n🔧 Only bot admins can use `.on` to reactivate.' }, { quoted: msg });
                        break;
                    }
                    case '.panel': {
                        // Create different panel content based on user role
                        const isAdmin = isBotAdmin;
                        let panelText;
                        
                        if (isAdmin) {
                            // Admin Panel - Full access
                            panelText = `
🤖  *WhatsApp Bot — Admin Control Panel*
────────────────────────────────────────

👑  *Welcome, Administrator!*
You have full access to all bot features and controls.

📌  *Bot Management* (Admin Only)
• \`.panel\` — Show this admin panel
• \`.autoread\` — Toggle auto view status (${config.autoRead ? '✅ ON' : '❌ OFF'})
• \`.anticall\` — Toggle call blocking (${config.antiCall ? '✅ ON' : '❌ OFF'})
• \`.on\` / \`.off\` — Enable/disable bot

🔍  *Information Commands*
• \`.status\` — Debug & system information

🎨  *Media Commands*
• \`.sticker\` — Convert image/GIF to sticker
• \`.toimg\` — Convert sticker to image
• \`.togif\` — Convert sticker to GIF

🛠️  *Advanced Tools*
• \`.shorturl [url]\` — URL shortener
• \`.color [name]\` — Color code lookup  
• \`.time\` — Current time & date
• \`.pass [12]\` — Password generator

�  *Group Management* (Group Admin Required)
• \`.ginfo\` — Group information
• \`.tagall [message]\` — Tag all members
• \`.admins\` — List group admins
• \`.members\` — Member statistics
• \`.rules\` — Display group rules
• \`.kick @user\` — Remove member
• \`.promote @user\` — Make admin
• \`.mute [1h]\` — Mute group
• \`.muteuser @user [1h]\` — Mute individual user
• \`.warn @user\` — Issue warning
• \`.resetwarns\` — Reset all warnings
• \`.groupstats\` — Detailed group stats
• \`.lock\` / \`.unlock\` — Lock group
• \`.antilink on/off\` — Link protection

📊  *System Status*
• Bot: ${config.botEnabled ? '✅ ONLINE' : '🛑 OFFLINE'}
• Auto Read: ${config.autoRead ? '✅ Enabled' : '❌ Disabled'}
• Anti Call: ${config.antiCall ? '✅ Enabled' : '❌ Disabled'}

⚡  *Admin Privileges Active*
`;
                        } else {
                            // User Panel - Limited access
                            panelText = `
🤖  *WhatsApp Bot — User Menu*
──────────────────────────────

👋  *Welcome, User!*
Here are the commands available to you:

🔍  *Information Commands*
• \`.status\` — Bot status & information

🎨  *Media Commands*
• \`.sticker\` — Convert image/GIF to sticker
• \`.toimg\` — Convert sticker to image
• \`.togif\` — Convert sticker to GIF

🛠️  *Utility Tools*
• \`.shorturl [url]\` — Shorten long URLs
• \`.color [name]\` — Get color codes (hex, rgb, hsl)
• \`.time\` — Current time & date
• \`.pass [12]\` — Generate secure password

👥  *Group Features* (When you're group admin)
• \`.ginfo\` — Group information
• \`.tagall [message]\` — Mention all members
• \`.admins\` — List group administrators
• \`.members\` — Member count & statistics
• \`.rules\` — Show group rules
• \`.kick @user\` — Remove member
• \`.promote @user\` — Make admin

📱  *How to Use*
• Send image + \`.sticker\` to create sticker
• Reply to sticker with \`.toimg\` to convert
• Group commands work only if you're group admin
• Bot admin commands are restricted

💡  *Need Help?*
Contact a bot administrator for advanced features!
`;
                        }
                        
                        try {
                            // Fix for self-chat: get correct target JID
                            const targetJid = getSelfChatTargetJid(senderJid, from);
                            if (targetJid !== from) {
                                console.log(`🔄 Redirecting self-chat message from ${from} to ${targetJid}`);
                            }
                            
                            await sock.sendMessage(targetJid, { text: panelText }, { quoted: msg });
                            console.log(`✅ ${isAdmin ? 'Admin' : 'User'} panel sent successfully to: ${targetJid}`);
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
                        if (!isBotAdmin) {
                            await sendErrorMessage(sock, senderJid, from, 'BOT_ADMIN_REQUIRED', '.autoread');
                            break;
                        }
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
                        if (!isBotAdmin) {
                            await sendErrorMessage(sock, senderJid, from, 'BOT_ADMIN_REQUIRED', '.anticall');
                            break;
                        }
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
                        // Check for image or GIF in the triggering message or quoted message
                        let mediaMsg = null;
                        let isGif = false;
                        
                        // Check direct message for image or GIF
                        if (isImageMessage(msg)) {
                            mediaMsg = extractImageMessage(msg);
                        } else if (isGifMessage(msg)) {
                            mediaMsg = extractGifMessage(msg);
                            isGif = true;
                        }
                        
                        // If not found, check quoted message
                        if (!mediaMsg && msg.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
                            const quoted = msg.message.extendedTextMessage.contextInfo.quotedMessage;
                            
                            // Check for image in quoted message
                            if (quoted.imageMessage) {
                                mediaMsg = { ...msg, message: { imageMessage: quoted.imageMessage } };
                            } else if (quoted.ephemeralMessage?.message?.imageMessage) {
                                mediaMsg = { ...msg, message: { imageMessage: quoted.ephemeralMessage.message.imageMessage } };
                            } else if (quoted.viewOnceMessage?.message?.imageMessage) {
                                mediaMsg = { ...msg, message: { imageMessage: quoted.viewOnceMessage.message.imageMessage } };
                            } else if (quoted.viewOnceMessageV2?.message?.imageMessage) {
                                mediaMsg = { ...msg, message: { imageMessage: quoted.viewOnceMessageV2.message.imageMessage } };
                            }
                            // Check for video/GIF in quoted message
                            else if (quoted.videoMessage) {
                                mediaMsg = { ...msg, message: { videoMessage: quoted.videoMessage } };
                                isGif = true; // Treat any quoted video as potential GIF
                            } else if (quoted.ephemeralMessage?.message?.videoMessage) {
                                mediaMsg = { ...msg, message: { videoMessage: quoted.ephemeralMessage.message.videoMessage } };
                                isGif = true;
                            } else if (quoted.viewOnceMessage?.message?.videoMessage) {
                                mediaMsg = { ...msg, message: { videoMessage: quoted.viewOnceMessage.message.videoMessage } };
                                isGif = true;
                            } else if (quoted.viewOnceMessageV2?.message?.videoMessage) {
                                mediaMsg = { ...msg, message: { videoMessage: quoted.viewOnceMessageV2.message.videoMessage } };
                                isGif = true;
                            }
                        }
                        
                        if (!mediaMsg) {
                            await sock.sendMessage(from, { 
                                text: '🎨 *Sticker Creator*\n\n❌ No supported media detected!\n\n📷 *How to use:*\n• Send **image/video** with caption `.sticker`\n• Reply to any **image/video** with `.sticker`\n\n✅ *Supports:* JPG, PNG, WEBP, GIF files, and MP4 videos\n\n💡 *Tip:* MP4 videos will be converted to static stickers using the first frame!' 
                            }, { quoted: msg });
                            break;
                        }
                        
                        try {
                            const buffer = await downloadMediaMessage(
                                mediaMsg,
                                'buffer',
                                {},
                                { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
                            );
                            
                            let stickerBuffer;
                            let successMessage;
                            
                            if (isGif) {
                                // Convert GIF to animated sticker
                                stickerBuffer = await createAnimatedStickerFromGif(buffer);
                                const fileSizeKB = Math.round(stickerBuffer.length / 1024);
                                successMessage = `🎭 *Animated Sticker Created!*\n\n✨ Your GIF has been converted to an animated sticker\n📊 File size: ${fileSizeKB}KB (optimized for WhatsApp)\n🚀 Ready to use in chats!\n\n💫 *Enjoy your new animated sticker!*`;
                            } else {
                                // Convert image to static sticker
                                stickerBuffer = await createStickerFromImageBuffer(buffer);
                                const fileSizeKB = Math.round(stickerBuffer.length / 1024);
                                successMessage = `🎨 *Sticker Created Successfully!*\n\n✨ Your image has been converted to a sticker\n📊 File size: ${fileSizeKB}KB (optimized for WhatsApp)\n🚀 Ready to use in chats!\n\n💫 *Enjoy your new sticker!*`;
                            }
                            
                            await sock.sendMessage(from, { sticker: stickerBuffer }, { quoted: msg });
                            await sock.sendMessage(from, { text: successMessage }, { quoted: msg });
                            
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
                    case '.togif': {
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
                                text: '🎭 *GIF Converter*\n\n❌ No sticker detected!\n\n🎯 *How to use:*\n• Send sticker with caption `.togif`\n• Reply to any sticker with `.togif`\n\n🔄 Convert stickers to animated GIFs!\n💡 *Works best with animated stickers*' 
                            }, { quoted: msg });
                            break;
                        }
                        try {
                            console.log('🎭 Starting sticker to GIF conversion...');
                            const buffer = await downloadMediaMessage(
                                stickerMsg,
                                'buffer',
                                {},
                                { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
                            );
                            console.log('📥 Downloaded sticker buffer, size:', buffer.length, 'bytes');
                            const gifBuffer = await convertStickerToGif(buffer);
                            console.log('✅ GIF conversion completed, size:', gifBuffer.length, 'bytes');
                            await sock.sendMessage(from, { 
                                video: gifBuffer,
                                gifPlayback: true,
                                caption: '🎭 *GIF Conversion Complete!*\n\n✅ Sticker successfully converted to GIF\n📱 Perfect for sharing animations!\n\n🎨 *Enjoy your GIF!*'
                            }, { quoted: msg });
                        } catch (e) {
                            console.error('Error converting sticker to GIF:', e);
                            await sendErrorMessage(sock, senderJid, from, 'TOGIF_FAILED');
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
                            
                            const response = `🕐 *Sri Lanka Time Service*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📅 *Current Date:*
${timeInfo.date}

⏰ *Local Time:*
${timeInfo.time}

🌍 *Timezone:*
${timeInfo.timezone}

🏝️ *Location:*
${timeInfo.location}

📊 *Detailed Information:*
• 📆 Day of Year: ${timeInfo.dayOfYear}
• 🗓️ Week Number: ${timeInfo.weekNumber}
• ⚡ Unix Timestamp: ${timeInfo.unixTimestamp}
• 🔗 ISO Format: ${timeInfo.iso}

🤖 *Bot Performance:*
• ⏱️ Uptime: ${uptimeHours}h ${uptimeMinutes % 60}m ${uptimeSeconds % 60}s
• 🟢 Status: Active & Responsive

�🇰 *Sri Lanka Standard Time (SLST)*`;
                            
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
                            const isUserAdmin = isBotAdmin;
                            let helpText;
                            
                            if (isUserAdmin) {
                                // Admin Help - Comprehensive guide
                                helpText = `📚 *WhatsApp Bot v3 - Admin Command Reference*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

👑 **Welcome, Administrator!**
You have full access to all bot features and advanced controls.

🎛️ **Bot Management** (Admin Only)
• \`.panel\` — Admin control panel
• \`.on\` / \`.off\` — Enable/disable bot
• \`.autoread\` — Toggle auto view status
• \`.anticall\` — Toggle call blocking
• \`.status\` — Detailed system information

🔍 **Information & Debug**
• \`.help\` — This admin command reference
• \`.stats\` — Bot statistics & uptime
• \`.ping\` — Response time test
• \`.about\` — Bot technical information

🎨 **Media Processing**
• \`.sticker\` — Convert image/GIF to sticker (supports animated GIFs)
• \`.toimg\` — Convert sticker to image
• \`.togif\` — Convert sticker to animated GIF
*Note: Works with quoted messages or direct uploads*

🛠️ **Advanced Tools**
• \`.shorturl [url]\` — URL shortener with TinyURL API
• \`.color [name]\` — Complete color code lookup (HEX, RGB, HSL)
• \`.time\` — Current time with timezone info
• \`.pass [length]\` — Cryptographically secure password generator

👥 **Group Commands** (Available to All Members)
• \`.ginfo\` — View group information and statistics
• \`.tagall [message]\` — Mention all group members
• \`.admins\` — List group administrators

👥 **Group Management** (Requires Group Admin)
• \`.members\` — Comprehensive member statistics
• \`.rules\` — Display/manage group rules
• \`.kick @user\` — Remove member from group
• \`.promote @user\` — Promote to admin
• \`.demote @user\` — Remove admin privileges
• \`.mute [duration]\` — Mute entire group
• \`.muteuser @user [duration]\` — Mute individual user
• \`.warn @user [reason]\` — Issue warning to user
• \`.resetwarns @user\` — Clear user warnings
• \`.groupstats\` — Advanced group analytics
• \`.lock\` / \`.unlock\` — Control group settings
• \`.antilink on/off\` — Toggle link protection

🔒 **Admin Features**
• Complete system access and control
• Advanced error messages with debug info
• Full group management capabilities
• Bot configuration management
• System monitoring and diagnostics

💡 **Admin Tips:**
• Use \`.panel\` for interactive admin control
• Group commands work only with group admin privileges
• Bot admin ≠ Group admin (both may be required)
• Error messages include debug information for troubleshooting

🚀 **Technical Details:**
• Built with Baileys v6.6.0
• Node.js 20+ with Sharp image processing
• Persistent authentication with automatic backup
• Self-chat redirection for optimal UX

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
                            } else {
                                // User Help - Simplified guide
                                helpText = `📚 *WhatsApp Bot v3 - User Guide*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

👋 **Welcome!**
Here's everything you can do with this bot:

🔍 **Information Commands**
• \`.help\` — Show this user guide
• \`.status\` — Bot status & information  
• \`.panel\` — User menu with available commands

🎨 **Media Features**
• \`.sticker\` — Turn your image or GIF into a WhatsApp sticker
• \`.toimg\` — Convert sticker back to image
• \`.togif\` — Convert animated sticker back to GIF

💡 **How to use media commands:**
• Send an image/GIF, then type \`.sticker\`
• Reply to an image/GIF with \`.sticker\`
• Reply to a sticker with \`.toimg\` or \`.togif\`

�️ **Useful Tools**
• \`.shorturl [url]\` — Make long URLs short and easy to share
• \`.color [name]\` — Get color codes (try: \`.color red\`)
• \`.time\` — See current time and date
• \`.pass [12]\` — Generate a secure password

👥 **Group Features** (When you're group admin)
• \`.ginfo\` — See group information
• \`.tagall [message]\` — Mention everyone in the group
• \`.admins\` — See who are the group admins
• \`.members\` — Count group members
• \`.rules\` — Show group rules
• \`.kick @username\` — Remove someone from group
• \`.promote @username\` — Make someone an admin

📝 **Example Commands:**
• \`.shorturl https://example.com/very/long/url\`
• \`.color blue\`
• \`.pass 16\`
• \`.tagall Meeting in 5 minutes!\`

🤝 **Need More Help?**
• Use \`.panel\` for an interactive menu
• Group commands only work if you're a group admin
• Contact a bot administrator for advanced features
• Bot admins have access to additional commands

� **Tips for Best Experience:**
• Images work best in JPG or PNG format
• Be patient with media processing
• Check your spelling when typing commands
• Some features require specific permissions

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
                            }
                            
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
• 🚀 Started: ${getSriLankaTime().toLocaleString()} (SLST)
• ⏰ Running: ${uptimeString.trim()}
• 📅 Current: ${getSriLankaTime().toLocaleString()} (SLST)

💻 **System Performance:**
• 🧠 Memory Usage: ${memoryMB} MB
• 🔄 Node.js Version: ${process.version}
• 🏗️ Platform: ${process.platform}

🤖 **Bot Status:**
• 🟢 Status: Active & Responsive
• 📡 Connection: Stable
• 🛡️ Auto view status: ${config.autoRead ? 'Enabled' : 'Disabled'}
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
                    
                    // Group Management Commands
                    case '.ginfo': {
                        if (!isGroup) {
                            await sendErrorMessage(sock, senderJid, from, 'GROUP_ONLY');
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
• \`.muteuser @user <duration> [reason]\` — Mute individual user
• \`.unmuteuser @user\` — Unmute individual user
• \`.mutedusers\` — List all muted users
• \`.warn @user\` — Issue warning to member
• \`.warns @user\` — Check member warning count
• \`.clearwarns @user\` — Clear specific member warnings
• \`.resetwarns\` — Reset all group warnings
• \`.antilink on/off\` — Toggle anti-link protection

ℹ️ *Note:* All commands require admin privileges except \`.ginfo\`, \`.tagall\`, \`.admins\`, \`.rules\`, and \`.members\`.`;
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
                    
                    case '.muteuser': {
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
                            await sock.sendMessage(from, { text: '❌ Please mention a user to mute. Usage: `.muteuser @user <5m|1h|1d|1w> [reason]`' }, { quoted: msg });
                            break;
                        }
                        
                        const args = fullCommand.replace('.muteuser', '').trim().split(' ');
                        const duration = args.find(arg => /^\d+[mhdw]$/i.test(arg));
                        
                        if (!duration) {
                            await sock.sendMessage(from, { text: '❌ Please provide a valid duration. Usage: `.muteuser @user <5m|1h|1d|1w> [reason]`' }, { quoted: msg });
                            break;
                        }
                        
                        const reason = args.filter(arg => !arg.includes('@') && !/^\d+[mhdw]$/i.test(arg)).join(' ').trim();
                        
                        for (const userJid of mentionedJids) {
                            // Don't allow muting admins
                            const targetIsAdmin = await isGroupAdmin(sock, from, userJid);
                            if (targetIsAdmin) {
                                await sock.sendMessage(from, { 
                                    text: `❌ Cannot mute @${userJid.split('@')[0]} as they are a group admin.`,
                                    mentions: [userJid]
                                }, { quoted: msg });
                                continue;
                            }
                            
                            if (muteUser(from, userJid, duration, reason)) {
                                const muteInfo = getUserMuteInfo(from, userJid);
                                const reasonText = reason ? ` Reason: ${reason}` : '';
                                
                                await sock.sendMessage(from, { 
                                    text: `🔇 @${userJid.split('@')[0]} has been muted for ${muteInfo.remaining}.${reasonText}`,
                                    mentions: [userJid]
                                }, { quoted: msg });
                            } else {
                                await sock.sendMessage(from, { 
                                    text: `❌ Failed to mute @${userJid.split('@')[0]}. Invalid duration format.`,
                                    mentions: [userJid]
                                }, { quoted: msg });
                            }
                        }
                        break;
                    }
                    
                    case '.unmuteuser': {
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
                            await sock.sendMessage(from, { text: '❌ Please mention a user to unmute. Usage: `.unmuteuser @user`' }, { quoted: msg });
                            break;
                        }
                        
                        for (const userJid of mentionedJids) {
                            if (isUserMuted(from, userJid)) {
                                unmuteUser(from, userJid);
                                await sock.sendMessage(from, { 
                                    text: `🔊 @${userJid.split('@')[0]} has been unmuted and can send messages again.`,
                                    mentions: [userJid]
                                }, { quoted: msg });
                            } else {
                                await sock.sendMessage(from, { 
                                    text: `ℹ️ @${userJid.split('@')[0]} is not currently muted.`,
                                    mentions: [userJid]
                                }, { quoted: msg });
                            }
                        }
                        break;
                    }
                    
                    case '.mutedusers': {
                        if (!isGroup) {
                            await sock.sendMessage(from, { text: '❌ This command only works in groups.' }, { quoted: msg });
                            break;
                        }
                        if (!isAdmin) {
                            await sock.sendMessage(from, { text: '❌ Only group admins can use this command.' }, { quoted: msg });
                            break;
                        }
                        
                        const mutedList = getMutedUsersList(from);
                        
                        if (mutedList.length === 0) {
                            await sock.sendMessage(from, { text: 'ℹ️ No users are currently muted in this group.' }, { quoted: msg });
                        } else {
                            let response = '🔇 *Muted Users:*\n\n';
                            const mentions = [];
                            
                            for (const mute of mutedList) {
                                const username = mute.userJid.split('@')[0];
                                response += `• @${username} - ${mute.remaining} left`;
                                if (mute.reason) response += ` (${mute.reason})`;
                                response += '\n';
                                mentions.push(mute.userJid);
                            }
                            
                            await sock.sendMessage(from, { 
                                text: response,
                                mentions: mentions
                            }, { quoted: msg });
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
📅 **Group Created:** ${new Date(groupMetadata.creation * 1000).toLocaleDateString('en-US', { timeZone: 'Asia/Colombo' })} (SLST)

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
• Created: ${new Date(groupMetadata.creation * 1000).toLocaleDateString('en-US', { timeZone: 'Asia/Colombo' })} (SLST)
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
                        const isUserAdmin = isBotAdmin;
                        
                        let helpMessage;
                        if (isUserAdmin) {
                            helpMessage = `❓ *Command Not Recognized (Admin)*\n\n🤖 The command "${command}" is not available\n\n🔧 *Admin Debug Info:*\n• Command: ${command}\n• From: ${senderJid}\n• Context: ${from.includes('@g.us') ? 'Group' : 'Private'}\n\n📋 *Get Help:*\n• Send \`.panel\` for admin control panel\n• Send \`.help\` for complete admin command list\n• Type \`.ghelp\` for group management commands\n• Check command spelling and syntax\n\n💡 *Admin Note:* If this should be a valid command, check the code or contact the developer!`;
                        } else {
                            helpMessage = `❓ *Command Not Recognized*\n\n🤖 The command "${command}" is not available to you\n\n📋 *Get Help:*\n• Send \`.panel\` for available commands\n• Send \`.help\` for user guide\n• Type \`.ghelp\` for group commands\n• Check your spelling and try again\n\n💡 *Tips:*\n• Some commands are admin-only\n• Make sure you're typing the command correctly\n• Contact a bot admin if you need special features!`;
                        }
                        
                        await sock.sendMessage(targetJid, { text: helpMessage }, { quoted: msg });
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
