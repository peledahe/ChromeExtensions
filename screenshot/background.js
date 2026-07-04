chrome.action.onClicked.addListener((tab) => {
  // Capturar la pestaña activa como Data URL en formato PNG
  chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
    if (chrome.runtime.lastError) {
      console.error("Error al capturar la pestaña:", chrome.runtime.lastError);
      return;
    }

    // Almacenar temporalmente en storage.local de manera asíncrona
    chrome.storage.local.set({ tempScreenshot: dataUrl }, () => {
      // Definir dimensiones proporcionales a la pestaña del usuario
      const width = Math.max(1024, Math.floor((tab.width || 1280) * 0.9));
      const height = Math.max(768, Math.floor((tab.height || 800) * 0.9));

      // Abrir el editor en una pestaña nueva
      chrome.tabs.create({
        url: chrome.runtime.getURL('editor.html')
      });
    });
  });
});

// Escuchar solicitudes de captura desde el script de contenido (ej. barra flotante de 2xScreen)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "take_screenshot") {
    const targetWindowId = sender.tab ? sender.tab.windowId : null;
    chrome.tabs.captureVisibleTab(targetWindowId, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        console.error("Error al capturar la pestaña desde content script:", chrome.runtime.lastError.message || chrome.runtime.lastError);
        return;
      }

      chrome.storage.local.set({ tempScreenshot: dataUrl }, () => {
        // sender.tab contiene la pestaña emisora
        const tabWidth = sender.tab ? sender.tab.width : 1280;
        const tabHeight = sender.tab ? sender.tab.height : 800;
        const width = Math.max(1024, Math.floor(tabWidth * 0.9));
        const height = Math.max(768, Math.floor(tabHeight * 0.9));

        chrome.tabs.create({
          url: chrome.runtime.getURL('editor.html')
        });
      });
    });
  }
});
