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
        async get_playlists() {
            return localStorage.getItem('videoCloudPlaylists') || '[]';
        },
        async set_playlists(json) {
            localStorage.setItem('videoCloudPlaylists', json);
            return true;
        },
        async resolve_video_url(url) {
            return url;
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
        async get_video_tags_for_path(scopePath) {
            const tags = JSON.parse(localStorage.getItem('videoTags') || '{}');
            return JSON.stringify(tags[scopePath] || []);
        },
        async get_video_tags() {
            const tags = JSON.parse(localStorage.getItem('videoTags') || '{}');
            return JSON.stringify(tags);
        },
        async save_video_tags_for_path(scopePath, jsonTags) {
            const tags = JSON.parse(localStorage.getItem('videoTags') || '{}');
            tags[scopePath] = JSON.parse(jsonTags);
            localStorage.setItem('videoTags', JSON.stringify(tags));
            return true;
        },
        async save_video_tags(jsonTagsAll) {
            localStorage.setItem('videoTags', jsonTagsAll);
            return true;
        },
        async clear_video_tags_for_path(scopePath) {
            const tags = JSON.parse(localStorage.getItem('videoTags') || '{}');
            delete tags[scopePath];
            localStorage.setItem('videoTags', JSON.stringify(tags));
            return true;
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

    // Elementos Cloud
    const cloudPlaylistList = document.getElementById('cloud-playlist-list');
    const newCloudPlaylistBtn = document.getElementById('new-cloud-playlist');
    const cloudModal = document.getElementById('cloud-modal');
    const closeCloudModalBtn = document.getElementById('close-cloud-modal');
    const cancelCloudModalBtn = document.getElementById('cancel-cloud-modal');
    const saveCloudModalBtn = document.getElementById('save-cloud-modal');
    const cloudUrlInput = document.getElementById('cloud-url-input');
    const addToCloudBtn = document.getElementById('add-to-cloud-btn');
    const cloudItemsList = document.getElementById('cloud-items-list');
    const cloudPlaylistNameInput = document.getElementById('cloud-playlist-name-input');
    const externalPlayer = document.getElementById('external-player');

    let cloudPlaylists = [];
    let activeCloudPlaylistIndex = -1;

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
    let currentTaggingFolder = null;

    const settingsModal = document.getElementById('settings-modal');
    const saveSettingsBtn = document.getElementById('save-settings');
    const closeSettingsBtn = document.getElementById('close-settings');
    const configStartMuted = document.getElementById('config-start-muted');
    const clearAllTagsBtn = document.getElementById('clear-all-tags-btn');
    const sortSelect = document.getElementById('sort-select');
    let hlsInstance = null;
    const STARTUP_VIDEO_URL = '';

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

    function normalizeFolder(folder) {
        if (!folder || folder === '.') return '';
        return String(folder).replace(/^\/+/, '').replace(/\/+$/, '');
    }

    function buildLocalMediaUrl(folder, filename) {
        return ''; // ya no usamos rutas absolutas crudas de file:// en la extensión web
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
    let cloudPlaylistToDelete = null;
    let isDeletingAllTags = false;
    let playlistTimeout = null;
    let isFirstPlayStarted = false;
    const thumbnailCache = new Map();
    const playbackHistory = new Map();

    async function loadTags() {
        try {
            const scopePath = (settings.mediaPath || '').trim();
            videoTags = JSON.parse(await py.get_video_tags_for_path(scopePath));
        } catch(e) {
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

    async function fetchCloudPlaylists() {
        try {
            const data = JSON.parse(await py.get_playlists());
            cloudPlaylists = Array.isArray(data) ? data : [];
            renderCloudPlaylists();
        } catch (e) { console.error('Error fetching cloud playlists', e); }
    }

    function renderCloudPlaylists() {
        cloudPlaylistList.innerHTML = cloudPlaylists.map((list, index) => `
            <li class="cloud-playlist-item" data-index="${index}">
                <span class="playlist-name">🎬 ${list.name}</span>
                <div class="playlist-actions" style="display:flex; gap:5px;">
                    <button class="btn-icon-mini edit-cloud-playlist" data-index="${index}" title="Editar">✏️</button>
                    <button class="btn-icon-mini delete-cloud-playlist" data-index="${index}" title="Eliminar">🗑️</button>
                </div>
            </li>
        `).join('');

        cloudPlaylistList.querySelectorAll('.cloud-playlist-item').forEach(item => {
            const idx = parseInt(item.dataset.index);
            item.addEventListener('click', (e) => {
                if (e.target.closest('.playlist-actions')) return;
                openCloudPlaylist(idx);
            });

            item.querySelector('.edit-cloud-playlist').addEventListener('click', () => showCloudModal(idx));

            item.querySelector('.delete-cloud-playlist').addEventListener('click', (e) => {
                e.stopPropagation();
                deleteCloudPlaylist(idx);
            });
        });
    }

    function openCloudPlaylist(index, autoPlay = true) {
        currentVideos = cloudPlaylists[index].items;
        const listName = cloudPlaylists[index].name;
        currentFolderName.textContent = `☁️ ${listName}`;
        renderVideos(currentVideos);
        showNotification(`Lista Cloud "${listName}" cargada`, 'success');
        if (autoPlay && currentVideos.length > 0) playVideo(0);
    }

    [
        cloudPlaylistNameInput,
        cloudUrlInput,
        document.getElementById('new-tag-input')
    ].forEach(input => {
        if (input) {
            input.addEventListener('paste', (e) => {
                e.stopPropagation();
            });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    if (input.id === 'cloud-url-input') {
                        e.preventDefault();
                        addToCloudBtn.click();
                    } else if (input.id === 'new-tag-input') {
                        e.preventDefault();
                        const addTagBtn = document.getElementById('add-tag-btn');
                        if (addTagBtn) addTagBtn.click();
                    }
                }
            });
        }
    });

    function showCloudModal(index = -1) {
        activeCloudPlaylistIndex = index;
        const list = index === -1 ? { name: '', items: [] } : cloudPlaylists[index];
        document.getElementById('cloud-modal-title').textContent = index === -1 ? 'Crear Lista Cloud' : `Gestionar: ${list.name}`;
        cloudPlaylistNameInput.value = list.name;
        renderCloudItems(list.items);
        cloudModal.classList.add('active');
    }

    function renderCloudItems(items) {
        cloudItemsList.innerHTML = items.map((item, idx) => `
            <div class="sortable-item" data-index="${idx}" draggable="true">
                <span class="item-title">☰ ${item.name}</span>
                <div class="item-actions">
                    <button class="btn-icon-mini remove-item">❌</button>
                </div>
            </div>
        `).join('');

        let draggedItemIndex = null;

        cloudItemsList.querySelectorAll('.sortable-item').forEach(item => {
            item.addEventListener('dragstart', (e) => {
                draggedItemIndex = parseInt(item.dataset.index);
                e.dataTransfer.effectAllowed = 'move';
                item.style.opacity = '0.5';
            });

            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
            });

            item.addEventListener('drop', (e) => {
                e.preventDefault();
                const targetIndex = parseInt(item.dataset.index);
                if (draggedItemIndex !== null && draggedItemIndex !== targetIndex) {
                    const movedItem = items.splice(draggedItemIndex, 1)[0];
                    items.splice(targetIndex, 0, movedItem);
                    renderCloudItems(items);
                    if (activeCloudPlaylistIndex !== -1 && currentFolderName.textContent.includes(cloudPlaylists[activeCloudPlaylistIndex].name)) {
                        renderVideos(items);
                    }
                }
            });

            item.addEventListener('dragend', () => {
                item.style.opacity = '1';
                draggedItemIndex = null;
            });

            item.querySelector('.remove-item').onclick = () => {
                items.splice(parseInt(item.dataset.index), 1);
                renderCloudItems(items);
                if (activeCloudPlaylistIndex !== -1 && currentFolderName.textContent.includes(cloudPlaylists[activeCloudPlaylistIndex].name)) {
                    renderVideos(items);
                }
            };
        });
    }

    async function resolveAndAddUrl() {
        const url = cloudUrlInput.value.trim();
        if (!url) return;

        const originalContent = addToCloudBtn.innerHTML;
        addToCloudBtn.disabled = true;
        addToCloudBtn.innerHTML = '<div class="spinner"></div>';

        try {
            const data = {
                name: url.split('/').pop() || 'Video de la nube',
                url: url,
                type: 'embed'
            };

            const currentList = activeCloudPlaylistIndex === -1 ? { name: 'Nueva Lista', items: [] } : cloudPlaylists[activeCloudPlaylistIndex];
            currentList.items.push(data);

            if (activeCloudPlaylistIndex === -1) {
                cloudPlaylists.push(currentList);
                activeCloudPlaylistIndex = cloudPlaylists.length - 1;
            }

            cloudUrlInput.value = '';
            renderCloudItems(currentList.items);

            if (currentFolderName.textContent.includes(currentList.name)) {
                currentVideos = currentList.items;
                renderVideos(currentVideos);
            }

            showNotification(`Video añadido: ${data.name}`, 'success', true);
        } catch (e) {
            showNotification('Error al analizar URL', 'error');
        } finally {
            addToCloudBtn.disabled = false;
            addToCloudBtn.innerHTML = originalContent;
        }
    }

    async function saveCloudPlaylistsToServer() {
        const listName = cloudPlaylistNameInput.value.trim() || 'Lista sin nombre';

        if (activeCloudPlaylistIndex === -1) {
            cloudPlaylists.push({ name: listName, items: [] });
        } else {
            cloudPlaylists[activeCloudPlaylistIndex].name = listName;
        }

        try {
            await py.set_playlists(JSON.stringify(cloudPlaylists));
            showNotification('Listas actualizadas y guardadas correctamente', 'success', true);
            renderCloudPlaylists();
            cloudModal.classList.remove('active');
        } catch (e) {
            showNotification('Error al guardar listas', 'error');
        }
    }

    function deleteCloudPlaylist(index) {
        cloudPlaylistToDelete = index;
        videoToDelete = null;
        folderPathToDelete = null;
        const modalTitle = deleteModal.querySelector('h3');
        const modalText = deleteModal.querySelector('p');
        modalTitle.textContent = '¿Eliminar Lista Cloud?';
        modalText.innerHTML = `Estás a punto de eliminar la lista <strong>"${cloudPlaylists[index].name}"</strong>.<br>Esta acción no se puede deshacer.`;
        deleteModal.classList.add('active');
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

                try {
                    const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                    const toFolder = node.path;

                    if (data.fromFolder === toFolder) {
                        showNotification('El video ya está en esta carpeta', 'info');
                        return;
                    }

                    await moveVideo(data.filename, data.fromFolder, toFolder);
                } catch (err) {
                    console.error('Error al procesar el drop:', err);
                }
            });
        });
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
                            externalPlayer.src = '';
                            externalPlayer.style.display = 'none';
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

    async function selectFolder(path, element, autoPlay = true) {
        if (!element) {
            const possible = document.querySelector(`.folder-item[data-path="${path}"]`);
            if (possible) element = possible;
        }
        if (!element) {
            console.warn(`No se encontró el elemento de carpeta: ${path}`);
            return;
        }
        document.querySelectorAll('.folder-item').forEach(el => el.classList.remove('active'));
        element.classList.add('active');
        currentFolderName.textContent = path;
        videoList.innerHTML = '';

        try {
            currentVideos = JSON.parse(await py.get_videos(path));
            currentIndex = -1;

            sortVideos(settings.sortBy, false);

            if (autoPlay && currentVideos.length > 0) playVideo(0);

            showNotification(`Carpeta "${path}" cargada`, 'success');
            showPlaylistTemporarily();
        } catch (err) {
            showNotification('Error al cargar los videos', 'error');
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
            const cachedThumb = thumbnailCache.get(video.url);
            const thumbContent = cachedThumb ? `<img src="${cachedThumb}" class="real-thumb">` : '🎬';
            const videoId = video.url || video.name;
            const hasTags = videoTags[videoId] && videoTags[videoId].tags.length > 0;
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
                        ${video.type ? `<span class="badge cloud-badge" style="background: var(--accent); color: white; font-size: 0.65rem; padding: 2px 6px; border-radius: 4px; margin-top: 4px; display: inline-block; width: fit-content;">☁️ ${video.type.toUpperCase()}</span>` : ''}
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
                    const videoId = video.url || video.name;
                    realFolder = (videoTags[videoId] && videoTags[videoId].lastKnownFolder) || '';
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
                    const oldUrl = buildLocalMediaUrl(folder, originalName);
                    const newUrl = buildLocalMediaUrl(folder, newName);

                    if (thumbnailCache.has(oldUrl)) {
                        const thumbData = thumbnailCache.get(oldUrl);
                        thumbnailCache.set(newUrl, thumbData);
                        thumbnailCache.delete(oldUrl);
                    }

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
        const oldUrl = buildLocalMediaUrl(folder, oldName);
        const newUrl = buildLocalMediaUrl(folder, newName);

        try {
            const success = await py.rename_video(`${folder}/${oldName}`, newName);
            if (success) {
                if (thumbnailCache.has(oldUrl)) {
                    const thumbData = thumbnailCache.get(oldUrl);
                    thumbnailCache.set(newUrl, thumbData);
                    thumbnailCache.delete(oldUrl);
                    await DbManager.migrate('thumbnails', oldUrl, newUrl);
                }

                if (playbackHistory.has(oldUrl)) {
                    const time = playbackHistory.get(oldUrl);
                    playbackHistory.set(newUrl, time);
                    playbackHistory.delete(oldUrl);
                }

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

    async function captureThumbnail(url, index) {
        if (thumbnailCache.has(url)) return Promise.resolve();

        const persistentThumb = await DbManager.get('thumbnails', url);
        if (persistentThumb) {
            thumbnailCache.set(url, persistentThumb.dataUrl);
            updateThumbUI(index, persistentThumb.dataUrl);
            return Promise.resolve();
        }

        const thumbDiv = document.getElementById(`thumb-${index}`);
        if (!thumbDiv) return Promise.resolve();

        return new Promise((resolve) => {
            try {
                const video = document.createElement('video');
                video.src = url + "#t=15";
                video.crossOrigin = "anonymous";
                video.muted = true;

                video.addEventListener('loadeddata', () => {
                    setTimeout(() => {
                        const canvas = document.createElement('canvas');
                        canvas.width = 160;
                        canvas.height = 90;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                        const dataUrl = canvas.toDataURL('image/jpeg', 0.5);

                        thumbnailCache.set(url, dataUrl);
                        DbManager.put('thumbnails', { url, dataUrl });
                        updateThumbUI(index, dataUrl);
                        video.remove();
                        resolve();
                    }, 500);
                });

                video.onerror = () => {
                    video.remove();
                    resolve();
                };
                video.load();
            } catch (e) {
                console.warn(e);
                resolve();
            }
        });
    }

    let activeQueueTimeout = null;
    let queueIndex = 0;

    function startThumbnailQueue(videos) {
        if (!videos || videos.length === 0) return;

        stopThumbnailQueue();
        queueIndex = 0;

        activeQueueTimeout = setTimeout(() => {
            processNextInQueue(videos);
        }, 5000);
    }

    async function processNextInQueue(videos) {
        if (queueIndex >= videos.length) return;

        while(queueIndex < videos.length && thumbnailCache.has(videos[queueIndex].url)) {
            const dataUrl = thumbnailCache.get(videos[queueIndex].url);
            updateThumbUI(queueIndex, dataUrl);
            queueIndex++;
        }

        if (queueIndex >= videos.length) return;

        await captureThumbnail(videos[queueIndex].url, queueIndex);
        queueIndex++;

        activeQueueTimeout = setTimeout(() => {
            processNextInQueue(videos);
        }, 3000);
    }

    function updateThumbUI(index, dataUrl) {
        const thumbDiv = document.getElementById(`thumb-${index}`);
        if (thumbDiv) thumbDiv.innerHTML = `<img src="${dataUrl}" class="real-thumb">`;
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
        cloudPlaylistToDelete = null;
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
        } else if (cloudPlaylistToDelete !== null) {
            cloudPlaylists.splice(cloudPlaylistToDelete, 1);
            try {
                await py.set_playlists(JSON.stringify(cloudPlaylists));
                renderCloudPlaylists();
            } catch (e) {
                showNotification('Error al eliminar lista', 'error');
            }
            closeDeleteModal();
        }
    });

    async function deleteVideo() {
        const video = currentVideos[videoToDelete];
        const folderRaw = currentFolderName.textContent;

        const isTagView = folderRaw.startsWith('🏷️');
        const videoId = video.url || video.name;
        const folder = isTagView
            ? ((videoTags[videoId] && videoTags[videoId].lastKnownFolder) || '')
            : folderRaw;

        const isPlayingDeleted = (videoToDelete === currentIndex);
        const nextVideo = (isPlayingDeleted && videoToDelete + 1 < currentVideos.length) ? currentVideos[videoToDelete + 1] : null;
        const currentPlaying = (!isPlayingDeleted && currentIndex !== -1) ? currentVideos[currentIndex] : null;

        if (folder.startsWith('☁️ ')) {
            const cloudName = folder.replace('☁️ ', '').trim();
            const playlistIndex = cloudPlaylists.findIndex(p => p.name === cloudName);

            if (playlistIndex !== -1) {
                cloudPlaylists[playlistIndex].items.splice(videoToDelete, 1);
                try {
                    await py.set_playlists(JSON.stringify(cloudPlaylists));
                    openCloudPlaylist(playlistIndex, false);

                    if (isPlayingDeleted) {
                        if (nextVideo) {
                            const newIndex = currentVideos.findIndex(v => v.url === nextVideo.url);
                            if (newIndex !== -1) playVideo(newIndex);
                        } else {
                            mainPlayer.pause();
                            mainPlayer.src = '';
                            externalPlayer.src = '';
                            externalPlayer.style.display = 'none';
                            currentVideoTitle.textContent = 'Ningún video seleccionado';
                        }
                    } else if (currentPlaying) {
                        currentIndex = currentVideos.findIndex(v => v.url === currentPlaying.url);
                        updateActiveState(currentIndex);
                    }
                } catch (err) {
                    showNotification('Error al actualizar lista', 'error');
                }
            }
            closeDeleteModal();
            return;
        }

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
                            externalPlayer.src = '';
                            externalPlayer.style.display = 'none';
                            currentVideoTitle.textContent = 'Ningún video seleccionado';
                        }
                    } else if (currentPlaying) {
                        currentIndex = currentVideos.findIndex(v => (v.url || v.name) === (currentPlaying.url || currentPlaying.name));
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
                                externalPlayer.src = '';
                                externalPlayer.style.display = 'none';
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
            const scopePath = (settings.mediaPath || '').trim();
            await py.clear_video_tags_for_path(scopePath);
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
        const videoId = video.url || video.name;
        const hasTags = videoTags[videoId] && videoTags[videoId].tags.length > 0;

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

        const playerLoader = document.getElementById('player-loader');
        if (playerLoader) playerLoader.style.display = 'flex';

        const previousIndex = currentIndex;
        const previousVideo = (previousIndex >= 0 && previousIndex < currentVideos.length)
            ? currentVideos[previousIndex]
            : null;

        currentIndex = index;
        updateActiveState(index);

        setTimeout(async () => {
            if (previousVideo && !mainPlayer.paused && !previousVideo.type) {
                const time = mainPlayer.currentTime;
                playbackHistory.set(previousVideo.url, time);
                py.save_playback(previousVideo.url, time.toString());
            }

            const video = currentVideos[index];

            const startPlayback = () => {
                mainPlayer.play().then(() => {
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
                    if (e.name !== 'NotAllowedError') {
                        console.error('Error playing video:', e);
                        showNotification('Error al reproducir el video', 'error');
                        mainPlayer.pause();
                    }
                    mainPlayer.classList.remove('player-fading');
                });
            };

            if (video.type === 'youtube' || video.type === 'embed') {
                mainPlayer.style.display = 'none';
                mainPlayer.pause();
                externalPlayer.src = video.url;
                externalPlayer.style.display = 'block';
                externalPlayer.classList.remove('player-fading');
                currentVideoTitle.textContent = formatVideoTitleWithSize(video);
                updatePlayerTagChips(video);
            } else {
                externalPlayer.style.display = 'none';
                externalPlayer.src = '';
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

    newCloudPlaylistBtn.addEventListener('click', () => showCloudModal(-1));
    closeCloudModalBtn.addEventListener('click', () => cloudModal.classList.remove('active'));
    cancelCloudModalBtn.addEventListener('click', () => cloudModal.classList.remove('active'));
    addToCloudBtn.addEventListener('click', resolveAndAddUrl);
    saveCloudModalBtn.addEventListener('click', saveCloudPlaylistsToServer);

    cloudModal.addEventListener('click', (e) => {
        if (e.target === cloudModal) cloudModal.classList.remove('active');
    });

    const pasteCloudUrlBtn = document.getElementById('paste-cloud-url');
    if (pasteCloudUrlBtn) {
        pasteCloudUrlBtn.addEventListener('click', async () => {
            try {
                const text = await navigator.clipboard.readText();
                if (text) {
                    cloudUrlInput.value = text;
                }
            } catch (err) {
                showNotification('No se pudo leer el portapapeles. Intenta Ctrl+V.', 'error');
            }
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
        currentTaggingFolder = folder;
        const videoId = video.url || video.name;

        tagsVideoTitle.textContent = video.name;

        if (!videoTags[videoId]) {
            videoTags[videoId] = { tags: [], data: video, lastKnownFolder: folder };
        }

        renderTagsModal();
        tagsModal.classList.add('active');
    }

    function closeTagsModal() {
        tagsModal.classList.remove('active');
        currentTaggingVideo = null;
        currentTaggingFolder = null;
        renderVideos(currentVideos);
    }

    closeTagsModalBtn.addEventListener('click', closeTagsModal);
    doneTagsModalBtn.addEventListener('click', closeTagsModal);

    function renderTagsModal() {
        if (!currentTaggingVideo) return;
        const videoId = currentTaggingVideo.url || currentTaggingVideo.name;
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

        const videoId = currentTaggingVideo.url || currentTaggingVideo.name;
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
        const videoId = vid.url || vid.name;
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

    function saveTags() {
        const scopePath = (settings.mediaPath || '').trim();
        py.save_video_tags_for_path(scopePath, JSON.stringify(videoTags));
        renderTagsList();
        updateVideoQuickActions();
        updatePlayerTagChips();
    }

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
            cloudPlaylistToDelete = null;

            const modalTitle = deleteModal.querySelector('h3');
            const modalText = deleteModal.querySelector('p');
            const activeLibraryPath = (settings.mediaPath || '').trim();
            modalTitle.textContent = '¿Borrar Todas las Etiquetas?';
            modalText.innerHTML = `Esta acción eliminará las etiquetas de la biblioteca actual.<br><br><span style="opacity:0.8; font-size:0.86rem;">Ruta: <strong>${activeLibraryPath || '(sin ruta configurada)'}</strong></span>`;

            deleteModal.classList.add('active');
        });
    }

    async function playVideosByTag(tag) {
        const taggedVideosData = [];

        for (const [key, val] of Object.entries(videoTags)) {
            if (val.tags && val.tags.includes(tag)) {
                const folder = val.lastKnownFolder || "";
                const isCloud = folder.includes('☁️') || (val.data && val.data.type);

                if (!isCloud) {
                    try {
                        const folders = JSON.parse(await py.get_video_folders());
                        const list = JSON.parse(await py.get_videos(folder));
                        const currentVid = list.find(v => v.name === val.data.name);

                        if (currentVid) {
                            taggedVideosData.push(currentVid);
                        }
                    } catch(e) { console.warn(e); }
                } else {
                    taggedVideosData.push({...val.data});
                }
            }
        }

        if (taggedVideosData.length > 0) {
            currentVideos = taggedVideosData;
            currentFolderName.textContent = `🏷️ Etiqueta: ${tag}`;
            renderVideos(currentVideos);
            playVideo(0);
            showNotification(`Reproduciendo etiqueta: ${tag}`, 'success');
        } else {
            showNotification('No se encontraron videos con esta etiqueta', 'error');
        }
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
        externalPlayer.addEventListener('load', hideLoader);
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
                showNotification('Carpeta de videos seleccionada', 'success', true);
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
            await fetchCloudPlaylists();
            renderTagsList();
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
})();
