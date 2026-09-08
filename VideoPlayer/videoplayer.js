// Shim y Utilidades de File System Access API para VideoPlayer
(function () {
    'use strict';

    const DB_NAME = 'videoplayer-db';
    const STORE_NAME = 'handles';

    const localState = {
        rootHandle: null,
        directoryHandles: new Map(), // path relativo -> FileSystemDirectoryHandle
        objectUrls: new Set(),
        activeVideos: [] // videos de la carpeta actual con sus handles
    };

    function getDb() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = () => {
                req.result.createObjectStore(STORE_NAME);
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function saveHandle(key, handle) {
        const db = await getDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            store.put(handle, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async function loadHandle(key) {
        try {
            const db = await getDb();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, 'readonly');
                const store = tx.objectStore(STORE_NAME);
                const req = store.get(key);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        } catch (_e) {
            return null;
        }
    }

    async function buildVideoFolderTree(dirHandle, currentPath = '.') {
        const children = [];
        localState.directoryHandles.set(currentPath, dirHandle);

        for await (const entry of dirHandle.values()) {
            if (entry.kind === 'directory') {
                const relPath = currentPath === '.' ? entry.name : `${currentPath}/${entry.name}`;
                const subTree = await buildVideoFolderTree(entry, relPath);
                children.push({
                    name: entry.name,
                    path: relPath,
                    children: subTree.children,
                    handle: entry
                });
            }
        }
        children.sort((a, b) => a.name.localeCompare(b.name));
        return { name: dirHandle.name, path: currentPath, children, handle: dirHandle };
    }

    // ═══════════ Etiquetas: almacenamiento en la propia carpeta raíz ═══════════
    // Se guardan en un archivo dentro de la carpeta de videos en vez de en
    // localStorage. Así las etiquetas viajan con la carpeta: al cambiar de raíz
    // no se mezclan ni se pierden, y al volver a una carpeta usada antes se
    // recuperan solas. El punto inicial lo oculta en Linux/macOS y en Windows
    // lo deja agrupado al principio del listado.
    const TAGS_FILENAME = '.videoplayer-tags.json';

    async function readTagsFile() {
        if (!localState.rootHandle) return null;
        try {
            const fileHandle = await localState.rootHandle.getFileHandle(TAGS_FILENAME);
            const file = await fileHandle.getFile();
            const text = await file.text();
            if (!text || !text.trim()) return {};
            const parsed = JSON.parse(text);
            return (parsed && typeof parsed === 'object') ? parsed : {};
        } catch (e) {
            // NotFoundError = la carpeta todavía no tiene archivo de etiquetas
            if (e && e.name !== 'NotFoundError') {
                console.warn('No se pudo leer el archivo de etiquetas:', e);
            }
            return null;
        }
    }

    async function writeTagsFile(data) {
        if (!localState.rootHandle) return false;
        try {
            const fileHandle = await localState.rootHandle.getFileHandle(TAGS_FILENAME, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(JSON.stringify(data, null, 2));
            await writable.close();
            return true;
        } catch (e) {
            console.error('No se pudo guardar el archivo de etiquetas:', e);
            if (typeof showNotification === 'function') {
                showNotification('No se pudieron guardar las etiquetas en la carpeta', 'error');
            }
            return false;
        }
    }

    // Las escrituras se encadenan: guardar varias etiquetas seguidas no debe
    // solapar dos createWritable() sobre el mismo archivo.
    let tagsWriteChain = Promise.resolve(true);
    function writeTagsFileSerialized(data) {
        tagsWriteChain = tagsWriteChain
            .catch(() => false)
            .then(() => writeTagsFile(data));
        return tagsWriteChain;
    }

    // Objeto py simulador local para la extensión
    const py = {
        async get_media_path() {
            return localState.rootHandle ? localState.rootHandle.name : '';
        },
        async get_config(key) {
            if (key === 'videoStartMuted') return localStorage.getItem('videoStartMuted') || '1';
            if (key === 'homeUrl') return localStorage.getItem('homeUrl') || '';
            if (key === 'videoSortBy') return localStorage.getItem('videoSortBy') || 'name-asc';
            return '';
        },
        async set_config(key, val) {
            localStorage.setItem(key, String(val));
        },
        async get_video_folders() {
            if (!localState.rootHandle) return '[]';
            localState.directoryHandles.clear();
            try {
                const data = await buildVideoFolderTree(localState.rootHandle, '.');
                return JSON.stringify([data]);
            } catch (e) {
                console.error(e);
                return '[]';
            }
        },
        async get_videos(folderPath) {
            // Liberar Object URLs anteriores para no saturar memoria
            localState.objectUrls.forEach(url => URL.revokeObjectURL(url));
            localState.objectUrls.clear();
            localState.activeVideos = [];

            const folderHandle = localState.directoryHandles.get(folderPath);
            if (!folderHandle) return '[]';

            const list = [];
            const supportedVideoExts = ['.mp4', '.webm', '.ogg', '.m3u8', '.mov', '.mkv', '.avi'];
            for await (const entry of folderHandle.values()) {
                if (entry.kind === 'file') {
                    const nameLower = entry.name.toLowerCase();
                    const isVideo = supportedVideoExts.some(ext => nameLower.endsWith(ext));
                    if (isVideo) {
                        const file = await entry.getFile();
                        const url = URL.createObjectURL(file);
                        localState.objectUrls.add(url);

                        const videoItem = {
                            name: entry.name,
                            path: folderPath === '.' ? entry.name : `${folderPath}/${entry.name}`,
                            url: url,
                            size: file.size,
                            mtime: file.lastModified / 1000,
                            handle: entry
                        };
                        list.push(videoItem);
                        localState.activeVideos.push(videoItem);
                    }
                }
            }
            return JSON.stringify(list);
        },
        // Resuelve una lista de rutas relativas (posiblemente de carpetas
        // distintas) en una sola pasada. Necesario para las vistas por etiqueta:
        // llamar a get_videos() por cada carpeta revocaría las URLs creadas en
        // las anteriores, dejando media lista sin poder reproducirse.
        async get_videos_by_paths(jsonPaths) {
            let paths;
            try {
                paths = JSON.parse(jsonPaths);
            } catch (_e) {
                return '[]';
            }
            if (!Array.isArray(paths)) return '[]';

            localState.objectUrls.forEach(url => URL.revokeObjectURL(url));
            localState.objectUrls.clear();
            localState.activeVideos = [];

            const list = [];
            for (const relPath of paths) {
                const parts = String(relPath).split('/');
                const name = parts.pop();
                const parentPath = parts.join('/') || '.';
                const dirHandle = localState.directoryHandles.get(parentPath);
                if (!dirHandle) continue;
                try {
                    const fileHandle = await dirHandle.getFileHandle(name);
                    const file = await fileHandle.getFile();
                    const url = URL.createObjectURL(file);
                    localState.objectUrls.add(url);

                    const videoItem = {
                        name,
                        path: relPath,
                        url,
                        size: file.size,
                        mtime: file.lastModified / 1000,
                        handle: fileHandle
                    };
                    list.push(videoItem);
                    localState.activeVideos.push(videoItem);
                } catch (_e) {
                    // El archivo ya no existe (movido o borrado fuera de la app)
                }
            }
            return JSON.stringify(list);
        },
        async delete_video(relPath) {
            const parts = relPath.split('/');
            const name = parts.pop();
            const parentPath = parts.join('/') || '.';
            const parentHandle = localState.directoryHandles.get(parentPath);
            if (!parentHandle) return false;
            try {
                await parentHandle.removeEntry(name);
                return true;
            } catch (e) {
                console.error(e);
                return false;
            }
        },
        async rename_video(oldRelPath, newName) {
            const parts = oldRelPath.split('/');
            const oldName = parts.pop();
            const parentPath = parts.join('/') || '.';
            const parentHandle = localState.directoryHandles.get(parentPath);
            if (!parentHandle) return false;
            try {
                const fileEntry = await parentHandle.getFileHandle(oldName);
                if (typeof fileEntry.move === 'function') {
                    await fileEntry.move(newName);
                } else {
                    const file = await fileEntry.getFile();
                    const newFileHandle = await parentHandle.getFileHandle(newName, { create: true });
                    const writable = await newFileHandle.createWritable();
                    await writable.write(file);
                    await writable.close();
                    await parentHandle.removeEntry(oldName);
                }
                return true;
            } catch (e) {
                console.error(e);
                return false;
            }
        },
        async move_video(filename, fromFolder, toFolder) {
            const fromHandle = localState.directoryHandles.get(fromFolder || '.');
            const toHandle = localState.directoryHandles.get(toFolder || '.');
            if (!fromHandle || !toHandle) return false;
            try {
                const fileEntry = await fromHandle.getFileHandle(filename);
                if (typeof fileEntry.move === 'function') {
                    await fileEntry.move(toHandle, filename);
                } else {
                    const file = await fileEntry.getFile();
                    const newFileHandle = await toHandle.getFileHandle(filename, { create: true });
                    const writable = await newFileHandle.createWritable();
                    await writable.write(file);
                    await writable.close();
                    await fromHandle.removeEntry(filename);
                }
                return true;
            } catch (e) {
                console.error(e);
                return false;
            }
        },
        async create_folder(parentPath, folderName) {
            const parentHandle = localState.directoryHandles.get(parentPath || '.');
            if (!parentHandle) return false;
            try {
                await parentHandle.getDirectoryHandle(folderName, { create: true });
                return true;
            } catch (e) {
                console.error(e);
                return false;
            }
        },
        async delete_folder(folderPath) {
            const parts = folderPath.split('/');
            const name = parts.pop();
            const parentPath = parts.join('/') || '.';
            const parentHandle = localState.directoryHandles.get(parentPath);
            if (!parentHandle) return false;
            try {
                await parentHandle.removeEntry(name, { recursive: true });
                return true;
            } catch (e) {
                console.error(e);
                return false;
            }
        },
        async rename_folder(oldPath, newName) {
            const parts = oldPath.split('/');
            const oldName = parts.pop();
            const parentPath = parts.join('/') || '.';
            const parentHandle = localState.directoryHandles.get(parentPath);
            if (!parentHandle) return false;
            try {
                const folderEntry = await parentHandle.getDirectoryHandle(oldName);
                if (typeof folderEntry.move === 'function') {
                    await folderEntry.move(newName);
                    return true;
                } else {
                    return false;
                }
            } catch (e) {
                console.error(e);
                return false;
            }
        },
        async get_video_tags() {
            const fromFile = await readTagsFile();
            if (fromFile) return JSON.stringify(fromFile);

            // Esta carpeta raíz aún no tiene archivo de etiquetas. Si quedan
            // etiquetas del esquema anterior (localStorage global) se adoptan
            // UNA sola vez; así no se arrastran a las demás carpetas raíz.
            const legacy = localStorage.getItem('videoTags');
            if (legacy && localStorage.getItem('videoTagsMigrated') !== '1') {
                localStorage.setItem('videoTagsMigrated', '1');
                return legacy;
            }
            return '{}';
        },
        async save_video_tags(jsonTagsAll) {
            let data;
            try {
                data = JSON.parse(jsonTagsAll);
            } catch (_e) {
                return false;
            }
            return await writeTagsFileSerialized(data);
        },
        async get_playback_history() {
            return localStorage.getItem('videoPlaybackHistory') || '{}';
        },
        async save_playback(videoUrl, time) {
            const history = JSON.parse(localStorage.getItem('videoPlaybackHistory') || '{}');
            history[videoUrl] = parseFloat(time);
            localStorage.setItem('videoPlaybackHistory', JSON.stringify(history));
            return true;
        }
    };

    window.py = py;

    // --- CÓDIGO ORIGINAL DEL REPRODUCTOR ADAPTADO ---
    const folderList = document.getElementById('folder-list');
    const videoList = document.getElementById('video-list');
    const mainPlayer = document.getElementById('main-player');
    const currentFolderName = document.getElementById('current-folder-name');
    const currentVideoTitle = document.getElementById('current-video-title');
    const videoInfo = document.querySelector('.video-info');
    const deleteModal = document.getElementById('delete-modal');
    const confirmDeleteBtn = document.getElementById('confirm-delete');
    const cancelDeleteBtn = document.getElementById('cancel-delete');
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const toggleSidebarBtn = document.getElementById('toggle-sidebar');
    const playlistBtn = document.getElementById('playlist-btn');
    const resetPlayerBtn = document.getElementById('reset-player-btn');
    const toggleUiBtn = document.getElementById('toggle-ui');
    const appContainer = document.querySelector('.app-container');
    const playlistSidebar = document.getElementById('playlist-sidebar');
    const settingsBtn = document.getElementById('settings-btn');
    const sidebar = document.querySelector('.sidebar');

    // Etiquetas
    const tagsList = document.getElementById('tags-list');
    const tagsModal = document.getElementById('tags-modal');
    const closeTagsModalBtn = document.getElementById('close-tags-modal');
    const doneTagsModalBtn = document.getElementById('done-tags-modal');
    const newTagInput = document.getElementById('new-tag-input');
    const addTagBtn = document.getElementById('add-tag-btn');
    const currentVideoTagsDiv = document.getElementById('current-video-tags');
    const allAvailableTagsDiv = document.getElementById('all-available-tags');
    const tagsVideoTitle = document.getElementById('tags-video-title');

    let videoTags = {};
    let currentTaggingVideo = null;

    const settingsModal = document.getElementById('settings-modal');
    const saveSettingsBtn = document.getElementById('save-settings');
    const closeSettingsBtn = document.getElementById('close-settings');
    const configStartMuted = document.getElementById('config-start-muted');
    const clearAllTagsBtn = document.getElementById('clear-all-tags-btn');
    const sortSelect = document.getElementById('sort-select');
    let hlsInstance = null;

    let settings = {
        mediaPath: '',
        startMuted: true,
        sortBy: 'name-asc'
    };

    const DbManager = {
        dbName: 'DeskioVideoDB',
        dbVersion: 1,
        db: null,

        async init() {
            return new Promise((resolve, reject) => {
                const request = indexedDB.open(this.dbName, this.dbVersion);
                request.onerror = (e) => reject(e);
                request.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains('thumbnails')) {
                        db.createObjectStore('thumbnails', { keyPath: 'url' });
                    }
                };
                request.onsuccess = (e) => {
                    this.db = e.target.result;
                    resolve(this.db);
                };
            });
        },

        async get(storeName, key) {
            if (!this.db) return null;
            return new Promise((resolve) => {
                const tx = this.db.transaction([storeName], 'readonly');
                const store = tx.objectStore(storeName);
                const request = store.get(key);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => resolve(null);
            });
        },

        async put(storeName, data) {
            if (!this.db) return false;
            return new Promise((resolve) => {
                const tx = this.db.transaction([storeName], 'readwrite');
                const store = tx.objectStore(storeName);
                const request = store.put(data);
                request.onsuccess = () => resolve(true);
                request.onerror = () => resolve(false);
            });
        },

        async delete(storeName, key) {
            if (!this.db) return false;
            return new Promise((resolve) => {
                const tx = this.db.transaction([storeName], 'readwrite');
                const store = tx.objectStore(storeName);
                const request = store.delete(key);
                request.onsuccess = () => resolve(true);
                request.onerror = () => resolve(false);
            });
        },

        async migrate(storeName, oldKey, newKey) {
            const existing = await this.get(storeName, oldKey);
            if (!existing) return;
            existing.url = newKey;
            await this.put(storeName, existing);
            await this.delete(storeName, oldKey);
        }
    };

    function showNotification(message, type = 'info', sticky = false) {
        let container = document.getElementById('notification-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'notification-container';
            document.body.appendChild(container);
        }

        const notification = document.createElement('div');
        notification.className = `notification ${type} ${sticky ? 'sticky' : ''}`;
        const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
        notification.innerHTML = `
            <div style="display:flex; align-items:center; gap:10px;">
                <span>${icon}</span>
                <span style="flex:1;">${message}</span>
                ${sticky ? '<button class="close-notification" style="background:transparent;border:none;color:inherit;cursor:pointer;font-size:1.2rem;">&times;</button>' : ''}
            </div>
        `;

        container.appendChild(notification);
        setTimeout(() => notification.classList.add('active'), 10);

        if (sticky) {
            const closeBtn = notification.querySelector('.close-notification');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => {
                    notification.classList.remove('active');
                    setTimeout(() => notification.remove(), 400);
                });
            }
            // Auto-descartar sticky toasts a los 6 segundos en la extensión
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.classList.remove('active');
                    setTimeout(() => notification.remove(), 400);
                }
            }, 6000);
        } else {
            setTimeout(() => {
                notification.classList.remove('active');
                setTimeout(() => notification.remove(), 400);
            }, 3500);
        }
    }

    function setVideoSource(url) {
        if (hlsInstance) {
            hlsInstance.destroy();
            hlsInstance = null;
        }

        if (url && url.includes('.m3u8')) {
            if (window.Hls && Hls.isSupported()) {
                hlsInstance = new Hls();
                hlsInstance.loadSource(url);
                hlsInstance.attachMedia(mainPlayer);
            } else if (mainPlayer.canPlayType('application/vnd.apple.mpegurl')) {
                mainPlayer.src = url;
            }
        } else {
            mainPlayer.src = url;
        }
    }

    function setStartupVideo() {
        mainPlayer.src = '';
        currentVideoTitle.textContent = 'Ningún video seleccionado';
        currentFolderName.textContent = 'Pantalla principal';
    }

    let currentVideos = [];
    let currentIndex = -1;
    let videoToDelete = null;
    let folderPathToDelete = null;
    let isDeletingAllTags = false;
    let playlistTimeout = null;
    let isFirstPlayStarted = false;
    let playRequestId = 0; // generación de la petición de reproducción en curso
    const playbackHistory = new Map();

    // ═══════════ Identidad de una etiqueta ═══════════
    // La clave es la RUTA RELATIVA del archivo (p.ej. "Alfa/mm/video.mp4").
    // Antes se usaba video.url, que es una blob: URL regenerada en cada escaneo:
    // por eso las etiquetas "desaparecían" al recargar. La ruta es estable entre
    // sesiones y es el mismo dato que maneja la galería, así ambas comparten
    // almacenamiento. Al mover o renombrar un archivo hay que migrar la clave.
    function getTagKey(video) {
        if (!video) return '';
        if (video.path) return String(video.path).replace(/^\.\//, '');
        return video.name || '';
    }

    function folderOfKey(key) {
        const parts = String(key).split('/');
        parts.pop();
        return parts.join('/') || '.';
    }

    // Convierte etiquetas guardadas con los formatos antiguos al formato por ruta
    function migrateTags(raw) {
        const out = {};
        let changed = false;

        Object.entries(raw || {}).forEach(([key, val]) => {
            if (!val || !Array.isArray(val.tags) || val.tags.length === 0) return;

            let path = null;
            if (key.startsWith('blob:')) {
                // Formato antiguo del reproductor: clave efímera, se reconstruye
                // la ruta con los datos que se guardaron junto a la etiqueta.
                const name = val.data && val.data.name;
                const folder = val.lastKnownFolder;
                if (name) {
                    const usable = folder && folder !== '.' && !folder.startsWith('🏷') && !folder.startsWith('☁');
                    path = usable ? `${folder}/${name}` : name;
                }
                changed = true;
            } else if (key.includes('|')) {
                // Formato de la galería: "ruta|tamaño|fecha"
                path = key.split('|')[0];
                changed = true;
            } else {
                path = key;
            }

            if (!path) { changed = true; return; }
            path = path.replace(/^\.\//, '');

            if (!out[path]) out[path] = { tags: [], name: path.split('/').pop() };
            val.tags.forEach(t => {
                if (!out[path].tags.includes(t)) out[path].tags.push(t);
            });
        });

        return { tags: out, changed };
    }

    async function loadTags() {
        try {
            const raw = JSON.parse(await py.get_video_tags()) || {};
            const { tags, changed } = migrateTags(raw);
            videoTags = tags;
            // Persistir la migración para no repetirla en cada arranque
            if (changed) await py.save_video_tags(JSON.stringify(videoTags));
        } catch(e) {
            console.warn('Error al cargar etiquetas:', e);
            videoTags = {};
        }
        renderTagsList();
    }

    async function loadSettings() {
        try {
            const rawStartMuted = await py.get_config('videoStartMuted');
            const serverSettings = {
                mediaPath: await py.get_media_path(),
                sortBy: await py.get_config('videoSortBy')
            };
            if (rawStartMuted !== '') {
                serverSettings.startMuted = rawStartMuted === '1';
            }
            settings = { ...settings, ...serverSettings };
        } catch (e) {
            console.error("Error loading settings:", e);
        }

        const label = document.getElementById('config-selected-name');
        if (label && localState.rootHandle) {
            label.textContent = localState.rootHandle.name;
            label.style.display = 'block';
        }
        configStartMuted.checked = settings.startMuted;
        sortSelect.value = settings.sortBy || 'name-asc';

        await fetchFolders();
    }

    async function saveAppSettings(s) {
        try {
            await py.set_config('videoSortBy', s.sortBy || 'name-asc');
            await py.set_config('videoStartMuted', s.startMuted ? '1' : '0');
        } catch (err) {
            console.error('Error saving app settings:', err);
        }
    }

    settingsBtn.addEventListener('click', () => {
        settingsModal.style.display = 'flex';
    });

    closeSettingsBtn.addEventListener('click', () => {
        settingsModal.style.display = 'none';
    });

    saveSettingsBtn.addEventListener('click', async () => {
        settings.startMuted = configStartMuted.checked;
        await saveAppSettings(settings);

        localStorage.setItem('videoStreamSettings', JSON.stringify(settings));

        await loadTags();
        resetPlayer();
        settingsModal.style.display = 'none';
        showNotification('Configuración guardada', 'success', true);
        await fetchFolders();
    });

    function resetPlayer() {
        mainPlayer.pause();
        setStartupVideo();
        currentIndex = -1;
        currentVideos = [];
        videoList.innerHTML = '<div class="info-text">Selecciona una carpeta para ver videos</div>';
    }

    async function fetchFolders() {
        try {
            const folders = JSON.parse(await py.get_video_folders());
            if (Array.isArray(folders)) {
                renderFolders(folders);
            } else {
                renderFolders([]);
            }
        } catch (err) {
            showNotification('Error al cargar carpetas', 'error');
        }
    }

    const newTagInputEl = document.getElementById('new-tag-input');
    if (newTagInputEl) {
        newTagInputEl.addEventListener('paste', (e) => e.stopPropagation());
        newTagInputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const btn = document.getElementById('add-tag-btn');
                if (btn) btn.click();
            }
        });
    }

    function renderFolders(nodes, container = folderList) {
        if (container === folderList) container.innerHTML = '';

        if (nodes.length === 0 && container === folderList) {
            container.innerHTML = '<li class="info-text">No se encontraron carpetas</li>';
            return;
        }

        nodes.forEach(node => {
            const li = document.createElement('li');
            const hasChildren = node.children && node.children.length > 0;

            li.innerHTML = `
                <div class="folder-item" data-path="${node.path}">
                    <div class="folder-header">
                        <span class="toggle-icon">${hasChildren ? '▶' : ''}</span>
                        <span class="icon">📁</span>
                        <span class="name">${node.name}</span>
                    </div>
                    <div class="folder-actions">
                        <button class="add-subfolder-btn" title="Nueva Subcarpeta">➕</button>
                        <button class="delete-folder-btn" title="Eliminar Carpeta">🗑️</button>
                    </div>
                </div>
                ${hasChildren ? '<ul class="sub-folders"></ul>' : ''}
            `;

            container.appendChild(li);

            const item = li.querySelector('.folder-item');
            const header = li.querySelector('.folder-header');
            const toggle = li.querySelector('.toggle-icon');
            const subList = li.querySelector('.sub-folders');
            const addSubBtn = li.querySelector('.add-subfolder-btn');
            const delBtn = li.querySelector('.delete-folder-btn');
            const nameSpan = li.querySelector('.name');

            header.addEventListener('click', (e) => {
                e.stopPropagation();
                selectFolder(node.path, item);
                if (hasChildren) {
                    subList.classList.toggle('active');
                    toggle.classList.toggle('expanded');
                }
            });

            nameSpan.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                enableFolderRename(nameSpan, node.path);
            });

            addSubBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                handleCreateFolder(node.path);
            });

            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openFolderDeleteModal(node.path, node.name);
            });

            if (hasChildren) {
                renderFolders(node.children, subList);
            }

            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                item.classList.add('drag-over');
            });

            item.addEventListener('dragleave', () => {
                item.classList.remove('drag-over');
            });

            item.addEventListener('drop', async (e) => {
                e.preventDefault();
                item.classList.remove('drag-over');

                const raw = e.dataTransfer.getData('text/plain');
                if (!raw) return;

                // Los arrastres ajenos a la app (una imagen, texto suelto, un archivo
                // del sistema) no traen nuestro JSON: se ignoran en silencio.
                let data;
                try {
                    data = JSON.parse(raw);
                } catch (_err) {
                    return;
                }
                if (!data || typeof data.filename !== 'string' || typeof data.fromFolder !== 'string') {
                    return;
                }

                const toFolder = node.path;
                if (data.fromFolder === toFolder) {
                    showNotification('El video ya está en esta carpeta', 'info');
                    return;
                }

                try {
                    if (data.source === 'gallery') {
                        await moveVideoFromGallery(data.filename, data.fromFolder, toFolder);
                    } else {
                        await moveVideo(data.filename, data.fromFolder, toFolder);
                    }
                } catch (err) {
                    console.error('Error al procesar el drop:', err);
                    showNotification('Error al mover el archivo', 'error');
                }
            });
        });
    }

    // Movimiento originado en el panel de galería: no toca la lista de
    // reproducción actual, solo mueve el archivo y refresca árbol y galería.
    // Al cambiar la ruta de un archivo hay que mover también su etiqueta,
    // porque la ruta ES la clave. Sin esto la etiqueta quedaría huérfana.
    async function reassignTagKey(oldPath, newPath) {
        const from = String(oldPath).replace(/^\.\//, '');
        const to = String(newPath).replace(/^\.\//, '');
        if (from === to || !videoTags[from]) return;

        const entry = videoTags[from];
        delete videoTags[from];

        if (videoTags[to]) {
            // Ya existía una entrada en el destino: se fusionan las etiquetas
            entry.tags.forEach(t => {
                if (!videoTags[to].tags.includes(t)) videoTags[to].tags.push(t);
            });
        } else {
            entry.name = to.split('/').pop();
            videoTags[to] = entry;
        }

        await py.save_video_tags(JSON.stringify(videoTags));
    }

    function joinPath(folder, filename) {
        return (!folder || folder === '.') ? filename : `${folder}/${filename}`;
    }

    async function moveVideoFromGallery(filename, fromFolder, toFolder) {
        const success = await py.move_video(filename, fromFolder, toFolder);
        if (!success) {
            showNotification('Error al mover el archivo', 'error');
            return;
        }

        await reassignTagKey(joinPath(fromFolder, filename), joinPath(toFolder, filename));

        showNotification(`"${filename}" movido a ${toFolder === '.' ? 'Raíz' : toFolder}`, 'success', true);

        try {
            await loadTags();
        } catch (tagErr) {
            console.warn('[TAGS] Error al recargar etiquetas tras mover:', tagErr);
        }

        await fetchFolders();

        if (typeof window.galleryRefresh === 'function') {
            await window.galleryRefresh();
        }
    }

    async function moveVideo(filename, fromFolder, toFolder) {
        const indexMoved = currentVideos.findIndex(v => v.name === filename);
        const isPlayingMoved = (indexMoved !== -1 && indexMoved === currentIndex);
        const nextVideo = (isPlayingMoved && indexMoved + 1 < currentVideos.length) ? currentVideos[indexMoved + 1] : null;
        const currentPlaying = (!isPlayingMoved && currentIndex !== -1) ? currentVideos[currentIndex] : null;

        try {
            const success = await py.move_video(filename, fromFolder, toFolder);
            if (success) {
                try {
                    await reassignTagKey(joinPath(fromFolder, filename), joinPath(toFolder, filename));
                    await loadTags();
                } catch (tagErr) {
                    console.warn('[TAGS] Error al recargar etiquetas tras mover:', tagErr);
                }

                const activeFolderItem = document.querySelector('.folder-item.active');
                if (activeFolderItem) {
                    await selectFolder(fromFolder, activeFolderItem, false);

                    if (isPlayingMoved) {
                        if (nextVideo) {
                            const newIndex = currentVideos.findIndex(v => v.name === nextVideo.name);
                            if (newIndex !== -1) playVideo(newIndex);
                        } else {
                            mainPlayer.pause();
                            mainPlayer.src = '';
                            currentVideoTitle.textContent = 'Ningún video seleccionado';
                        }
                    } else if (currentPlaying) {
                        currentIndex = currentVideos.findIndex(v => v.name === currentPlaying.name);
                        updateActiveState(currentIndex);
                    }
                    showNotification(`Video "${filename}" movido correctamente`, 'success', true);
                }
            } else {
                showNotification('Error al mover el archivo', 'error');
            }
        } catch (e) {
            showNotification('Error de conexión al mover archivo', 'error');
        }
    }

    function isGalleryOpen() {
        const panel = document.getElementById('gallery-panel');
        return !!panel && getComputedStyle(panel).display !== 'none';
    }

    async function selectFolder(path, element, autoPlay = true) {
        if (!element) {
            const possible = document.querySelector(`.folder-item[data-path="${path}"]`);
            if (possible) element = possible;
        }
        if (!element) {
            console.warn(`No se encontró el elemento de carpeta: ${path}`);
            return Promise.reject(new Error(`Carpeta no encontrada: ${path}`));
        }

        // Con la galería abierta no se reproduce nada detrás del panel:
        // el clic en una carpeta sirve para cambiar el alcance de la galería.
        const galleryOpen = isGalleryOpen();
        if (galleryOpen) autoPlay = false;

        document.querySelectorAll('.folder-item').forEach(el => el.classList.remove('active'));
        element.classList.add('active');
        currentFolderName.textContent = path;
        videoList.innerHTML = '';

        try {
            currentVideos = JSON.parse(await py.get_videos(path));
            currentIndex = -1;

            sortVideos(settings.sortBy, false);

            if (autoPlay && currentVideos.length > 0) playVideo(0);

            if (galleryOpen && typeof window.galleryRefresh === 'function') {
                // Re-escanea la galería con la nueva carpeta como alcance
                window.galleryRefresh();
            } else {
                showNotification(`Carpeta "${path}" cargada`, 'success');
                showPlaylistTemporarily();
            }
            return Promise.resolve();
        } catch (err) {
            console.error('Error al cargar videos:', err);
            showNotification('Error al cargar los videos: ' + err.message, 'error');
            return Promise.reject(err);
        }
    }

    function startPlaylistAutoClose() {
        clearTimeout(playlistTimeout);
        playlistTimeout = setTimeout(() => {
            playlistSidebar.classList.remove('active');
        }, 3000);
    }

    function cancelPlaylistAutoClose() {
        clearTimeout(playlistTimeout);
        playlistTimeout = null;
    }

    function showPlaylistTemporarily() {
        playlistSidebar.classList.add('active');
        startPlaylistAutoClose();
    }

    function renderVideos(videos) {
        const playlistCount = document.getElementById('playlist-count');
        if (playlistCount) playlistCount.textContent = videos.length;

        if (videos.length === 0) {
            videoList.innerHTML = `
                <div class="empty-state">
                    <span class="empty-icon">🎞️</span>
                    <p>Esta carpeta está vacía</p>
                    <small>No se encontraron videos compatibles</small>
                </div>
            `;
            return;
        }

        videoList.innerHTML = videos.map((video, index) => {
            const cachedThumb = window.vpThumbnails && window.vpThumbnails.cached(video);
            const thumbContent = cachedThumb ? `<img src="${cachedThumb}" class="real-thumb" draggable="false">` : '🎬';
            const videoId = getTagKey(video);
            const hasTags = !!(videoTags[videoId] && videoTags[videoId].tags && videoTags[videoId].tags.length);
            const tagChips = hasTags
                ? `<div class="video-tag-chips">${videoTags[videoId].tags.map(t => `<span class="video-tag-chip">${t}</span>`).join('')}</div>`
                : '';

            const isActive = index === currentIndex;

            let sizeInfo = '';
            if (typeof video.size === 'number' && !isNaN(video.size)) {
                let sizeStr = '';
                if (video.size >= 1024 * 1024 * 1024) {
                    sizeStr = (video.size / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
                } else if (video.size >= 1024 * 1024) {
                    sizeStr = (video.size / (1024 * 1024)).toFixed(2) + ' MB';
                } else if (video.size >= 1024) {
                    sizeStr = (video.size / 1024).toFixed(2) + ' KB';
                } else {
                    sizeStr = video.size + ' B';
                }
                sizeInfo = `<div class="video-size" style="font-size:0.85em; color:var(--text-secondary); margin-top:2px;">${sizeStr}</div>`;
            }

            return `
                <div class="video-card ${isActive ? 'active' : ''}" data-index="${index}" draggable="true">
                    <div class="video-thumbnail-container">
                        <div class="video-thumbnail" id="thumb-${index}">${thumbContent}</div>
                    </div>
                    <div class="video-details">
                        <span class="video-name" title="Doble clic para renombrar">${video.name}</span>
                        ${sizeInfo}
                        ${tagChips}
                    </div>
                    <button class="tag-btn ${hasTags ? 'active' : ''}" data-index="${index}" title="Etiquetas">🏷️</button>
                    <button class="delete-btn" data-index="${index}">🗑️</button>
                </div>
            `;
        }).join('');

        if (isFirstPlayStarted) {
            startThumbnailQueue(videos);
        }

        document.querySelectorAll('.video-card').forEach(card => {
            card.addEventListener('dragstart', (e) => {
                const index = card.dataset.index;
                const video = currentVideos[index];

                const folderName = currentFolderName.textContent;
                const isTagView = folderName.startsWith('🏷️');
                let realFolder = folderName;
                if (isTagView) {
                    realFolder = folderOfKey(getTagKey(video));
                }

                e.dataTransfer.setData('text/plain', JSON.stringify({
                    filename: video.name,
                    fromFolder: realFolder
                }));

                card.classList.add('dragging');
                const ghost = card.cloneNode(true);
                ghost.style.width = '200px';
                ghost.style.position = 'absolute';
                ghost.style.top = '-1000px';
                document.body.appendChild(ghost);
                e.dataTransfer.setDragImage(ghost, 10, 10);
                setTimeout(() => ghost.remove(), 0);
            });

            card.addEventListener('dragend', () => {
                card.classList.remove('dragging');
            });

            card.addEventListener('click', (e) => {
                if (e.target.closest('.delete-btn') || e.target.closest('.rename-input') || e.target.closest('.tag-btn')) return;
                playVideo(parseInt(card.dataset.index));
            });
        });

        document.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                openDeleteModal(parseInt(btn.dataset.index));
            });
        });

        document.querySelectorAll('.tag-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const video = currentVideos[parseInt(btn.dataset.index)];
                openTagsModal(video, currentFolderName.textContent);
            });
        });

        document.querySelectorAll('.video-name').forEach(nameSpan => {
            nameSpan.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                const index = parseInt(nameSpan.closest('.video-card').dataset.index);
                enableRename(nameSpan, index);
            });
        });
    }

    function enableRename(span, index) {
        const originalName = span.textContent;
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'rename-input';
        input.value = originalName;

        span.parentNode.replaceChild(input, span);
        input.focus();
        input.select();

        let isDone = false;
        const finishRename = async () => {
            if (isDone) return;
            isDone = true;

            const newName = input.value.trim();
            if (newName && newName !== originalName) {
                const success = await renameVideoAsync(originalName, newName);
                if (success) {
                    const folder = currentFolderName.textContent;
                    const activeItem = document.querySelector('.folder-item.active');
                    if (activeItem) {
                        selectFolder(folder, activeItem);
                    }
                } else {
                    if (input.parentNode) input.parentNode.replaceChild(span, input);
                }
            } else {
                if (input.parentNode) input.parentNode.replaceChild(span, input);
            }
        };

        input.addEventListener('blur', finishRename);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); finishRename(); }
            if (e.key === 'Escape') { isDone = true; if (input.parentNode) input.parentNode.replaceChild(span, input); }
        });
    }

    async function renameVideoAsync(oldName, newName) {
        const folder = currentFolderName.textContent;

        try {
            const success = await py.rename_video(`${folder}/${oldName}`, newName);
            if (success) {
                // La ruta cambió: la etiqueta debe seguir al archivo
                await reassignTagKey(joinPath(folder, oldName), joinPath(folder, newName));

                showNotification(`Renombrado a "${newName}"`, 'success', true);
                return true;
            } else {
                showNotification('Error al renombrar', 'error');
                return false;
            }
        } catch (e) {
            showNotification('Error de conexión', 'error');
            return false;
        }
    }

    // Miniatura de un elemento de la lista de reproducción. Usa el mismo motor
    // que la galería (window.vpThumbnails): busca un fotograma representativo en
    // vez del segundo 15 fijo, descarta pantallas negras y comparte la caché,
    // que va indexada por ruta+tamaño y por tanto sobrevive a los reinicios.
    async function captureThumbnail(video, index) {
        if (!window.vpThumbnails) return;

        const cached = window.vpThumbnails.cached(video);
        if (cached) {
            updateThumbUI(index, cached);
            return;
        }

        const thumbDiv = document.getElementById(`thumb-${index}`);
        if (!thumbDiv) return;

        const dataUrl = await window.vpThumbnails.generate(video);
        if (dataUrl) updateThumbUI(index, dataUrl);
    }

    let activeQueueTimeout = null;
    let queueIndex = 0;

    function startThumbnailQueue(videos) {
        if (!videos || videos.length === 0) return;

        stopThumbnailQueue();
        queueIndex = 0;

        activeQueueTimeout = setTimeout(() => {
            processNextInQueue(videos);
        }, 2000);
    }

    async function processNextInQueue(videos) {
        if (queueIndex >= videos.length) return;

        // Pintar de inmediato las que ya estén en caché
        while (queueIndex < videos.length) {
            const cached = window.vpThumbnails && window.vpThumbnails.cached(videos[queueIndex]);
            if (!cached) break;
            updateThumbUI(queueIndex, cached);
            queueIndex++;
        }

        if (queueIndex >= videos.length) return;

        await captureThumbnail(videos[queueIndex], queueIndex);
        queueIndex++;

        activeQueueTimeout = setTimeout(() => {
            processNextInQueue(videos);
        }, 1200);
    }

    function updateThumbUI(index, dataUrl) {
        const thumbDiv = document.getElementById(`thumb-${index}`);
        if (thumbDiv) thumbDiv.innerHTML = `<img src="${dataUrl}" class="real-thumb" draggable="false">`;
    }

    function stopThumbnailQueue() {
        if (activeQueueTimeout) clearTimeout(activeQueueTimeout);
        queueIndex = 999999;
    }

    sortSelect.addEventListener('change', () => {
        sortVideos(sortSelect.value);
    });

    function sortVideos(criteria, notify = true) {
        if (currentVideos.length === 0) return;

        settings.sortBy = criteria;
        localStorage.setItem('videoStreamSettings', JSON.stringify(settings));
        saveAppSettings(settings);

        currentVideos.sort((a, b) => {
            switch(criteria) {
                case 'name-asc': return a.name.localeCompare(b.name);
                case 'name-desc': return b.name.localeCompare(a.name);
                case 'date-desc': return new Date(b.mtime) - new Date(a.mtime);
                case 'date-asc': return new Date(a.mtime) - new Date(b.mtime);
                case 'size-desc': return b.size - a.size;
                case 'size-asc': return a.size - b.size;
                default: return a.name.localeCompare(b.name);
            }
        });

        renderVideos(currentVideos);
    }

    function openDeleteModal(index) {
        videoToDelete = index;
        folderPathToDelete = null;
        const video = currentVideos[index];
        const modalTitle = deleteModal.querySelector('h3');
        const modalText = deleteModal.querySelector('p');
        modalTitle.textContent = '¿Eliminar Video?';
        modalText.innerHTML = `Estás a punto de eliminar <strong>"${video.name}"</strong>.<br>Esta acción no se puede deshacer.`;
        deleteModal.classList.add('active');
    }

    function openFolderDeleteModal(path, name) {
        folderPathToDelete = path;
        videoToDelete = null;
        const modalTitle = deleteModal.querySelector('h3');
        const modalText = deleteModal.querySelector('p');
        modalTitle.textContent = '¿Eliminar Carpeta?';
        modalText.innerHTML = `Estás a punto de eliminar la carpeta <strong>"${name}"</strong>.<br><br><span style="color:#ff4757">⚠️ ADVERTENCIA: Se eliminarán todos los videos y subcarpetas.</span>`;
        deleteModal.classList.add('active');
    }

    function closeDeleteModal() {
        deleteModal.classList.remove('active');
        videoToDelete = null;
        folderPathToDelete = null;
        isDeletingAllTags = false;
    }

    cancelDeleteBtn.addEventListener('click', closeDeleteModal);

    confirmDeleteBtn.addEventListener('click', async () => {
        if (videoToDelete !== null) {
            await deleteVideo();
        } else if (folderPathToDelete !== null) {
            await deleteFolderAsync();
        } else if (isDeletingAllTags) {
            await clearAllTagsConfirmed();
        }
    });

    async function deleteVideo() {
        const video = currentVideos[videoToDelete];
        const folderRaw = currentFolderName.textContent;

        const isTagView = folderRaw.startsWith('🏷️');
        const videoId = getTagKey(video);
        const folder = isTagView ? folderOfKey(videoId) : folderRaw;

        const isPlayingDeleted = (videoToDelete === currentIndex);
        const nextVideo = (isPlayingDeleted && videoToDelete + 1 < currentVideos.length) ? currentVideos[videoToDelete + 1] : null;
        const currentPlaying = (!isPlayingDeleted && currentIndex !== -1) ? currentVideos[currentIndex] : null;

        try {
            const relPath = folder === '.' || !folder ? video.name : `${folder}/${video.name}`;
            const success = await py.delete_video(relPath);

            if (success) {
                if (videoTags[videoId]) {
                    delete videoTags[videoId];
                    saveTags();
                }

                if (isTagView) {
                    currentVideos.splice(videoToDelete, 1);
                    renderVideos(currentVideos);
                    if (isPlayingDeleted) {
                        if (currentVideos.length > 0) {
                            const nextIdx = Math.min(videoToDelete, currentVideos.length - 1);
                            playVideo(nextIdx);
                        } else {
                            mainPlayer.pause();
                            mainPlayer.src = '';
                            currentVideoTitle.textContent = 'Ningún video seleccionado';
                        }
                    } else if (currentPlaying) {
                        currentIndex = currentVideos.findIndex(v => getTagKey(v) === getTagKey(currentPlaying));
                        updateActiveState(currentIndex);
                    }
                } else {
                    const activeItem = document.querySelector('.folder-item.active');
                    if (activeItem) {
                        await selectFolder(folder, activeItem, false);

                        if (isPlayingDeleted) {
                            if (nextVideo) {
                                const newIndex = currentVideos.findIndex(v => v.name === nextVideo.name);
                                if (newIndex !== -1) playVideo(newIndex);
                            } else {
                                mainPlayer.pause();
                                mainPlayer.src = '';
                                currentVideoTitle.textContent = 'Ningún video seleccionado';
                            }
                        } else if (currentPlaying) {
                            currentIndex = currentVideos.findIndex(v => v.name === currentPlaying.name);
                            updateActiveState(currentIndex);
                        }
                    }
                }
            } else {
                showNotification('Error al eliminar el archivo', 'error');
            }
        } catch (err) {
            showNotification('Error de conexión', 'error');
        } finally {
            closeDeleteModal();
        }
    }

    async function deleteFolderAsync() {
        if (!folderPathToDelete) return;

        try {
            const success = await py.delete_folder(folderPathToDelete);
            if (success) {
                if (currentFolderName.textContent === folderPathToDelete) {
                    currentVideos = [];
                    renderVideos([]);
                    mainPlayer.pause();
                    mainPlayer.src = '';
                    currentVideoTitle.textContent = 'Ningún video seleccionado';
                }
                fetchFolders();
            } else {
                showNotification('Error al eliminar', 'error');
            }
        } catch (e) {
            showNotification('Error de conexión', 'error');
        } finally {
            closeDeleteModal();
        }
    }

    async function clearAllTagsConfirmed() {
        try {
            // Limpiar todas las etiquetas
            videoTags = {};
            await py.save_video_tags(JSON.stringify(videoTags));
            await loadTags();

            renderTagsList();
            updateVideoQuickActions();
            updatePlayerTagChips();
        } catch (e) {
            showNotification('Error al borrar etiquetas', 'error');
        } finally {
            closeDeleteModal();
        }
    }

    function updateVideoQuickActions() {
        const overlay = document.getElementById('video-quick-actions');
        if (!overlay) return;

        if (currentIndex === -1 || !currentVideos[currentIndex]) {
            overlay.style.display = 'none';
            return;
        }

        const video  = currentVideos[currentIndex];
        const folder = currentFolderName.textContent;
        const videoId = getTagKey(video);
        const hasTags = !!(videoTags[videoId] && videoTags[videoId].tags && videoTags[videoId].tags.length);

        overlay.style.display = 'flex';

        const tagBtn = document.getElementById('vqa-tag');
        const delBtn = document.getElementById('vqa-delete');

        tagBtn.classList.toggle('active', hasTags);

        const newTag = tagBtn.cloneNode(true);
        const newDel = delBtn.cloneNode(true);

        newTag.addEventListener('click', (e) => { e.stopPropagation(); openTagsModal(video, folder); });
        newDel.addEventListener('click', (e) => { e.stopPropagation(); openDeleteModal(currentIndex); });

        tagBtn.replaceWith(newTag);
        delBtn.replaceWith(newDel);
    }

    function playVideo(index) {
        if (index < 0 || index >= currentVideos.length) return;

        // Cualquier reproducción saca del modo galería: da igual si el video se
        // eligió en el panel, en la lista lateral o desde una etiqueta.
        if (isGalleryOpen() && typeof window.galleryClose === 'function') {
            window.galleryClose();
        }

        // Identifica esta petición: si llega otra antes de que ésta termine de
        // arrancar, la anterior debe abandonar en vez de pelear por el <video>.
        const requestId = ++playRequestId;

        const playerLoader = document.getElementById('player-loader');
        if (playerLoader) playerLoader.style.display = 'flex';

        const previousIndex = currentIndex;
        const previousVideo = (previousIndex >= 0 && previousIndex < currentVideos.length)
            ? currentVideos[previousIndex]
            : null;

        currentIndex = index;
        updateActiveState(index);

        setTimeout(async () => {
            // Otra reproducción (o la apertura de la galería) tomó el control
            if (requestId !== playRequestId) {
                if (playerLoader) playerLoader.style.display = 'none';
                return;
            }

            if (previousVideo && !mainPlayer.paused && !previousVideo.type) {
                const time = mainPlayer.currentTime;
                playbackHistory.set(previousVideo.url, time);
                py.save_playback(previousVideo.url, time.toString());
            }

            const video = currentVideos[index];

            const startPlayback = () => {
                mainPlayer.play().then(() => {
                    if (requestId !== playRequestId) return; // superada por otra petición

                    isFirstPlayStarted = true;
                    startThumbnailQueue(currentVideos);

                    const savedTime = playbackHistory.get(video.url) || 0;
                    if (savedTime > 0) {
                        mainPlayer.currentTime = savedTime;
                    } else if (video.url && !video.url.includes('.m3u8')) {
                        mainPlayer.currentTime = Math.min(5, mainPlayer.duration || 5);
                    }
                    mainPlayer.classList.remove('player-fading');
                }).catch(e => {
                    // AbortError: la reproducción fue interrumpida a propósito
                    // (otro video, o pause() al abrir la galería). No es un fallo.
                    // NotAllowedError: autoplay bloqueado por el navegador.
                    const interrupted = e.name === 'AbortError' || e.name === 'NotAllowedError';
                    const superseded = requestId !== playRequestId;

                    if (!interrupted && !superseded) {
                        console.error(`Error al reproducir "${video.name}" (${e.name}): ${e.message}`);
                        showNotification(
                            e.name === 'NotSupportedError'
                                ? `Formato no soportado por el navegador: ${video.name}`
                                : `Error al reproducir el video: ${e.message}`,
                            'error'
                        );
                        mainPlayer.pause();
                    }
                    mainPlayer.classList.remove('player-fading');
                });
            };

            {
                // (bloque conservado tras eliminar la rama de videos incrustados)
                mainPlayer.style.display = 'block';
                mainPlayer.muted = settings.startMuted;
                currentVideoTitle.textContent = formatVideoTitleWithSize(video);
                updatePlayerTagChips(video);

                setVideoSource(video.url);

                const tracks = mainPlayer.querySelectorAll('track');
                tracks.forEach(t => t.remove());
                if (video.subtitle) {
                    const track = document.createElement('track');
                    track.kind = 'subtitles';
                    track.label = 'Español';
                    track.srclang = 'es';
                    track.src = video.subtitle;
                    track.default = true;
                    mainPlayer.appendChild(track);
                }

                stopThumbnailQueue();

                if (hlsInstance) {
                    hlsInstance.once(Hls.Events.MANIFEST_PARSED, () => startPlayback());
                } else {
                    startPlayback();
                }
            }
            if (playerLoader) playerLoader.style.display = 'none';

            videoInfo.classList.add('active');
            setTimeout(() => videoInfo.classList.remove('active'), 3000);

            updateVideoQuickActions();
        }, 500);
    }

    function updateActiveState(index) {
        document.querySelectorAll('.video-card').forEach((el, i) => {
            el.classList.toggle('active', i === index);
        });

        const activeCard = document.querySelector('.video-card.active');
        if (activeCard) {
            activeCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }

    function formatVideoTitleWithSize(video) {
        let name = video.name || '';
        if (typeof video.size === 'number' && !isNaN(video.size)) {
            let size = video.size;
            let sizeStr = '';
            if (size >= 1024 * 1024 * 1024) {
                sizeStr = (size / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
            } else if (size >= 1024 * 1024) {
                sizeStr = (size / (1024 * 1024)).toFixed(2) + ' MB';
            } else if (size >= 1024) {
                sizeStr = (size / 1024).toFixed(2) + ' KB';
            } else {
                sizeStr = size + ' B';
            }
            return `${name} (${sizeStr})`;
        }
        return name;
    }

    mainPlayer.onended = () => {
        if (currentIndex + 1 < currentVideos.length) {
            setTimeout(() => {
                playVideo(currentIndex + 1);
            }, 1000);
        }
    };

    const addRootFolderBtn = document.getElementById('add-root-folder-btn');
    addRootFolderBtn.addEventListener('click', (e) => {
        e.preventDefault();
        handleCreateFolder('');
    });

    async function handleCreateFolder(parentPath) {
        let container;

        if (parentPath === '' || parentPath === '.') {
            container = folderList;
        } else {
            const parentItem = document.querySelector(`.folder-item[data-path="${parentPath}"]`);
            if (!parentItem) return;

            let subList = parentItem.nextElementSibling;
            if (!subList || !subList.classList.contains('sub-folders')) {
                subList = document.createElement('ul');
                subList.className = 'sub-folders active';
                parentItem.parentNode.appendChild(subList);
                const toggle = parentItem.querySelector('.toggle-icon');
                if (toggle) {
                    toggle.textContent = '▼';
                    toggle.classList.add('expanded');
                }
            } else {
                subList.classList.add('active');
            }
            container = subList;
        }

        const li = document.createElement('li');
        li.innerHTML = `
            <div class="folder-item editing">
                <div class="folder-header">
                    <span class="icon">📁</span>
                    <input type="text" class="rename-input" id="temp-folder-input" value="Nueva Carpeta">
                </div>
            </div>
        `;

        container.prepend(li);
        const input = li.querySelector('#temp-folder-input');
        input.focus();
        input.select();

        let finished = false;
        const finish = async () => {
            if (finished) return;
            finished = true;
            const folderName = input.value.trim();
            if (folderName) {
                try {
                    const success = await py.create_folder(parentPath || '.', folderName);
                    if (success) {
                        showNotification(`Carpeta "${folderName}" creada`, 'success', true);
                    } else {
                        showNotification('Error al crear', 'error');
                    }
                } catch (e) { showNotification('Error al crear', 'error'); }
            }
            fetchFolders();
        };

        input.addEventListener('blur', () => {
            setTimeout(finish, 100);
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') finish();
            if (e.key === 'Escape') fetchFolders();
        });
    }

    prevBtn.addEventListener('click', () => {
        if (currentIndex > 0) {
            playVideo(currentIndex - 1);
        } else {
            showNotification('Primer video alcanzado', 'info');
        }
    });

    nextBtn.addEventListener('click', () => {
        if (currentIndex + 1 < currentVideos.length) {
            playVideo(currentIndex + 1);
        } else {
            showNotification('Último video alcanzado', 'info');
        }
    });

    toggleSidebarBtn.addEventListener('click', () => {
        if (window.innerWidth <= 768) {
            sidebar.classList.toggle('active');
        } else {
            appContainer.classList.toggle('sidebar-collapsed');
        }
    });

    playlistBtn.addEventListener('click', () => {
        const wasActive = playlistSidebar.classList.contains('active');
        playlistSidebar.classList.toggle('active');
        if (!wasActive) {
            startPlaylistAutoClose();
        } else {
            cancelPlaylistAutoClose();
        }
    });

    document.addEventListener('click', (e) => {
        if (!playlistSidebar.classList.contains('active')) return;
        if (playlistSidebar.contains(e.target)) return;
        if (e.target === playlistBtn || playlistBtn.contains(e.target)) return;
        playlistSidebar.classList.remove('active');
    });

    if (resetPlayerBtn) {
        resetPlayerBtn.addEventListener('click', () => {
            resetPlayer();
        });
    }

    playlistSidebar.addEventListener('mouseenter', cancelPlaylistAutoClose);
    playlistSidebar.addEventListener('mouseleave', () => {
        if (playlistSidebar.classList.contains('active')) {
            startPlaylistAutoClose();
        }
    });

    toggleUiBtn.addEventListener('click', () => {
        const isCinemaMode = document.body.classList.toggle('ui-collapsed');
        const docElm = document.documentElement;

        if (isCinemaMode) {
            if (appContainer) appContainer.classList.add('sidebar-collapsed');

            try {
                if (docElm.requestFullscreen) docElm.requestFullscreen();
                else if (docElm.mozRequestFullScreen) docElm.mozRequestFullScreen();
                else if (docElm.webkitRequestFullscreen) docElm.webkitRequestFullscreen();
                else if (docElm.msRequestFullscreen) docElm.msRequestFullscreen();
            } catch (e) {
                console.warn("Fullscreen denegado");
            }
        } else {
            if (appContainer) appContainer.classList.remove('sidebar-collapsed');

            try {
                if (document.exitFullscreen) document.exitFullscreen();
                else if (document.mozCancelFullScreen) document.mozCancelFullScreen();
                else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
                else if (document.msExitFullscreen) document.msExitFullscreen();
            } catch (e) {
                console.warn("Error al salir de Fullscreen");
            }
        }

        toggleUiBtn.innerHTML = isCinemaMode
            ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>'
            : '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>';
    });

    const syncFullscreenState = () => {
        const isFullscreen = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;

        if (!isFullscreen && document.body.classList.contains('ui-collapsed')) {
            document.body.classList.remove('ui-collapsed');
            if (appContainer) appContainer.classList.remove('sidebar-collapsed');
            toggleUiBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>';
        }
    };

    document.addEventListener('fullscreenchange', syncFullscreenState);

    function openTagsModal(video, folder) {
        currentTaggingVideo = video;
        const videoId = getTagKey(video);

        tagsVideoTitle.textContent = video.name;

        if (!videoTags[videoId]) {
            videoTags[videoId] = { tags: [], name: video.name };
        }

        renderTagsModal();
        tagsModal.classList.add('active');
    }

    function closeTagsModal() {
        tagsModal.classList.remove('active');
        currentTaggingVideo = null;
        renderVideos(currentVideos);
    }

    closeTagsModalBtn.addEventListener('click', closeTagsModal);
    doneTagsModalBtn.addEventListener('click', closeTagsModal);

    function renderTagsModal() {
        if (!currentTaggingVideo) return;
        const videoId = getTagKey(currentTaggingVideo);
        const currentTags = (videoTags[videoId] && videoTags[videoId].tags) ? videoTags[videoId].tags : [];

        currentVideoTagsDiv.innerHTML = currentTags.map(tag => `
            <div class="tag-chip active">
                ${tag} <span class="remove-tag" data-tag="${tag}">×</span>
            </div>
        `).join('');

        currentVideoTagsDiv.querySelectorAll('.remove-tag').forEach(span => {
            span.addEventListener('click', (e) => {
                e.stopPropagation();
                const btn = e.currentTarget;
                const tag = btn.dataset.tag;
                videoTags[videoId].tags = videoTags[videoId].tags.filter(t => t !== tag);
                saveTags();
                renderTagsModal();
            });
        });

        const allTagsSet = new Set();
        Object.values(videoTags).forEach(v => {
            if(v.tags) v.tags.forEach(t => allTagsSet.add(t));
        });

        const allTags = Array.from(allTagsSet).filter(t => !currentTags.includes(t)).sort();

        allAvailableTagsDiv.innerHTML = allTags.map(tag => `
            <div class="tag-chip add-existing-tag" data-tag="${tag}">
                ${tag} +
            </div>
        `).join('');

        if (allTags.length === 0) {
            allAvailableTagsDiv.innerHTML = '<span style="color:var(--text-secondary); font-size:0.8rem;">No hay otras etiquetas.</span>';
        }

        allAvailableTagsDiv.querySelectorAll('.add-existing-tag').forEach(chip => {
            chip.addEventListener('click', (e) => {
                const tag = e.currentTarget.dataset.tag;
                videoTags[videoId].tags.push(tag);
                saveTags();
                renderTagsModal();
            });
        });
    }

    addTagBtn.addEventListener('click', () => {
        const newTag = newTagInput.value.trim().toLowerCase();
        if (!newTag || !currentTaggingVideo) return;

        const videoId = getTagKey(currentTaggingVideo);
        if (!videoTags[videoId].tags.includes(newTag)) {
            videoTags[videoId].tags.push(newTag);
            saveTags();
            renderTagsModal();
        }
        newTagInput.value = '';
    });

    function updatePlayerTagChips(video) {
        const container = document.getElementById('current-player-tags');
        if (!container) return;
        const vid = video || (currentIndex !== -1 ? currentVideos[currentIndex] : null);
        if (!vid) { container.innerHTML = ''; return; }
        const videoId = getTagKey(vid);
        const tags = (videoTags[videoId] && videoTags[videoId].tags) || [];
        container.innerHTML = '';
        tags.forEach(t => {
            const chip = document.createElement('span');
            chip.className = 'player-tag-chip';
            chip.innerHTML = `${t}<button class="player-tag-remove" title="Quitar etiqueta">×</button>`;
            chip.addEventListener('click', (e) => {
                if (!e.target.classList.contains('player-tag-remove')) {
                    playVideosByTag(t);
                }
            });
            chip.querySelector('.player-tag-remove').addEventListener('click', (e) => {
                e.stopPropagation();
                if (videoTags[videoId]) {
                    videoTags[videoId].tags = videoTags[videoId].tags.filter(tag => tag !== t);
                    saveTags();
                }
            });
            container.appendChild(chip);
        });
    }

    async function saveTags() {
        // Descartar entradas que se quedaron sin etiquetas (al quitar la última
        // de un video, o al borrar una etiqueta de forma global). Sin esto el
        // almacenamiento acumularía entradas vacías indefinidamente.
        Object.keys(videoTags).forEach(key => {
            const entry = videoTags[key];
            if (!entry || !Array.isArray(entry.tags) || entry.tags.length === 0) {
                delete videoTags[key];
            }
        });

        // La escritura va al archivo de la carpeta raíz; se espera para que un
        // fallo (carpeta sin permiso de escritura) se notifique de verdad.
        await py.save_video_tags(JSON.stringify(videoTags));

        renderTagsList();
        updateVideoQuickActions();
        updatePlayerTagChips();
    }

    // API de etiquetas compartida con gallery.js: el reproductor es la única
    // fuente de verdad y quien persiste en el archivo de la carpeta.
    window.vpTags = {
        all: () => JSON.parse(JSON.stringify(videoTags)),
        replace: async (tags) => {
            videoTags = (tags && typeof tags === 'object') ? tags : {};
            await saveTags();
            if (currentVideos.length > 0) renderVideos(currentVideos);
        }
    };

    function renderTagsList() {
        if (!tagsList) return;

        const tagCounts = {};
        Object.values(videoTags).forEach(v => {
            if(v.tags) v.tags.forEach(t => tagCounts[t] = (tagCounts[t] || 0) + 1);
        });

        const uniqueTags = Object.keys(tagCounts).sort();

        if (uniqueTags.length === 0) {
            tagsList.innerHTML = '<li class="info-text" style="font-size:0.8rem; opacity:0.5; text-align:center; margin-top:10px;">Aún no hay etiquetas</li>';
            return;
        }

        tagsList.innerHTML = uniqueTags.map(tag => `
            <li class="tag-chip tag-nav-item" data-tag="${tag}" style="display:flex; align-items:center; gap:4px;">
                <span class="tag-nav-label" style="flex:1; cursor:pointer;">${tag} <span style="opacity:0.6; font-size:0.7rem;">(${tagCounts[tag]})</span></span>
                <button class="tag-nav-delete" data-tag="${tag}" title="Eliminar etiqueta" style="background:transparent; border:none; cursor:pointer; color:var(--danger,#e05); font-size:0.85rem; line-height:1; padding:0 2px; opacity:0.7; flex-shrink:0;">✕</button>
            </li>
        `).join('');

        tagsList.querySelectorAll('.tag-nav-item').forEach(item => {
            item.querySelector('.tag-nav-label').addEventListener('click', () => {
                const tag = item.dataset.tag;
                playVideosByTag(tag);
            });

            item.querySelector('.tag-nav-delete').addEventListener('click', (e) => {
                e.stopPropagation();
                const tag = item.dataset.tag;
                Object.values(videoTags).forEach(v => {
                    if (v.tags) v.tags = v.tags.filter(t => t !== tag);
                });
                saveTags();
                renderTagsList();
                showNotification(`Etiqueta "${tag}" eliminada`, 'info');
            });
        });
    }

    if (clearAllTagsBtn) {
        clearAllTagsBtn.addEventListener('click', () => {
            isDeletingAllTags = true;
            videoToDelete = null;
            folderPathToDelete = null;

            const modalTitle = deleteModal.querySelector('h3');
            const modalText = deleteModal.querySelector('p');
            const activeLibraryPath = (settings.mediaPath || '').trim();
            modalTitle.textContent = '¿Borrar Todas las Etiquetas?';
            modalText.innerHTML = `Esta acción eliminará las etiquetas de la biblioteca actual.<br><br><span style="opacity:0.8; font-size:0.86rem;">Ruta: <strong>${activeLibraryPath || '(sin ruta configurada)'}</strong></span>`;

            deleteModal.classList.add('active');
        });
    }

    async function playVideosByTag(tag) {
        // Las claves de videoTags ya son rutas relativas, así que basta con
        // filtrarlas y resolverlas todas de una vez (una sola llamada evita que
        // se revoquen las URLs de una carpeta al cargar la siguiente).
        const paths = Object.entries(videoTags)
            .filter(([, val]) => Array.isArray(val.tags) && val.tags.includes(tag))
            .map(([path]) => path);

        if (paths.length === 0) {
            showNotification('No hay videos con esta etiqueta', 'info');
            return;
        }

        let list = [];
        try {
            list = JSON.parse(await py.get_videos_by_paths(JSON.stringify(paths)));
        } catch (e) {
            console.error('Error al resolver videos de la etiqueta:', e);
            showNotification('Error al cargar los videos de la etiqueta', 'error');
            return;
        }

        if (list.length === 0) {
            showNotification(`Los archivos con la etiqueta "${tag}" ya no existen`, 'error');
            return;
        }

        currentVideos = list;
        currentIndex = -1;
        currentFolderName.textContent = `🏷️ Etiqueta: ${tag}`;
        document.querySelectorAll('.folder-item').forEach(el => el.classList.remove('active'));
        renderVideos(currentVideos);
        playVideo(0);

        const faltan = paths.length - list.length;
        showNotification(
            faltan > 0
                ? `Etiqueta "${tag}": ${list.length} videos (${faltan} no encontrados)`
                : `Reproduciendo etiqueta: ${tag} (${list.length} videos)`,
            faltan > 0 ? 'info' : 'success'
        );
    }

    function enableFolderRename(span, oldPath) {
        const originalName = span.textContent;
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'rename-input folder-rename';
        input.value = originalName;

        span.parentNode.replaceChild(input, span);
        input.focus();
        input.select();

        let isDone = false;
        const finishRename = async () => {
            if (isDone) return;
            isDone = true;

            const newName = input.value.trim();
            if (newName && newName !== originalName) {
                const success = await renameFolderAsync(oldPath, newName);
                if (success) {
                    fetchFolders();
                } else {
                    if (input.parentNode) input.parentNode.replaceChild(span, input);
                }
            } else {
                if (input.parentNode) input.parentNode.replaceChild(span, input);
            }
        };

        input.addEventListener('blur', finishRename);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); finishRename(); }
            if (e.key === 'Escape') { isDone = true; if (input.parentNode) input.parentNode.replaceChild(span, input); }
        });
    }

    async function renameFolderAsync(oldPath, newName) {
        try {
            const success = await py.rename_folder(oldPath, newName);
            if (success) {
                showNotification(`Carpeta renombrada a "${newName}"`, 'success', true);
                return true;
            } else {
                showNotification('Error al renombrar carpeta', 'error');
                return false;
            }
        } catch (e) {
            showNotification('Error de conexión', 'error');
            return false;
        }
    }

    const playerLoader = document.getElementById('player-loader');
    if (playerLoader) {
        const hideLoader = () => playerLoader.style.display = 'none';
        mainPlayer.addEventListener('loadeddata', hideLoader);
        mainPlayer.addEventListener('playing', hideLoader);
        mainPlayer.addEventListener('error', () => {
            hideLoader();
            if (currentIndex !== -1 && currentVideos[currentIndex]) {
                showNotification('Error al reproducir el video', 'error');
                mainPlayer.pause();
            }
        });
    }

    // Configuración del botón de Exploración/Selección de carpeta (File System API)
    document.getElementById('config-select-dir-btn').addEventListener('click', async () => {
        try {
            const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
            if (handle) {
                localState.rootHandle = handle;
                await saveHandle('root_directory', handle);

                const label = document.getElementById('config-selected-name');
                if (label) {
                    label.textContent = handle.name;
                    label.style.display = 'block';
                }

                settings.mediaPath = handle.name;
                document.getElementById('vp-permission-banner').style.display = 'none';

                // Cada carpeta raíz lleva su propio archivo de etiquetas: se
                // cargan las de esta carpeta (o queda vacío si es nueva).
                await loadTags();
                const numEtiquetas = Object.keys(videoTags).length;
                showNotification(
                    numEtiquetas > 0
                        ? `Carpeta seleccionada · ${numEtiquetas} videos con etiquetas recuperados`
                        : 'Carpeta de videos seleccionada',
                    'success', true
                );
            }
        } catch (err) {
            console.error(err);
            showNotification('No se seleccionó ninguna carpeta', 'error');
        }
    });

    // Conceder permisos de forma interactiva en el banner de la barra lateral
    document.getElementById('vp-grant-permission-btn').addEventListener('click', async () => {
        if (!localState.rootHandle) return;
        try {
            const options = { mode: 'readwrite' };
            const status = await localState.rootHandle.requestPermission(options);
            if (status === 'granted') {
                document.getElementById('vp-permission-banner').style.display = 'none';
                await loadSettings();
                // Hasta ahora no se podía leer el archivo de etiquetas de la carpeta
                await loadTags();
                showNotification('Acceso concedido exitosamente', 'success', true);
            } else {
                showNotification('Permiso denegado', 'error');
            }
        } catch (err) {
            console.error(err);
            showNotification('Error al otorgar permisos', 'error');
        }
    });

    async function checkDirectoryPermissions() {
        if (!localState.rootHandle) return;
        const permission = await localState.rootHandle.queryPermission({ mode: 'readwrite' });
        const banner = document.getElementById('vp-permission-banner');
        if (permission === 'granted') {
            if (banner) banner.style.display = 'none';
            await loadSettings();
        } else {
            if (banner) banner.style.display = 'block';
            if (folderList) {
                folderList.innerHTML = '<li class="info-text" style="padding:20px 14px; font-size:0.8rem; opacity:0.5; text-align:center;">Reactiva los permisos de la carpeta desde el banner lateral.</li>';
            }
        }
    }

    let _videoPlayerBootstrapped = false;
    async function bootstrapVideoPlayer() {
        if (_videoPlayerBootstrapped) return;
        _videoPlayerBootstrapped = true;

        try {
            setStartupVideo();
            await DbManager.init();

            if (typeof window.showDirectoryPicker !== 'function') {
                const banner = document.getElementById('vp-permission-banner');
                if (banner) banner.style.display = 'none';
                if (folderList) {
                    folderList.innerHTML = '<li class="info-text" style="padding:20px 14px; font-size:0.8rem; color:#ff7675; text-align:center; line-height:1.6;">La exploración de archivos locales no es compatible en este navegador/dispositivo (no disponible en iOS).</li>';
                }
                const configBtn = document.getElementById('config-select-dir-btn');
                if (configBtn) {
                    configBtn.disabled = true;
                    configBtn.style.opacity = '0.5';
                    configBtn.style.cursor = 'not-allowed';
                    configBtn.title = 'No compatible con este navegador/dispositivo (ej. iOS)';
                }
                const configLabel = document.getElementById('config-selected-name');
                if (configLabel) {
                    configLabel.textContent = 'Exploración local no compatible (iOS)';
                    configLabel.style.display = 'block';
                    configLabel.style.color = '#ff7675';
                }
            } else {
                // Cargar Handle de Carpeta persistido en IndexedDB
                localState.rootHandle = await loadHandle('root_directory');
                if (localState.rootHandle) {
                    await checkDirectoryPermissions();
                } else {
                    if (folderList) {
                        folderList.innerHTML = '<li class="info-text" style="padding:20px 14px; font-size:0.8rem; opacity:0.4; text-align:center; line-height:1.6;">Configura la carpeta raíz de videos desde el botón ⚙️ superior.</li>';
                    }
                }
            }

            try {
                const playbackMap = JSON.parse(await py.get_playback_history());
                Object.entries(playbackMap || {}).forEach(([url, time]) => playbackHistory.set(url, time));
            } catch (_e) {}

            await loadTags();
            renderTagsList();

            // Modal Acerca de
            const aboutBtn = document.getElementById('videoplayer-about-modal-open-btn');
            const aboutModal = document.getElementById('videoplayer-about-modal');
            const aboutCloseBtn = document.getElementById('videoplayer-about-modal-close-btn');
            const aboutLink = document.getElementById('videoplayer-about-modal-link');

            if (aboutBtn && aboutModal) {
                aboutBtn.addEventListener('click', () => {
                    aboutModal.style.display = 'flex';
                });
            }
            if (aboutModal) {
                aboutModal.addEventListener('click', (e) => {
                    if (e.target === aboutModal) aboutModal.style.display = 'none';
                });
            }
            if (aboutCloseBtn && aboutModal) {
                aboutCloseBtn.addEventListener('click', () => {
                    aboutModal.style.display = 'none';
                });
            }
            if (aboutLink) {
                aboutLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    window.open('https://ext.merke.net', '_blank');
                });
            }
        } catch (e) {
            console.error('Error durante inicializacion de videoplayer:', e);
            showNotification('Error al iniciar VideoPlayer', 'error');
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootstrapVideoPlayer);
    } else {
        bootstrapVideoPlayer();
    }

    // ========== Integración con el Panel de Galería embebido ==========

    // Compartir showNotification con gallery.js
    window.showNotification = showNotification;

    // Compartir el gestor de IndexedDB (caché de miniaturas) con gallery.js
    window.vpDbManager = DbManager;

    // Permite a gallery.js pedir al reproductor que seleccione y reproduzca un video
    window.vpSelectAndPlayVideo = function(folderPath, videoName) {
        // Se cierra la galería antes de cambiar de carpeta: si siguiera abierta,
        // selectFolder dispararía un re-escaneo del panel que vamos a ocultar.
        if (typeof window.galleryClose === 'function') window.galleryClose();

        const folderItem = document.querySelector(`.folder-item[data-path="${folderPath}"]`);
        if (!folderItem) {
            showNotification(`Carpeta no encontrada: ${folderPath}`, 'error');
            return;
        }
        selectFolder(folderPath, folderItem, false)
            .then(() => {
                const videoIndex = currentVideos.findIndex(v => v.name === videoName);
                if (videoIndex !== -1) {
                    playVideo(videoIndex);
                    showNotification(`▶️ Reproduciendo: ${videoName}`, 'success', true);
                } else {
                    showNotification(`No se encontró el video: ${videoName}`, 'error');
                }
            })
            .catch((e) => {
                console.error('Error al seleccionar carpeta desde galería:', e);
                showNotification(`Error: ${e.message}`, 'error');
            });
    };

    // Abrir el panel de galería embebido dentro del área del reproductor
    window.openGallery = function() {
        // Invalida cualquier reproducción en curso o pendiente: sin esto, un
        // playVideo lanzado hace <500 ms cargaría un video detrás del panel, y
        // el pause() de abajo abortaría su play() generando un DOMException.
        playRequestId++;

        // Pausar reproducción actual
        try {
            mainPlayer.pause();
        } catch (_e) { /* no-op */ }

        const panel = document.getElementById('gallery-panel');
        if (panel) panel.style.display = 'block';

        // Oculta flechas de navegación, título flotante y acciones rápidas
        document.body.classList.add('gallery-active');

        if (typeof window.initGalleryPanel === 'function') {
            window.initGalleryPanel();
        } else {
            console.error('gallery.js no está cargado: initGalleryPanel no disponible');
            showNotification('No se pudo abrir la galería', 'error');
        }
    };

    // gallery.js lo invoca al cerrar el panel: devuelve el cromo del reproductor
    window.vpOnGalleryClosed = function() {
        document.body.classList.remove('gallery-active');
    };

    // Event listener para botón de galería (sin onclick inline para CSP compliance)
    const galleryBtn = document.getElementById('open-gallery-btn');
    if (galleryBtn) {
        galleryBtn.addEventListener('click', (e) => {
            e.preventDefault();
            window.openGallery();
        });
    }
})();
