// Background Service Worker para la extensión 2xScreen

// Variables de caché global para evitar esperas asíncronas lentas que rompen el token de User Gesture
let activeTabsMemory = {};
let cachedDisplays = [];

// Inicializar caché de pestañas activas
chrome.storage.local.get("active2xTabs", (data) => {
  activeTabsMemory = data.active2xTabs || {};
});

// Inicializar y escuchar cambios en la configuración de pantallas
async function updateDisplaysCache() {
  if (chrome.system.display && chrome.system.display.getInfo) {
    try {
      cachedDisplays = await chrome.system.display.getInfo();
    } catch (e) {
      console.debug("Error caching displays:", e);
    }
  }
}
if (chrome.system.display && chrome.system.display.onDisplayChanged) {
  chrome.system.display.onDisplayChanged.addListener(updateDisplaysCache);
}
updateDisplaysCache();

// Limpieza de estados huérfanos al iniciar
chrome.runtime.onInstalled.addListener(async () => {
  activeTabsMemory = {};
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
  if (activeTabsMemory[tabId]) {
    delete activeTabsMemory[tabId];
    await chrome.storage.local.set({ active2xTabs: activeTabsMemory });
  }
});

// Escucha los cambios de URL para mantener el historial de navegación interno en modo 2x
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url && activeTabsMemory[tabId]) {
    const tabData = activeTabsMemory[tabId];
    
    // Ignorar urls internas de Chrome y similares
    if (changeInfo.url.startsWith("chrome://") || changeInfo.url.startsWith("about:") || changeInfo.url.startsWith("edge://")) return;

    if (!tabData.history) {
      tabData.history = [changeInfo.url];
      tabData.currentIndex = 0;
    } else {
      const currentUrl = tabData.history[tabData.currentIndex];
      if (changeInfo.url !== currentUrl) {
        // Verificar si es un retroceso/avance a una página ya en el historial
        const existingIndex = tabData.history.indexOf(changeInfo.url);
        if (existingIndex !== -1) {
          tabData.currentIndex = existingIndex;
        } else {
          // Si es una nueva URL, recortar el historial a partir del índice actual y añadir la nueva
          tabData.history = tabData.history.slice(0, tabData.currentIndex + 1);
          tabData.history.push(changeInfo.url);
          tabData.currentIndex = tabData.history.length - 1;
        }
        await chrome.storage.local.set({ active2xTabs: activeTabsMemory });
      }
    }

    // Notificar al content script en tiempo real
    try {
      const canGoBack = tabData.currentIndex > 0;
      const canGoForward = tabData.currentIndex < tabData.history.length - 1;
      await chrome.tabs.sendMessage(tabId, {
        action: "updateNavigationButtons",
        canGoBack,
        canGoForward
      });
    } catch (e) {
      // Ignorar si el script de contenido aún no se ha inyectado
    }
  }
});

// Función para alternar el modo 2x
async function toggle2xMode(tab) {
  const tabData = activeTabsMemory[tab.id];

  if (tabData) {
    // Si ya está activa, verificar si la ventana popup realmente sigue existiendo
    try {
      await chrome.windows.get(tabData.popupWindowId);
      await restoreWindow(tab.id);
    } catch (e) {
      // Si la ventana ya no existe, reparamos el registro de la caché y de storage
      delete activeTabsMemory[tab.id];
      await chrome.storage.local.set({ active2xTabs: activeTabsMemory });
      // E iniciamos el popup
      create2xWindow(tab);
    }
  } else {
    // Si no está registrada en memoria, procedemos directamente
    create2xWindow(tab);
  }
}

// Función síncrona para iniciar la ventana popup preservando el gesto de usuario (User Gesture)
function create2xWindow(tab) {
  let left = 0;
  let top = 0;
  let width = 2560;
  let height = 800;
  let hasMultipleDisplays = false;

  if (cachedDisplays && cachedDisplays.length > 0) {
    const ordered = [...cachedDisplays].sort((a, b) => a.workArea.left - b.workArea.left);
    const d1 = ordered[0];
    left = d1.workArea.left;
    top = d1.workArea.top;
    height = d1.workArea.height;
    
    if (ordered.length > 1) {
      const d2 = ordered[1];
      width = d1.workArea.width + d2.workArea.width;
      height = Math.min(d1.workArea.height, d2.workArea.height);
      hasMultipleDisplays = true;
    } else {
      width = d1.workArea.width * 2;
    }
  } else {
    // Fallback por defecto si la caché de pantallas fallase o estuviese vacía
    left = 0;
    top = 0;
    width = 2560;
    height = 800;
  }

  const targetLeft = Math.round(left);
  const targetTop = Math.round(top);
  const targetWidth = Math.round(width);
  const targetHeight = Math.round(height);

  try {
    // Llamar a chrome.windows.create de forma DIRECTA y síncrona para conservar el token de User Gesture
    chrome.windows.create({
      tabId: tab.id,
      type: "popup",
      left: targetLeft,
      top: targetTop,
      width: targetWidth,
      height: targetHeight
    }, (popupWindow) => {
      if (chrome.runtime.lastError) {
        console.error("Error al crear la ventana popup con gesto de usuario:", chrome.runtime.lastError.message);
        return;
      }

      // Ahora que la ventana popup se ha creado, obtenemos de forma segura el estado de la ventana original en segundo plano
      chrome.windows.get(tab.windowId, (originalWindow) => {
        const originalState = originalWindow ? originalWindow.state : "normal";

        // Registrar en memoria y en el almacenamiento
        activeTabsMemory[tab.id] = {
          originalWindowId: tab.windowId,
          popupWindowId: popupWindow.id,
          originalState: originalState,
          alignRightScreen: hasMultipleDisplays,
          history: [ tab.url ],
          currentIndex: 0
        };
        chrome.storage.local.set({ active2xTabs: activeTabsMemory });

        // Aplicar segundo redimensionamiento diferido y desdecoración
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
            const applyGeometry = async () => {
              try {
                await chrome.windows.update(popupWindow.id, {
                  left: targetLeft,
                  top: targetTop,
                  width: targetWidth,
                  height: targetHeight,
                  focused: true
                });
                
                setTimeout(async () => {
                  try {
                    await chrome.tabs.reload(tab.id);
                  } catch (e) {
                    console.error("Error al recargar la pestaña:", e);
                  }
                }, 150);
              } catch (e) {
                console.debug("Error aplicando geometria final:", e);
              }
            };

            try {
              const port = chrome.runtime.connectNative("com.merke.twoxscreen");
              let geomApplied = false;

              port.postMessage({ action: "undecorate", title: tempTitle });

              port.onMessage.addListener(async (res) => {
                console.debug("Native helper response:", res);
                port.disconnect();
                if (!geomApplied) {
                  geomApplied = true;
                  // Esperar un instante para que el OS procese el cambio de decoración
                  await new Promise(r => setTimeout(r, 100));
                  await applyGeometry();
                }
              });

              port.onDisconnect.addListener(async () => {
                if (chrome.runtime.lastError) {
                  console.debug("Native messaging not available:", chrome.runtime.lastError.message);
                }
                if (!geomApplied) {
                  geomApplied = true;
                  await applyGeometry();
                }
              });

              // Timeout de seguridad de 600ms por si el helper tarda demasiado o falla
              setTimeout(async () => {
                if (!geomApplied) {
                  geomApplied = true;
                  try { port.disconnect(); } catch (e) {}
                  await applyGeometry();
                }
              }, 600);

            } catch (e) {
              console.debug("Native messaging connect error:", e);
              await applyGeometry();
            }

          } catch (e) {
            console.debug("Error aplicando redimensionamiento y desdecoracion:", e);
          }
        }, 300);
      });
    });
  } catch (err) {
    console.error("Error síncrono al iniciar ventana popup:", err);
  }
}

// Función para restaurar la pestaña a una ventana normal
async function restoreWindow(tabId) {
  const tabData = activeTabsMemory[tabId];
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
    delete activeTabsMemory[tabId];
    await chrome.storage.local.set({ active2xTabs: activeTabsMemory });

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
          const tabData = activeTabsMemory[tabId];
          const is2x = !!tabData;
          const alignRight = tabData ? !!tabData.alignRightScreen : false;
          let canGoBack = false;
          let canGoForward = false;
          if (tabData && tabData.history) {
            canGoBack = tabData.currentIndex > 0;
            canGoForward = tabData.currentIndex < tabData.history.length - 1;
          }
          sendResponse({ 
            enabled: is2x, 
            alignRightScreen: alignRight,
            canGoBack: canGoBack,
            canGoForward: canGoForward
          });
          break;

        case "goBack":
          if (activeTabsMemory[tabId] && activeTabsMemory[tabId].currentIndex > 0) {
            activeTabsMemory[tabId].currentIndex--;
            await chrome.storage.local.set({ active2xTabs: activeTabsMemory });
            await chrome.tabs.goBack(tabId);
          }
          sendResponse({ success: true });
          break;

        case "goForward":
          if (activeTabsMemory[tabId] && activeTabsMemory[tabId].history && activeTabsMemory[tabId].currentIndex < activeTabsMemory[tabId].history.length - 1) {
            activeTabsMemory[tabId].currentIndex++;
            await chrome.storage.local.set({ active2xTabs: activeTabsMemory });
            await chrome.tabs.goForward(tabId);
          }
          sendResponse({ success: true });
          break;

        case "goHome":
          if (activeTabsMemory[tabId] && activeTabsMemory[tabId].history && activeTabsMemory[tabId].history.length > 0) {
            activeTabsMemory[tabId].currentIndex = 0;
            await chrome.storage.local.set({ active2xTabs: activeTabsMemory });
            await chrome.tabs.update(tabId, { url: activeTabsMemory[tabId].history[0] });
          }
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

        case "take_screenshot": {
          const screenshotExtId = message.screenshotExtId;
          const targetWindowId = sender.tab ? sender.tab.windowId : null;
          chrome.tabs.captureVisibleTab(targetWindowId, { format: 'png' }, (dataUrl) => {
            if (chrome.runtime.lastError) {
              console.error("Error al capturar pestaña:", chrome.runtime.lastError.message);
              sendResponse({ error: chrome.runtime.lastError.message });
              return;
            }
            if (screenshotExtId) {
              // Delegar apertura del editor a la extensión de capturas externa
              chrome.runtime.sendMessage(screenshotExtId, { action: "open_image_in_editor", tempScreenshot: dataUrl }, (res) => {
                if (chrome.runtime.lastError) {
                  console.error("Error al enviar imagen a la extensión screenshot:", chrome.runtime.lastError.message);
                }
                sendResponse({ success: true });
              });
            } else {
              sendResponse({ error: "Extensión de capturas no disponible." });
            }
          });
          return true; // respuesta asíncrona
        }


        case "open_url":
          chrome.tabs.query({}, (tabs) => {
            const existingTab = tabs.find(t => t.url === message.url);
            if (existingTab) {
              chrome.tabs.update(existingTab.id, { active: true }, () => {
                chrome.windows.update(existingTab.windowId, { focused: true }, () => {
                  sendResponse({ success: true });
                });
              });
            } else {
              chrome.tabs.create({
                url: message.url
              }, () => {
                sendResponse({ success: true });
              });
            }
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

        case "check_native_status":
          checkNativeConnection().then(isConnected => {
            sendResponse({ connected: isConnected });
          });
          break;

        case "register_id_manually":
          registerCurrentExtensionId().then(regSuccess => {
            sendResponse({ success: regSuccess });
          });
          break;

        case "get_installer_data":
          getInstallerScriptData().then(result => {
            sendResponse(result);
          });
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

// === LOGICA DE INSTALACION Y SOPORTE DE NATIVE HOST ===

const HELPER_PY_CONTENT = `#!/usr/bin/env python3
import sys
import json
import struct
import subprocess
import platform
import os

def log_debug(msg):
    try:
        log_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "helper_debug.log")
        lines = []
        if os.path.exists(log_path):
            with open(log_path, "r", encoding="utf-8", errors="ignore") as f:
                lines = f.readlines()
        lines.append(msg + "\\n")
        if len(lines) > 100:
            lines = lines[-100:]
        with open(log_path, "w", encoding="utf-8") as f:
            f.writelines(lines)
    except Exception as e:
        sys.stderr.write(f"Error escribiendo log: {e}\\n")

def send_message(message):
    try:
        encoded = json.dumps(message).encode('utf-8')
        sys.stdout.buffer.write(struct.pack('I', len(encoded)))
        sys.stdout.buffer.write(encoded)
        sys.stdout.flush()
    except Exception as e:
        log_debug(f"Error enviando mensaje: {e}")

def read_message():
    try:
        raw_length = sys.stdin.buffer.read(4)
        if not raw_length:
            return None
        length = struct.unpack('I', raw_length)[0]
        message = sys.stdin.buffer.read(length).decode('utf-8')
        return json.loads(message)
    except Exception as e:
        log_debug(f"Error leyendo mensaje: {e}")
        return None

def undecorate_linux(window_title):
    try:
        import re
        res = subprocess.run(["xprop", "-root", "_NET_CLIENT_LIST"], capture_output=True, text=True)
        if res.returncode != 0:
            return False
        window_ids = re.findall(r"0x[0-9a-fA-F]+", res.stdout)
        success = False
        for win_id in window_ids:
            for prop in ["WM_NAME", "_NET_WM_NAME"]:
                prop_res = subprocess.run(["xprop", "-id", win_id, prop], capture_output=True, text=True)
                if prop_res.returncode == 0:
                    title_content = prop_res.stdout.strip()
                    if window_title in title_content:
                        xprop_cmd = ["xprop", "-f", "_MOTIF_WM_HINTS", "32c", "-set", "_MOTIF_WM_HINTS", "2,0,0,0,0", "-id", win_id]
                        sub_res = subprocess.run(xprop_cmd, capture_output=True, text=True)
                        if sub_res.returncode == 0:
                            success = True
                        break
        return success
    except Exception as e:
        log_debug(f"Error en undecorate Linux: {e}")
    return False

def undecorate_windows(window_title):
    try:
        import ctypes
        hwnd = ctypes.windll.user32.FindWindowW(None, window_title)
        if hwnd:
            style = ctypes.windll.user32.GetWindowLongW(hwnd, -16)
            style &= ~0x00C00000  # WS_CAPTION
            style &= ~0x00040000  # WS_THICKFRAME
            ctypes.windll.user32.SetWindowLongW(hwnd, -16, style)
            ctypes.windll.user32.SetWindowPos(hwnd, 0, 0, 0, 0, 0, 0, 0x0027)
            return True
    except Exception as e:
        log_debug(f"Error en undecorate Windows: {e}")
    return False

def register_extension_id(ext_id):
    if not ext_id or not isinstance(ext_id, str) or not ext_id.isalnum():
        return False
    
    script_dir = os.path.dirname(os.path.abspath(__file__))
    local_json = os.path.join(script_dir, "com.merke.twoxscreen.json")
    paths = [local_json]
    
    if "linux" in platform.system().lower():
        home = os.path.expanduser("~")
        linux_paths = [
            os.path.join(home, ".config/google-chrome/NativeMessagingHosts/com.merke.twoxscreen.json"),
            os.path.join(home, ".config/chromium/NativeMessagingHosts/com.merke.twoxscreen.json"),
            os.path.join(home, ".config/microsoft-edge/NativeMessagingHosts/com.merke.twoxscreen.json"),
            os.path.join(home, ".config/microsoft-edge-beta/NativeMessagingHosts/com.merke.twoxscreen.json"),
            os.path.join(home, ".config/microsoft-edge-dev/NativeMessagingHosts/com.merke.twoxscreen.json"),
        ]
        paths.extend(linux_paths)
        
    success = False
    for path in paths:
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                allowed = data.get("allowed_origins", [])
                origin = f"chrome-extension://{ext_id}/"
                if origin not in allowed:
                    allowed.append(origin)
                    data["allowed_origins"] = allowed
                    with open(path, "w", encoding="utf-8") as f:
                        json.dump(data, f, indent=2)
                    success = True
                else:
                    success = True
            except Exception as e:
                log_debug(f"Error registrando en {path}: {e}")
    return success

def main():
    while True:
        msg = read_message()
        if msg is None:
            break
        action = msg.get("action")
        success = False
        if action == "ping":
            success = True
        elif action == "register_id":
            success = register_extension_id(msg.get("id"))
        elif action == "undecorate":
            window_title = msg.get("title")
            if window_title:
                current_os = platform.system().lower()
                if "linux" in current_os:
                    success = undecorate_linux(window_title)
                elif "windows" in current_os:
                    success = undecorate_windows(window_title)
        send_message({"success": success})

if __name__ == "__main__":
    main()
`;

async function checkNativeConnection() {
  return new Promise((resolve) => {
    try {
      const port = chrome.runtime.connectNative("com.merke.twoxscreen");
      let resolved = false;
      port.onMessage.addListener((msg) => {
        if (!resolved) {
          resolved = true;
          try { port.disconnect(); } catch(e) {}
          resolve(true);
        }
      });
      port.onDisconnect.addListener(() => {
        if (!resolved) {
          resolved = true;
          resolve(false);
        }
      });
      port.postMessage({ action: "ping" });
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          try { port.disconnect(); } catch(e) {}
          resolve(false);
        }
      }, 400);
    } catch (e) {
      resolve(false);
    }
  });
}

async function registerCurrentExtensionId() {
  return new Promise((resolve) => {
    try {
      const port = chrome.runtime.connectNative("com.merke.twoxscreen");
      let resolved = false;
      port.onMessage.addListener((msg) => {
        if (!resolved) {
          resolved = true;
          try { port.disconnect(); } catch(e) {}
          resolve(!!(msg && msg.success));
        }
      });
      port.onDisconnect.addListener(() => {
        if (!resolved) {
          resolved = true;
          resolve(false);
        }
      });
      port.postMessage({ action: "register_id", id: chrome.runtime.id });
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          try { port.disconnect(); } catch(e) {}
          resolve(false);
        }
      }, 800);
    } catch (e) {
      resolve(false);
    }
  });
}

async function getInstallerScriptData() {
  try {
    const platformInfo = await chrome.runtime.getPlatformInfo();
    const os = platformInfo.os;
    let fileContent = "";
    let filename = "";

    if (os === "win") {
      filename = "install_2xscreen.bat";
      const base64Helper = btoa(unescape(encodeURIComponent(HELPER_PY_CONTENT)));
      const chunks = [];
      for (let i = 0; i < base64Helper.length; i += 70) {
        chunks.push(base64Helper.substring(i, i + 70));
      }
      const b64Formatted = chunks.map(line => `echo ${line} >> "%INSTALL_DIR%\\helper.b64"`).join("\r\n");

      fileContent = `@echo off
set "INSTALL_DIR=%USERPROFILE%\\AppData\\Local\\2xscreen"
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"

echo -----BEGIN CERTIFICATE----- > "%INSTALL_DIR%\\helper.b64"
${b64Formatted}
echo -----END CERTIFICATE----- >> "%INSTALL_DIR%\\helper.b64"

certutil -decode "%INSTALL_DIR%\\helper.b64" "%INSTALL_DIR%\\twoxscreen_helper.py" >nul
del "%INSTALL_DIR%\\helper.b64"

powershell -Command "$path = '%INSTALL_DIR%\\twoxscreen_helper.py'.Replace('\\', '\\\\'); $json = @{ name = 'com.merke.twoxscreen'; description = 'Helper nativo de 2xScreen para quitar bordes de ventana'; path = $path; type = 'stdio'; allowed_origins = @('chrome-extension://gnjddnfmlhjmmglbhalfcckcplmcdkaf/', 'chrome-extension://ihbfgcligcckngjlbjccjjojmpepajin/', 'chrome-extension://${chrome.runtime.id}/') } | ConvertTo-Json; [IO.File]::WriteAllText('%INSTALL_DIR%\\com.merke.twoxscreen.json', $json)"

REG ADD "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.merke.twoxscreen" /ve /t REG_SZ /d "%INSTALL_DIR%\\com.merke.twoxscreen.json" /f >nul
REG ADD "HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.merke.twoxscreen" /ve /t REG_SZ /d "%INSTALL_DIR%\\com.merke.twoxscreen.json" /f >nul

echo 2xScreen configurado con exito.
pause
`;
    } else {
      filename = "install_2xscreen.sh";
      fileContent = `#!/bin/bash
INSTALL_DIR="$HOME/.local/share/2xscreen"
mkdir -p "$INSTALL_DIR"

cat << 'EOF' > "$INSTALL_DIR/twoxscreen_helper.py"
${HELPER_PY_CONTENT}
EOF
chmod +x "$INSTALL_DIR/twoxscreen_helper.py"

cat << 'EOF' > "$INSTALL_DIR/com.merke.twoxscreen.json"
{
  "name": "com.merke.twoxscreen",
  "description": "Helper nativo de 2xScreen para quitar bordes de ventana",
  "path": "INSTALL_DIR_PLACEHOLDER/twoxscreen_helper.py",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://gnjddnfmlhjmmglbhalfcckcplmcdkaf/",
    "chrome-extension://ihbfgcligcckngjlbjccjjojmpepajin/",
    "chrome-extension://${chrome.runtime.id}/"
  ]
}
EOF

sed -i "s|INSTALL_DIR_PLACEHOLDER|$INSTALL_DIR|g" "$INSTALL_DIR/com.merke.twoxscreen.json"

CHROME_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
CHROMIUM_DIR="$HOME/.config/chromium/NativeMessagingHosts"
EDGE_DIR="$HOME/.config/microsoft-edge/NativeMessagingHosts"
EDGE_BETA_DIR="$HOME/.config/microsoft-edge-beta/NativeMessagingHosts"
EDGE_DEV_DIR="$HOME/.config/microsoft-edge-dev/NativeMessagingHosts"

for d in "$CHROME_DIR" "$CHROMIUM_DIR" "$EDGE_DIR" "$EDGE_BETA_DIR" "$EDGE_DEV_DIR"; do
    mkdir -p "$d"
    cp "$INSTALL_DIR/com.merke.twoxscreen.json" "$d/com.merke.twoxscreen.json"
    chmod 644 "$d/com.merke.twoxscreen.json"
done

echo "Instalación completada con éxito."
`;
    }

    return { success: true, filename, fileContent };

  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Registro automático al iniciar/instalar la extensión
chrome.runtime.onInstalled.addListener(() => {
  setTimeout(() => {
    registerCurrentExtensionId().then(success => {
      console.log("Registro automático al instalar:", success);
    });
  }, 1000);
});

chrome.runtime.onStartup.addListener(() => {
  setTimeout(() => {
    registerCurrentExtensionId().then(success => {
      console.log("Registro automático al arrancar:", success);
    });
  }, 1000);
});
