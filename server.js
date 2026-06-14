const express = require('express');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: '*',
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- AUTHENTICATION MIDDLEWARE ---
// Use an environment variable, or fallback to a hardcoded string for local testing
const API_SECRET = 'Ajay@1412001';

app.use('/api', (req, res, next) => {
    // CRITICAL FIX: Allow browser preflight (OPTIONS) requests to pass through without checking credentials
    if (req.method === 'OPTIONS') {
        return next();
    }

    const userToken = req.headers['authorization'];
    
    if (userToken !== API_SECRET) {
        console.warn(`Unauthorized request blocked. Method: ${req.method}, Path: ${req.path}`);
        return res.status(401).json({ error: 'Unauthorized. Invalid API Key.' });
    }
    next();
});

// --- MONGODB CONNECTION ---
const MONGO_URI = 'mongodb+srv://akhambhayta:512001@yt-sync-app.9vlqyyl.mongodb.net/';

mongoose.connect(MONGO_URI)
    .then(() => console.log('Connected to MongoDB successfully.'))
    .catch(err => console.error('MongoDB connection error:', err));

// --- MONGOOSE SCHEMA & MODEL ---
const watchHistorySchema = new mongoose.Schema({
    videoId: { type: String, required: true, unique: true },
    title: { type: String, default: 'Unknown Video' },
    timestamp: { type: Number, required: true },
    lastUpdated: { type: Date, default: Date.now }
});

const WatchHistory = mongoose.model('WatchHistory', watchHistorySchema);

// --- API ENDPOINTS ---

// 1. Save or Update progress (Upsert)
app.post('/api/progress', async (req, res) => {
    const { videoId, title, timestamp } = req.body;

    if (!videoId || timestamp === undefined) {
        return res.status(400).json({ error: 'Missing videoId or timestamp' });
    }

    try {
        const updatedDoc = await WatchHistory.findOneAndUpdate(
            { videoId },
            { 
                title: title || 'Unknown Video', 
                timestamp, 
                lastUpdated: new Date() 
            },
            { upsert: true, new: true }
        );
        res.json({ success: true, data: updatedDoc });
    } catch (err) {
        console.error('Error saving progress:', err.message);
        res.status(500).json({ error: 'Database error' });
    }
});

// 2. Get progress for a specific video
app.get('/api/progress/:videoId', async (req, res) => {
    const { videoId } = req.params;

    try {
        const record = await WatchHistory.findOne({ videoId });
        if (record) {
            res.json({ success: true, data: record });
        } else {
            res.status(404).json({ success: false, message: 'Video not found' });
        }
    } catch (err) {
        console.error('Error fetching video progress:', err.message);
        res.status(500).json({ error: 'Database error' });
    }
});

// 3. Get all watch history for the dashboard
app.get('/api/history', async (req, res) => {
    try {
        const history = await WatchHistory.find().sort({ lastUpdated: -1 });
        res.json({ success: true, data: history });
    } catch (err) {
        console.error('Error fetching history:', err.message);
        res.status(500).json({ error: 'Database error' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});