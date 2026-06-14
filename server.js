const express = require('express');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-very-secure-jwt-secret';

app.use(cors({ origin: '*', allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

mongoose.connect(process.env.MONGO_URI || 'mongodb+srv://akhambhayta:512001@yt-sync-app.9vlqyyl.mongodb.net/')
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB error:', err));

// --- 1. NEW SCHEMAS ---
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
    lastUpdated: { type: Date, default: Date.now }
});
// Ensure a user can only have one record per video
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
    const { videoId, title, timestamp } = req.body;
    const userId = req.user.userId;

    try {
        // 1. Upsert the video for THIS specific user
        await YtWatchHistory.findOneAndUpdate(
            { userId, videoId },
            { title, timestamp, lastUpdated: new Date() },
            { upsert: true, new: true }
        );

        // 2. Enforce the 30-video limit
        const count = await YtWatchHistory.countDocuments({ userId });
        if (count > 30) {
            // Find the oldest videos beyond the 30 limit
            const overage = count - 30;
            const oldestVideos = await YtWatchHistory.find({ userId })
                .sort({ lastUpdated: 1 }) // Ascending (oldest first)
                .limit(overage);
            
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

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));