/* ==========================================================
   1. CONFIGURAZIONE FIREBASE
========================================================== */
const firebaseConfig = {
  apiKey: "AIzaSyDhtvjCZstnA0zAFeNZJHRRvFHxiGznrqk",
  authDomain: "listapp-a19e7.firebaseapp.com",
  databaseURL: "https://listapp-a19e7-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "listapp-a19e7",
  storageBucket: "listapp-a19e7.firebasestorage.app",
  messagingSenderId: "157156284614",
  appId: "1:157156284614:web:53538938edb6883d0e9fc7",
  measurementId: "G-NBRZM1VV4T"
};

let fbDatabase = null;
let householdRef = null;
let isFirebaseConfigured = false;

if (firebaseConfig.apiKey && firebaseConfig.apiKey !== "INSERISCI_LA_TUA_API_KEY") {
  try {
    firebase.initializeApp(firebaseConfig);
    fbDatabase = firebase.database();
    isFirebaseConfigured = true;
  } catch (err) {
    console.warn("Firebase non inizializzato:", err);
  }
}

/* ==========================================================
   2. DATI E STATO APPLICAZIONE
========================================================== */
const DEFAULT_CATEGORIES = {
  frigo: { title: "Frigorifero", icon: "❄️", color: "var(--tint-blue)" },
  dispensa: { title: "Dispensa", icon: "🥫", color: "var(--tint-orange)" },
  cane: { title: "Cibo Cane", icon: "🐶", color: "var(--tint-purple)" },
  ripostiglio: { title: "Ripostiglio", icon: "🧹", color: "var(--tint-green)" }
};

const LS_DATA = "smart_pantry_ios_pwa_v4";
const LS_CODE = "smart_pantry_sync_code";

/* Dati di una casa appena creata: categorie di base, nessun prodotto */
function freshData(name) {
  const data = {
    categories: JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)),
    inventory: {},
    spesa: []
  };
  if (name) data.name = name;
  return data;
}

let appData = freshData();

let currentCategory = null;
let householdCode = localStorage.getItem(LS_CODE) || "";

function setSyncDot(status) {
  const dot = document.getElementById("sync-dot");
  dot.className = "sync-indicator " + status;
}

/* ==========================================================
   3. GESTIONE SINCRONIZZAZIONE REALTIME
========================================================== */
function initSync() {
  if (!isFirebaseConfigured || !householdCode) {
    setSyncDot("");
    loadLocalData();
    return;
  }

  householdRef = fbDatabase.ref("households/" + houseKey(householdCode));

  setSyncDot("syncing");

  // Ascolto in tempo reale tra i due dispositivi
  householdRef.on("value", (snapshot) => {
    const remoteData = snapshot.val();
    if (remoteData) {
      appData = remoteData;
      if (!appData.categories) appData.categories = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
      if (!appData.inventory) appData.inventory = {};
      if (!appData.spesa) appData.spesa = [];

      localStorage.setItem(LS_DATA, JSON.stringify(appData));
      refreshCurrentView();
      setSyncDot("online");
    } else {
      syncToCloud();
      setSyncDot("online");
    }
  }, (error) => {
    console.error("Errore sincronizzazione Firebase:", error);
    setSyncDot("");
    loadLocalData();
  });
}

function syncToCloud() {
  if (householdRef) {
    setSyncDot("syncing");
    householdRef.set(appData)
      .then(() => setSyncDot("online"))
      .catch(() => setSyncDot(""));
  }
}

function loadLocalData() {
  const saved = localStorage.getItem(LS_DATA);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed.categories && parsed.inventory && parsed.spesa) {
        appData = parsed;
      }
    } catch (e) {
      console.error(e);
    }
  }
  refreshCurrentView();
}

function persistData() {
  localStorage.setItem(LS_DATA, JSON.stringify(appData));
  if (householdRef) {
    syncToCloud();
  }
  refreshCurrentView();
}

function refreshCurrentView() {
  renderHomeTiles();
  if (document.getElementById("modal-sync").classList.contains("active")) renderSyncModal();
  updateBadge();
  if (currentCategory && appData.categories && appData.categories[currentCategory]) {
    renderCategoryItems();
  } else if (document.getElementById("view-spesa").classList.contains("active")) {
    renderSpesaItems();
  } else {
    showHome();
  }
}

/* Modal Sincronizzazione Casa */
/* ==========================================================
   Casa condivisa: creazione, collegamento, disconnessione
========================================================== */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const MIN_CODE_LENGTH = 8; // deve coincidere con le regole del database

function houseKey(code) {
  return code.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
}

function generateHouseCode() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let code = "";
  bytes.forEach((b, i) => {
    if (i > 0 && i % 4 === 0) code += "-";
    code += CODE_ALPHABET[b % CODE_ALPHABET.length];
  });
  return code;
}

function hasLocalData() {
  return !!localStorage.getItem(LS_DATA);
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))
  ]);
}

function explainFirebaseError(err, context) {
  if (!navigator.onLine || (err && err.message === "timeout")) {
    return "Connessione assente o troppo lenta. Controlla la rete e riprova.";
  }
  if (err && err.code === "PERMISSION_DENIED") {
    return context === "create"
      ? "Il database ha rifiutato la creazione. Controlla le regole di Firebase."
      : "Codice non valido.";
  }
  return "Qualcosa è andato storto. Riprova.";
}

function setBusy(button, busy, busyLabel) {
  if (busy) { button.dataset.label = button.textContent; button.textContent = busyLabel; }
  else if (button.dataset.label) { button.textContent = button.dataset.label; }
  button.disabled = busy;
}

/* ---------- Schermata di benvenuto ---------- */
function openWelcome(step, dismissible) {
  closeSyncModal();
  document.getElementById("input-house-name").value = "";
  document.getElementById("input-join-code").value = "";
  document.getElementById("welcome-cancel").hidden = !dismissible;
  document.getElementById("welcome").hidden = false;
  showWelcomeStep(step);
}

function closeWelcome() {
  document.getElementById("welcome").hidden = true;
  document.activeElement && document.activeElement.blur();
}

function showWelcomeStep(step) {
  const isJoin = step === "join";
  document.getElementById("welcome-create").hidden = isJoin;
  document.getElementById("welcome-join").hidden = !isJoin;
  document.getElementById("welcome-replace-note").hidden = !(isJoin && hasLocalData());
  setWelcomeError("welcome-create-error", "");
  setWelcomeError("welcome-join-error", "");
  document.querySelectorAll("#welcome input").forEach(i => i.removeAttribute("aria-invalid"));
  setTimeout(() => document.getElementById(isJoin ? "input-join-code" : "input-house-name").focus(), 150);
}

function setWelcomeError(id, message) {
  const el = document.getElementById(id);
  el.textContent = message;
  el.hidden = !message;
}

async function createHouse() {
  const input = document.getElementById("input-house-name");
  const button = document.getElementById("btn-create-house");
  const errorId = "welcome-create-error";
  const name = input.value.trim().toLocaleUpperCase("it-IT");

  setWelcomeError(errorId, "");
  input.removeAttribute("aria-invalid");
  if (!name) { input.setAttribute("aria-invalid", "true"); input.focus(); return; }
  if (!isFirebaseConfigured || !navigator.onLine) {
    setWelcomeError(errorId, "Serve una connessione internet per creare la casa. Riprova tra poco.");
    return;
  }

  // Chi ha già dati locali li porta con sé nella nuova casa
  const data = Object.assign({}, hasLocalData() ? appData : freshData(), { name: name });
  const code = generateHouseCode();

  setBusy(button, true, "Creazione…");
  try {
    await withTimeout(fbDatabase.ref("households/" + houseKey(code)).set(data), 10000);
  } catch (err) {
    setBusy(button, false);
    setWelcomeError(errorId, explainFirebaseError(err, "create"));
    return;
  }
  setBusy(button, false);

  appData = data;
  householdCode = code;
  localStorage.setItem(LS_CODE, code);
  localStorage.setItem(LS_DATA, JSON.stringify(appData));
  closeWelcome();
  initSync();
  openSyncModal();
  showToast(`Casa “${name}” creata`);
}

async function joinHouse() {
  const input = document.getElementById("input-join-code");
  const button = document.getElementById("btn-join-house");
  const errorId = "welcome-join-error";
  const code = input.value.trim().toUpperCase().replace(/\s+/g, "");

  setWelcomeError(errorId, "");
  input.removeAttribute("aria-invalid");
  if (code.length < MIN_CODE_LENGTH) {
    input.setAttribute("aria-invalid", "true");
    setWelcomeError(errorId, `Il codice deve avere almeno ${MIN_CODE_LENGTH} caratteri.`);
    input.focus();
    return;
  }
  if (!isFirebaseConfigured || !navigator.onLine) {
    setWelcomeError(errorId, "Serve una connessione internet per collegarsi a una casa.");
    return;
  }

  setBusy(button, true, "Ricerca…");
  let snapshot;
  try {
    snapshot = await withTimeout(fbDatabase.ref("households/" + houseKey(code)).once("value"), 10000);
  } catch (err) {
    setBusy(button, false);
    setWelcomeError(errorId, explainFirebaseError(err, "join"));
    return;
  }
  setBusy(button, false);

  if (!snapshot.exists()) {
    input.setAttribute("aria-invalid", "true");
    setWelcomeError(errorId, "Nessuna casa con questo codice. Controlla di averlo scritto bene.");
    return;
  }

  const remote = snapshot.val() || {};
  householdCode = code;
  localStorage.setItem(LS_CODE, code);
  closeWelcome();
  initSync(); // carica i dati della casa e resta in ascolto
  showToast(`Collegato a “${remote.name || "casa condivisa"}”`);
}

function leaveHouse(nextStep) {
  const name = appData.name || "questa casa";
  const message = `Vuoi disconnetterti da “${name}”?\n\nI dati restano salvati online: per rientrare ti servirà il codice ${householdCode}.`;
  if (!confirm(message)) return;

  if (householdRef) { householdRef.off(); householdRef = null; }
  householdCode = "";
  localStorage.removeItem(LS_CODE);
  localStorage.removeItem(LS_DATA);
  appData = freshData();
  setSyncDot("");
  showHome();
  updateBadge();
  openWelcome(nextStep, false);
}

/* ---------- Modale connessione cloud ---------- */
function openSyncModal() {
  renderSyncModal();
  cancelRenameHouse();
  document.getElementById("modal-sync").classList.add("active");
}

function closeSyncModal() {
  document.getElementById("modal-sync").classList.remove("active");
  document.activeElement && document.activeElement.blur();
}

function renderSyncModal() {
  const connected = !!householdCode;
  document.getElementById("sync-connected").hidden = !connected;
  document.getElementById("sync-disconnected").hidden = connected;
  if (!connected) return;

  document.getElementById("sync-house-name").textContent = appData.name || "Casa senza nome";
  document.getElementById("sync-code").textContent = householdCode;

  const live = !!householdRef;
  document.getElementById("sync-status-dot").className = "status-dot" + (live ? " online" : "");
  document.getElementById("sync-status-text").textContent = live
    ? "Connessa · aggiornata in tempo reale"
    : "Non raggiungibile · modifiche solo su questo dispositivo";
  document.getElementById("btn-share-label").textContent = navigator.share ? "Condividi codice" : "Copia codice";
}

function startRenameHouse() {
  const input = document.getElementById("input-rename-house");
  input.value = appData.name || "";
  document.getElementById("house-name-view").hidden = true;
  document.getElementById("house-name-edit").hidden = false;
  input.focus();
}

function cancelRenameHouse() {
  document.getElementById("house-name-view").hidden = false;
  document.getElementById("house-name-edit").hidden = true;
}

function saveHouseName() {
  const input = document.getElementById("input-rename-house");
  const name = input.value.trim().toLocaleUpperCase("it-IT");
  if (!name) { input.setAttribute("aria-invalid", "true"); input.focus(); return; }
  input.removeAttribute("aria-invalid");
  appData.name = name;
  persistData();
  cancelRenameHouse();
  showToast("Nome aggiornato");
}

async function shareHouseCode() {
  const text = `Unisciti a “${appData.name || "la mia casa"}” su Dispensa & Casa con questo codice casa: ${householdCode}`;
  if (navigator.share) {
    try { await navigator.share({ text: text }); return; }
    catch (err) { if (err.name === "AbortError") return; }
  }
  try {
    await navigator.clipboard.writeText(householdCode);
    showToast("Codice copiato");
  } catch (err) {
    showToast("Copia non riuscita");
  }
}

/* ==========================================================
   4. LOGICA NAVIGAZIONE ED ELEMENTI
========================================================== */
function updateBadge() {
  const pendingSpesa = (appData.spesa || []).filter(item => !item.done).length;
  const badge = document.getElementById("spesa-badge");
  if (pendingSpesa > 0) {
    badge.textContent = pendingSpesa;
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }
}

function renderHomeTiles() {
  const container = document.getElementById("tiles-container");
  container.innerHTML = "";

  Object.keys(appData.categories || {}).forEach(catKey => {
    const cat = appData.categories[catKey];
    const items = (appData.inventory && appData.inventory[catKey]) || [];
    const count = items.length;

    const tile = document.createElement("div");
    tile.className = "tile-card";
    if (cat.color) {
      tile.style.setProperty('--tint', cat.color);
    }
    tile.onclick = () => openCategory(catKey);

    tile.innerHTML = `
      <div class="tile-icon">${cat.icon || '📦'}</div>
      <div>
        <div class="tile-title">${escapeHtml(cat.title)}</div>
        <div class="tile-count">${count} ${count === 1 ? 'prodotto' : 'prodotti'}</div>
      </div>
    `;
    container.appendChild(tile);
  });

  const addTile = document.createElement("div");
  addTile.className = "tile-card tile-add-new";
  addTile.onclick = openNewCategoryModal;
  addTile.innerHTML = `
    <div class="plus-circle"><svg aria-hidden="true"><use href="#i-add"/></svg></div>
    <div class="tile-title">Nuova categoria</div>
  `;
  container.appendChild(addTile);
}

function showHome() {
  currentCategory = null;
  document.getElementById("view-home").classList.add("active");
  document.getElementById("view-category").classList.remove("active");
  document.getElementById("view-spesa").classList.remove("active");

  document.getElementById("tab-home").classList.add("active");
  document.getElementById("tab-spesa").classList.remove("active");

  document.getElementById("header-title").textContent = appData.name || "Casa & Scorte";
  document.getElementById("btn-header-back").hidden = true;
  document.getElementById("btn-header-settings").hidden = true;

  renderHomeTiles();
}

function openCategory(catKey) {
  currentCategory = catKey;
  const meta = appData.categories[catKey] || { title: "Categoria", icon: "📦" };

  document.getElementById("view-home").classList.remove("active");
  document.getElementById("view-spesa").classList.remove("active");
  document.getElementById("view-category").classList.add("active");

  document.getElementById("header-title").textContent = `${meta.icon || ''} ${meta.title}`;
  document.getElementById("btn-header-back").hidden = false;
  document.getElementById("btn-header-settings").hidden = false;

  renderCategoryItems();
}

function switchToTab(tabName) {
  if (tabName === 'home') {
    showHome();
  } else if (tabName === 'spesa') {
    currentCategory = null;
    document.getElementById("view-home").classList.remove("active");
    document.getElementById("view-category").classList.remove("active");
    document.getElementById("view-spesa").classList.add("active");

    document.getElementById("tab-home").classList.remove("active");
    document.getElementById("tab-spesa").classList.add("active");

    document.getElementById("header-title").textContent = "Lista Spesa";
    document.getElementById("btn-header-back").hidden = true;
    document.getElementById("btn-header-settings").hidden = true;
    renderSpesaItems();
  }
}

/* Modal Impostazioni Categoria (Modifica & Elimina) */
function openCategorySettingsModal() {
  if (!currentCategory || !appData.categories[currentCategory]) return;
  const meta = appData.categories[currentCategory];
  document.getElementById("input-edit-cat-title").value = meta.title || "";
  document.getElementById("input-edit-cat-icon").value = meta.icon || "";
  document.getElementById("modal-category-settings").classList.add("active");
}

function closeCategorySettingsModal() {
  document.getElementById("modal-category-settings").classList.remove("active");
}

function saveCategorySettings() {
  if (!currentCategory || !appData.categories[currentCategory]) return;
  const title = document.getElementById("input-edit-cat-title").value.trim();
  const icon = document.getElementById("input-edit-cat-icon").value.trim() || "📦";

  if (!title) {
    alert("Inserisci un nome valido.");
    return;
  }

  appData.categories[currentCategory].title = title;
  appData.categories[currentCategory].icon = icon;

  persistData();
  closeCategorySettingsModal();
  document.getElementById("header-title").textContent = `${icon} ${title}`;
}

function deleteCurrentCategory() {
  if (!currentCategory || !appData.categories[currentCategory]) return;
  const catTitle = appData.categories[currentCategory].title || "questa categoria";
  const itemsCount = (appData.inventory && appData.inventory[currentCategory]) ? appData.inventory[currentCategory].length : 0;

  const confirmMessage = itemsCount > 0
    ? `Sei sicuro di voler eliminare "${catTitle}" e i suoi ${itemsCount} articoli salvati?\n\nL'operazione non può essere annullata.`
    : `Sei sicuro di voler eliminare la categoria "${catTitle}"?`;

  if (!confirm(confirmMessage)) {
    return;
  }

  const deletedCatKey = currentCategory;

  // 1. Rimuovi la categoria e il suo inventario
  delete appData.categories[deletedCatKey];
  if (appData.inventory && appData.inventory[deletedCatKey]) {
    delete appData.inventory[deletedCatKey];
  }

  // 2. Rimuovi il riferimento alla categoria negli articoli della spesa
  if (appData.spesa) {
    appData.spesa.forEach(item => {
      if (item.fromCat === deletedCatKey) {
        item.fromCat = null;
      }
    });
  }

  closeCategorySettingsModal();
  persistData();
  showHome();
}

const CATEGORY_COLORS = ["var(--tint-blue)", "var(--tint-orange)", "var(--tint-purple)", "var(--tint-green)", "#5856D6", "#FF2D55"];

/* Crea una categoria in memoria (senza salvare) e ne restituisce l'id */
function addCategory(title, icon) {
  const catId = "cat_" + Date.now();
  appData.categories[catId] = {
    title: title,
    icon: icon || "📦",
    color: CATEGORY_COLORS[Math.floor(Math.random() * CATEGORY_COLORS.length)]
  };
  if (!appData.inventory) appData.inventory = {};
  appData.inventory[catId] = [];
  return catId;
}

/* Aggiunge un articolo a una categoria (senza salvare) */
function pushItem(catKey, name, qty) {
  if (!appData.inventory) appData.inventory = {};
  if (!appData.inventory[catKey]) appData.inventory[catKey] = [];
  appData.inventory[catKey].push({
    id: "item_" + Date.now(),
    name: name,
    qty: isNaN(qty) ? 1 : Math.max(0, qty)
  });
}

/* Modal Nuova Categoria */
function openNewCategoryModal() {
  document.getElementById("input-new-cat-title").value = "";
  document.getElementById("input-new-cat-icon").value = "";
  document.getElementById("modal-new-category").classList.add("active");
  setTimeout(() => document.getElementById("input-new-cat-title").focus(), 100);
}

function closeNewCategoryModal() {
  document.getElementById("modal-new-category").classList.remove("active");
}

function createNewCategory() {
  const title = document.getElementById("input-new-cat-title").value.trim();
  let icon = document.getElementById("input-new-cat-icon").value.trim() || "📦";

  if (!title) {
    alert("Il nome della categoria è obbligatorio.");
    return;
  }

  addCategory(title, icon);

  persistData();
  closeNewCategoryModal();
}

/* Gestione Articoli Scorte */
function renderCategoryItems() {
  const container = document.getElementById("category-items-container");
  container.innerHTML = "";

  const items = (appData.inventory && appData.inventory[currentCategory]) || [];
  if (items.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        Nessun articolo in questa categoria.<br>
        Aggiungi il primo elemento usando il modulo sopra!
      </div>
    `;
    return;
  }

  items.forEach(item => {
    let statusClass = "status-ok";
    let statusText = "Disponibile";

    if (item.qty === 0) {
      statusClass = "status-empty";
      statusText = "Terminato (0)";
    } else if (item.qty <= 1) {
      statusClass = "status-low";
      statusText = "Scorta Bassa (1)";
    }

    const div = document.createElement("div");
    div.className = "item-card";
    div.innerHTML = `
      <div class="item-info">
        <span class="item-name">${escapeHtml(item.name)}</span>
        <span class="item-status ${statusClass}">${statusText}</span>
      </div>
      <div class="item-actions">
        <button class="btn-quick-spesa" title="Aggiungi a spesa" aria-label="Aggiungi alla spesa" onclick="addSingleToSpesa('${escapeHtml(item.name)}', '${currentCategory}')"><svg class="ico" aria-hidden="true"><use href="#i-cart"/></svg></button>
        <button class="qty-btn" aria-label="Diminuisci" onclick="updateQty('${item.id}', -1)"><svg class="ico" aria-hidden="true"><use href="#i-minus-s"/></svg></button>
        <span class="qty-value">${item.qty}</span>
        <button class="qty-btn" aria-label="Aumenta" onclick="updateQty('${item.id}', 1)"><svg class="ico" aria-hidden="true"><use href="#i-add-s"/></svg></button>
        <button class="qty-btn danger" aria-label="Elimina articolo" onclick="deleteItem('${item.id}')"><svg class="ico" aria-hidden="true"><use href="#i-dismiss-s"/></svg></button>
      </div>
    `;
    container.appendChild(div);
  });
}

function addItem() {
  const nameInput = document.getElementById("input-item-name");
  const qtyInput = document.getElementById("input-item-qty");
  const name = nameInput.value.trim();
  const qty = parseInt(qtyInput.value, 10);

  if (!name) return;

  pushItem(currentCategory, name, qty);
  persistData();

  nameInput.value = "";
  qtyInput.value = 1;
  nameInput.blur();
}

function updateQty(id, delta) {
  const item = appData.inventory[currentCategory].find(i => i.id === id);
  if (item) {
    item.qty = Math.max(0, item.qty + delta);
    persistData();
  }
}

function deleteItem(id) {
  appData.inventory[currentCategory] = appData.inventory[currentCategory].filter(i => i.id !== id);
  persistData();
}

/* Gestione Lista Spesa con Swipe to Dismiss */
function renderSpesaItems() {
  const container = document.getElementById("spesa-items-container");
  container.innerHTML = "";

  const spesaList = appData.spesa || [];
  if (spesaList.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        La lista della spesa è vuota! 🎉<br>
        Tocca <strong>"Carica esauriti"</strong> per caricare gli articoli finiti o inseriscine uno manualmente.
      </div>
    `;
    return;
  }

  spesaList.forEach(item => {
    const catMeta = item.fromCat ? appData.categories[item.fromCat] : null;
    const catBadge = catMeta ? `<span class="category-tag">${catMeta.icon || ''} ${escapeHtml(catMeta.title)}</span>` : '';

    const swipeContainer = document.createElement("div");
    swipeContainer.className = "swipe-container";
    swipeContainer.id = `swipe-${item.id}`;

    swipeContainer.innerHTML = `
      <div class="swipe-action-bg" onclick="dismissSpesaItem('${item.id}')">
        <svg class="ico" aria-hidden="true"><use href="#i-delete"/></svg> Elimina
      </div>
      <div class="spesa-item ${item.done ? 'checked' : ''}" id="item-${item.id}">
        <div class="spesa-main">
          <div class="checkbox" onclick="toggleSpesa('${item.id}')">
            ${item.done ? '<svg class="ico" aria-hidden="true"><use href="#i-checkmark-s"/></svg>' : ''}
          </div>
          <span class="spesa-text">${escapeHtml(item.name)}</span>
          ${catBadge}
        </div>
        <span class="spesa-chevron"><svg class="ico" aria-hidden="true"><use href="#i-chevron-left-s"/></svg></span>
      </div>
    `;

    container.appendChild(swipeContainer);
    attachSwipeEvents(swipeContainer.querySelector('.spesa-item'), item.id);
  });
}

function attachSwipeEvents(element, id) {
  let startX = 0;
  let currentX = 0;
  let isSwiping = false;

  element.addEventListener('touchstart', (e) => {
    startX = e.touches[0].clientX;
    currentX = startX;
    isSwiping = true;
    element.classList.add('swiping');
  }, { passive: true });

  element.addEventListener('touchmove', (e) => {
    if (!isSwiping) return;
    currentX = e.touches[0].clientX;
    const diffX = currentX - startX;

    if (diffX < 0) {
      const clampedDiff = Math.max(diffX, -140);
      element.style.transform = `translateX(${clampedDiff}px)`;
    } else {
      element.style.transform = 'translateX(0px)';
    }
  }, { passive: true });

  element.addEventListener('touchend', () => {
    if (!isSwiping) return;
    isSwiping = false;
    element.classList.remove('swiping');

    const diffX = currentX - startX;

    if (diffX < -115) {
      element.style.transform = 'translateX(-100%)';
      setTimeout(() => dismissSpesaItem(id), 180);
    } else if (diffX < -50) {
      element.style.transform = 'translateX(-90px)';
    } else {
      element.style.transform = 'translateX(0px)';
    }
  });
}

function dismissSpesaItem(id) {
  const container = document.getElementById(`swipe-${id}`);
  if (container) {
    container.classList.add('collapsed');
    setTimeout(() => {
      removeSpesaItem(id);
    }, 280);
  } else {
    removeSpesaItem(id);
  }
}

function toggleSpesa(id) {
  const item = appData.spesa.find(s => s.id === id);
  if (item) {
    item.done = !item.done;
    persistData();
  }
}

function addManualSpesa() {
  const input = document.getElementById("input-spesa-manual");
  const name = input.value.trim();
  if (!name) return;

  if (!appData.spesa) appData.spesa = [];
  appData.spesa.push({
    id: "sp_" + Date.now(),
    name: name,
    done: false,
    fromCat: null
  });

  input.value = "";
  input.blur();
  persistData();
}

function addSingleToSpesa(itemName, cat) {
  if (!appData.spesa) appData.spesa = [];
  const exists = appData.spesa.some(s => s.name.toLowerCase() === itemName.toLowerCase() && !s.done);
  if (!exists) {
    appData.spesa.push({
      id: "sp_" + Date.now(),
      name: itemName,
      done: false,
      fromCat: cat
    });
    persistData();
    alert(`"${itemName}" aggiunto alla lista spesa!`);
  } else {
    alert(`"${itemName}" è già presente nella lista spesa.`);
  }
}

function autoPopulateSpesa() {
  let added = 0;
  if (!appData.spesa) appData.spesa = [];

  Object.keys(appData.inventory || {}).forEach(cat => {
    appData.inventory[cat].forEach(item => {
      if (item.qty <= 1) {
        const alreadyInSpesa = appData.spesa.some(s => s.name.toLowerCase() === item.name.toLowerCase() && !s.done);
        if (!alreadyInSpesa) {
          appData.spesa.push({
            id: "sp_" + Date.now() + Math.random().toString(36).substr(2, 4),
            name: item.name,
            done: false,
            fromCat: cat
          });
          added++;
        }
      }
    });
  });

  persistData();
  alert(added > 0 ? `Aggiunti ${added} articoli in esaurimento!` : "Tutti gli articoli esauriti sono già in lista.");
}

function clearPurchasedSpesa() {
  appData.spesa = (appData.spesa || []).filter(s => !s.done);
  persistData();
}

function removeSpesaItem(id) {
  appData.spesa = (appData.spesa || []).filter(s => s.id !== id);
  persistData();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/* ==========================================================
   Modal Nuovo Prodotto
========================================================== */
const NEW_CATEGORY = "__new__";
let newItemCategory = null;
let toastTimer = null;

function openNewItemModal() {
  document.getElementById("input-ni-name").value = "";
  document.getElementById("input-ni-qty").value = 1;
  document.getElementById("input-ni-cat-title").value = "";
  document.getElementById("input-ni-cat-icon").value = "";
  clearInvalid();

  const keys = Object.keys(appData.categories || {});
  newItemCategory = (currentCategory && appData.categories[currentCategory]) ? currentCategory : (keys[0] || NEW_CATEGORY);
  renderNewItemChips();

  document.getElementById("modal-new-item").classList.add("active");
  setTimeout(() => document.getElementById("input-ni-name").focus(), 100);
}

function closeNewItemModal() {
  document.getElementById("modal-new-item").classList.remove("active");
  document.activeElement && document.activeElement.blur();
}

function renderNewItemChips() {
  const box = document.getElementById("ni-chips");
  box.innerHTML = "";
  Object.keys(appData.categories || {}).forEach(key => {
    const cat = appData.categories[key];
    box.appendChild(makeChip(key, `${cat.icon || "📦"} ${cat.title}`, false));
  });
  box.appendChild(makeChip(NEW_CATEGORY, "+ Nuova categoria", true));
  document.getElementById("ni-newcat").hidden = newItemCategory !== NEW_CATEGORY;
}

function makeChip(key, label, isNew) {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "chip" + (isNew ? " chip-new" : "");
  chip.textContent = label;
  chip.setAttribute("role", "radio");
  chip.setAttribute("aria-checked", String(newItemCategory === key));
  chip.onclick = () => selectNewItemCategory(key);
  return chip;
}

function selectNewItemCategory(key) {
  newItemCategory = key;
  clearInvalid();
  renderNewItemChips();
  if (key === NEW_CATEGORY) {
    setTimeout(() => document.getElementById("input-ni-cat-title").focus(), 50);
  }
}

function clearInvalid() {
  document.querySelectorAll("#modal-new-item input").forEach(i => i.removeAttribute("aria-invalid"));
}

function markInvalid(id) {
  const el = document.getElementById(id);
  el.setAttribute("aria-invalid", "true");
  el.focus();
}

function saveNewItem() {
  clearInvalid();
  const name = document.getElementById("input-ni-name").value.trim();
  const qty = parseInt(document.getElementById("input-ni-qty").value, 10);
  if (!name) { markInvalid("input-ni-name"); return; }

  let catKey = newItemCategory;
  if (catKey === NEW_CATEGORY) {
    const title = document.getElementById("input-ni-cat-title").value.trim();
    const icon = document.getElementById("input-ni-cat-icon").value.trim();
    if (!title) { markInvalid("input-ni-cat-title"); return; }
    catKey = addCategory(title, icon);
  }

  pushItem(catKey, name, qty);
  persistData();
  closeNewItemModal();
  showToast(`${name} aggiunto a ${appData.categories[catKey].title}`);
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2400);
}

["input-ni-name", "input-ni-qty", "input-ni-cat-title"].forEach(id => {
  document.getElementById(id).addEventListener("keydown", e => { if (e.key === "Enter") saveNewItem(); });
});

// Inizializzazione Sincronizzazione / Locale
initSync();

// Primo accesso: nessuna casa e nessun dato locale → crea la casa
if (!householdCode && !hasLocalData()) {
  openWelcome("create", false);
}

// Invio dalla tastiera nelle schermate di benvenuto
document.getElementById("input-house-name").addEventListener("keydown", e => { if (e.key === "Enter") createHouse(); });
document.getElementById("input-join-code").addEventListener("keydown", e => { if (e.key === "Enter") joinHouse(); });
document.getElementById("input-rename-house").addEventListener("keydown", e => { if (e.key === "Enter") saveHouseName(); });

// Service Worker PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then(reg => console.log('SW registrato:', reg.scope))
      .catch(err => console.error('Errore SW:', err));
  });
}
