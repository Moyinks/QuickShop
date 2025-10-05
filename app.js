// ========================================
// QuickShop - Production-Ready JavaScript
// ========================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  sendPasswordResetEmail,
  sendEmailVerification,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAw8di7eWu6TKFCJMuNwcIUh2RT1I0OPh0",
  authDomain: "quickshop-6a4ad.firebaseapp.com",
  projectId: "quickshop-6a4ad",
  storageBucket: "quickshop-6a4ad.firebasestorage.app",
  messagingSenderId: "983595260829",
  appId: "1:983595260829:web:0e772d1ed07b8f32eb2d74"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// State
const KEY = 'quickshop_stable_v1';
const MAX_IMAGE_SIZE = 500 * 1024;
let state = { products: [], sales: [], changes: [], notes: [] };
let currentUser = null;

const CATEGORIES = ['All', 'Drinks', 'Snacks', 'Groceries', 'Clothing', 'Others'];
const DAY = 24 * 60 * 60 * 1000;

let activeCategory = 'All';
let modalContext = null;
let aiVisible = false;
let invImageData = null;
let activeReportRange = 'daily';
let editingNoteId = null;
let searchTimer = null;
let isSyncing = false;

// DOM Elements - Auth
const loginScreen = document.getElementById("loginScreen");
const appScreen = document.querySelector(".app");
const loginForm = document.getElementById("loginForm");
const signupForm = document.getElementById("signupForm");
const resetForm = document.getElementById("resetForm");
const verificationNotice = document.getElementById("verificationNotice");
const authLoading = document.getElementById("authLoading");

const loginEmail = document.getElementById("loginEmail");
const loginPass = document.getElementById("loginPass");
const signupName = document.getElementById("signupName");
const signupBusiness = document.getElementById("signupBusiness");
const signupEmail = document.getElementById("signupEmail");
const signupPass = document.getElementById("signupPass");
const signupPassConfirm = document.getElementById("signupPassConfirm");
const resetEmail = document.getElementById("resetEmail");

const btnLogin = document.getElementById("btnLogin");
const btnShowSignup = document.getElementById("btnShowSignup");
const btnSignup = document.getElementById("btnSignup");
const btnBackToLogin = document.getElementById("btnBackToLogin");
const btnForgotPassword = document.getElementById("btnForgotPassword");
const btnBackToLoginFromReset = document.getElementById("btnBackToLoginFromReset");
const btnSendReset = document.getElementById("btnSendReset");
const btnCheckVerification = document.getElementById("btnCheckVerification");
const btnResendVerification = document.getElementById("btnResendVerification");
const btnLogoutFromVerification = document.getElementById("btnLogoutFromVerification");
const btnLogout = document.getElementById('btnLogout');
const userEmailEl = document.getElementById('userEmail');
const userDisplayNameEl = document.getElementById('userDisplayName');

// Utilities
function uid() { return 'p' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36); }
function n(v) { const num = Number(v || 0); return isNaN(num) ? 0 : num; }
function fmt(v) { return '₦' + Number(v || 0).toLocaleString('en-NG'); }
function startOfDay(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }
function escapeHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function formatShortDate(ts) { return new Date(ts).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' }); }
function formatDateTime(ts) { return new Date(ts).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }

function toast(msg, type = 'info') {
  const t = document.createElement('div');
  t.textContent = msg;
  Object.assign(t.style, {
    position: 'fixed', right: '14px', bottom: '90px', zIndex: 600,
    background: type === 'error' ? '#fee' : 'white',
    color: type === 'error' ? '#ef4444' : '#07122b',
    padding: '12px 16px', borderRadius: '10px',
    boxShadow: '0 8px 24px rgba(2,6,23,0.12)', fontWeight: 700,
    animation: 'slideIn 0.3s ease',
    border: type === 'error' ? '1px solid #ef4444' : 'none'
  });
  document.body.appendChild(t);
  setTimeout(() => { t.style.animation = 'fadeOut 0.3s ease'; setTimeout(() => t.remove(), 300); }, type === 'error' ? 3000 : 2000);
}

function showLoading(show = true) {
  let overlay = document.getElementById('loadingOverlay');
  if (!overlay && show) {
    overlay = document.createElement('div');
    overlay.id = 'loadingOverlay';
    overlay.className = 'loading-overlay active';
    overlay.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>Syncing...</p></div>';
    document.body.appendChild(overlay);
  } else if (overlay) {
    overlay.classList.toggle('active', show);
  }
}

function validateEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }

function validateProduct(name, price, cost, qty) {
  if (!name || name.trim().length === 0) return { valid: false, error: 'Product name is required' };
  if (price <= 0) return { valid: false, error: 'Price must be greater than 0' };
  if (cost < 0) return { valid: false, error: 'Cost cannot be negative' };
  if (qty < 0) return { valid: false, error: 'Stock cannot be negative' };
  return { valid: true };
}

function hideAllAuthForms() {
  loginForm.style.display = 'none';
  signupForm.style.display = 'none';
  resetForm.style.display = 'none';
  verificationNotice.style.display = 'none';
  authLoading.style.display = 'none';
}

function showLoginForm() {
  hideAllAuthForms();
  loginForm.style.display = 'flex';
  clearAuthInputs();
}

function showSignupForm() {
  hideAllAuthForms();
  signupForm.style.display = 'flex';
  clearAuthInputs();
}

function showResetForm() {
  hideAllAuthForms();
  resetForm.style.display = 'flex';
}

function showVerificationNotice(email) {
  hideAllAuthForms();
  verificationNotice.style.display = 'flex';
  document.getElementById('verificationEmail').textContent = email;
}

function showAuthLoading() {
  hideAllAuthForms();
  authLoading.style.display = 'flex';
}

function clearAuthInputs() {
  [loginEmail, loginPass, signupName, signupBusiness, signupEmail, signupPass, signupPassConfirm, resetEmail].forEach(input => {
    if (input) {
      input.value = '';
      input.classList.remove('error');
    }
  });
}

// Data Management
async function saveState() {
  if (isSyncing || !currentUser) return;
  isSyncing = true;
  try {
    showLoading(true);
    await setDoc(doc(db, "users", currentUser.uid), { ...state, lastSync: Date.now() }, { merge: true });
    localStorage.setItem(KEY + '_' + currentUser.uid, JSON.stringify(state));
  } catch (err) {
    console.error("Save failed:", err);
    toast('Cloud sync failed. Data saved locally.', 'error');
    try {
      localStorage.setItem(KEY + '_' + currentUser.uid, JSON.stringify(state));
    } catch (e) {
      console.error('localStorage save failed', e);
      toast('Storage limit reached. Consider removing old data.', 'error');
    }
  } finally {
    showLoading(false);
    isSyncing = false;
  }
}

async function loadUserData(user) {
  currentUser = user;
  try {
    showLoading(true);
    const docSnap = await getDoc(doc(db, "users", user.uid));
    const localData = JSON.parse(localStorage.getItem(KEY + '_' + user.uid) || 'null');
    
    if (docSnap.exists()) {
      const cloudData = docSnap.data();
      if (localData && localData.lastSync && cloudData.lastSync && localData.lastSync > cloudData.lastSync) {
        if (confirm('Local data is newer. Upload to cloud?')) {
          state = localData;
          await setDoc(doc(db, "users", user.uid), { ...localData, lastSync: Date.now() });
        } else {
          state = cloudData;
        }
      } else {
        state = cloudData;
      }
    } else {
      if (localData) {
        state = localData;
      } else {
        state = { products: [], sales: [], changes: [], notes: [] };
      }
      await setDoc(doc(db, "users", user.uid), { ...state, lastSync: Date.now() });
    }
    
    state.notes = state.notes || [];
  } catch (err) {
    console.error("Load user data failed:", err);
    toast('Failed to load cloud data. Using local data.', 'error');
    const localData = JSON.parse(localStorage.getItem(KEY + '_' + user.uid) || 'null');
    if (localData) state = localData;
    else state = { products: [], sales: [], changes: [], notes: [] };
  } finally {
    showLoading(false);
    init();
  }
}

// Authentication Event Listeners
btnShowSignup?.addEventListener('click', showSignupForm);
btnBackToLogin?.addEventListener('click', showLoginForm);
btnForgotPassword?.addEventListener('click', showResetForm);
btnBackToLoginFromReset?.addEventListener('click', showLoginForm);

btnLogin?.addEventListener("click", async () => {
  const email = loginEmail.value.trim();
  const pass = loginPass.value;
  
  loginEmail.classList.remove('error');
  loginPass.classList.remove('error');
  
  if (!validateEmail(email)) {
    toast('Please enter a valid email', 'error');
    loginEmail.classList.add('error');
    return;
  }
  if (pass.length < 6) {
    toast('Password must be at least 6 characters', 'error');
    loginPass.classList.add('error');
    return;
  }
  
  try {
    showAuthLoading();
    const userCredential = await signInWithEmailAndPassword(auth, email, pass);
    
    if (!userCredential.user.emailVerified) {
      toast('Please verify your email before logging in', 'error');
      showVerificationNotice(email);
      return;
    }
    
    toast('Login successful');
  } catch (err) {
    showLoginForm();
    let msg = 'Login failed';
    if (err.code === 'auth/user-not-found') msg = 'No account found with this email';
    else if (err.code === 'auth/wrong-password') msg = 'Incorrect password';
    else if (err.code === 'auth/too-many-requests') msg = 'Too many attempts. Try again later';
    else if (err.code === 'auth/invalid-credential') msg = 'Invalid email or password';
    toast(msg, 'error');
  }
});

btnSignup?.addEventListener("click", async () => {
  const name = signupName.value.trim();
  const business = signupBusiness.value.trim();
  const email = signupEmail.value.trim();
  const pass = signupPass.value;
  const passConfirm = signupPassConfirm.value;
  
  [signupName, signupEmail, signupPass, signupPassConfirm].forEach(input => input.classList.remove('error'));
  
  if (!name) {
    toast('Please enter your full name', 'error');
    signupName.classList.add('error');
    return;
  }
  if (!validateEmail(email)) {
    toast('Please enter a valid email', 'error');
    signupEmail.classList.add('error');
    return;
  }
  if (pass.length < 6) {
    toast('Password must be at least 6 characters', 'error');
    signupPass.classList.add('error');
    return;
  }
  if (pass !== passConfirm) {
    toast('Passwords do not match', 'error');
    signupPassConfirm.classList.add('error');
    return;
  }
  
  try {
    showAuthLoading();
    const userCredential = await createUserWithEmailAndPassword(auth, email, pass);
    
    const displayName = business ? `${name} (${business})` : name;
    await updateProfile(userCredential.user, { displayName });
    
    await sendEmailVerification(userCredential.user);
    
    toast('Account created! Please check your email for verification.');
    showVerificationNotice(email);
  } catch (err) {
    showSignupForm();
    let msg = 'Signup failed';
    if (err.code === 'auth/email-already-in-use') msg = 'Email already registered';
    else if (err.code === 'auth/weak-password') msg = 'Password is too weak';
    else if (err.code === 'auth/invalid-email') msg = 'Invalid email address';
    toast(msg, 'error');
  }
});

btnSendReset?.addEventListener('click', async () => {
  const email = resetEmail.value.trim();
  resetEmail.classList.remove('error');
  
  if (!validateEmail(email)) {
    toast('Please enter a valid email', 'error');
    resetEmail.classList.add('error');
    return;
  }
  
  try {
    showAuthLoading();
    await sendPasswordResetEmail(auth, email);
    toast('Password reset email sent. Check your inbox.');
    showLoginForm();
  } catch (err) {
    showResetForm();
    let msg = 'Failed to send reset email';
    if (err.code === 'auth/user-not-found') msg = 'No account found with this email';
    toast(msg, 'error');
  }
});

btnCheckVerification?.addEventListener('click', async () => {
  try {
    showAuthLoading();
    await auth.currentUser.reload();
    
    if (auth.currentUser.emailVerified) {
      toast('Email verified! Welcome to QuickShop');
    } else {
      toast('Email not verified yet. Please check your inbox and click the verification link.', 'error');
      showVerificationNotice(auth.currentUser.email);
    }
  } catch (err) {
    toast('Error checking verification status', 'error');
    showVerificationNotice(auth.currentUser.email);
  }
});

btnResendVerification?.addEventListener('click', async () => {
  try {
    if (auth.currentUser) {
      await sendEmailVerification(auth.currentUser);
      toast('Verification email resent. Check your inbox.');
    }
  } catch (err) {
    toast('Failed to resend verification email. Try again later.', 'error');
  }
});

btnLogoutFromVerification?.addEventListener('click', async () => {
  try {
    await signOut(auth);
    toast('Logged out');
    showLoginForm();
  } catch (err) {
    toast('Logout failed', 'error');
  }
});

btnLogout?.addEventListener('click', async () => {
  if (!confirm('Are you sure you want to sign out?')) return;
  try {
    await signOut(auth);
    toast('Signed out successfully');
  } catch (err) {
    toast('Sign out failed: ' + err.message, 'error');
  }
});

// Auth State Observer
onAuthStateChanged(auth, async (user) => {
  if (user) {
    if (!user.emailVerified) {
      loginScreen.style.display = "flex";
      appScreen.style.display = "none";
      showVerificationNotice(user.email);
      return;
    }
    
    loginScreen.style.display = "none";
    appScreen.style.display = "block";
    
    if (userEmailEl) userEmailEl.textContent = user.email;
    if (userDisplayNameEl) {
      const displayText = user.displayName ? `Name: ${user.displayName}` : '';
      userDisplayNameEl.textContent = displayText;
    }
    
    await loadUserData(user);
  } else {
    currentUser = null;
    loginScreen.style.display = "flex";
    appScreen.style.display = "none";
    showLoginForm();
    if (userEmailEl) userEmailEl.textContent = "—";
    if (userDisplayNameEl) userDisplayNameEl.textContent = "";
    state = { products: [], sales: [], changes: [], notes: [] };
  }
});

[loginEmail, loginPass, signupName, signupEmail, signupPass, signupPassConfirm, resetEmail].forEach(input => {
  input?.addEventListener('input', () => input.classList.remove('error'));
});

// Categories
function renderChips() {
  const chipsEl = document.getElementById('chips');
  chipsEl.innerHTML = '';
  CATEGORIES.forEach(c => {
    const el = document.createElement('button');
    el.className = 'chip' + (c === activeCategory ? ' active' : '');
    el.textContent = c; el.type = 'button';
    el.addEventListener('click', () => { activeCategory = c; renderChips(); renderProducts(); });
    chipsEl.appendChild(el);
  });
}

// Search
function scheduleRenderProducts() { clearTimeout(searchTimer); searchTimer = setTimeout(renderProducts, 120); }
document.getElementById('searchInput')?.addEventListener('input', scheduleRenderProducts);

// Products
function renderProducts() {
  const productListEl = document.getElementById('productList');
  productListEl.innerHTML = '';
  const q = (document.getElementById('searchInput').value || '').trim().toLowerCase();
  const items = state.products.filter(p => {
    if (activeCategory !== 'All' && (p.category || 'Others') !== activeCategory) return false;
    if (q && !((p.name || '').toLowerCase().includes(q))) return false;
    return true;
  });
  if (items.length === 0) {
    productListEl.innerHTML = `<div style="padding:14px;background:var(--card-bg);border-radius:12px;border:1px solid rgba(7,18,43,0.04)" class="small">No products — add from Inventory or load demo</div>`;
    return;
  }
  for (const p of items) {
    const card = document.createElement('div'); card.className = 'product-card';
    const thumbHtml = p.image ? `<img src="${p.image}" alt="${escapeHtml(p.name)}">` : (p.icon ? `<div>${escapeHtml(p.icon)}</div>` : `<div>${escapeHtml((p.name || '').split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase())}</div>`);
    const qtyText = (typeof p.qty === 'number') ? `${p.qty} in stock` : '—';
    card.innerHTML = `<div class="p-thumb">${thumbHtml}</div><div class="p-info"><div class="p-name">${escapeHtml(p.name)}</div><div class="p-sub">${qtyText} • ${fmt(p.price)}</div></div><div class="p-actions"><div class="p-actions-row"><button data-action="sell" data-id="${p.id}" class="btn-sell">Sell</button><button data-action="undo" data-id="${p.id}" class="btn-undo">Undo</button></div></div>`;
    productListEl.appendChild(card);
  }
}

document.getElementById('productList')?.addEventListener('click', (ev) => {
  const sellBtn = ev.target.closest('[data-action="sell"]');
  if (sellBtn) { openModalFor('sell', sellBtn.dataset.id); return; }
  const undoBtn = ev.target.closest('[data-action="undo"]');
  if (undoBtn) { undoLastFor(undoBtn.dataset.id); return; }
});

// Modal
function showModal() { document.getElementById('modalBackdrop').style.display = 'flex'; setTimeout(() => document.getElementById('modalQty').focus(), 100); }
function hideModal() { document.getElementById('modalBackdrop').style.display = 'none'; modalContext = null; }

function openModalFor(mode, productId) {
  const p = state.products.find(x => x.id === productId);
  if (!p) { toast('Product not found', 'error'); return; }
  modalContext = { mode, productId };
  document.getElementById('modalTitle').textContent = mode === 'sell' ? 'Sell items' : 'Add stock';
  document.getElementById('modalItem').textContent = `${p.name} — ${typeof p.qty === 'number' ? p.qty + ' in stock' : 'stock unknown'}`;
  document.getElementById('modalQty').value = 1;
  showModal();
}

document.getElementById('modalCancel')?.addEventListener('click', hideModal);
document.getElementById('modalBackdrop')?.addEventListener('click', (e) => { if (e.target.id === 'modalBackdrop') hideModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideModal(); });

document.getElementById('modalConfirm')?.addEventListener('click', () => {
  if (!modalContext) { hideModal(); return; }
  const q = Math.max(1, Math.floor(n(document.getElementById('modalQty').value)));
  if (modalContext.mode === 'sell') doSell(modalContext.productId, q); else doAddStock(modalContext.productId, q);
  hideModal();
});

// Actions
function doAddStock(productId, qty) {
  const p = state.products.find(x => x.id === productId);
  if (!p) return;
  p.qty = (typeof p.qty === 'number' ? p.qty : 0) + qty;
  state.changes.push({ type: 'add', productId, qty, ts: Date.now() });
  saveState(); renderInventory(); renderProducts(); renderDashboard();
  toast(`Added ${qty} to ${p.name}`);
}

function doSell(productId, qty) {
  const p = state.products.find(x => x.id === productId);
  if (!p) return;
  if (typeof p.qty !== 'number') p.qty = 0;
  if (p.qty < qty) { if (!confirm(`${p.name} has only ${p.qty} in stock. Sell anyway?`)) return; }
  p.qty = Math.max(0, p.qty - qty);
  state.sales.push({ productId, qty, price: n(p.price), cost: n(p.cost), ts: Date.now() });
  state.changes.push({ type: 'sell', productId, qty, ts: Date.now() });
  saveState(); renderInventory(); renderProducts(); renderDashboard();
  toast(`Sold ${qty} × ${p.name}`);
}

function undoLastFor(productId) {
  for (let i = state.changes.length - 1; i >= 0; i--) {
    const ch = state.changes[i];
    if (ch.productId !== productId) continue;
    if (ch.type === 'add') {
      const p = state.products.find(x => x.id === productId);
      if (p) p.qty = (typeof p.qty === 'number' ? Math.max(0, p.qty - ch.qty) : 0);
      state.changes.splice(i, 1);
      saveState(); renderInventory(); renderProducts(); renderDashboard();
      toast(`Reverted add of ${ch.qty}`); return;
    }
    if (ch.type === 'sell') {
      for (let j = state.sales.length - 1; j >= 0; j--) {
        const s = state.sales[j];
        if (s.productId === productId && s.qty === ch.qty && Math.abs(s.ts - ch.ts) < 120000) {
          state.sales.splice(j, 1);
          const p = state.products.find(x => x.id === productId);
          if (p) p.qty = (typeof p.qty === 'number' ? p.qty + ch.qty : ch.qty);
          state.changes.splice(i, 1);
          saveState(); renderInventory(); renderProducts(); renderDashboard();
          toast(`Reverted sale of ${ch.qty}`); return;
        }
      }
      const p = state.products.find(x => x.id === productId);
      if (p) p.qty = (typeof p.qty === 'number' ? p.qty + ch.qty : ch.qty);
      state.changes.splice(i, 1);
      saveState(); renderInventory(); renderProducts(); renderDashboard();
      toast('Reverted sale record'); return;
    }
  }
  toast('No recent changes to undo for this product', 'error');
}

// Inventory
document.getElementById('toggleAddFormBtn')?.addEventListener('click', () => {
  const addForm = document.getElementById('addForm');
  const show = addForm.style.display === 'none' || addForm.style.display === '';
  addForm.style.display = show ? 'flex' : 'none';
  if (show) setTimeout(() => document.getElementById('invName').focus(), 80);
});

function clearInvImage() {
  invImageData = null;
  document.getElementById('invImg').value = '';
  document.getElementById('invImgPreview').style.display = 'none';
  document.getElementById('invImgPreviewImg').src = '';
}

document.getElementById('invImg')?.addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) { clearInvImage(); return; }
  if (file.size > MAX_IMAGE_SIZE) { toast('Image too large (max 500KB). Please use a smaller image.', 'error'); e.target.value = ''; return; }
  const reader = new FileReader();
  reader.onload = (ev) => { invImageData = ev.target.result; document.getElementById('invImgPreviewImg').src = invImageData; document.getElementById('invImgPreview').style.display = 'flex'; };
  reader.onerror = () => { toast('Failed to read image', 'error'); clearInvImage(); };
  reader.readAsDataURL(file);
});

document.getElementById('invImgClear')?.addEventListener('click', (e) => { e.preventDefault(); clearInvImage(); });

document.getElementById('addProductBtn')?.addEventListener('click', () => {
  const name = (document.getElementById('invName').value || '').trim();
  const price = n(document.getElementById('invPrice').value);
  const cost = n(document.getElementById('invCost').value);
  const qty = n(document.getElementById('invQty').value);
  const category = document.getElementById('invCategory').value || 'Others';
  const validation = validateProduct(name, price, cost, qty);
  if (!validation.valid) { toast(validation.error, 'error'); return; }
  state.products.push({ id: uid(), name, price, cost, qty: qty || 0, category, image: invImageData || null, icon: null });
  saveState();
  document.getElementById('invName').value = ''; document.getElementById('invPrice').value = ''; document.getElementById('invCost').value = ''; document.getElementById('invQty').value = ''; document.getElementById('invCategory').value = 'Others';
  clearInvImage(); document.getElementById('addForm').style.display = 'none';
  renderInventory(); renderProducts(); renderDashboard(); renderCustomList();
  toast('Product saved');
});

function renderInventory() {
  const inventoryList = document.getElementById('inventoryList');
  inventoryList.innerHTML = '';
  if (state.products.length === 0) {
    inventoryList.innerHTML = `<div style="padding:12px;background:var(--card-bg);border-radius:12px;border:1px solid rgba(7,18,43,0.04)" class="small">No products in inventory</div>`;
    return;
  }
  for (const p of state.products) {
    const el = document.createElement('div'); el.className = 'inventory-card';
    const thumb = p.image ? `<img src="${p.image}" alt="${escapeHtml(p.name)}">` : (p.icon ? `<div>${escapeHtml(p.icon)}</div>` : `<div>${escapeHtml((p.name || '').split(' ').map(x => x[0]).slice(0, 2).join('').toUpperCase())}</div>`);
    el.innerHTML = `<div class="inventory-top"><div class="p-thumb">${thumb}</div><div class="inventory-info"><div class="inventory-name">${escapeHtml(p.name)}</div><div class="inventory-meta">${p.qty || 0} in stock • ${fmt(p.price)}</div></div></div><div class="inventory-actions"><button data-restock="${p.id}" class="btn-restock">Restock</button><button data-edit="${p.id}" class="btn-edit">Edit</button><button data-deleyte="${p.id}" class="btn-delete">Delete</button></div>`;
    inventoryList.appendChild(el);
    }
}
document.getElementById('inventoryList')?.addEventListener('click', (ev) => {
  const restock = ev.target.closespt('[data-restock]');
  if (restock) { openModalFor('add', restock.dataset.restock); return; }
  const edit = ev.target.closest('[data-edit]');
  if (edit) { openEditProduct(edit.dataset.edit); return; }
  const del = ev.target.closest('[data-delete]');
  if (del) { removeProduct(del.dataset.delete); return; }
});

function openEditProduct(id) {
  const p = state.products.find(x => x.id === id);
  if (!p) return;
  const newName = prompt('Name', p.name); if (newName === null) return;
  const newPrice = prompt('Selling price (₦)', String(p.price)); if (newPrice === null) return;
  const newCost = prompt('Cost price (₦)', String(p.cost)); if (newCost === null) return;
  const newQty = prompt('Stock quantity', String(p.qty || 0)); if (newQty === null) return;
  const validation = validateProduct(newName, n(newPrice), n(newCost), n(newQty));
  if (!validation.valid) { toast(validation.error, 'error'); return; }
  p.name = newName.trim(); p.price = n(newPrice); p.cost = n(newCost); p.qty = n(newQty);
  saveState(); renderInventory(); renderProducts(); renderDashboard(); renderCustomList();
  toast('Product updated');
}

function removeProduct(id) {
  const p = state.products.find(x => x.id === id);
  if (!p) return;
  if (!confirm(`Delete "${p.name}" and remove associated history?`)) return;
  state.products = state.products.filter(x => x.id !== id);
  state.sales = state.sales.filter(s => s.productId !== id);
  state.changes = state.changes.filter(c => c.productId !== id);
  saveState(); renderInventory(); renderProducts(); renderDashboard(); renderCustomList();
  toast('Product deleted');
}

// Dashboard
function renderDashboard() {
  const since = startOfDay(Date.now());
  const salesToday = state.sales.filter(s => s.ts >= since);
  const revenue = salesToday.reduce((a, s) => a + s.price * s.qty, 0);
  const cost = salesToday.reduce((a, s) => a + s.cost * s.qty, 0);
  const profit = revenue - cost;
  document.getElementById('dashRevenue').textContent = fmt(revenue);
  document.getElementById('dashProfit').textContent = fmt(profit);
  const byProd = {};
  state.sales.forEach(s => byProd[s.productId] = (byProd[s.productId] || 0) + s.qty);
  const arr = Object.entries(byProd).sort((a, b) => b[1] - a[1]);
  document.getElementById('dashTop').textContent = arr.length ? (state.products.find(p => p.id === arr[0][0])?.name || '—') : '—';
  if (aiVisible) renderInsights();
}

// Insights
function salesInRange(startTs, endTs) { return state.sales.filter(s => s.ts >= startTs && s.ts < endTs); }
function avgDailySales(productId, periodDays = 14) {
  const now = Date.now(); const start = now - periodDays * DAY;
  const sales = salesInRange(start, now).filter(s => s.productId === productId);
  return sales.reduce((a, s) => a + s.qty, 0) / periodDays;
}

function generateInsights() {
  const now = Date.now(); const todayStart = startOfDay(now);
  const weekStart = todayStart - 6 * DAY; const prevWeekStart = weekStart - 7 * DAY; const prevWeekEnd = weekStart;
  const revThisWeek = salesInRange(weekStart, now).reduce((a, s) => a + s.price * s.qty, 0);
  const revPrevWeek = salesInRange(prevWeekStart, prevWeekEnd).reduce((a, s) => a + s.price * s.qty, 0);
  const revChangePct = revPrevWeek === 0 ? (revThisWeek === 0 ? 0 : 100) : ((revThisWeek - revPrevWeek) / revPrevWeek) * 100;
  const byProd = {}; salesInRange(weekStart, now).forEach(s => byProd[s.productId] = (byProd[s.productId] || 0) + s.qty);
  const movers = Object.entries(byProd).map(([pid, qty]) => { const p = state.products.find(x => x.id === pid); return { pid, name: p ? p.name : pid, qty }; }).sort((a, b) => b.qty - a.qty).slice(0, 5);
  const lowMargin = state.products.map(p => { const margin = (n(p.price) - n(p.cost)); const marginPct = n(p.price) ? (margin / n(p.price)) * 100 : 0; return { id: p.id, name: p.name, margin, marginPct, price: n(p.price) }; }).filter(x => x.marginPct < 20).sort((a, b) => a.marginPct - b.marginPct).slice(0, 5);
  const stockWarnings = state.products.map(p => {
    const avgDaily = avgDailySales(p.id, 14);
    const daysLeft = (avgDaily > 0) ? ((typeof p.qty === 'number' ? p.qty : 0) / avgDaily) : Infinity;
    const recommendedOrder = Math.max(0, Math.ceil(avgDaily * 14) - (typeof p.qty === 'number' ? p.qty : 0));
    return { id: p.id, name: p.name, qty: p.qty || 0, avgDaily: Number(avgDaily.toFixed(2)), daysLeft: isFinite(daysLeft) ? Number(daysLeft.toFixed(1)) : Infinity, recommendedOrder };
  });
  const suggestions = [];
  if (revChangePct > 10) suggestions.push(`Good news — revenue is up ${revChangePct.toFixed(0)}% versus last week.`);
  else if (revChangePct < -10) suggestions.push(`Warning — revenue dropped ${Math.abs(revChangePct).toFixed(0)}% versus last week.`);
  else suggestions.push(`Revenue roughly stable vs last week (${revChangePct.toFixed(0)}%).`);
  if (movers.length) { const top = movers[0]; const otherNames = movers.slice(1, 3).map(m => m.name); suggestions.push(`Top seller this week: ${top.name} (${top.qty} sold). Also moving: ${otherNames.join(', ') || '—'}.`); } else { suggestions.push('No sales recorded in the last 7 days.'); }
  if (lowMargin.length) suggestions.push(`Low margins: ${lowMargin.slice(0, 3).map(x => `${x.name} (${Math.round(x.marginPct)}%)`).join(', ')} — consider raising price.`);
  const urgent = stockWarnings.filter(s => isFinite(s.daysLeft) && s.daysLeft <= 3).sort((a, b) => a.daysLeft - b.daysLeft);
  if (urgent.length) suggestions.push(`Running low: ${urgent.slice(0, 3).map(u => `${u.name} (${u.qty} left — ${u.daysLeft} days)`).join(', ')}. Reorder recommended.`);
  else suggestions.push('No immediate stock shortages detected.');
  return { revThisWeek, revPrevWeek, revChangePct, movers, lowMargin, stockWarnings, suggestions };
}

function renderInsights() {
  const ins = generateInsights();
  let html = `<div style="display:flex;gap:10px;align-items:center;margin-bottom:8px"><div style="flex:1"><strong>Revenue (7d)</strong><div class="small">${fmt(ins.revThisWeek)}</div></div><div style="width:140px;text-align:right"><strong>Change</strong><div class="small">${ins.revChangePct >= 0 ? '+' : ''}${ins.revChangePct.toFixed(0)}%</div></div></div><div style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px">`;
  ins.suggestions.forEach(s => html += `<div class="ai-suggestion">${escapeHtml(s)}</div>`);
  html += `</div>`;
  if (ins.movers.length) {
    html += `<div style="margin-bottom:8px"><strong>Top movers (7d)</strong><div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap">`;
    ins.movers.slice(0, 4).forEach(m => html += `<div style="flex:1;min-width:120px;background:#fff;padding:8px;border-radius:10px;border:1px solid rgba(7,18,43,0.04)"><div style="font-weight:800">${escapeHtml(m.name)}</div><div class="small">${m.qty} sold</div></div>`);
    html += `</div></div>`;
  }
  html += `<div><strong>Stock forecast</strong><div class="small" style="margin-top:6px">Days left (based on last 14d avg)</div><div style="margin-top:8px;display:flex;flex-direction:column;gap:8px">`;
  const sorted = ins.stockWarnings.slice().sort((a, b) => (a.daysLeft === Infinity ? 9999 : a.daysLeft) - (b.daysLeft === Infinity ? 9999 : b.daysLeft));
  sorted.slice(0, 6).forEach(s => {
    const safeDays = s.daysLeft === Infinity ? 9999 : Number(s.daysLeft);
    const pct = safeDays >= 30 ? 100 : Math.max(6, Math.min(100, Math.round((safeDays / 30) * 100)));
    const barColor = safeDays <= 3 ? 'linear-gradient(90deg,#ef4444,#f97316)' : (safeDays <= 10 ? 'linear-gradient(90deg,#f59e0b,#f97316)' : 'linear-gradient(90deg,#06b6d4,#3b82f6)');
    html += `<div style="display:flex;gap:8px;align-items:center;justify-content:space-between"><div style="flex:1"><div style="font-weight:700">${escapeHtml(s.name)}</div><div class="small">${s.qty} in stock • avg/day ${s.avgDaily}</div><div class="bar" style="margin-top:6px"><div class="bar-inner" style="width:${pct}%;background:${barColor}"></div></div></div><div style="width:86px;text-align:right"><div class="small">Days</div><div style="font-weight:900">${s.daysLeft === Infinity ? '—' : s.daysLeft}</div><div class="small" style="margin-top:6px">Order ${s.recommendedOrder}</div></div></div>`;
  });
  html += `</div></div>`;
  document.getElementById('aiContent').innerHTML = html;
}

document.getElementById('toggleInsightsBtn')?.addEventListener('click', () => {
  aiVisible = !aiVisible;
  document.getElementById('aiCard').style.display = aiVisible ? 'block' : 'none';
  document.getElementById('toggleInsightsBtn').textContent = aiVisible ? 'Hide Insights' : 'Show Insights';
  if (aiVisible) renderInsights();
});

document.getElementById('refreshInsights')?.addEventListener('click', () => {
  if (!aiVisible) { aiVisible = true; document.getElementById('aiCard').style.display = 'block'; document.getElementById('toggleInsightsBtn').textContent = 'Hide Insights'; }
  renderInsights(); toast('Insights refreshed');
});

// Reports
function createBuckets(range) {
  const now = Date.now(); const buckets = [];
  if (range === 'daily') { for (let i = 6; i >= 0; i--) { const start = startOfDay(now - i * DAY); buckets.push({ start, end: start + DAY, label: formatShortDate(start) }); } }
  else if (range === 'weekly') { const weekEnd = startOfDay(now) + DAY; for (let i = 3; i >= 0; i--) { const start = weekEnd - (i + 1) * 7 * DAY; const end = weekEnd - i * 7 * DAY; buckets.push({ start, end, label: `${formatShortDate(start)} - ${formatShortDate(end - 1)}` }); } }
  else if (range === 'monthly') { const monthEnd = startOfDay(now) + DAY; for (let i = 5; i >= 0; i--) { const start = monthEnd - (i + 1) * 30 * DAY; const end = monthEnd - i * 30 * DAY; buckets.push({ start, end, label: `${formatShortDate(start)} - ${formatShortDate(end - 1)}` }); } }
  return buckets;
}

function aggregateSalesInRange(start, end) {
  const sales = state.sales.filter(s => s.ts >= start && s.ts < end);
  return { units: sales.reduce((a, s) => a + s.qty, 0), revenue: sales.reduce((a, s) => a + s.qty * s.price, 0), profit: sales.reduce((a, s) => a + s.qty * (s.price - s.cost), 0) };
}

function renderReports(range = activeReportRange) {
  activeReportRange = range;
  document.querySelectorAll('.report-range-btn').forEach(b => b.classList.toggle('active', b.dataset.range === range));
  const buckets = createBuckets(range);
  const totalMetrics = aggregateSalesInRange(buckets[0].start, buckets[buckets.length - 1].end);
  document.getElementById('reportMini').textContent = fmt(totalMetrics.revenue);
  document.getElementById('reportSummary').innerHTML = `<div class="report-summary-cards"><div class="report-card"><div class="small">Revenue (range)</div><div style="font-weight:800;margin-top:6px">${fmt(totalMetrics.revenue)}</div></div><div class="report-card"><div class="small">Profit (range)</div><div style="font-weight:800;margin-top:6px">${fmt(totalMetrics.profit)}</div></div><div class="report-card"><div class="small">Units (range)</div><div style="font-weight:800;margin-top:6px">${totalMetrics.units}</div></div></div>`;
  let tbl = `<div style="background:var(--card-bg);padding:10px;border-radius:12px;border:1px solid rgba(7,18,43,0.04);margin-top:12px"><table style="width:100%;border-collapse:collapse"><thead><tr style="text-align:left"><th style="padding:8px">Period</th><th style="padding:8px">Units</th><th style="padding:8px">Revenue</th><th style="padding:8px">Profit</th></tr></thead><tbody>`;
  for (const b of buckets) { const m = aggregateSalesInRange(b.start, b.end); tbl += `<tr><td style="padding:8px;border-top:1px solid #f1f5f9">${escapeHtml(b.label)}</td><td style="padding:8px;border-top:1px solid #f1f5f9">${m.units}</td><td style="padding:8px;border-top:1px solid #f1f5f9">${fmt(m.revenue)}</td><td style="padding:8px;border-top:1px solid #f1f5f9">${fmt(m.profit)}</td></tr>`; }
  tbl += `</tbody></table></div>`;
  document.getElementById('reportBreakdown').innerHTML = tbl;
}

document.querySelectorAll('.report-range-btn').forEach(b => b.addEventListener('click', () => renderReports(b.dataset.range)));

document.getElementById('exportReport')?.addEventListener('click', () => {
  const rows = [['Timestamp', 'Product', 'Qty', 'UnitPrice', 'Total', 'Cost', 'Profit']];
  state.sales.forEach(s => { const p = state.products.find(x => x.id === s.productId); rows.push([new Date(s.ts).toISOString(), p?.name || s.productId, s.qty, s.price, s.qty * s.price, s.qty * s.cost, s.qty * (s.price - s.cost)]); });
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'sales_all.csv'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
});

document.getElementById('exportCurrentReport')?.addEventListener('click', () => {
  const buckets = createBuckets(activeReportRange); const rows = [['Period', 'Units', 'Revenue', 'Profit']];
  for (const b of buckets) { const m = aggregateSalesInRange(b.start, b.end); rows.push([b.label, m.units, m.revenue, m.profit]); }
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `report_${activeReportRange}.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
});

// Notes
function renderNotes() {
  const notesListEl = document.getElementById('notesList');
  notesListEl.innerHTML = '';
  const notes = (state.notes || []).slice().sort((a, b) => b.ts - a.ts);
  if (notes.length === 0) { notesListEl.innerHTML = `<div class="small">No notes yet — add one above.</div>`; return; }
  for (const note of notes) {
    const item = document.createElement('div'); item.className = 'note-item';
    const titleHtml = note.title ? `<div style="font-weight:800">${escapeHtml(note.title)}</div>` : '';
    item.innerHTML = `${titleHtml}<div style="margin-top:6px;white-space:pre-wrap">${escapeHtml(note.content)}</div><div class="note-meta">${formatDateTime(note.ts)}</div><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button data-edit-note="${note.id}" class="btn-edit">Edit</button><button data-delete-note="${note.id}" class="btn-delete">Delete</button></div>`;
    notesListEl.appendChild(item);
  }
  notesListEl.querySelectorAll('[data-edit-note]').forEach(b => b.addEventListener('click', () => { const note = state.notes.find(n => n.id === b.dataset.editNote); if (!note) return; editingNoteId = note.id; document.getElementById('noteTitle').value = note.title || ''; document.getElementById('noteContent').value = note.content || ''; document.getElementById('noteSaveBtn').textContent = 'Update Note'; setActiveView('notes'); }));
  notesListEl.querySelectorAll('[data-delete-note]').forEach(b => b.addEventListener('click', () => { if (!confirm('Delete this note?')) return; state.notes = state.notes.filter(n => n.id !== b.dataset.deleteNote); saveState(); renderNotes(); toast('Note deleted'); }));
}

document.getElementById('noteSaveBtn')?.addEventListener('click', () => {
  const title = (document.getElementById('noteTitle').value || '').trim();
  const content = (document.getElementById('noteContent').value || '').trim();
  if (!content) { toast('Please write something in the note', 'error'); return; }
  if (editingNoteId) { const note = state.notes.find(n => n.id === editingNoteId); if (note) { note.title = title; note.content = content; note.ts = Date.now(); } editingNoteId = null; document.getElementById('noteSaveBtn').textContent = 'Save Note'; toast('Note updated'); }
  else { state.notes.push({ id: uid(), title, content, ts: Date.now() }); toast('Note saved'); }
  document.getElementById('noteTitle').value = ''; document.getElementById('noteContent').value = '';
  saveState(); renderNotes();
});

document.getElementById('noteCancelBtn')?.addEventListener('click', () => { editingNoteId = null; document.getElementById('noteTitle').value = ''; document.getElementById('noteContent').value = ''; document.getElementById('noteSaveBtn').textContent = 'Save Note'; });

// Settings
document.getElementById('btnLoadDemo')?.addEventListener('click', () => {
  if (!confirm('Load demo products into store?')) return;
  state.products.push({ id: uid(), name: 'Rice (5kg)', price: 2000, cost: 1500, qty: 34, category: 'Groceries', icon: '🍚' });
  state.products.push({ id: uid(), name: 'Bottled Water', price: 150, cost: 70, qty: 80, category: 'Drinks', icon: '💧' });
  state.products.push({ id: uid(), name: 'T-Shirt', price: 1200, cost: 600, qty: 50, category: 'Clothing', icon: '👕' });
  state.products.push({ id: uid(), name: 'Indomie', price: 200, cost: 60, qty: 120, category: 'Snacks', icon: '🍜' });
  saveState(); renderInventory(); renderProducts(); renderDashboard(); renderCustomList(); toast('Demo loaded');
});

document.getElementById('btnClearStore')?.addEventListener('click', () => {
  if (!confirm('Clear all products and history? This action cannot be undone.')) return;
  state.products = []; state.sales = []; state.changes = []; state.notes = [];
  saveState(); renderInventory(); renderProducts(); renderDashboard(); renderCustomList(); renderNotes(); toast('Store cleared');
});

function renderCustomList() {
  const customListArea = document.getElementById('customListArea');
  customListArea.innerHTML = '';
  if (state.products.length === 0) { customListArea.innerHTML = `<div class="small">No products.</div>`; return; }
  for (const p of state.products) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px dashed #eef2f3';
    row.innerHTML = `<div style="display:flex;gap:8px;align-items:center"><div style="width:36px;height:36px;border-radius:8px;overflow:hidden;flex-shrink:0">${p.image ? `<img src="${p.image}" style="width:36px;height:36px;object-fit:cover">` : (p.icon ? `<div style="font-size:18px;padding:6px">${escapeHtml(p.icon)}</div>` : `<div style="padding:6px;font-weight:800">${escapeHtml((p.name || '').slice(0, 2).toUpperCase())}</div>`)}</div><div><strong>${escapeHtml(p.name)}</strong><div class="small">${p.qty || 0} in stock • ${fmt(p.price)}</div></div></div><div style="display:flex;gap:8px"><button data-edit="${p.id}" class="btn-edit">Edit</button><button data-del="${p.id}" class="btn-delete">Delete</button></div>`;
    customListArea.appendChild(row);
  }
  customListArea.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openEditProduct(b.dataset.edit)));
  customListArea.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => removeProduct(b.dataset.del)));
}

// Navigation
function setActiveView(view) {
  document.querySelectorAll('.nav-btn').forEach(b => { const isActive = b.dataset.view === view; b.classList.toggle('active', isActive); b.setAttribute('aria-pressed', isActive ? 'true' : 'false'); });
  Object.values(document.querySelectorAll('.panel')).forEach(p => p.classList.remove('active'));
  const panel = document.getElementById(view + 'Panel');
  if (panel) panel.classList.add('active');
  if (view === 'reports') renderReports(activeReportRange);
  if (view === 'settings') renderCustomList();
  if (view === 'home') renderDashboard();
  if (view === 'notes') renderNotes();
}

document.querySelectorAll('.nav-btn').forEach(btn => btn.addEventListener('click', () => setActiveView(btn.dataset.view)));
document.getElementById('btnSettings')?.addEventListener('click', () => setActiveView('settings'));

// Init
function init() {
  renderChips(); renderProducts(); renderInventory(); renderDashboard(); renderCustomList(); renderNotes