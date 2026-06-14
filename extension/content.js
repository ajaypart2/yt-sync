const BACKEND_URL = 'https://yt-sync-bc7s.onrender.com/api/progress';

//const BACKEND_URL = 'http://localhost:3000/api/progress';

let currentVideoId = '';
let hasSeeked = false;
let trackingInterval = null; // Keeps track of the 10-second loop

function getVideoId() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('v');
}

function getVideoTitle() {
    const titleElement = document.querySelector('h1.ytd-watch-metadata yt-formatted-string');
    return titleElement ? titleElement.textContent : document.title;
}

// 1. Core Sync Function (Handles Pause & 10s Interval)
function syncTimestamp(videoElement) {
    const videoId = getVideoId();
    if (!videoId) return;

    chrome.storage.local.get(['ytSyncSecret'], (result) => {
        const token = result.ytSyncSecret;
        if (!token) {
            console.warn('YT Sync: No auth token found. Please log in via the extension popup.');
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
                'Authorization': token 
            },
            body: JSON.stringify(payload)
        })
        .then(async res => {
            if (!res.ok) {
                // If the server rejects it, read the error message
                const errData = await res.json();
                console.error('YT Sync Rejected:', errData.error);
                
                if (res.status === 401) {
                    alert('YT Sync: Your session expired or is invalid. Please click the extension icon to log in.');
                }
            } else {
                console.log('YT Sync: Saved successfully!');
            }
        })
        .catch(err => console.error('YT Sync Network Error:', err));
    });
}

// 2. Fetch Progress on Load
async function applySavedTimestamp(videoElement, videoId) {
    if (hasSeeked) return;

    chrome.storage.local.get(['ytSyncSecret'], async (result) => {
        const token = result.ytSyncSecret;
        if (!token) return;

        try {
            const response = await fetch(`${BACKEND_URL}/${videoId}`, {
                method: 'GET',
                headers: { 'Authorization': token }
            });
            
            if (response.status === 401) {
                console.error('YT Sync: Session expired or invalid token.');
                return;
            }

            const resultData = await response.json();

            if (resultData.success && resultData.data && resultData.data.timestamp > 5) {
                videoElement.currentTime = resultData.data.timestamp;
            }
        } catch (err) {
            console.log('YT Sync: No history found for this video.');
        } finally {
            hasSeeked = true; 
        }
    });
}

// 3. The UI Prompt
function injectSavePrompt(videoElement, videoId) {
    // Remove old prompt and clear old intervals if navigating to a new video
    const existingPrompt = document.getElementById('yt-sync-prompt');
    if (existingPrompt) existingPrompt.remove();
    if (trackingInterval) clearInterval(trackingInterval);

    const promptDiv = document.createElement('div');
    promptDiv.id = 'yt-sync-prompt';
    promptDiv.style.cssText = `
        position: fixed;
        bottom: 80px;
        right: 20px;
        background: #0066cc; /* Changed to blue to match your new UI */
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        font-family: Arial, sans-serif;
        font-weight: bold;
        cursor: pointer;
        z-index: 999999; /* Extremely high to prevent YT from hiding it */
        box-shadow: 0 4px 10px rgba(0,0,0,0.5);
        transition: transform 0.2s;
    `;
    promptDiv.innerText = 'Track this video?';

    promptDiv.addEventListener('click', () => {
        promptDiv.innerText = 'Tracking Active!';
        promptDiv.style.background = '#008000'; // Turns green on click
        setTimeout(() => promptDiv.remove(), 1500);
        
        // A. Sync immediately
        syncTimestamp(videoElement);

        // B. Sync on pause
        videoElement.addEventListener('pause', () => syncTimestamp(videoElement));
        
        // C. The 10-Second Safety Net
        trackingInterval = setInterval(() => {
            if (!videoElement.paused) {
                syncTimestamp(videoElement);
            }
        }, 10000);
    });

    document.body.appendChild(promptDiv);
}

// 4. Main Initializer
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
            applySavedTimestamp(videoElement, videoId);
            injectSavePrompt(videoElement, videoId);
        }
    }, 500);
}

// 5. YouTube SPA Event Listeners
document.addEventListener('yt-navigate-finish', initTracker);
setTimeout(initTracker, 1000);