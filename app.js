
// --- QuickShop Firebase readiness guard ---
function waitForFirebaseReady(timeoutMs = 3000) {
  return new Promise((resolve) => {
    if (window.__QS_FIREBASE && window.__QS_FIREBASE.firebase) return resolve(window.__QS_FIREBASE);
    let waited = 0;
    const iv = setInterval(() => {
      if (window.__QS_FIREBASE && window.__QS_FIREBASE.firebase) {
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


/* app.js — QuickShop (compat Firebase + ZXing)
   Replace your current app.js with this file content.
*/
(function () {
  'use strict';

  /* ---------- Small helpers ---------- */
  const log = (...a) => console.log('[QS]', ...a);
  const errlog = (...a) => console.error('[QS]', ...a);
  function escapeHtml(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function uid() { return 'p' + Math.random().toString(36).slice(2,9) + Date.now().toString(36); }
  function n(v) { const num = Number(v || 0); return isNaN(num) ? 0 : num; }
  function fmt(v) { return '₦' + Number(v || 0).toLocaleString('en-NG'); }
  function startOfDay(ts) { const d = new Date(ts); d.setHours(0,0,0,0); return d.getTime(); }
  function formatShortDate(ts) { return new Date(ts).toLocaleDateString('en-GB', { month:'short', day:'numeric' }); }
  function formatDateTime(ts) { return new Date(ts).toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }); }
  function toast(message, type = 'info', ms = 2800) {
    try {
      const t = document.createElement('div');
      t.textContent = message;
      Object.assign(t.style, {
        position: 'fixed', right: '14px', bottom: '90px', zIndex: 99999,
        padding: '10px 14px', borderRadius: '10px', fontWeight: 700,
        background: type === 'error' ? '#fff0f0' : 'white',
        color: type === 'error' ? '#b91c1c' : '#07122b',
        boxShadow: '0 8px 24px rgba(2,6,23,0.12)', opacity: 0, transform: 'translateY(10px)', transition: 'all 0.28s ease'
      });
      document.body.appendChild(t);
      requestAnimationFrame(()=> { t.style.opacity = '1'; t.style.transform = 'translateY(0)'; });
      setTimeout(()=> { t.style.opacity = '0'; t.style.transform = 'translateY(6px)'; }, ms);
      setTimeout(()=> t.remove(), ms + 300);
    } catch (e) { console.log('toast failed', e); }
  }

  /* ---------- Safety: ensure DOM present ---------- */
  if (typeof window === 'undefined') return errlog('Not a browser environment');

  /* ---------- Firebase compat references (safe) ---------- */
  if (typeof window.firebase === 'undefined') {
    errlog('Firebase global not found. Make sure compat SDK scripts are loaded BEFORE app.js');
    // don't return; we continue but many features will be disabled.
  }

  // Prefer objects exposed by HTML's initializer (window.__QS_FIREBASE) if provided
  const auth = (window.__QS_FIREBASE && window.__QS_FIREBASE.auth) || (window.firebase && firebase.auth && firebase.auth());
  const db = (window.__QS_FIREBASE && window.__QS_FIREBASE.db) || (window.firebase && firebase.firestore && firebase.firestore());

  /* ---------- App state ---------- */
  const LOCAL_KEY_PREFIX = 'quickshop_stable_v1_';
  let currentUser = null;
  let state = { products: [], sales: [], changes: [], notes: [] };
  let isSyncing = false;

  /* ---------- Barcode scanner state ---------- */
  let codeReader = null;
  let videoStream = null;
  let lastScannedBarcode = null;
  let scannerActive = false;

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
  const searchInput = $('searchInput'), chipsEl = $('chips'), productListEl = $('productList'), inventoryListEl = $('inventoryList');

  const invName = $('invName'), invBarcode = $('invBarcode'), invPrice = $('invPrice'), invCost = $('invCost'), invQty = $('invQty'), invCategory = $('invCategory');
  const invImgInput = $('invImg'), invImgPreview = $('invImgPreview'), invImgPreviewImg = $('invImgPreviewImg'), invImgClear = $('invImgClear'), addProductBtn = $('addProductBtn');

  // Barcode elements
  const scanBarcodeBtn = $('scanBarcodeBtn'), barcodeScannerModal = $('barcodeScannerModal'), barcodeVideo = $('barcodeVideo'), barcodeScanLine = $('barcodeScanLine'), barcodeResult = $('barcodeResult'), barcodeValue = $('barcodeValue'), barcodeCancelBtn = $('barcodeCancelBtn'), barcodeUseBtn = $('barcodeUseBtn');

  // dashboard / insights
  const dashRevenueEl = $('dashRevenue'), dashProfitEl = $('dashProfit'), dashTopEl = $('dashTop');
  const toggleInsightsBtn = $('toggleInsightsBtn'), aiCard = $('aiCard'), aiContent = $('aiContent'), refreshInsightsBtn = $('refreshInsights');

  // reports
  const reportRangeButtons = Array.from(document.querySelectorAll('.report-range-btn'));
  const reportMini = $('reportMini'), reportSummary = $('reportSummary'), reportBreakdown = $('reportBreakdown');

  // navigation / misc
  const navButtons = Array.from(document.querySelectorAll('.nav-btn')), btnSettings = $('btnSettings');

  /* ---------- Small UI utilities ---------- */
  function hideAllAuthForms() {
    if (loginForm) loginForm.style.display = 'none';
    if (signupForm) signupForm.style.display = 'none';
    if (resetForm) resetForm.style.display = 'none';
    if (verificationNotice) verificationNotice.style.display = 'none';
    if (authLoading) authLoading.style.display = 'none';
  }
  function showLoginForm() { hideAllAuthForms(); if (loginForm) loginForm.style.display = 'flex'; clearAuthInputs(); }
  function showSignupForm() { hideAllAuthForms(); if (signupForm) signupForm.style.display = 'flex'; clearAuthInputs(); }
  function showResetForm() { hideAllAuthForms(); if (resetForm) resetForm.style.display = 'flex'; clearAuthInputs(); }
  function showVerificationNotice(email) { hideAllAuthForms(); if (verificationNotice) verificationNotice.style.display = 'flex'; const v = $('verificationEmail'); if (v) v.textContent = email || (auth && auth.currentUser && auth.currentUser.email) || ''; }
  function showAuthLoading() { hideAllAuthForms(); if (authLoading) authLoading.style.display = 'flex'; }
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

  /* ---------- Firestore helper functions ---------- */
  async function setUserProfile(uid, profile) {
    if (!db) return false;
    try { await db.collection('users').doc(uid).set(profile, { merge: true }); return true; } catch (e) { errlog('setUserProfile', e); return false; }
  }
  async function getUserProfile(uid) {
    if (!db) return null;
    try { const snap = await db.collection('users').doc(uid).get(); return snap.exists ? snap.data() : null; } catch (e) { errlog('getUserProfile', e); return null; }
  }

  /* ---------- Local/cloud state save/load ---------- */
  async function saveState() {
    if (!currentUser) {
      // store locally only
      try { localStorage.setItem(LOCAL_KEY_PREFIX + 'anon', JSON.stringify(state)); } catch (e) { errlog('local save failed', e); }
      return;
    }
    if (isSyncing) return;
    isSyncing = true;
    try {
      showLoading(true, 'Syncing...');
      if (db) {
        await db.collection('users').doc(currentUser.uid).set({ ...state, lastSync: Date.now() }, { merge: true });
      }
      localStorage.setItem(LOCAL_KEY_PREFIX + currentUser.uid, JSON.stringify({...state, lastSync: Date.now()}));
    } catch (e) {
      errlog('saveState failed', e);
      toast('Cloud sync failed — data saved locally.', 'error');
      try { localStorage.setItem(LOCAL_KEY_PREFIX + currentUser.uid, JSON.stringify(state)); } catch (ex) { errlog('local save failed', ex); }
    } finally {
      showLoading(false);
      isSyncing = false;
    }
  }

  async function loadUserData(user) {
    currentUser = user;
    try {
      showLoading(true, 'Loading your data...');
      const localKey = user ? LOCAL_KEY_PREFIX + user.uid : LOCAL_KEY_PREFIX + 'anon';
      const localRaw = localStorage.getItem(localKey);
      const local = localRaw ? JSON.parse(localRaw) : null;

      if (user && db) {
        const docRef = db.collection('users').doc(user.uid);
        const docSnap = await docRef.get();
        if (docSnap && docSnap.exists) {
          const cloud = docSnap.data();
          // choose newest copy
          if (local && local.lastSync && cloud.lastSync && local.lastSync > cloud.lastSync) {
            if (confirm('Local data looks newer than cloud. Upload local copy to cloud?')) {
              state = local;
              await docRef.set(local, { merge: true });
            } else {
              state = cloud;
            }
          } else {
            state = cloud;
          }
        } else {
          if (local) state = local;
          else state = { products: [], sales: [], changes: [], notes: [] };
          // create cloud doc
          await docRef.set({ ...state, lastSync: Date.now() });
        }
      } else {
        // no cloud available, load local or init
        if (local) state = local;
        else state = { products: [], sales: [], changes: [], notes: [] };
      }
      state.products = state.products || [];
      state.sales = state.sales || [];
      state.changes = state.changes || [];
      state.notes = state.notes || [];
    } catch (e) {
      errlog('loadUserData failed', e);
      toast('Failed to load cloud data — using local data', 'error');
      const localKey = user ? LOCAL_KEY_PREFIX + user.uid : LOCAL_KEY_PREFIX + 'anon';
      const localRaw = localStorage.getItem(localKey);
      if (localRaw) try { state = JSON.parse(localRaw); } catch (ex) { state = { products: [], sales: [], changes: [], notes: [] }; }
      else state = { products: [], sales: [], changes: [], notes: [] };
    } finally {
      showLoading(false);
      initAppUI();
    }
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

  // login
  if (btnLogin) btnLogin.addEventListener('click', async function () {
    const email = (loginEmail && loginEmail.value || '').trim();
    const pass = (loginPass && loginPass.value) || '';
    if (!validateEmail(email)) { toast('Please enter a valid email', 'error'); if (loginEmail) loginEmail.classList.add('error'); return; }
    if (!pass || pass.length < 6) { toast('Password must be at least 6 characters', 'error'); if (loginPass) loginPass.classList.add('error'); return; }
    try {
      showAuthLoading(); disableBtn(btnLogin, true);
      if (!auth) throw new Error('Auth not initialized');
      const cred = await auth.signInWithEmailAndPassword(email, pass);
      if (!cred.user.emailVerified) {
        await auth.signOut();
        showVerificationNotice(email);
        toast('Please verify your email before logging in', 'error');
        return;
      }
      toast('Login successful');
      // onAuthStateChanged will pick up and call loadUserData
    } catch (e) {
      errlog('login error', e);
      showLoginForm();
      toast(mapAuthError(e), 'error');
    } finally {
      disableBtn(btnLogin, false);
      if (authLoading) authLoading.style.display = 'none';
    }
  });

  // show/hide forms
  if (btnShowSignup) btnShowSignup.addEventListener('click', showSignupForm);
  if (btnBackToLogin) btnBackToLogin.addEventListener('click', showLoginForm);
  if (btnForgotPassword) btnForgotPassword.addEventListener('click', showResetForm);
  if (btnBackToLoginFromReset) btnBackToLoginFromReset.addEventListener('click', showLoginForm);

  // signup
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
      if (!auth) throw new Error('Auth not initialized');
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

  // password reset
  if (btnSendReset) btnSendReset.addEventListener('click', async function () {
    const email = (resetEmail && resetEmail.value || '').trim();
    if (!validateEmail(email)) { toast('Please enter a valid email', 'error'); if (resetEmail) resetEmail.classList.add('error'); return; }
    try {
      showAuthLoading(); disableBtn(btnSendReset, true);
      if (!auth) throw new Error('Auth not initialized');
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

  // verification helpers
  if (btnResendVerification) btnResendVerification.addEventListener('click', async function () {
    try {
      const user = auth && auth.currentUser;
      if (!user) { toast('You need to be signed in to resend verification', 'error'); return; }
      await user.sendEmailVerification();
      toast('Verification email resent. Check your inbox.');
    } catch (e) { errlog('resend verification error', e); toast('Failed to resend verification. Try again later.', 'error'); }
  });
  if (btnCheckVerification) btnCheckVerification.addEventListener('click', async function () {
    try {
      showAuthLoading();
      const user = auth && auth.currentUser;
      if (!user) { toast('Not signed in — please login after verifying your email.', 'error'); showLoginForm(); return; }
      await user.reload();
      if (user.emailVerified) { toast('Email verified! Loading your account...'); } else { toast('Email not verified yet. Please check your inbox.', 'error'); showVerificationNotice(user.email); }
    } catch (e) { errlog('check verification error', e); toast('Error checking verification status', 'error'); showVerificationNotice(auth && auth.currentUser && auth.currentUser.email); }
    finally { if (authLoading) authLoading.style.display = 'none'; }
  });
  if (btnLogoutFromVerification) btnLogoutFromVerification.addEventListener('click', async function () { try { if (auth) await auth.signOut(); toast('Logged out'); showLoginForm(); } catch (e) { errlog('logout error', e); toast('Logout failed', 'error'); } });

  if (btnLogout) btnLogout.addEventListener('click', async function () {
    if (!confirm('Are you sure you want to sign out?')) return;
    try { if (auth) await auth.signOut(); toast('Signed out'); } catch (e) { errlog('signout error', e); toast('Sign out failed: ' + (e.message || ''), 'error'); }
  });

  /* ---------- Auth observer ---------- */
  let initialAuthChecked = false;
  if (auth && auth.onAuthStateChanged) {
    auth.onAuthStateChanged(async function (user) {
      if (!initialAuthChecked) initialAuthChecked = true;
      if (user) {
        currentUser = user;
        // If not verified, show verification notice
        if (!user.emailVerified) {
          if (loginScreen) loginScreen.style.display = 'flex';
          if (appScreen) appScreen.style.display = 'none';
          showVerificationNotice(user.email);
          return;
        }
        // verified - show app
        if (loginScreen) loginScreen.style.display = 'none';
        if (appScreen) appScreen.style.display = 'block';
        if (userEmailEl) userEmailEl.textContent = user.email || '—';
        if (userDisplayNameEl) userDisplayNameEl.textContent = user.displayName ? `Name: ${user.displayName}` : '';
        try {
          const profile = await getUserProfile(user.uid);
          if (!profile) await setUserProfile(user.uid, { uid: user.uid, name: user.displayName || null, email: user.email, createdAt: Date.now() });
        } catch (e) { console.warn('profile ensure failed', e); }
        await loadUserData(user);
      } else {
        currentUser = null;
        if (loginScreen) loginScreen.style.display = 'flex';
        if (appScreen) appScreen.style.display = 'none';
        showLoginForm();
        if (userEmailEl) userEmailEl.textContent = '—';
        if (userDisplayNameEl) userDisplayNameEl.textContent = '';
        state = { products: [], sales: [], changes: [], notes: [] };
        showLoading(false);
      }
    });
  } else {
    // no auth available — load local state
    loadUserData(null);
  }

  /* ---------- Barcode scanner (graceful) ---------- */
  function stopScanner() {
    try {
      if (codeReader && codeReader.reset) { try { codeReader.reset(); } catch(e){} }
      if (videoStream) { try { videoStream.getTracks().forEach(t => t.stop()); } catch(e){} videoStream = null; }
    } catch (e) { console.warn('stopScanner err', e); }
    scannerActive = false;
    try { if (barcodeScanLine) barcodeScanLine.style.display = 'none'; if (barcodeScannerModal) barcodeScannerModal.style.display = 'none'; } catch(e){}
    lastScannedBarcode = null;
    if (barcodeResult) barcodeResult.style.display = 'none';
    if (barcodeUseBtn) barcodeUseBtn.style.display = 'none';
  }

  function handleScanResult(result) {
    if (!result || !result.text) return;
    if (result.text === lastScannedBarcode) return;
    lastScannedBarcode = result.text;
    if (barcodeValue) barcodeValue.textContent = lastScannedBarcode;
    if (barcodeResult) barcodeResult.style.display = 'block';
    if (barcodeUseBtn) barcodeUseBtn.style.display = 'inline-block';
    toast('Barcode scanned!', 'info', 900);
    // stopContinuous if API exists
    try { if (codeReader && codeReader.stopContinuousDecode) codeReader.stopContinuousDecode(); } catch(e){}
    if (barcodeScanLine) barcodeScanLine.style.display = 'none';
  }

  async function startScanner() {
    if (scannerActive) return;
    if (typeof window.ZXing === 'undefined') { toast('Barcode library not loaded.', 'error'); return; }
    try {
      if (!barcodeScannerModal) return;
      barcodeScannerModal.style.display = 'flex';
      if (barcodeResult) barcodeResult.style.display = 'none';
      if (barcodeUseBtn) barcodeUseBtn.style.display = 'none';
      if (barcodeScanLine) barcodeScanLine.style.display = 'block';
      scannerActive = true;
      codeReader = new ZXing.BrowserMultiFormatReader();
      // getUserMedia stream
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      videoStream = stream;
      if (barcodeVideo) { barcodeVideo.srcObject = stream; barcodeVideo.play().catch(()=>{}); }
      // decode continuously (use decodeFromVideoDevice if available)
      if (codeReader.decodeFromVideoDevice) {
        // decodeFromVideoDevice accepts deviceId or null
        try {
          codeReader.decodeFromVideoDevice(null, barcodeVideo, (result, err) => {
            if (result) handleScanResult(result);
            // ignore noisy NotFoundException messages
            if (err && err.name && err.name !== 'NotFoundException') console.warn('ZXing err', err);
          });
        } catch (e) {
          // fallback to decodeContinuously API if present
          try { if (codeReader.decodeContinuously) codeReader.decodeContinuously(barcodeVideo, (res, er) => { if (res) handleScanResult(res); }); } catch (ex) { throw ex; }
        }
      } else if (codeReader.decodeContinuously) {
        codeReader.decodeContinuously(barcodeVideo, (res, er) => { if (res) handleScanResult(res); });
      } else {
        toast('Barcode scanner not supported in this browser', 'error');
        stopScanner();
      }
    } catch (e) {
      errlog('Barcode Scanner Error:', e);
      toast('Failed to start camera. Check permissions/device.', 'error');
      stopScanner();
    }
  }

  if (scanBarcodeBtn) scanBarcodeBtn.addEventListener('click', startScanner);
  if (barcodeCancelBtn) barcodeCancelBtn.addEventListener('click', stopScanner);
  if (barcodeUseBtn) barcodeUseBtn.addEventListener('click', function () {
    if (lastScannedBarcode && invBarcode) invBarcode.value = lastScannedBarcode;
    stopScanner();
  });
  if (barcodeScannerModal) barcodeScannerModal.addEventListener('click', function (e) { if (e.target && e.target.id === 'barcodeScannerModal') stopScanner(); });

  /* ---------- Products rendering (safe DOM APIs) ---------- */
  const CATEGORIES = ['All', 'Drinks', 'Snacks', 'Groceries', 'Clothing', 'Others'];
  let activeCategory = 'All';
  function renderChips() {
    if (!chipsEl) return;
    chipsEl.innerHTML = '';
    CATEGORIES.forEach(c => {
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
      // thumb
      const thumb = document.createElement('div'); thumb.className = 'p-thumb';
      if (p.image) {
        const img = document.createElement('img'); img.src = p.image; img.alt = p.name || 'thumb'; thumb.appendChild(img);
      } else {
        thumb.textContent = (p.icon && p.icon.length) ? p.icon : ((p.name || '').split(' ').map(s => s[0]).slice(0,2).join('').toUpperCase());
      }
      // info
      const info = document.createElement('div'); info.className = 'p-info';
      const nameEl = document.createElement('div'); nameEl.className = 'p-name'; nameEl.textContent = p.name || 'Unnamed';
      const subEl = document.createElement('div'); subEl.className = 'p-sub';
      const qtyText = (typeof p.qty === 'number') ? `${p.qty} in stock` : '—';
      subEl.textContent = `${qtyText} • ${fmt(p.price || 0)}` + (p.barcode ? (' • Barcode: ' + p.barcode) : '');
      info.appendChild(nameEl); info.appendChild(subEl);
      // actions
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

  // product clicks
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
  function showModal() { const mb = $('modalBackdrop'); if (mb) { mb.style.display = 'flex'; setTimeout(()=> { const q = $('modalQty'); if (q) q.focus(); }, 100); } }
  function hideModal() { const mb = $('modalBackdrop'); if (mb) mb.style.display = 'none'; modalContext = null; }

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

  document.getElementById('modalCancel') && document.getElementById('modalCancel').addEventListener('click', hideModal);
  const modalBackdropEl = $('modalBackdrop');
  if (modalBackdropEl) modalBackdropEl.addEventListener('click', function (e) { if (e.target && e.target.id === 'modalBackdrop') hideModal(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hideModal(); });

  document.getElementById('modalConfirm') && document.getElementById('modalConfirm').addEventListener('click', function () {
    if (!modalContext) { hideModal(); return; }
    const qtyEl = $('modalQty'); const q = Math.max(1, Math.floor(n(qtyEl && qtyEl.value)));
    if (modalContext.mode === 'sell') doSell(modalContext.productId, q); else doAddStock(modalContext.productId, q);
    hideModal();
  });

  /* ---------- product actions ---------- */
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
    if (p.qty < qty) {
      if (!confirm(`${p.name} has only ${p.qty} in stock. Sell anyway?`)) return;
    }
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
        state.changes.splice(i,1);
        saveState(); renderInventory(); renderProducts(); renderDashboard();
        toast(`Reverted add of ${ch.qty}`);
        return;
      }
      if (ch.type === 'sell') {
        // try to remove corresponding sale
        for (let j = state.sales.length - 1; j >= 0; j--) {
          const s = state.sales[j];
          if (s.productId === productId && s.qty === ch.qty && Math.abs(s.ts - ch.ts) < 120000) {
            state.sales.splice(j,1);
            const p = state.products.find(x => x.id === productId);
            if (p) p.qty = (typeof p.qty === 'number' ? p.qty + ch.qty : ch.qty);
            state.changes.splice(i,1);
            saveState(); renderInventory(); renderProducts(); renderDashboard();
            toast(`Reverted sale of ${ch.qty}`);
            return;
          }
        }
        // fallback revert
        const p = state.products.find(x => x.id === productId);
        if (p) p.qty = (typeof p.qty === 'number' ? p.qty + ch.qty : ch.qty);
        state.changes.splice(i,1);
        saveState(); renderInventory(); renderProducts(); renderDashboard();
        toast('Reverted sale record');
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
    invImgInput.addEventListener('change', function (e) {
      const file = e.target.files && e.target.files[0];
      if (!file) { clearInvImage(); return; }
      const MAX_IMG_SIZE = 500 * 1024;
      if (file.size > MAX_IMG_SIZE) { toast('Image too large (max 500KB). Use smaller image.', 'error'); e.target.value = ''; return; }
      const reader = new FileReader();
      reader.onload = function (ev) { try { if (invImgPreviewImg) invImgPreviewImg.src = ev.target.result; if (invImgPreview) invImgPreview.style.display = 'flex'; } catch(e){} };
      reader.onerror = function () { toast('Failed to read image', 'error'); clearInvImage(); };
      reader.readAsDataURL(file);
    });
  }
  if (invImgClear) invImgClear.addEventListener('click', function (e) { e.preventDefault(); clearInvImage(); });

  if (addProductBtn) addProductBtn.addEventListener('click', function () {
    const name = (invName && invName.value || '').trim();
    const barcode = (invBarcode && invBarcode.value || '').trim();
    const price = n(invPrice && invPrice.value);
    const cost = n(invCost && invCost.value);
    const qty = n(invQty && invQty.value);
    const category = (invCategory && invCategory.value) || 'Others';
    const valid = validateProduct(name, price, cost, qty);
    if (!valid.valid) { toast(valid.error, 'error'); return; }
    const newProduct = { id: uid(), name, price, cost, qty: qty || 0, category, image: (invImgPreviewImg && invImgPreviewImg.src) || null, icon: null, barcode: barcode || null };
    state.products.push(newProduct);
    saveState();
    // clear form
    if (invName) invName.value = ''; if (invBarcode) invBarcode.value = ''; if (invPrice) invPrice.value = ''; if (invCost) invCost.value = ''; if (invQty) invQty.value = '';
    if (invCategory) invCategory.value = 'Others';
    clearInvImage();
    const addForm = $('addForm'); if (addForm) addForm.style.display = 'none';
    renderInventory(); renderProducts(); renderDashboard(); renderCustomList();
    toast('Product saved');
  });

  function validateProduct(name, price, cost, qty) {
    if (!name || name.trim().length === 0) return { valid: false, error: 'Product name is required' };
    if (price <= 0) return { valid: false, error: 'Price must be greater than 0' };
    if (cost < 0) return { valid: false, error: 'Cost cannot be negative' };
    if (qty < 0) return { valid: false, error: 'Stock cannot be negative' };
    return { valid: true };
  }

  function renderInventory() {
    if (!inventoryListEl) return;
    inventoryListEl.innerHTML = '';
    if (!state.products || state.products.length === 0) {
      const no = document.createElement('div'); no.className = 'small';
      no.style.padding = '12px'; no.style.background = 'var(--card-bg)'; no.style.borderRadius = '12px'; no.style.border = '1px solid rgba(7,18,43,0.04)';
      no.textContent = 'No products in inventory';
      inventoryListEl.appendChild(no); return;
    }
    for (const p of state.products) {
      const el = document.createElement('div'); el.className = 'inventory-card';
      const top = document.createElement('div'); top.className = 'inventory-top';
      const thumb = document.createElement('div'); thumb.className = 'p-thumb';
      if (p.image) { const img = document.createElement('img'); img.src = p.image; img.alt = p.name || ''; thumb.appendChild(img); }
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

  function openEditProduct(id) {
    const p = state.products.find(x => x.id === id); if (!p) return;
    const newName = prompt('Name', p.name); if (newName === null) return;
    const newPrice = prompt('Selling price (₦)', String(p.price)); if (newPrice === null) return;
    const newCost = prompt('Cost price (₦)', String(p.cost)); if (newCost === null) return;
    const newQty = prompt('Stock quantity', String(p.qty || 0)); if (newQty === null) return;
    const newBarcode = prompt('Barcode (optional)', p.barcode || ''); if (newBarcode === null) return;
    const validation = validateProduct(newName, n(newPrice), n(newCost), n(newQty));
    if (!validation.valid) { toast(validation.error, 'error'); return; }
    p.name = newName.trim(); p.price = n(newPrice); p.cost = n(newCost); p.qty = n(newQty); p.barcode = newBarcode.trim() || null;
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
    saveState(); renderInventory(); renderProducts(); renderDashboard(); renderCustomList(); renderNotes();
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
    const byProd = {};
    salesToday.forEach(s => byProd[s.productId] = (byProd[s.productId]||0) + s.qty);
    const arr = Object.entries(byProd).sort((a,b)=>b[1]-a[1]);
    let topName = '—';
    if (arr.length) topName = (state.products.find(p=>p.id===arr[0][0]) || {}).name || '—';
    // overall
    const overallByProd = {}; (state.sales||[]).forEach(s => overallByProd[s.productId] = (overallByProd[s.productId]||0) + s.qty);
    const overallArr = Object.entries(overallByProd).sort((a,b)=>b[1]-a[1]);
    if (overallArr.length) topName = (state.products.find(p => p.id === overallArr[0][0]) || {}).name || topName;
    if (dashTopEl) dashTopEl.textContent = topName;
  }

  /* ---------- Notes ---------- */
  function renderNotes() {
    const notesListEl = $('notesList');
    if (!notesListEl) return;
    notesListEl.innerHTML = '';
    const notes = (state.notes || []).slice().sort((a,b)=>b.ts - a.ts);
    if (!notes.length) { notesListEl.innerHTML = '<div class="small">No notes yet — add one above.</div>'; return; }
    for (const note of notes) {
      const item = document.createElement('div'); item.className = 'note-item';
      if (note.title) {
        const t = document.createElement('div'); t.style.fontWeight = '800'; t.innerHTML = escapeHtml(note.title); item.appendChild(t);
      }
      const c = document.createElement('div'); c.style.marginTop = '6px'; c.style.whiteSpace = 'pre-wrap'; c.innerHTML = escapeHtml(note.content); item.appendChild(c);
      const meta = document.createElement('div'); meta.className = 'note-meta'; meta.textContent = formatDateTime(note.ts); item.appendChild(meta);
      const actions = document.createElement('div'); actions.style.display = 'flex'; actions.style.gap = '8px'; actions.style.justifyContent = 'flex-end'; actions.style.marginTop = '8px';
      const edit = document.createElement('button'); edit.className = 'btn-edit'; edit.textContent = 'Edit'; edit.dataset.editNote = note.id;
      const del = document.createElement('button'); del.className = 'btn-delete'; del.textContent = 'Delete'; del.dataset.deleteNote = note.id;
      actions.appendChild(edit); actions.appendChild(del); item.appendChild(actions);
      notesListEl.appendChild(item);
    }
    // attach listeners
    notesListEl.querySelectorAll('[data-edit-note]').forEach(b => b.addEventListener('click', function () {
      const id = this.dataset.editNote; const note = state.notes.find(n=>n.id===id); if (!note) return;
      $('noteTitle').value = note.title || ''; $('noteContent').value = note.content || '';
      editingNoteId = note.id; $('noteSaveBtn').textContent = 'Update Note'; setActiveView('notes');
    }));
    notesListEl.querySelectorAll('[data-delete-note]').forEach(b => b.addEventListener('click', function () {
      if (!confirm('Delete this note?')) return;
      state.notes = state.notes.filter(n => n.id !== this.dataset.deleteNote);
      saveState(); renderNotes(); toast('Note deleted');
    }));
  }

  let editingNoteId = null;
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
  if (btnLoadDemo) btnLoadDemo.addEventListener('click', function () {
    if (!confirm('Load demo products into store?')) return;
    state.products.push({ id: uid(), name: 'Rice (5kg)', price: 2000, cost: 1500, qty: 34, category: 'Groceries', icon: '🍚', barcode: '123456789012' });
    state.products.push({ id: uid(), name: 'Bottled Water', price: 150, cost: 70, qty: 80, category: 'Drinks', icon: '💧', barcode: '234567890123' });
    state.products.push({ id: uid(), name: 'T-Shirt', price: 1200, cost: 600, qty: 50, category: 'Clothing', icon: '👕', barcode: '345678901234' });
    state.products.push({ id: uid(), name: 'Indomie', price: 200, cost: 60, qty: 120, category: 'Snacks', icon: '🍜', barcode: null });
    saveState(); renderInventory(); renderProducts(); renderDashboard(); renderCustomList(); toast('Demo loaded');
  });
  if (btnClearStore) btnClearStore.addEventListener('click', function () {
    if (!confirm('Clear all products and history? This action cannot be undone.')) return;
    state.products = []; state.sales = []; state.changes = []; state.notes = [];
    saveState(); renderInventory(); renderProducts(); renderDashboard(); renderCustomList(); renderNotes(); toast('Store cleared');
  });

  function renderCustomList() {
    const customListArea = $('customListArea'); if (!customListArea) return;
    customListArea.innerHTML = '';
    if (!state.products || state.products.length === 0) { customListArea.innerHTML = '<div class="small">No products.</div>'; return; }
    for (const p of state.products) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px dashed #eef2f3';
      const left = document.createElement('div'); left.style.cssText = 'display:flex;gap:8px;align-items:center';
      const imgWrap = document.createElement('div'); imgWrap.style.cssText = 'width:36px;height:36px;border-radius:8px;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center';
      if (p.image) { const im = document.createElement('img'); im.src = p.image; im.style.cssText = 'width:36px;height:36px;object-fit:cover'; imgWrap.appendChild(im); }
      else if (p.icon) { const ic = document.createElement('div'); ic.style.cssText = 'font-size:18px;padding:6px'; ic.innerText = p.icon; imgWrap.appendChild(ic); }
      else { const ic = document.createElement('div'); ic.style.cssText = 'padding:6px;font-weight:800'; ic.innerText = (p.name||'').slice(0,2).toUpperCase(); imgWrap.appendChild(ic); }
      const txt = document.createElement('div'); const strong = document.createElement('strong'); strong.textContent = p.name; const small = document.createElement('div'); small.className = 'small'; small.textContent = `${p.qty || 0} in stock • ${fmt(p.price)}`; txt.appendChild(strong); txt.appendChild(small);
      left.appendChild(imgWrap); left.appendChild(txt);
      const right = document.createElement('div'); right.style.cssText = 'display:flex;gap:8px';
      const editBtn = document.createElement('button'); editBtn.className = 'btn-edit'; editBtn.dataset.edit = p.id; editBtn.textContent = 'Edit';
      const delBtn = document.createElement('button'); delBtn.className = 'btn-delete'; delBtn.dataset.del = p.id; delBtn.textContent = 'Delete';
      right.appendChild(editBtn); right.appendChild(delBtn);
      row.appendChild(left); row.appendChild(right);
      customListArea.appendChild(row);
    }
    customListArea.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', function(){ openEditProduct(this.dataset.edit); }));
    customListArea.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', function(){ removeProduct(this.dataset.del); }));
  }

  /* ---------- Navigation ---------- */
  function setActiveView(view) {
    navButtons.forEach(b => { const isActive = b.dataset.view === view; b.classList.toggle('active', isActive); b.setAttribute('aria-pressed', isActive ? 'true':'false'); });
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    const panel = $(view + 'Panel'); if (panel) panel.classList.add('active');
    if (view === 'reports') renderReports();
    if (view === 'settings') renderCustomList();
    if (view === 'home') renderDashboard();
    if (view === 'notes') renderNotes();
    // ensure scrolled to top of panel
    setTimeout(()=> { try { const el = document.querySelector('.panel.active'); if (el) el.scrollTop = 0; } catch(e){} }, 60);
  }
  navButtons.forEach(btn => btn.addEventListener('click', function(){ setActiveView(this.dataset.view); }));
  if (btnSettings) btnSettings.addEventListener('click', function(){ setActiveView('settings'); });

  /* ---------- Reports: createBuckets & aggregation (fixed) ---------- */
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
        buckets.push({ start, end, label: `${formatShortDate(start)} - ${formatShortDate(end - 1)}` });
      }
    }
    return buckets;
  }

  function aggregateSalesInRange(start, end) {
    const sales = (state.sales || []).filter(s => s.ts >= start && s.ts < end);
    return {
      units: sales.reduce((a,s)=>a + (n(s.qty) || 0), 0),
      revenue: sales.reduce((a,s)=>a + ((n(s.price) || 0) * (n(s.qty) || 0)), 0),
      profit: sales.reduce((a,s)=>a + ((n(s.price) - n(s.cost)) * (n(s.qty) || 0)), 0)
    };
  }

  let currentReportRange = 'daily';
  function renderReports(range = currentReportRange) {
    currentReportRange = range;
    reportRangeButtons.forEach(b => b.classList.toggle('active', b.dataset.range === range));
    const buckets = createBuckets(range);
    const totalMetrics = aggregateSalesInRange(buckets[0].start, buckets[buckets.length-1].end);
    if (reportMini) reportMini.textContent = fmt(totalMetrics.revenue);
    if (reportSummary) {
      reportSummary.innerHTML = '';
      const wrap = document.createElement('div'); wrap.className = 'report-summary-cards';
      const cardR = document.createElement('div'); cardR.className = 'report-card'; cardR.innerHTML = `<div class="small">Revenue (range)</div><div style="font-weight:800;margin-top:6px">${fmt(totalMetrics.revenue)}</div>`;
      const cardP = document.createElement('div'); cardP.className = 'report-card'; cardP.innerHTML = `<div class="small">Profit (range)</div><div style="font-weight:800;margin-top:6px">${fmt(totalMetrics.profit)}</div>`;
      const cardU = document.createElement('div'); cardU.className = 'report-card'; cardU.innerHTML = `<div class="small">Units (range)</div><div style="font-weight:800;margin-top:6px">${totalMetrics.units}</div>`;
      wrap.appendChild(cardR); wrap.appendChild(cardP); wrap.appendChild(cardU);
      reportSummary.appendChild(wrap);
    }
    // table
    if (reportBreakdown) {
      reportBreakdown.innerHTML = '';
      const outer = document.createElement('div');
      outer.style.cssText = 'background:var(--card-bg);padding:10px;border-radius:12px;border:1px solid rgba(7,18,43,0.04);margin-top:12px';
      const tbl = document.createElement('table'); tbl.style.cssText = 'width:100%;border-collapse:collapse';
      const thead = document.createElement('thead');
      thead.innerHTML = `<tr style="text-align:left"><th style="padding:8px">Period</th><th style="padding:8px">Units</th><th style="padding:8px">Revenue</th><th style="padding:8px">Profit</th></tr>`;
      tbl.appendChild(thead);
      const tbody = document.createElement('tbody');
      for (const b of buckets) {
        const m = aggregateSalesInRange(b.start, b.end);
        const tr = document.createElement('tr');
        tr.innerHTML = `<td style="padding:8px;border-top:1px solid #f1f5f9">${escapeHtml(b.label)}</td><td style="padding:8px;border-top:1px solid #f1f5f9">${m.units}</td><td style="padding:8px;border-top:1px solid #f1f5f9">${fmt(m.revenue)}</td><td style="padding:8px;border-top:1px solid #f1f5f9">${fmt(m.profit)}</td>`;
        tbody.appendChild(tr);
      }
      tbl.appendChild(tbody);
      outer.appendChild(tbl);
      reportBreakdown.appendChild(outer);
      // ensure it's not hidden behind bottom nav
      reportBreakdown.style.paddingBottom = '120px';
      setTimeout(()=> { try { reportBreakdown.scrollIntoView({behavior:'smooth', block:'start'}); } catch(e){} }, 50);
    }
  }
  reportRangeButtons.forEach(b => b.addEventListener('click', function () { renderReports(this.dataset.range); }));

  // Export All sales CSV
  const exportReport = $('exportReport'), exportCurrentReport = $('exportCurrentReport');
  if (exportReport) exportReport.addEventListener('click', function () {
    const rows = [['Timestamp','Product','Qty','UnitPrice','Total','Cost','Profit','Barcode']];
    (state.sales || []).forEach(s => {
      const p = state.products.find(x=>x.id===s.productId);
      const total = (n(s.price) * n(s.qty));
      const profit = (n(s.price) - n(s.cost)) * n(s.qty);
      rows.push([new Date(s.ts).toISOString(), p?.name || s.productId, s.qty, s.price, total, s.cost, profit, p?.barcode || '']);
    });
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'sales_all.csv'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  });
  if (exportCurrentReport) exportCurrentReport.addEventListener('click', function () {
    const buckets = createBuckets(currentReportRange);
    const rows = [['Period','Units','Revenue','Profit']];
    for (const b of buckets) { const m = aggregateSalesInRange(b.start, b.end); rows.push([b.label, m.units, m.revenue, m.profit]); }
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `report_${currentReportRange}.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  });

  /* ---------- Insights Generation (local first, fallback to cloud) ---------- */
  async function computeInsightsFromCloud() {
    if (!db || !currentUser) return null;
    try {
      // we'll fetch user's doc and aggregate quickly
      const snap = await db.collection('users').doc(currentUser.uid).get();
      if (!snap.exists) return null;
      const doc = snap.data();
      return doc; // doc contains products, sales, notes if stored in same shape
    } catch (e) { errlog('computeInsightsFromCloud err', e); return null; }
  }

  function generateInsights() {
    // compute using local state (preferred)
    try {
      const s = state || { products: [], sales: [], notes: [] };
      // metrics
      const totalProducts = (s.products || []).length;
      const totalStockUnits = (s.products || []).reduce((a,p)=>a + (n(p.qty)), 0);
      const inventoryValue = (s.products || []).reduce((a,p)=>a + (n(p.qty) * n(p.cost)), 0);
      // sales metrics
      const salesAll = s.sales || [];
      const totalRevenue = salesAll.reduce((a,sale)=>a + (n(sale.price) * n(sale.qty)), 0);
      const totalProfit = salesAll.reduce((a,sale)=>a + ((n(sale.price) - n(sale.cost)) * n(sale.qty)), 0);
      // top seller
      const byProd = {};
      salesAll.forEach(sale => byProd[sale.productId] = (byProd[sale.productId] || 0) + n(sale.qty));
      const topEntry = Object.entries(byProd).sort((a,b)=>b[1]-a[1])[0];
      const topSellerName = topEntry ? ( (state.products.find(p=>p.id===topEntry[0]) || {}).name || '—' ) : '—';
      // category performance
      const catUnits = {};
      salesAll.forEach(sale => {
        const prod = state.products.find(p=>p.id===sale.productId);
        const cat = prod ? (prod.category || 'Others') : 'Unknown';
        catUnits[cat] = (catUnits[cat] || 0) + n(sale.qty);
      });
      const bestCategory = Object.entries(catUnits).sort((a,b)=>b[1]-a[1])[0];
      // low stock
      const lowStock = (s.products || []).filter(p => n(p.qty) <= 5).slice(0,6); // show up to 6

      // render output to aiContent
      if (aiContent && aiCard) {
        aiContent.innerHTML = ''; // clear
        const wrap = document.createElement('div');
        const top = document.createElement('div'); top.style.display = 'grid'; top.style.gridTemplateColumns = '1fr 1fr'; top.style.gap = '10px';
        const r1 = document.createElement('div'); r1.innerHTML = `<div class="small">Products</div><div style="font-weight:800">${totalProducts}</div>`;
        const r2 = document.createElement('div'); r2.innerHTML = `<div class="small">Inventory units</div><div style="font-weight:800">${totalStockUnits}</div>`;
        top.appendChild(r1); top.appendChild(r2);
        const r3 = document.createElement('div'); r3.style.marginTop = '10px'; r3.innerHTML = `<div class="small">Inventory value</div><div style="font-weight:800">${fmt(inventoryValue)}</div>`;
        const r4 = document.createElement('div'); r4.style.marginTop = '10px'; r4.innerHTML = `<div class="small">Total revenue</div><div style="font-weight:800">${fmt(totalRevenue)}</div>`;
        wrap.appendChild(top); wrap.appendChild(r3); wrap.appendChild(r4);
        // top seller & best category
        const block = document.createElement('div'); block.style.marginTop = '12px';
        block.innerHTML = `<div style="font-weight:800;margin-bottom:6px">Top seller</div><div>${escapeHtml(topSellerName)}</div>`;
        wrap.appendChild(block);
        if (bestCategory) {
          const cblock = document.createElement('div'); cblock.style.marginTop = '12px'; cblock.innerHTML = `<div class="small">Best category</div><div style="font-weight:800">${escapeHtml(bestCategory[0])} — ${bestCategory[1]} units</div>`;
          wrap.appendChild(cblock);
        }
        // low stock list
        if (lowStock && lowStock.length) {
          const lowBlock = document.createElement('div'); lowBlock.style.marginTop = '12px';
          lowBlock.innerHTML = `<div style="font-weight:800">Low stock</div>`;
          const ul = document.createElement('ul'); ul.style.marginTop = '6px';
          lowStock.forEach(p=> {
            const li = document.createElement('li'); li.textContent = `${p.name} — ${n(p.qty)} left`;
            ul.appendChild(li);
          });
          lowBlock.appendChild(ul);
          wrap.appendChild(lowBlock);
        } else {
          const note = document.createElement('div'); note.className = 'small'; note.style.marginTop = '12px'; note.textContent = 'No low-stock items.';
          wrap.appendChild(note);
        }
        aiContent.appendChild(wrap);
        // reveal card
        aiCard.style.display = 'block';
        toggleInsightsBtn && toggleInsightsBtn.setAttribute('aria-pressed','true');
      }

    } catch (e) {
      errlog('generateInsights failed', e);
      toast('Failed to generate insights', 'error');
    }
  }

  // Hooks for the existing buttons:
  if (toggleInsightsBtn) toggleInsightsBtn.addEventListener('click', function () {
    try {
      if (!aiCard) return;
      const visible = aiCard.style.display !== 'none' && aiCard.style.display !== '';
      if (visible) { aiCard.style.display = 'none'; toggleInsightsBtn.setAttribute('aria-pressed','false'); }
      else { generateInsights(); aiCard.style.display = 'block'; toggleInsightsBtn.setAttribute('aria-pressed','true'); }
    } catch (e) { errlog(e); }
  });
  if (refreshInsightsBtn) refreshInsightsBtn.addEventListener('click', generateInsights);
  // You had a "Generate Insight" button in inventoryPanel (id="insightBtn")
  const insightBtn = $('insightBtn');
  if (insightBtn) insightBtn.addEventListener('click', function () { generateInsights(); setActiveView('home'); if (aiCard) aiCard.style.display = 'block'; });

  /* ---------- UI init after data load ---------- */
  function initAppUI() {
    try {
      renderChips(); renderProducts(); renderInventory(); renderDashboard(); renderCustomList(); renderNotes();
      setActiveView('home');
      showLoading(false);
      // hide modal elements by default
      if ($('modalBackdrop')) $('modalBackdrop').style.display = 'none';
      if (barcodeScannerModal) barcodeScannerModal.style.display = 'none';
      // Make sure bottom nav does not hide important report area (CSS also helps)
      if (reportBreakdown) reportBreakdown.style.paddingBottom = '120px';
    } catch (e) { errlog('initAppUI failed', e); }
  }

  /* ---------- small initial UI actions ---------- */
  document.addEventListener('DOMContentLoaded', function () {
    hideAllAuthForms();
    showLoginForm();
    if ($('modalBackdrop')) $('modalBackdrop').style.display = 'none';
    if (barcodeScannerModal) barcodeScannerModal.style.display = 'none';
    renderChips();
  });

  // Expose a small debug API
  window.__QS_APP = {
    auth, db, saveState, loadUserData, getState: () => state, startScanner, stopScanner, generateInsights
  };

  // catch unhandled rejections
  window.addEventListener('unhandledrejection', function (ev) { console.error('Unhandled rejection:', ev.reason); toast('An unexpected error occurred. See console.', 'error'); });

  log('app.js loaded');
})();