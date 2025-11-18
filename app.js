/*
* Author: Gemini
* Date: 2025-11-17
* Summary: [CRITICAL BUG FIX]
* - Moved `let activeCategory = 'All';` to the top 'App state' section.
* - This fixes the 'ReferenceError: Cannot access 'activeCategory' before initialization'
* crash that happened on app load.
* - All other features (sticky, categories, modal) are retained.
*/
// --- QuickShop Firebase readiness guard ---
function waitForFirebaseReady(timeoutMs = 3000) {
  return new Promise((resolve) => {
    // Check if firebase is initialized
    if (window.__QS_FIREBASE && window.__QS_FIREBASE.firebase && window.__QS_FIREBASE.firebase.apps.length) {
      return resolve(window.__QS_FIREBASE);
    }
    let waited = 0;
    const iv = setInterval(() => {
      if (window.__QS_FIREBASE && window.__QS_FIREBASE.firebase && window.__QS_FIREBASE.firebase.apps.length) {
        clearInterval(iv);
        return resolve(window.__QS_FIREBASE);
      }
      waited += 100;
      if (waited >= timeoutMs) {
        clearInterval(iv);
        console.warn('QuickShop: Firebase did not initialize within timeout.');
        return resolve(window.__QS_FIREBASE || null);
      }
    }, 100);
  });
}

/* app.js — QuickShop (Refactored for Offline-First Sync + AI/Report Features) */
(function () {
  'use strict';

  /* ---------- Small helpers ---------- */
  const log = (...a) => console.log('[QS]', ...a);
  const errlog = (...a) => console.error('[QS]', ...a);
  function escapeHtml(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function uid() { return 'p' + Math.random().toString(36).slice(2,9) + Date.now().toString(36); }
  // Moved n and fmt to window scope for report.js
  window.n = function(v) { const num = Number(v || 0); return isNaN(num) ? 0 : num; }
  window.fmt = function(v) { return '₦' + Number(v || 0).toLocaleString('en-NG'); }
  function startOfDay(ts) { const d = new Date(ts); d.setHours(0,0,0,0); return d.getTime(); }
  function formatShortDate(ts) { return new Date(ts).toLocaleDateString('en-GB', { month:'short', day:'numeric' }); }
  function formatDateTime(ts) { return new Date(ts).toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }); }
  
  // **NEW**: Sleek Snackbar Notification
  let toastTimer = null;
  function toast(message, type = 'info', ms = 2800) {
    try {
      let t = $('appToast');
      if (!t) {
        // Create toast element
        t = document.createElement('div');
        t.id = 'appToast';
        Object.assign(t.style, {
          position: 'fixed',
          left: '14px',
          right: '14px',
          bottom: 'calc(var(--nav-h) + 10px + env(safe-area-inset-bottom))', // Just above nav
          maxWidth: '480px',
          margin: '0 auto',
          padding: '12px 16px',
          borderRadius: '10px',
          fontWeight: 700,
          fontSize: '14px',
          background: '#2c2c3c', // Dark theme
          border: '1px solid rgba(255, 255, 255, 0.1)',
          color: type === 'error' ? '#f87171' : '#6ee7b7', // Red for error, Green for info/success
          boxShadow: '0 8px 24px rgba(2,6,23,0.2)',
          opacity: 0,
          transform: 'translateY(20px)',
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          zIndex: 99999,
          textAlign: 'center'
        });
        document.body.appendChild(t);
      }

      // Clear existing timer if any
      if (toastTimer) clearTimeout(toastTimer);

      // Set message and color
      t.textContent = message;
      t.style.color = type === 'error' ? '#f87171' : '#6ee7b7'; // Red or Green
      
      // Show
      requestAnimationFrame(()=> {
        t.style.opacity = '1';
        t.style.transform = 'translateY(0)';
      });

      // Hide after delay
      toastTimer = setTimeout(()=> {
        t.style.opacity = '0';
        t.style.transform = 'translateY(10px)';
        toastTimer = null;
      }, ms);

    } catch (e) { console.log('toast failed', e); }
  }


  /* ---------- Firebase compat references (safe) ---------- */
  const getFirebase = () => window.__QS_FIREBASE || {};
  const getAuth = () => (getFirebase().auth || (window.firebase && firebase.auth ? firebase.auth() : null));
  const getDb = () => (getFirebase().db || (window.firebase && firebase.firestore ? firebase.firestore() : null));
  const getStorage = () => (getFirebase().storage || (window.firebase && firebase.storage ? firebase.storage() : null)); 

  /* ---------- App state ---------- */
  const LOCAL_KEY_PREFIX = 'quickshop_stable_v1_';
  let currentUser = null;
  // [GEMINI] REQ 5: Added 'categories' to state
  let state = { products: [], sales: [], changes: [], notes: [], categories: [] };
  let isSyncing = false;
  let editingNoteId = null;
  let editingProductId = null; 
  // [GEMINI] REQ 5: Default categories list
  const DEFAULT_CATEGORIES = ['Drinks', 'Snacks', 'Groceries', 'Clothing', 'Others'];
  // [GEMINI] BUG FIX: Moved activeCategory here to fix initialization error
  let activeCategory = 'All';


  /* ---------- Barcode scanner state ---------- */
  let codeReader = null;
  let videoStream = null;
  let lastScannedBarcode = null;
  let scannerActive = false;
  let currentScanMode = 'form'; // 'form' or 'smart'
  let smartScanProduct = null; 

  /* ---------- DOM refs (safe getters) ---------- */
  const $ = id => document.getElementById(id);
  const loginScreen = $('loginScreen');
  const appScreen = document.querySelector('.app');

  const loginForm = $('loginForm'), signupForm = $('signupForm'), resetForm = $('resetForm'), verificationNotice = $('verificationNotice'), authLoading = $('authLoading');

  const loginEmail = $('loginEmail'), loginPass = $('loginPass');
  const signupName = $('signupName'), signupBusiness = $('signupBusiness'), signupEmail = $('signupEmail'), signupPass = $('signupPass'), signupPassConfirm = $('signupPassConfirm');
  const resetEmail = $('resetEmail');

  const btnLogin = $('btnLogin'), btnShowSignup = $('btnShowSignup'), btnSignup = $('btnSignup'), btnBackToLogin = $('btnBackToLogin'), btnForgotPassword = $('btnForgotPassword');
  const btnBackToLoginFromReset = $('btnBackToLoginFromReset'), btnSendReset = $('btnSendReset');
  const btnCheckVerification = $('btnCheckVerification'), btnResendVerification = $('btnResendVerification'), btnLogoutFromVerification = $('btnLogoutFromVerification');
  const btnLogout = $('btnLogout');

  const userEmailEl = $('userEmail'), userDisplayNameEl = $('userDisplayName');

  // app elements
  const searchContainer = document.querySelector('.search');
  const searchInput = $('searchInput'), chipsEl = $('chips'), productListEl = $('productList'), inventoryListEl = $('inventoryList');

  // Add/Edit Form refs
  // [GEMINI] REQ 5: invCategory is now a <select>
  const addForm = $('addForm'), invId = $('invId'), invName = $('invName'), invBarcode = $('invBarcode'), invPrice = $('invPrice'), invCost = $('invCost'), invQty = $('invQty'), invCategory = $('invCategory');
  const invImgInput = $('invImg'), invImgPreview = $('invImgPreview'), invImgPreviewImg = $('invImgPreviewImg'), invImgClear = $('invImgClear');
  const addProductBtn = $('addProductBtn'), cancelProductBtn = $('cancelProductBtn'); 

  // Barcode elements
  const primaryScanBtn = $('primaryScanBtn'); 
  const scanBarcodeBtn = $('scanBarcodeBtn'); 
  const barcodeScannerModal = $('barcodeScannerModal'), barcodeVideo = $('barcodeVideo'), barcodeScanLine = $('barcodeScanLine'), barcodeResult = $('barcodeResult'), barcodeValue = $('barcodeValue'), barcodeCancelBtn = $('barcodeCancelBtn'), barcodeUseBtn = $('barcodeUseBtn');
  
  // Smart Scanner Modal refs
  const smartScannerModal = $('smartScannerModal');
  const smartModalItem = $('smartModalItem'), smartModalStock = $('smartModalStock');
  const smartModalSellBtn = $('smartModalSellBtn'), smartModalRestockBtn = $('smartModalRestockBtn'), smartModalCancel = $('smartModalCancel');


  // dashboard / insights
  const dashRevenueEl = $('dashRevenue'), dashProfitEl = $('dashProfit'), dashTopEl = $('dashTop');
  const toggleInsightsBtn = $('toggleInsightsBtn'), aiCard = $('aiCard'), aiContent = $('aiContent'), refreshInsightsBtn = $('refreshInsights');
  
  // reports
  const reportRangeButtons = Array.from(document.querySelectorAll('.report-range-btn'));
  const reportMini = $('reportMini'), reportSummary = $('reportSummary'), reportBreakdown = $('reportBreakdown');

  // navigation / misc
  const navButtons = Array.from(document.querySelectorAll('.nav-btn')), btnSettings = $('btnSettings');

  /* ---------- [GEMINI] REQ 4: Custom Confirmation Modal Logic ---------- */
  let confirmResolve = null;
  const confirmModal = {
    backdrop: $('confirmModalBackdrop'),
    title: $('confirmModalTitle'),
    message: $('confirmModalMessage'),
    okBtn: $('confirmModalOK'),
    cancelBtn: $('confirmModalCancel')
  };

  if (confirmModal.okBtn) {
    confirmModal.okBtn.addEventListener('click', () => {
      if (confirmResolve) confirmResolve(true);
      confirmModal.backdrop.style.display = 'none';
    });
  }
  if (confirmModal.cancelBtn) {
    confirmModal.cancelBtn.addEventListener('click', () => {
      if (confirmResolve) confirmResolve(false);
      confirmModal.backdrop.style.display = 'none';
    });
  }
  if (confirmModal.backdrop) {
    confirmModal.backdrop.addEventListener('click', (e) => {
      if (e.target.id === 'confirmModalBackdrop') {
        if (confirmResolve) confirmResolve(false);
        confirmModal.backdrop.style.display = 'none';
      }
    });
  }
  
  /**
   * Shows a custom confirmation modal.
   * @param {object} options - { title, message, okText, okDanger }
   * @returns {Promise<boolean>} - Resolves true if OK, false if Cancel.
   */
  function showConfirm({ title = 'Are you sure?', message, okText = 'OK', okDanger = false }) {
    return new Promise((resolve) => {
      if (!confirmModal.backdrop || !confirmModal.title || !confirmModal.message || !confirmModal.okBtn) {
        console.warn('Confirm modal elements not found. Falling back to window.confirm');
        return resolve(window.confirm(title + '\n' + message));
      }
      
      confirmResolve = resolve;
      
      confirmModal.title.textContent = title;
      confirmModal.message.textContent = message;
      confirmModal.okBtn.textContent = okText;
      
      // Set button color
      if (okDanger) {
        confirmModal.okBtn.style.background = 'var(--danger)';
      } else {
        confirmModal.okBtn.style.background = 'var(--accent)';
      }

      confirmModal.backdrop.style.display = 'flex';
    });
  }
  /* ---------- End Custom Confirmation Modal Logic ---------- */


  /* ---------- Small UI utilities ---------- */
  
  function setBottomNavVisible(visible) { try { const bn = document.querySelector('.bottom-nav'); if (!bn) return; bn.style.display = visible ? '' : 'none'; } catch(e){} }

function hideAllAuthForms() {
    if (loginForm) loginForm.style.display = 'none';
    if (signupForm) signupForm.style.display = 'none';
    if (resetForm) resetForm.style.display = 'none';
    if (verificationNotice) verificationNotice.style.display = 'none';
    if (authLoading) authLoading.style.display = 'none';
  }
  function showLoginForm(){ hideAllAuthForms(); if (loginForm) loginForm.style.display = 'flex'; clearAuthInputs(); setBottomNavVisible(false); }
  function showSignupForm(){ hideAllAuthForms(); if (signupForm) signupForm.style.display = 'flex'; clearAuthInputs(); setBottomNavVisible(false); }
  function showResetForm(){ hideAllAuthForms(); if (resetForm) resetForm.style.display = 'flex'; clearAuthInputs(); setBottomNavVisible(false); }
  function showVerificationNotice(email) { hideAllAuthForms(); if (verificationNotice) verificationNotice.style.display = 'flex'; const v = $('verificationEmail'); if (v) v.textContent = email || (getAuth() && getAuth().currentUser && getAuth().currentUser.email) || ''; }
  function showAuthLoading(){ hideAllAuthForms(); if (authLoading) authLoading.style.display = 'flex'; setBottomNavVisible(false); }
  function clearAuthInputs() {
    [loginEmail, loginPass, signupName, signupBusiness, signupEmail, signupPass, signupPassConfirm, resetEmail].forEach(i => { if (i) { i.value = ''; i.classList.remove('error'); }});
  }

  function showLoading(show = true, text = 'Processing...') {
    let overlay = $('loadingOverlay');
    if (!overlay && show) {
      overlay = document.createElement('div');
      overlay.id = 'loadingOverlay';
      overlay.className = 'loading-overlay active';
      overlay.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>' + escapeHtml(text) + '</p></div>';
      document.body.appendChild(overlay);
      return;
    }
    if (overlay) overlay.classList.toggle('active', !!show);
  }
  function disableBtn(btn, disable = true) { if (!btn) return; btn.disabled = disable; if (disable) btn.setAttribute('aria-busy','true'); else btn.removeAttribute('aria-busy'); }

  function validateEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }

  /* ---------- Inventory Insight Modal Handlers ---------- */
  function showInventoryInsight(html) {
    const view = $('inventoryInsightView');
    const content = $('inventoryInsightsContent');
    if (!view || !content) return;
    content.innerHTML = html; // This is now safe as generateInsights uses textContent
    view.style.display = 'block';
  }

  function closeInventoryInsight() {
    const view = $('inventoryInsightView');
    if (!view) return;
    view.style.display = 'none';
  }

  /* ---------- Firestore helper functions ---------- */
  async function setUserProfile(uid, profile) {
    const db = getDb(); if (!db) return false;
    try { await db.collection('users').doc(uid).set(profile, { merge: true }); return true; } catch (e) { errlog('setUserProfile', e); return false; }
  }
  async function getUserProfile(uid) {
    const db = getDb(); if (!db) return null;
    try { const snap = await db.collection('users').doc(uid).get(); return snap.exists ? snap.data() : null; } catch (e) { errlog('getUserProfile', e); return null; }
  }

  /* ---------- Local/cloud state save/load ---------- */

  // [GEMINI] REQ 5: Updated saveState to include 'categories'
  async function saveState() {
    const localKey = currentUser ? LOCAL_KEY_PREFIX + currentUser.uid : LOCAL_KEY_PREFIX + 'anon';
    
    // Always save full state locally
    try {
      localStorage.setItem(localKey, JSON.stringify({...state, lastSync: Date.now()}));
    } catch (e) { 
      errlog('local save failed', e);
      toast('Failed to save data locally!', 'error');
    }

    if (!currentUser || !getDb() || !navigator.onLine) {
      return; 
    }

    if (isSyncing) return;
    isSyncing = true;
    
    try {
      // Sync non-conflicting data (notes, categories)
      const cloudData = {
        notes: state.notes || [],
        categories: state.categories || [],
        lastSync: Date.now()
      };
      await getDb().collection('users').doc(currentUser.uid).set(cloudData, { merge: true });
    } catch (e) {
      errlog('saveState (notes/categories sync) failed', e);
      toast('Cloud sync for notes & categories failed.', 'error');
    } finally {
      isSyncing = false;
    }
  }
  
  // [GEMINI] REQ 5: Updated loadLocalData to include 'categories'
  function loadLocalData(uid = null) {
    const localKey = uid ? LOCAL_KEY_PREFIX + uid : LOCAL_KEY_PREFIX + 'anon';
    let localState = { products: [], sales: [], changes: [], notes: [], categories: [] };
    
    try {
      const localRaw = localStorage.getItem(localKey);
      if (localRaw) {
        localState = JSON.parse(localRaw);
      }
    } catch (e) {
      errlog('Failed to parse local data', e);
    }
    
    // Ensure state structure is valid
    state = {
      products: localState.products || [],
      sales: localState.sales || [],
      changes: localState.changes || [],
      notes: localState.notes || [],
      // [GEMINI] REQ 5: Load categories or set default
      categories: (localState.categories && localState.categories.length > 0) ? localState.categories : [...DEFAULT_CATEGORIES]
    };
    
    // Show the app with local data *immediately*
    initAppUI(); 
  }

  // [GEMINI] REQ 5: Updated syncCloudData to include 'categories'
  async function syncCloudData(user) {
    if (!user || !getDb() || !navigator.onLine) {
      if (!navigator.onLine) log('Offline, skipping cloud sync.');
      return; 
    }

    showLoading(true, 'Syncing data...');
    try {
      if (window.qsdb && window.qsdb.syncPendingToFirestore) {
        await window.qsdb.syncPendingToFirestore();
      }

      const docRef = getDb().collection('users').doc(user.uid);
      const docSnap = await docRef.get();

      if (docSnap && docSnap.exists) {
        const cloud = docSnap.data();
        
        // ... (product and sales merge logic remains the same) ...
        const pendingChanges = (window.qsdb && await window.qsdb.getAllPending()) || [];
        const pendingProductIds = new Set(
          pendingChanges
            .filter(c => c.type === 'updateProduct' || c.type === 'addProduct' || c.type === 'addStock')
            .map(c => c.item.id || c.item.productId)
        );

        const productMap = new Map((state.products || []).map(p => [p.id, p]));
        (cloud.products || []).forEach(p => {
          if (!pendingProductIds.has(p.id)) {
            productMap.set(p.id, p);
          }
        });

        const cloudProductIds = new Set((cloud.products || []).map(p => p.id));
        state.products = Array.from(productMap.values()).filter(p => cloudProductIds.has(p.id));

        const salesMap = new Map((state.sales || []).map(s => [s.id, s]));
        (cloud.sales || []).forEach(s => salesMap.set(s.id, s));
        state.sales = Array.from(salesMap.values());
        
        // [GEMINI] REQ 5: Merge categories
        state.notes = cloud.notes || state.notes || [];
        state.categories = (cloud.categories && cloud.categories.length > 0) ? cloud.categories : state.categories;


        toast('Data synced from cloud', 'info', 1500);

      } else {
        log('No cloud doc found, creating one...');
        await docRef.set({
          products: state.products || [],
          sales: state.sales || [],
          notes: state.notes || [],
          categories: state.categories || [], // [GEMINI] REQ 5
          lastSync: Date.now()
        }, { merge: false });
      }
    } catch (e) {
      errlog('syncCloudData failed', e);
      toast('Failed to sync cloud data', 'error');
    }
    
    showLoading(false);
    initAppUI(); 
    await saveState(); 
  }


  /* ---------- Auth handlers ---------- */
  function mapAuthError(e) {
    if (!e) return 'An error occurred';
    const code = e.code || '';
    if (code.indexOf('network') !== -1) return 'Network error. Check connection.';
    if (code === 'auth/email-already-in-use') return 'Email already registered';
    if (code === 'auth/weak-password') return 'Password is too weak (min 6 chars)';
    if (code === 'auth/invalid-email') return 'Invalid email address';
    if (code === 'auth/wrong-password') return 'Incorrect password';
    if (code === 'auth/user-not-found') return 'No account found with this email';
    if (code === 'auth/too-many-requests') return 'Too many attempts. Try again later';
    return e.message || String(e);
  }

  if (btnLogin) btnLogin.addEventListener('click', async function () {
    const email = (loginEmail && loginEmail.value || '').trim();
    const pass = (loginPass && loginPass.value) || '';
    if (!validateEmail(email)) { toast('Please enter a valid email', 'error'); if (loginEmail) loginEmail.classList.add('error'); return; }
    if (!pass || pass.length < 6) { toast('Password must be at least 6 characters', 'error'); if (loginPass) loginPass.classList.add('error'); return; }
    try {
      showAuthLoading(); disableBtn(btnLogin, true);
      const auth = getAuth(); if (!auth) throw new Error('Auth not initialized');
      const cred = await auth.signInWithEmailAndPassword(email, pass);
      if (!cred.user.emailVerified) {
        await auth.signOut();
        showVerificationNotice(email);
        toast('Please verify your email before logging in', 'error');
        return;
      }
      toast('Login successful');
    } catch (e) {
      errlog('login error', e);
      showLoginForm();
      toast(mapAuthError(e), 'error');
    } finally {
      disableBtn(btnLogin, false);
      if (authLoading) authLoading.style.display = 'none';
    }
  });

  if (btnShowSignup) btnShowSignup.addEventListener('click', showSignupForm);
  if (btnBackToLogin) btnBackToLogin.addEventListener('click', showLoginForm);
  if (btnForgotPassword) btnForgotPassword.addEventListener('click', showResetForm);
  if (btnBackToLoginFromReset) btnBackToLoginFromReset.addEventListener('click', showLoginForm);

  if (btnSignup) btnSignup.addEventListener('click', async function () {
    const name = (signupName && signupName.value || '').trim();
    const business = (signupBusiness && signupBusiness.value || '').trim();
    const email = (signupEmail && signupEmail.value || '').trim();
    const pass = (signupPass && signupPass.value) || '';
    const passConfirm = (signupPassConfirm && signupPassConfirm.value) || '';
    if (!name) { toast('Please enter your full name', 'error'); if (signupName) signupName.classList.add('error'); return; }
    if (!validateEmail(email)) { toast('Please enter a valid email', 'error'); if (signupEmail) signupEmail.classList.add('error'); return; }
    if (!pass || pass.length < 6) { toast('Password must be at least 6 characters', 'error'); if (signupPass) signupPass.classList.add('error'); return; }
    if (pass !== passConfirm) { toast('Passwords do not match', 'error'); if (signupPassConfirm) signupPassConfirm.classList.add('error'); return; }
    try {
      showAuthLoading(); disableBtn(btnSignup, true);
      const auth = getAuth(); if (!auth) throw new Error('Auth not initialized');
      const cred = await auth.createUserWithEmailAndPassword(email, pass);
      const user = cred.user;
      const displayName = business ? `${name} (${business})` : name;
      try { await user.updateProfile({ displayName }); } catch (uerr) { log('updateProfile failed', uerr); }
      const profile = { uid: user.uid, name, businessName: business || null, email: user.email, createdAt: Date.now() };
      await setUserProfile(user.uid, profile);
      try { await user.sendEmailVerification(); } catch (sv) { log('sendEmailVerification failed', sv); }
      showVerificationNotice(email);
      toast('Account created — verification email sent. Please verify before logging in.');
    } catch (e) {
      errlog('signup error', e);
      showSignupForm();
      toast(mapAuthError(e), 'error');
    } finally {
      disableBtn(btnSignup, false);
      if (authLoading) authLoading.style.display = 'none';
    }
  });

  if (btnSendReset) btnSendReset.addEventListener('click', async function () {
    const email = (resetEmail && resetEmail.value || '').trim();
    if (!validateEmail(email)) { toast('Please enter a valid email', 'error'); if (resetEmail) resetEmail.classList.add('error'); return; }
    try {
      showAuthLoading(); disableBtn(btnSendReset, true);
      const auth = getAuth(); if (!auth) throw new Error('Auth not initialized');
      await auth.sendPasswordResetEmail(email);
      toast('Password reset email sent. Check your inbox.');
      showLoginForm();
    } catch (e) {
      errlog('reset error', e);
      showResetForm();
      toast(mapAuthError(e), 'error');
    } finally {
      disableBtn(btnSendReset, false);
      if (authLoading) authLoading.style.display = 'none';
    }
  });

  if (btnResendVerification) btnResendVerification.addEventListener('click', async function () {
    try {
      const auth = getAuth(); const user = auth && auth.currentUser;
      if (!user) { toast('You need to be signed in to resend verification', 'error'); return; }
      await user.sendEmailVerification();
      toast('Verification email resent. Check your inbox.');
    } catch (e) { errlog('resend verification error', e); toast('Failed to resend verification. Try again later.', 'error'); }
  });
  if (btnCheckVerification) btnCheckVerification.addEventListener('click', async function () {
    try {
      showAuthLoading();
      const auth = getAuth(); const user = auth && auth.currentUser;
      if (!user) { toast('Not signed in — please login after verifying your email.', 'error'); showLoginForm(); return; }
      await user.reload();
      if (user.emailVerified) { toast('Email verified! Loading your account...'); } else { toast('Email not verified yet. Please check your inbox.', 'error'); showVerificationNotice(user.email); }
    } catch (e) { errlog('check verification error', e); toast('Error checking verification status', 'error'); showVerificationNotice(getAuth() && getAuth().currentUser && getAuth().currentUser.email); }
    finally { if (authLoading) authLoading.style.display = 'none'; }
  });
  if (btnLogoutFromVerification) btnLogoutFromVerification.addEventListener('click', async function () { try { const auth = getAuth(); if (auth) await auth.signOut(); toast('Logged out'); showLoginForm(); } catch (e) { errlog('logout error', e); toast('Logout failed', 'error'); } });

  // [GEMINI] REQ 4: Replaced window.confirm with await showConfirm
  if (btnLogout) btnLogout.addEventListener('click', async function () {
    const confirmed = await showConfirm({
      title: 'Sign Out',
      message: 'Are you sure you want to sign out?',
      okText: 'Sign Out',
      okDanger: true
    });
    if (!confirmed) return;

    try { const auth = getAuth(); if (auth) await auth.signOut(); toast('Signed out'); } catch (e) { errlog('signout error', e); toast('Sign out failed: ' + (e.message || ''), 'error'); }
  });

  /* ---------- Auth observer ---------- */
  
  // 1. Load local data immediately on script load
  loadLocalData(null); // Load anon data first

  // 2. Setup auth observer
  const authInstance = getAuth();
  if (authInstance && authInstance.onAuthStateChanged) {
    authInstance.onAuthStateChanged(async function (user) {
      if (user) {
        currentUser = user;
        
        if (!user.emailVerified) {
          if (loginScreen) loginScreen.style.display = 'flex';
          if (appScreen) appScreen.style.display = 'none';
          showVerificationNotice(user.email);
          return;
        }

        if (loginScreen) loginScreen.style.display = 'none';
        if (appScreen) appScreen.style.display = 'block';
        try{ setBottomNavVisible(true); }catch(e){};
        
        if (userEmailEl) userEmailEl.textContent = user.email || '—';
        if (userDisplayNameEl) userDisplayNameEl.textContent = user.displayName ? `Name: ${user.displayName}` : '';
        
        // 3. Load user's local data
        loadLocalData(user.uid); 
        
        // 4. Start cloud sync
        await syncCloudData(user);

      } else {
        currentUser = null;
        if (loginScreen) loginScreen.style.display = 'flex'; 
        if (appScreen) appScreen.style.display = 'none'; 
        showLoginForm(); 
        setBottomNavVisible(false);
        
        if (userEmailEl) userEmailEl.textContent = '—';
        if (userDisplayNameEl) userDisplayNameEl.textContent = '';
        
        loadLocalData(null);
        showLoading(false);
      }
    });
  } else {
    log('No auth found. Running in offline/anon mode.');
    initAppUI();
  }

  /* ---------- Barcode scanner (UPGRADED) ---------- */
  function stopScanner() {
    try {
      if (codeReader && codeReader.reset) { try { codeReader.reset(); } catch(e){} }
      if (videoStream) { try { videoStream.getTracks().forEach(t => t.stop()); } catch(e){} videoStream = null; }
    } catch (e) { console.warn('stopScanner err', e); }
    scannerActive = false;
    try { if (barcodeScanLine) barcodeScanLine.style.display = 'none'; if (barcodeScannerModal) barcodeScannerModal.style.display = 'none'; } catch(e){}
    lastScannedBarcode = null;
    smartScanProduct = null;
    if (barcodeResult) barcodeResult.style.display = 'none';
    if (barcodeUseBtn) barcodeUseBtn.style.display = 'none';
  }

  // **NEW**: handleScanResult now implements Smart Scanner logic
  function handleScanResult(result) {
    if (!result || !result.text) return;
    if (result.text === lastScannedBarcode) return;
    lastScannedBarcode = result.text;
    
    // Stop decoding
    try { if (codeReader && codeReader.stopContinuousDecode) codeReader.stopContinuousDecode(); } catch(e){}
    if (barcodeScanLine) barcodeScanLine.style.display = 'none';
    toast('Barcode scanned!', 'info', 900);

    if (currentScanMode === 'form') {
      // Original mode: Just show the result and "Use" button
      if (barcodeValue) barcodeValue.textContent = lastScannedBarcode;
      if (barcodeResult) barcodeResult.style.display = 'block';
      if (barcodeUseBtn) barcodeUseBtn.style.display = 'inline-block';
    } else if (currentScanMode === 'smart') {
      // **NEW**: Smart mode
      stopScanner();
      
      // [GEMINI] BUG FIX: This now finds the correct product
      const product = state.products.find(p => p.barcode === lastScannedBarcode);
      
      if (product) {
        // Product FOUND: Show Smart Modal
        smartScanProduct = product;
        if (smartModalItem) smartModalItem.textContent = product.name;
        if (smartModalStock) smartModalStock.textContent = `${product.qty} in stock`;
        if (smartScannerModal) smartScannerModal.style.display = 'flex';
      } else {
        // Product NOT FOUND: Show Add Form and pre-fill barcode
        toast('New barcode found. Add product.', 'info');
        showAddForm(true); // 'true' = show as modal
        if (invBarcode) invBarcode.value = lastScannedBarcode;
        setTimeout(()=> { if (invName) invName.focus(); }, 220);
      }
    }
  }

  async function startScanner(mode = 'form') {
    if (scannerActive) return;
    if (typeof window.ZXing === 'undefined') { toast('Barcode library not loaded.', 'error'); return; }
    
    currentScanMode = mode;
    lastScannedBarcode = null;
    smartScanProduct = null;

    try {
      if (!barcodeScannerModal) return;
      barcodeScannerModal.style.display = 'flex';
      if (barcodeResult) barcodeResult.style.display = 'none';
      if (barcodeUseBtn) barcodeUseBtn.style.display = 'none';
      if (barcodeScanLine) barcodeScanLine.style.display = 'block';
      scannerActive = true;
      codeReader = new ZXing.BrowserMultiFormatReader();
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      videoStream = stream;
      if (barcodeVideo) { barcodeVideo.srcObject = stream; barcodeVideo.play().catch(()=>{}); }
      
      if (codeReader.decodeFromVideoDevice) {
        try {
          codeReader.decodeFromVideoDevice(null, barcodeVideo, (result, err) => {
            if (result) handleScanResult(result);
            if (err && err.name && err.name !== 'NotFoundException') console.warn('ZXing err', err);
          });
        } catch (e) {
          try { if (codeReader.decodeContinuously) codeReader.decodeContinuously(barcodeVideo, (res, er) => { if (res) handleScanResult(res); }); } catch (ex) { throw ex; }
        }
      } else if (codeReader.decodeContinuously) {
        codeReader.decodeContinuously(barcodeVideo, (res, er) => { if (res) handleScanResult(res); });
      } else {
        toast('Barcode scanner not supported', 'error');
        stopScanner();
      }
    } catch (e) {
      errlog('Barcode Scanner Error:', e);
      toast('Failed to start camera. Check permissions.', 'error');
      stopScanner();
    }
  }

  // **NEW**: Hook up the two different scan buttons
  if (primaryScanBtn) primaryScanBtn.addEventListener('click', () => startScanner('smart'));
  if (scanBarcodeBtn) scanBarcodeBtn.addEventListener('click', () => startScanner('form'));

  if (barcodeCancelBtn) barcodeCancelBtn.addEventListener('click', stopScanner);
  if (barcodeUseBtn) barcodeUseBtn.addEventListener('click', function () {
    // This button is only used in 'form' mode
    if (lastScannedBarcode && invBarcode) invBarcode.value = lastScannedBarcode;
    stopScanner();
  });
  if (barcodeScannerModal) barcodeScannerModal.addEventListener('click', function (e) { if (e.target && e.target.id === 'barcodeScannerModal') stopScanner(); });

  // **NEW**: Smart Scanner Modal button listeners
  function hideSmartModal() {
    if (smartScannerModal) smartScannerModal.style.display = 'none';
    smartScanProduct = null;
  }
  if (smartModalCancel) smartModalCancel.addEventListener('click', hideSmartModal);
  if (smartModalSellBtn) smartModalSellBtn.addEventListener('click', () => {
    if (!smartScanProduct) return;
    // **FIX**: Use the main modal to sell 1, which has the oversell logic
    hideSmartModal();
    openModalFor('sell', smartScanProduct.id);
  });
  if (smartModalRestockBtn) smartModalRestockBtn.addEventListener('click', () => {
    if (!smartScanProduct) return;
    openModalFor('add', smartScanProduct.id); // Open the normal restock modal
    hideSmartModal();
  });


  /* ---------- Products rendering (safe DOM APIs) ---------- */
  // [GEMINI] REQ 5: Using `state.categories`
  function renderChips() {
    if (!chipsEl) return;
    chipsEl.innerHTML = '';
    // Create a new list with "All" prepended
    const displayCategories = ['All', ...state.categories];
    
    displayCategories.forEach(c => {
      const btn = document.createElement('button');
      btn.className = 'chip' + (c === activeCategory ? ' active' : '');
      btn.type = 'button';
      btn.textContent = c;
      btn.addEventListener('click', function () { activeCategory = c; renderChips(); renderProducts(); });
      chipsEl.appendChild(btn);
    });
  }

  let searchTimer = null;
  function scheduleRenderProducts() { clearTimeout(searchTimer); searchTimer = setTimeout(renderProducts, 120); }
  if (searchInput) searchInput.addEventListener('input', scheduleRenderProducts);

  function renderProducts() {
    if (!productListEl) return;
    productListEl.innerHTML = '';
    const q = (searchInput && (searchInput.value || '').trim().toLowerCase()) || '';
    const items = (state.products || []).filter(p => {
      if (activeCategory !== 'All' && (p.category || 'Others') !== activeCategory) return false;
      if (q && !(((p.name || '').toLowerCase().includes(q)) || ((p.barcode || '') + '').includes(q))) return false;
      return true;
    });
    if (!items.length) {
      const no = document.createElement('div');
      no.className = 'small';
      no.style.padding = '14px';
      no.style.background = 'var(--card-bg)';
      no.style.borderRadius = '12px';
      no.style.border = '1px solid rgba(7,18,43,0.04)';
      no.textContent = 'No products — add from Inventory or load demo';
      productListEl.appendChild(no);
      return;
    }
    for (const p of items) {
      const card = document.createElement('div'); card.className = 'product-card';
      const thumb = document.createElement('div'); thumb.className = 'p-thumb';
      if (p.image) { 
        const img = document.createElement('img'); img.src = p.image; img.alt = p.name || 'thumb'; img.crossOrigin = 'anonymous'; thumb.appendChild(img);
      } else {
        thumb.textContent = (p.icon && p.icon.length) ? p.icon : ((p.name || '').split(' ').map(s => s[0]).slice(0,2).join('').toUpperCase());
      }
      const info = document.createElement('div'); info.className = 'p-info';
      const nameEl = document.createElement('div'); nameEl.className = 'p-name'; nameEl.textContent = p.name || 'Unnamed';
      const subEl = document.createElement('div'); subEl.className = 'p-sub';
      const qtyText = (typeof p.qty === 'number') ? `${p.qty} in stock` : '—';
      subEl.textContent = `${qtyText} • ${fmt(p.price || 0)}` + (p.barcode ? (' • Barcode: ' + p.barcode) : '');
      info.appendChild(nameEl); info.appendChild(subEl);
      const actions = document.createElement('div'); actions.className = 'p-actions';
      const group = document.createElement('div'); group.className = 'p-actions-row';
      const sell = document.createElement('button'); sell.className = 'btn-sell'; sell.type = 'button'; sell.textContent = 'Sell'; sell.dataset.id = p.id; sell.dataset.action = 'sell';
      const undo = document.createElement('button'); undo.className = 'btn-undo'; undo.type = 'button'; undo.textContent = 'Undo'; undo.dataset.id = p.id; undo.dataset.action = 'undo';
      group.appendChild(sell); group.appendChild(undo);
      actions.appendChild(group);
      card.appendChild(thumb); card.appendChild(info); card.appendChild(actions);
      productListEl.appendChild(card);
    }
  }

  if (productListEl) {
    productListEl.addEventListener('click', function (ev) {
      const btn = ev.target.closest('button');
      if (!btn) return;
      const act = btn.dataset.action;
      const id = btn.dataset.id;
      if (act === 'sell') { openModalFor('sell', id); return; }
      if (act === 'undo') { undoLastFor(id); return; }
    });
  }

  /* ---------- modal helpers ---------- */
  let modalContext = null;
  function showModal() { 
    const mb = $('modalBackdrop'); 
    if (mb) { 
      mb.style.display = 'flex'; 
      setTimeout(()=> { const q = $('modalQty'); if (q) q.focus(); }, 100); 
    } 
  }
  
  function hideModal() { 
    const mb = $('modalBackdrop'); 
    if (mb) mb.style.display = 'none'; 
    modalContext = null; 
    let errEl = $('modalError');
    if (errEl) errEl.textContent = '';
  }

  function openModalFor(mode, productId) {
    const p = (state.products || []).find(x => x.id === productId);
    if (!p) { toast('Product not found', 'error'); return; }
    modalContext = { mode, productId };
    const titleEl = $('modalTitle'), itemEl = $('modalItem');
    if (titleEl) titleEl.textContent = mode === 'sell' ? 'Sell items' : 'Add stock';
    if (itemEl) itemEl.textContent = `${p.name} — ${typeof p.qty === 'number' ? p.qty + ' in stock' : 'stock unknown'}`;
    const qtyEl = $('modalQty'); if (qtyEl) qtyEl.value = 1;
    showModal();
  }

  if ($('modalCancel')) $('modalCancel').addEventListener('click', hideModal);
  const modalBackdropEl = $('modalBackdrop');
  if (modalBackdropEl) modalBackdropEl.addEventListener('click', function (e) { if (e.target && e.target.id === 'modalBackdrop') hideModal(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hideModal(); });

  if ($('modalConfirm')) $('modalConfirm').addEventListener('click', function () {
    if (!modalContext) { hideModal(); return; }
    
    const qtyEl = $('modalQty'); 
    const q = Math.max(1, Math.floor(n(qtyEl && qtyEl.value)));
    
    if (modalContext.mode === 'sell') {
      const p = state.products.find(x => x.id === modalContext.productId);
      if (!p) {
        toast('Product not found.', 'error'); 
        hideModal();
        return;
      }
      if (typeof p.qty !== 'number') p.qty = 0;

      if (p.qty < q) {
        let errEl = $('modalError');
        if (!errEl) {
          errEl = document.createElement('div');
          errEl.id = 'modalError';
          errEl.className = 'error-text'; 
          errEl.style.marginTop = '10px';
          qtyEl.parentElement.insertAdjacentElement('afterend', errEl);
        }
        errEl.textContent = `Not enough stock. You only have ${p.qty}.`;
        
        const modal = qtyEl.closest('.modal');
        if (modal) {
          modal.style.animation = 'shake 0.3s ease';
          setTimeout(() => { modal.style.animation = ''; }, 300);
        }
        return; 
      }
      let errEl = $('modalError');
      if (errEl) errEl.textContent = '';
      
      doSell(modalContext.productId, q);
      
    } else {
      doAddStock(modalContext.productId, q);
    }
    
    hideModal();
  });


  /* ---------- product actions (FIXED PERSISTENCE) ---------- */
  async function doAddStock(productId, qty) {
    const p = state.products.find(x => x.id === productId);
    if (!p) return;
    p.qty = (typeof p.qty === 'number' ? p.qty : 0) + qty;
    
    const change = { type: 'updateProduct', item: p };
    if (window.qsdb && window.qsdb.addPendingChange) {
      await window.qsdb.addPendingChange(change);
    }
    
    state.changes.push({ type: 'add', productId, qty, ts: Date.now() });
    
    await saveState(); 
    renderInventory(); renderProducts(); renderDashboard();
    toast(`Added ${qty} to ${p.name}`); 
  }
  
  async function doSell(productId, qty) {
    const p = state.products.find(x => x.id === productId);
    if (!p) return; 
    
    p.qty = p.qty - qty; 
    
    const newSale = { 
      productId, 
      qty, 
      price: n(p.price), 
      cost: n(p.cost), 
      ts: Date.now(),
      id: uid() 
    };
    state.sales.push(newSale);
    
    if (window.qsdb && window.qsdb.addPendingChange) {
      await window.qsdb.addPendingChange({ type: 'addSale', item: newSale });
      await window.qsdb.addPendingChange({ type: 'updateProduct', item: p });
    }
    
    state.changes.push({ type: 'sell', productId, qty, ts: newSale.ts });
    await saveState(); 
    renderInventory(); renderProducts(); renderDashboard();
    toast(`Sold ${qty} × ${p.name}`); 
  }
  
  async function undoLastFor(productId) {
    for (let i = state.changes.length - 1; i >= 0; i--) {
      const ch = state.changes[i];
      if (ch.productId !== productId) continue;
      
      if (ch.type === 'add') {
        const p = state.products.find(x => x.id === productId);
        if (p) p.qty = (typeof p.qty === 'number' ? Math.max(0, p.qty - ch.qty) : 0);
        state.changes.splice(i,1);
        
        if (p && window.qsdb && window.qsdb.addPendingChange) {
          await window.qsdb.addPendingChange({ type: 'updateProduct', item: p });
        }
        await saveState(); 
        renderInventory(); renderProducts(); renderDashboard();
        toast(`Reverted add of ${ch.qty}`);
        return;
      }
      
      if (ch.type === 'sell') {
        for (let j = state.sales.length - 1; j >= 0; j--) {
          const s = state.sales[j];
          if (s.productId === productId && s.qty === ch.qty && Math.abs(s.ts - ch.ts) < 120000) {
            const saleToRemove = state.sales.splice(j,1)[0];
            
            if (saleToRemove && window.qsdb && window.qsdb.addPendingChange) {
              await window.qsdb.addPendingChange({ type: 'removeSale', item: saleToRemove });
            }
            
            const p = state.products.find(x => x.id === productId);
            if (p) {
              p.qty = (typeof p.qty === 'number' ? p.qty + ch.qty : ch.qty);
              if (window.qsdb && window.qsdb.addPendingChange) {
                await window.qsdb.addPendingChange({ type: 'updateProduct', item: p });
              }
            }
            
            state.changes.splice(i,1);
            await saveState(); 
            renderInventory(); renderProducts(); renderDashboard();
            toast(`Reverted sale of ${ch.qty}`);
            return;
          }
        }
        toast('Could not find exact sale to revert.', 'error');
        return;
      }
    }
    toast('No recent changes to undo for this product', 'error');
  }

  /* ---------- Inventory rendering & editing ---------- */
  function clearInvImage() {
    try { invImgInput && (invImgInput.value = ''); } catch(e){}
    if (invImgPreview) invImgPreview.style.display = 'none';
    if (invImgPreviewImg) invImgPreviewImg.src = '';
  }
  
  if (invImgInput) {
    invImgInput.addEventListener('change', async function (e) {
      const file = e.target.files && e.target.files[0];
      if (!file) { clearInvImage(); return; }
      const MAX_IMG_SIZE = 5 * 1024 * 1024; 
      if (file.size > MAX_IMG_SIZE) { toast('Image too large (max 5MB).', 'error'); e.target.value = ''; return; }
      
      const storage = getStorage();
      if (!storage || !currentUser) {
        toast('Storage not ready or user not logged in.', 'error');
        return;
      }
      
      const fileRef = storage.ref(`user_images/${currentUser.uid}/${Date.now()}_${file.name}`);
      showLoading(true, 'Uploading image...');
      
      try {
        const snapshot = await fileRef.put(file);
        const downloadURL = await snapshot.ref.getDownloadURL();
        
        showLoading(false);
        if (invImgPreviewImg) invImgPreviewImg.src = downloadURL; 
        if (invImgPreview) invImgPreview.style.display = 'flex';
        toast('Image uploaded');
        
      } catch (err) {
        errlog('Image upload failed', err);
        toast('Image upload failed', 'error');
        showLoading(false);
        clearInvImage();
      }
    });
  }
  if (invImgClear) invImgClear.addEventListener('click', function (e) { e.preventDefault(); clearInvImage(); });

  function clearAddForm() {
    if (invId) invId.value = '';
    if (invName) invName.value = ''; 
    if (invBarcode) invBarcode.value = ''; 
    if (invPrice) invPrice.value = ''; 
    if (invCost) invCost.value = ''; 
    if (invQty) invQty.value = '';
    if (invCategory) invCategory.value = 'Others'; // Default
    clearInvImage();
    
    editingProductId = null;
    if (addProductBtn) addProductBtn.textContent = 'Save Product';
    if (cancelProductBtn) cancelProductBtn.style.display = 'none';
  }

  // [GEMINI] REQ 5: Populates the category <select> dropdown
  function populateCategoryDropdown() {
    if (!invCategory) return;
    invCategory.innerHTML = '';
    state.categories.forEach(cat => {
      const option = document.createElement('option');
      option.value = cat;
      option.textContent = cat;
      invCategory.appendChild(option);
    });
    // Ensure "Others" is an option if it's not already in the list
    if (!state.categories.includes('Others')) {
      const option = document.createElement('option');
      option.value = 'Others';
      option.textContent = 'Others';
      invCategory.appendChild(option);
    }
  }

  function showAddForm(asModal = true) {
    populateCategoryDropdown(); // [GEMINI] REQ 5: Populate dropdown
    if (asModal) {
      document.body.classList.add('add-modal-open');
      if (addForm) addForm.style.display = 'flex';
      createAddBackdrop();
    } else {
      if (addForm) addForm.style.display = 'flex';
    }
  }

  function hideAddForm() {
    clearAddForm();
    if (addForm) addForm.style.display = 'none';
    document.body.classList.remove('add-modal-open');
    const d = document.getElementById('addFormBackdrop');
    if (d) try { d.remove(); } catch(e) {}
  }
  
  if (cancelProductBtn) cancelProductBtn.addEventListener('click', hideAddForm);

  if (addProductBtn) addProductBtn.addEventListener('click', async function () {
    const name = (invName && invName.value || '').trim();
    const barcode = (invBarcode && invBarcode.value || '').trim();
    const price = n(invPrice && invPrice.value);
    const cost = n(invCost && invCost.value);
    const qty = n(invQty && invQty.value);
    const category = (invCategory && invCategory.value) || 'Others'; // [GEMINI] REQ 5: Reads from <select>
    const image = (invImgPreviewImg && invImgPreviewImg.src) || null;
    
    // [GEMINI] BUG FIX: Pass barcode and ID for duplicate checking
    const valid = validateProduct(name, price, cost, qty, barcode, editingProductId);
    if (!valid.valid) { 
      const modal = addProductBtn.closest('.modal') || addProductBtn.closest('.add-card');
      toast(valid.error, 'error'); 
      if (modal) {
        modal.style.animation = 'shake 0.3s ease';
        setTimeout(() => { modal.style.animation = ''; }, 300);
      }
      return; 
    }

    let product;
    let syncType;
    
    if (editingProductId) {
      product = state.products.find(p => p.id === editingProductId);
      if (!product) {
        toast('Product to update not found', 'error');
        return;
      }
      product.name = name;
      product.barcode = barcode;
      product.price = price;
      product.cost = cost;
      product.qty = qty;
      product.category = category;
      product.image = image;
      product.updatedAt = Date.now();
      
      syncType = 'updateProduct';
      toast('Product updated');
      
    } else {
      product = { 
        id: uid(), 
        name, price, cost, qty: qty || 0, category, 
        image: image, 
        icon: null, 
        barcode: barcode || null,
        createdAt: Date.now()
      };
      state.products.push(product);
      syncType = 'addProduct';
      toast('Product saved');
    }
    
    if (window.qsdb && window.qsdb.addPendingChange) {
      await window.qsdb.addPendingChange({ type: syncType, item: product });
    }

    await saveState(); 
    hideAddForm();
      
    renderInventory(); renderProducts(); renderDashboard(); renderChips(); // [GEMINI] REQ 5: Re-render chips
  });

  // [GEMINI] BUG FIX: Added 'barcode' and 'currentId' for duplicate check
  function validateProduct(name, price, cost, qty, barcode, currentId = null) {
    if (!name || name.trim().length === 0) return { valid: false, error: 'Product name is required' };
    if (price <= 0) return { valid: false, error: 'Price must be greater than 0' };
    if (cost < 0) return { valid: false, error: 'Cost cannot be negative' };
    if (qty < 0) return { valid: false, error: 'Stock cannot be negative' };
    
    // [GEMINI] BUG FIX: Check for duplicate barcode
    if (barcode) {
        const existing = state.products.find(p => p.barcode === barcode && p.id !== currentId);
        if (existing) {
            return { valid: false, error: `Barcode already used for "${existing.name}".` };
        }
    }
    return { valid: true };
  }

  function renderInventory() {
    if (!inventoryListEl) return;
    inventoryListEl.innerHTML = '';
    
    const q = (searchInput && (searchInput.value || '').trim().toLowerCase()) || '';
    const items = (state.products || []).filter(p => {
      if (q && !(((p.name || '').toLowerCase().includes(q)) || ((p.barcode || '') + '').includes(q))) return false;
      return true;
    });

    if (!items || items.length === 0) {
      const no = document.createElement('div'); no.className = 'small';
      no.style.padding = '12px'; no.style.background = 'var(--card-bg)'; no.style.borderRadius = '12px'; no.style.border = '1px solid rgba(7,18,43,0.04)';
      no.textContent = 'No products in inventory';
      inventoryListEl.appendChild(no); return;
    }
    
    for (const p of items) {
      const el = document.createElement('div'); el.className = 'inventory-card';
      const top = document.createElement('div'); top.className = 'inventory-top';
      const thumb = document.createElement('div'); thumb.className = 'p-thumb';
      if (p.image) { const img = document.createElement('img'); img.src = p.image; img.alt = p.name || ''; img.crossOrigin = 'anonymous'; thumb.appendChild(img); }
      else thumb.textContent = (p.icon && p.icon.length) ? p.icon : ((p.name || '').split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase());
      const info = document.createElement('div'); info.className = 'inventory-info';
      const nme = document.createElement('div'); nme.className = 'inventory-name'; nme.textContent = p.name || 'Unnamed';
      const meta = document.createElement('div'); meta.className = 'inventory-meta'; meta.textContent = `${p.qty || 0} in stock • ${fmt(p.price)}`;
      info.appendChild(nme); info.appendChild(meta);
      if (p.barcode) { const bc = document.createElement('div'); bc.className = 'small'; bc.style.marginTop = '4px'; bc.style.color = 'var(--muted)'; bc.textContent = 'Barcode: ' + p.barcode; info.appendChild(bc); }
      top.appendChild(thumb); top.appendChild(info);
      const actions = document.createElement('div'); actions.className = 'inventory-actions';
      const restock = document.createElement('button'); restock.className = 'btn-restock'; restock.type = 'button'; restock.textContent = 'Restock'; restock.dataset.restock = p.id;
      const edit = document.createElement('button'); edit.className = 'btn-edit'; edit.type = 'button'; edit.textContent = 'Edit'; edit.dataset.edit = p.id;
      const del = document.createElement('button'); del.className = 'btn-delete'; del.type = 'button'; del.textContent = 'Delete'; del.dataset.delete = p.id;
      actions.appendChild(restock); actions.appendChild(edit); actions.appendChild(del);
      el.appendChild(top); el.appendChild(actions);
      inventoryListEl.appendChild(el);
    }
  }

  if (inventoryListEl) {
    inventoryListEl.addEventListener('click', function (ev) {
      const restock = ev.target.closest('[data-restock]');
      if (restock) { openModalFor('add', restock.dataset.restock); return; }
      const edit = ev.target.closest('[data-edit]');
      if (edit) { openEditProduct(edit.dataset.edit); return; } 
      const del = ev.target.closest('[data-delete]');
      if (del) { removeProduct(del.dataset.delete); return; } 
    });
  }

  if (searchInput) searchInput.addEventListener('input', function() {
    const currentView = document.querySelector('.panel.active')?.id;
    if (currentView === 'inventoryPanel') {
      renderInventory();
    } else if (currentView === 'homePanel') {
      scheduleRenderProducts();
    }
  });

  function openEditProduct(id) {
    const p = state.products.find(x => x.id === id); 
    if (!p) { toast('Product not found', 'error'); return; }
    
    editingProductId = p.id;
    
    // [GEMINI] REQ 5: Populate dropdown *before* setting value
    populateCategoryDropdown(); 
    
    if (invId) invId.value = p.id;
    if (invName) invName.value = p.name || '';
    if (invBarcode) invBarcode.value = p.barcode || '';
    if (invPrice) invPrice.value = p.price || '';
    if (invCost) invCost.value = p.cost || '';
    if (invQty) invQty.value = p.qty || 0;
    // [GEMINI] REQ 5: Set <select> value
    if (invCategory) invCategory.value = p.category || 'Others';
    
    if (p.image) {
      if (invImgPreviewImg) invImgPreviewImg.src = p.image;
      if (invImgPreview) invImgPreview.style.display = 'flex';
    } else {
      clearInvImage();
    }
    
    if (addProductBtn) addProductBtn.textContent = 'Update Product';
    if (cancelProductBtn) cancelProductBtn.style.display = 'block';
    
    showAddForm(true); // Show as modal
    
    setTimeout(()=> { try { if (invName) invName.focus(); } catch(e){} }, 220);
  }

  // [GEMINI] REQ 4: Replaced window.confirm with await showConfirm
  async function removeProduct(id) {
    const p = state.products.find(x => x.id === id);
    if (!p) return;
    
    const confirmed = await showConfirm({
      title: `Delete ${p.name}?`,
      message: 'This will permanently remove the product and all its sales history. This action cannot be undone.',
      okText: 'Delete Product',
      okDanger: true
    });
    if (!confirmed) return;
    
    const productToRemove = { ...p }; 
    
    state.products = state.products.filter(x => x.id !== id);
    state.sales = state.sales.filter(s => s.productId !== id);
    state.changes = state.changes.filter(c => c.productId !== id);
    
    if (window.qsdb && window.qsdb.addPendingChange) {
      await window.qsdb.addPendingChange({ type: 'removeProduct', item: productToRemove });
    }
    
    await saveState(); 
    renderInventory(); renderProducts(); renderDashboard(); renderChips();
    toast('Product deleted');
  }

  /* ---------- Dashboard rendering ---------- */
  function renderDashboard() {
    const since = startOfDay(Date.now());
    const salesToday = (state.sales || []).filter(s => s.ts >= since);
    const revenue = salesToday.reduce((a,s)=>a + (n(s.price) * n(s.qty)), 0);
    const cost = salesToday.reduce((a,s)=>a + (n(s.cost) * n(s.qty)), 0);
    const profit = revenue - cost;
    if (dashRevenueEl) dashRevenueEl.textContent = fmt(revenue);
    if (dashProfitEl) dashProfitEl.textContent = fmt(profit);
    
    // [GEMINI] BUG FIX: Made "Top Seller" logic more robust
    const overallByProd = {}; (state.sales||[]).forEach(s => overallByProd[s.productId] = (overallByProd[s.productId]||0) + s.qty);
    const overallArr = Object.entries(overallByProd).sort((a,b)=>b[1]-a[1]);
    let topName = '—';
    if (overallArr.length > 0 && overallArr[0]) {
        const topId = overallArr[0][0];
        // Check if product still exists
        const topProd = state.products.find(p => p.id === topId);
        if (topProd) {
            topName = topProd.name;
        } else {
            topName = 'N/A (Deleted)';
        }
    }
    if (dashTopEl) dashTopEl.textContent = topName;
  }

  /* ---------- Notes ---------- */
  function renderNotes() {
    const notesListEl = $('notesList');
    if (!notesListEl) return;
    notesListEl.innerHTML = '';
    const notes = (state.notes || []).slice().sort((a,b)=>b.ts - a.ts);
    if (!notes.length) { 
      const no = document.createElement('div');
      no.className = 'small';
      no.textContent = 'No notes yet — add one above.';
      notesListEl.appendChild(no);
      return; 
    }
    for (const note of notes) {
      const item = document.createElement('div'); item.className = 'note-item';
      if (note.title) {
        const t = document.createElement('div'); t.style.fontWeight = '700'; 
        t.textContent = note.title; 
        item.appendChild(t);
      }
      const c = document.createElement('div'); c.style.marginTop = '6px'; c.style.whiteSpace = 'pre-wrap'; 
      c.textContent = note.content; 
      item.appendChild(c);
      const meta = document.createElement('div'); meta.className = 'note-meta'; meta.textContent = formatDateTime(note.ts); item.appendChild(meta);
      const actions = document.createElement('div'); actions.style.display = 'flex'; actions.style.gap = '8px'; actions.style.justifyContent = 'flex-end'; actions.style.marginTop = '8px';
      const edit = document.createElement('button'); edit.className = 'btn-edit'; edit.textContent = 'Edit'; edit.dataset.editNote = note.id;
      const del = document.createElement('button'); del.className = 'btn-delete'; del.textContent = 'Delete'; del.dataset.deleteNote = note.id;
      actions.appendChild(edit); actions.appendChild(del); item.appendChild(actions);
      notesListEl.appendChild(item);
    }
    // [GEMINI] REQ 4: Replaced window.confirm with await showConfirm
    notesListEl.querySelectorAll('[data-edit-note]').forEach(b => b.addEventListener('click', function () {
      const id = this.dataset.editNote; const note = state.notes.find(n=>n.id===id); if (!note) return;
      $('noteTitle').value = note.title || ''; $('noteContent').value = note.content || '';
      editingNoteId = note.id; $('noteSaveBtn').textContent = 'Update Note'; 
      setActiveView('notes', true); // Pass true to reset scroll
    }));
    notesListEl.querySelectorAll('[data-delete-note]').forEach(b => b.addEventListener('click', async function () {
      const confirmed = await showConfirm({
        title: 'Delete Note?',
        message: 'Are you sure you want to delete this note?',
        okText: 'Delete',
        okDanger: true
      });
      if (!confirmed) return;
      
      state.notes = state.notes.filter(n => n.id !== this.dataset.deleteNote);
      saveState(); renderNotes(); toast('Note deleted');
    }));
  }

  const noteSaveBtn = $('noteSaveBtn'), noteCancelBtn = $('noteCancelBtn');
  if (noteSaveBtn) noteSaveBtn.addEventListener('click', function () {
    const title = ($('noteTitle').value || '').trim();
    const content = ($('noteContent').value || '').trim();
    if (!content) { toast('Please write something in the note', 'error'); return; }
    if (editingNoteId) {
      const note = state.notes.find(n=>n.id===editingNoteId);
      if (note) { note.title = title; note.content = content; note.ts = Date.now(); }
      editingNoteId = null; if (noteSaveBtn) noteSaveBtn.textContent = 'Save Note'; toast('Note updated');
    } else {
      state.notes.push({ id: uid(), title, content, ts: Date.now() });
      toast('Note saved');
    }
    $('noteTitle').value = ''; $('noteContent').value = '';
    saveState(); renderNotes();
  });
  if (noteCancelBtn) noteCancelBtn.addEventListener('click', function () {
    editingNoteId = null; $('noteTitle').value = ''; $('noteContent').value = ''; if (noteSaveBtn) noteSaveBtn.textContent = 'Save Note';
  });

  /* ---------- Demo & settings ---------- */
  const btnLoadDemo = $('btnLoadDemo'), btnClearStore = $('btnClearStore');
  // [GEMINI] REQ 4: Replaced window.confirm with await showConfirm
  if (btnLoadDemo) btnLoadDemo.addEventListener('click', async function () {
    const confirmed = await showConfirm({
      title: 'Load Demo Products?',
      message: 'This will add 4 demo products to your inventory. You can delete them later.',
      okText: 'Load Demo',
      okDanger: false
    });
    if (!confirmed) return;

    const demoProducts = [
      { id: uid(), name: 'Rice (5kg)', price: 2000, cost: 1500, qty: 34, category: 'Groceries', icon: '🍚', barcode: '123456789012' },
      { id: uid(), name: 'Bottled Water', price: 150, cost: 70, qty: 80, category: 'Drinks', icon: '💧', barcode: '234567890123' },
      { id: uid(), name: 'T-Shirt', price: 1200, cost: 600, qty: 50, category: 'Clothing', icon: '👕', barcode: '345678901234' },
      { id: uid(), name: 'Indomie', price: 200, cost: 60, qty: 120, category: 'Snacks', icon: '🍜', barcode: null }
    ];
    
    for (const p of demoProducts) {
      // [GEMINI] BUG FIX: Check for duplicate barcodes before adding
      if (!p.barcode || !state.products.find(prod => prod.barcode === p.barcode)) {
        state.products.push(p);
        if (window.qsdb && window.qsdb.addPendingChange) {
          await window.qsdb.addPendingChange({ type: 'addProduct', item: p });
        }
      }
    }
    // [GEMINI] REQ 5: Ensure demo categories are added if they don't exist
    DEFAULT_CATEGORIES.forEach(cat => {
      if (!state.categories.includes(cat)) {
        state.categories.push(cat);
      }
    });
    
    await saveState(); 
    renderInventory(); renderProducts(); renderDashboard(); renderChips(); renderCategoryEditor();
    toast('Demo loaded');
  });
  // [GEMINI] REQ 4: Replaced window.confirm with await showConfirm
  if (btnClearStore) btnClearStore.addEventListener('click', async function () {
    const confirmed = await showConfirm({
      title: 'Clear Store?',
      message: 'This will delete all products, sales, and notes permanently. This action cannot be undone.',
      okText: 'Clear Store',
      okDanger: true
    });
    if (!confirmed) return;
    
    if (window.qsdb && window.qsdb.addPendingChange) {
      for (const p of state.products) {
        await window.qsdb.addPendingChange({ type: 'removeProduct', item: p });
      }
      for (const s of state.sales) {
        await window.qsdb.addPendingChange({ type: 'removeSale', item: s });
      }
    }
    
    // [GEMINI] REQ 5: Also clear categories
    state.products = []; state.sales = []; state.changes = []; state.notes = [];
    state.categories = [...DEFAULT_CATEGORIES]; // Reset to default
    await saveState(); 
    renderInventory(); renderProducts(); renderDashboard(); renderChips(); renderNotes(); renderCategoryEditor();
    toast('Store cleared');
  });

  // [GEMINI] REQ 5: New function to render the category editor
  function renderCategoryEditor() {
    const container = $('categoryEditorArea');
    if (!container) return;
    
    container.innerHTML = `
      <div style="font-weight: 600; margin-bottom: 8px;">Manage Categories</div>
      <div class="small" style="margin-bottom: 12px;">Add, rename, or delete categories. Deleting a category will move its products to "Others".</div>
      <div id="categoryList" style="display: flex; flex-direction: column; gap: 8px;"></div>
      <div class="add-row" style="margin-top: 16px;">
        <input id="newCategoryName" type="text" placeholder="New category name" style="flex: 1;" class="auth-input" />
        <button id="addCategoryBtn" class="save-btn">Add</button>
      </div>
    `;
    
    const listEl = $('categoryList');
    // Don't allow editing "Others"
    const categoriesToEdit = state.categories.filter(c => c.toLowerCase() !== 'others');
    
    categoriesToEdit.forEach(cat => {
      const row = document.createElement('div');
      row.className = 'add-row';
      row.innerHTML = `
        <input type="text" class="auth-input category-name-input" data-original-name="${escapeHtml(cat)}" value="${escapeHtml(cat)}" style="flex: 1; background: #fff; border: 1px solid #e6eef7;" />
        <button class="btn-undo category-rename-btn" data-original-name="${escapeHtml(cat)}">Rename</button>
        <button class="btn-delete category-delete-btn" data-name="${escapeHtml(cat)}">Delete</button>
      `;
      listEl.appendChild(row);
    });

    // Add event listeners
    $('addCategoryBtn').addEventListener('click', handleAddCategory);
    container.querySelectorAll('.category-rename-btn').forEach(btn => btn.addEventListener('click', handleRenameCategory));
    container.querySelectorAll('.category-delete-btn').forEach(btn => btn.addEventListener('click', handleDeleteCategory));
  }

  // [GEMINI] REQ 5: New helper for adding a category
  async function handleAddCategory() {
    const input = $('newCategoryName');
    const newName = input.value.trim();
    if (!newName) {
      toast('Please enter a category name', 'error');
      return;
    }
    if (state.categories.find(c => c.toLowerCase() === newName.toLowerCase())) {
      toast('Category already exists', 'error');
      return;
    }
    
    state.categories.push(newName);
    await saveState();
    toast('Category added');
    renderCategoryEditor();
    renderChips();
  }

  // [GEMINI] REQ 5: New helper for renaming a category
  async function handleRenameCategory(e) {
    const oldName = e.target.dataset.originalName;
    const input = e.target.closest('.add-row').querySelector('.category-name-input');
    const newName = input.value.trim();

    if (!newName) {
      toast('Category name cannot be empty', 'error');
      input.value = oldName;
      return;
    }
    if (newName.toLowerCase() === oldName.toLowerCase()) return; // No change
    if (state.categories.find(c => c.toLowerCase() === newName.toLowerCase())) {
      toast('Category name already exists', 'error');
      input.value = oldName;
      return;
    }
    if (newName.toLowerCase() === 'others') {
      toast('Cannot rename to "Others"', 'error');
      input.value = oldName;
      return;
    }

    // Update category list
    const index = state.categories.findIndex(c => c.toLowerCase() === oldName.toLowerCase());
    if (index > -1) {
      state.categories[index] = newName;
    }
    
    // Update all products
    state.products.forEach(p => {
      if (p.category === oldName) {
        p.category = newName;
      }
    });

    await saveState();
    // Re-render everything
    toast('Category renamed');
    renderCategoryEditor();
    renderChips();
    renderProducts(); // To reflect potential category changes
    renderInventory();
  }

  // [GEMINI] REQ 5: New helper for deleting a category
  async function handleDeleteCategory(e) {
    const name = e.target.dataset.name;
    const confirmed = await showConfirm({
      title: `Delete ${name}?`,
      message: `All products in "${name}" will be moved to "Others". This cannot be undone.`,
      okText: 'Delete Category',
      okDanger: true
    });
    if (!confirmed) return;

    // Remove from categories
    state.categories = state.categories.filter(c => c.toLowerCase() !== name.toLowerCase());
    
    // Update products
    state.products.forEach(p => {
      if (p.category === name) {
        p.category = 'Others';
      }
    });

    await saveState();
    // Re-render everything
    toast('Category deleted');
    renderCategoryEditor();
    renderChips();
    renderProducts();
    renderInventory();
  }


  /* ---------- Navigation ---------- */
  // [GEMINI] REQ 3: Added 'resetScroll' parameter
  function setActiveView(view, resetScroll = false) {
    navButtons.forEach(b => { const isActive = b.dataset.view === view; b.classList.toggle('active', isActive); b.setAttribute('aria-pressed', isActive ? 'true':'false'); });
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    const panel = $(view + 'Panel'); if (panel) panel.classList.add('active');

    if (searchContainer && chipsEl) {
        if (view === 'home') {
            searchContainer.style.display = 'flex';
            chipsEl.style.display = 'flex';
        } else if (view === 'inventory') {
            searchContainer.style.display = 'flex';
            chipsEl.style.display = 'none';
        } else {
            searchContainer.style.display = 'none';
            chipsEl.style.display = 'none';
        }
    }

    if (view === 'reports') renderReports();
    if (view === 'settings') {
      // [GEMINI] REQ 5: Call category editor
      renderCategoryEditor();
      const settingsPanel = $('settingsPanel');
      if (settingsPanel) settingsPanel.style.paddingBottom = '100px';
    }
    if (view === 'home') { renderDashboard(); renderProducts(); }
    if (view === 'inventory') renderInventory();
    if (view === 'notes') renderNotes();
    
    // [GEMINI] REQ 3 (FIX): Only reset *window* scroll if explicitly requested
    if (resetScroll) {
      setTimeout(()=> { 
        try { 
          window.scrollTo(0, 0); 
        } catch(e){} 
      }, 10);
    }
  }
  // [GEMINI] REQ 3: Pass 'true' to reset scroll on user navigation
  navButtons.forEach(btn => btn.addEventListener('click', function(){ setActiveView(this.dataset.view, true); }));
  if (btnSettings) btnSettings.addEventListener('click', function(){ setActiveView('settings', true); });

  /* ---------- Reports: (UPGRADED) ---------- */
  function createBuckets(range) {
    const DAY = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const buckets = [];
    if (range === 'daily') {
      for (let i = 6; i >= 0; i--) {
        const start = startOfDay(now - i * DAY);
        buckets.push({ start, end: start + DAY, label: formatShortDate(start) });
      }
    } else if (range === 'weekly') {
      const weekEnd = startOfDay(now) + DAY;
      const WEEK = 7 * DAY;
      for (let i = 3; i >= 0; i--) {
        const start = weekEnd - (i+1) * WEEK;
        const end = weekEnd - i * WEEK;
        buckets.push({ start, end, label: `${formatShortDate(start)} - ${formatShortDate(end - 1)}` });
      }
    } else {
      const monthEnd = startOfDay(now) + DAY;
      const MONTH = 30 * DAY;
      for (let i = 5; i >= 0; i--) {
        const start = monthEnd - (i+1) * MONTH;
        const end = monthEnd - i * MONTH;
        buckets.push({ start, end, label: `${new Date(start).toLocaleString('default', { month: 'short', year: 'numeric' })}` });
      }
    }
    return buckets;
  }
  
  function getSalesInRange(start, end) {
      return (state.sales || []).filter(s => s.ts >= start && s.ts < end);
  }

  function aggregateSalesInRange(start, end) {
    const sales = getSalesInRange(start, end);
    const revenue = sales.reduce((a,s)=>a + ((n(s.price) || 0) * (n(s.qty) || 0)), 0);
    const profit = sales.reduce((a,s)=>a + ((n(s.price) - n(s.cost)) * (n(s.qty) || 0)), 0);
    return {
      units: sales.reduce((a,s)=>a + (n(s.qty) || 0), 0),
      revenue: revenue,
      profit: profit
    };
  }

  let currentReportRange = 'daily';
  function renderReports(range = currentReportRange) {
    currentReportRange = range;
    reportRangeButtons.forEach(b => b.classList.toggle('active', b.dataset.range === range));
    const buckets = createBuckets(range);
    const rangeStart = buckets[0].start;
    const rangeEnd = buckets[buckets.length-1].end;
    const totalMetrics = aggregateSalesInRange(rangeStart, rangeEnd);
    
    if (reportMini) reportMini.textContent = fmt(totalMetrics.revenue);
    if (reportSummary) {
      reportSummary.innerHTML = '';
      const wrap = document.createElement('div'); wrap.className = 'report-summary-cards';
      const cardR = document.createElement('div'); cardR.className = 'report-card'; cardR.innerHTML = `<div class="small">Revenue (range)</div><div style="font-weight:700;margin-top:6px">${fmt(totalMetrics.revenue)}</div>`;
      const cardP = document.createElement('div'); cardP.className = 'report-card'; cardP.innerHTML = `<div class="small">Profit (range)</div><div style="font-weight:700;margin-top:6px">${fmt(totalMetrics.profit)}</div>`;
      const cardU = document.createElement('div'); cardU.className = 'report-card'; cardU.innerHTML = `<div class="small">Units (range)</div><div style="font-weight:700;margin-top:6px">${totalMetrics.units}</div>`;
      wrap.appendChild(cardR); wrap.appendChild(cardP); wrap.appendChild(cardU);
      reportSummary.appendChild(wrap);
    }
    
    if (reportBreakdown) {
      reportBreakdown.innerHTML = '';
      
      // Breakdown Table
      const outer = document.createElement('div');
      outer.style.cssText = 'background:var(--card-bg);padding:10px;border-radius:12px;border:1px solid rgba(7,18,43,0.04);margin-top:12px';
      const tbl = document.createElement('table'); tbl.style.cssText = 'width:100%;border-collapse:collapse';
      const thead = document.createElement('thead');
      // **FEATURE**: Added Margin
      thead.innerHTML = `<tr style="text-align:left"><th style="padding:8px">Period</th><th style="padding:8px">Units</th><th style="padding:8px">Revenue</th><th style="padding:8px">Profit</th><th style"padding:8px">Margin</th></tr>`;
      tbl.appendChild(thead);
      const tbody = document.createElement('tbody');
      for (const b of buckets) {
        const m = aggregateSalesInRange(b.start, b.end);
        buckets[buckets.indexOf(b)].units = m.units; 
        buckets[buckets.indexOf(b)].revenue = m.revenue; 
        // **FEATURE**: Calculate Margin
        const margin = m.revenue > 0 ? ((m.profit / m.revenue) * 100).toFixed(0) : 0;
        const tr = document.createElement('tr');
        tr.innerHTML = `<td style="padding:8px;border-top:1px solid #f1f5f9">${escapeHtml(b.label)}</td><td style="padding:8px;border-top:1px solid #f1f5f9">${m.units}</td><td style="padding:8px;border-top:1px solid #f1f5f9">${fmt(m.revenue)}</td><td style="padding:8px;border-top:1px solid #f1f5f9">${fmt(m.profit)}</td><td style="padding:8px;border-top:1px solid #f1f5f9">${margin}%</td>`;
        tbody.appendChild(tr);
      }
      tbl.appendChild(tbody);
      outer.appendChild(tbl);
      reportBreakdown.appendChild(outer);
      
      // **FEATURE**: Top Products (By Range)
      const salesInRange = getSalesInRange(rangeStart, rangeEnd);
      const rangeProdQty = {}; 
      salesInRange.forEach(s => { rangeProdQty[s.productId] = (rangeProdQty[s.productId] || 0) + s.qty; });
      const top3InRange = Object.entries(rangeProdQty).sort((a,b) => b[1] - a[1]).slice(0, 3);

      if (top3InRange.length > 0) {
        const topProdCard = document.createElement('div');
        topProdCard.style.cssText = 'background:var(--card-bg);padding:16px;border-radius:12px;border:1px solid rgba(7,18,43,0.04);margin-top:12px';
        const topTitle = document.createElement('div');
        topTitle.style.fontWeight = '700';
        topTitle.style.marginBottom = '10px';
        topTitle.textContent = 'Top Products (This Range)';
        topProdCard.appendChild(topTitle);
        
        top3InRange.forEach(([productId, qty]) => {
          const p = state.products.find(prod => prod.id === productId);
          const pName = p ? p.name : 'Unknown Product';
          const pEl = document.createElement('div');
          pEl.style.cssText = 'display:flex; justify-content:space-between; font-size: 14px; padding: 6px 0; border-bottom: 1px solid #f1f5f9;';
          const nameSpan = document.createElement('span');
          nameSpan.textContent = pName;
          const qtySpan = document.createElement('span');
          qtySpan.style.fontWeight = '600';
          qtySpan.textContent = `${qty} units`;
          pEl.appendChild(nameSpan);
          pEl.appendChild(qtySpan);
          topProdCard.appendChild(pEl);
        });
        reportBreakdown.appendChild(topProdCard);
      }
      
      const reportsPanel = $('reportsPanel');
      if (reportsPanel) reportsPanel.style.paddingBottom = '100px';
      
      reportBreakdown.style.paddingBottom = '24px';
      
      // [GEMINI] REQ 2: Removed auto-scroll to chart
      // setTimeout(()=> { try { reportBreakdown.scrollIntoView({behavior:'smooth', block:'start'}); } catch(e){} }, 50);
      try { if (typeof renderReportsChart === 'function') renderReportsChart(buckets); } catch(e) { console.warn('renderReportsChart missing', e); }
    }
  }
  reportRangeButtons.forEach(b => b.addEventListener('click', function () { renderReports(this.dataset.range); }));

  function generateCsv(rows, baseFilename = 'report') {
      const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' }); 
      const url = URL.createObjectURL(blob); 
      const a = document.createElement('a'); 
      a.href = url; 
      a.download = `${baseFilename}_${new Date().toISOString().split('T')[0]}.csv`; 
      document.body.appendChild(a); 
      a.click(); 
      a.remove(); 
      URL.revokeObjectURL(url);
  }

  const exportReport = $('exportReport');
  if (exportReport) exportReport.addEventListener('click', function () {
    const rows = [['Timestamp','Product','Qty','UnitPrice','Total','Cost','Profit','Barcode','SaleID']];
    (state.sales || []).forEach(s => {
      const p = state.products.find(x=>x.id===s.productId);
      const total = (n(s.price) * n(s.qty));
      const profit = (n(s.price) - n(s.cost)) * n(s.qty);
      rows.push([new Date(s.ts).toISOString(), p?.name || s.productId, s.qty, s.price, total, s.cost, profit, p?.barcode || '', s.id]);
    });
    generateCsv(rows, 'sales_all');
  });
  
  const exportCurrentReport = $('exportCurrentReport');
  if (exportCurrentReport) exportCurrentReport.addEventListener('click', function () {
    const buckets = createBuckets(currentReportRange);
    const start = buckets[0].start;
    const end = buckets[buckets.length - 1].end;
    const salesInRange = getSalesInRange(start, end);
    
    const rows = [['Timestamp','Product','Qty','UnitPrice','Total','Cost','Profit','Barcode','SaleID']];
    salesInRange.forEach(s => {
      const p = state.products.find(x=>x.id===s.productId);
      const total = (n(s.price) * n(s.qty));
      const profit = (n(s.price) - n(s.cost)) * n(s.qty);
      rows.push([new Date(s.ts).toISOString(), p?.name || s.productId, s.qty, s.price, total, s.cost, profit, p?.barcode || '', s.id]);
    });
    generateCsv(rows, `sales_range_${currentReportRange}`);
  });

  /* ---------- Insights Generation (UPGRADED) ---------- */
  function createInsightStat(label, value) {
      const el = document.createElement('div');
      const labelEl = document.createElement('div');
      labelEl.className = 'small';
      labelEl.textContent = label;
      const valueEl = document.createElement('div');
      valueEl.style.fontWeight = '700';
      valueEl.textContent = value;
      el.appendChild(labelEl);
      el.appendChild(valueEl);
      return el;
  }
  
  // **FEATURE**: Added advanced AI alerts (Restock & Slow Movers)
  function generateInsights(returnHtml = false) {
    try {
      const s = state || { products: [], sales: [], notes: [] };
      const wrap = document.createElement('div');
      
      // --- Basic Stats ---
      const totalProducts = (s.products || []).length;
      const totalStockUnits = (s.products || []).reduce((a,p)=>a + (n(p.qty)), 0);
      const inventoryValue = (s.products || []).reduce((a,p)=>a + (n(p.qty) * n(p.cost)), 0);
      const salesAll = s.sales || [];
      const totalRevenue = salesAll.reduce((a,sale)=>a + (n(sale.price) * n(sale.qty)), 0);
      
      const top = document.createElement('div'); 
      top.style.display = 'grid'; 
      top.style.gridTemplateColumns = '1fr 1fr'; 
      top.style.gap = '10px';
      top.appendChild(createInsightStat('Products', totalProducts));
      top.appendChild(createInsightStat('Inventory units', totalStockUnits));
      wrap.appendChild(top);
      const r3 = createInsightStat('Inventory value', fmt(inventoryValue));
      r3.style.marginTop = '10px';
      wrap.appendChild(r3);
      const r4 = createInsightStat('Total revenue (all time)', fmt(totalRevenue));
      r4.style.marginTop = '10px';
      wrap.appendChild(r4);

      // --- Top Seller (Used for dashboard and alerts) ---
      const byProd = {};
      salesAll.forEach(sale => byProd[sale.productId] = (byProd[sale.productId] || 0) + n(sale.qty));
      const topEntry = Object.entries(byProd).sort((a,b)=>b[1]-a[1])[0];
      const topSellerProd = topEntry ? state.products.find(p => p.id === topEntry[0]) : null;
      const topSellerName = topSellerProd ? topSellerProd.name : '—';

      const block = document.createElement('div'); 
      block.style.marginTop = '12px';
      block.appendChild(createInsightStat('Top seller (all time)', topSellerName));
      wrap.appendChild(block);
      
      // --- **FEATURE**: Restock Alert ---
      if (topSellerProd && n(topSellerProd.qty) <= 5) {
        const alertEl = document.createElement('div');
        alertEl.style.cssText = 'background: #fffbeB; color: #b45309; padding: 10px; border-radius: 8px; margin-top: 12px; font-weight: 600;';
        alertEl.textContent = `🚨 Restock Alert: You are low on ${topSellerProd.name} (${topSellerProd.qty} left). This is your #1 top-selling product!`;
        wrap.appendChild(alertEl);
      }

      // --- **FEATURE**: Slow Mover Tip ---
      const now = Date.now();
      const salesLast30d = s.sales.filter(sale => sale.ts > now - 30 * 24 * 60 * 60 * 1000);
      const soldProductIds = new Set(salesLast30d.map(sale => sale.productId));
      const slowMover = s.products.find(p => !soldProductIds.has(p.id) && n(p.qty) > 0);

      if (slowMover) {
        const tipEl = document.createElement('div');
        tipEl.style.cssText = 'background: #eff6ff; color: #1e40af; padding: 10px; border-radius: 8px; margin-top: 12px; font-weight: 600;';
        tipEl.textContent = `💡 Slow Mover: ${slowMover.name} hasn't sold in over 30 days. Consider a promotion.`;
        wrap.appendChild(tipEl);
      }
      
      // --- Low Stock (Original) ---
      const lowStock = (s.products || []).filter(p => n(p.qty) <= 5 && p.id !== (topSellerProd ? topSellerProd.id : '')).slice(0, 3); 
      if (lowStock && lowStock.length) {
        const lowBlock = document.createElement('div'); 
        lowBlock.style.marginTop = '12px';
        const lowTitle = document.createElement('div');
        lowTitle.style.fontWeight = '700';
        lowTitle.textContent = 'Other Low Stock Items';
        lowBlock.appendChild(lowTitle);
        
        const ul = document.createElement('ul'); 
        ul.style.marginTop = '6px';
        lowStock.forEach(p=> {
          const li = document.createElement('li'); 
          li.textContent = `${p.name} — ${n(p.qty)} left`;
          ul.appendChild(li);
        });
        lowBlock.appendChild(ul);
        wrap.appendChild(lowBlock);
      }

      if (returnHtml) {
        return wrap.innerHTML; 
      }
      
      if (aiContent && aiCard) {
        aiContent.innerHTML = ''; // clear
        aiContent.appendChild(wrap);
        aiCard.style.display = 'block';
        if (toggleInsightsBtn) toggleInsightsBtn.setAttribute('aria-pressed','true');
      }

    } catch (e) {
      errlog('generateInsights failed', e);
      toast('Failed to generate insights', 'error');
      if (returnHtml) {
          const errEl = document.createElement('div');
          errEl.className = 'small error-text';
          errEl.textContent = 'Failed to generate insights.';
          return errEl.outerHTML;
      }
    }
  }

  if (toggleInsightsBtn) toggleInsightsBtn.addEventListener('click', function () {
    try {
      if (!aiCard) return;
      const visible = aiCard.style.display !== 'none' && aiCard.style.display !== '';
      if (visible) { aiCard.style.display = 'none'; toggleInsightsBtn.setAttribute('aria-pressed','false'); }
      else { generateInsights(); aiCard.style.display = 'block'; toggleInsightsBtn.setAttribute('aria-pressed','true'); }
    } catch (e) { errlog(e); }
  });
  if (refreshInsightsBtn) refreshInsightsBtn.addEventListener('click', generateInsights);
  
  const insightBtn = $('insightBtn');
  if (insightBtn) insightBtn.addEventListener('click', function () {
    const html = generateInsights(true); 
    showInventoryInsight(html); 
  });

  /* ---------- UI init after data load ---------- */
  function initAppUI() {
    try {
      renderChips(); 
      renderProducts(); 
      renderInventory(); 
      renderDashboard(); 
      // renderCategoryEditor(); // No need to call here, handled by setActiveView
      renderNotes();
      
      if (!document.querySelector('.panel.active')) {
          setActiveView('home', false); // [GEMINI] REQ 3: Pass false, do not scroll on initial load
      }
      showLoading(false);
      if ($('modalBackdrop')) $('modalBackdrop').style.display = 'none';
      if (barcodeScannerModal) barcodeScannerModal.style.display = 'none';
      if ($('inventoryInsightView')) $('inventoryInsightView').style.display = 'none';
      if ($('smartScannerModal')) $('smartScannerModal').style.display = 'none';
      if (reportBreakdown) reportBreakdown.style.paddingBottom = '24px';
      
      if ($('confirmModalBackdrop')) $('confirmModalBackdrop').style.display = 'none';

    } catch (e) { errlog('initAppUI failed', e); }
  }

  // --- UI polish: add-form modal backdrop & keyboard handling ---
  let addFormBackdrop = null;
  function createAddBackdrop() {
    if (document.getElementById('addFormBackdrop')) return document.getElementById('addFormBackdrop');
    const d = document.createElement('div');
    d.id = 'addFormBackdrop';
    d.addEventListener('click', hideAddForm); 
    document.body.appendChild(d);
    return d;
  }

  /* ---------- small initial UI actions ---------- */
  document.addEventListener('DOMContentLoaded', function () {
    
    // **NEW**: Shorten insight button text to fix overflow
    const insightBtn = $('insightBtn');
    if (insightBtn) {
      insightBtn.innerHTML = '💡 Insight';
      insightBtn.style.padding = "8px 12px"; // A bit more space for icon
    }
    const primaryScanBtn = $('primaryScanBtn');
    if (primaryScanBtn) {
        primaryScanBtn.style.padding = "8px 12px";
    }
    const toggleAddFormBtn = $('toggleAddFormBtn');
    if (toggleAddFormBtn) {
        toggleAddFormBtn.style.padding = "8px 12px";
    }

    try {
      if (toggleAddFormBtn && addForm) {
        toggleAddFormBtn.addEventListener('click', function (e) {
          e.preventDefault();
          try {
              editingProductId = null; 
              clearAddForm(); 
              showAddForm(true); // Show as modal
              setTimeout(()=>{ try { const invNameEl = $('invName'); if (invNameEl && typeof invNameEl.focus === 'function') invNameEl.focus(); }catch(e){} }, 220);
              
          } catch (err) { console.warn('toggleAddFormBtn handler error', err); }
        });
      }
    } catch(e) { console.warn('Failed to init add-form enhancements', e); }

    try {
      const body = document.body;
      function onViewportChange() {
        try {
          const vv = window.visualViewport;
          const height = vv ? vv.height : window.innerHeight;
          const viewportDiff = Math.abs(window.innerHeight - height);
          const threshold = 150; 
          body.classList.toggle('keyboard-open', viewportDiff > threshold);
        } catch(e) { /* ignore */ }
      }
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', onViewportChange);
      } else {
        window.addEventListener('resize', onViewportChange);
      }
      setTimeout(onViewportChange, 300);
    } catch(e) { console.warn('keyboard detection init failed', e); }
    
    hideAllAuthForms();
    showLoginForm();
    if ($('modalBackdrop')) $('modalBackdrop').style.display = 'none';
    if (barcodeScannerModal) barcodeScannerModal.style.display = 'none';
    if ($('smartScannerModal')) $('smartScannerModal').style.display = 'none';
    if ($('confirmModalBackdrop')) $('confirmModalBackdrop').style.display = 'none'; // Hide on load
    
    try {
      const closeInvBtn = $('closeInventoryInsightBtn');
      if (closeInvBtn) {
        closeInvBtn.addEventListener('click', closeInventoryInsight);
      }
    } catch(e) { errlog("Failed to attach insight close handler", e); }
  });

  // Expose a small debug API
  window.__QS_APP = {
    getAuth, getDb, getStorage, saveState, getState: () => state, startScanner, stopScanner, generateInsights, syncCloudData, showConfirm
  };

  // catch unhandled rejections
  window.addEventListener('unhandledrejection', function (ev) { console.error('Unhandled rejection:', ev.reason); toast('An unexpected error occurred. See console.', 'error'); });
  
  log('app.js loaded');
})();