document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('secretKey');
    const saveBtn = document.getElementById('saveBtn');
    const status = document.getElementById('status');

    // Load existing key if there is one
    chrome.storage.local.get(['ytSyncSecret'], (result) => {
        if (result.ytSyncSecret) input.value = result.ytSyncSecret;
    });

    // Save key on click
    saveBtn.addEventListener('click', () => {
        const key = input.value;
        chrome.storage.local.set({ ytSyncSecret: key }, () => {
            status.innerText = 'Key saved securely!';
            setTimeout(() => status.innerText = '', 2000);
        });
    });
});