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

// Bot configuration
const config = {
    autoRead: false,
    antiCall: false,
    adminJids: ['94752735513@s.whatsapp.net'], // E.164 without +, then @s.whatsapp.net
    botEnabled: true
};

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
            console.log('\nOpen WhatsApp → Linked devices → Link a device.');
        }
        if (connection === 'open') {
            console.log('✅ Bot connected and ready.');
            console.log('📋 Commands: .panel | .sticker | .autoread | .anticall | .on | .off');
        } else if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed. Reconnect:', shouldReconnect);
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
            if (config.autoRead) {
                try { await sock.readMessages([msg.key]); } catch (_) {}
            }

            if (body.startsWith('.')) {
                const fullCommand = body.trim().toLowerCase();
                const command = fullCommand.split(' ')[0]; // Get just the command part
                console.log(`Received command: ${fullCommand} from ${from}`);
                console.log(`Parsed command: "${command}"`);
                console.log(`Is Group: ${isGroup}, Is Admin: ${isAdmin}`);
                
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
                        await sock.sendMessage(from, { text: '✅ Bot is now ON.\n\nTip: Send `.panel` to view the menu.' }, { quoted: msg });
                        break;
                    }
                    case '.off': {
                        config.botEnabled = false;
                        await sock.sendMessage(from, { text: '🛑 Bot is now OFF.\n\nOnly the `.on` command will be accepted until it is re-enabled.' }, { quoted: msg });
                        break;
                    }
                    case '.panel': {
                        const panelText = `
🤖  *WhatsApp Bot — Control Panel*
────────────────────────────────

📌  *General Commands*
• \`.panel\` — Show this menu
• \`.sticker\` — Make a sticker (send an image + caption \`.sticker\` or reply \`.sticker\` to an image)
• \`.autoread\` — Toggle auto read receipts (${config.autoRead ? '✅ ON' : '❌ OFF'})
• \`.anticall\` — Toggle call blocking (${config.antiCall ? '✅ ON' : '❌ OFF'})
• \`.on\` / \`.off\` — Turn bot on/off

👑  *Group Commands* (Admin Only)
• \`.gtest\` — Debug admin status
• \`.ghelp\` — Show group management commands
• \`.ginfo\` — Show group information
• \`.kick @user\` — Remove member
• \`.promote @user\` — Make admin
• \`.demote @user\` — Remove admin
• \`.lock\` / \`.unlock\` — Lock/unlock group

📊  *Status*
• Bot: ${config.botEnabled ? '✅ ON' : '🛑 OFF'}
• Auto Read: ${config.autoRead ? '✅ Enabled' : '❌ Disabled'}
• Anti Call: ${config.antiCall ? '✅ Enabled' : '❌ Disabled'}

ℹ️  *Tips*
• For best results, send clear images when creating stickers.
• Group commands only work if you're an admin in the group.
• Use \`.ghelp\` in groups to see all group management commands.
`;
                        await sock.sendMessage(from, { text: panelText }, { quoted: msg });
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
👑 *Group Management Commands*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 *Info & Settings*
• \`.ginfo\` — Show group information
• \`.gdesc <text>\` — Change group description
• \`.gname <text>\` — Change group name

👥 *Member Management*
• \`.kick @user\` — Remove member from group
• \`.promote @user\` — Make member admin
• \`.demote @user\` — Remove admin privileges
• \`.invite <number>\` — Add member by number

🔇 *Moderation*
• \`.mute <duration>\` — Mute group (5m, 1h, 1d, 1w)
• \`.unmute\` — Unmute group
• \`.mutestatus\` — Check mute status
• \`.warn @user\` — Warn a member (auto-kick after 3 warnings)
• \`.warns @user\` — Check member warning count
• \`.clearwarns @user\` — Clear member warnings

⚙️ *Group Settings*
• \`.lock\` — Lock group (only admins can send messages)
• \`.unlock\` — Unlock group
• \`.antilink on/off\` — Toggle anti-link protection

ℹ️ *Note:* All commands require admin privileges.`;
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
