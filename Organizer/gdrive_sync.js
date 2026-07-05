// gdrive_sync.js - Sincronización local-first opcional con Google Drive

const GDRIVE_SCOPES = 'https://www.googleapis.com/auth/drive.file';

const syncState = {
    connected: false,
    syncing: false,
    lastSync: 'Nunca',
    accessToken: null
};

// Inicializar estado de sincronización
async function initGDriveSync() {
    if (typeof chrome === 'undefined' || !chrome.storage) return;

    chrome.storage.local.get(['gdrive_token', 'gdrive_last_sync'], (result) => {
        if (result.gdrive_token) {
            syncState.accessToken = result.gdrive_token;
            syncState.connected = true;
        }
        if (result.gdrive_last_sync) {
            syncState.lastSync = new Date(result.gdrive_last_sync).toLocaleString();
        }
        updateSyncUI();

        // Sincronización silenciosa automática al abrir la aplicación si está conectado
        if (syncState.connected) {
            syncNow(true);
        }
    });
}

// Iniciar sesión con Google Drive usando la API nativa getAuthToken
function signInGDrive() {
    if (typeof chrome === 'undefined' || !chrome.identity) {
        window.showToast('La API de identidad de Chrome no está disponible.', 'error');
        return;
    }

    syncState.syncing = true;
    updateSyncUI();

    chrome.identity.getAuthToken({ interactive: true }, (token) => {
        syncState.syncing = false;
        
        if (chrome.runtime.lastError || !token) {
            const errObj = chrome.runtime.lastError;
            const errMsg = errObj ? (errObj.message || JSON.stringify(errObj)) : 'Token no recibido';
            console.error('Google Auth error object:', errObj);
            window.showToast(`Error al conectar con Google Drive: ${errMsg}. Operando localmente.`, 'info');
            syncState.connected = false;
            updateSyncUI();
            return;
        }

        syncState.accessToken = token;
        syncState.connected = true;
        
        chrome.storage.local.set({ gdrive_token: token }, () => {
            window.showToast('Conectado a Google Drive exitosamente', 'success');
            updateSyncUI();
            syncNow(true); // Intentar sincronización automática inicial
        });
    });
}

// Cerrar sesión
function signOutGDrive() {
    syncState.accessToken = null;
    syncState.connected = false;
    chrome.storage.local.remove(['gdrive_token'], () => {
        notify('Desconectado de Google Drive. Los datos permanecen locales.', 'success');
        updateSyncUI();
    });
}

// Sincronizar datos (subir o descargar)
async function syncNow(auto = false) {
    if (!syncState.connected || !syncState.accessToken) {
        if (!auto) notify('Conéctate a Google Drive primero', 'info');
        return;
    }

    syncState.syncing = true;
    updateSyncUI();

    try {
        // 1. Obtener todos los datos locales
        const keys = ['agenda', 'shopping', 'income', 'kanban', 'notes', 'passwords', 'app_config', 'deudas_list', 'deudas_presupuesto', 'budget_limits'];
        
        chrome.storage.local.get(keys, async (localData) => {
            localData.timestamp = Date.now();

            // 2. Buscar si ya existe el archivo en Drive
            const fileId = await findFileInGDrive('mkorganizer_data.json');
            
            if (fileId) {
                // Descargar archivo de Drive para comparar marcas de tiempo
                const remoteData = await downloadFromGDrive(fileId);
                
                if (remoteData && remoteData.timestamp) {
                    const localTs = localData.timestamp || 0;
                    const remoteTs = remoteData.timestamp || 0;

                    if (remoteTs > localTs && !auto) {
                        // Los datos remotos son más nuevos, preguntar antes de sobrescribir
                        window.showConfirm('Los datos en Google Drive son más recientes. ¿Deseas descargar los datos de la nube y sobrescribir los locales?', async (confirm) => {
                            if (confirm) {
                                await applyDownloadedData(remoteData);
                                syncState.lastSync = new Date().toLocaleString();
                                chrome.storage.local.set({ gdrive_last_sync: Date.now() });
                                notify('Datos descargados y aplicados correctamente', 'success');
                                location.reload(); // Recargar para aplicar cambios
                            } else {
                                // Forzar subida de datos locales
                                await uploadToGDrive(fileId, localData);
                                finishSync();
                            }
                        });
                        return;
                    }
                }
                
                // Si no hay conflicto o los datos locales son más recientes, subir
                await uploadToGDrive(fileId, localData);
            } else {
                // Crear archivo nuevo en Drive
                await createInGDrive('mkorganizer_data.json', localData);
            }

            finishSync();
        });
    } catch (err) {
        console.error('Error durante la sincronización:', err);
        notify('Fallo en la sincronización de Google Drive. Datos guardados localmente.', 'info');
        syncState.syncing = false;
        updateSyncUI();
    }
}

function finishSync() {
    syncState.syncing = false;
    syncState.lastSync = new Date().toLocaleString();
    chrome.storage.local.set({ gdrive_last_sync: Date.now() });
    notify('Sincronización con Google Drive completada', 'success');
    updateSyncUI();
}

// Aplicar los datos remotos al almacenamiento local de la extensión
async function applyDownloadedData(remoteData) {
    return new Promise((resolve) => {
        const cleanData = {};
        const keys = ['agenda', 'shopping', 'income', 'kanban', 'notes', 'passwords', 'app_config', 'deudas_list', 'deudas_presupuesto', 'budget_limits'];
        keys.forEach(k => {
            if (remoteData[k] !== undefined) {
                cleanData[k] = remoteData[k];
            }
        });
        chrome.storage.local.set(cleanData, resolve);
    });
}

// --- HELPERS API GOOGLE DRIVE REST ---

async function findFileInGDrive(filename) {
    const response = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=name='${filename}'+and+trashed=false&spaces=drive`, 
        {
            headers: { 'Authorization': `Bearer ${syncState.accessToken}` }
        }
    );
    const data = await response.json();
    if (data.files && data.files.length > 0) {
        return data.files[0].id;
    }
    return null;
}

async function downloadFromGDrive(fileId) {
    const response = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, 
        {
            headers: { 'Authorization': `Bearer ${syncState.accessToken}` }
        }
    );
    return await response.json();
}

async function uploadToGDrive(fileId, payload) {
    await fetch(
        `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, 
        {
            method: 'PATCH',
            headers: { 
                'Authorization': `Bearer ${syncState.accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        }
    );
}

async function createInGDrive(filename, payload) {
    // Metadata del archivo
    const metadata = {
        name: filename,
        mimeType: 'application/json'
    };

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('media', new Blob([JSON.stringify(payload)], { type: 'application/json' }));

    await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', 
        {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${syncState.accessToken}` },
            body: form
        }
    );
}

// Actualizar elementos de la interfaz de sincronización
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

// Exponer funciones globales
window.initGDriveSync = initGDriveSync;
window.syncNow = syncNow;

// Escuchar cambios locales para disparar sincronizaciones automáticas diferidas
let syncDebounceTimeout = null;
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local' && syncState.connected && !syncState.syncing) {
            // Ignorar cambios en variables de control interno de sincronización para evitar loops infinitos
            const keys = Object.keys(changes);
            const isInternal = keys.every(k => k.startsWith('gdrive_'));
            if (isInternal) return;

            // Debounce de 3 segundos tras cambios locales para evitar saturar la API
            if (syncDebounceTimeout) clearTimeout(syncDebounceTimeout);
            syncDebounceTimeout = setTimeout(() => {
                syncNow(true); // Sincronización silenciosa automática
            }, 3000);
        }
    });
}
