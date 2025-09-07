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

            // Auto-read normal messages
            if (config.autoRead) {
                try { await sock.readMessages([msg.key]); } catch (_) {}
            }

            if (body.startsWith('.')) {
                const command = body.trim().toLowerCase();
                // If bot is OFF, only allow .on command
                if (!config.botEnabled && command !== '.on') {
                    await sock.sendMessage(from, { text: '🛑 The bot is currently OFF. Send `.on` to enable it.' }, { quoted: msg });
                    continue;
                }
                switch (command) {
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

📌  *Commands*
• \`.panel\` — Show this menu
• \`.sticker\` — Make a sticker (send an image + caption \`.sticker\` or reply \`.sticker\` to an image)
• \`.autoread\` — Toggle auto read receipts (${config.autoRead ? '✅ ON' : '❌ OFF'})
• \`.anticall\` — Toggle call blocking (${config.antiCall ? '✅ ON' : '❌ OFF'})
• \`.on\` / \`.off\` — Turn bot on/off

📊  *Status*
• Bot: ${config.botEnabled ? '✅ ON' : '🛑 OFF'}
• Auto Read: ${config.autoRead ? '✅ Enabled' : '❌ Disabled'}
• Anti Call: ${config.antiCall ? '✅ Enabled' : '❌ Disabled'}

ℹ️  *Tips*
• For best results, send clear images when creating stickers.
• Reply with \`.sticker\` to an image if you forgot the caption.
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
                    default: {
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
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\nReceived SIGTERM. Exit.');
    process.exit(0);
});
