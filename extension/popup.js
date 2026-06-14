const BACKEND_URL = 'https://yt-sync-bc7s.onrender.com';

//const BACKEND_URL = 'http://localhost:3000';

document.addEventListener('DOMContentLoaded', () => {
    const userIn = document.getElementById('username');
    const passIn = document.getElementById('password');
    const status = document.getElementById('status');
    const loginForm = document.getElementById('loginForm');
    const logoutBtn = document.getElementById('logoutBtn');

    // Check if already logged in
    chrome.storage.local.get(['ytSyncSecret'], (result) => {
        if (result.ytSyncSecret) {
            loginForm.style.display = 'none';
            logoutBtn.style.display = 'block';
            status.innerText = 'Logged in!';
        }
    });

    async function handleAuth(endpoint) {
        status.innerText = 'Working...';
        try {
            const res = await fetch(`${BACKEND_URL}/api/auth/${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: userIn.value, password: passIn.value })
            });
            const data = await res.json();

            if (data.token) {
                chrome.storage.local.set({ ytSyncSecret: data.token }, () => {
                    loginForm.style.display = 'none';
                    logoutBtn.style.display = 'block';
                    status.innerText = 'Success!';
                });
            } else {
                status.style.color = 'red';
                status.innerText = data.error || data.message;
            }
        } catch (err) {
            status.innerText = 'Network error.';
        }
    }

    document.getElementById('loginBtn').addEventListener('click', () => handleAuth('login'));
    document.getElementById('registerBtn').addEventListener('click', () => handleAuth('register'));
    
    logoutBtn.addEventListener('click', () => {
        chrome.storage.local.remove('ytSyncSecret', () => {
            loginForm.style.display = 'block';
            logoutBtn.style.display = 'none';
            status.innerText = 'Logged out.';
        });
    });
});