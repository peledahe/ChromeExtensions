// gdrive_sync.js - Escritorio: local-first hasta conectar; Drive es fuente principal si existe archivo.

const syncState = {
    connected: false,
    syncing: false,
    lastSync: 'Nunca',
    accessToken: null
};

function notifySync(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type);
    else if (typeof notify === 'function') notify(msg, type);
}

async function initGDriveSync() {
    if (typeof chrome === 'undefined' || !chrome.storage) return;

    chrome.storage.local.get(['gdrive_token', 'gdrive_last_sync', 'google_refresh_token'], (result) => {
        if (result.gdrive_token && !window.desktop && !result.google_refresh_token) {
            // Conexión anterior con el cliente viejo (proyecto sin Drive API y con
            // un archivo aparte): hay que conectar otra vez para compartir datos.
            chrome.storage.local.remove(['gdrive_token', 'gcal_connected']);
            notifySync('Vuelve a conectar Google Drive: la extensión ahora usa la misma cuenta que Minichrome y Mk Organizer.', 'info');
            result.gdrive_token = null;
        }
        if (result.gdrive_token) {
            syncState.accessToken = result.gdrive_token;
            syncState.connected = true;
        }
        if (result.gdrive_last_sync) {
            syncState.lastSync = new Date(result.gdrive_last_sync).toLocaleString();
        }
        updateSyncUI();
        checkAndShowBackupOption();

        if (syncState.connected) {
            syncNow(true);
        }
    });
}

async function signInGDrive() {
    syncState.syncing = true;
    updateSyncUI();

    let token = null;
    if (window.desktop && typeof window.desktop.signInGoogle === 'function') {
        const res = await window.desktop.signInGoogle();
        if (res && res.token) {
            token = res.token;
        } else {
            const err = res && res.error ? res.error : 'No se pudo conectar con Google. La app sigue funcionando en local.';
            notifySync(err, 'info');
            syncState.syncing = false;
            syncState.connected = false;
            updateSyncUI();
            return;
        }
    } else if (typeof chrome !== 'undefined' && chrome.tabs) {
        try {
            token = await googleSignInExtension();
        } catch (err) {
            notifySync(`No se pudo conectar con Google: ${err.message}`, 'error');
        }
    } else {
        notifySync('La capa de escritorio o identidad no está disponible.', 'error');
        syncState.syncing = false;
        updateSyncUI();
        return;
    }

    syncState.syncing = false;
    if (token) {
        syncState.accessToken = token;
        syncState.connected = true;
        chrome.storage.local.set({ gdrive_token: token }, () => {
            notifySync('Conectado a Google Drive exitosamente', 'success');
            updateSyncUI();
            // Sin «preferir Drive»: al conectar se combina lo de la extensión con lo
            // que ya hay en Drive (ver la regla del primer uso de un archivo).
            syncNow(true);
        });
    } else {
        syncState.connected = false;
        updateSyncUI();
    }
}

async function signOutGDrive() {
    if (window.desktop && window.desktop.signOutGoogle) {
        await window.desktop.signOutGoogle();
    } else if (typeof chrome !== 'undefined' && chrome.tabs) {
        await signOutExtensionGoogle();
    }
    syncState.accessToken = null;
    syncState.connected = false;
    chrome.storage.local.remove(['gdrive_token'], () => {
        notifySync('Desconectado de Google Drive. Los datos permanecen locales.', 'success');
        updateSyncUI();
    });
}

// Llamadas a Drive con el token renovable de gcal_sync.js (fetchWithAuth). Cualquier
// error de la API detiene la sincronización: antes un 401 se tomaba como «no hay
// archivo» y se intentaba crear otro.
async function driveRequest(url, options = {}) {
    const response = await fetchWithAuth(url, options);
    if (!response.ok) {
        let detail = '';
        try { const d = await response.json(); detail = (d.error && d.error.message) || ''; } catch (e) {}
        throw new Error(`Google Drive respondió ${response.status}${detail ? ': ' + detail : ''}`);
    }
    return response.status === 204 ? null : response.json().catch(() => null);
}

async function findFileInGDrive(_token) {
    const q = encodeURIComponent("name='mkorganizer_data.json' and trashed=false");
    const data = await driveRequest(
        `https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&orderBy=modifiedTime desc&pageSize=10&fields=files(id,name,modifiedTime)`
    );
    return data && data.files && data.files.length > 0 ? data.files[0].id : null;
}

async function downloadFromGDrive(_token, fileId) {
    return driveRequest(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
}

async function uploadToGDrive(_token, fileId, payload) {
    await driveRequest(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
}

async function createInGDrive(token, payload) {
    const boundary = '-------314159265358979323846';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelim = `\r\n--${boundary}--`;
    const metadata = JSON.stringify({ name: 'mkorganizer_data.json', mimeType: 'application/json' });
    const data = JSON.stringify(payload);
    const body = delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        metadata +
        delimiter +
        'Content-Type: application/json\r\n\r\n' +
        data +
        closeDelim;

    return driveRequest('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body: body
    });
}

// Para combinar sin duplicar: qué hace "igual" a un registro en cada lista.
const DRIVE_MERGE_SIGNATURES = {
    agenda: (x) => [x.text, x.dueDate || ''],
    shopping: (x) => [x.text, Number(x.value) || 0, x.dueDate || ''],
    income: (x) => [x.text, Number(x.value) || 0, x.dueDate || ''],
    kanban_cards: (x) => [x.text],
    notes: (x) => [x.content],
    passwords: (x) => [x.site, x.username],
    deudas_list: (x) => [x.name],
    savings_goals: (x) => [x.name]
};

function hasDriveAppData(p) {
    if (!p || typeof p !== 'object') return false;
    const lists = ['agenda', 'shopping', 'income', 'kanban', 'kanban_cards', 'notes', 'passwords', 'deudas_list', 'savings_goals'];
    if (lists.some((k) => Array.isArray(p[k]) && p[k].length > 0)) return true;
    if (['budget_limits', 'budget_income_targets'].some((k) => p[k] && typeof p[k] === 'object' && Object.keys(p[k]).length > 0)) return true;
    return Number(p.deudas_presupuesto) > 0;
}

// Une Drive y lo local la primera vez que se sincroniza con un archivo: nada se
// pierde. Las listas se combinan (lo local que falte en Drive entra con un ID
// nuevo); en lo demás manda Drive si lo tiene. Mismo criterio que Minichrome y
// Mk Organizer de escritorio.
function mergeDrivePayloads(remote, local) {
    const merged = JSON.parse(JSON.stringify(remote || {}));
    Object.entries(DRIVE_MERGE_SIGNATURES).forEach(([key, sig]) => {
        const items = Array.isArray(merged[key]) ? merged[key] : [];
        const seen = new Set(items.filter((x) => x && typeof x === 'object').map((x) => JSON.stringify(sig(x))));
        let nextId = Math.max(0, ...items.map((x) => Number(x && x.id) || 0)) + 1;
        (Array.isArray(local[key]) ? local[key] : []).forEach((item) => {
            if (!item || typeof item !== 'object') return;
            const s = JSON.stringify(sig(item));
            if (seen.has(s)) return;
            seen.add(s);
            items.push({ ...item, id: nextId++ });
        });
        merged[key] = items;
    });
    merged.app_config = { ...(local.app_config || {}), ...(merged.app_config || {}) };
    Object.keys(local).forEach((k) => {
        const v = merged[k];
        const empty = v === undefined || v === null || v === '' || v === 0
            || (Array.isArray(v) && !v.length) || (v && typeof v === 'object' && !Object.keys(v).length);
        if (empty) merged[k] = local[k];
    });
    return merged;
}

function canonicalDriveValue(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalDriveValue).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalDriveValue(value[k])}`).join(',')}}`;
    }
    return JSON.stringify(value === undefined ? null : value);
}

// ¿El archivo ya tiene exactamente lo que se subiría? (sin contar la fecha ni marcas internas)
function sameDriveContent(local, remote) {
    if (!remote || typeof remote !== 'object') return false;
    const ignore = new Set(['timestamp', 'local_data_modified']);
    return Object.keys(local).every((k) => ignore.has(k) || canonicalDriveValue(local[k]) === canonicalDriveValue(remote[k]));
}

async function syncNow(auto = false, preferDrive = false) {
    if (!syncState.connected && !auto) {
        notifySync('Conéctate a Google Drive primero', 'info');
        return;
    }
    // Al abrir se pide sincronizar más de una vez; dos a la vez sin archivo en
    // Drive creaban mkorganizer_data.json duplicado.
    if (auto && syncState.syncing) return;

    syncState.syncing = true;
    updateSyncUI();

    try {
        if (window.desktop && typeof window.desktop.syncDrive === 'function') {
            const result = await window.desktop.syncDrive({ auto: !!auto, preferDrive: !!preferDrive });
            if (!result || !result.ok) {
                throw new Error((result && result.error) || 'Fallo en la sincronización');
            }
            if (result.action === 'download') {
                notifySync('Datos de Google Drive aplicados. Recargando…', 'success');
                setTimeout(() => location.reload(), 800);
                return;
            }
            if (!auto) {
                notifySync(result.action === 'create' ? 'Se creó mkorganizer_data.json en Google Drive con tus datos.' : 'Sincronización con Google Drive completada', 'success');
            }
        } else {
            const token = await getAuthTokenPromise();
            if (!token) throw new Error('No hay sesión de Google activa');

            const keys = [
                'agenda', 'shopping', 'income', 'kanban', 'kanban_cards', 'notes', 'passwords', 'app_config', 
                'deudas_list', 'deudas_presupuesto', 'savings_goals', 'budget_limits', 'budget_income_targets',
                'budget_currency_symbol', 'budget_currency_code', 'budget_second_currency_enabled',
                'budget_second_currency_symbol', 'budget_second_currency_code', 'budget_exchange_rate',
                'budget_categories'
            ];

            const localData = await new Promise((res) => chrome.storage.local.get(keys, res));
            const lastSync = await new Promise((res) => chrome.storage.local.get(['gdrive_last_sync'], (r) => res(r && r.gdrive_last_sync ? r.gdrive_last_sync : 0)));

            const fileId = await findFileInGDrive(token);
            const lastFileId = await new Promise((res) => chrome.storage.local.get(['gdrive_file_id'], (r) => res((r && r.gdrive_file_id) || '')));
            const rememberFile = (id) => new Promise((res) => chrome.storage.local.set({ gdrive_file_id: id || '' }, res));
            if (fileId) {
                const remoteData = await downloadFromGDrive(token, fileId);
                const hasRemote = hasDriveAppData(remoteData);
                const remoteTs = Number(remoteData && remoteData.timestamp) || 0;
                const hasLocal = hasDriveAppData(localData);

                // Primera vez con este archivo (nunca se sincronizó, o antes se usaba otro,
                // p. ej. de otro proyecto de Google): combinar en lugar de reemplazar.
                if ((!lastSync || lastFileId !== fileId) && hasLocal && hasRemote && !preferDrive) {
                    await new Promise((res) => chrome.storage.local.set({ backup_before_sync: { ...localData }, backup_drive_before_merge: remoteData }, res));
                    const merged = mergeDrivePayloads(remoteData, localData);
                    merged.timestamp = Date.now();
                    await uploadToGDrive(token, fileId, merged);
                    const { timestamp, ...toStore } = merged;
                    await new Promise((res) => chrome.storage.local.set(toStore, res));
                    await new Promise((res) => chrome.storage.local.set({ gdrive_last_sync: merged.timestamp }, res));
                    await rememberFile(fileId);
                    notifySync('Se combinaron tus datos con los de Google Drive. Actualizando…', 'success');
                    setTimeout(() => location.reload(), 800);
                    return;
                }

                const driveIsSource = hasRemote && (preferDrive || (!lastSync && !hasLocal) || (remoteTs > (lastSync + 2000)));

                if (driveIsSource) {
                    if (hasLocal) {
                        await new Promise((res) => chrome.storage.local.set({ backup_before_sync: { ...localData } }, res));
                    }
                    await new Promise((res) => chrome.storage.local.set(remoteData, res));
                    await new Promise((res) => chrome.storage.local.set({ gdrive_last_sync: Math.max(Date.now(), remoteTs) }, res));
                    await rememberFile(fileId);
                    notifySync('Datos descargados de Google Drive. Actualizando…', 'success');
                    setTimeout(() => location.reload(), 800);
                    return;
                } else if (sameDriveContent(localData, remoteData)) {
                    // Nada que subir: no se cambia la fecha del archivo, así Minichrome y
                    // Mk Organizer de escritorio no creen que hay datos nuevos.
                    await new Promise((res) => chrome.storage.local.set({ gdrive_last_sync: Math.max(lastSync || 0, remoteTs) }, res));
                    await rememberFile(fileId);
                    if (!auto) notifySync('Todo está sincronizado con Google Drive', 'success');
                } else {
                    localData.timestamp = Date.now();
                    await uploadToGDrive(token, fileId, localData);
                    await new Promise((res) => chrome.storage.local.set({ gdrive_last_sync: Date.now() }, res));
                    await rememberFile(fileId);
                    if (!auto) notifySync('Sincronización con Google Drive completada', 'success');
                }
            } else {
                localData.timestamp = Date.now();
                const created = await createInGDrive(token, localData);
                await new Promise((res) => chrome.storage.local.set({ gdrive_last_sync: Date.now() }, res));
                await rememberFile(created && created.id);
                if (!auto) notifySync('Se creó mkorganizer_data.json en Google Drive con tus datos locales.', 'success');
            }
        }
        finishSync();
    } catch (err) {
        console.error('Error durante la sincronización:', err);
        if (!auto) {
            const msg = String(err.message || err);
            if (msg.includes('Google Drive API has not been used') || msg.includes('disabled')) {
                // Google indica el proyecto del cliente OAuth: se muestra para saber dónde activarla.
                const project = (msg.match(/project[ =](\d+)/) || [])[1];
                notifySync(project
                    ? `La Google Drive API está desactivada en el proyecto ${project} de Google Cloud. Actívala en console.cloud.google.com/apis/library/drive.googleapis.com?project=${project}`
                    : 'Falta habilitar la Google Drive API en tu proyecto de Google Cloud.', 'error');
            } else {
                notifySync(`Fallo en la sincronización: ${err.message || 'Error'}`, 'info');
            }
        }
        syncState.syncing = false;
        updateSyncUI();
    }
}

function finishSync() {
    syncState.syncing = false;
    syncState.lastSync = new Date().toLocaleString();
    updateSyncUI();
}

async function restoreFromLocalBackup() {
    chrome.storage.local.get(['backup_before_sync'], (result) => {
        if (!result.backup_before_sync) {
            notifySync('No hay backup disponible para restaurar', 'info');
            return;
        }

        window.showConfirm('¿Deseas restaurar los datos del backup local anterior?', (confirm) => {
            if (!confirm) return;
            const backup = result.backup_before_sync;
            const skip = new Set(['gdrive_token', 'gdrive_refresh_token', 'gdrive_token_expiry', 'gdrive_last_sync', 'backup_before_sync']);
            const cleanData = { local_data_modified: true };
            Object.keys(backup).forEach((k) => {
                if (!skip.has(k) && backup[k] !== undefined) cleanData[k] = backup[k];
            });
            chrome.storage.local.set(cleanData, () => {
                notifySync('Datos restaurados desde backup. Recargando…', 'success');
                setTimeout(() => location.reload(), 800);
            });
        });
    });
}

function checkAndShowBackupOption() {
    chrome.storage.local.get(['backup_before_sync'], (result) => {
        if (result.backup_before_sync) {
            const syncStatusDiv = document.getElementById('sync-status-text');
            if (syncStatusDiv && !document.getElementById('restore-backup-btn')) {
                const restoreBtn = document.createElement('button');
                restoreBtn.id = 'restore-backup-btn';
                restoreBtn.className = 'ag-btn ag-btn-primary';
                restoreBtn.style.marginTop = '12px';
                restoreBtn.textContent = 'Restaurar Backup';
                restoreBtn.onclick = restoreFromLocalBackup;
                syncStatusDiv.parentElement.insertBefore(restoreBtn, syncStatusDiv.nextElementSibling);
            }
        }
    });
}

function updateSyncUI() {
    const statusText = document.getElementById('sync-status-text');
    const connectBtn = document.getElementById('sync-connect-btn');
    const syncBtn = document.getElementById('sync-now-btn');
    const lastSyncEl = document.getElementById('sync-last-time');

    if (statusText) {
        statusText.innerText = syncState.connected ? 'Conectado a Google Drive' : 'Desconectado de la nube';
        statusText.className = syncState.connected ? 'sync-status connected' : 'sync-status disconnected';
    }

    if (connectBtn) {
        connectBtn.innerText = syncState.connected ? 'Desconectar' : 'Conectar Google Drive';
        connectBtn.onclick = syncState.connected ? signOutGDrive : signInGDrive;
        connectBtn.className = syncState.connected ? 'ag-btn ag-btn-danger' : 'ag-btn ag-btn-primary';
    }

    if (syncBtn) {
        syncBtn.style.display = syncState.connected ? 'inline-block' : 'none';
        syncBtn.disabled = syncState.syncing;
        syncBtn.onclick = () => syncNow(false);

        const svgIcon = `
            <svg class="${syncState.syncing ? 'ag-spin' : ''}" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-left: 6px; display: inline-block;">
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l.73-.73"/>
            </svg>
        `;

        if (syncState.syncing) {
            syncBtn.innerHTML = `Sincronizando ${svgIcon}`;
        } else {
            syncBtn.innerHTML = `Sincronizar ahora ${svgIcon}`;
        }
    }

    if (lastSyncEl) {
        lastSyncEl.innerText = syncState.lastSync;
    }
}

window.initGDriveSync = initGDriveSync;
window.syncNow = syncNow;
window.signInGDrive = signInGDrive;
window.signOutGDrive = signOutGDrive;

document.addEventListener('DOMContentLoaded', () => {
    initGDriveSync();
});

let syncDebounceTimeout = null;
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local' && syncState.connected && !syncState.syncing) {
            const keys = Object.keys(changes);
            const isInternal = keys.every((k) => 
                k.startsWith('gdrive_') || 
                k.startsWith('gcal_') || 
                k === 'backup_before_sync' || 
                k === 'local_data_modified'
            );
            if (isInternal) return;

            if (syncDebounceTimeout) clearTimeout(syncDebounceTimeout);
            syncDebounceTimeout = setTimeout(() => {
                syncNow(true);
            }, 5000);
        }
    });
}
