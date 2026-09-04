// ============================================================
// app.js — Lógica principal de Alarma Casa PWA
// ============================================================

// ---- Estado global de la app ----
const AppState = {
    alarmState:    'ARMADA',   // 'ARMADA' | 'DESARMADA' | 'ALERTA'
    mqttConnected: false,
    camaraIP:      '',
    history:       [],
    settings:      {}
};

// ---- Referencias al DOM ----
const UI = {
    // Status
    statusRing:     document.getElementById('status-ring'),
    statusIcon:     document.getElementById('status-icon'),
    statusLabel:    document.getElementById('status-label'),
    statusSublabel: document.getElementById('status-sublabel'),
    // Button
    mainBtn:        document.getElementById('main-btn'),
    btnIcon:        document.getElementById('btn-icon'),
    btnText:        document.getElementById('btn-text'),
    // Header
    connDot:        document.getElementById('connection-dot'),
    connText:       document.getElementById('connection-text'),
    // Info cards
    mqttStatus:     document.getElementById('mqtt-status'),
    camStatus:      document.getElementById('cam-status'),
    lastEvent:      document.getElementById('last-event'),
    zonesActive:    document.getElementById('zones-active'),
    // Camera
    cameraStream:   document.getElementById('camera-stream'),
    streamOverlay:  document.getElementById('stream-overlay'),
    // History
    eventList:      document.getElementById('event-list'),
    // Settings
    mqttHost:       document.getElementById('mqtt-host'),
    mqttPort:       document.getElementById('mqtt-port'),
    mqttUser:       document.getElementById('mqtt-user'),
    mqttPass:       document.getElementById('mqtt-pass'),
    camIP:          document.getElementById('cam-ip'),
    notifBtn:       document.getElementById('notif-btn'),
    // Modal
    modalOverlay:   document.getElementById('modal-overlay'),
    modalIcon:      document.getElementById('modal-icon'),
    modalTitle:     document.getElementById('modal-title'),
    modalBody:      document.getElementById('modal-body'),
    modalConfirmBtn:document.getElementById('modal-confirm-btn'),
    // Toast
    toastContainer: document.getElementById('toast-container')
};

// ============================================================
// INICIALIZACIÓN
// ============================================================
function init() {
    loadSettings();
    loadHistory();
    renderHistory();
    setupMQTT();
    registerServiceWorker();
    checkNotificationPermission();

    // Si ya hay IP de cámara guardada, mostrarla
    if (AppState.settings.camIP) {
        setCameraIP(AppState.settings.camIP);
    }
}

// ============================================================
// SERVICE WORKER
// ============================================================
function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js')
            .then(() => console.log('[SW] Registrado'))
            .catch(err => console.error('[SW] Error:', err));
    }
}

// ============================================================
// CONFIGURACIÓN MQTT
// ============================================================
function setupMQTT() {
    // Callbacks del servicio MQTT
    MQTTService.on('onConnect', () => {
        AppState.mqttConnected = true;
        UI.connDot.className  = 'connection-dot online';
        UI.connText.textContent = 'En línea';
        UI.mqttStatus.textContent = 'Conectado ✓';
        showToast('✅ MQTT conectado', 'success');
    });

    MQTTService.on('onDisconnect', () => {
        AppState.mqttConnected = false;
        UI.connDot.className  = 'connection-dot offline';
        UI.connText.textContent = 'Sin conexión';
        UI.mqttStatus.textContent = 'Offline';
    });

    MQTTService.on('onEstado', (estado) => {
        setAlarmState(estado);
    });

    MQTTService.on('onEvento', (evento) => {
        if (evento === 'DISPARO') {
            handleAlarmTrigger();
        }
    });

    MQTTService.on('onCamaraIP', (ip) => {
        setCameraIP(ip);
        // Guardar IP recibida
        AppState.settings.camIP = ip;
        saveSettings();
    });

    MQTTService.on('onError', (err) => {
        showToast('❌ Error MQTT: ' + err.message, 'danger');
    });

    // Conectar si hay configuración guardada
    const s = AppState.settings;
    if (s.mqttHost && s.mqttUser && s.mqttPass) {
        MQTTService.connect({
            host: s.mqttHost,
            port: s.mqttPort || 8884,
            user: s.mqttUser,
            pass: s.mqttPass
        });
    }
}

function reconnectMQTT() {
    const s = AppState.settings;
    if (!s.mqttHost || !s.mqttUser || !s.mqttPass) {
        showToast('⚠️ Configurá el broker MQTT primero', 'danger');
        switchTab('settings');
        return;
    }
    MQTTService.disconnect();
    setTimeout(() => {
        MQTTService.connect({
            host: s.mqttHost,
            port: s.mqttPort || 8884,
            user: s.mqttUser,
            pass: s.mqttPass
        });
    }, 500);
    showToast('🔄 Reconectando...', 'info');
}

// ============================================================
// ESTADO DE LA ALARMA
// ============================================================
function setAlarmState(estado) {
    AppState.alarmState = estado;
    const isArmed = (estado === 'ARMADA');
    const isAlert = (estado === 'ALERTA');

    // Status ring
    UI.statusRing.className = 'status-ring ' +
        (isAlert ? 'alert' : isArmed ? 'armed' : 'disarmed');

    // Icono
    UI.statusIcon.textContent = isAlert ? '🚨' : isArmed ? '🔒' : '🔓';

    // Label
    UI.statusLabel.className = 'status-label ' +
        (isAlert ? 'alert' : isArmed ? 'armed' : 'disarmed');
    UI.statusLabel.textContent = isAlert ? 'ALERTA' : estado;

    // Sub-label
    UI.statusSublabel.textContent =
        isAlert ? '¡Sensor disparado!' :
        isArmed ? 'Sistema activo' : 'Sistema desactivado';

    // Botón principal
    if (isArmed || isAlert) {
        UI.mainBtn.className = 'control-btn';
        UI.btnIcon.textContent = '🔓';
        UI.btnText.textContent = 'Desarmar';
    } else {
        UI.mainBtn.className = 'control-btn to-arm';
        UI.btnIcon.textContent = '🔒';
        UI.btnText.textContent = 'Armar';
    }
}

// ============================================================
// TOGGLE ALARMA (con confirmación)
// ============================================================
function toggleAlarm() {
    if (!AppState.mqttConnected) {
        showToast('❌ Sin conexión MQTT', 'danger');
        return;
    }

    const isArmed = (AppState.alarmState !== 'DESARMADA');

    if (isArmed) {
        // Confirmar que quiere desarmar
        showModal({
            icon:    '🔓',
            title:   '¿Desarmar alarma?',
            body:    'Vas a desactivar el sistema de seguridad de tu hogar.',
            btnText: 'Sí, desarmar',
            btnClass: '',
            onConfirm: () => {
                MQTTService.desarmar();
                addEvent('🔓', 'Alarma desarmada', 'success');
                showToast('🔓 Alarma desarmada', 'success');
            }
        });
    } else {
        // Confirmar que quiere armar
        showModal({
            icon:    '🔒',
            title:   '¿Armar alarma?',
            body:    'El sistema de seguridad se activará en tu hogar.',
            btnText: 'Sí, armar',
            btnClass: 'arm',
            onConfirm: () => {
                MQTTService.armar();
                addEvent('🔒', 'Alarma armada', 'info');
                showToast('🔒 Alarma armada', 'info');
            }
        });
    }
}

// ============================================================
// ALARMA DISPARADA
// ============================================================
function handleAlarmTrigger() {
    setAlarmState('ALERTA');
    addEvent('🚨', '¡ALARMA DISPARADA! — Sensor activado', 'danger');

    // Toast
    showToast('🚨 ALARMA ACTIVADA', 'danger');

    // Notificación del sistema (si está permitida)
    sendBrowserNotification(
        '⚠️ ALARMA ACTIVADA',
        'Se detectó actividad en tu hogar. Revisá la cámara.'
    );

    // Actualizar info card
    const now = new Date();
    UI.lastEvent.textContent = formatTime(now);
}

// ============================================================
// CÁMARA ESP32-CAM
// ============================================================
function setCameraIP(ip) {
    AppState.camaraIP = ip;
    UI.camStatus.textContent = ip ? ip : '--';

    if (ip) {
        const streamURL = `http://${ip}/stream`;
        UI.cameraStream.src = streamURL;
        UI.streamOverlay.classList.add('hidden');
    }
}

function handleStreamError() {
    UI.streamOverlay.classList.remove('hidden');
    UI.camStatus.textContent = 'Sin señal';
}

function toggleFlash(on) {
    if (!AppState.camaraIP) {
        showToast('⚠️ Sin IP de cámara configurada', 'danger');
        return;
    }
    const url = `http://${AppState.camaraIP}/flash/${on ? 'on' : 'off'}`;
    fetch(url).catch(() => {
        showToast('❌ No se pudo contactar la cámara', 'danger');
    });
}

function capturePhoto() {
    if (!AppState.camaraIP) {
        showToast('⚠️ Sin IP de cámara configurada', 'danger');
        return;
    }
    window.open(`http://${AppState.camaraIP}/capture`, '_blank');
}

// ============================================================
// HISTORIAL DE EVENTOS
// ============================================================
function addEvent(emoji, title, type = 'info') {
    const evento = {
        emoji,
        title,
        type,
        time: new Date().toISOString()
    };

    AppState.history.unshift(evento); // Agregar al principio
    if (AppState.history.length > 50) AppState.history.pop(); // Máximo 50

    saveHistory();
    renderHistory();

    // Actualizar "último evento" en el dashboard
    UI.lastEvent.textContent = formatTime(new Date(evento.time));
}

function renderHistory() {
    const list = UI.eventList;
    list.innerHTML = '';

    if (AppState.history.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📋</div>
                <div class="empty-text">Sin eventos registrados</div>
            </div>`;
        return;
    }

    AppState.history.forEach(ev => {
        const el = document.createElement('div');
        el.className = `event-item ${ev.type}`;
        el.innerHTML = `
            <div class="event-emoji">${ev.emoji}</div>
            <div class="event-body">
                <div class="event-title">${ev.title}</div>
                <div class="event-time">${formatDateTime(new Date(ev.time))}</div>
            </div>`;
        list.appendChild(el);
    });
}

function clearHistory() {
    AppState.history = [];
    saveHistory();
    renderHistory();
    showToast('🗑️ Historial limpiado', 'info');
}

// ============================================================
// CONFIGURACIÓN
// ============================================================
function loadSettings() {
    try {
        const raw = localStorage.getItem('alarma-settings');
        AppState.settings = raw ? JSON.parse(raw) : {};
    } catch { AppState.settings = {}; }

    const s = AppState.settings;
    UI.mqttHost.value = s.mqttHost || '';
    UI.mqttPort.value = s.mqttPort || '8884';
    UI.mqttUser.value = s.mqttUser || '';
    UI.mqttPass.value = s.mqttPass || '';
    UI.camIP.value    = s.camIP    || '';
}

function saveSettings() {
    AppState.settings = {
        mqttHost: UI.mqttHost.value.trim(),
        mqttPort: parseInt(UI.mqttPort.value) || 8884,
        mqttUser: UI.mqttUser.value.trim(),
        mqttPass: UI.mqttPass.value,
        camIP:    UI.camIP.value.trim()
    };
    localStorage.setItem('alarma-settings', JSON.stringify(AppState.settings));

    // Actualizar IP de cámara si cambió
    if (AppState.settings.camIP) {
        setCameraIP(AppState.settings.camIP);
    }

    showToast('💾 Ajustes guardados', 'success');
}

function loadHistory() {
    try {
        const raw = localStorage.getItem('alarma-history');
        AppState.history = raw ? JSON.parse(raw) : [];
    } catch { AppState.history = []; }
}

function saveHistory() {
    localStorage.setItem('alarma-history', JSON.stringify(AppState.history));
}

// ============================================================
// NOTIFICACIONES DEL NAVEGADOR
// ============================================================
function checkNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'granted') {
        UI.notifBtn.textContent = '✅ Notificaciones activas';
        UI.notifBtn.classList.add('granted');
    }
}

function requestNotifications() {
    if (!('Notification' in window)) {
        showToast('❌ Notificaciones no soportadas', 'danger');
        return;
    }

    Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
            UI.notifBtn.textContent = '✅ Notificaciones activas';
            UI.notifBtn.classList.add('granted');
            showToast('🔔 Notificaciones activadas', 'success');
            // Enviar notificación de prueba
            new Notification('Alarma Casa', {
                body: '¡Notificaciones configuradas correctamente!',
                icon: './icon-192.png'
            });
        } else {
            showToast('⚠️ Permiso de notificación denegado', 'danger');
        }
    });
}

function sendBrowserNotification(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, {
            body: body,
            icon: './icon-192.png',
            vibrate: [300, 100, 300]
        });
    }
}

// ============================================================
// NAVEGACIÓN POR TABS
// ============================================================
function switchTab(tab) {
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

    document.getElementById(`tab-${tab}`).classList.add('active');
    document.getElementById(`nav-${tab}`).classList.add('active');
}

// ============================================================
// MODAL DE CONFIRMACIÓN
// ============================================================
let modalCallback = null;

function showModal({ icon, title, body, btnText, btnClass, onConfirm }) {
    UI.modalIcon.textContent   = icon;
    UI.modalTitle.textContent  = title;
    UI.modalBody.textContent   = body;
    UI.modalConfirmBtn.textContent  = btnText;
    UI.modalConfirmBtn.className    = `modal-confirm ${btnClass}`;
    UI.modalOverlay.classList.add('visible');
    modalCallback = onConfirm;
}

function closeModal() {
    UI.modalOverlay.classList.remove('visible');
    modalCallback = null;
}

document.getElementById('modal-confirm-btn').addEventListener('click', () => {
    if (modalCallback) modalCallback();
    closeModal();
});

document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === UI.modalOverlay) closeModal();
});

// ============================================================
// TOAST NOTIFICATIONS
// ============================================================
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    UI.toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 3100);
}

// ============================================================
// UTILIDADES DE FORMATO DE FECHA
// ============================================================
function formatTime(date) {
    return date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(date) {
    return date.toLocaleDateString('es-AR', {
        day: '2-digit', month: '2-digit',
        hour: '2-digit', minute: '2-digit'
    });
}

// ============================================================
// ARRANCAR LA APP
// ============================================================
document.addEventListener('DOMContentLoaded', init);
