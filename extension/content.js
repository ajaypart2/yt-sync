const BACKEND_URL = 'https://yt-sync-bc7s.onrender.com/api/progress';

// State management to prevent infinite loops on the same video
let currentVideoId = '';
let hasSeeked = false;

// Helper: Extract video ID
function getVideoId() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('v');
}

// Helper: Extract clean title
function getVideoTitle() {
    const titleElement = document.querySelector('h1.ytd-watch-metadata yt-formatted-string');
    return titleElement ? titleElement.textContent : document.title;
}

// 1. SAVE PROGRESS to backend
function syncTimestamp(videoElement) {
    const videoId = getVideoId();
    if (!videoId) return;

    // Get the secret key from Chrome Storage
    chrome.storage.local.get(['ytSyncSecret'], (result) => {
        const secret = result.ytSyncSecret;

        if (!secret) {
            console.warn('YT Sync: No API key set. Click the extension icon to set it.');
            return;
        }

        const payload = {
            videoId: videoId,
            title: getVideoTitle(),
            timestamp: videoElement.currentTime
        };

        fetch(BACKEND_URL, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': secret // Attach the secret here!
            },
            body: JSON.stringify(payload)
        }).catch(err => console.error('YT Sync Error:', err));
    });
}

// 2. FETCH PROGRESS from backend and jump to time
function applySavedTimestamp(videoElement, videoId) {
    if (hasSeeked) return;

    chrome.storage.local.get(['ytSyncSecret'], async (result) => {
        const secret = result.ytSyncSecret;
        if (!secret) {
            console.warn('YT Sync: No API key found in storage.');
            return;
        }

        try {
            const response = await fetch(`${BACKEND_URL}/${videoId}`, {
                method: 'GET',
                headers: { 
                    'Authorization': secret // Must match API_SECRET exactly
                }
            });
            
            if (response.status === 401) {
                console.error('YT Sync: Server rejected key. Update it in the extension popup.');
                return;
            }

            const resultData = await response.json();

            if (resultData.success && resultData.data.timestamp > 5) {
                console.log(`YT Sync: Resuming at ${resultData.data.timestamp}s`);
                videoElement.currentTime = resultData.data.timestamp;
            }
        } catch (err) {
            console.log('YT Sync: Error hitting API or server is offline.');
        } finally {
            hasSeeked = true; 
        }
    });
}

// MAIN INITIALIZER
function initTracker() {
    const videoId = getVideoId();
    if (!videoId) return;

    // If it's a new video, reset our state
    if (videoId !== currentVideoId) {
        currentVideoId = videoId;
        hasSeeked = false;
    }

    // Find the video element
    const checkInterval = setInterval(() => {
        const videoElement = document.querySelector('video');
        
        if (videoElement && videoElement.readyState > 0) {
            clearInterval(checkInterval);
            console.log('YT Sync: Tracking initialized.');

            // Try to apply the saved timestamp
            applySavedTimestamp(videoElement, videoId);

            // Set up our save triggers
            videoElement.addEventListener('pause', () => syncTimestamp(videoElement));
            window.addEventListener('beforeunload', () => syncTimestamp(videoElement));
        }
    }, 500);
}

// Listen to YouTube's custom navigation event (handles the SPA routing)
document.addEventListener('yt-navigate-finish', initTracker);

// Fallback for the very first page load if you go directly to a URL
setTimeout(initTracker, 1000);

// Add this new function to create the UI prompt
function injectSavePrompt(videoElement, videoId) {
    // Remove existing prompt if it exists
    const existingPrompt = document.getElementById('yt-sync-prompt');
    if (existingPrompt) existingPrompt.remove();

    // Create a floating button
    const promptDiv = document.createElement('div');
    promptDiv.id = 'yt-sync-prompt';
    promptDiv.style.cssText = `
        position: fixed;
        bottom: 80px;
        right: 20px;
        background: #ff0000;
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        font-family: Arial, sans-serif;
        font-weight: bold;
        cursor: pointer;
        z-index: 9999;
        box-shadow: 0 4px 6px rgba(0,0,0,0.3);
        transition: transform 0.2s;
    `;
    promptDiv.innerText = 'Track this video?';

    // When clicked, start tracking and hide the button
    promptDiv.addEventListener('click', () => {
        promptDiv.innerText = 'Tracking...';
        setTimeout(() => promptDiv.remove(), 1000);
        
        // Setup the event listeners only AFTER clicking
        videoElement.addEventListener('pause', () => syncTimestamp(videoElement));
        window.addEventListener('beforeunload', () => syncTimestamp(videoElement));
        
        // Do an initial sync right away
        syncTimestamp(videoElement);
    });

    promptDiv.addEventListener('click', () => {
        promptDiv.innerText = 'Tracking...';
        setTimeout(() => promptDiv.remove(), 1000);
        
        // 1. Sync on pause
        videoElement.addEventListener('pause', () => syncTimestamp(videoElement));
        
        // 2. Sync on tab close (now protected by keepalive)
        window.addEventListener('beforeunload', () => syncTimestamp(videoElement));
        
        // 3. THE SAFETY NET: Sync every 10 seconds while playing
        setInterval(() => {
            if (!videoElement.paused) {
                syncTimestamp(videoElement);
            }
        }, 10000);
        
        // Do an initial sync right away
        syncTimestamp(videoElement);
    });

    document.body.appendChild(promptDiv);
}

// Update your main initializer to call this instead of auto-tracking
function initTracker() {
    const videoId = getVideoId();
    if (!videoId) return;

    if (videoId !== currentVideoId) {
        currentVideoId = videoId;
        hasSeeked = false;
    }

    const checkInterval = setInterval(() => {
        const videoElement = document.querySelector('video');
        if (videoElement && videoElement.readyState > 0) {
            clearInterval(checkInterval);
            
            // 1. Still apply saved timestamp if we have one
            applySavedTimestamp(videoElement, videoId);
            
            // 2. Ask the user if they want to track THIS session
            injectSavePrompt(videoElement, videoId);
        }
    }, 500);
}