// Service Worker for SGE PWA
// Using Workbox patterns for offline support

const CACHE_NAME = 'sge-v1';
const STATIC_ASSETS = [
  '/',
  '/login',
  '/manifest.json',
  '/favicon.svg',
];

// Install - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate - clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Fetch - network first for API, cache first for static
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API requests - network first with offline fallback
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Static assets - cache first
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      });
    })
  );
});

// Background Sync for offline operations
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-grades') {
    event.waitUntil(syncGrades());
  } else if (event.tag === 'sync-attendance') {
    event.waitUntil(syncAttendance());
  } else if (event.tag === 'sync-payments') {
    event.waitUntil(syncPayments());
  }
});

async function syncGrades() {
  // Implementation will sync offline grades to server
  console.log('Syncing grades...');
}

async function syncAttendance() {
  // Implementation will sync offline attendance to server
  console.log('Syncing attendance...');
}

async function syncPayments() {
  // Implementation will sync offline payments to server
  console.log('Syncing payments...');
}

// Push notifications
self.addEventListener('push', (event) => {
  if (!event.data) return;

  const data = event.data.json();
  const options = {
    body: data.notification?.body || 'Nueva notificación',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/badge-72x72.png',
    vibrate: [200, 100, 200],
    data: data.notification?.data || {},
    actions: [
      { action: 'view', title: 'Ver' },
      { action: 'dismiss', title: 'Descartar' },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(data.notification?.title || 'SGE', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'view' && event.notification.data?.url) {
    event.waitUntil(
      clients.openWindow(event.notification.data.url)
    );
  }
});