// ============================================================
// Service Worker — Alarma Casa PWA
// Permite instalación en iPhone y funcionamiento offline
// ============================================================

const CACHE_NAME = 'alarma-casa-v1';

// Archivos a cachear para funcionamiento offline
const CACHE_FILES = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './mqtt-service.js',
    './manifest.json'
];

// Instalación: cachear archivos esenciales
self.addEventListener('install', (event) => {
    console.log('[SW] Instalando...');
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[SW] Cacheando archivos');
            return cache.addAll(CACHE_FILES);
        })
    );
    self.skipWaiting();
});

// Activación: limpiar cachés viejos
self.addEventListener('activate', (event) => {
    console.log('[SW] Activado');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter(name => name !== CACHE_NAME)
                    .map(name => caches.delete(name))
            );
        })
    );
    self.clients.claim();
});

// Fetch: servir desde caché, luego red
self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then((cached) => {
            return cached || fetch(event.request).catch(() => {
                // Si falla la red y no hay caché, mostrar página offline
                if (event.request.destination === 'document') {
                    return caches.match('./index.html');
                }
            });
        })
    );
});

// Push Notifications (cuando lleguen desde servidor)
self.addEventListener('push', (event) => {
    const data = event.data ? event.data.json() : {};
    const title = data.title || '⚠️ ALARMA ACTIVADA';
    const options = {
        body: data.body || 'Se detectó movimiento en tu hogar',
        icon: './icon-192.png',
        badge: './icon-192.png',
        vibrate: [300, 100, 300, 100, 300],
        tag: 'alarma',
        requireInteraction: true,
        data: { url: './' }
    };

    event.waitUntil(
        self.registration.showNotification(title, options)
    );
});

// Click en notificación: abrir la app
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        clients.openWindow(event.notification.data.url || './')
    );
});
