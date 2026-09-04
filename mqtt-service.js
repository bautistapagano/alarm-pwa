// ============================================================
// mqtt-service.js — Conexión MQTT para Alarma Casa PWA
// Se conecta a HiveMQ Cloud vía WebSocket Seguro (WSS)
// ============================================================

const MQTTService = (() => {

    let client = null;
    let config = {};
    let reconnectTimer = null;
    let reconnectDelay = 2000;
    const MAX_RECONNECT_DELAY = 30000;

    // Callbacks que se pueden asignar desde app.js
    const callbacks = {
        onConnect:    () => {},
        onDisconnect: () => {},
        onEstado:     (estado) => {},   // "ARMADA" o "DESARMADA"
        onEvento:     (evento) => {},   // "DISPARO"
        onCamaraIP:   (ip) => {},
        onError:      (err) => {}
    };

    // Topics MQTT del sistema
    const TOPICS = {
        ESTADO:    'alarma/estado',
        COMANDO:   'alarma/comando',
        EVENTO:    'alarma/evento',
        CAMARA_IP: 'alarma/camara/ip'
    };

    // ---- Conectar al broker ----
    function connect(cfg) {
        config = cfg;

        if (client && client.connected) {
            client.end(true);
        }

        const url = `wss://${config.host}:${config.port}/mqtt`;
        const clientId = 'alarma-app-' + Math.random().toString(16).substr(2, 8);

        console.log(`[MQTT] Conectando a ${url}`);

        client = mqtt.connect(url, {
            clientId:  clientId,
            username:  config.user,
            password:  config.pass,
            clean:     true,
            reconnect: false,   // Manejamos reconexión manualmente
            connectTimeout: 10000,
            keepalive: 30
        });

        // ---- Eventos del cliente MQTT ----

        client.on('connect', () => {
            console.log('[MQTT] Conectado!');
            reconnectDelay = 2000; // Resetear backoff

            // Suscribirse a todos los topics
            client.subscribe([
                TOPICS.ESTADO,
                TOPICS.EVENTO,
                TOPICS.CAMARA_IP
            ], { qos: 1 }, (err) => {
                if (err) {
                    console.error('[MQTT] Error al suscribirse:', err);
                }
            });

            callbacks.onConnect();
        });

        client.on('message', (topic, payload) => {
            const msg = payload.toString().trim();
            console.log(`[MQTT] Mensaje en "${topic}": ${msg}`);

            switch (topic) {
                case TOPICS.ESTADO:
                    callbacks.onEstado(msg);
                    break;
                case TOPICS.EVENTO:
                    callbacks.onEvento(msg);
                    break;
                case TOPICS.CAMARA_IP:
                    callbacks.onCamaraIP(msg);
                    break;
            }
        });

        client.on('close', () => {
            console.log('[MQTT] Conexión cerrada');
            callbacks.onDisconnect();
            scheduleReconnect();
        });

        client.on('error', (err) => {
            console.error('[MQTT] Error:', err.message);
            callbacks.onError(err);
        });

        client.on('offline', () => {
            console.log('[MQTT] Offline');
            callbacks.onDisconnect();
        });
    }

    // ---- Reconexión automática con backoff exponencial ----
    function scheduleReconnect() {
        if (!config.host) return; // No reconectar si no hay config

        clearTimeout(reconnectTimer);
        console.log(`[MQTT] Reconectando en ${reconnectDelay/1000}s...`);

        reconnectTimer = setTimeout(() => {
            connect(config);
        }, reconnectDelay);

        // Backoff exponencial (2s → 4s → 8s → ... → 30s máximo)
        reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
    }

    // ---- Publicar comando de alarma ----
    function publicarComando(comando) {
        if (!client || !client.connected) {
            console.warn('[MQTT] No conectado, no se puede publicar');
            return false;
        }

        client.publish(TOPICS.COMANDO, comando, { qos: 1, retain: false }, (err) => {
            if (err) {
                console.error('[MQTT] Error publicando:', err);
            } else {
                console.log(`[MQTT] Publicado en ${TOPICS.COMANDO}: ${comando}`);
            }
        });

        return true;
    }

    // ---- Armar la alarma ----
    function armar() {
        return publicarComando('ARM');
    }

    // ---- Desarmar la alarma ----
    function desarmar() {
        return publicarComando('DISARM');
    }

    // ---- Verificar si está conectado ----
    function isConnected() {
        return client && client.connected;
    }

    // ---- Desconectar manualmente ----
    function disconnect() {
        clearTimeout(reconnectTimer);
        config = {}; // Evitar reconexión automática
        if (client) {
            client.end(true);
            client = null;
        }
    }

    // ---- API pública ----
    return {
        connect,
        disconnect,
        armar,
        desarmar,
        isConnected,
        on: (event, fn) => { callbacks[event] = fn; }
    };

})();
