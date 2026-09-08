// Gallery Panel - Detector de Duplicados de Videos (embebido en videoplayer.html)
(function() {
    'use strict';

    const DB_NAME = 'videoplayer-db';
    const STORE_NAME = 'handles';

    const localState = {
        rootHandle: null,
        directoryHandles: new Map(),
        objectUrls: new Set(),
        allVideos: [],
        filteredVideos: [],
        currentFilter: 'all',
        videosById: new Map(),
        duplicateGroups: [],
        videoTags: {},
        currentTaggingVideo: null,
        currentMovingVideo: null,
        currentDeletingVideo: null,
        selectedMoveFolder: null,
        scopePath: '.',   // carpeta desde la que se escanea (incluye subcarpetas)
        initialized: false,
        listenersBound: false
    };

    function isPanelVisible() {
        const panel = document.getElementById('gallery-panel');
        return !!panel && getComputedStyle(panel).display !== 'none';
    }

    function notify(message, type = 'info') {
        if (typeof window.showNotification === 'function') {
            window.showNotification(message, type, false);
        } else {
            console.log(`[${type}] ${message}`);
        }
    }

    // ═══════════ Miniaturas: caché + cola con concurrencia limitada ═══════════
    const THUMB_STORE = 'thumbnails';
    const MAX_CONCURRENT_THUMBS = 2;
    // Versión de la clave de caché: al cambiar la estrategia de captura se sube
    // este número para que las miniaturas antiguas (tomadas en la intro) se regeneren.
    const THUMB_CACHE_VERSION = 'v3';
    const thumbnailCache = new Map();   // clave estable (path|size|mtime) -> dataUrl
    const thumbQueue = [];
    let activeThumbJobs = 0;
    let thumbObserver = null;

    // Clave de caché compartida entre la galería y la lista del reproductor:
    // ruta + tamaño. Es estable entre sesiones (a diferencia de una blob URL) y
    // ambos lados disponen de esos dos datos, así que una miniatura generada en
    // un sitio se reutiliza en el otro.
    function thumbKeyFor(source) {
        const path = String(source.path || source.name || '').replace(/^\.\//, '');
        return `${THUMB_CACHE_VERSION}|${path}|${source.size || 0}`;
    }

    async function thumbDbGet(key) {
        try {
            if (window.vpDbManager && window.vpDbManager.db) {
                return await window.vpDbManager.get(THUMB_STORE, key);
            }
        } catch (_e) { /* no-op */ }
        return null;
    }

    function thumbDbPut(key, dataUrl) {
        try {
            if (window.vpDbManager && window.vpDbManager.db) {
                // El store usa keyPath 'url'; guardamos ahí nuestra clave estable
                window.vpDbManager.put(THUMB_STORE, { url: key, dataUrl });
            }
        } catch (_e) { /* no-op */ }
    }

    // Posiciones (fracción de la duración) donde se intenta capturar el fotograma
    const THUMB_SEEK_FRACTIONS = [0.25, 0.55];
    const THUMB_MIN_SECONDS = 30;    // evitar intros/títulos del comienzo
    const THUMB_MAX_SECONDS = 900;   // tope por rendimiento en videos muy largos
    const THUMB_DARK_THRESHOLD = 20; // luminancia media por debajo de esto = fotograma negro

    // Segundo "representativo" del video, evitando intro y créditos finales.
    // Lo usan tanto la captura de miniaturas como la vista previa al pasar el ratón.
    function representativeOffset(duration, index = 0) {
        if (!duration) return index === 0 ? THUMB_MIN_SECONDS : THUMB_MIN_SECONDS * 2;
        // Videos muy cortos: no hay margen para saltar la intro
        if (duration <= THUMB_MIN_SECONDS) {
            return duration * (index === 0 ? 0.5 : 0.75);
        }
        let t = duration * THUMB_SEEK_FRACTIONS[index];
        t = Math.max(t, Math.min(THUMB_MIN_SECONDS, duration * 0.5));
        t = Math.min(t, duration - 3, THUMB_MAX_SECONDS);
        return Math.max(t, 1);
    }

    // Luminancia media del fotograma (muestreada) para descartar pantallas negras
    function averageBrightness(ctx, width, height) {
        try {
            const data = ctx.getImageData(0, 0, width, height).data;
            let sum = 0;
            let count = 0;
            // Muestrear 1 de cada 16 píxeles: suficiente y mucho más rápido
            for (let i = 0; i < data.length; i += 4 * 16) {
                sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
                count++;
            }
            return count > 0 ? sum / count : 255;
        } catch (_e) {
            return 255; // si no se puede leer, asumimos que el fotograma sirve
        }
    }

    // Extrae un fotograma representativo del video (no de la introducción)
    function grabVideoFrame(objectUrl) {
        return new Promise((resolve) => {
            const v = document.createElement('video');
            let settled = false;
            let attempt = 0;
            let duration = 0;
            let best = null; // { dataUrl, brightness }

            const finish = (value) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                try {
                    v.removeAttribute('src');
                    v.load();
                } catch (_e) { /* no-op */ }
                resolve(value);
            };

            const timer = setTimeout(() => {
                finish(best ? best.dataUrl : null);
            }, 15000);

            v.preload = 'metadata';
            v.muted = true;
            v.playsInline = true;

            function seekToAttempt() {
                const target = representativeOffset(duration, attempt);
                if (!isFinite(target) || target <= 0) return captureFrame();
                try {
                    v.currentTime = target;
                } catch (_e) {
                    captureFrame();
                }
            }

            v.addEventListener('loadeddata', () => {
                duration = (isFinite(v.duration) && v.duration > 0) ? v.duration : 0;
                seekToAttempt();
            });

            v.addEventListener('seeked', captureFrame);
            v.addEventListener('error', () => finish(best ? best.dataUrl : null));

            function captureFrame() {
                try {
                    if (!v.videoWidth) return finish(best ? best.dataUrl : null);

                    const canvas = document.createElement('canvas');
                    const width = 320;
                    const height = Math.round(width * (v.videoHeight / v.videoWidth)) || 180;
                    canvas.width = width;
                    canvas.height = height;

                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(v, 0, 0, width, height);

                    const brightness = averageBrightness(ctx, width, height);
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.6);

                    if (!best || brightness > best.brightness) {
                        best = { dataUrl, brightness };
                    }

                    // Si salió una pantalla negra, probar otra posición del video
                    if (brightness < THUMB_DARK_THRESHOLD && attempt < THUMB_SEEK_FRACTIONS.length - 1) {
                        attempt++;
                        seekToAttempt();
                        return;
                    }

                    finish(best.dataUrl);
                } catch (e) {
                    finish(best ? best.dataUrl : null);
                }
            }

            v.src = objectUrl;
        });
    }

    function paintThumb(thumbEl, dataUrl) {
        if (!thumbEl) return;
        // Quitar solo el placeholder / miniatura previa, conservando el badge de duplicado
        thumbEl.querySelectorAll('.placeholder, img').forEach(el => el.remove());
        const img = document.createElement('img');
        img.src = dataUrl;
        img.alt = '';
        // Sin esto el navegador arrastra la imagen (su data URI) en vez de la tarjeta
        img.draggable = false;
        thumbEl.insertBefore(img, thumbEl.firstChild);
    }

    // Núcleo compartido: devuelve el dataUrl de la miniatura resolviendo en
    // orden caché en memoria → IndexedDB → captura del fotograma.
    // Acepta un handle (galería) o una blob URL ya viva (reproductor).
    async function getOrCreateThumbnail(source) {
        const key = thumbKeyFor(source);

        if (thumbnailCache.has(key)) return thumbnailCache.get(key);

        const cached = await thumbDbGet(key);
        if (cached && cached.dataUrl) {
            thumbnailCache.set(key, cached.dataUrl);
            return cached.dataUrl;
        }

        let objectUrl = source.url || null;
        let createdHere = false;
        try {
            if (!objectUrl && source.handle && typeof source.handle.getFile === 'function') {
                const file = await source.handle.getFile();
                objectUrl = URL.createObjectURL(file);
                createdHere = true;
            }
            if (!objectUrl) return null;

            const dataUrl = await grabVideoFrame(objectUrl);
            if (dataUrl) {
                thumbnailCache.set(key, dataUrl);
                thumbDbPut(key, dataUrl);
            }
            return dataUrl;
        } catch (e) {
            console.warn(`No se pudo generar miniatura de ${source.name}:`, e);
            return null;
        } finally {
            if (createdHere && objectUrl) URL.revokeObjectURL(objectUrl);
        }
    }

    // Expuesto para que la lista de reproducción del reproductor use el mismo
    // motor de captura (fotograma representativo, descarte de negros y caché).
    window.vpThumbnails = {
        cached: (source) => thumbnailCache.get(thumbKeyFor(source)) || null,
        generate: getOrCreateThumbnail
    };

    async function generateThumbnail(video, thumbEl) {
        const dataUrl = await getOrCreateThumbnail(video);
        if (dataUrl) paintThumb(thumbEl, dataUrl);
    }


    function pumpThumbQueue() {
        while (activeThumbJobs < MAX_CONCURRENT_THUMBS && thumbQueue.length > 0) {
            const job = thumbQueue.shift();
            if (!job.thumbEl.isConnected) continue;
            activeThumbJobs++;
            generateThumbnail(job.video, job.thumbEl).finally(() => {
                activeThumbJobs--;
                pumpThumbQueue();
            });
        }
    }

    function resetThumbQueue() {
        thumbQueue.length = 0;
        if (thumbObserver) thumbObserver.disconnect();
        stopPreview(); // las tarjetas se van a reemplazar: cortar cualquier preview
    }

    function ensureThumbObserver() {
        if (thumbObserver) return thumbObserver;
        thumbObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                const thumbEl = entry.target;
                thumbObserver.unobserve(thumbEl);
                const video = localState.videosById.get(thumbEl.dataset.videoId);
                if (video) {
                    thumbQueue.push({ video, thumbEl });
                    pumpThumbQueue();
                }
            });
        }, {
            root: document.getElementById('gallery-panel'),
            rootMargin: '300px 0px'
        });
        return thumbObserver;
    }

    // ═══════════ Vista previa al mantener el ratón sobre una tarjeta ═══════════
    const PREVIEW_DELAY_MS = 1000;
    const PREVIEW_PLAYBACK_RATE = 1.5;  // algo más rápido que la velocidad normal
    let previewTimer = null;
    let hoveredCard = null;
    let activePreview = null; // { videoEl, objectUrl, thumbEl }
    let previewToken = 0;     // invalida cargas en vuelo al cancelar

    function stopPreview() {
        previewToken++;
        if (previewTimer) {
            clearTimeout(previewTimer);
            previewTimer = null;
        }
        if (!activePreview) return;

        const { videoEl, objectUrl, thumbEl } = activePreview;
        activePreview = null;

        try {
            videoEl.pause();
            videoEl.removeAttribute('src');
            videoEl.load();
        } catch (_e) { /* no-op */ }
        videoEl.remove();
        if (objectUrl) URL.revokeObjectURL(objectUrl);

        // Volver a mostrar la miniatura estática
        if (thumbEl) {
            thumbEl.querySelectorAll('img, .placeholder').forEach(el => { el.style.visibility = ''; });
        }
    }

    async function startPreview(video, thumbEl, card, token) {
        let objectUrl = null;
        try {
            const file = await video.handle.getFile();

            // El ratón pudo salir (o cambiar de tarjeta) mientras se abría el archivo
            if (previewToken !== token || hoveredCard !== card || !thumbEl.isConnected) return;

            objectUrl = URL.createObjectURL(file);

            const videoEl = document.createElement('video');
            videoEl.className = 'gallery-preview-video';
            videoEl.muted = true;      // sin sonido, como pediste
            videoEl.loop = true;
            videoEl.playsInline = true;
            videoEl.preload = 'auto';

            videoEl.addEventListener('loadeddata', () => {
                if (previewToken !== token) return; // cancelado mientras cargaba
                // Arrancar en la parte representativa, no en la intro
                const target = representativeOffset(
                    (isFinite(videoEl.duration) && videoEl.duration > 0) ? videoEl.duration : 0
                );
                if (target > 0) {
                    try { videoEl.currentTime = target; } catch (_e) { /* no-op */ }
                }
                // La velocidad se fija aquí: cambiar el src la restablece a 1
                videoEl.playbackRate = PREVIEW_PLAYBACK_RATE;
                videoEl.play().catch(() => { /* autoplay silenciado: ignorar */ });
                // Ocultar la miniatura estática ya que el video está listo
                thumbEl.querySelectorAll('img, .placeholder').forEach(el => { el.style.visibility = 'hidden'; });
            });

            videoEl.addEventListener('error', stopPreview);

            videoEl.src = objectUrl;
            thumbEl.appendChild(videoEl);
            activePreview = { videoEl, objectUrl, thumbEl };
        } catch (e) {
            console.warn(`No se pudo previsualizar ${video.name}:`, e);
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        }
    }

    function attachPreviewHandlers(card, thumbEl, video) {
        card.addEventListener('mouseenter', () => {
            hoveredCard = card;
            stopPreview(); // cancela cualquier preview anterior y su temporizador
            const token = previewToken; // token vigente tras la cancelación
            previewTimer = setTimeout(() => {
                if (hoveredCard === card && previewToken === token) {
                    startPreview(video, thumbEl, card, token);
                }
            }, PREVIEW_DELAY_MS);
        });

        card.addEventListener('mouseleave', () => {
            if (hoveredCard === card) hoveredCard = null;
            stopPreview();
        });
    }

    // ═══════════ Ordenamiento sincronizado con el selector lateral ═══════════
    function getSortCriteria() {
        const select = document.getElementById('sort-select');
        return (select && select.value) || 'name-asc';
    }

    function sortVideoList(list) {
        const criteria = getSortCriteria();
        return list.slice().sort((a, b) => {
            switch (criteria) {
                case 'name-desc': return b.name.localeCompare(a.name);
                case 'date-desc': return b.mtime - a.mtime;
                case 'date-asc':  return a.mtime - b.mtime;
                case 'size-desc': return b.size - a.size;
                case 'size-asc':  return a.size - b.size;
                case 'name-asc':
                default:          return a.name.localeCompare(b.name);
            }
        });
    }

    // ========== IndexedDB Helpers ==========
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

    function getFileExtension(filename) {
        return filename.toLowerCase().split('.').pop();
    }

    async function buildVideoFolderTree(dirHandle, currentPath = '.') {
        const children = [];
        localState.directoryHandles.set(currentPath, dirHandle);

        try {
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
        } catch (e) {
            console.warn(`Error al leer directorio ${currentPath}:`, e);
        }

        children.sort((a, b) => a.name.localeCompare(b.name));
        return { name: dirHandle.name, path: currentPath, children, handle: dirHandle };
    }

    // ========== Video Scanning ==========
    async function scanVideosInFolder(dirHandle, folderPath = '.') {
        const videoList = [];
        const supportedVideoExts = ['mp4', 'webm', 'ogg', 'm3u8', 'mov', 'mkv', 'avi'];

        try {
            for await (const entry of dirHandle.values()) {
                if (entry.kind === 'file') {
                    const ext = getFileExtension(entry.name);
                    if (supportedVideoExts.includes(ext)) {
                        try {
                            const file = await entry.getFile();
                            const videoPath = folderPath === '.' ? entry.name : `${folderPath}/${entry.name}`;

                            const video = {
                                id: `${videoPath}|${file.size}|${file.lastModified}`,
                                name: entry.name,
                                path: videoPath,
                                folderPath: folderPath,
                                size: file.size,
                                mtime: file.lastModified,
                                sizeStr: formatFileSize(file.size),
                                handle: entry,
                                url: null
                            };
                            videoList.push(video);
                        } catch (e) {
                            console.warn(`Error al procesar ${entry.name}:`, e);
                        }
                    }
                } else if (entry.kind === 'directory') {
                    const relPath = folderPath === '.' ? entry.name : `${folderPath}/${entry.name}`;
                    const subVideos = await scanVideosInFolder(entry, relPath);
                    videoList.push(...subVideos);
                }
            }
        } catch (e) {
            console.warn(`Error al escanear ${folderPath}:`, e);
        }

        return videoList;
    }

    // Carpeta seleccionada en el árbol lateral; '.' es la raíz de la biblioteca
    function getActiveFolderPath() {
        const active = document.querySelector('.folder-item.active');
        const path = active && active.dataset ? active.dataset.path : null;
        return path || '.';
    }

    function updateScopeLabel() {
        const label = document.getElementById('gallery-scope-label');
        if (!label) return;
        const scope = localState.scopePath;
        label.textContent = (scope === '.')
            ? 'Toda la biblioteca · incluye subcarpetas'
            : `Carpeta: ${scope} · incluye subcarpetas`;
    }

    async function loadAllVideos() {
        localState.allVideos = [];
        localState.videosById.clear();
        localState.directoryHandles.clear();

        if (!localState.rootHandle) return [];

        try {
            // El árbol completo siempre se recorre: sus handles alimentan el
            // modal "Mover", que debe poder llevar un video a cualquier carpeta.
            await buildVideoFolderTree(localState.rootHandle, '.');

            // El escaneo de videos, en cambio, se limita a la carpeta activa.
            localState.scopePath = getActiveFolderPath();
            const scopeHandle = localState.directoryHandles.get(localState.scopePath);
            if (!scopeHandle) {
                // La carpeta activa ya no existe (renombrada o borrada): volver a la raíz
                localState.scopePath = '.';
            }
            updateScopeLabel();

            const startHandle = localState.directoryHandles.get(localState.scopePath) || localState.rootHandle;
            const videos = await scanVideosInFolder(startHandle, localState.scopePath);

            // Las URLs de objeto se crean bajo demanda al generar cada miniatura,
            // así no se mantienen cientos de blobs vivos a la vez.
            videos.forEach(video => localState.videosById.set(video.id, video));

            localState.allVideos = videos;
            return videos;
        } catch (e) {
            console.error('Error al cargar videos:', e);
            notify('Error al escanear videos: ' + e.message, 'error');
            return [];
        }
    }

    // ========== Tags Management (comparte almacenamiento con el reproductor) ==========
    // MISMA clave que videoplayer.js: la ruta relativa del archivo. Antes la
    // galería usaba "ruta|tamaño|fecha", incompatible con el reproductor, así
    // que las etiquetas puestas en un sitio no aparecían en el otro.
    function tagKeyOf(video) {
        return String(video.path || video.name || '').replace(/^\.\//, '');
    }

    // Las etiquetas ya no se leen/escriben aquí: viven en un archivo dentro de
    // la carpeta raíz y el reproductor es quien lo gestiona. La galería trabaja
    // sobre una copia y la devuelve entera al guardar.
    async function loadTags() {
        try {
            localState.videoTags = (window.vpTags && window.vpTags.all()) || {};
        } catch (e) {
            console.warn('No se pudieron leer las etiquetas:', e);
            localState.videoTags = {};
        }
    }

    async function saveTags() {
        try {
            if (!window.vpTags) {
                notify('No se pudieron guardar las etiquetas', 'error');
                return;
            }
            await window.vpTags.replace(localState.videoTags);
        } catch (e) {
            console.error('Error al guardar etiquetas:', e);
            notify('Error al guardar etiquetas', 'error');
        }
    }

    // ========== Duplicate Detection (por tamaño y por nombre) ==========

    // Normaliza el nombre para comparar: sin extensión, en minúsculas y sin
    // marcas típicas de copia. NO se quitan dígitos sueltos del final porque
    // "movie2.mp4" y "movie3.mp4" suelen ser videos distintos, no copias.
    function normalizeName(name) {
        let n = String(name).toLowerCase().trim();
        n = n.replace(/\.[a-z0-9]{2,5}$/, '');            // extensión
        n = n.replace(/\s*\(\d+\)\s*$/, '');              // "video (1)"
        n = n.replace(/\s*[-_]\s*(copia|copy)\s*$/, '');  // "video - copia"
        n = n.replace(/^(copia de|copy of)\s+/, '');      // "Copia de video"
        n = n.replace(/\s+/g, ' ').trim();
        return n;
    }

    function detectDuplicates(videos) {
        const bySize = new Map();
        const byName = new Map();

        videos.forEach(video => {
            if (video.size > 0) {
                if (!bySize.has(video.size)) bySize.set(video.size, []);
                bySize.get(video.size).push(video);
            }
            const normalized = normalizeName(video.name);
            if (normalized) {
                if (!byName.has(normalized)) byName.set(normalized, []);
                byName.get(normalized).push(video);
            }
        });

        const groups = [];
        const signatureIndex = new Map(); // firma del conjunto -> índice del grupo

        const signatureOf = (list) => list.map(v => v.id).sort().join('~');

        const addGroup = (list, reason, detail) => {
            if (list.length < 2) return;

            const signature = signatureOf(list);
            // Si otro criterio ya detectó exactamente el mismo conjunto,
            // no se duplica el grupo: se refuerza indicando ambos motivos.
            if (signatureIndex.has(signature)) {
                const existing = groups[signatureIndex.get(signature)];
                if (!existing.reasons.includes(reason)) {
                    existing.reasons.push(reason);
                    existing.details.push(detail);
                }
                return;
            }

            signatureIndex.set(signature, groups.length);
            groups.push({
                reasons: [reason],
                details: [detail],
                count: list.length,
                videos: list.slice().sort((a, b) => a.name.localeCompare(b.name)),
                totalSize: list.reduce((sum, v) => sum + v.size, 0)
            });
        };

        bySize.forEach((list, size) => addGroup(list, 'tamaño', `Tamaño idéntico: ${formatFileSize(size)}`));
        byName.forEach((list, name) => addGroup(list, 'nombre', `Nombre base: "${name}"`));

        // Coincidencias en ambos criterios primero (señal más fuerte), luego las más numerosas
        groups.sort((a, b) => (b.reasons.length - a.reasons.length) || (b.count - a.count));

        const duplicateVideoIds = new Set();
        groups.forEach(g => g.videos.forEach(v => duplicateVideoIds.add(v.id)));

        localState.duplicateGroups = groups;
        return { duplicateGroups: groups, duplicateVideoIds };
    }

    // ========== File Operations ==========
    async function deleteVideo(video) {
        try {
            const parts = video.path.split('/');
            const filename = parts.pop();
            const parentPath = parts.join('/') || '.';
            const parentHandle = localState.directoryHandles.get(parentPath);

            if (!parentHandle) {
                notify('No se puede acceder a la carpeta padre', 'error');
                return false;
            }

            await parentHandle.removeEntry(filename);

            const tagKey = tagKeyOf(video);
            if (localState.videoTags[tagKey]) {
                delete localState.videoTags[tagKey];
                await saveTags();
            }

            notify(`Video eliminado: ${video.name}`, 'success');
            return true;
        } catch (e) {
            console.error('Error al eliminar video:', e);
            notify('Error al eliminar: ' + e.message, 'error');
            return false;
        }
    }

    async function moveVideo(video, toFolderPath) {
        try {
            const parts = video.path.split('/');
            const filename = parts.pop();
            const fromFolderPath = parts.join('/') || '.';

            if (fromFolderPath === toFolderPath) {
                notify('El video ya está en esa carpeta', 'info');
                return false;
            }

            const fromHandle = localState.directoryHandles.get(fromFolderPath);
            const toHandle = localState.directoryHandles.get(toFolderPath);

            if (!fromHandle || !toHandle) {
                notify('No se puede acceder a las carpetas', 'error');
                return false;
            }

            const fileEntry = await fromHandle.getFileHandle(filename);
            const file = await fileEntry.getFile();
            const newFileHandle = await toHandle.getFileHandle(filename, { create: true });
            const writable = await newFileHandle.createWritable();
            await writable.write(file);
            await writable.close();
            await fromHandle.removeEntry(filename);

            // La ruta es la clave: al mover el archivo hay que migrarla
            const oldKey = tagKeyOf(video);
            const newKey = (!toFolderPath || toFolderPath === '.') ? filename : `${toFolderPath}/${filename}`;
            if (localState.videoTags[oldKey] && oldKey !== newKey) {
                const entry = localState.videoTags[oldKey];
                delete localState.videoTags[oldKey];
                if (localState.videoTags[newKey]) {
                    entry.tags.forEach(t => {
                        if (!localState.videoTags[newKey].tags.includes(t)) {
                            localState.videoTags[newKey].tags.push(t);
                        }
                    });
                } else {
                    entry.name = filename;
                    localState.videoTags[newKey] = entry;
                }
                await saveTags();
            }

            notify(`Video movido a: ${toFolderPath || 'Raíz'}`, 'success');
            return true;
        } catch (e) {
            console.error('Error al mover video:', e);
            notify('Error al mover: ' + e.message, 'error');
            return false;
        }
    }

    // ========== UI Helpers ==========
    function formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
    }

    function formatDate(timestamp) {
        return new Date(timestamp).toLocaleDateString('es-ES', {
            year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
    }

    // ========== Rendering ==========
    function renderGallery() {
        const content = document.getElementById('gallery-content');
        const videos = localState.currentFilter === 'all' ? localState.allVideos : localState.filteredVideos;

        // Cancelar miniaturas pendientes del render anterior
        resetThumbQueue();

        if (videos.length === 0) {
            content.innerHTML = `
                <div class="gallery-empty-state">
                    <div class="empty-state-icon">📭</div>
                    <h2>No hay videos</h2>
                    <p>No se encontraron videos en ${localState.currentFilter === 'duplicates' ? 'la búsqueda de duplicados' : 'tu biblioteca'}.</p>
                </div>
            `;
            return;
        }

        if (localState.currentFilter === 'duplicates') {
            renderDuplicatesView(content);
        } else {
            renderGridView(content, videos);
        }
    }

    function renderGridView(container, videos) {
        const grid = document.createElement('div');
        grid.className = 'gallery-grid';
        // Respeta el criterio de orden elegido en la lista lateral
        sortVideoList(videos).forEach(video => grid.appendChild(createVideoCard(video)));
        container.innerHTML = '';
        container.appendChild(grid);
    }

    function renderDuplicatesView(container) {
        container.innerHTML = '';

        if (localState.duplicateGroups.length === 0) {
            container.innerHTML = `
                <div class="gallery-empty-state">
                    <div class="empty-state-icon">✅</div>
                    <h2>¡Sin duplicados!</h2>
                    <p>Tu biblioteca de videos está limpia.</p>
                </div>
            `;
            return;
        }

        localState.duplicateGroups.forEach((group, groupIdx) => {
            const groupDiv = document.createElement('div');
            groupDiv.className = 'duplicate-group';

            const bothCriteria = group.reasons.length > 1;
            const reasonLabel = bothCriteria
                ? 'coinciden en nombre y tamaño'
                : (group.reasons[0] === 'tamaño' ? 'mismo tamaño de archivo' : 'mismo nombre de archivo');

            const title = document.createElement('div');
            title.className = 'duplicate-group-title';
            title.textContent = `${bothCriteria ? '🔴' : '⚠️'} Grupo ${groupIdx + 1}: ${group.count} videos — ${reasonLabel} (${formatFileSize(group.totalSize)} en total)`;

            const subtitle = document.createElement('div');
            subtitle.className = 'duplicate-group-subtitle';
            subtitle.textContent = group.details.join('  ·  ');

            const grid = document.createElement('div');
            grid.className = 'gallery-grid';
            sortVideoList(group.videos).forEach(video => grid.appendChild(createVideoCard(video, true)));

            groupDiv.appendChild(title);
            groupDiv.appendChild(subtitle);
            groupDiv.appendChild(grid);
            container.appendChild(groupDiv);
        });
    }

    // Sale de la galería y reproduce el video en el reproductor
    function playInPlayer(video) {
        if (typeof window.vpSelectAndPlayVideo !== 'function') return;
        // vpSelectAndPlayVideo cierra el panel antes de cambiar de carpeta
        window.vpSelectAndPlayVideo(video.folderPath, video.name);
    }

    function createVideoCard(video, isDuplicate = false) {
        const card = document.createElement('div');
        card.className = `video-card-gallery ${isDuplicate ? 'duplicate' : ''}`;
        card.dataset.videoId = video.id;

        const thumb = document.createElement('div');
        thumb.className = 'video-thumb-container';
        thumb.dataset.videoId = video.id;
        thumb.innerHTML = '<div class="placeholder">🎬</div>';

        // Miniatura desde caché si existe; si no, se genera al entrar en pantalla
        const cachedThumb = thumbnailCache.get(thumbKeyFor(video));
        if (cachedThumb) {
            paintThumb(thumb, cachedThumb);
        } else {
            ensureThumbObserver().observe(thumb);
        }

        if (isDuplicate) {
            const badge = document.createElement('div');
            badge.className = 'duplicate-badge';
            badge.textContent = '⚠️ DUPLICADO';
            thumb.appendChild(badge);
        }

        const info = document.createElement('div');
        info.className = 'video-info-gallery';

        const name = document.createElement('div');
        name.className = 'video-name-gallery';
        name.title = video.name;
        name.textContent = video.name;

        const meta = document.createElement('div');
        meta.className = 'video-meta';

        const tags = (localState.videoTags[tagKeyOf(video)] || {}).tags || [];
        const tagsHtml = tags.length > 0
            ? `<div style="margin-top:6px; display:flex; flex-wrap:wrap; gap:4px;">${tags.map(t => `<span style="background:var(--accent); color:white; padding:2px 6px; border-radius:3px; font-size:0.65rem;">${t}</span>`).join('')}</div>`
            : '';

        meta.innerHTML = `
            <div class="video-meta-item"><span class="video-meta-label">Carpeta:</span><span class="video-meta-value">${video.folderPath === '.' ? 'Raíz' : video.folderPath}</span></div>
            <div class="video-meta-item"><span class="video-meta-label">Tamaño:</span><span class="video-meta-value">${video.sizeStr}</span></div>
            <div class="video-meta-item"><span class="video-meta-label">Modificado:</span><span class="video-meta-value">${formatDate(video.mtime)}</span></div>
            ${tagsHtml}
        `;

        const actions = document.createElement('div');
        actions.className = 'video-actions';

        const tagBtn = document.createElement('button');
        tagBtn.className = 'action-btn';
        tagBtn.textContent = '🏷️ Etiquetar';
        tagBtn.addEventListener('click', (e) => { e.stopPropagation(); openTagModal(video); });

        const moveBtn = document.createElement('button');
        moveBtn.className = 'action-btn';
        moveBtn.textContent = '📁 Mover';
        moveBtn.addEventListener('click', (e) => { e.stopPropagation(); openMoveModal(video); });

        const viewBtn = document.createElement('button');
        viewBtn.className = 'action-btn';
        viewBtn.textContent = '👁️ Ver';
        viewBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            playInPlayer(video);
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'action-btn';
        deleteBtn.textContent = '🗑️ Eliminar';
        deleteBtn.addEventListener('click', (e) => { e.stopPropagation(); openDeleteModal(video); });

        actions.appendChild(tagBtn);
        actions.appendChild(moveBtn);
        actions.appendChild(viewBtn);
        actions.appendChild(deleteBtn);

        info.appendChild(name);
        info.appendChild(meta);
        info.appendChild(actions);
        card.appendChild(thumb);
        card.appendChild(info);

        // Clic en cualquier parte de la tarjeta (salvo los botones) = reproducir
        card.addEventListener('click', (e) => {
            if (e.target.closest('.video-actions')) return;
            playInPlayer(video);
        });

        // Vista previa muda tras mantener el ratón 3 s sobre la tarjeta
        attachPreviewHandlers(card, thumb, video);

        // Arrastrar la tarjeta sobre una carpeta del panel lateral para mover el archivo
        card.draggable = true;
        card.addEventListener('dragstart', (e) => {
            stopPreview();
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', JSON.stringify({
                source: 'gallery',
                filename: video.name,
                fromFolder: video.folderPath
            }));
            card.classList.add('dragging');
        });
        card.addEventListener('dragend', () => card.classList.remove('dragging'));

        return card;
    }

    function updateStats() {
        // Videos únicos implicados en algún grupo (un video puede coincidir por
        // tamaño con unos y por nombre con otros, y no debe contarse dos veces)
        const totalDuplicates = localState.filteredVideos.length;
        const totalSize = localState.allVideos.reduce((sum, v) => sum + v.size, 0);
        document.getElementById('stat-total').textContent = localState.allVideos.length;
        document.getElementById('stat-duplicates').textContent = totalDuplicates;
        document.getElementById('stat-size').textContent = formatFileSize(totalSize);
    }

    // ========== Modal: Etiquetas ==========
    function openTagModal(video) {
        localState.currentTaggingVideo = video;
        const currentTags = (localState.videoTags[tagKeyOf(video)] || {}).tags || [];

        document.getElementById('gallery-tag-modal-filename').textContent = `📄 ${video.name}`;

        const currentDiv = document.getElementById('gallery-tag-modal-current');
        currentDiv.innerHTML = currentTags.map(tag => `
            <div class="tag-chip" style="background:var(--accent); color:white; padding:4px 10px; border-radius:4px; font-size:0.85rem; display:flex; align-items:center; gap:6px;">
                ${tag}<span class="remove-tag-btn" data-tag="${tag}" style="cursor:pointer; font-weight:bold;">×</span>
            </div>
        `).join('');
        currentDiv.querySelectorAll('.remove-tag-btn').forEach(span => {
            span.addEventListener('click', () => removeTag(span.dataset.tag));
        });

        const allTagsSet = new Set();
        Object.values(localState.videoTags).forEach(v => { if (v.tags) v.tags.forEach(t => allTagsSet.add(t)); });
        const availableTags = Array.from(allTagsSet).filter(t => !currentTags.includes(t)).sort();

        const availableDiv = document.getElementById('gallery-tag-modal-available');
        availableDiv.innerHTML = availableTags.length > 0
            ? availableTags.map(tag => `<div class="tag-chip add-existing-tag-btn" data-tag="${tag}" style="background:var(--bg-secondary); color:var(--text-primary); padding:4px 10px; border-radius:4px; font-size:0.85rem; cursor:pointer; border:1px solid var(--glass-border);">${tag} +</div>`).join('')
            : '<span style="color:var(--text-secondary); font-size:0.8rem;">No hay otras etiquetas.</span>';
        availableDiv.querySelectorAll('.add-existing-tag-btn').forEach(chip => {
            chip.addEventListener('click', () => addExistingTag(chip.dataset.tag));
        });

        document.getElementById('gallery-tag-modal').style.display = 'flex';
    }

    function removeTag(tag) {
        if (!localState.currentTaggingVideo) return;
        const videoId = tagKeyOf(localState.currentTaggingVideo);
        if (localState.videoTags[videoId]) {
            localState.videoTags[videoId].tags = localState.videoTags[videoId].tags.filter(t => t !== tag);
        }
        openTagModal(localState.currentTaggingVideo);
    }

    function addExistingTag(tag) {
        if (!localState.currentTaggingVideo) return;
        const videoId = tagKeyOf(localState.currentTaggingVideo);
        if (!localState.videoTags[videoId]) {
            localState.videoTags[videoId] = { tags: [], name: localState.currentTaggingVideo.name };
        }
        if (!localState.videoTags[videoId].tags.includes(tag)) {
            localState.videoTags[videoId].tags.push(tag);
        }
        openTagModal(localState.currentTaggingVideo);
    }

    // ========== Modal: Eliminar ==========
    function openDeleteModal(video) {
        localState.currentDeletingVideo = video;
        document.getElementById('gallery-delete-modal-filename').textContent = `¿Eliminar "${video.name}"?`;
        document.getElementById('gallery-delete-modal').style.display = 'flex';
    }

    // ========== Modal: Mover ==========
    function openMoveModal(video) {
        localState.currentMovingVideo = video;
        localState.selectedMoveFolder = null;
        document.getElementById('gallery-move-modal-filename').textContent = `📄 ${video.name}`;

        const foldersDiv = document.getElementById('gallery-move-modal-folders');
        const folders = Array.from(localState.directoryHandles.keys()).sort();

        foldersDiv.innerHTML = folders.map(folderPath => {
            const displayName = folderPath === '.' ? '📁 Raíz' : `📁 ${folderPath}`;
            const isCurrentFolder = folderPath === video.folderPath;
            return `
                <div class="move-folder-option" style="padding:10px; margin-bottom:8px; background:${isCurrentFolder ? 'rgba(100,100,100,0.3)' : 'var(--bg-secondary)'}; border-radius:6px; cursor:pointer; border:1px solid var(--glass-border); transition:all 0.2s;"
                     data-folder="${folderPath}" data-default-bg="${isCurrentFolder ? 'rgba(100,100,100,0.3)' : 'var(--bg-secondary)'}">
                    ${displayName} ${isCurrentFolder ? '✓' : ''}
                </div>
            `;
        }).join('');

        foldersDiv.querySelectorAll('.move-folder-option').forEach(el => {
            el.addEventListener('click', () => selectMoveFolder(el.dataset.folder));
            el.addEventListener('mouseover', () => { el.style.background = 'var(--accent)'; el.style.color = 'white'; });
            el.addEventListener('mouseout', () => {
                if (!el.classList.contains('selected-folder')) {
                    el.style.background = el.dataset.defaultBg;
                    el.style.color = 'var(--text-primary)';
                }
            });
        });

        document.getElementById('gallery-move-modal').style.display = 'flex';
    }

    function selectMoveFolder(folderPath) {
        localState.selectedMoveFolder = folderPath;
        document.querySelectorAll('#gallery-move-modal-folders .move-folder-option').forEach(el => {
            const isSelected = el.dataset.folder === folderPath;
            el.classList.toggle('selected-folder', isSelected);
            el.style.background = isSelected ? 'var(--accent)' : el.dataset.defaultBg;
            el.style.color = isSelected ? 'white' : 'var(--text-primary)';
        });
    }

    // ========== Panel show/hide ==========
    // Expuesto al reproductor: cerrar la galería cuando arranca una reproducción
    window.galleryClose = function() { hideGalleryPanel(); };

    function hideGalleryPanel() {
        // Detener generación de miniaturas pendientes al salir de la galería
        resetThumbQueue();
        const panel = document.getElementById('gallery-panel');
        if (panel) panel.style.display = 'none';
        if (typeof window.vpOnGalleryClosed === 'function') {
            window.vpOnGalleryClosed();
        }
    }

    // ========== Bind static listeners (una sola vez) ==========
    function bindStaticListeners() {
        if (localState.listenersBound) return;
        localState.listenersBound = true;

        document.getElementById('filter-all').addEventListener('click', () => {
            localState.currentFilter = 'all';
            document.getElementById('filter-all').classList.add('active');
            document.getElementById('filter-duplicates').classList.remove('active');
            renderGallery();
        });

        document.getElementById('filter-duplicates').addEventListener('click', () => {
            localState.currentFilter = 'duplicates';
            document.getElementById('filter-duplicates').classList.add('active');
            document.getElementById('filter-all').classList.remove('active');
            renderGallery();
        });

        document.getElementById('filter-reload').addEventListener('click', async () => {
            document.getElementById('gallery-content').innerHTML = `
                <div class="gallery-loading"><div class="gallery-spinner"></div><p>Recargando galería...</p></div>
            `;
            await scanAndRender();
        });

        document.getElementById('close-gallery').addEventListener('click', hideGalleryPanel);

        // Reordenar la galería cuando cambia el criterio en la lista lateral
        const sortSelect = document.getElementById('sort-select');
        if (sortSelect) {
            sortSelect.addEventListener('change', () => {
                if (isPanelVisible() && localState.allVideos.length > 0) {
                    renderGallery();
                }
            });
        }

        document.getElementById('gallery-tag-modal-add-btn').addEventListener('click', () => {
            const input = document.getElementById('gallery-tag-modal-input');
            const newTag = input.value.trim().toLowerCase();
            if (!newTag || !localState.currentTaggingVideo) return;
            const videoId = tagKeyOf(localState.currentTaggingVideo);
            if (!localState.videoTags[videoId]) {
                localState.videoTags[videoId] = { tags: [], name: localState.currentTaggingVideo.name };
            }
            if (!localState.videoTags[videoId].tags.includes(newTag)) {
                localState.videoTags[videoId].tags.push(newTag);
            }
            input.value = '';
            openTagModal(localState.currentTaggingVideo);
        });

        document.getElementById('gallery-tag-modal-save-btn').addEventListener('click', async () => {
            await saveTags();
            notify('Etiquetas guardadas', 'success');
            document.getElementById('gallery-tag-modal').style.display = 'none';
            renderGallery();
        });

        document.getElementById('gallery-tag-modal-close-x').addEventListener('click', () => {
            document.getElementById('gallery-tag-modal').style.display = 'none';
        });
        document.getElementById('gallery-tag-modal-close-btn').addEventListener('click', () => {
            document.getElementById('gallery-tag-modal').style.display = 'none';
        });

        document.getElementById('gallery-delete-modal-confirm-btn').addEventListener('click', async () => {
            if (!localState.currentDeletingVideo) return;
            const success = await deleteVideo(localState.currentDeletingVideo);
            document.getElementById('gallery-delete-modal').style.display = 'none';
            localState.currentDeletingVideo = null;
            if (success) await scanAndRender();
        });
        document.getElementById('gallery-delete-modal-cancel-btn').addEventListener('click', () => {
            document.getElementById('gallery-delete-modal').style.display = 'none';
            localState.currentDeletingVideo = null;
        });

        document.getElementById('gallery-move-modal-confirm-btn').addEventListener('click', async () => {
            if (!localState.currentMovingVideo) return;
            if (localState.selectedMoveFolder === null || localState.selectedMoveFolder === undefined) {
                notify('Selecciona una carpeta de destino', 'info');
                return;
            }
            const success = await moveVideo(localState.currentMovingVideo, localState.selectedMoveFolder);
            document.getElementById('gallery-move-modal').style.display = 'none';
            localState.selectedMoveFolder = null;
            if (success) await scanAndRender();
        });
        document.getElementById('gallery-move-modal-close-x').addEventListener('click', () => {
            document.getElementById('gallery-move-modal').style.display = 'none';
            localState.selectedMoveFolder = null;
        });
        document.getElementById('gallery-move-modal-cancel-btn').addEventListener('click', () => {
            document.getElementById('gallery-move-modal').style.display = 'none';
            localState.selectedMoveFolder = null;
        });
    }

    async function scanAndRender() {
        await loadTags();
        await loadAllVideos();
        const { duplicateVideoIds } = detectDuplicates(localState.allVideos);
        localState.filteredVideos = Array.from(duplicateVideoIds).map(id => localState.videosById.get(id));
        updateStats();
        renderGallery();
    }

    // Permite al reproductor refrescar la galería: tras mover un archivo por
    // arrastre, o al cambiar de carpeta con la galería abierta.
    window.galleryRefresh = async function() {
        if (!isPanelVisible()) return;
        await scanAndRender();
    };

    // ========== Entry point expuesto al reproductor ==========
    window.initGalleryPanel = async function() {
        const panel = document.getElementById('gallery-panel');
        if (!panel) return;
        panel.style.display = 'block';

        bindStaticListeners();

        if (!document.getElementById('filter-all').classList.contains('active') &&
            !document.getElementById('filter-duplicates').classList.contains('active')) {
            document.getElementById('filter-all').classList.add('active');
        }

        try {
            localState.rootHandle = await loadHandle('root_directory');

            if (!localState.rootHandle) {
                document.getElementById('gallery-content').innerHTML = `
                    <div class="gallery-empty-state">
                        <div class="empty-state-icon">⚠️</div>
                        <h2>Carpeta no configurada</h2>
                        <p>Configura la carpeta de videos desde ⚙️ Configuración primero.</p>
                    </div>
                `;
                return;
            }

            document.getElementById('gallery-content').innerHTML = `
                <div class="gallery-loading"><div class="gallery-spinner"></div><p>Escaneando videos...</p></div>
            `;

            await scanAndRender();
        } catch (e) {
            console.error('Error en initGalleryPanel:', e);
            document.getElementById('gallery-content').innerHTML = `
                <div class="gallery-empty-state">
                    <div class="empty-state-icon">❌</div>
                    <h2>Error al cargar</h2>
                    <p>${e.message}</p>
                </div>
            `;
        }
    };
})();
