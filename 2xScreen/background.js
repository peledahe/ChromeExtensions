// Background Service Worker para la extensión 2xScreen

// Limpieza de estados huérfanos al iniciar
chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.set({ active2xTabs: {} });
});

// Escucha el click en el icono de acción de la extensión ("2x")
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("edge://") || tab.url.startsWith("about:")) {
    // Las extensiones no pueden ejecutarse en páginas internas de Chrome
    return;
  }
  await toggle2xMode(tab);
});

// Escucha la eliminación de pestañas para mantener limpio el almacenamiento local
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const data = await chrome.storage.local.get("active2xTabs");
  const active2xTabs = data.active2xTabs || {};
  if (active2xTabs[tabId]) {
    delete active2xTabs[tabId];
    await chrome.storage.local.set({ active2xTabs });
  }
});

// Función para alternar el modo 2x
async function toggle2xMode(tab) {
  const data = await chrome.storage.local.get("active2xTabs");
  const active2xTabs = data.active2xTabs || {};
  const tabData = active2xTabs[tab.id];

  let isCurrentlyActive = false;
  if (tabData) {
    // Verificar si la ventana registrada realmente sigue existiendo
    try {
      await chrome.windows.get(tabData.popupWindowId);
      isCurrentlyActive = true;
    } catch (e) {
      // Si la ventana ya no existe, reparamos el registro obsoleto
      delete active2xTabs[tab.id];
      await chrome.storage.local.set({ active2xTabs });
    }
  }

  if (!isCurrentlyActive) {
    // ACTIVAR MODO 2x
    try {
      let left = 0;
      let top = 0;
      let width = 2560;
      let height = 800;
      let displays = null;

      if (chrome.system.display && chrome.system.display.getInfo) {
        displays = await chrome.system.display.getInfo();
        if (displays && displays.length > 0) {
          const ordered = [...displays].sort((a, b) => a.workArea.left - b.workArea.left);
          const d1 = ordered[0];
          left = d1.workArea.left;
          top = d1.workArea.top;
          width = d1.workArea.width * 2;
          height = d1.workArea.height;
        }
      } else {
        // Fallback para navegadores que no soportan system.display (como Firefox)
        try {
          const currentWin = await chrome.windows.getCurrent();
          left = currentWin.left || 0;
          top = currentWin.top || 0;
          width = (currentWin.width || 1280) * 2;
          height = currentWin.height || 800;
        } catch (e) {
          // Valores por defecto seguros si todo falla
          left = 0;
          top = 0;
          width = 2560;
          height = 800;
        }
      }

      // Guardamos la ventana original y su estado antes de mover la pestaña
      const originalWindow = await chrome.windows.get(tab.windowId);
      const originalState = originalWindow.state;

      const targetLeft = Math.round(left);
      const targetTop = Math.round(top);
      const targetWidth = Math.round(width);
      const targetHeight = Math.round(height);

      // 3. Crear una nueva ventana tipo 'popup' moviendo la pestaña activa con las dimensiones 2x iniciales
      const popupWindow = await chrome.windows.create({
        tabId: tab.id,
        type: "popup",
        left: targetLeft,
        top: targetTop,
        width: targetWidth,
        height: targetHeight
      });

      const hasMultipleDisplays = displays && displays.length > 1;

      // 4. Registrar en storage INMEDIATAMENTE para evitar condiciones de carrera al recargar el content script
      active2xTabs[tab.id] = {
        originalWindowId: tab.windowId,
        popupWindowId: popupWindow.id,
        originalState: originalState,
        alignRightScreen: hasMultipleDisplays
      };
      await chrome.storage.local.set({ active2xTabs });

      // 5. Aplicar un segundo redimensionamiento diferido y desdecoración a los 300ms.
      // En Linux, esto fuerza a GNOME Mutter a consolidar la geometría de doble pantalla de la ventana una vez mapeada.
      setTimeout(async () => {
        try {
          // Cambiar el título a una firma única
          const tempTitle = `Mk2xScreen_${Date.now()}`;
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: (title) => { document.title = title; },
              args: [tempTitle]
            });
          } catch (e) {
            console.debug("No se pudo cambiar el titulo con executeScript:", e);
          }

          // Esperar un instante para que Chrome procese el cambio de título en el OS
          await new Promise(r => setTimeout(r, 60));

          // Enviar señal al helper nativo para quitar la decoración de la ventana
          try {
            const port = chrome.runtime.connectNative("com.merke.twoxscreen");
            port.postMessage({ action: "undecorate", title: tempTitle });
            port.onMessage.addListener((res) => {
              console.debug("Native helper response:", res);
              port.disconnect();
            });
            port.onDisconnect.addListener(() => {
              if (chrome.runtime.lastError) {
                console.debug("Native messaging not available:", chrome.runtime.lastError.message);
              }
            });
          } catch (e) {
            console.debug("Native messaging connect error:", e);
          }

          // Aplicar redimensionamiento final
          await chrome.windows.update(popupWindow.id, {
            left: targetLeft,
            top: targetTop,
            width: targetWidth,
            height: targetHeight,
            focused: true
          });

          // Finalmente, recargar la pestaña (restaurará el título original e inicializará el viewport)
          setTimeout(async () => {
            try {
              await chrome.tabs.reload(tab.id);
            } catch (e) {
              console.error("Error al recargar la pestaña:", e);
            }
          }, 150);

        } catch (e) {
          console.debug("Error aplicando redimensionamiento y desdecoracion:", e);
        }
      }, 300);

    } catch (err) {
      console.error("Error al activar modo 2x:", err);
    }
  } else {
    // DESACTIVAR MODO 2x
    await restoreWindow(tab.id, active2xTabs);
  }
}

// Función para restaurar la pestaña a una ventana normal
async function restoreWindow(tabId, active2xTabs) {
  const tabData = active2xTabs[tabId];
  if (!tabData) return;

  const originalWindowId = tabData.originalWindowId;
  const originalState = tabData.originalState || "maximized";
  const popupWindowId = tabData.popupWindowId;

  try {
    let originalExists = false;
    if (originalWindowId) {
      try {
        await chrome.windows.get(originalWindowId);
        originalExists = true;
      } catch (e) {}
    }

    if (originalExists) {
      // Mover la pestaña de vuelta a la ventana original
      await chrome.tabs.move(tabId, { windowId: originalWindowId, index: -1 });
      await chrome.tabs.update(tabId, { active: true });
      await chrome.windows.update(originalWindowId, { focused: true });

      // Cerramos la ventana popup que creamos antes
      try {
        await chrome.windows.remove(popupWindowId);
      } catch(e) {}
    } else {
      // Si la ventana original ya no existe, creamos una normal maximizada con la pestaña
      await chrome.windows.create({
        tabId: tabId,
        type: "normal",
        state: originalState === "fullscreen" ? "maximized" : originalState
      });
    }
  } catch (err) {
    console.error("Error al restaurar ventana normal:", err);
  } finally {
    // Limpiar del registro
    delete active2xTabs[tabId];
    await chrome.storage.local.set({ active2xTabs });

    // Recargar la pestaña al volver a su posición normal para eliminar la UI limpia y nativamente
    try {
      await chrome.tabs.reload(tabId);
    } catch (e) {
      console.error("Error al recargar la pestaña en restauración:", e);
    }
  }
}

// Manejo de mensajes desde el Content Script (acciones de la barra flotante)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  if (!tabId) return false;

  (async () => {
    try {
      switch (message.action) {
        case "checkInstalledExtensions":
          const results = {
            agenda: null,
            videoplayer: null,
            imageplayer: null,
            screenshot: null,
            arcade: null
          };
          try {
            const extensions = await chrome.management.getAll();
            for (const ext of extensions) {
              if (ext.enabled) {
                if (ext.shortName === "mk-organizer" || ext.shortName === "mk-agenda" || ext.id === "bgiopnnblbijgffgdohgmnkhopbonefd") {
                  results.agenda = ext.id;
                } else if (ext.shortName === "mk-videoplayer" || ext.id === "akmbookdeplgfocoehhjajjakckkdfke") {
                  results.videoplayer = ext.id;
                } else if (ext.shortName === "mk-imageplayer" || ext.id === "dkpgjcdnjhempmphhmgnbabiimlccgne") {
                  results.imageplayer = ext.id;
                } else if (ext.shortName === "mk-screenshot") {
                  results.screenshot = ext.id;
                } else if (ext.shortName === "mk-arcade" || ext.name === "Mk Arcade") {
                  results.arcade = ext.id;
                }
              }
            }
          } catch (e) {
            console.error("Error detectando extensiones auxiliares:", e);
          }
          sendResponse(results);
          break;

        case "restoreWindow":
          const data = await chrome.storage.local.get("active2xTabs");
          await restoreWindow(tabId, data.active2xTabs || {});
          sendResponse({ success: true });
          break;

        case "check2xMode":
          const storageData = await chrome.storage.local.get("active2xTabs");
          const active2xTabs = storageData.active2xTabs || {};
          const tabData = active2xTabs[tabId];
          const is2x = !!tabData;
          const alignRight = tabData ? !!tabData.alignRightScreen : false;
          sendResponse({ enabled: is2x, alignRightScreen: alignRight });
          break;

        case "goBack":
          await chrome.tabs.goBack(tabId);
          sendResponse({ success: true });
          break;

        case "goForward":
          await chrome.tabs.goForward(tabId);
          sendResponse({ success: true });
          break;

        case "reload":
          await chrome.tabs.reload(tabId);
          sendResponse({ success: true });
          break;

        case "navigate":
          let targetUrl = message.url.trim();
          if (targetUrl) {
            // Analizar si es una búsqueda o una URL directa
            const isUrl = /^(https?:\/\/)?(localhost|(([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}))(:\d+)?(\/.*)?$/.test(targetUrl);
            if (isUrl) {
              if (!/^https?:\/\//i.test(targetUrl)) {
                targetUrl = "https://" + targetUrl;
              }
            } else {
              targetUrl = "https://www.google.com/search?q=" + encodeURIComponent(targetUrl);
            }
            await chrome.tabs.update(tabId, { url: targetUrl });
          }
          sendResponse({ success: true });
          break;

        case "getZoom":
          const zoomVal = await chrome.tabs.getZoom(tabId);
          sendResponse({ zoom: Math.round(zoomVal * 100) });
          break;

        case "changeZoom":
          const currentZoom = await chrome.tabs.getZoom(tabId);
          let newZoom = currentZoom;
          if (message.direction === "in") {
            newZoom = Math.min(3.0, currentZoom + 0.1);
          } else if (message.direction === "out") {
            newZoom = Math.max(0.5, currentZoom - 0.1);
          } else if (message.direction === "reset") {
            newZoom = 1.0;
          }
          await chrome.tabs.setZoom(tabId, newZoom);
          sendResponse({ zoom: Math.round(newZoom * 100) });
          break;

        case "checkFavorite":
          const matchFav = await chrome.bookmarks.search({ url: message.url });
          sendResponse({ isFavorite: matchFav.length > 0 });
          break;

        case "addFavorite":
          const newFav = await chrome.bookmarks.create({
            title: message.title,
            url: message.url
          });
          sendResponse({ success: true, bookmark: newFav });
          break;

        case "removeFavorite":
          const toRemove = await chrome.bookmarks.search({ url: message.url });
          for (const item of toRemove) {
            await chrome.bookmarks.remove(item.id);
          }
          sendResponse({ success: true });
          break;

        case "take_screenshot":
          const targetWindowId = sender.tab ? sender.tab.windowId : null;
          chrome.tabs.captureVisibleTab(targetWindowId, { format: 'png' }, (dataUrl) => {
            if (chrome.runtime.lastError) {
              console.error("Error al capturar pestaña nativamente:", chrome.runtime.lastError.message || chrome.runtime.lastError);
              sendResponse({ error: chrome.runtime.lastError.message });
              return;
            }

            chrome.storage.local.set({ tempScreenshot: dataUrl }, () => {
              // Calcular dimensiones para la ventana emergente flotante del editor
              const tabWidth = sender.tab ? sender.tab.width : 1280;
              const tabHeight = sender.tab ? sender.tab.height : 800;
              const width = Math.max(1024, Math.floor(tabWidth * 0.95));
              const height = Math.max(768, Math.floor(tabHeight * 0.95));

              chrome.windows.create({
                url: chrome.runtime.getURL('editor.html'),
                type: 'popup',
                width: width,
                height: height,
                focused: true
              }, () => {
                sendResponse({ success: true });
              });
            });
          });
          break;

        case "open_url":
          chrome.tabs.create({
            url: message.url
          }, () => {
            sendResponse({ success: true });
          });
          break;

        case "close_current_window":
          if (sender.tab && sender.tab.windowId) {
            chrome.windows.remove(sender.tab.windowId, () => {
              sendResponse({ success: true });
            });
          } else {
            sendResponse({ error: "No se identificó la ventana emisora" });
          }
          break;

        default:
          sendResponse({ error: "Acción no reconocida" });
      }
    } catch (err) {
      console.error(`Error procesando acción ${message.action}:`, err);
      sendResponse({ error: err.message });
    }
  })();

  return true; // Mantiene el canal abierto para responder de forma asíncrona
});
