
import './style.css';
import { gapiLoaded, gisLoaded, handleAuthClick, listBloombergEmails, getEmailDetails, markAsRead, batchMarkAsRead } from './gmail.js';
import { CookieBridge } from './cookie-bridge.js';

// Configuration State
const STATE = {
  clientId: localStorage.getItem('bloomberg_client_id') || '',
  gasUrl: localStorage.getItem('logiris_gas_url') || '',
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
      <h2 style="margin-top:0">Setup</h2>
      <p style="color:#8b949e; font-size: 14px;">Enter your OAuth Client ID.</p>
      
      <label style="display:block; margin-bottom:8px; font-size:12px;">Google OAuth Client ID</label>
      <input type="text" id="inp-client-id" value="${STATE.clientId}" style="width:100%; padding:8px; background:#0d1117; border:1px solid #30363d; color:white; border-radius:6px; margin-bottom:24px;">
      
      <button id="save-settings" style="width:100%; padding:10px; background:#238636; border:none; color:white; border-radius:6px; cursor:pointer;">Save & Start</button>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById('save-settings').onclick = () => {
    const cid = document.getElementById('inp-client-id').value.trim();
    if (cid) {
      localStorage.setItem('bloomberg_client_id', cid);
      STATE.clientId = cid;
      overlay.remove();
      initApp();
    } else {
      alert("Client ID is required.");
    }
  };
}

// --- Email Processing ---
function decodeUrlSafeBase64(data) {
  if (!data) return '';
  const customAtob = (str) => {
    try {
      return decodeURIComponent(escape(window.atob(str)));
    } catch (e) {
      console.warn("Base64 Decode Error", e);
      return window.atob(str);
    }
  };
  return customAtob(data.replace(/-/g, '+').replace(/_/g, '/'));
}

function extractBodyData(payload) {
  let textBody = '';
  let htmlBody = '';

  const traverse = (nodes) => {
    for (const node of nodes) {
      if (node.mimeType === 'text/plain' && node.body && node.body.data) {
        textBody += decodeUrlSafeBase64(node.body.data);
      } else if (node.mimeType === 'text/html' && node.body && node.body.data) {
        htmlBody += decodeUrlSafeBase64(node.body.data);
      } else if (node.parts) {
        traverse(node.parts);
      }
    }
  };

  if (payload.parts) {
    traverse(payload.parts);
  } else {
    // Single part
    if (payload.body && payload.body.data) {
      if (payload.mimeType === 'text/html') htmlBody = decodeUrlSafeBase64(payload.body.data);
      else textBody = decodeUrlSafeBase64(payload.body.data);
    }
  }

  // Fallback html
  if (!htmlBody && textBody) {
    htmlBody = `<pre>${textBody}</pre>`;
  }

  return { html: htmlBody || payload.snippet || "" };
}

function getHeader(headers, name) {
  if (!headers) return '';
  const h = headers.find(x => x.name === name);
  return h ? h.value : '';
}

async function renderEmail(msgDetails, index, total) {
  try {
    const subject = getHeader(msgDetails.payload.headers, 'Subject') || "No Subject";
    const from = getHeader(msgDetails.payload.headers, 'From');
    const dateStr = getHeader(msgDetails.payload.headers, 'Date') || msgDetails.internalDate;
    const date = new Date(parseInt(msgDetails.internalDate) || dateStr);
    const isUnread = msgDetails.labelIds.includes('UNREAD');

    const { html: bodyHtml } = extractBodyData(msgDetails.payload);

    const card = document.createElement('div');
    card.className = `email-card ${isUnread ? 'unread' : ''}`;
    card.id = `card-${msgDetails.id}`;

    // Add to navigation dropdown
    const nav = document.getElementById('email-nav');
    if (nav) {
      const option = document.createElement('option');
      option.value = card.id;
      const shortSubject = subject.replace(/Australia Briefing:|Briefing:|Bloomberg|Japan/gi, '').trim();
      const shortFrom = from.split('<')[0].replace(/"/g, '').trim();
      option.textContent = `${shortFrom}: ${shortSubject}`;
      nav.appendChild(option);
    }

    const counterStr = (index !== undefined && total !== undefined) ? `${index + 1}/${total}` : '';

    card.innerHTML = `
        <div class="card-meta">
          <span>${date.toLocaleDateString()} ${date.toLocaleTimeString()}</span>
          <span>${counterStr}</span>
        </div>
        <div class="card-title">${subject}</div>
        <div class="email-content-view"></div>
        <div class="card-actions">
           ${isUnread ? `<button class="btn-text mark-read" data-id="${msgDetails.id}">Mark as Read</button>` : ''}
        </div>
      `;

    const contentDiv = card.querySelector('.email-content-view');
    contentDiv.innerHTML = bodyHtml;

    // Intercept Bloomberg links for Reader Mode
    contentDiv.querySelectorAll('a').forEach(link => {
      const url = link.href;
      if (url.includes('bloomberg.com') || url.includes('bloomberg.co.jp')) {
        link.addEventListener('click', (e) => {
          e.preventDefault();
          console.log("Interception triggered for:", url);
          openReaderView(url, subject).catch(err => {
            console.error("Reader view failed to open:", err);
            alert("エラー: 記事を開けませんでした。");
          });
        });
      }
    });

    // Basic styling for content safety
    contentDiv.style.backgroundColor = '#ffffff';
    contentDiv.style.color = '#000000';
    contentDiv.style.padding = '8px';
    contentDiv.style.borderRadius = '4px';
    contentDiv.style.overflowX = 'auto';

    streamContainer.appendChild(card);

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
  } catch (e) {
    console.error(e);
  }
}

async function loadEmails() {
  if (STATE.isLoading) return;
  STATE.isLoading = true;

  const loadingEl = document.querySelector('.loading-state');
  if (loadingEl) loadingEl.textContent = 'Loading emails...';

  const nav = document.getElementById('email-nav');
  if (nav) nav.innerHTML = '<option value="">Jump to email...</option>';

  try {
    const listResp = await listBloombergEmails(STATE.nextPageToken);

    if (listResp && listResp.messages) {
      const messages = listResp.messages;
      const detailsPromises = messages.map(msg => getEmailDetails(msg.id));
      const details = await Promise.all(detailsPromises);
      const validDetails = details.filter(d => d && d.labelIds && d.labelIds.includes('UNREAD'));
      validDetails.sort((a, b) => parseInt(a.internalDate) - parseInt(b.internalDate));
      const displayEmails = validDetails.slice(0, 40);
      const total = displayEmails.length;
      for (let i = 0; i < total; i++) {
        await renderEmail(displayEmails[i], i, total);
      }
      if (total > 0) {
        addBatchReadButton(displayEmails.map(e => e.id));
      }
      if (total === 0) {
        if (loadingEl) loadingEl.textContent = "No unread Bloomberg emails found in the last 48h.";
      }
    } else {
      if (document.querySelectorAll('.email-card').length === 0) {
        if (loadingEl) loadingEl.textContent = "No Bloomberg emails found.";
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

// --- Batch Actions ---
function addBatchReadButton(messageIds) {
  const container = document.getElementById('stream-container');
  const wrapper = document.createElement('div');
  wrapper.className = 'batch-actions-wrapper';
  wrapper.style.cssText = 'padding: 40px 20px; text-align: center;';

  const btn = document.createElement('button');
  btn.className = 'btn-primary';
  btn.textContent = `Mark all ${messageIds.length} emails as read`;
  btn.onclick = async () => {
    if (confirm(`Mark all ${messageIds.length} visible emails as read?`)) {
      btn.disabled = true;
      btn.textContent = 'Processing...';
      const success = await batchMarkAsRead(messageIds);
      if (success) {
        location.reload();
      } else {
        alert('Batch update failed.');
        btn.disabled = false;
        btn.textContent = `Mark all ${messageIds.length} emails as read`;
      }
    }
  };

  wrapper.appendChild(btn);
  container.appendChild(wrapper);
}

// --- Navigation & Zoom Controls ---
function setupNavigation() {
  const nav = document.getElementById('email-nav');
  if (!nav) return;
  nav.addEventListener('change', (e) => {
    const cardId = e.target.value;
    if (cardId) {
      const target = document.getElementById(cardId);
      if (target) {
        target.scrollIntoView({ behavior: 'auto', block: 'start' });
      }
      setTimeout(() => { nav.value = ""; }, 100);
    }
  });
}

function setupZoom() {
  const zoomCtrl = document.getElementById('zoom-ctrl');
  if (!zoomCtrl) return;
  const currentZoom = getComputedStyle(document.body).getPropertyValue('--current-zoom').trim();
  if (currentZoom) {
    zoomCtrl.value = parseFloat(currentZoom).toFixed(1);
  }
  zoomCtrl.addEventListener('change', (e) => {
    const val = e.target.value;
    document.body.style.setProperty('--current-zoom', val);
  });
}

// --- Reader View Logic ---
async function openReaderView(url, title = 'Article') {
  console.log("openReaderView called for:", url);
  const readerView = document.getElementById('reader-view');
  const readerTitle = document.getElementById('reader-title');
  const readerBody = document.getElementById('reader-article-body');
  const externalBtn = document.getElementById('reader-external-btn');

  if (!readerView || !readerBody) {
    console.error("Reader view elements missing!");
    return;
  }

  // FORCE VISIBILITY FIRST
  readerTitle.textContent = title;
  readerView.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  // Initial loading state
  readerBody.innerHTML = `
    <div style="padding: 40px; text-align: center;">
      <p>Fetching full-text via Article Engine...</p>
      <div class="loading-spinner"></div>
    </div>
  `;

  externalBtn.onclick = () => window.open(url, '_blank');

  if (!STATE.gasUrl) {
    console.warn("No gasUrl configured");
    readerBody.innerHTML = `
      <div style="padding: 40px; text-align: center;">
        <p style="color: #ff7b72;">GAS Proxy URL が設定されていません。</p>
        <p style="font-size: 13px;">設定ボタン (⚙️) から GAS ウェブアプリの URL を入力してください。</p>
        <button id="reader-open-settings" class="btn-primary" style="margin-top:20px;">設定を開く</button>
      </div>
    `;
    const openSettingsBtn = document.getElementById('reader-open-settings');
    if (openSettingsBtn) {
      openSettingsBtn.onclick = () => {
        document.getElementById('pro-settings-btn').click();
        closeReaderView();
      };
    }
    return;
  }

  try {
    const cookies = CookieBridge.getSavedCookies();
    const formData = new URLSearchParams();
    formData.append('url', url);
    formData.append('cookies', cookies);

    console.log("Sending request to GAS:", STATE.gasUrl);
    const response = await fetch(STATE.gasUrl, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error(`Proxy returned status ${response.status}`);
    }

    const data = await response.json();
    console.log("Received data from GAS:", data.success ? "Success" : "Error");

    if (data.success) {
      readerBody.innerHTML = `
        <div class="article-container" style="padding: 20px; max-width: 800px; margin: 0 auto; line-height: 1.8;">
          <h1 style="font-size: 24px; margin-bottom: 24px; color: var(--text-primary);">${data.title || title}</h1>
          <div class="article-body-content" style="font-size: 18px; color: var(--text-primary);">
            ${data.body}
          </div>
        </div>
      `;
    } else {
      throw new Error(data.error || '本文の取得に失敗しました。');
    }
  } catch (err) {
    console.error('Extraction error details:', err);
    readerBody.innerHTML = `
      <div style="padding: 40px; text-align: center;">
        <p style="color: #ff7b72; font-weight: bold;">エラーが発生しました: ${err.name === 'TypeError' ? '取得に失敗しました (CORS またはネットワークエラー)' : err.message}</p>
        <p style="font-size: 11px; margin-top: 20px; word-break: break-all; opacity: 0.6;">URL: ${url}</p>
        <button id="reader-error-back" class="btn-secondary" style="margin-top: 20px;">戻る</button>
        <p style="font-size: 12px; margin-top: 10px; opacity: 0.7;">※GASのデプロイ設定が「全員(Anyone)」になっているか確認してください。</p>
      </div>
    `;
    const backBtn = document.getElementById('reader-error-back');
    if (backBtn) {
      backBtn.onclick = closeReaderView;
    }
  }
}

function closeReaderView() {
  const readerView = document.getElementById('reader-view');
  if (readerView) readerView.style.display = 'none';
  document.body.style.overflow = '';
}

function setupReaderNavigation() {
  const backBtn = document.getElementById('back-to-list-btn');
  if (backBtn) {
    backBtn.onclick = closeReaderView;
  }
}

// --- Pro Settings UI ---
function setupProSettings() {
  const proBtn = document.getElementById('pro-settings-btn');
  const proModal = document.getElementById('pro-modal');
  const closeBtn = document.getElementById('close-modal-btn');
  const saveBtn = document.getElementById('save-cookies-btn');
  const copyBtn = document.getElementById('copy-bookmarklet-btn');
  const cookieInput = document.getElementById('cookie-input');
  const gasUrlInput = document.getElementById('common-gas-url');
  const bookmarkletCode = document.getElementById('bookmarklet-code');

  if (!proBtn || !proModal) return;

  bookmarkletCode.textContent = CookieBridge.getBookmarkletCode();

  proBtn.onclick = () => {
    cookieInput.value = CookieBridge.getSavedCookies();
    gasUrlInput.value = STATE.gasUrl;
    proModal.style.display = 'flex';
  };

  closeBtn.onclick = () => { proModal.style.display = 'none'; };
  proModal.onclick = (e) => { if (e.target === proModal) proModal.style.display = 'none'; };

  copyBtn.onclick = () => {
    navigator.clipboard.writeText(CookieBridge.getBookmarkletCode());
    const originalText = copyBtn.textContent;
    copyBtn.textContent = 'Copied!';
    setTimeout(() => { copyBtn.textContent = originalText; }, 2000);
  };

  saveBtn.onclick = () => {
    CookieBridge.saveCookies(cookieInput.value);
    const newGasUrl = gasUrlInput.value.trim();
    localStorage.setItem('logiris_gas_url', newGasUrl);
    STATE.gasUrl = newGasUrl;
    alert('Settings saved!');
    proModal.style.display = 'none';
  };
}

// --- Initialization ---
function loadScript(src) {
  return new Promise((resolve, reject) => {
    console.log(`Loading script: ${src}`);
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = () => { resolve(); };
    script.onerror = () => { reject(new Error(`Failed to load script: ${src}`)); };
    document.head.appendChild(script);
  });
}

function checkDeviceType() {
  const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  if (isTouchDevice || isMobileUA) {
    document.body.classList.add('is-mobile-view');
  }
}

async function initApp() {
  checkDeviceType();
  setupNavigation();
  setupZoom();
  setupReaderNavigation();

  window.handleGoogleAuth = () => {
    handleAuthClick(async () => {
      document.getElementById('auth-status').textContent = 'Connected';
      await loadEmails();
    });
  };

  try {
    const authStatus = document.getElementById('auth-status');
    authStatus.textContent = "Initializing Google Services...";
    await loadScript('https://apis.google.com/js/api.js');
    await loadScript('https://accounts.google.com/gsi/client');
    await new Promise((resolve) => gapi.load('client', resolve));
    await gapiLoaded();
    gisLoaded(STATE.clientId);
    authStatus.textContent = "";
    const savedToken = localStorage.getItem('gmail_access_token');
    if (savedToken) {
      handleGoogleAuth();
    } else {
      const btn = document.createElement('button');
      btn.textContent = 'Sign In / Connect';
      btn.className = 'btn-text';
      btn.onclick = window.handleGoogleAuth;
      authStatus.appendChild(btn);
    }
  } catch (e) {
    console.error("Initialization Error:", e);
    const authStatus = document.getElementById('auth-status');
    authStatus.innerHTML = `<div style="color: #ff7b72; font-size: 12px; text-align: right;">Loading Error. <button onclick="location.reload()" style="background:none; border:1px solid #ff7b72; color:#ff7b72; border-radius:4px; cursor:pointer;">Retry</button></div>`;
  }
}

// Main logic
setupProSettings();
if (!STATE.clientId) {
  showSettingsModal();
} else {
  initApp();
}

// Page Down Logic
let isDragging = false;
let startY = 0;
let initialTop = 0;
const fabContainer = document.querySelector('.fab-container');

if (nextBtn) {
  nextBtn.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); return false; };

  nextBtn.onpointerdown = (e) => {
    if (!document.body.classList.contains('is-mobile-view')) { isDragging = false; return; }
    isDragging = false;
    startY = e.clientY;
    const rect = fabContainer.getBoundingClientRect();
    initialTop = rect.top;
    nextBtn.setPointerCapture(e.pointerId);
  };

  nextBtn.onpointermove = (e) => {
    const deltaY = Math.abs(e.clientY - startY);
    if (deltaY > 5) {
      isDragging = true;
      const newTop = initialTop + (e.clientY - startY);
      const boundedTop = Math.max(60, Math.min(window.innerHeight - 60, newTop));
      fabContainer.style.top = `${boundedTop}px`;
      fabContainer.style.bottom = 'auto';
      fabContainer.style.transform = 'none';
    }
  };

  nextBtn.onpointerup = (e) => {
    nextBtn.releasePointerCapture(e.pointerId);
    if (!isDragging) {
      const readerView = document.getElementById('reader-view');
      const isReaderOpen = readerView && readerView.style.display !== 'none';
      if (isReaderOpen) {
        const readerArea = document.getElementById('reader-content-area');
        readerArea.scrollBy({ top: readerArea.clientHeight * 0.9, behavior: 'auto' });
      } else {
        window.scrollBy({ top: window.innerHeight * 0.9, behavior: 'auto' });
      }
    }
  };
}

window.addEventListener('keydown', (e) => {
  if (e.key === ' ' || e.key === 'PageDown') {
    e.preventDefault();
    const readerView = document.getElementById('reader-view');
    const isReaderOpen = readerView && readerView.style.display !== 'none';
    if (isReaderOpen) {
      const readerArea = document.getElementById('reader-content-area');
      readerArea.scrollBy({ top: readerArea.clientHeight * 0.9, behavior: 'auto' });
    } else {
      window.scrollBy({ top: window.innerHeight * 0.9, behavior: 'auto' });
    }
  }
});
