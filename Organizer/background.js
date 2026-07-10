// background.js - Service Worker para Mk Organizer

// Al hacer clic en el icono de la extensión, se abre la pestaña de organizer.html
// Si ya está abierta en alguna pestaña, la enfoca y la activa en lugar de abrir una duplicada
chrome.action.onClicked.addListener((tab) => {
  const targetUrl = chrome.runtime.getURL('organizer.html');
  chrome.tabs.query({}, (tabs) => {
    // Buscamos cualquier pestaña que comience con la URL de organizer.html
    const existingTab = tabs.find(t => t.url && t.url.startsWith(targetUrl));
    if (existingTab) {
      chrome.tabs.update(existingTab.id, { active: true });
      chrome.windows.update(existingTab.windowId, { focused: true });
    } else {
      chrome.tabs.create({ url: targetUrl });
    }
  });
});

// Escuchar mensajes de content_script.js para interceptar credenciales
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SUBMIT_CREDENTIALS') {
    const { domain, username, password } = message;
    if (!domain || !username || !password) return;

    // Almacenar temporalmente las credenciales detectadas en chrome.storage.local
    // para sugerirlas al usuario la próxima vez que abra el gestor de claves.
    chrome.storage.local.get(['captured_credentials'], (result) => {
      let list = result.captured_credentials || [];
      
      // Evitar duplicados recientes
      list = list.filter(item => !(item.domain === domain && item.username === username));
      
      list.push({
        domain,
        username,
        password,
        timestamp: Date.now()
      });

      // Limitar a las últimas 5 capturas
      if (list.length > 5) {
        list.shift();
      }

      chrome.storage.local.set({ captured_credentials: list }, () => {
        sendResponse({ status: 'captured' });
      });
    });

    return true; // Mantener canal abierto para respuesta asíncrona
  }
});
