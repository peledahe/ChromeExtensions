// Visor de Imágenes - Extensión de Chrome usando File System Access API
(function () {
    'use strict';

    const DB_NAME = 'imageplayer-db';
    const STORE_NAME = 'handles';

    // Estado principal
    const state = {
        rootHandle: null,
        directoryHandles: new Map(), // path relativo -> FileSystemDirectoryHandle
        images: [],
        filtered: [],
        currentPath: null,
        lbIndex: 0,
        zoom: 1,
        panX: 0,
        panY: 0,
        dragging: false,
        dragStart: null,
        observer: null,
        selectionMode: false,
        selectedPaths: new Set(),
        settings: {
            sortBy: 'name-asc',
            lastFolder: '.'
        },
        moveTarget: null,
        moveDestPath: null
    };

    const q = (id) => document.getElementById(id);
    let contextImagePath = null;
    let py = null;

    async function initWebChannel() {
        return new Promise((resolve) => {
            if (typeof qt === 'undefined') {
                resolve();
                return;
            }
            const script = document.createElement('script');
            script.src = 'qrc:///qtwebchannel/qwebchannel.js';
            script.onload = () => {
                new QWebChannel(qt.webChannelTransport, (channel) => {
                    py = channel.objects.py;
                    resolve();
                });
            };
            script.onerror = () => resolve();
            document.head.appendChild(script);
        });
    }

    async function checkIsLinux() {
        return new Promise((resolve) => {
            if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getPlatformInfo) {
                chrome.runtime.getPlatformInfo((info) => {
                    resolve(info && info.os === 'linux');
                });
            } else {
                const platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
                resolve(platform.toLowerCase().includes('linux') || navigator.userAgent.toLowerCase().includes('linux'));
            }
        });
    }

    // --- Lógica de IndexedDB para persistir Handles ---
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

    // --- Gestión del menú contextual ---
    function closeContextMenu() {
        const menu = q('ip-ctx-menu');
        if (menu) menu.classList.remove('active');
        contextImagePath = null;
    }

    function getContextImageFromTarget() {
        if (q('ip-lightbox').classList.contains('active')) {
            return state.filtered[state.lbIndex] || null;
        }
        return null;
    }

    function openContextMenu(clientX, clientY, img) {
        const menu = q('ip-ctx-menu');
        if (!menu || !img) return;
        contextImagePath = img.path;

        menu.classList.add('active');
        menu.style.left = '0px';
        menu.style.top = '0px';

        const rect = menu.getBoundingClientRect();
        const maxX = window.innerWidth - rect.width - 8;
        const maxY = window.innerHeight - rect.height - 8;
        const x = Math.max(8, Math.min(clientX, maxX));
        const y = Math.max(8, Math.min(clientY, maxY));
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
    }

    function bindContextMenu() {
        const menu = q('ip-ctx-menu');
        if (!menu) return;

        document.addEventListener('click', (e) => {
            if (!menu.classList.contains('active')) return;
            if (!e.target.closest('#ip-ctx-menu')) closeContextMenu();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeContextMenu();
        });

        const targetSelectors = ['ip-lb-stage', 'ip-lb-img-wrap', 'ip-lb-img'];
        targetSelectors.forEach((id) => {
            const el = q(id);
            if (!el) return;
            el.addEventListener('contextmenu', (e) => {
                const img = getContextImageFromTarget();
                if (!img) return;
                e.preventDefault();
                openContextMenu(e.clientX, e.clientY, img);
            });
        });

        q('ip-ctx-close').addEventListener('click', closeContextMenu);

        // Aplicar como fondo de pantalla (solo en Linux y con puente de Python disponible)
        q('ip-ctx-wallpaper').addEventListener('click', async () => {
            const img = state.filtered.find((i) => i.path === contextImagePath);
            closeContextMenu();
            if (!img) return;

            if (!py || !py.set_image_wallpaper) {
                showNotification('Para cambiar el fondo de pantalla automáticamente, ejecuta el visor desde Minichrome.', 'info', true);
                return;
            }

            try {
                const raw = await py.get_image_settings();
                const settings = JSON.parse(raw || '{}');
                const rootPath = settings.imageMediaPath;
                if (!rootPath) {
                    showNotification('Por favor, configura la ruta absoluta en Minichrome.', 'info', true);
                    return;
                }
                const absPath = `${rootPath.replace(/\/+$/, '')}/${img.path}`;
                const ok = await py.set_image_wallpaper(absPath);
                showNotification(ok ? 'Fondo de pantalla aplicado exitosamente' : 'No se pudo aplicar el fondo', ok ? 'success' : 'error');
            } catch (e) {
                console.error(e);
                showNotification('Error al aplicar el fondo de pantalla', 'error');
            }
        });

        // Descargar imagen
        q('ip-ctx-download').addEventListener('click', () => {
            const img = state.filtered.find((i) => i.path === contextImagePath);
            closeContextMenu();
            if (img) downloadImageFile(img);
        });

        q('ip-ctx-rename').addEventListener('click', () => {
            const img = state.filtered.find((i) => i.path === contextImagePath);
            closeContextMenu();
            if (!img) return;
            const card = document.querySelector(`.ip-thumb[data-path="${CSS.escape(img.path)}"]`);
            const nameEl = card ? card.querySelector('.ip-thumb-name') : null;
            showRenameImage(img, nameEl, card);
        });

        q('ip-ctx-move').addEventListener('click', async () => {
            const img = state.filtered.find((i) => i.path === contextImagePath);
            closeContextMenu();
            if (!img) return;
            const card = document.querySelector(`.ip-thumb[data-path="${CSS.escape(img.path)}"]`);
            await showMoveImage(img, card);
        });

        q('ip-ctx-delete').addEventListener('click', () => {
            const img = state.filtered.find((i) => i.path === contextImagePath);
            closeContextMenu();
            if (!img) return;
            const card = document.querySelector(`.ip-thumb[data-path="${CSS.escape(img.path)}"]`);
            confirmDeleteImage(img, card);
        });
    }

    function downloadImageFile(img) {
        const a = document.createElement('a');
        a.href = img.url;
        a.download = img.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    // --- Notificaciones ---
    function showNotification(msg, type = 'success', sticky = false) {
        const container = q('toast-container');
        if (!container) return;
        const toast = document.createElement('div');
        toast.style.padding = '10px 20px';
        toast.style.background = type === 'success' ? 'rgba(0,184,148,0.9)' : 'rgba(214,48,49,0.9)';
        if (type === 'info') toast.style.background = 'rgba(108,92,231,0.9)';
        toast.style.color = '#fff';
        toast.style.borderRadius = '8px';
        toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
        toast.style.fontSize = '0.85rem';
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(20px)';
        toast.style.transition = 'all 0.3s ease';
        toast.style.display = 'flex';
        toast.style.alignItems = 'center';
        toast.style.gap = '10px';

        if (sticky) {
            toast.innerHTML = `<span style="flex:1;">${msg}</span><button class="ip-close-toast" style="background:transparent;border:none;color:#fff;cursor:pointer;font-size:1.1rem;font-weight:bold;padding:0 0 0 5px;line-height:1;">&times;</button>`;
            container.appendChild(toast);
            const closeBtn = toast.querySelector('.ip-close-toast');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => {
                    toast.style.opacity = '0';
                    toast.style.transform = 'translateY(20px)';
                    setTimeout(() => toast.remove(), 300);
                });
            }
            // Auto-descartar después de 6 segundos
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.style.opacity = '0';
                    toast.style.transform = 'translateY(20px)';
                    setTimeout(() => toast.remove(), 300);
                }
            }, 6000);
        } else {
            toast.innerText = msg;
            container.appendChild(toast);
        }

        setTimeout(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
        }, 10);

        if (!sticky) {
            setTimeout(() => {
                toast.style.opacity = '0';
                toast.style.transform = 'translateY(20px)';
                setTimeout(() => toast.remove(), 300);
            }, 3000);
        }
    }

    // --- Toolbar ---
    function updateToolbarState() {
        const count = q('ip-count');
        const toggleBtn = q('ip-bulk-toggle');
        const selectAllBtn = q('ip-bulk-select-all');
        const deleteBtn = q('ip-bulk-delete');

        const visibleCount = state.filtered.length;
        const selectedVisible = state.filtered.filter((img) => state.selectedPaths.has(img.path)).length;
        const allVisibleSelected = visibleCount > 0 && selectedVisible === visibleCount;

        if (count) {
            const base = `${visibleCount} imagen${visibleCount === 1 ? '' : 'es'}`;
            count.textContent = state.selectionMode ? `${base} · ${selectedVisible} seleccionada${selectedVisible === 1 ? '' : 's'}` : base;
        }

        if (toggleBtn) toggleBtn.textContent = state.selectionMode ? 'Cancelar seleccion' : 'Seleccionar';
        if (selectAllBtn) {
            selectAllBtn.disabled = visibleCount === 0;
            selectAllBtn.textContent = allVisibleSelected ? 'Quitar todas' : 'Seleccionar todo';
        }
        if (deleteBtn) {
            deleteBtn.disabled = selectedVisible === 0;
            deleteBtn.textContent = selectedVisible > 0 ? `Eliminar (${selectedVisible})` : 'Eliminar seleccionadas';
        }
    }

    function syncSelectionWithVisibleImages() {
        const visible = new Set(state.filtered.map((img) => img.path));
        state.selectedPaths = new Set([...state.selectedPaths].filter((path) => visible.has(path)));
    }

    function clearSelection(render = false) {
        state.selectedPaths.clear();
        if (render) renderGallery();
        else updateToolbarState();
    }

    function toggleSelectionMode(forceValue) {
        state.selectionMode = typeof forceValue === 'boolean' ? forceValue : !state.selectionMode;
        if (!state.selectionMode) {
            clearSelection(true);
            return;
        }
        renderGallery();
    }

    function toggleImageSelection(imgPath, card) {
        if (state.selectedPaths.has(imgPath)) state.selectedPaths.delete(imgPath);
        else state.selectedPaths.add(imgPath);

        if (card) card.classList.toggle('selected', state.selectedPaths.has(imgPath));
        updateToolbarState();
    }

    function toggleSelectAllVisible() {
        const visiblePaths = state.filtered.map((img) => img.path);
        if (visiblePaths.length === 0) return;

        const allSelected = visiblePaths.every((path) => state.selectedPaths.has(path));
        visiblePaths.forEach((path) => {
            if (allSelected) state.selectedPaths.delete(path);
            else state.selectedPaths.add(path);
        });
        renderGallery();
    }

    // --- Bootstrap & File System API ---
    async function bootstrap() {
        await initWebChannel();

        // Mostrar la opción de wallpaper solo si el sistema operativo es Linux
        const isLinux = await checkIsLinux();
        const wpBtn = q('ip-ctx-wallpaper');
        if (wpBtn) {
            wpBtn.style.display = isLinux ? 'flex' : 'none';
        }

        // Cargar filtros del localStorage si existen
        state.settings.sortBy = localStorage.getItem('imageSortBy') || 'name-asc';
        state.settings.lastFolder = localStorage.getItem('imageLastFolder') || '.';

        const sortEl = q('ip-sort');
        if (sortEl) sortEl.value = state.settings.sortBy;

        state.rootHandle = await loadHandle('root_directory');
        if (state.rootHandle) {
            q('ip-media-path-label').textContent = state.rootHandle.name;
            q('ip-media-path-label').title = state.rootHandle.name;

            const permission = await state.rootHandle.queryPermission({ mode: 'readwrite' });
            if (permission === 'granted') {
                q('ip-permission-banner').style.display = 'none';
                await initializeDirectory();
            } else {
                q('ip-permission-banner').style.display = 'block';
                q('ip-folder-tree').innerHTML = '<div style="padding:20px 14px; font-size:0.8rem; color:rgba(255,255,255,0.25); text-align:center;">Reactiva los permisos de la carpeta.</div>';
            }
        } else {
            q('ip-permission-banner').style.display = 'none';
            q('ip-folder-tree').innerHTML = '<div style="padding:20px 14px; font-size:0.8rem; color:rgba(255,255,255,0.2); text-align:center; line-height:1.6;">Configura la carpeta raíz desde el botón ⚙️ superior.</div>';
        }
    }

    async function initializeDirectory() {
        state.directoryHandles.clear();
        const tree = q('ip-folder-tree');
        if (tree) tree.innerHTML = '<div style="padding:20px 14px; font-size:0.8rem; color:rgba(255,255,255,0.2); text-align:center;">Escanenando carpetas...</div>';

        try {
            const data = await buildFolderTree(state.rootHandle, '.');
            renderTree([data], tree, 0);

            // Intentar cargar la última carpeta seleccionada
            if (state.settings.lastFolder) {
                const node = findNodeByPath([data], state.settings.lastFolder);
                if (node) {
                    await selectFolder(node);
                    return;
                }
            }
            // Fallback a raíz
            await selectFolder({ name: state.rootHandle.name, path: '.' });
        } catch (e) {
            console.error(e);
            if (tree) tree.innerHTML = '<div style="padding:20px 14px; font-size:0.8rem; color:#ff7675; text-align:center;">Error al indexar la carpeta</div>';
        }
    }

    async function buildFolderTree(dirHandle, currentPath = '.') {
        const children = [];
        state.directoryHandles.set(currentPath, dirHandle);

        for await (const entry of dirHandle.values()) {
            if (entry.kind === 'directory') {
                const relPath = currentPath === '.' ? entry.name : `${currentPath}/${entry.name}`;
                const subTree = await buildFolderTree(entry, relPath);
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

    function findNodeByPath(nodes, path) {
        for (const node of nodes) {
            if (node.path === path) return node;
            if (node.children && node.children.length) {
                const found = findNodeByPath(node.children, path);
                if (found) return found;
            }
        }
        return null;
    }

    function renderTree(nodes, container, level) {
        container.innerHTML = '';
        nodes.forEach((node) => {
            const wrap = document.createElement('div');
            const item = document.createElement('div');
            item.className = 'ip-folder-item';
            item.dataset.path = node.path;
            item.style.paddingLeft = `${level * 14 + 12}px`;

            const arrow = document.createElement('span');
            arrow.className = 'ip-folder-arrow';
            arrow.textContent = node.children && node.children.length ? '▶' : '';

            const icon = document.createElement('span');
            icon.textContent = '📁 ';
            icon.style.fontSize = '0.88em';

            const label = document.createElement('span');
            label.className = 'ip-folder-label';
            label.textContent = node.name;

            const actions = document.createElement('div');
            actions.className = 'ip-folder-actions';

            const btnAdd = document.createElement('button');
            btnAdd.className = 'ip-fld-btn';
            btnAdd.title = 'Nueva subcarpeta';
            btnAdd.textContent = '+';
            btnAdd.addEventListener('click', (e) => {
                e.stopPropagation();
                showCreateFolder(node.path);
            });

            const btnDel = document.createElement('button');
            btnDel.className = 'ip-fld-btn del';
            btnDel.title = 'Eliminar carpeta';
            btnDel.innerHTML = '<svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';
            btnDel.addEventListener('click', (e) => {
                e.stopPropagation();
                confirmDeleteFolder(node);
            });

            actions.appendChild(btnAdd);
            if (node.path !== '.') actions.appendChild(btnDel); // no borrar la raíz

            item.appendChild(arrow);
            item.appendChild(icon);
            item.appendChild(label);
            item.appendChild(actions);
            wrap.appendChild(item);

            let sub = null;
            if (node.children && node.children.length) {
                sub = document.createElement('div');
                sub.className = 'ip-folder-children';
                sub.style.display = 'none';
                renderTree(node.children, sub, level + 1);
                wrap.appendChild(sub);

                arrow.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const open = sub.style.display !== 'none';
                    sub.style.display = open ? 'none' : 'block';
                    arrow.textContent = open ? '▶' : '▼';
                    icon.textContent = open ? '📁 ' : '📂 ';
                });
            }

            item.addEventListener('click', async () => {
                await selectFolder(node);
            });

            container.appendChild(wrap);
        });
    }

    async function selectFolder(node) {
        document.querySelectorAll('.ip-folder-item').forEach((el) => {
            el.classList.toggle('active', el.dataset.path === node.path);
        });

        state.currentPath = node.path;
        q('ip-folder-path').textContent = node.path === '.' ? 'Raiz' : node.path;

        localStorage.setItem('imageLastFolder', node.path);

        renderLoading();
        try {
            const folderHandle = state.directoryHandles.get(node.path);
            if (!folderHandle) throw new Error('Handle no encontrado');

            // Revocar URLs anteriores
            state.images.forEach(img => {
                if (img.url) URL.revokeObjectURL(img.url);
            });

            const items = [];
            const supportedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'];

            for await (const entry of folderHandle.values()) {
                if (entry.kind === 'file') {
                    const nameLower = entry.name.toLowerCase();
                    const isImg = supportedExts.some(ext => nameLower.endsWith(ext));
                    if (isImg) {
                        const file = await entry.getFile();
                        const url = URL.createObjectURL(file);
                        items.push({
                            name: entry.name,
                            path: node.path === '.' ? entry.name : `${node.path}/${entry.name}`,
                            url: url,
                            size: file.size,
                            mtime: file.lastModified / 1000,
                            handle: entry
                        });
                    }
                }
            }

            state.images = items;
            state.selectionMode = false;
            state.selectedPaths.clear();
            applyFilter();
        } catch (e) {
            console.error(e);
            renderEmpty('Error al cargar imagenes');
        }
    }

    function renderLoading() {
        const gallery = q('ip-gallery');
        if (gallery) gallery.innerHTML = '<div class="ip-loading"><div class="ip-spinner"></div>Cargando imagenes...</div>';
        const count = q('ip-count');
        if (count) count.textContent = '';
    }

    function renderEmpty(text) {
        const gallery = q('ip-gallery');
        if (gallery) {
            gallery.innerHTML = `<div class="ip-gallery-empty"><div class="ep-icon">📂</div><div>${text}</div></div>`;
        }
        syncSelectionWithVisibleImages();
        updateToolbarState();
    }

    function applyFilter() {
        const search = (q('ip-search').value || '').toLowerCase().trim();
        const sort = q('ip-sort').value;

        state.settings.sortBy = sort;
        localStorage.setItem('imageSortBy', sort);

        let list = search
            ? state.images.filter((i) => i.name.toLowerCase().includes(search))
            : [...state.images];

        list.sort((a, b) => {
            if (sort === 'name-asc') return a.name.localeCompare(b.name);
            if (sort === 'name-desc') return b.name.localeCompare(a.name);
            if (sort === 'date-desc') return Number(b.mtime || 0) - Number(a.mtime || 0);
            if (sort === 'date-asc') return Number(a.mtime || 0) - Number(b.mtime || 0);
            if (sort === 'size-desc') return Number(b.size || 0) - Number(a.size || 0);
            return 0;
        });

        state.filtered = list;
        syncSelectionWithVisibleImages();
        renderGallery();
    }

    function renderGallery() {
        const gallery = q('ip-gallery');
        if (!gallery) return;

        if (state.observer) {
            state.observer.disconnect();
            state.observer = null;
        }

        if (state.filtered.length === 0) {
            const msg = state.images.length === 0 ? 'Esta carpeta no tiene imagenes' : 'Sin resultados';
            gallery.innerHTML = `<div class="ip-gallery-empty"><div class="ep-icon">${state.images.length === 0 ? '📂' : '🔍'}</div><div>${msg}</div></div>`;
            updateToolbarState();
            return;
        }

        gallery.innerHTML = '';
        updateToolbarState();

        state.filtered.forEach((img) => {
            const card = document.createElement('div');
            card.className = 'ip-thumb';
            card.dataset.path = img.path;
            card.classList.toggle('selecting', state.selectionMode);
            card.classList.toggle('selected', state.selectedPaths.has(img.path));

            const selectBtn = document.createElement('button');
            selectBtn.className = 'ip-thumb-select';
            selectBtn.type = 'button';
            selectBtn.title = state.selectedPaths.has(img.path) ? 'Quitar de la seleccion' : 'Seleccionar imagen';
            selectBtn.textContent = '✓';
            selectBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleImageSelection(img.path, card);
                selectBtn.title = state.selectedPaths.has(img.path) ? 'Quitar de la seleccion' : 'Seleccionar imagen';
            });

            const imageEl = document.createElement('img');
            imageEl.dataset.src = img.url;
            imageEl.alt = img.name;
            imageEl.loading = 'lazy';

            const overlay = document.createElement('div');
            overlay.className = 'ip-thumb-overlay';

            const nameEl = document.createElement('span');
            nameEl.className = 'ip-thumb-name';
            nameEl.textContent = img.name;

            const acts = document.createElement('div');
            acts.className = 'ip-thumb-act';

            const btnRen = document.createElement('button');
            btnRen.className = 'ip-act-btn';
            btnRen.title = 'Renombrar';
            btnRen.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';
            btnRen.addEventListener('click', (e) => {
                e.stopPropagation();
                showRenameImage(img, nameEl, card);
            });

            const btnMov = document.createElement('button');
            btnMov.className = 'ip-act-btn';
            btnMov.title = 'Mover a carpeta';
            btnMov.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V6h5.17l2 2H20v10z"/></svg>';
            btnMov.addEventListener('click', (e) => {
                e.stopPropagation();
                showMoveImage(img, card);
            });

            const btnDel = document.createElement('button');
            btnDel.className = 'ip-act-btn del';
            btnDel.title = 'Eliminar imagen';
            btnDel.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';
            btnDel.addEventListener('click', (e) => {
                e.stopPropagation();
                confirmDeleteImage(img, card);
            });

            acts.appendChild(btnRen);
            acts.appendChild(btnMov);
            acts.appendChild(btnDel);
            card.appendChild(selectBtn);
            overlay.appendChild(nameEl);
            overlay.appendChild(acts);
            card.appendChild(imageEl);
            card.appendChild(overlay);

            card.addEventListener('click', () => {
                if (state.selectionMode) {
                    toggleImageSelection(img.path, card);
                    selectBtn.title = state.selectedPaths.has(img.path) ? 'Quitar de la seleccion' : 'Seleccionar imagen';
                    return;
                }
                const currentIdx = state.filtered.findIndex((i) => i.path === img.path);
                if (currentIdx === -1) return;
                openLightbox(currentIdx);
            });
            gallery.appendChild(card);
        });

        state.observer = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                const img = entry.target.querySelector('img[data-src]');
                if (!img) return;
                img.src = img.dataset.src;
                img.removeAttribute('data-src');
                img.addEventListener('load', () => img.classList.add('loaded'), { once: true });
                img.addEventListener('error', () => {
                    img.style.opacity = '0.3';
                }, { once: true });
                state.observer.unobserve(entry.target);
            });
        }, { rootMargin: '300px' });

        gallery.querySelectorAll('.ip-thumb').forEach((t) => state.observer.observe(t));
    }

    // --- Lightbox ---
    function openLightbox(idx) {
        state.lbIndex = idx;
        state.zoom = 1;
        state.panX = 0;
        state.panY = 0;
        q('ip-lightbox').classList.add('active');
        renderLightbox();
        buildFilmstrip();
        document.addEventListener('keydown', onLbKeydown);
    }

    function closeLightbox() {
        q('ip-lightbox').classList.remove('active');
        document.removeEventListener('keydown', onLbKeydown);
        state.zoom = 1;
        state.panX = 0;
        state.panY = 0;
        applyTransform();
    }

    function onLbKeydown(e) {
        if (e.key === 'Escape') {
            closeLightbox();
            return;
        }
        if (e.key === 'ArrowLeft' && state.lbIndex > 0) {
            state.lbIndex -= 1;
            state.zoom = 1;
            state.panX = 0;
            state.panY = 0;
            renderLightbox();
            return;
        }
        if (e.key === 'ArrowRight' && state.lbIndex < state.filtered.length - 1) {
            state.lbIndex += 1;
            state.zoom = 1;
            state.panX = 0;
            state.panY = 0;
            renderLightbox();
            return;
        }
        if (e.key === '+' || e.key === '=') {
            zoomBy(0.25);
            return;
        }
        if (e.key === '-') {
            zoomBy(-0.25);
            return;
        }
        if (e.key === '0') {
            state.zoom = 1;
            state.panX = 0;
            state.panY = 0;
            applyTransform();
        }
    }

    function renderLightbox() {
        const img = state.filtered[state.lbIndex];
        if (!img) return;

        q('ip-lb-title').textContent = img.name;
        q('ip-lb-counter').textContent = `${state.lbIndex + 1} / ${state.filtered.length}`;

        const sizeMb = (Number(img.size || 0) / 1048576).toFixed(2);
        const date = new Date(Number(img.mtime || 0) * 1000).toLocaleDateString('es', {
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        });
        q('ip-lb-meta').textContent = `${sizeMb} MB · ${date}`;

        const el = q('ip-lb-img');
        el.style.opacity = '0';
        el.src = img.url;
        el.onload = () => {
            el.style.opacity = '1';
            state.zoom = 1;
            state.panX = 0;
            state.panY = 0;
            applyTransform();
        };

        q('ip-lb-prev').disabled = state.lbIndex === 0;
        q('ip-lb-next').disabled = state.lbIndex === state.filtered.length - 1;

        document.querySelectorAll('.ip-lb-thumb').forEach((t, i) => {
            t.classList.toggle('active', i === state.lbIndex);
        });

        const strip = q('ip-lb-filmstrip');
        const active = strip.children[state.lbIndex];
        if (active) active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }

    function buildFilmstrip() {
        const strip = q('ip-lb-filmstrip');
        strip.innerHTML = '';
        state.filtered.forEach((img, i) => {
            const t = document.createElement('div');
            t.className = `ip-lb-thumb${i === state.lbIndex ? ' active' : ''}`;
            t.innerHTML = `<img src="${img.url}" alt="${img.name}" loading="lazy">`;
            t.addEventListener('click', () => {
                state.lbIndex = i;
                state.zoom = 1;
                state.panX = 0;
                state.panY = 0;
                renderLightbox();
            });
            strip.appendChild(t);
        });
    }

    function zoomBy(delta, cx, cy) {
        const oldZoom = state.zoom;
        state.zoom = Math.min(8, Math.max(0.5, state.zoom + delta));
        if (state.zoom < 1) {
            state.zoom = 1;
            state.panX = 0;
            state.panY = 0;
        }

        if (cx !== undefined && oldZoom !== state.zoom) {
            const wrap = q('ip-lb-img-wrap');
            const rect = wrap.getBoundingClientRect();
            const offsetX = cx - (rect.left + rect.width / 2);
            const offsetY = cy - (rect.top + rect.height / 2);
            state.panX += (offsetX / oldZoom) * (oldZoom - state.zoom);
            state.panY += (offsetY / oldZoom) * (oldZoom - state.zoom);
        }

        applyTransform();
    }

    function applyTransform() {
        const el = q('ip-lb-img');
        if (!el) return;
        if (state.zoom <= 1) {
            state.panX = 0;
            state.panY = 0;
        }
        el.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
        el.style.cursor = state.zoom > 1 ? 'grab' : 'default';
        q('ip-lb-zoom-pct').textContent = `${Math.round(state.zoom * 100)}%`;
    }

    function removeImageFromState(imgPath) {
        state.images = state.images.filter((i) => i.path !== imgPath);
        state.filtered = state.filtered.filter((i) => i.path !== imgPath);
        state.selectedPaths.delete(imgPath);
    }

    // --- Operaciones de Archivo Nativas ---
    function confirmDeleteSelectedImages() {
        const selected = state.filtered.filter((img) => state.selectedPaths.has(img.path));
        if (selected.length === 0) {
            showNotification('No hay imagenes seleccionadas', 'info');
            return;
        }

        q('ip-confirm-title').textContent = '¿Eliminar imagenes seleccionadas?';
        q('ip-confirm-desc').textContent = `Se eliminaran permanentemente ${selected.length} imagenes seleccionadas de tu disco local. Esta accion no se puede deshacer.`;
        q('ip-confirm-modal').classList.add('active');

        const okBtn = q('ip-confirm-ok');
        const newOk = okBtn.cloneNode(true);
        okBtn.parentNode.replaceChild(newOk, okBtn);

        newOk.addEventListener('click', async () => {
            try {
                let deleted = 0;
                const parentHandle = state.directoryHandles.get(state.currentPath);

                for (const img of selected) {
                    await parentHandle.removeEntry(img.name);
                    URL.revokeObjectURL(img.url);
                    deleted += 1;
                    removeImageFromState(img.path);
                }

                q('ip-confirm-modal').classList.remove('active');
                renderGallery();
                showNotification(
                    deleted === selected.length
                        ? `${deleted} imagen${deleted === 1 ? '' : 'es'} eliminada${deleted === 1 ? '' : 's'}`
                        : `Se eliminaron ${deleted} de ${selected.length} imagenes`,
                    'success'
                );
            } catch (e) {
                console.error(e);
                showNotification('Error al eliminar seleccion', 'error');
            }
        });
    }

    function showRenameImage(img, nameEl, card) {
        const input = q('ip-rename-input');
        input.value = img.name;
        q('ip-rename-modal').classList.add('active');
        input.select();

        const saveBtn = q('ip-rename-save');
        const newSave = saveBtn.cloneNode(true);
        saveBtn.parentNode.replaceChild(newSave, saveBtn);

        newSave.addEventListener('click', async () => {
            const newName = input.value.trim();
            if (!newName || newName === img.name) {
                q('ip-rename-modal').classList.remove('active');
                return;
            }

            try {
                const parentHandle = state.directoryHandles.get(state.currentPath);
                
                // Mover nativo o fallback de copia
                let newFileHandle;
                if (typeof img.handle.move === 'function') {
                    await img.handle.move(newName);
                    newFileHandle = img.handle;
                } else {
                    const file = await img.handle.getFile();
                    newFileHandle = await parentHandle.getFileHandle(newName, { create: true });
                    const writable = await newFileHandle.createWritable();
                    await writable.write(file);
                    await writable.close();
                    await parentHandle.removeEntry(img.name);
                }

                const oldPath = img.path;
                const newPath = state.currentPath === '.' ? newName : `${state.currentPath}/${newName}`;

                img.name = newName;
                img.path = newPath;
                img.handle = newFileHandle;

                if (nameEl) nameEl.textContent = newName;
                if (card) card.dataset.path = newPath;

                const idx = state.images.findIndex((i) => i.path === oldPath);
                if (idx !== -1) {
                    state.images[idx].name = newName;
                    state.images[idx].path = newPath;
                    state.images[idx].handle = newFileHandle;
                }

                if (state.selectedPaths.has(oldPath)) {
                    state.selectedPaths.delete(oldPath);
                    state.selectedPaths.add(newPath);
                }

                q('ip-rename-modal').classList.remove('active');
                renderLightbox();
                showNotification('Imagen renombrada', 'success', true);
            } catch (e) {
                console.error(e);
                showNotification('Error al renombrar', 'error');
            }
        });
    }

    async function showMoveImage(img, card) {
        state.moveTarget = { img, card };
        state.moveDestPath = null;
        q('ip-move-dest-label').textContent = '—';
        q('ip-move-modal').classList.add('active');

        const tree = q('ip-move-tree');
        tree.innerHTML = '';

        const rootItem = document.createElement('div');
        rootItem.className = 'ip-browse-item';
        rootItem.textContent = '📸 Raiz';
        rootItem.addEventListener('click', () => {
            state.moveDestPath = '.';
            q('ip-move-dest-label').textContent = 'Raiz';
            tree.querySelectorAll('.ip-browse-item').forEach((el) => {
                el.style.background = '';
            });
            rootItem.style.background = 'rgba(108,92,231,0.25)';
        });
        tree.appendChild(rootItem);

        const build = (nodes, level) => {
            nodes.forEach((n) => {
                if (n.path === state.currentPath) return; // omitir carpeta actual

                const item = document.createElement('div');
                item.className = 'ip-browse-item';
                item.style.paddingLeft = `${level * 14 + 12}px`;
                item.textContent = `📁 ${n.name}`;
                item.addEventListener('click', () => {
                    state.moveDestPath = n.path;
                    q('ip-move-dest-label').textContent = n.path;
                    tree.querySelectorAll('.ip-browse-item').forEach((el) => {
                        el.style.background = '';
                    });
                    item.style.background = 'rgba(108,92,231,0.25)';
                });
                tree.appendChild(item);
                if (n.children && n.children.length) build(n.children, level + 1);
            });
        };

        // Construir el árbol a partir del root actual
        const rootData = await buildFolderTree(state.rootHandle, '.');
        build(rootData.children || [], 0);

        const saveBtn = q('ip-move-save');
        const newSave = saveBtn.cloneNode(true);
        saveBtn.parentNode.replaceChild(newSave, saveBtn);

        newSave.addEventListener('click', async () => {
            if (!state.moveTarget) return;
            if (state.moveDestPath === null) {
                showNotification('Selecciona una carpeta destino', 'info');
                return;
            }

            const { img: moveImg, card: moveCard } = state.moveTarget;
            try {
                const parentHandle = state.directoryHandles.get(state.currentPath);
                const targetHandle = state.directoryHandles.get(state.moveDestPath);

                if (typeof moveImg.handle.move === 'function') {
                    await moveImg.handle.move(targetHandle, moveImg.name);
                } else {
                    const file = await moveImg.handle.getFile();
                    const newFileHandle = await targetHandle.getFileHandle(moveImg.name, { create: true });
                    const writable = await newFileHandle.createWritable();
                    await writable.write(file);
                    await writable.close();
                    await parentHandle.removeEntry(moveImg.name);
                }

                q('ip-move-modal').classList.remove('active');
                removeImageFromState(moveImg.path);
                URL.revokeObjectURL(moveImg.url);

                if (moveCard) {
                    moveCard.style.transition = 'opacity 0.2s, transform 0.2s';
                    moveCard.style.opacity = '0';
                    moveCard.style.transform = 'scale(0.8)';
                    setTimeout(() => {
                        moveCard.remove();
                        q('ip-count').textContent = `${state.filtered.length} imagen${state.filtered.length === 1 ? '' : 'es'}`;
                    }, 200);
                } else {
                    renderGallery();
                }
                showNotification('Imagen movida', 'success', true);
            } catch (e) {
                console.error(e);
                showNotification('Error al mover imagen', 'error');
            }
        });
    }

    function confirmDeleteImage(img, card) {
        q('ip-confirm-title').textContent = '¿Eliminar imagen?';
        q('ip-confirm-desc').textContent = `Se eliminara permanentemente "${img.name}" de tu disco local. Esta accion no se puede deshacer.`;
        q('ip-confirm-modal').classList.add('active');

        const okBtn = q('ip-confirm-ok');
        const newOk = okBtn.cloneNode(true);
        okBtn.parentNode.replaceChild(newOk, okBtn);

        newOk.addEventListener('click', async () => {
            try {
                const parentHandle = state.directoryHandles.get(state.currentPath);
                await parentHandle.removeEntry(img.name);
                URL.revokeObjectURL(img.url);

                q('ip-confirm-modal').classList.remove('active');
                removeImageFromState(img.path);
                if (card) {
                    card.style.transition = 'opacity 0.2s, transform 0.2s';
                    card.style.opacity = '0';
                    card.style.transform = 'scale(0.8)';
                    setTimeout(() => {
                        card.remove();
                        q('ip-count').textContent = `${state.filtered.length} imagen${state.filtered.length === 1 ? '' : 'es'}`;
                    }, 200);
                } else {
                    renderGallery();
                }
                closeLightbox();
                showNotification('Imagen eliminada', 'success');
            } catch (e) {
                console.error(e);
                showNotification('Error al eliminar', 'error');
            }
        });
    }

    async function openImageAdminModal() {
        const img = state.filtered[state.lbIndex];
        if (!img) return;

        q('ip-admin-name').value = img.name || '';
        q('ip-admin-relpath').value = img.path || '';
        q('ip-admin-modal').classList.add('active');
    }

    function showCreateFolder(parentPath) {
        q('ip-folder-modal-title').textContent = '📁 Nueva carpeta';
        q('ip-folder-modal-desc').textContent = parentPath === '.' ? 'Crear en la carpeta raiz' : `Crear en: ${parentPath}`;
        q('ip-folder-modal-save').textContent = 'Crear';
        q('ip-folder-name-input').value = '';
        q('ip-folder-modal').classList.add('active');

        setTimeout(() => q('ip-folder-name-input').focus(), 50);

        const saveBtn = q('ip-folder-modal-save');
        const newSave = saveBtn.cloneNode(true);
        saveBtn.parentNode.replaceChild(newSave, saveBtn);

        newSave.addEventListener('click', async () => {
            const name = q('ip-folder-name-input').value.trim();
            if (!name) return;

            try {
                const parentHandle = state.directoryHandles.get(parentPath);
                await parentHandle.getDirectoryHandle(name, { create: true });

                q('ip-folder-modal').classList.remove('active');
                await initializeDirectory();
                showNotification('Carpeta creada', 'success', true);
            } catch (e) {
                console.error(e);
                showNotification('Error al crear carpeta', 'error');
            }
        });
    }

    function confirmDeleteFolder(node) {
        q('ip-confirm-title').textContent = '¿Eliminar carpeta?';
        q('ip-confirm-desc').textContent = `Se eliminara permanentemente "${node.name}" y todo su contenido local.`;
        q('ip-confirm-modal').classList.add('active');

        const okBtn = q('ip-confirm-ok');
        const newOk = okBtn.cloneNode(true);
        okBtn.parentNode.replaceChild(newOk, okBtn);

        newOk.addEventListener('click', async () => {
            try {
                const parentPath = node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/')) : '.';
                const parentHandle = state.directoryHandles.get(parentPath);
                await parentHandle.removeEntry(node.name, { recursive: true });

                q('ip-confirm-modal').classList.remove('active');

                if (state.currentPath === node.path) {
                    state.currentPath = null;
                    state.images = [];
                    state.filtered = [];
                    renderEmpty('Selecciona una carpeta del panel izquierdo');
                    q('ip-folder-path').textContent = 'Selecciona una carpeta';
                    localStorage.setItem('imageLastFolder', '.');
                }

                await initializeDirectory();
                showNotification('Carpeta eliminada', 'success');
            } catch (e) {
                console.error(e);
                showNotification('Error al eliminar carpeta', 'error');
            }
        });
    }

    function openConfigModal() {
        q('ip-cfg-modal').classList.add('active');
        if (state.rootHandle) {
            q('ip-cfg-selected-name').textContent = `Carpeta actual: ${state.rootHandle.name}`;
            q('ip-cfg-selected-name').style.display = 'block';
        } else {
            q('ip-cfg-selected-name').style.display = 'none';
        }
    }

    // --- Vinculación de Eventos ---
    function bindEvents() {
        q('ip-search').addEventListener('input', applyFilter);
        q('ip-sort').addEventListener('change', applyFilter);
        q('ip-bulk-toggle').addEventListener('click', () => toggleSelectionMode());
        q('ip-bulk-select-all').addEventListener('click', toggleSelectAllVisible);
        q('ip-bulk-delete').addEventListener('click', confirmDeleteSelectedImages);

        q('ip-cfg-btn').addEventListener('click', openConfigModal);

        // Selector nativo de directorio
        q('ip-cfg-select-btn').addEventListener('click', async () => {
            try {
                const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
                state.rootHandle = handle;
                await saveHandle('root_directory', handle);
                q('ip-cfg-selected-name').textContent = `Carpeta: ${handle.name}`;
                q('ip-cfg-selected-name').style.display = 'block';
                q('ip-media-path-label').textContent = handle.name;
                q('ip-permission-banner').style.display = 'none';
                q('ip-cfg-modal').classList.remove('active');
                await initializeDirectory();
                showNotification('Carpeta de imágenes guardada', 'success', true);
            } catch (e) {
                if (e.name !== 'AbortError') {
                    console.error(e);
                    showNotification('Error al seleccionar carpeta', 'error');
                }
            }
        });

        // Banner de concesión de permisos interactiva
        q('ip-grant-permission-btn').addEventListener('click', async () => {
            if (!state.rootHandle) return;
            try {
                const permission = await state.rootHandle.requestPermission({ mode: 'readwrite' });
                if (permission === 'granted') {
                    q('ip-permission-banner').style.display = 'none';
                    await initializeDirectory();
                    showNotification('Permiso concedido', 'success');
                }
            } catch (e) {
                console.error(e);
                showNotification('No se pudo obtener permiso', 'error');
            }
        });

        document.querySelectorAll('.ip-modal-close[data-close-modal]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const modalId = btn.getAttribute('data-close-modal');
                const modal = modalId ? q(modalId) : null;
                if (modal) modal.classList.remove('active');
            });
        });
        q('ip-cfg-cancel').addEventListener('click', () => q('ip-cfg-modal').classList.remove('active'));
        q('ip-cfg-modal').addEventListener('click', (e) => {
            if (e.target === q('ip-cfg-modal')) q('ip-cfg-modal').classList.remove('active');
        });

        q('ip-lb-close').addEventListener('click', closeLightbox);
        q('ip-lb-prev').addEventListener('click', () => {
            if (state.lbIndex > 0) {
                state.lbIndex -= 1;
                state.zoom = 1;
                state.panX = 0;
                state.panY = 0;
                renderLightbox();
            }
        });
        q('ip-lb-next').addEventListener('click', () => {
            if (state.lbIndex < state.filtered.length - 1) {
                state.lbIndex += 1;
                state.zoom = 1;
                state.panX = 0;
                state.panY = 0;
                renderLightbox();
            }
        });

        q('ip-lb-zoom-in').addEventListener('click', () => zoomBy(0.25));
        q('ip-lb-zoom-out').addEventListener('click', () => zoomBy(-0.25));
        q('ip-lb-zoom-pct').addEventListener('click', () => {
            state.zoom = 1;
            state.panX = 0;
            state.panY = 0;
            applyTransform();
        });
        q('ip-lb-fit').addEventListener('click', () => {
            state.zoom = 1;
            state.panX = 0;
            state.panY = 0;
            applyTransform();
        });

        q('ip-lb-admin').addEventListener('click', async () => {
            await openImageAdminModal();
        });

        q('ip-lb-rename').addEventListener('click', () => {
            const img = state.filtered[state.lbIndex];
            if (!img) return;
            const card = document.querySelector(`.ip-thumb[data-path="${CSS.escape(img.path)}"]`);
            const nameEl = card ? card.querySelector('.ip-thumb-name') : null;
            showRenameImage(img, nameEl, card);
        });

        q('ip-lb-move').addEventListener('click', async () => {
            const img = state.filtered[state.lbIndex];
            if (!img) return;
            const card = document.querySelector(`.ip-thumb[data-path="${CSS.escape(img.path)}"]`);
            await showMoveImage(img, card);
        });

        q('ip-lb-delete').addEventListener('click', () => {
            const img = state.filtered[state.lbIndex];
            if (!img) return;
            const card = document.querySelector(`.ip-thumb[data-path="${CSS.escape(img.path)}"]`);
            confirmDeleteImage(img, card);
        });

        q('ip-lb-stage').addEventListener('wheel', (e) => {
            e.preventDefault();
            zoomBy(e.deltaY < 0 ? 0.15 : -0.15, e.clientX, e.clientY);
        }, { passive: false });

        const wrap = q('ip-lb-img-wrap');
        wrap.addEventListener('mousedown', (e) => {
            if (state.zoom <= 1) return;
            state.dragging = true;
            state.dragStart = { x: e.clientX - state.panX, y: e.clientY - state.panY };
            q('ip-lb-img').classList.add('panning');
        });

        document.addEventListener('mousemove', (e) => {
            if (!state.dragging) return;
            state.panX = e.clientX - state.dragStart.x;
            state.panY = e.clientY - state.dragStart.y;
            applyTransform();
        });

        document.addEventListener('mouseup', () => {
            if (!state.dragging) return;
            state.dragging = false;
            q('ip-lb-img').classList.remove('panning');
        });

        q('ip-lb-stage').addEventListener('click', (e) => {
            if (e.target === q('ip-lb-stage') || e.target === q('ip-lb-img-wrap')) {
                closeLightbox();
            }
        });

        q('ip-rename-cancel').addEventListener('click', () => q('ip-rename-modal').classList.remove('active'));
        q('ip-rename-modal').addEventListener('click', (e) => {
            if (e.target === q('ip-rename-modal')) q('ip-rename-modal').classList.remove('active');
        });

        q('ip-move-cancel').addEventListener('click', () => q('ip-move-modal').classList.remove('active'));
        q('ip-move-modal').addEventListener('click', (e) => {
            if (e.target === q('ip-move-modal')) q('ip-move-modal').classList.remove('active');
        });

        q('ip-folder-modal-cancel').addEventListener('click', () => q('ip-folder-modal').classList.remove('active'));
        q('ip-folder-modal').addEventListener('click', (e) => {
            if (e.target === q('ip-folder-modal')) q('ip-folder-modal').classList.remove('active');
        });

        q('ip-confirm-cancel').addEventListener('click', () => q('ip-confirm-modal').classList.remove('active'));
        q('ip-confirm-modal').addEventListener('click', (e) => {
            if (e.target === q('ip-confirm-modal')) q('ip-confirm-modal').classList.remove('active');
        });

        q('ip-rename-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') q('ip-rename-save').click();
        });
        q('ip-folder-name-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') q('ip-folder-modal-save').click();
        });

        q('ip-admin-close').addEventListener('click', () => {
            q('ip-admin-modal').classList.remove('active');
        });

        q('ip-admin-modal').addEventListener('click', (e) => {
            if (e.target === q('ip-admin-modal')) q('ip-admin-modal').classList.remove('active');
        });

        q('ip-admin-copy-path').addEventListener('click', async () => {
            const path = q('ip-admin-relpath').value;
            if (!path) return;
            try {
                await navigator.clipboard.writeText(path);
                showNotification('Ruta relativa copiada', 'success');
            } catch (_e) {
                showNotification('No se pudo copiar la ruta', 'error');
            }
        });

        q('ip-admin-rename').addEventListener('click', () => {
            const img = state.filtered[state.lbIndex];
            if (!img) return;
            const card = document.querySelector(`.ip-thumb[data-path="${CSS.escape(img.path)}"]`);
            const nameEl = card ? card.querySelector('.ip-thumb-name') : null;
            q('ip-admin-modal').classList.remove('active');
            showRenameImage(img, nameEl, card);
        });

        q('ip-admin-move').addEventListener('click', async () => {
            const img = state.filtered[state.lbIndex];
            if (!img) return;
            const card = document.querySelector(`.ip-thumb[data-path="${CSS.escape(img.path)}"]`);
            q('ip-admin-modal').classList.remove('active');
            await showMoveImage(img, card);
        });

        q('ip-admin-delete').addEventListener('click', () => {
            const img = state.filtered[state.lbIndex];
            if (!img) return;
            const card = document.querySelector(`.ip-thumb[data-path="${CSS.escape(img.path)}"]`);
            q('ip-admin-modal').classList.remove('active');
            confirmDeleteImage(img, card);
        });
    }

    window.addEventListener('DOMContentLoaded', async () => {
        bindEvents();
        bindContextMenu();
        await bootstrap();
    });
})();
