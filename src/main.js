
import './style.css';
import { gapiLoaded, gisLoaded, handleAuthClick, listBloombergEmails, getEmailDetails, markAsRead } from './gmail.js';
import { translateWithGemini } from './translate.js';

// Configuration State
const STATE = {
  clientId: localStorage.getItem('bloomberg_client_id') || '',
  geminiKey: localStorage.getItem('bloomberg_gemini_key') || '',
  nextPageToken: null,
  isLoading: false,
  emails: []
};

// DOM Elements
const app = document.getElementById('app');
const streamContainer = document.getElementById('stream-container');
const nextBtn = document.getElementById('next-btn');

// --- Settings UI ---
function showSettingsModal() {
  const overlay = document.createElement('div');
  overlay.className = 'settings-overlay';
  overlay.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0,0,0,0.8); z-index: 200;
    display: flex; justify-content: center; align-items: center;
  `;

  overlay.innerHTML = `
    <div style="background: #161b22; padding: 24px; border-radius: 12px; max-width: 90%; width: 400px; border: 1px solid #30363d;">
      <h2 style="margin-top:0">Setup (Initial)</h2>
      <p style="color:#8b949e; font-size: 14px;">Enter your API credentials to start.</p>
      
      <label style="display:block; margin-bottom:8px; font-size:12px;">Google OAuth Client ID</label>
      <input type="text" id="inp-client-id" value="${STATE.clientId}" style="width:100%; padding:8px; background:#0d1117; border:1px solid #30363d; color:white; border-radius:6px; margin-bottom:16px;">
      
      <label style="display:block; margin-bottom:8px; font-size:12px;">Gemini API Key</label>
      <input type="password" id="inp-gemini-key" value="${STATE.geminiKey}" style="width:100%; padding:8px; background:#0d1117; border:1px solid #30363d; color:white; border-radius:6px; margin-bottom:24px;">
      
      <button id="save-settings" style="width:100%; padding:10px; background:#238636; border:none; color:white; border-radius:6px; cursor:pointer;">Start App</button>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById('save-settings').onclick = () => {
    const cid = document.getElementById('inp-client-id').value.trim();
    const gkey = document.getElementById('inp-gemini-key').value.trim();

    if (cid && gkey) {
      localStorage.setItem('bloomberg_client_id', cid);
      localStorage.setItem('bloomberg_gemini_key', gkey);
      STATE.clientId = cid;
      STATE.geminiKey = gkey;
      overlay.remove();
      initApp();
    } else {
      alert("Both keys are required.");
    }
  };
}

// --- Email Processing ---
function decodeHtml(html) {
  const txt = document.createElement('textarea');
  txt.innerHTML = html;
  return txt.value;
}

function extractBody(payload) {
  let body = '';
  // Simple DFS for body
  const parts = [payload];
  while (parts.length > 0) {
    const part = parts.shift();
    if (part.mimeType === 'text/plain' && part.body.data) {
      body = atob(part.body.data.replace(/-/g, '+').replace(/_/g, '/'));
      break;
    } else if (part.mimeType === 'text/html' && part.body.data) {
      // Prefer text plain if available, but html works
      const html = atob(part.body.data.replace(/-/g, '+').replace(/_/g, '/'));
      // Strip tags for summary/translation source
      body = html.replace(/<[^>]*>?/gm, '');
    }

    if (part.parts) {
      parts.push(...part.parts);
    }
  }
  return body || payload.snippet; // Fallback to snippet
}

function getHeader(headers, name) {
  const h = headers.find(x => x.name === name);
  return h ? h.value : '';
}

async function renderEmail(msgDetails) {
  const subject = getHeader(msgDetails.payload.headers, 'Subject');
  const from = getHeader(msgDetails.payload.headers, 'From');
  const date = new Date(parseInt(msgDetails.internalDate));
  const isUnread = msgDetails.labelIds.includes('UNREAD');
  const bodyText = extractBody(msgDetails.payload);

  // Card Container
  const card = document.createElement('div');
  card.className = `email-card ${isUnread ? 'unread' : ''}`;
  card.id = `card-${msgDetails.id}`;

  // Initial Loading UI
  card.innerHTML = `
    <div class="card-meta">
      <span>${date.toLocaleDateString()} ${date.toLocaleTimeString()}</span>
      <span>${from.split('<')[0]}</span>
    </div>
    <div class="card-title">${subject}</div>
    <div class="card-body translating-state" style="color:#8b949e; font-style:italic;">
      Running Gemini Translation...
    </div>
    <div class="original-text">${bodyText.substring(0, 500)}... (Original)</div>
    <div class="card-actions">
       <button class="btn-text toggle-original">Show Original</button>
       ${isUnread ? `<button class="btn-text mark-read" data-id="${msgDetails.id}">Mark as Read</button>` : ''}
    </div>
  `;

  streamContainer.appendChild(card); // Append immediately to show skeleton

  // Trigger Translation
  // Limit text length for translation to avoid token limits for minimal cost/latency
  const textToTranslate = bodyText.substring(0, 2000);
  const translation = await translateWithGemini(textToTranslate, STATE.geminiKey);

  // Update UI with translation
  const bodyEl = card.querySelector('.card-body');
  bodyEl.classList.remove('translating-state');
  bodyEl.style.color = 'var(--text-primary)';
  bodyEl.style.fontStyle = 'normal';
  bodyEl.textContent = translation;

  // Event Listeners
  const toggleBtn = card.querySelector('.toggle-original');
  toggleBtn.onclick = () => {
    const orig = card.querySelector('.original-text');
    orig.classList.toggle('visible');
    toggleBtn.textContent = orig.classList.contains('visible') ? 'Hide Original' : 'Show Original';
  };

  const readBtn = card.querySelector('.mark-read');
  if (readBtn) {
    readBtn.onclick = async (e) => {
      e.stopPropagation();
      const success = await markAsRead(msgDetails.id);
      if (success) {
        card.classList.remove('unread');
        readBtn.remove();
      }
    };
  }
}

async function loadEmails() {
  if (STATE.isLoading) return;
  STATE.isLoading = true;

  const loadingEl = document.querySelector('.loading-state');
  if (loadingEl) loadingEl.textContent = 'Loading emails...';

  try {
    const listResp = await listBloombergEmails(STATE.nextPageToken);
    if (listResp && listResp.messages) {
      STATE.nextPageToken = listResp.nextPageToken;

      // Fetch details in parallel? Sequential for stability first.
      // 30 emails is small, but maybe batch 3 at a time.
      for (const msg of listResp.messages) {
        const details = await getEmailDetails(msg.id);
        if (details) await renderEmail(details);
      }
    } else {
      if (document.querySelectorAll('.email-card').length === 0) {
        loadingEl.textContent = "No Bloomberg emails found.";
      }
    }
  } catch (e) {
    console.error(e);
    if (loadingEl) loadingEl.textContent = "Error loading emails.";
  } finally {
    STATE.isLoading = false;
    if (loadingEl && document.querySelectorAll('.email-card').length > 0) loadingEl.remove();
  }
}

// --- Initialization ---
function waitForGlobal(name, timeout = 10000) {
  return new Promise((resolve, reject) => {
    if (window[name]) return resolve();
    const interval = setInterval(() => {
      if (window[name]) {
        clearInterval(interval);
        resolve();
      }
    }, 100);
    setTimeout(() => {
      clearInterval(interval);
      reject(`Timeout waiting for ${name}`);
    }, timeout);
  });
}

async function initApp() {
  // Inject Scripts logic
  window.handleGoogleAuth = () => {
    handleAuthClick(async () => {
      document.getElementById('auth-status').textContent = 'Connected';
      await loadEmails();
    });
  };

  try {
    const authStatus = document.getElementById('auth-status');
    authStatus.textContent = "Loading scripts...";

    await waitForGlobal('gapi');
    await waitForGlobal('google');

    gapiLoaded();
    gisLoaded(STATE.clientId);

    authStatus.textContent = "";
    // Connect Google button
    const btn = document.createElement('button');
    btn.textContent = 'Sign In';
    btn.className = 'btn-text';
    btn.onclick = window.handleGoogleAuth;
    authStatus.appendChild(btn);
  } catch (e) {
    console.error(e);
    alert("Error loading Google Scripts. Check connection.");
  }
}

// Main logic
if (!STATE.clientId || !STATE.geminiKey) {
  showSettingsModal();
} else {
  initApp();
}

// Page Down Logic
nextBtn.onclick = () => {
  window.scrollBy({
    top: window.innerHeight * 0.8,
    behavior: 'smooth'
  });

  // Check if near bottom to load more
  if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 500) {
    loadEmails();
  }
};

window.addEventListener('keydown', (e) => {
  if (e.key === ' ' || e.key === 'PageDown') {
    e.preventDefault();
    nextBtn.click();
  }
});
