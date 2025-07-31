const { makeid } = require('./gen-id');
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const pino = require("pino");
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    delay, 
    Browsers 
} = require('@whiskeysockets/baileys');

const { upload } = require('./mega');

// Constants
const TEMP_DIR = './temp';
const SESSION_EXPIRY = 180000; // 3 minutes
const RETRY_DELAY = 5000; // 5 seconds
const MAX_RETRIES = 3;

// Ensure temp directory exists
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Utility functions
function removeFile(filePath) {
    if (!fs.existsSync(filePath)) return false;
    try {
        fs.rmSync(filePath, { recursive: true, force: true });
        return true;
    } catch (err) {
        console.error(`Error removing file ${filePath}:`, err);
        return false;
    }
}

function generateRandomDeviceId() {
    const prefix = "3EB";
    const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let randomText = prefix;
    for (let i = prefix.length; i < 22; i++) {
        randomText += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return randomText;
}

function sanitizeNumber(number) {
    return number.replace(/[^0-9]/g, '');
}

async function handleSessionUpload(sock, sessionId) {
    try {
        const credsPath = path.join(__dirname, TEMP_DIR, sessionId, 'creds.json');
        if (!fs.existsSync(credsPath)) {
            throw new Error('Creds file not found');
        }

        const megaUrl = await upload(fs.createReadStream(credsPath), `${sock.user.id}.json`);
        const stringSession = megaUrl.replace('https://mega.nz/file/', '');
        const sessionCode = "KSMD~" + stringSession;

        // Send session code
        const codeMsg = await sock.sendMessage(sock.user.id, { text: sessionCode });

        // Send welcome message with ad
        const welcomeMsg = `*Hey Dear👋*\n\n*Don't Share Your Session ID With Anyone*\n\n*This is <| 𝐊𝐈𝐍𝐆-𝐒𝐀𝐍𝐃𝐄𝐒𝐇-𝐌𝐃 👻*\n\n*THANKS FOR USING KING-SANDESH-MD*\n\n*CONNECT FOR UPDATES*: https://whatsapp.com/channel/0029Vb5saAU4Y9lfzhgBmS2N\n\n> ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴋɪɴɢ ꜱᴀɴᴅᴇꜱʜ ᴍᴜʟᴛɪ ᴅᴇᴠɪᴄᴇ👻\n`;
        
        await sock.sendMessage(sock.user.id, {
            text: welcomeMsg,
            contextInfo: {
                externalAdReply: {
                    title: "Professor Sandesh Bhashana",
                    thumbnailUrl: "https://files.catbox.moe/m5drmn.png",
                    sourceUrl: "https://whatsapp.com/channel/0029Vb5saAU4Y9lfzhgBmS2N",
                    mediaType: 1,
                    renderLargerThumbnail: true
                }  
            }
        }, { quoted: codeMsg });

        return true;
    } catch (error) {
        console.error('Session upload error:', error);
        const errorMsg = await sock.sendMessage(sock.user.id, { text: `Error: ${error.message}` });
        
        await sock.sendMessage(sock.user.id, {
            text: `*Don't Share with anyone this code use for deploy KANGO-XMD*\n\n ◦ *Github:* https://github.com/OfficialKango/KANGO-XMD`,
            contextInfo: {
                externalAdReply: {
                    title: "KS-MD",
                    thumbnailUrl: "https://files.catbox.moe/m5drmn.png",
                    sourceUrl: "https://whatsapp.com/channel/0029Vb5saAU4Y9lfzhgBmS2N",
                    mediaType: 2,
                    renderLargerThumbnail: true,
                    showAdAttribution: true
                }  
            }
        }, { quoted: errorMsg });
        
        return false;
    }
}

router.get('/', async (req, res) => {
    const sessionId = makeid();
    let { number } = req.query;
    
    if (!number) {
        return res.status(400).send({ error: "Number parameter is required" });
    }

    number = sanitizeNumber(number);
    const sessionDir = path.join(TEMP_DIR, sessionId);

    async function pairDevice(retryCount = 0) {
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        
        try {
            const browsers = ["Safari", "Chrome", "Firefox"];
            const randomBrowser = browsers[Math.floor(Math.random() * browsers.length)];
            
            const sock = makeWASocket({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                generateHighQualityLinkPreview: true,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                syncFullHistory: false,
                browser: Browsers.macOS(randomBrowser),
                connectTimeoutMs: 30000
            });

            sock.ev.on('creds.update', saveCreds);
            
            sock.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect } = update;
                
                if (connection === "open") {
                    console.log(`Connected to WhatsApp as ${sock.user.id}`);
                    
                    if (!sock.authState.creds.registered) {
                        await delay(1500);
                        const code = await sock.requestPairingCode(number);
                        
                        if (!res.headersSent) {
                            res.send({ code });
                        }
                    } else {
                        // Handle session upload and messaging
                        await handleSessionUpload(sock, sessionId);
                        
                        // Cleanup and close
                        await delay(1000);
                        sock.ws.close();
                        removeFile(sessionDir);
                        console.log(`👤 ${sock.user.id} Session completed`);
                        process.exit(0);
                    }
                } 
                else if (connection === "close") {
                    if (lastDisconnect?.error?.output?.statusCode !== 401) {
                        if (retryCount < MAX_RETRIES) {
                            console.log(`Reconnecting attempt ${retryCount + 1}/${MAX_RETRIES}`);
                            await delay(RETRY_DELAY);
                            pairDevice(retryCount + 1);
                        } else {
                            console.log("Max retries reached");
                            if (!res.headersSent) {
                                res.status(500).send({ error: "Connection failed after retries" });
                            }
                            removeFile(sessionDir);
                        }
                    } else {
                        console.log("Unauthorized disconnect");
                        removeFile(sessionDir);
                    }
                }
            });
            
            // Set timeout for session expiration
            setTimeout(async () => {
                if (!sock.authState.creds.registered) {
                    console.log("Session timed out");
                    sock.ws.close();
                    removeFile(sessionDir);
                    if (!res.headersSent) {
                        res.status(408).send({ error: "Session timed out" });
                    }
                }
            }, SESSION_EXPIRY);
            
        } catch (err) {
            console.error("Pairing error:", err);
            removeFile(sessionDir);
            if (!res.headersSent) {
                res.status(500).send({ error: err.message || "Pairing failed" });
            }
        }
    }

    await pairDevice();
});

module.exports = router;
