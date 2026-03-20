# Offline First App

A browser-based progressive web app demonstrating offline-first patterns with local encryption, indexedDB storage, background sync simulation, and a responsive UI.

## 🚀 Core Features

1. **Encrypted local data storage**
   - PBKDF2 key derivation from passphrase (`crypto.js`).
   - AES-GCM encryption/decryption of items and internal action logs.
   - Random salt persisted in `localStorage`.

2. **Offline-first persistence**
   - IndexedDB object stores in `db.js`: `items`, `actions`, `timeline`, `history`, `notifications`, `searchIndex`, `meta`.
   - `putEncrypted`, `getAll`, `get`, `del`, `clear` helper APIs.

3. **Sync workflow + conflict handling**
   - Action queue (`item:add`, `item:update`, `item:delete`) in `actions` store.
   - Simulated remote state map in `sync.js`.
   - Sync timeline with status tags: `ok`, `merged`, `error`, `skip`.
   - Conflict resolution callback `onConflict` auto-merges local changes.

4. **Search index**
   - Keyword tokenization and scoring in `search.js`.
   - Search results ranked by term frequency, recency, interaction score.

5. **UI experience**
   - Material-inspired cards / grid layout in `style.css`.
   - Theme toggle (light/dark) persisted in `localStorage`.
   - Passphrase unlock flow and toast status messages.

## 🧩 Components

- `index.html`: App structure, manifest link, UI elements.
- `style.css`: Visual design, responsive layout, dark mode tokens.
- `app.js`: Main wiring, event handlers, app state, data flow.
- `crypto.js`: Encryption/ decryption helpers and key derivation.
- `db.js`: IndexedDB persistence layer.
- `sync.js`: Simulated remote sync workflow and timeline logging.
- `search.js`: Full-text local search.
- `notification.js`: UI notification queue and service worker display.
- `service-worker.js`: Background sync and offline caching (not fully shown).

## 🛠️ Setup & usage

1. Open `index.html` in browser or use simple local server (`npx http-server`).
2. Default passphrase is pre-filled as `demo-pass`.
3. Click `Unlock`, then add items.
4. Use `Load samples` for seeded dataset.
5. Click `Sync Now` to process action queue.
6. Search in real time using the search input.

## ⚙️ Notes

- Works offline using IndexedDB and local data handling.
- Data is encrypted locally with AES-GCM; passphrase is required for decryption.
- Styling issue fixed: `index.html` now loads `style.css` and `manifest.webmanifest` is a `link rel="manifest"`.

## 🔍 How it works (detailed)

1. **Unlock flow**
   - User enters passphrase and clicks Unlock.
   - `app.js` calls `crypto.js` `deriveKey(passphrase, salt)`.
   - Salt is created once with `getOrCreateSalt()` in `localStorage`.
   - Derived key persists in memory for session functions.
   - `refreshAll()` runs: list items, timeline, storage estimate, remote snapshot.

2. **Local item operations**
   - Add/edit/delete actions run in UI functions (`itemForm`, edit/delete buttons).
   - `putItem()` encrypts payload with `encryptJSON(cryptoKey, item)` and stores in `items` store.
   - Every local action is also queued to `actions` store via `recordAction(...)` for offline sync.
   - `undo` / `redo` stacks maintained in app state, triggering stores and history updates.

3. **Local search**
   - `updateSearchResults()` gets input and calls `search(query)`.
   - Search reads all `items`, decrypts each, tokenizes title/content, scores with frequency+recency+interactions.
   - Results rendered in `#search-results`.

4. **Sync and remote simulation**
   - `sync.js` simulates server by `remoteState` map in memory.
   - `startSync()` reads encrypted actions, decrypts with key, applies remote-state rules.
   - Merges, updates, deletes remote rows and removes actions after success.
   - `timeline` store logs each sync step with status / messages.
   - On conflicts, `onConflict` currently auto-returns local item (you can change behavior).

5. **Background sync / network hooks**
   - `updateNetworkStatus()` toggles sync button based on online/connection quality.
   - Listeners on `online`/`offline` and `navigator.connection` changes.
   - `triggerBackgroundSync` runs on `online` event, requires being unlocked.

6. **Service worker**
   - `service-worker.js` registers in `app.js`; offline caching may serve shell.
   - Post messages from SW trigger `RUN_SYNC` to invoke sync on the main app.

## ✅ Complete uses

- Personal offline note/task tracker with client-side encrypted data.
- Demo of full offline-first pipeline: local CRUD, queue, remote sync, conflict handling.
- Secure storage proof-of-concept (passphrase-based key, AES-GCM on IndexedDB data).
- Progressive if installed as PWA (manifest + SW) with background sync simulation.

## 🧪 Future improvements

- replace all pseudo remote logic with real API endpoints.
- Add proper login/logout and key rotation.
- Add conflict resolution UI instead of automatic merge.
- Add explicit offline status indicator and local/remote sync status badges.


- replace all pseudo remote logic with real API endpoints.
- Add proper login/logout and key rotation.
- Add conflict resolution UI instead of automatic merge.
- Add explicit offline status indicator and local/remote sync status badges.

---

Built for learning offline-first web app architecture and local cryptographic data handling.   - 