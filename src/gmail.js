
const GMAIL_API_DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest';
const SCOPES = 'https://www.googleapis.com/auth/gmail.modify';

let tokenClient;
let gapiInited = false;
let gisInited = false;
let userCallback = null;

// Initialize gapi
export async function gapiLoaded() {
    await gapi.client.init({
        discoveryDocs: [GMAIL_API_DISCOVERY_DOC],
    });
    gapiInited = true;

    // Restore token if exists
    const savedToken = localStorage.getItem('gmail_access_token');
    if (savedToken) {
        gapi.client.setToken(JSON.parse(savedToken));
    }

    checkAuth();
}

// Initialize GIS
export function gisLoaded(clientId, scope = SCOPES) {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: scope,
        callback: async (resp) => {
            if (resp.error !== undefined) {
                console.error('Token error:', resp.error);
                showSignInButton();
                return;
            }
            // Save token to localStorage
            localStorage.setItem('gmail_access_token', JSON.stringify(resp));
            if (userCallback) userCallback();
        },
        error_callback: (err) => {
            // Silent refresh failed (e.g. popup blocked, session expired)
            console.log('Silent auth failed, showing Sign In button');
            showSignInButton();
        },
    });
    gisInited = true;
    checkAuth();
}

function checkAuth() {
    // Can trigger initial UI update here
}

function showSignInButton() {
    const s = document.getElementById('auth-status');
    if (s && !s.querySelector('button')) {
        s.textContent = '';
        const b = document.createElement('button');
        b.textContent = 'Sign In';
        b.className = 'btn-text';
        b.onclick = () => {
            tokenClient.requestAccessToken({ prompt: 'consent' });
        };
        s.appendChild(b);
    }
}

export async function handleAuthClick(callback) {
    userCallback = callback;
    const token = gapi.client.getToken();
    if (token !== null) {
        // Verify token is still valid with a lightweight API call
        try {
            await gapi.client.gmail.users.getProfile({ userId: 'me' });
            // Token is valid – skip OAuth popup
            if (userCallback) userCallback();
        } catch (e) {
            // Token expired – clear and re-authenticate
            console.log('Saved token expired, re-authenticating...');
            gapi.client.setToken(null);
            localStorage.removeItem('gmail_access_token');
            tokenClient.requestAccessToken({ prompt: '' });
        }
    } else {
        // No token – request one (may show account chooser)
        tokenClient.requestAccessToken({ prompt: '' });
    }
}

export async function listBloombergEmails(pageToken = null) {
    try {
        const response = await gapi.client.gmail.users.messages.list({
            'userId': 'me',
            'q': 'from:bloomberg.com is:unread newer_than:2d',
            'maxResults': 100,
            'pageToken': pageToken
        });
        return response.result;
    } catch (err) {
        console.error('Execute error', err);
        return null;
    }
}

export async function getEmailDetails(messageId) {
    try {
        const response = await gapi.client.gmail.users.messages.get({
            'userId': 'me',
            'id': messageId,
            'format': 'full'
        });
        return response.result;
    } catch (err) {
        console.error('Get details error', err);
        return null;
    }
}

export async function markAsRead(messageId) {
    try {
        await gapi.client.gmail.users.messages.modify({
            'userId': 'me',
            'id': messageId,
            'resource': {
                'removeLabelIds': ['UNREAD']
            }
        });
        return true;
    } catch (err) {
        console.error('Mark read error', err);
        return false;
    }
}

export async function batchMarkAsRead(messageIds) {
    try {
        await gapi.client.gmail.users.messages.batchModify({
            'userId': 'me',
            'resource': {
                'ids': messageIds,
                'removeLabelIds': ['UNREAD']
            }
        });
        return true;
    } catch (err) {
        console.error('Batch mark read error', err);
        return false;
    }
}
