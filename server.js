const express = require('express');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const https = require('https');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-very-secure-jwt-secret';

app.use(cors({ origin: '*', allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

mongoose.connect(process.env.MONGO_URI || 'mongodb+srv://akhambhayta:512001@yt-sync-app.9vlqyyl.mongodb.net/')
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB error:', err));

// --- 1. SCHEMAS ---
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true }
});
const User = mongoose.model('User', userSchema);

const YtWatchHistorySchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    videoId: { type: String, required: true },
    title: { type: String, default: 'Unknown Video' },
    timestamp: { type: Number, required: true },
    isManual: { type: Boolean, default: false },
    lastUpdated: { type: Date, default: Date.now }
});
YtWatchHistorySchema.index({ userId: 1, videoId: 1 }, { unique: true });
const YtWatchHistory = mongoose.model('YtWatchHistory', YtWatchHistorySchema);

// --- 2. AUTH ROUTES (Public) ---
app.post('/api/auth/register', async (req, res) => {
    const { username, password } = req.body;
    try {
        const existingUser = await User.findOne({ username });
        if (existingUser) return res.status(400).json({ error: 'Username taken' });

        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);
        
        const user = await User.create({ username, passwordHash });
        res.json({ success: true, message: 'User registered successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await User.findOne({ username });
        if (!user) return res.status(401).json({ error: 'Invalid credentials' });

        const isMatch = await bcrypt.compare(password, user.passwordHash);
        if (!isMatch) return res.status(401).json({ error: 'Invalid credentials' });

        const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '30d' });
        res.json({ success: true, token });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// --- 3. JWT AUTH MIDDLEWARE ---
app.use('/api/progress', (req, res, next) => {
    if (req.method === 'OPTIONS') return next();
    
    const token = req.headers['authorization'];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded; // Attach the userId to the request
        next();
    } catch (err) {
        res.status(401).json({ error: 'Invalid token' });
    }
});

// --- 4. SECURE API ENDPOINTS ---

// Save Progress WITH 30-Video Limit Enforcement
app.post('/api/progress', async (req, res) => {
    let { videoId, title, timestamp } = req.body;
    const userId = req.user.userId;
    let isManual = false;

    try {
        // If it came from the manual dashboard input, fetch the real title!
        if (title === "Added via Mobile Share" || !title) {
            isManual = true; // Flag it so the UI knows to show the tag
            try {
                const oembedRes = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
                if (oembedRes.ok) {
                    const oembedData = await oembedRes.json();
                    title = oembedData.title; // Get the real title
                } else {
                    title = "YouTube Video"; // Fallback
                }
            } catch (e) {
                title = "YouTube Video";
            }
        }

        // Save to database
        await YtWatchHistory.findOneAndUpdate(
            { userId, videoId },
            { title, timestamp, isManual, lastUpdated: new Date() },
            { upsert: true, new: true }
        );

        // Enforce 30-video limit
        const count = await YtWatchHistory.countDocuments({ userId });
        if (count > 30) {
            const overage = count - 30;
            const oldestVideos = await YtWatchHistory.find({ userId }).sort({ lastUpdated: 1 }).limit(overage);
            const idsToDelete = oldestVideos.map(v => v._id);
            await YtWatchHistory.deleteMany({ _id: { $in: idsToDelete } });
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Database error' });
    }
});

// Get User's History
app.get('/api/progress/history', async (req, res) => {
    try {
        const history = await YtWatchHistory.find({ userId: req.user.userId }).sort({ lastUpdated: -1 });
        res.json({ success: true, data: history });
    } catch (err) {
        res.status(500).json({ error: 'Database error' });
    }
});

// Get Specific Video
app.get('/api/progress/:videoId', async (req, res) => {
    try {
        const record = await YtWatchHistory.findOne({ userId: req.user.userId, videoId: req.params.videoId });
        if (record) res.json({ success: true, data: record });
        else res.status(404).json({ success: false });
    } catch (err) {
        res.status(500).json({ error: 'Database error' });
    }
});

// Delete Specific Video
app.delete('/api/progress/:videoId', async (req, res) => {
    try {
        await YtWatchHistory.findOneAndDelete({ userId: req.user.userId, videoId: req.params.videoId });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Database error' });
    }
});

// --- 5. IN-MEMORY ROOM & FILE STORE (NO DATABASE) ---
// Key: roomId -> { content: string, updatedAt: number, lastAccessed: number, files: Map<fileId, FileObj> }
const sharedRooms = new Map();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 } // 25MB limit per file
});

function getOrCreateRoom(roomId) {
    let room = sharedRooms.get(roomId);
    if (!room) {
        room = {
            content: '',
            updatedAt: null,
            lastAccessed: Date.now(),
            files: new Map()
        };
        sharedRooms.set(roomId, room);
    }
    if (!room.files) room.files = new Map();
    return room;
}

// Periodic cleanup: delete files older than 30 minutes, and rooms inactive for > 24 hours
setInterval(() => {
    const now = Date.now();
    const THIRTY_MINUTES = 30 * 60 * 1000;
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

    for (const [roomId, room] of sharedRooms.entries()) {
        // 1. Purge expired files (30-min TTL)
        if (room.files && room.files.size > 0) {
            for (const [fileId, file] of room.files.entries()) {
                if (now - file.uploadedAt > THIRTY_MINUTES) {
                    file.buffer = null; // Explicitly drop buffer memory
                    room.files.delete(fileId);
                }
            }
        }

        // 2. Purge stale rooms
        if (now - room.lastAccessed > TWENTY_FOUR_HOURS && (!room.files || room.files.size === 0)) {
            sharedRooms.delete(roomId);
        }
    }
}, 5 * 60 * 1000); // Check every 5 minutes

const ROOM_SECRET_SALT = 'yt-sync-room-enc-key-v1';

function decryptRoom(token) {
    if (!token || typeof token !== 'string') return '';
    try {
        const buf = Buffer.from(token, 'base64url');
        if (buf.length < 5) return '';
        const saltBytes = [buf[0], buf[1], buf[2], buf[3]];
        const encBytes = buf.subarray(4);
        const decBytes = [];
        for (let i = 0; i < encBytes.length; i++) {
            const k = ROOM_SECRET_SALT.charCodeAt(i % ROOM_SECRET_SALT.length) ^ saltBytes[i % 4] ^ ((i * 37) & 0xFF);
            decBytes.push(encBytes[i] ^ k);
        }
        const check = decBytes.pop();
        let calcCheck = 0x5A;
        for (let b of decBytes) calcCheck ^= b;
        if (check !== calcCheck) return '';
        return Buffer.from(decBytes).toString('utf8');
    } catch (e) {
        return '';
    }
}

function resolveRoomId(input) {
    if (!input) return 'default';
    const decrypted = decryptRoom(input);
    const target = decrypted || input;
    return String(target).trim().toLowerCase().slice(0, 32).replace(/[^a-z0-9_-]/g, '') || 'default';
}

function getRoomFilesList(room) {
    if (!room || !room.files) return [];
    const now = Date.now();
    const filesList = [];
    for (const [fileId, file] of room.files.entries()) {
        // Exclude expired
        if (now - file.uploadedAt > 30 * 60 * 1000) {
            room.files.delete(fileId);
            continue;
        }
        filesList.push({
            id: file.id,
            name: file.originalName,
            size: file.size,
            mimeType: file.mimeType,
            uploadedAt: file.uploadedAt,
            expiresAt: file.uploadedAt + (30 * 60 * 1000)
        });
    }
    return filesList;
}

// Get Room Content & Files
app.get('/api/rooms/:roomId', (req, res) => {
    const roomId = resolveRoomId(req.params.roomId);
    const room = sharedRooms.get(roomId);
    if (!room) {
        return res.json({ success: true, content: '', updatedAt: null, files: [] });
    }
    room.lastAccessed = Date.now();
    res.json({
        success: true,
        content: room.content,
        updatedAt: room.updatedAt,
        files: getRoomFilesList(room)
    });
});

// Update Room Text Content
app.post('/api/rooms/:roomId', (req, res) => {
    const roomId = resolveRoomId(req.params.roomId);
    const content = typeof req.body.content === 'string' ? req.body.content : '';
    const now = Date.now();

    const room = getOrCreateRoom(roomId);
    room.content = content;
    room.updatedAt = now;
    room.lastAccessed = now;

    res.json({ success: true, updatedAt: now });
});

// Clear Room Content (Text & Files)
app.delete('/api/rooms/:roomId', (req, res) => {
    const roomId = resolveRoomId(req.params.roomId);
    if (sharedRooms.has(roomId)) {
        const room = sharedRooms.get(roomId);
        room.content = '';
        room.updatedAt = Date.now();
        room.lastAccessed = Date.now();
        if (room.files) {
            for (const file of room.files.values()) {
                file.buffer = null; // Explicitly clear buffer from RAM
            }
            room.files.clear();
        }
    }
    res.json({ success: true });
});

// Upload File to Room (In-Memory, 30-min TTL)
app.post('/api/rooms/:roomId/files', upload.single('file'), (req, res) => {
    const roomId = resolveRoomId(req.params.roomId);
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const room = getOrCreateRoom(roomId);
    const fileId = Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
    const now = Date.now();

    const fileObj = {
        id: fileId,
        originalName: req.file.originalname || 'file',
        mimeType: req.file.mimetype || 'application/octet-stream',
        size: req.file.size,
        buffer: req.file.buffer,
        uploadedAt: now
    };

    room.files.set(fileId, fileObj);
    room.lastAccessed = now;

    res.json({
        success: true,
        file: {
            id: fileObj.id,
            name: fileObj.originalName,
            size: fileObj.size,
            mimeType: fileObj.mimeType,
            uploadedAt: fileObj.uploadedAt,
            expiresAt: fileObj.uploadedAt + (30 * 60 * 1000)
        }
    });
});

// Get Room Files List
app.get('/api/rooms/:roomId/files', (req, res) => {
    const roomId = resolveRoomId(req.params.roomId);
    const room = sharedRooms.get(roomId);
    res.json({ success: true, files: getRoomFilesList(room) });
});

// Download File from Room
app.get('/api/rooms/:roomId/files/:fileId', (req, res) => {
    const roomId = resolveRoomId(req.params.roomId);
    const room = sharedRooms.get(roomId);
    if (!room || !room.files || !room.files.has(req.params.fileId)) {
        return res.status(404).send('File not found or expired (30m limit)');
    }

    const file = room.files.get(req.params.fileId);
    if (Date.now() - file.uploadedAt > 30 * 60 * 1000) {
        room.files.delete(req.params.fileId);
        return res.status(404).send('File has expired');
    }

    room.lastAccessed = Date.now();
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.originalName)}"`);
    res.setHeader('Content-Length', file.size);
    res.send(file.buffer);
});

// Delete Specific File from Room
app.delete('/api/rooms/:roomId/files/:fileId', (req, res) => {
    const roomId = resolveRoomId(req.params.roomId);
    const room = sharedRooms.get(roomId);
    if (room && room.files && room.files.has(req.params.fileId)) {
        const file = room.files.get(req.params.fileId);
        file.buffer = null; // Explicitly drop buffer memory
        room.files.delete(req.params.fileId);
    }
    res.json({ success: true });
});

// Backwards-compatible /api/note (stored in-memory, no DB)
app.get('/api/note', (req, res) => {
    const room = sharedRooms.get('default') || { content: '', updatedAt: null };
    res.json({ success: true, data: { content: room.content, updatedAt: room.updatedAt } });
});

app.post('/api/note', (req, res) => {
    const content = typeof req.body.content === 'string' ? req.body.content : '';
    const now = Date.now();
    sharedRooms.set('default', { content, updatedAt: now, lastAccessed: now });
    res.json({ success: true });
});

app.delete('/api/note', (req, res) => {
    sharedRooms.set('default', { content: '', updatedAt: Date.now(), lastAccessed: Date.now() });
    res.json({ success: true });
});

// Download the extension from GitHub
app.get('/api/download-extension', (req, res) => {
    const githubZipUrl = 'https://raw.githubusercontent.com/ajaypart2/yt-sync/main/extension.zip';

    https.get(githubZipUrl, (githubRes) => {
        if (githubRes.statusCode !== 200) {
            console.error(`GitHub returned status code: ${githubRes.statusCode}`);
            return res.status(404).send('File not found');
        }
        res.setHeader('Content-Disposition', 'attachment; filename="yt-sync-extension.zip"');
        res.setHeader('Content-Type', 'application/zip');

        githubRes.pipe(res);
    }).on('error', (err) => {
        console.error('Error fetching file from GitHub:', err.message);
        res.status(500).send('Server error while downloading file');
    });
});

app.get(['/note', '/note/:roomId'], (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'note.html'));
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));