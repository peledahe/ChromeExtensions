const EDITOR_URL = chrome.runtime.getURL('editor.html');

// ID de la pestaña del editor (en memoria del service worker)
let editorTabId = null;

// Cuando el editor se cierra, limpiar el ID guardado
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === editorTabId) {
    editorTabId = null;
  }
});

// Guarda la screenshot en storage y abre/enfoca la pestaña del editor
function openOrFocusEditor(dataUrl, callback) {
  chrome.storage.local.set({ tempScreenshot: dataUrl }, () => {
    if (editorTabId !== null) {
      // Verificar si la pestaña sigue existiendo
      chrome.tabs.get(editorTabId, (tab) => {
        if (chrome.runtime.lastError || !tab) {
          // Ya no existe, crear una nueva
          editorTabId = null;
          createEditorTab(callback);
        } else {
          // Existe: enfocarla (storage.onChanged en editor.js recargará la imagen)
          chrome.tabs.update(editorTabId, { active: true }, () => {
            chrome.windows.update(tab.windowId, { focused: true }, () => {
              if (callback) callback();
            });
          });
        }
      });
    } else {
      createEditorTab(callback);
    }
  });
}

function createEditorTab(callback) {
  chrome.tabs.create({ url: EDITOR_URL }, (tab) => {
    editorTabId = tab.id;
    if (callback) callback();
  });
}

// Clic en el ícono de la extensión
chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
    if (chrome.runtime.lastError) {
      console.error("Error al capturar la pestaña:", chrome.runtime.lastError);
      return;
    }
    openOrFocusEditor(dataUrl);
  });
});

// Mensajes internos (content scripts de la misma extensión)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "take_screenshot") {
    const targetWindowId = sender.tab ? sender.tab.windowId : null;
    chrome.tabs.captureVisibleTab(targetWindowId, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        console.error("Error al capturar la pestaña:", chrome.runtime.lastError.message);
        return;
      }
      openOrFocusEditor(dataUrl);
    });
  }
});

// Mensajes externos (desde otras extensiones como 2xScreen)
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (message.action === "take_screenshot") {
    const targetWindowId = sender.tab ? sender.tab.windowId : null;
    chrome.tabs.captureVisibleTab(targetWindowId, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        console.error("Error al capturar la pestaña:", chrome.runtime.lastError.message);
        sendResponse({ error: chrome.runtime.lastError.message });
        return;
      }
      openOrFocusEditor(dataUrl, () => sendResponse({ success: true }));
    });
    return true;
  }

  if (message.action === "open_image_in_editor" && message.tempScreenshot) {
    openOrFocusEditor(message.tempScreenshot, () => sendResponse({ success: true }));
    return true;
  }
});
