import { deriveKey, getOrCreateSalt, encryptJSON, decryptJSON, estimateSizeBytes } from './crypto.js';
import { openDB, putEncrypted, getAll, get, del, clear } from './db.js';
import { setCryptoKey as setSyncKey, startSync, getRemoteSnapshot, clearTimeline, getQueueSizeEstimate } from './sync.js';
import { setCryptoKey as setSearchKey, search } from './search.js';
import { setCryptoKey as setNotifyKey, requestPermission, scheduleNotification, listNotificationLog } from './notification.js';
import { setSimulator } from './simulator.js';

let cryptoKey;
let unlocked = false;

// cache all our DOM elements here so we aren't querying the document constantly
const els = {
    // gate
    gateScreen:     document.getElementById('gate-screen'),
    gateInput:      document.getElementById('gate-input'),
    gateFeedback:   document.getElementById('gate-feedback'),

    // login
    loginScreen:    document.getElementById('login-screen'),
    loginForm:      document.getElementById('login-form'),
    passphrase:     document.getElementById('passphrase'),
    unlockBtn:      document.getElementById('unlock-btn'),
    togglePass:     document.getElementById('toggle-pass'),
    eyeOpen:        document.getElementById('eye-open'),
    eyeClosed:      document.getElementById('eye-closed'),

    // app
    appShell:       document.getElementById('app-shell'),
    themeToggle:    document.getElementById('theme-toggle'),
    loadSamplesBtn: document.getElementById('load-samples-btn'),
    lockBtn:        document.getElementById('lock-btn'),
    networkChip:    document.getElementById('network-chip'),
    itemForm:       document.getElementById('item-form'),
    itemTitle:      document.getElementById('item-title'),
    itemContent:    document.getElementById('item-content'),
    itemsList:      document.getElementById('items-list'),
    undoBtn:        document.getElementById('undo-btn'),
    redoBtn:        document.getElementById('redo-btn'),
    searchInput:    document.getElementById('search-input'),
    searchResults:  document.getElementById('search-results'),
    timeline:       document.getElementById('timeline'),
    syncNowBtn:     document.getElementById('sync-now-btn'),
    clearTimelineBtn: document.getElementById('clear-timeline-btn'),
    overviewItems:  document.getElementById('overview-items'),
    overviewRemote: document.getElementById('overview-remote'),
    overviewQueued: document.getElementById('overview-queued'),
    remoteList:     document.getElementById('remote-list'),
    spinner:        document.getElementById('spinner'),
    snackbar:       document.getElementById('snackbar'),

    // modal
    modalOverlay:   document.getElementById('modal-overlay'),
    modalCard:      document.getElementById('modal-card'),
    modalTitle:     document.getElementById('modal-title'),
    modalBody:      document.getElementById('modal-body'),
    modalFooter:    document.getElementById('modal-footer'),
    modalCancel:    document.getElementById('modal-cancel'),
    modalConfirm:   document.getElementById('modal-confirm'),
    modalCloseBtn:  document.getElementById('modal-close-btn'),
};

// simple ui helpers for snackbars and loading spinners
function toast(message) {
    if (!els.snackbar) return;
    els.snackbar.textContent = message;
    els.snackbar.hidden = false;
    setTimeout(() => { if (els.snackbar) els.snackbar.hidden = true; }, 3000);
}

function showSpinner(visible) {
    if (els.spinner) els.spinner.hidden = !visible;
}

// setting up the custom modal stuff to replace ugly native prompt() and alert()
let modalResolve = null;

function openModal({ title, bodyHTML, confirmText = 'Confirm', confirmClass = '', cancelText = 'Cancel' }) {
    return new Promise((resolve) => {
        modalResolve = resolve;
        els.modalTitle.textContent = title;
        els.modalBody.innerHTML = bodyHTML;
        els.modalConfirm.textContent = confirmText;
        els.modalConfirm.className = confirmClass || '';
        els.modalCancel.textContent = cancelText;
        els.modalOverlay.hidden = false;

        // Focus the first input if any
        const firstInput = els.modalBody.querySelector('input, textarea');
        if (firstInput) setTimeout(() => firstInput.focus(), 50);
    });
}

function closeModal(result) {
    els.modalOverlay.hidden = true;
    if (modalResolve) { modalResolve(result); modalResolve = null; }
}

els.modalCloseBtn?.addEventListener('click', () => closeModal(null));
els.modalCancel?.addEventListener('click', () => closeModal(null));
els.modalConfirm?.addEventListener('click', () => {
    // Gather form values from modal body
    const inputs = els.modalBody.querySelectorAll('[data-field]');
    const data = {};
    inputs.forEach(el => { data[el.dataset.field] = el.value; });
    closeModal(data);
});
els.modalOverlay?.addEventListener('click', (e) => {
    if (e.target === els.modalOverlay) closeModal(null);
});

// Escape to close
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !els.modalOverlay?.hidden) closeModal(null);
});

// register service worker for offline viewing
(async function registerSW() {
    if ('serviceWorker' in navigator) {
        try {
            const reg = await navigator.serviceWorker.register('./service-worker.js', { scope: './' });
            console.log('SW registered', reg);
        } catch (e) {
            console.warn('SW registration failed', e);
        }
    }
})();

async function registerBackgroundSync() {
    const reg = await navigator.serviceWorker.getRegistration();
    try { await reg?.sync?.register('sync-actions'); }
    catch (e) { console.warn('Background Sync unavailable', e); }
}

// auth logic - handle master password and crypto initialization
async function unlock(passphrase) {
    try {
        cryptoKey = await deriveKey(passphrase, getOrCreateSalt());
        unlocked = true;
        setSyncKey(cryptoKey);
        setSearchKey(cryptoKey);
        setNotifyKey(cryptoKey);

        // Validate password by trying to read and decrypt data FIRST
        await refreshAll();

        // If decryption succeeded without throwing, transition the UI
        els.loginScreen.classList.add('hiding');
        setTimeout(() => {
            els.loginScreen.hidden = true;
            els.appShell.hidden = false;
        }, 450);

        toast('Vault unlocked');
    } catch (err) {
        console.error('Unlock failed', err);
        unlocked = false;
        toast('Unlock failed — check passphrase');
    }
}

function lock() {
    unlocked = false;
    cryptoKey = null;
    els.appShell.hidden = true;
    els.loginScreen.hidden = true;
    if (els.gateScreen) {
        els.gateScreen.hidden = false;
        els.gateScreen.classList.remove('unlocking');
    }
    if (els.gateInput) {
        els.gateInput.value = '';
        els.gateInput.disabled = false;
    }
    if (els.gateFeedback) {
        els.gateFeedback.textContent = '';
        els.gateFeedback.className = 'gate-feedback';
    }
    els.loginScreen.classList.remove('hiding');
    if (els.passphrase) els.passphrase.value = '';
    toast('Vault locked');
}

// Login form submit
els.loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = els.passphrase?.value?.trim();
    if (!pw) return;
    els.unlockBtn.disabled = true;
    els.unlockBtn.querySelector('.btn-text').textContent = 'Unlocking...';
    await unlock(pw);
    els.unlockBtn.disabled = false;
    els.unlockBtn.querySelector('.btn-text').textContent = 'Unlock Vault';
});

// Toggle password visibility
els.togglePass?.addEventListener('click', () => {
    const isPassword = els.passphrase.type === 'password';
    els.passphrase.type = isPassword ? 'text' : 'password';
    els.eyeOpen.style.display = isPassword ? 'none' : 'block';
    els.eyeClosed.style.display = isPassword ? 'block' : 'none';
});

// Lock button
els.lockBtn?.addEventListener('click', lock);

// Pre-fill for demo
if (els.passphrase) els.passphrase.value = 'demo-pass';

// secret "ephemeral" gate easter egg before normal login
els.gateInput?.addEventListener('input', (e) => {
    const val = e.target.value.toLowerCase().trim();
    if (val === 'ephemeral') {
        if (els.gateFeedback) {
            els.gateFeedback.textContent = 'accepted';
            els.gateFeedback.className = 'gate-feedback success';
        }
        e.target.disabled = true;
        
        setTimeout(() => {
            els.gateScreen?.classList.add('unlocking');
            setTimeout(() => {
                if (els.gateScreen) els.gateScreen.hidden = true;
                if (els.loginScreen) els.loginScreen.hidden = false;
                els.passphrase?.focus();
            }, 800);
        }, 500);
    } else if (val.length >= 9) {
        if (els.gateFeedback) els.gateFeedback.textContent = 'rejected';
        setTimeout(() => {
            if (!els.gateScreen?.classList.contains('unlocking')) {
                e.target.value = '';
                if (els.gateFeedback) els.gateFeedback.textContent = '';
            }
        }, 800);
    } else {
        if (els.gateFeedback) els.gateFeedback.textContent = '';
    }
});

// handle light/dark mode switching
function applyTheme(theme) { document.body.dataset.theme = theme; }

function initTheme() {
    const saved = localStorage.getItem('offlineFirst.theme') || 'light';
    applyTheme(saved);
    if (els.themeToggle) els.themeToggle.textContent = saved === 'dark' ? '☀️ Light' : '🌙 Dark';
}

els.themeToggle?.addEventListener('click', () => {
    const cur = document.body.dataset.theme || 'light';
    const next = cur === 'dark' ? 'light' : 'dark';
    localStorage.setItem('offlineFirst.theme', next);
    applyTheme(next);
    els.themeToggle.textContent = next === 'dark' ? '☀️ Light' : '🌙 Dark';
});

// update ui based on network connection
function updateNetworkStatus() {
    const online = navigator.onLine;
    if (els.networkChip) {
        els.networkChip.textContent = online ? '● Online' : '● Offline';
        els.networkChip.className = 'header-chip' + (online ? '' : ' offline');
    }
    if (els.syncNowBtn) {
        const conn = navigator.connection || {};
        const type = conn.effectiveType || 'unknown';
        const down = conn.downlink || 0;
        if (!online || type.includes('2g') || down < 0.5) {
            els.syncNowBtn.disabled = !online;
        } else {
            els.syncNowBtn.disabled = false;
        }
    }
}

window.addEventListener('online', updateNetworkStatus);
window.addEventListener('offline', updateNetworkStatus);
if (navigator.connection) navigator.connection.addEventListener('change', updateNetworkStatus);

// core db operations for items
async function putItem(item) {
    const enc = await encryptJSON(cryptoKey, item);
    await putEncrypted('items', { id: item.id, ...enc });
}

async function listItems() {
    if (!unlocked) return;
    const encs = await getAll('items');
    const items = [];

    for (const r of encs) {
        items.push(await decryptJSON(cryptoKey, r));
    }

    items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    if (els.overviewItems) els.overviewItems.textContent = String(items.length);
    if (!els.itemsList) return;
    els.itemsList.innerHTML = '';

    for (const it of items) {
        const li = document.createElement('li');
        li.innerHTML = `<strong>${it.title}</strong><br/><small>${new Date(it.updatedAt).toLocaleString()}</small><p>${it.content}</p>`;

        const row = document.createElement('div');
        row.className = 'row';

        const editBtn = document.createElement('button');
        editBtn.textContent = '✎ Edit';
        editBtn.className = 'btn-secondary';

        const delBtn = document.createElement('button');
        delBtn.textContent = '✕ Delete';
        delBtn.className = 'btn-secondary btn-danger';

        editBtn.onclick = async () => {
            const result = await openModal({
                title: 'Edit Item',
                bodyHTML: `
                    <label>Title</label>
                    <input data-field="title" value="${escapeHTML(it.title)}" placeholder="Item title..." />
                    <label>Content</label>
                    <textarea data-field="content" rows="4" placeholder="Description...">${escapeHTML(it.content)}</textarea>
                `,
                confirmText: 'Save Changes',
            });
            if (!result) return;

            const title = result.title?.trim() || it.title;
            const content = result.content?.trim() || it.content;
            const updated = {
                ...it,
                title,
                content,
                updatedAt: Date.now(),
                interactions: (it.interactions || 0) + 1,
                version: (it.version || 0) + 1,
            };
            await putItem(updated);
            await recordAction('item:update', updated);
            await pushHistory({ type: 'update', prev: it, next: updated });
            await listItems();
            await updateSearchResults();
            toast('Item updated');
        };

        delBtn.onclick = async () => {
            const result = await openModal({
                title: 'Delete Item',
                bodyHTML: `
                    <p class="confirm-text">Are you sure you want to delete <span class="confirm-item-name">"${escapeHTML(it.title)}"</span>?</p>
                    <p class="confirm-text" style="font-size:.8rem;color:var(--muted);">This action can be undone with the Undo button.</p>
                `,
                confirmText: 'Delete',
                confirmClass: 'btn-danger',
            });
            if (!result) return;

            await del('items', it.id);
            await recordAction('item:delete', { id: it.id });
            await pushHistory({ type: 'delete', item: it });
            await listItems();
            await updateSearchResults();
            toast('Item deleted');
        };

        row.appendChild(editBtn);
        row.appendChild(delBtn);
        li.appendChild(row);
        els.itemsList.appendChild(li);
    }
}

function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

// offline action tracking
async function updateOverviewQueued() {
    const size = await getQueueSizeEstimate();
    if (els.overviewQueued) els.overviewQueued.textContent = String(size);
}

async function recordAction(type, payload) {
    const action = { id: 'a-' + Date.now() + '-' + Math.random(), type, payload, ts: Date.now() };
    const enc = await encryptJSON(cryptoKey, action);
    await putEncrypted('actions', { id: action.id, ...enc });
    await updateOverviewQueued();
    await registerBackgroundSync();
}

// simple undo/redo stack
let undoStack = [];
let redoStack = [];

async function pushHistory(entry) { undoStack.push(entry); redoStack = []; }

async function undo() {
    const entry = undoStack.pop();
    if (!entry) { toast('Nothing to undo'); return; }
    redoStack.push(entry);

    if (entry.type === 'add') {
        await del('items', entry.item.id);
        await recordAction('item:delete', { id: entry.item.id });
    } else if (entry.type === 'update') {
        await putItem(entry.prev);
        await recordAction('item:update', entry.prev);
    } else if (entry.type === 'delete') {
        await putItem(entry.item);
        await recordAction('item:add', entry.item);
    }
    await listItems();
    toast('Undone');
}

async function redo() {
    const entry = redoStack.pop();
    if (!entry) { toast('Nothing to redo'); return; }
    undoStack.push(entry);

    if (entry.type === 'add') {
        await putItem(entry.item);
        await recordAction('item:add', entry.item);
    } else if (entry.type === 'update') {
        await putItem(entry.next);
        await recordAction('item:update', entry.next);
    } else if (entry.type === 'delete') {
        await del('items', entry.item.id);
        await recordAction('item:delete', { id: entry.item.id });
    }
    await listItems();
    toast('Redone');
}

els.undoBtn?.addEventListener('click', undo);
els.redoBtn?.addEventListener('click', redo);

// add new items
els.itemForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!unlocked) { toast('Unlock first'); return; }

    const item = {
        id: 'i-' + Date.now() + '-' + Math.random(),
        title: els.itemTitle?.value?.trim() || '',
        content: els.itemContent?.value?.trim() || '',
        ts: Date.now(),
        updatedAt: Date.now(),
        version: 1,
        interactions: 1,
    };

    await putItem(item);
    await recordAction('item:add', item);
    await pushHistory({ type: 'add', item });
    els.itemForm?.reset();
    await listItems();
    await updateSearchResults();
    toast('Item added');
});

// search filtering
async function updateSearchResults() {
    const q = els.searchInput?.value?.trim() || '';
    if (!q) {
        if (els.searchResults) els.searchResults.innerHTML = '';
        return;
    }
    const results = await search(q);
    if (els.searchResults) {
        els.searchResults.innerHTML = results
            .map((r) => `<li><strong>${r.title}</strong> <small>(score ${r.score.toFixed(2)})</small><p>${r.content}</p></li>`)
            .join('');
    }
}

els.searchInput?.addEventListener('input', updateSearchResults);

// view sync history timeline
async function renderTimeline() {
    if (!unlocked) return;
    const encs = await getAll('timeline');
    const rows = [];
    for (const r of encs) {
        rows.push(await decryptJSON(cryptoKey, r));
    }
    rows.sort((a, b) => a.ts - b.ts);

    if (els.timeline) {
        els.timeline.innerHTML = rows
            .map((r) => {
                const cls = `status status-${r.status}`;
                return `<li><span class="${cls}">${r.status}</span><span>[${new Date(r.ts).toLocaleTimeString()}]</span> <span>${r.type}</span> <span>${r.id ? '(' + r.id + ')' : ''}</span> ${r.message ? '<em>' + r.message + '</em>' : ''}</li>`;
            })
            .join('');
    }
}

els.clearTimelineBtn?.addEventListener('click', async () => {
    await clearTimeline();
    await renderTimeline();
    toast('Timeline cleared');
});

// sync handlers
async function onConflict(localItem, remoteItem) {
    toast(`Auto-merged conflict for: ${localItem.id}`);
    return localItem;
}

async function triggerBackgroundSync() {
    if (!unlocked) return;
    showSpinner(true);
    try {
        await startSync({ onConflict });
        await renderTimeline();
        await updateOverviewQueued();
        toast('Background sync completed');
    } catch (e) {
        console.error('Sync error', e);
    }
    showSpinner(false);
}

els.syncNowBtn?.addEventListener('click', async () => {
    if (!unlocked) { toast('Unlock first to sync'); return; }
    showSpinner(true);
    try {
        await startSync({ onConflict });
        await renderTimeline();
        await updateOverviewQueued();
        toast('Sync complete');
    } catch (e) {
        console.error('Sync failed', e);
        toast('Sync failed');
    }
    showSpinner(false);
});

navigator.serviceWorker?.addEventListener('message', async (event) => {
    const { type } = event.data || {};
    if (type === 'RUN_SYNC') {
        await startSync({ onConflict });
        await renderTimeline();
    }
});

// display quota limits
async function updateStorageUsage() {
    const est = await navigator.storage?.estimate?.();
    if (!est) return;
    const usedMB = est.usage ? (est.usage / (1024 * 1024)).toFixed(2) : 'n/a';
    const quotaMB = est.quota ? (est.quota / (1024 * 1024)).toFixed(2) : 'n/a';
    if (est.usage && est.quota && est.usage / est.quota > 0.8) {
        toast('Warning: storage near browser limit');
    }
    console.log(`Storage: ${usedMB} / ${quotaMB} MB`);
}

// view what's on the fake remote
async function renderRemote() {
    const remote = getRemoteSnapshot ? getRemoteSnapshot() : [];
    if (els.remoteList) {
        els.remoteList.innerHTML = remote.map(item => `<li><strong>${item.id}</strong>: ${item.title}</li>`).join('');
        if (els.overviewRemote) els.overviewRemote.textContent = String(remote.length);
    }
}

// refresh data across the board
async function refreshAll() {
    await listItems();
    await renderTimeline();
    await updateStorageUsage();
    await renderRemote();
    await updateOverviewQueued();
}

// run on load
initTheme();
updateNetworkStatus();
setInterval(updateStorageUsage, 5000);
window.addEventListener('online', triggerBackgroundSync);

// dev tooling: load fake data
async function loadSamples() {
    if (!unlocked) { toast('Unlock first'); return; }
    const now = Date.now();
    const samples = [
        { id: 'i-s-1', title: '📋 Project Planning', content: 'Define scope, milestones, and deliverables for Q1 2025 offline-first initiative.', ts: now, updatedAt: now, version: 1, interactions: 5 },
        { id: 'i-s-2', title: '📝 Meeting Notes', content: 'Discussed IndexedDB strategies and encryption patterns. Action: Implement background sync.', ts: now + 1000, updatedAt: now + 1000, version: 1, interactions: 3 },
        { id: 'i-s-3', title: '💡 Feature Ideas', content: 'Add conflict resolver UI. Consider diff visualization. Test with large datasets offline.', ts: now + 2000, updatedAt: now + 2000, version: 1, interactions: 7 },
        { id: 'i-s-4', title: '✅ Tasks', content: 'Complete encryption module. Write unit tests. Deploy service worker to staging.', ts: now + 3000, updatedAt: now + 3000, version: 1, interactions: 2 },
        { id: 'i-s-5', title: '🔬 Research', content: 'Web Crypto API best practices. PBKDF2 iterations benchmark. AES-GCM vs ChaCha20.', ts: now + 4000, updatedAt: now + 4000, version: 1, interactions: 4 },
        { id: 'i-s-6', title: '📊 Analytics Data', content: 'Track offline usage patterns. Monitor sync queue depth. Measure encryption overhead.', ts: now + 5000, updatedAt: now + 5000, version: 1, interactions: 6 },
    ];

    for (const it of samples) {
        await putItem(it);
        await recordAction('item:add', it);
        await pushHistory({ type: 'add', item: it });
    }

    showSpinner(true);
    await startSync({ onConflict });
    await renderTimeline();
    await renderRemote();
    showSpinner(false);

    const edit1 = { ...samples[1], title: '📝 Meeting Notes (updated)', content: 'Updated: Also discussed service worker caching strategies and offline UX patterns.', updatedAt: now + 6000, version: 2, interactions: 4 };
    await putItem(edit1);
    await recordAction('item:update', edit1);

    const edit2 = { ...samples[2], title: '💡 Feature Ideas (expanded)', content: 'Added: Consider progressive sync, batch operations, and optimistic UI updates for better UX.', updatedAt: now + 7000, version: 2, interactions: 8 };
    await putItem(edit2);
    await recordAction('item:update', edit2);

    await listItems();
    toast('Sample data loaded! Try editing items and syncing.');
}

els.loadSamplesBtn?.addEventListener('click', loadSamples);

// export for tests or simulators
export { unlock, triggerBackgroundSync, requestPermission, scheduleNotification, listNotificationLog, setSimulator };