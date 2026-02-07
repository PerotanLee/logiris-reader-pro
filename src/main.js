
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
    if (payload.body && payload.body.data) {
      if (payload.mimeType === 'text/html') htmlBody = decodeUrlSafeBase64(payload.body.data);
      else textBody = decodeUrlSafeBase64(payload.body.data);
    }
  }

  if (!htmlBody && textBody) {
    htmlBody = `<pre>${textBody}</pre>`;
  }

  return { html: htmlBody || payload.snippet || "" };
}

function processFooterRemoval(html) {
  if (!html) return html;

  const markers = [
    "More From Bloomberg",
    "Popular on Bloomberg.com",
    "Follow us",
    "You received this message",
    "Unsubscribe",
    "ご登録いただきありがとうございます",
    "登録内容の変更"
  ];

  const lowerHtml = html.toLowerCase();
  let bestIndex = -1;

  for (const m of markers) {
    let searchPos = 0;
    const needle = m.toLowerCase();
    while (true) {
      const idx = lowerHtml.indexOf(needle, searchPos);
      if (idx === -1) break;

      // Ensure it's in the latter part of the document (last 50%)
      if (idx > lowerHtml.length * 0.5) {
        if (bestIndex === -1 || idx < bestIndex) {
          bestIndex = idx;
        }
      }
      searchPos = idx + 1;
    }
  }

  if (bestIndex !== -1) {
    const beforeMarker = html.substring(0, bestIndex);
    let containerStart = -1;
    let latestProtectedHeaderPos = -1;
    const tags = ['<h2', '<hr', '<table'];

    // Find the LATEST protected header before the marker
    for (const tag of ['<h2', '<table']) {
      let searchPosLimit = beforeMarker.length;
      while (true) {
        const tagIdx = beforeMarker.lastIndexOf(tag, searchPosLimit);
        if (tagIdx === -1) break;
        const snippet = beforeMarker.substring(tagIdx, tagIdx + 1000).toLowerCase();
        const isProtected = snippet.includes("survival tips") ||
          snippet.includes("points of return") ||
          snippet.includes("today’s points");
        if (isProtected) {
          if (tagIdx > latestProtectedHeaderPos) latestProtectedHeaderPos = tagIdx;
          break;
        }
        searchPosLimit = tagIdx - 1;
        if (searchPosLimit < 0) break;
      }
    }

    for (const tag of tags) {
      let searchIdxLimit = beforeMarker.length;
      while (true) {
        const tagIdx = beforeMarker.lastIndexOf(tag, searchIdxLimit);
        if (tagIdx === -1) break;

        // If we have a protected header, any container AFTER its start is likely content.
        if (latestProtectedHeaderPos !== -1 && tagIdx > latestProtectedHeaderPos) {
          searchIdxLimit = tagIdx - 1;
          continue;
        }

        const snippet = beforeMarker.substring(tagIdx, tagIdx + 500).toLowerCase();
        const isProtected = snippet.includes("survival tips") ||
          snippet.includes("points of return") ||
          snippet.includes("today’s points");

        if (!isProtected) {
          if (tagIdx > containerStart) containerStart = tagIdx;
          break;
        } else {
          searchIdxLimit = tagIdx - 1;
          continue;
        }
      }
    }

    if (containerStart !== -1 && containerStart > latestProtectedHeaderPos && containerStart > lowerHtml.length * 0.4) {
      html = html.substring(0, containerStart) + "</body></html>";
    } else {
      html = html.substring(0, bestIndex) + "</body></html>";
    }
  }

  return html;
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

    let { html: bodyHtml } = extractBodyData(msgDetails.payload);

    // Apply Bloomberg Footer Removal
    bodyHtml = processFooterRemoval(bodyHtml);

    const card = document.createElement('div');
    card.className = `email-card ${isUnread ? 'unread' : ''}`;
    card.id = `card-${msgDetails.id}`;
    card.setAttribute('data-subject', subject);

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

    contentDiv.style.backgroundColor = '#ffffff';
    contentDiv.style.color = '#000000';
    contentDiv.style.padding = '12px';
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

// --- Navigation & Link Interception ---
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

  // DELEGATED EVENT LISTENER for link interception
  if (streamContainer) {
    streamContainer.addEventListener('click', (e) => {
      const link = e.target.closest('a');
      if (link) {
        const url = link.href;
        if (url.includes('bloomberg.com') || url.includes('bloomberg.co.jp')) {
          e.preventDefault();
          e.stopPropagation();
          console.log("Delegated click: intercepted Bloomberg URL", url);
          const card = link.closest('.email-card');
          const subject = card ? card.getAttribute('data-subject') : 'Article';
          openReaderView(url, subject);
        }
      }
    });
  }
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
  console.log("openReaderView: displaying overlay for", url);
  const readerView = document.getElementById('reader-view');
  const readerTitle = document.getElementById('reader-title');
  const readerBody = document.getElementById('reader-article-body');
  const externalBtn = document.getElementById('reader-external-btn');

  if (!readerView || !readerBody) {
    console.error("Reader View DOM artifacts missing");
    return;
  }

  // REFRESH ANIMATION & SHOW
  readerView.style.display = 'none';
  void readerView.offsetWidth; // Trigger reflow to restart animation if needed
  readerTitle.textContent = title;
  readerView.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  readerBody.innerHTML = `
    <div style="padding: 40px; text-align: center;">
      <p>Fetching full-text via Article Engine...</p>
      <div class="loading-spinner"></div>
    </div>
  `;

  externalBtn.onclick = () => window.open(url, '_blank');

  if (!STATE.gasUrl) {
    readerBody.innerHTML = `
      <div style="padding: 40px; text-align: center;">
        <p style="color: #ff7b72;">GAS Proxy URL が設定されていません。</p>
        <p style="font-size: 13px;">設定ボタン (⚙️) から GAS ウェブアプリの URL を入力してください。</p>
        <button id="reader-open-settings" class="btn-primary" style="margin-top:20px;">設定を開く</button>
      </div>
    `;
    const sBtn = document.getElementById('reader-open-settings');
    if (sBtn) {
      sBtn.onclick = () => {
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

    const response = await fetch(STATE.gasUrl, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) throw new Error(`Proxy error: ${response.status}`);

    const data = await response.json();
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
      throw new Error(data.error || '本文の取得に失敗しました');
    }
  } catch (err) {
    console.error('Reader View error:', err);
    readerBody.innerHTML = `
      <div style="padding: 40px; text-align: center;">
        <p style="color: #ff7b72; font-weight: bold;">エラー: ${err.name === 'TypeError' ? '通信エラー (CORS またはネットワーク)' : err.message}</p>
        <p style="font-size: 10px; opacity: 0.5; margin-top: 20px; word-break: break-all;">${url}</p>
        <button id="reader-err-back" class="btn-secondary" style="margin-top:20px;">戻る</button>
      </div>
    `;
    const b = document.getElementById('reader-err-back');
    if (b) b.onclick = closeReaderView;
  }
}

function closeReaderView() {
  const v = document.getElementById('reader-view');
  if (v) v.style.display = 'none';
  document.body.style.overflow = '';
}

function setupReaderNavigation() {
  const b = document.getElementById('back-to-list-btn');
  if (b) b.onclick = closeReaderView;
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

  // Logo reload
  const logo = document.querySelector('.app-logo');
  if (logo) {
    logo.onclick = () => window.location.reload();
  }
}

// --- Initialization ---
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Load fail: ${src}`));
    document.head.appendChild(s);
  });
}

function checkDeviceType() {
  if ('ontouchstart' in window || navigator.maxTouchPoints > 0 || /Android/i.test(navigator.userAgent)) {
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
      const s = document.getElementById('auth-status');
      if (s) s.textContent = 'Connected';
      await loadEmails();
    });
  };

  try {
    const s = document.getElementById('auth-status');
    if (s) s.textContent = "Loading Services...";
    await loadScript('https://apis.google.com/js/api.js');
    await loadScript('https://accounts.google.com/gsi/client');
    await new Promise((resolve) => gapi.load('client', resolve));
    await gapiLoaded();
    gisLoaded(STATE.clientId);
    if (s) s.textContent = "";
    if (localStorage.getItem('gmail_access_token')) handleGoogleAuth();
    else if (s) {
      const b = document.createElement('button');
      b.textContent = 'Sign In';
      b.className = 'btn-text';
      b.onclick = window.handleGoogleAuth;
      s.appendChild(b);
    }
  } catch (e) {
    console.error("Init fail:", e);
  }
}

// Initialization Entry
setupProSettings();
if (!STATE.clientId) {
  showSettingsModal();
} else {
  initApp();
}

// FAB Scroll Down & Draggable
if (nextBtn) {
  let isDragging = false;
  let startY = 0;
  let dragStarted = false;
  let startPageY = 0;

  const container = nextBtn.parentElement;

  nextBtn.onpointerdown = (e) => {
    isDragging = true;
    startY = e.clientY - container.offsetTop;
    startPageY = e.clientY;
    dragStarted = false;
    nextBtn.setPointerCapture(e.pointerId);
  };

  nextBtn.onpointermove = (e) => {
    if (!isDragging) return;

    const deltaY = Math.abs(e.clientY - startPageY);
    if (deltaY > 5) {
      dragStarted = true;
      const y = e.clientY - startY;
      container.style.top = `${y}px`;
      container.style.bottom = 'auto';
      container.style.transform = 'none';
    }
  };

  nextBtn.onpointerup = (e) => {
    if (!isDragging) return;
    isDragging = false;
    nextBtn.releasePointerCapture(e.pointerId);

    // If it wasn't a significant drag, treat as click
    if (!dragStarted) {
      const r = document.getElementById('reader-view');
      if (r && r.style.display !== 'none') {
        document.getElementById('reader-content-area').scrollBy({ top: window.innerHeight * 0.9, behavior: 'auto' });
      } else {
        window.scrollBy({ top: window.innerHeight * 0.9, behavior: 'auto' });
      }
    }
  };

  nextBtn.onpointercancel = () => {
    isDragging = false;
  };
}

// Global Keydown (Space/PageDown)
window.addEventListener('keydown', (e) => {
  if (e.key === ' ' || e.key === 'PageDown') {
    const r = document.getElementById('reader-view');
    if (r && r.style.display !== 'none') {
      e.preventDefault();
      document.getElementById('reader-content-area').scrollBy({ top: window.innerHeight * 0.9, behavior: 'auto' });
    } else if (e.target === document.body || e.target.tagName === 'HTML') {
      // Only scroll if not in an input/textarea
      // Let default behavior happen for main stream if not in reader
    }
  }
});
