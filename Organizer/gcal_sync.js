// gcal_sync.js - Integración de Google Calendar

const gcalState = {
    connected: false,
    syncing: false,
    calendars: [],
    destinationCalendarId: 'primary',
    events: []
};

let cachedAccessToken = null;

// Inicializar estado de Google Calendar
async function initGCalendarSync() {
    if (typeof chrome === 'undefined' || !chrome.storage) return;

    chrome.storage.local.get(['gcal_connected', 'gcal_selected_calendars', 'gcal_destination_calendar', 'google_refresh_token'], (result) => {
        // En la extensión hace falta la cuenta conectada con el cliente nuevo.
        if (result.gcal_connected && (window.desktop || result.google_refresh_token)) {
            gcalState.connected = true;
        }
        if (result.gcal_selected_calendars) {
            gcalState.calendars = result.gcal_selected_calendars;
        }
        if (result.gcal_destination_calendar) {
            gcalState.destinationCalendarId = result.gcal_destination_calendar;
        }
        
        updateGCalUI();

        if (gcalState.connected) {
            fetchGCalendars(true); // Cargar calendarios silenciosamente
        }
    });
}

// Conectar con Google Calendar
async function signInGCalendar() {
    gcalState.syncing = true;
    updateGCalUI();

    let token = null;
    if (window.desktop && typeof window.desktop.signInGoogle === 'function') {
        const res = await window.desktop.signInGoogle();
        if (res && res.token) {
            token = res.token;
        } else {
            const err = res && res.error ? res.error : 'No se pudo conectar con Google Calendar';
            window.showToast(err, 'info');
            gcalState.syncing = false;
            gcalState.connected = false;
            updateGCalUI();
            return;
        }
    } else if (typeof chrome !== 'undefined' && chrome.tabs) {
        try {
            token = await googleSignInExtension();
        } catch (err) {
            window.showToast(`No se pudo conectar con Google: ${err.message}`, 'error');
        }
    }

    gcalState.syncing = false;
    if (token) {
        cachedAccessToken = token;
        gcalState.connected = true;
        chrome.storage.local.set({ gcal_connected: true, gdrive_token: token }, () => {
            window.showToast('Conectado a Google Calendar exitosamente', 'success');
            updateGCalUI();
            fetchGCalendars();
        });
    } else {
        gcalState.connected = false;
        updateGCalUI();
    }
}

// Desconectar Google Calendar
async function signOutGCalendar() {
    gcalState.connected = false;
    gcalState.calendars = [];
    gcalState.events = [];
    window.gcalEvents = [];
    cachedAccessToken = null;

    if (window.desktop && typeof window.desktop.signOutGoogle === 'function') {
        await window.desktop.signOutGoogle();
    } else if (typeof chrome !== 'undefined' && chrome.tabs) {
        await signOutExtensionGoogle();
    }
    
    chrome.storage.local.remove(['gcal_connected', 'gcal_selected_calendars', 'gcal_destination_calendar'], () => {
        window.showToast('Desconectado de Google Calendar.', 'success');
        updateGCalUI();
        if (window.renderCalendar) {
            window.renderCalendar();
        }
    });
}

// Obtener lista de calendarios
async function fetchGCalendars(silent = false) {
    if (!gcalState.connected) return;

    gcalState.syncing = true;
    updateGCalUI();

    try {
        const response = await fetchWithAuth('https://www.googleapis.com/calendar/v3/users/me/calendarList');
        
        if (!response.ok) {
            throw new Error(`Error API: ${response.status}`);
        }

        const data = await response.json();
        
        // Mapear y preservar el estado 'selected' anterior
        const prevSelected = gcalState.calendars.filter(c => c.selected).map(c => c.id);
        
        gcalState.calendars = (data.items || []).map(item => ({
            id: item.id,
            summary: item.summary || 'Calendario sin título',
            selected: prevSelected.includes(item.id) || (prevSelected.length === 0 && !!item.primary),
            isPrimary: !!item.primary
        }));

        // Si no hay calendario de destino guardado, usar el principal
        if (!gcalState.destinationCalendarId) {
            const primary = gcalState.calendars.find(c => c.isPrimary);
            gcalState.destinationCalendarId = primary ? primary.id : 'primary';
        }

        chrome.storage.local.set({
            gcal_selected_calendars: gcalState.calendars,
            gcal_destination_calendar: gcalState.destinationCalendarId
        });

        if (!silent) window.showToast('Calendarios cargados', 'success');
        
        // Cargar eventos tras obtener los calendarios
        fetchGCalEvents();

    } catch (err) {
        console.error('Error al obtener calendarios:', err);
        if (!silent) window.showToast(`Error al cargar calendarios: ${err.message}`, 'error');
    } finally {
        gcalState.syncing = false;
        updateGCalUI();
    }
}

// Obtener eventos para los calendarios seleccionados
async function fetchGCalEvents() {
    if (!gcalState.connected) return;

    const selectedCalendars = gcalState.calendars.filter(c => c.selected);
    if (selectedCalendars.length === 0) {
        gcalState.events = [];
        window.gcalEvents = [];
        if (window.renderCalendar) window.renderCalendar();
        return;
    }

    try {
        // Rango de tiempo amplio (mes actual y adyacentes)
        const now = new Date();
        const timeMin = new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString();
        const timeMax = new Date(now.getFullYear(), now.getMonth() + 3, 0).toISOString();

        let allEvents = [];

        for (const cal of selectedCalendars) {
            try {
                const response = await fetchWithAuth(
                    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&maxResults=250`
                );
                
                if (response.ok) {
                    const data = await response.json();
                    const events = (data.items || []).map(ev => ({
                        id: ev.id,
                        summary: ev.summary || 'Evento sin título',
                        description: ev.description || '',
                        location: ev.location || '',
                        start: ev.start,
                        end: ev.end,
                        calendarName: cal.summary,
                        htmlLink: ev.htmlLink
                    }));
                    allEvents = allEvents.concat(events);
                }
            } catch (e) {
                console.error(`Error al cargar eventos de ${cal.summary}:`, e);
            }
        }

        gcalState.events = allEvents;
        window.gcalEvents = allEvents;

        if (window.renderCalendar) {
            window.renderCalendar();
        }
    } catch (err) {
        console.error('Error al obtener eventos de Google Calendar:', err);
    }
}

// Publicar una tarea específica en Google Calendar
async function publishReminderToGCal(reminder) {
    if (!gcalState.connected) {
        window.showToast('Conecta Google Calendar primero.', 'info');
        return;
    }

    try {
        const dateStr = reminder.dueDate || new Date().toISOString().split('T')[0];
        
        // Calcular el día siguiente para eventos de todo el día
        const parts = dateStr.split('-');
        const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
        dateObj.setDate(dateObj.getDate() + 1);
        const y = dateObj.getFullYear();
        const m = String(dateObj.getMonth() + 1).padStart(2, '0');
        const d = String(dateObj.getDate()).padStart(2, '0');
        const nextDayStr = `${y}-${m}-${d}`;

        const event = {
            summary: reminder.text,
            description: reminder.notes || 'Publicado desde Mk Organizer',
            start: { date: dateStr },
            end: { date: nextDayStr }
        };

        const response = await fetchWithAuth(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(gcalState.destinationCalendarId)}/events`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(event)
            }
        );

        if (!response.ok) {
            throw new Error(`Error HTTP: ${response.status}`);
        }

        window.showToast(`Tarea "${reminder.text}" publicada en Google Calendar`, 'success');
        fetchGCalEvents(); // Recargar eventos
    } catch (err) {
        console.error('Error al publicar evento:', err);
        window.showToast(`Error al publicar tarea: ${err.message}`, 'error');
    }
}

// Publicar todas las tareas en Google Calendar
async function publishAllRemindersToGCal(remindersList) {
    if (!gcalState.connected) {
        window.showToast('Conecta Google Calendar primero.', 'info');
        return;
    }

    if (!remindersList || remindersList.length === 0) {
        window.showToast('No hay tareas para publicar.', 'info');
        return;
    }

    gcalState.syncing = true;
    updateGCalUI();

    let successCount = 0;
    try {
        for (const reminder of remindersList) {
            try {
                const dateStr = reminder.dueDate || new Date().toISOString().split('T')[0];
                const parts = dateStr.split('-');
                const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
                dateObj.setDate(dateObj.getDate() + 1);
                const y = dateObj.getFullYear();
                const m = String(dateObj.getMonth() + 1).padStart(2, '0');
                const d = String(dateObj.getDate()).padStart(2, '0');
                const nextDayStr = `${y}-${m}-${d}`;

                const event = {
                    summary: reminder.text,
                    description: reminder.notes || 'Publicado desde Mk Organizer',
                    start: { date: dateStr },
                    end: { date: nextDayStr }
                };

                const response = await fetchWithAuth(
                    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(gcalState.destinationCalendarId)}/events`,
                    {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(event)
                    }
                );

                if (response.ok) {
                    successCount++;
                }
            } catch (e) {
                console.error(`Error al publicar tarea: ${reminder.text}:`, e);
            }
        }

        window.showToast(`Se publicaron ${successCount} tareas en Google Calendar`, 'success');
        fetchGCalEvents();
    } catch (err) {
        console.error('Error en publicación masiva:', err);
        window.showToast(`Error al publicar tareas: ${err.message}`, 'error');
    } finally {
        gcalState.syncing = false;
        updateGCalUI();
    }
}

// Obtener token de identidad de Chrome / Escritorio con promesa
// ── Cuenta de Google de la extensión ────────────────────────────────────────
// La extensión usa el mismo cliente OAuth de escritorio que Mk Organizer y
// Minichrome (proyecto 136352780967): ahí está activa la Drive API y, con el
// permiso drive.file, las tres apps ven el mismo mkorganizer_data.json. Su antiguo
// cliente (chrome.identity, proyecto 488512596557) no tenía la Drive API activa y
// usaba un archivo aparte. Flujo para apps instaladas: PKCE + redirección a
// 127.0.0.1, que la extensión captura en la pestaña con chrome.tabs.onUpdated.
// (Google no trata como secreto el client_secret de un cliente de escritorio.)
// Las credenciales viven en credentials.js (ignorado por git); ver credentials.example.js.
const EXT_GOOGLE_CLIENT_ID = (window.GOOGLE_CREDENTIALS || {}).clientId || '';
const EXT_GOOGLE_CLIENT_SECRET = (window.GOOGLE_CREDENTIALS || {}).clientSecret || '';
const EXT_GOOGLE_SCOPES = 'openid email https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/calendar';

function extStorageGet(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, (r) => resolve(r || {})));
}
function extStorageSet(items) {
    return new Promise((resolve) => chrome.storage.local.set(items, resolve));
}
function b64url(bytes) {
    let bin = '';
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function googleTokenRequest(params) {
    const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: EXT_GOOGLE_CLIENT_ID, client_secret: EXT_GOOGLE_CLIENT_SECRET, ...params })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const err = new Error(data.error_description || data.error || `Google respondió ${response.status}`);
        err.code = data.error;
        throw err;
    }
    return data;
}

async function saveExtensionTokens(tok) {
    const items = {
        gdrive_token: tok.access_token,
        gdrive_token_expiry: Date.now() + (Number(tok.expires_in) || 3600) * 1000 - 60000
    };
    if (tok.refresh_token) items.google_refresh_token = tok.refresh_token;
    await extStorageSet(items);
    cachedAccessToken = tok.access_token;
    if (window.syncState) window.syncState.accessToken = tok.access_token;
}

// Abre el inicio de sesión de Google en una pestaña y devuelve el token de acceso.
async function googleSignInExtension() {
    if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.tabs.create || !chrome.tabs.onUpdated) {
        throw new Error('El inicio de sesión de Google no está disponible aquí.');
    }
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
    const redirect = `http://127.0.0.1:${40000 + Math.floor(Math.random() * 20000)}/`;
    const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
        client_id: EXT_GOOGLE_CLIENT_ID, redirect_uri: redirect, response_type: 'code', scope: EXT_GOOGLE_SCOPES,
        code_challenge: challenge, code_challenge_method: 'S256', state, access_type: 'offline', prompt: 'consent'
    });
    const tab = await chrome.tabs.create({ url: authUrl });

    const code = await new Promise((resolve, reject) => {
        let done = false;
        const finish = (fn, value) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            chrome.tabs.onUpdated.removeListener(onUpdated);
            chrome.tabs.onRemoved.removeListener(onRemoved);
            fn(value);
        };
        const onUpdated = (tabId, info, t) => {
            const url = (info && info.url) || (t && t.url) || '';
            if (tabId !== tab.id || !url.startsWith(redirect)) return;
            chrome.tabs.remove(tabId, () => void chrome.runtime.lastError);
            const q = new URL(url).searchParams;
            if (q.get('error')) return finish(reject, new Error(q.get('error') === 'access_denied' ? 'Inicio de sesión cancelado.' : `Google: ${q.get('error')}`));
            if (q.get('state') !== state || !q.get('code')) return finish(reject, new Error('La respuesta de Google no corresponde a este inicio de sesión.'));
            finish(resolve, q.get('code'));
        };
        const onRemoved = (tabId) => {
            if (tabId === tab.id) finish(reject, new Error('Se cerró la pestaña de inicio de sesión.'));
        };
        const timer = setTimeout(() => finish(reject, new Error('Tiempo de espera agotado al conectar con Google.')), 5 * 60 * 1000);
        chrome.tabs.onUpdated.addListener(onUpdated);
        chrome.tabs.onRemoved.addListener(onRemoved);
    });

    const tok = await googleTokenRequest({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirect });
    if (!tok.refresh_token) throw new Error('Google no entregó un permiso permanente. Inténtalo de nuevo.');
    await saveExtensionTokens(tok);
    await extStorageSet({ gcal_connected: true });
    return tok.access_token;
}

async function signOutExtensionGoogle() {
    const { google_refresh_token: rt } = await extStorageGet(['google_refresh_token']);
    cachedAccessToken = null;
    await new Promise((resolve) => chrome.storage.local.remove(['google_refresh_token', 'gdrive_token', 'gdrive_token_expiry'], resolve));
    if (rt) fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(rt), { method: 'POST' }).catch(() => {});
}

// ── Token de Google (Calendar y Drive) ──────────────────────────────────────
// Los tokens de acceso duran ~1 h: se renuevan con el token de actualización
// (escritorio: lo hace el proceso principal). Ante un 401 se pide otro una vez.
async function getAuthTokenPromise(forceRefresh = false) {
    if (cachedAccessToken && !forceRefresh) return cachedAccessToken;
    cachedAccessToken = null;

    // Escritorio (Mk Organizer / Minichrome): el proceso principal renueva el token.
    if (window.desktop && typeof window.desktop.getAuthToken === 'function') {
        try {
            const auth = await window.desktop.getAuthToken();
            if (auth && auth.token) return (cachedAccessToken = auth.token);
        } catch (e) {}
        return null;
    }

    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return null;
    const st = await extStorageGet(['google_refresh_token', 'gdrive_token', 'gdrive_token_expiry']);
    if (!st.google_refresh_token) return null;   // hay que conectar la cuenta de Google
    if (!forceRefresh && st.gdrive_token && Number(st.gdrive_token_expiry) > Date.now()) {
        return (cachedAccessToken = st.gdrive_token);
    }
    try {
        const tok = await googleTokenRequest({ grant_type: 'refresh_token', refresh_token: st.google_refresh_token });
        await saveExtensionTokens(tok);
        return tok.access_token;
    } catch (e) {
        if (e.code === 'invalid_grant') {   // revocado o caducado: hay que volver a conectar
            await new Promise((resolve) => chrome.storage.local.remove(['google_refresh_token', 'gdrive_token', 'gdrive_token_expiry'], resolve));
        }
        return null;
    }
}

async function fetchWithAuth(url, options = {}) {
    let token = await getAuthTokenPromise();
    if (!token) throw new Error('No autorizado');

    const call = (t) => fetch(url, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${t}` } });
    let response = await call(token);
    if (response.status === 401) {
        token = await getAuthTokenPromise(true);
        if (token) response = await call(token);
    }
    return response;
}

// Actualizar la interfaz de usuario de Google Calendar
function updateGCalUI() {
    const statusText = document.getElementById('gcal-status-text');
    const connectBtn = document.getElementById('gcal-connect-btn');
    const calListContainer = document.getElementById('gcal-calendars-list');
    const destSelect = document.getElementById('gcal-dest-select');
    const syncControls = document.getElementById('gcal-sync-controls');

    const isEdge = navigator.userAgent.includes('Edg/');

    if (isEdge) {
        if (statusText) {
            statusText.innerText = 'No disponible en Microsoft Edge (API nativa no soportada)';
            statusText.className = 'sync-status disconnected';
            statusText.style.color = '#ff7675';
        }
        if (connectBtn) {
            connectBtn.innerText = 'No soportado en Edge';
            connectBtn.className = 'ag-btn ag-btn-danger';
            connectBtn.disabled = true;
            connectBtn.style.opacity = '0.5';
            connectBtn.style.cursor = 'not-allowed';
            connectBtn.onclick = null;
        }
        if (syncControls) {
            syncControls.style.display = 'none';
        }
        return;
    }

    if (statusText) {
        statusText.innerText = gcalState.connected ? 'Conectado a Google Calendar' : 'Desconectado';
        statusText.className = gcalState.connected ? 'sync-status connected' : 'sync-status disconnected';
    }

    if (connectBtn) {
        connectBtn.innerText = gcalState.connected ? 'Desconectar' : 'Conectar Google Calendar';
        connectBtn.className = gcalState.connected ? 'ag-btn ag-btn-danger' : 'ag-btn ag-btn-primary';
        connectBtn.onclick = gcalState.connected ? signOutGCalendar : signInGCalendar;
    }

    const agendaPublishBtn = document.getElementById('agenda-publish-gcal-btn');
    if (agendaPublishBtn) {
        agendaPublishBtn.style.display = gcalState.connected ? 'inline-block' : 'none';
        agendaPublishBtn.onclick = () => {
            if (window.state && window.state.reminders) {
                publishAllRemindersToGCal(window.state.reminders);
            }
        };
    }

    const configPublishBtn = document.getElementById('gcal-publish-all-btn');
    if (configPublishBtn) {
        configPublishBtn.onclick = () => {
            if (window.state && window.state.reminders) {
                publishAllRemindersToGCal(window.state.reminders);
            }
        };
    }

    if (syncControls) {
        syncControls.style.display = gcalState.connected ? 'block' : 'none';
    }

    // Renderizar lista de calendarios con checkboxes
    if (calListContainer) {
        calListContainer.innerHTML = '';
        if (gcalState.calendars.length === 0 && gcalState.connected) {
            if (gcalState.syncing) {
                calListContainer.innerHTML = '<div style="font-size:0.8rem; color:var(--ag-text-muted);">Cargando calendarios...</div>';
            } else {
                calListContainer.innerHTML = '<div style="font-size:0.82rem; color:#ff7675; cursor:pointer; text-decoration:underline;" onclick="fetchGCalendars()">Error al cargar calendarios. Clic aquí para reintentar.</div>';
            }
        } else {
            gcalState.calendars.forEach(cal => {
                const label = document.createElement('label');
                label.className = 'gcal-list-item';
                label.style.display = 'flex';
                label.style.alignItems = 'center';
                label.style.gap = '8px';
                label.style.fontSize = '0.82rem';
                label.style.margin = '6px 0';
                label.style.cursor = 'pointer';

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = !!cal.selected;
                checkbox.style.margin = '0';
                checkbox.onchange = () => {
                    cal.selected = checkbox.checked;
                    chrome.storage.local.set({ gcal_selected_calendars: gcalState.calendars }, () => {
                        fetchGCalEvents();
                    });
                };

                const textSpan = document.createElement('span');
                textSpan.innerText = cal.summary + (cal.isPrimary ? ' (Principal)' : '');

                label.appendChild(checkbox);
                label.appendChild(textSpan);
                calListContainer.appendChild(label);
            });
        }
    }

    // Renderizar selector de destino
    if (destSelect) {
        destSelect.innerHTML = '';
        gcalState.calendars.forEach(cal => {
            const opt = document.createElement('option');
            opt.value = cal.id;
            opt.innerText = cal.summary;
            opt.selected = cal.id === gcalState.destinationCalendarId;
            destSelect.appendChild(opt);
        });

        destSelect.onchange = () => {
            gcalState.destinationCalendarId = destSelect.value;
            chrome.storage.local.set({ gcal_destination_calendar: gcalState.destinationCalendarId });
        };
    }

    // Refrescar listado para mostrar/ocultar botones individuales
    if (window.renderReminders) {
        window.renderReminders();
    }
}

// Exponer funciones y variables al ámbito global
window.initGCalendarSync = initGCalendarSync;
window.gcalState = gcalState;
window.signInGCalendar = signInGCalendar;
window.signOutGCalendar = signOutGCalendar;
window.publishReminderToGCal = publishReminderToGCal;
window.publishAllRemindersToGCal = publishAllRemindersToGCal;
window.fetchGCalEvents = fetchGCalEvents;
window.fetchGCalendars = fetchGCalendars;
window.getAuthTokenPromise = getAuthTokenPromise;
window.googleSignInExtension = googleSignInExtension;
window.signOutExtensionGoogle = signOutExtensionGoogle;
window.fetchWithAuth = fetchWithAuth;

document.addEventListener('DOMContentLoaded', () => {
    initGCalendarSync();
});
