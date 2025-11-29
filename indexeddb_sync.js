/* indexeddb_sync.js - Offline-first queueing and sync logic */

(function () {
  'use strict';

  const DB_NAME = 'quickshop_db';
  const DB_VERSION = 1;
  const STORE_NAME = 'pending_sync';
  let dbPromise = null;

  function getDb() {
    if (dbPromise) return dbPromise;
    
    dbPromise = new Promise((resolve, reject) => {
      // Check if IndexedDB is supported
      if (!('indexedDB' in window)) {
        console.error('IndexedDB not supported');
        return reject('IndexedDB not supported');
      }
      
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      
      request.onerror = (event) => {
        console.error('IndexedDB error:', event.target.error);
        reject('IndexedDB error: ' + event.target.error);
      };

      request.onsuccess = (event) => {
        resolve(event.target.result);
      };

      request.onupgradeneeded = (event) => {
        console.log('IndexedDB upgrade needed...');
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          // 'id' is the auto-incrementing primary key
          db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        }
      };
    });
    return dbPromise;
  }
  
  function waitForFirebaseReady(timeoutMs = 3000) {
    return new Promise((resolve) => {
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

  const qsdb = {
    addPendingChange: async (action) => {
      const db = await getDb();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.add(action);

        request.onsuccess = () => resolve(request.result);
        request.onerror = (event) => {
          console.error('Failed to add pending change:', event.target.error);
          reject(event.target.error);
        };
      });
    },

    getAllPending: async () => {
      const db = await getDb();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result);
        request.onerror = (event) => {
          console.error('Failed to get all pending changes:', event.target.error);
          reject(event.target.error);
        };
      });
    },

    clearPending: async (id) => {
      const db = await getDb();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(id);

        request.onsuccess = () => resolve();
        request.onerror = (event) => {
          console.error('Failed to clear pending change:', event.target.error);
          reject(event.target.error);
        };
      });
    }
  };

  window.qsdb = qsdb;

  // Firestore sync: attempt to push pending items
  async function syncPendingToFirestore() {
    try {
      if (!navigator.onLine) {
        console.log('Offline, skipping sync.');
        return;
      }
      
      const pending = await window.qsdb.getAllPending();
      if (!pending || pending.length === 0) {
        console.log('No pending items to sync.');
        return;
      }
      
      console.log(`Syncing ${pending.length} pending item(s)...`);

      const fb = await waitForFirebaseReady();
      
      if (!fb || !fb.db || !fb.auth) {
        console.warn('Firebase not ready for sync.');
        return;
      }

      const user = fb.auth.currentUser;
      if (!user || !user.uid) {
        console.warn('No user, skipping sync.');
        return;
      }

      const db = fb.db;
      const userRef = db.collection('users').doc(user.uid);
      const { FieldValue } = window.firebase.firestore;

      for (const act of pending) {
        try {
          const isAtomic = ['addSale', 'removeSale', 'addProduct', 'removeProduct'].includes(act.type);

          if (isAtomic) {
            let updateData = {};
            switch (act.type) {
              case 'addSale': updateData = { sales: FieldValue.arrayUnion(act.item) }; break;
              case 'removeSale': updateData = { sales: FieldValue.arrayRemove(act.item) }; break;
              case 'addProduct': updateData = { products: FieldValue.arrayUnion(act.item) }; break;
              case 'removeProduct': updateData = { products: FieldValue.arrayRemove(act.item) }; break;
            }
            await userRef.update(updateData);
          } else {
            await db.runTransaction(async (transaction) => {
              const userDoc = await transaction.get(userRef);
              if (!userDoc.exists) throw new Error("User document not found");
              
              const data = userDoc.data() || {};

              switch (act.type) {
                case 'updateProduct': {
                  const products = data.products || [];
                  const newProducts = products.filter(p => p.id !== act.item.id);
                  newProducts.push(act.item);
                  transaction.update(userRef, { products: newProducts });
                  break;
                }
                case 'addStock': {
                  const { productId, qty } = act.item;
                  const currentProducts = data.products || [];
                  const updatedProducts = currentProducts.map(p => {
                    if (p.id === productId) {
                      const newQty = (Number(p.qty) || 0) + (Number(qty) || 0);
                      return { ...p, qty: newQty };
                    }
                    return p;
                  });
                  transaction.update(userRef, { products: updatedProducts });
                  break;
                }
                default:
                  console.warn('Unknown sync action type:', act.type);
              }
            }); 
          } 

          await window.qsdb.clearPending(act.id);
          console.log(`Synced item ${act.id}`);

        } catch (e) {
          console.error(`Failed to sync item ${act.id}. Will retry.`, e);
        }
      }
      
      console.log('Sync complete.');
      document.dispatchEvent(new Event('qs:data:synced'));

    } catch (e) {
      console.warn('syncPendingToFirestore failed', e);
    }
  }
  
  window.qsdb.syncPendingToFirestore = syncPendingToFirestore;

  window.addEventListener('online', () => {
    console.log('Online, attempting sync...');
    syncPendingToFirestore(); 
  });

  document.addEventListener('qs:user:auth', () => {
    syncPendingToFirestore();
  });

  window.addEventListener('load', () => {
    setTimeout(syncPendingToFirestore, 3000); 
  });

})();
