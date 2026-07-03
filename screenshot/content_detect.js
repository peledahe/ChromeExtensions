// Marcar en el DOM que la extensión ScreenShot Merke está activa y lista en esta página
document.documentElement.setAttribute('data-screenshot-merke-active', 'true');

// Escuchar el mensaje window.postMessage para superar el aislamiento de contexto entre extensiones
window.addEventListener('message', (event) => {
  // Asegurarse de que el mensaje proviene de nuestra ventana y tiene la acción correcta
  if (event.source === window && event.data && event.data.action === 'trigger-screenshot-merke') {
    // Enviar mensaje al Service Worker (background.js) para capturar la pantalla
    chrome.runtime.sendMessage({ action: "take_screenshot" });
  }
});
