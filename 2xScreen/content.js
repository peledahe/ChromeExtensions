// content.js - Inyección de la barra flotante de 2xScreen mediante Shadow DOM

let container = null;
let shadow = null;
let currentZoomPercent = 100;
let isUrlCheckingInterval = null;

// Función para verificar si el contexto de la extensión sigue siendo válido
function isContextValid() {
  return typeof chrome !== 'undefined' && chrome.runtime && !!chrome.runtime.id;
}

// Inicialización de la extensión al cargar la página
async function init() {
  try {
    const response = await chrome.runtime.sendMessage({ action: "check2xMode" });
    if (response && response.enabled) {
      const storage = await chrome.storage.local.get("isBarCollapsed");
      const isCollapsed = storage.isBarCollapsed !== undefined ? storage.isBarCollapsed : false;
      await initUI(!!response.alignRightScreen, isCollapsed, !!response.canGoBack, !!response.canGoForward);
    }
  } catch (err) {
    // Si falla la comunicación inicial, reintentamos después
    console.debug("Error de comunicación inicial 2xScreen:", err);
  }
}

// Escuchar mensajes provenientes del background service worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isContextValid()) {
    destroyUI();
    return;
  }
  try {
    if (message.action === "set2xMode") {
      if (message.enabled) {
        (async () => {
          try {
            const storage = await chrome.storage.local.get("isBarCollapsed");
            const isCollapsed = storage.isBarCollapsed !== undefined ? storage.isBarCollapsed : false;
            await initUI(!!message.alignRightScreen, isCollapsed, !!message.canGoBack, !!message.canGoForward);
          } catch (err) {
            console.debug("Error leyendo almacenamiento en set2xMode:", err);
            destroyUI();
          }
        })();
      } else {
        destroyUI();
      }
    } else if (message.action === "updateNavigationButtons") {
      const bBack = shadow?.querySelector("#mc-back");
      const bFwd = shadow?.querySelector("#mc-fwd");
      const bHome = shadow?.querySelector("#mc-home");
      if (bBack) bBack.style.display = message.canGoBack ? "" : "none";
      if (bFwd) bFwd.style.display = message.canGoForward ? "" : "none";
      if (bHome) bHome.style.display = message.canGoBack ? "flex" : "none";
    }
    sendResponse({ success: true });
  } catch (err) {
    console.debug("Error procesando mensaje en content script:", err);
    destroyUI();
  }
});

function startLoadingState() {
  if (!shadow) return;
  const btnGo = shadow.querySelector("#mc-go");
  if (btnGo) {
    btnGo.classList.add("loading");
  }
}

function stopLoadingState() {
  if (!shadow) return;
  const btnGo = shadow.querySelector("#mc-go");
  if (btnGo) {
    btnGo.classList.remove("loading");
  }
}

// Función para construir e inyectar la UI flotante
async function initUI(alignRightScreen, isCollapsed, initialCanGoBack = false, initialCanGoForward = false) {
  // Evitar duplicados
  if (document.getElementById("minichrome-2x-extension-root")) {
    updateURLInput();
    return;
  }

  // Obtener estado de extensiones auxiliares
  let extensionsStatus = null;
  if (isContextValid()) {
    try {
      extensionsStatus = await chrome.runtime.sendMessage({ action: "checkInstalledExtensions" });
    } catch (err) {
      console.debug("Error obteniendo estado de extensiones auxiliares:", err);
    }
  }

  // 1. Crear el Shadow Host
  container = document.createElement("div");
  container.id = "minichrome-2x-extension-root";
  document.body.appendChild(container);

  // 2. Adjuntar el Shadow Root
  shadow = container.attachShadow({ mode: "open" });

  // 3. Cargar la hoja de estilos content.css local de la extensión
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = chrome.runtime.getURL("content.css");
  link.onload = () => {
    // Revelar la UI solo cuando la hoja de estilos esté completamente cargada y aplicada
    rootDiv.style.opacity = "";
    rootDiv.style.visibility = "";
  };
  shadow.appendChild(link);

  // 4. Crear la estructura contenedora (wrapper flex) según si es doble pantalla
  const wrapper = document.createElement("div");
  wrapper.className = alignRightScreen ? "mc-wrapper-dual" : "mc-wrapper-single";
  shadow.appendChild(wrapper);

  let parentElement = wrapper;
  if (alignRightScreen) {
    const leftCol = document.createElement("div");
    leftCol.className = "mc-column-left";
    wrapper.appendChild(leftCol);

    const rightCol = document.createElement("div");
    rightCol.className = "mc-column-right";
    wrapper.appendChild(rightCol);

    parentElement = rightCol;
  }

  // 5. Crear la estructura HTML de la barra
  const rootDiv = document.createElement("div");
  rootDiv.className = isCollapsed ? "mc-container collapsed" : "mc-container";
  
  // Ocultar por completo de forma inline inicial para evitar FOUC (destellos de iconos gigantes)
  rootDiv.style.opacity = "0";
  rootDiv.style.visibility = "hidden";

  // SVG del escudo de seguridad
  const secureShieldSvg = `
    <svg viewBox="0 0 24 24">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
    </svg>
  `;

  const notchChar = isCollapsed ? "v" : "∧";
  const notchClass = isCollapsed ? "mc-notch notch-down" : "mc-notch notch-up";
  const notchTitle = isCollapsed ? "Mostrar barra (Ctrl+Space)" : "Ocultar barra (Ctrl+Space)";

  rootDiv.innerHTML = `
    <!-- Notch / Botón superior -->
    <div class="${notchClass}" title="${notchTitle}">${notchChar}</div>

    <!-- Barra de Navegación -->
    <div class="mc-bar">
      <button class="mc-btn" id="mc-back" title="Atrás">‹</button>
      <button class="mc-btn" id="mc-fwd" title="Adelante">›</button>
      <button class="mc-btn" id="mc-home" title="Página de inicio (Home)" style="display: none; align-items: center; justify-content: center;">
        <svg viewBox="0 0 24 24" style="width:14px; height:14px; fill:none; stroke:currentColor; stroke-width:2.2; stroke-linecap:round; stroke-linejoin:round;">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
          <polyline points="9 22 9 12 15 12 15 22"/>
        </svg>
      </button>
      
      <div class="mc-shield" id="mc-shield" title="Estado de seguridad">
        <svg viewBox="0 0 24 24">
          <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/>
        </svg>
      </div>

      <div class="mc-url-wrap">
        <input type="text" class="mc-input" id="mc-url" placeholder="Buscar o navegar..." />
      </div>

      <button class="mc-btn-go" id="mc-go" title="Ir">⊙</button>

      <div class="mc-zoom-wrap">
        <button class="mc-zoom-btn" id="mc-zoom-out" title="Reducir (Ctrl+-)">−</button>
        <button class="mc-zoom-lbl" id="mc-zoom-lbl" title="Restablecer zoom (doble click)">100%</button>
        <button class="mc-zoom-btn" id="mc-zoom-in" title="Ampliar (Ctrl++)">+</button>
      </div>

      <button class="mc-btn mc-btn-fav" id="mc-fav" title="Guardar favorito">☆</button>
      
      <button class="mc-btn" id="mc-screenshot" title="Tomar captura de pantalla" style="display: flex; align-items: center; justify-content: center;">
        <svg viewBox="0 0 24 24" style="width:14px; height:14px; fill:none; stroke:currentColor; stroke-width:2.5; stroke-linecap:round; stroke-linejoin:round;">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
          <circle cx="12" cy="13" r="4"/>
        </svg>
      </button>

      <button class="mc-btn" id="mc-agenda" title="Abrir Organizador" style="display: flex; align-items: center; justify-content: center;">
        <svg viewBox="0 0 24 24" style="width:14px; height:14px; fill:none; stroke:currentColor; stroke-width:2.2; stroke-linecap:round; stroke-linejoin:round;">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
          <line x1="16" y1="2" x2="16" y2="6"/>
          <line x1="8" y1="2" x2="8" y2="6"/>
          <line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
      </button>

      <button class="mc-btn" id="mc-videoplayer" title="Abrir Video Player" style="display: flex; align-items: center; justify-content: center;">
        <svg viewBox="0 0 24 24" style="width:14px; height:14px; fill:none; stroke:currentColor; stroke-width:2.2; stroke-linecap:round; stroke-linejoin:round;">
          <polygon points="23 7 16 12 23 17 23 7"/>
          <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
        </svg>
      </button>

      <button class="mc-btn" id="mc-imageplayer" title="Abrir Image Player" style="display: flex; align-items: center; justify-content: center;">
        <svg viewBox="0 0 24 24" style="width:14px; height:14px; fill:none; stroke:currentColor; stroke-width:2.2; stroke-linecap:round; stroke-linejoin:round;">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
          <circle cx="8.5" cy="8.5" r="1.5"/>
          <polyline points="21 15 16 10 5 21"/>
        </svg>
      </button>

      <button class="mc-btn" id="mc-arcade" title="Abrir Arcade" style="display: flex; align-items: center; justify-content: center;">
        <svg viewBox="0 0 24 24" style="width:14px; height:14px; fill:none; stroke:currentColor; stroke-width:2.2; stroke-linecap:round; stroke-linejoin:round;">
          <rect x="2" y="6" width="20" height="12" rx="3" ry="3"/>
          <path d="M6 12h4m-2-2v4"/>
          <circle cx="15" cy="11" r="1"/>
          <circle cx="18" cy="13" r="1"/>
        </svg>
      </button>

      <button class="mc-btn" id="mc-config" title="Configurar comunicación nativa" style="display: flex; align-items: center; justify-content: center;">
        <svg viewBox="0 0 24 24" style="width:14px; height:14px; fill:none; stroke:currentColor; stroke-width:2.2; stroke-linecap:round; stroke-linejoin:round;">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      </button>

      <button class="mc-btn-2x" id="mc-2x" title="Salir de pantalla doble (Esc)">2x</button>

      <button class="mc-btn" id="mc-close-window" title="Cerrar ventana" style="display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 16px; margin-left: 2px; color: rgba(255, 107, 107, 0.9);">
        &times;
      </button>
    </div>
  `;

  parentElement.appendChild(rootDiv);

  // 5. Vincular Elementos y Eventos
  const notch = shadow.querySelector(".mc-notch");
  const bar = shadow.querySelector(".mc-bar");
  const btnBack = shadow.querySelector("#mc-back");
  const btnFwd = shadow.querySelector("#mc-fwd");
  const btnHome = shadow.querySelector("#mc-home");
  const btnGo = shadow.querySelector("#mc-go");
  const inputUrl = shadow.querySelector("#mc-url");
  const shield = shadow.querySelector("#mc-shield");
  const btnZoomOut = shadow.querySelector("#mc-zoom-out");
  const btnZoomIn = shadow.querySelector("#mc-zoom-in");
  const btnZoomLbl = shadow.querySelector("#mc-zoom-lbl");
  const btnFav = shadow.querySelector("#mc-fav");
  const btnScreenshot = shadow.querySelector("#mc-screenshot");
  const btnAgenda = shadow.querySelector("#mc-agenda");
  const btnVideoPlayer = shadow.querySelector("#mc-videoplayer");
  const btnImagePlayer = shadow.querySelector("#mc-imageplayer");
  const btnArcade = shadow.querySelector("#mc-arcade");
  const btnConfig = shadow.querySelector("#mc-config");
  const btnRestore = shadow.querySelector("#mc-2x");
  const btnCloseWindow = shadow.querySelector("#mc-close-window");

  // Ocultar botones si las extensiones correspondientes no están instaladas/activas
  if (extensionsStatus) {
    if (!extensionsStatus.agenda && btnAgenda) btnAgenda.style.display = "none";
    if (!extensionsStatus.videoplayer && btnVideoPlayer) btnVideoPlayer.style.display = "none";
    if (!extensionsStatus.imageplayer && btnImagePlayer) btnImagePlayer.style.display = "none";
    if (!extensionsStatus.screenshot && btnScreenshot) btnScreenshot.style.display = "none";
    if (!extensionsStatus.arcade && btnArcade) btnArcade.style.display = "none";
  }

  // Configurar visibilidad inicial de los botones de navegación
  if (btnBack) btnBack.style.display = initialCanGoBack ? "" : "none";
  if (btnFwd) btnFwd.style.display = initialCanGoForward ? "" : "none";
  if (btnHome) btnHome.style.display = initialCanGoBack ? "flex" : "none";

  // Mostrar la URL y estado inicial
  updateURLInput();
  checkFavoriteState();
  updateZoomValue();

  // Animación inicial: mostramos la pestaña notch
  notch.addEventListener("click", async () => {
    const isCollapsed = rootDiv.classList.toggle("collapsed");
    if (isCollapsed) {
      notch.innerText = "v";
      notch.title = "Mostrar barra (Ctrl+Space)";
      notch.className = "mc-notch notch-down";
    } else {
      notch.innerText = "∧";
      notch.title = "Ocultar barra (Ctrl+Space)";
      notch.className = "mc-notch notch-up";
      // Auto focusear el input al abrir
      setTimeout(() => inputUrl.focus(), 150);
    }
    // Guardar el estado en el storage local
    await chrome.storage.local.set({ isBarCollapsed: isCollapsed });
  });

  // Acciones de navegación
  btnBack.addEventListener("click", () => {
    if (!isContextValid()) return destroyUI();
    startLoadingState();
    chrome.runtime.sendMessage({ action: "goBack" });
  });
  btnFwd.addEventListener("click", () => {
    if (!isContextValid()) return destroyUI();
    startLoadingState();
    chrome.runtime.sendMessage({ action: "goForward" });
  });
  if (btnHome) {
    btnHome.addEventListener("click", () => {
      if (!isContextValid()) return destroyUI();
      startLoadingState();
      chrome.runtime.sendMessage({ action: "goHome" });
    });
  }

  if (shield) {
    shield.addEventListener("click", () => {
      showSecurityInfoModal();
    });
  }

  // Evento Ir
  const handleNavigation = () => {
    if (!isContextValid()) return destroyUI();
    const url = inputUrl.value.trim();
    if (url) {
      startLoadingState();
      chrome.runtime.sendMessage({ action: "navigate", url });
    }
  };
  btnGo.addEventListener("click", handleNavigation);
  inputUrl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      handleNavigation();
    }
  });
  inputUrl.addEventListener("focus", () => inputUrl.select());

  // Acciones de Zoom
  btnZoomOut.addEventListener("click", async () => {
    if (!isContextValid()) return destroyUI();
    try {
      const resp = await chrome.runtime.sendMessage({ action: "changeZoom", direction: "out" });
      if (resp && resp.zoom) {
        currentZoomPercent = resp.zoom;
        btnZoomLbl.innerText = `${currentZoomPercent}%`;
      }
    } catch (err) {
      console.debug("Error al cambiar zoom out:", err);
      destroyUI();
    }
  });

  btnZoomIn.addEventListener("click", async () => {
    if (!isContextValid()) return destroyUI();
    try {
      const resp = await chrome.runtime.sendMessage({ action: "changeZoom", direction: "in" });
      if (resp && resp.zoom) {
        currentZoomPercent = resp.zoom;
        btnZoomLbl.innerText = `${currentZoomPercent}%`;
      }
    } catch (err) {
      console.debug("Error al cambiar zoom in:", err);
      destroyUI();
    }
  });

  btnZoomLbl.addEventListener("click", async () => {
    if (!isContextValid()) return destroyUI();
    try {
      const resp = await chrome.runtime.sendMessage({ action: "changeZoom", direction: "reset" });
      if (resp && resp.zoom) {
        currentZoomPercent = resp.zoom;
        btnZoomLbl.innerText = `${currentZoomPercent}%`;
      }
    } catch (err) {
      console.debug("Error al resetear zoom:", err);
      destroyUI();
    }
  });

  // Acciones de Favoritos (☆)
  btnFav.addEventListener("click", async () => {
    if (!isContextValid()) return destroyUI();
    const isFav = btnFav.classList.contains("active");
    const currentUrl = window.location.href;
    const currentTitle = document.title || currentUrl;

    if (!isFav) {
      // Agregar favorito
      try {
        const response = await chrome.runtime.sendMessage({
          action: "addFavorite",
          url: currentUrl,
          title: currentTitle
        });
        if (response && response.success) {
          btnFav.classList.add("active");
          btnFav.innerText = "★";
          showToast("Favorito Guardado", `Se ha agregado "${currentTitle}" a tus marcadores de Chrome.`);
        }
      } catch (err) {
        console.debug("Error agregando favorito:", err);
        destroyUI();
      }
    } else {
      // Pedir confirmación con modal personalizado para eliminar
      showConfirmationModal(
        "Eliminar favorito",
        `¿Está seguro de que desea eliminar la página "${currentTitle}" de favoritos?`,
        async () => {
          if (!isContextValid()) return destroyUI();
          try {
            const response = await chrome.runtime.sendMessage({
              action: "removeFavorite",
              url: currentUrl
            });
            if (response && response.success) {
              btnFav.classList.remove("active");
              btnFav.innerText = "☆";
              showToast("Favorito Eliminado", `Se ha quitado la página de tus marcadores.`);
            }
          } catch (err) {
            console.debug("Error eliminando favorito:", err);
            destroyUI();
          }
        }
      );
    }
  });

  // Botón salir de modo 2x
  btnRestore.addEventListener("click", () => {
    if (!isContextValid()) return destroyUI();
    chrome.runtime.sendMessage({ action: "restoreWindow" });
  });

  // Acción de captura de pantalla (el background de 2xScreen captura y delega a la extensión externa)
  if (btnScreenshot) {
    btnScreenshot.addEventListener("click", () => {
      if (!isContextValid()) return destroyUI();
      const extId = extensionsStatus?.screenshot;
      chrome.runtime.sendMessage({ action: "take_screenshot", screenshotExtId: extId });
    });
  }

  // Abrir Mk Organizer
  if (btnAgenda) {
    btnAgenda.addEventListener("click", () => {
      if (!isContextValid()) return destroyUI();
      const extId = extensionsStatus?.agenda || "bgiopnnblbijgffgdohgmnkhopbonefd";
      chrome.runtime.sendMessage({
        action: "open_url",
        url: `chrome-extension://${extId}/organizer.html`
      }, (response) => {
        if (chrome.runtime.lastError) {
          showToast("Error de Comunicación", `Asegúrate de recargar la extensión 2xScreen en chrome://extensions. Detalle: ${chrome.runtime.lastError.message}`);
        } else if (response && response.error) {
          showToast("Error al abrir Mk Organizer", response.error);
        }
      });
    });
  }

  // Abrir Video Player
  if (btnVideoPlayer) {
    btnVideoPlayer.addEventListener("click", () => {
      if (!isContextValid()) return destroyUI();
      const extId = extensionsStatus?.videoplayer || "akmbookdeplgfocoehhjajjakckkdfke";
      chrome.runtime.sendMessage({
        action: "open_url",
        url: `chrome-extension://${extId}/videoplayer.html`
      }, (response) => {
        if (chrome.runtime.lastError) {
          showToast("Error de Comunicación", `Asegúrate de recargar la extensión 2xScreen en chrome://extensions. Detalle: ${chrome.runtime.lastError.message}`);
        } else if (response && response.error) {
          showToast("Error al abrir Video Player", response.error);
        }
      });
    });
  }

  // Abrir Image Player
  if (btnImagePlayer) {
    btnImagePlayer.addEventListener("click", () => {
      if (!isContextValid()) return destroyUI();
      const extId = extensionsStatus?.imageplayer || "dkpgjcdnjhempmphhmgnbabiimlccgne";
      chrome.runtime.sendMessage({
        action: "open_url",
        url: `chrome-extension://${extId}/imageplayer.html`
      }, (response) => {
        if (chrome.runtime.lastError) {
          showToast("Error de Comunicación", `Asegúrate de recargar la extensión 2xScreen en chrome://extensions. Detalle: ${chrome.runtime.lastError.message}`);
        } else if (response && response.error) {
          showToast("Error al abrir Image Player", response.error);
        }
      });
    });
  }

  // Abrir Arcade
  if (btnArcade) {
    btnArcade.addEventListener("click", () => {
      if (!isContextValid()) return destroyUI();
      const extId = extensionsStatus?.arcade;
      if (!extId) {
        showToast("Error", "Extensión Mk Arcade no detectada");
        return;
      }
      chrome.runtime.sendMessage({
        action: "open_url",
        url: `chrome-extension://${extId}/arcade.html`
      }, (response) => {
        if (chrome.runtime.lastError) {
          showToast("Error de Comunicación", `Asegúrate de recargar la extensión 2xScreen en chrome://extensions. Detalle: ${chrome.runtime.lastError.message}`);
        } else if (response && response.error) {
          showToast("Error al abrir Mk Arcade", response.error);
        }
      });
    });
  }

  // Configuración de Native Host
  if (btnConfig) {
    btnConfig.addEventListener("click", () => {
      if (!isContextValid()) return destroyUI();
      showConfigModal();
    });
  }

  // Cerrar Ventana actual
  if (btnCloseWindow) {
    btnCloseWindow.addEventListener("click", () => {
      if (!isContextValid()) return destroyUI();
      chrome.runtime.sendMessage({ action: "close_current_window" }, (response) => {
        if (chrome.runtime.lastError) {
          showToast("Error de Comunicación", `Asegúrate de recargar la extensión 2xScreen en chrome://extensions. Detalle: ${chrome.runtime.lastError.message}`);
        } else if (response && response.error) {
          showToast("Error al cerrar ventana", response.error);
        }
      });
    });
  }

  // Intervalo ligero para sincronizar URL y favoritos en aplicaciones SPA
  isUrlCheckingInterval = setInterval(() => {
    if (!isContextValid()) {
      destroyUI();
      return;
    }
    const currentUrl = window.location.href;
    if (inputUrl.value !== currentUrl && !inputUrl.matches(":focus")) {
      inputUrl.value = currentUrl;
      checkFavoriteState();
    }
  }, 1000);

  // Estado de carga inicial (si la página aún se está cargando)
  if (document.readyState !== "complete") {
    startLoadingState();
    window.addEventListener("load", stopLoadingState, { once: true });
  }

  // Validar conexión del host nativo y alertar si es necesario
  checkAndAlertNativeConnection();
}

// Función para actualizar la URL del input y el estado de HTTPS
function updateURLInput() {
  if (!shadow) return;
  const inputUrl = shadow.querySelector("#mc-url");
  const shield = shadow.querySelector("#mc-shield");
  
  if (inputUrl) {
    inputUrl.value = window.location.href;
  }
  
  if (shield) {
    if (window.location.protocol === "https:") {
      shield.classList.add("secure");
      shield.title = "Conexión segura (HTTPS)";
    } else {
      shield.classList.remove("secure");
      shield.title = "Conexión no cifrada (HTTP)";
    }
  }
}

// Función para verificar el estado de favoritos en los marcadores de Chrome
async function checkFavoriteState() {
  if (!shadow) return;
  const btnFav = shadow.querySelector("#mc-fav");
  if (!btnFav) return;

  if (!isContextValid()) {
    destroyUI();
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      action: "checkFavorite",
      url: window.location.href
    });
    if (response && response.isFavorite) {
      btnFav.classList.add("active");
      btnFav.innerText = "★";
    } else {
      btnFav.classList.remove("active");
      btnFav.innerText = "☆";
    }
  } catch (e) {
    console.debug("Error verificando favoritos:", e);
    if (e.message && e.message.includes("Extension context invalidated")) {
      destroyUI();
    }
  }
}

// Obtener y actualizar el valor del zoom de la pestaña
async function updateZoomValue() {
  if (!shadow) return;
  const btnZoomLbl = shadow.querySelector("#mc-zoom-lbl");
  if (!btnZoomLbl) return;

  if (!isContextValid()) {
    destroyUI();
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({ action: "getZoom" });
    if (response && response.zoom) {
      currentZoomPercent = response.zoom;
      btnZoomLbl.innerText = `${currentZoomPercent}%`;
    }
  } catch (e) {
    console.debug("Error obteniendo zoom:", e);
    if (e.message && e.message.includes("Extension context invalidated")) {
      destroyUI();
    }
  }
}

// Destruir la interfaz y limpiar escuchadores
function destroyUI() {
  if (isUrlCheckingInterval) {
    clearInterval(isUrlCheckingInterval);
    isUrlCheckingInterval = null;
  }
  document.removeEventListener("keydown", handleKeyDown);
  if (container) {
    container.remove();
    container = null;
    shadow = null;
  }
}

// --- Notificación tipo Sticky ---
function showToast(title, message) {
  if (!shadow) return;

  // Remover toasts existentes para no encimar
  const existing = shadow.querySelectorAll(".mc-toast");
  existing.forEach(t => t.remove());

  const toast = document.createElement("div");
  toast.className = "mc-toast";
  toast.innerHTML = `
    <div class="mc-toast-header">
      <span>${title}</span>
      <span class="mc-toast-close">&times;</span>
    </div>
    <div class="mc-toast-body">${message}</div>
  `;

  shadow.appendChild(toast);

  // Forzar reflow para animación
  toast.offsetHeight;
  toast.classList.add("show");

  const closeBtn = toast.querySelector(".mc-toast-close");
  const closeToast = () => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 400);
  };

  closeBtn.addEventListener("click", closeToast);

  // Comportamiento Sticky: Se queda en pantalla por 8 segundos y luego se va
  // El usuario puede cerrarla manualmente antes si lo desea
  setTimeout(() => {
    if (toast.parentNode) {
      closeToast();
    }
  }, 8000);
}

// --- Modal de Confirmación Personalizado ---
function showConfirmationModal(title, text, onConfirm) {
  if (!shadow) return;

  // Crear overlay
  const containerEl = shadow.querySelector(".mc-container");
  let leftStyle = "";
  if (containerEl) {
    const rect = containerEl.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    leftStyle = `left: ${centerX}px;`;
  }

  const overlay = document.createElement("div");
  overlay.className = "mc-modal-overlay";

  overlay.innerHTML = `
    <div class="mc-modal-box" style="${leftStyle}">
      <h3 class="mc-modal-title">${title}</h3>
      <p class="mc-modal-text">${text}</p>
      <div class="mc-modal-buttons">
        <button class="mc-modal-btn mc-modal-btn-cancel" id="mc-modal-cancel">Cancelar</button>
        <button class="mc-modal-btn mc-modal-btn-confirm" id="mc-modal-confirm">Sí, eliminar</button>
      </div>
    </div>
  `;

  shadow.appendChild(overlay);

  // Forzar reflow
  overlay.offsetHeight;
  overlay.classList.add("show");

  const btnCancel = overlay.querySelector("#mc-modal-cancel");
  const btnConfirm = overlay.querySelector("#mc-modal-confirm");

  const closeModal = () => {
    overlay.classList.remove("show");
    setTimeout(() => overlay.remove(), 250);
  };

  btnCancel.addEventListener("click", closeModal);
  
  // Cerrar al hacer click en el fondo desenfocado
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      closeModal();
    }
  });

  btnConfirm.addEventListener("click", () => {
    onConfirm();
    closeModal();
  });
}

// --- Modal de Detalles de Seguridad de URL (SSL) ---
function showSecurityInfoModal() {
  if (!shadow) return;

  const protocol = window.location.protocol;
  const hostname = window.location.hostname || "Archivo Local/Extensión";
  
  let modalTitle = "";
  let modalIcon = "";
  let modalText = "";

  if (protocol === "https:") {
    modalTitle = "Conexión Segura (SSL/TLS)";
    modalIcon = `
      <svg viewBox="0 0 24 24" style="width: 50px; height: 50px; fill: #2ecc71; margin-bottom: 12px;">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
      </svg>
    `;
    modalText = `
      La conexión a <strong>${hostname}</strong> es segura.<br><br>
      Toda la información que transmitas (como contraseñas, datos personales o tarjetas de crédito) se cifra de extremo a extremo antes de enviarse a la red, evitando que terceros o atacantes puedan interceptarla o alterarla.<br><br>
      <span style="opacity: 0.7; font-size: 0.82rem;">Detalles del cifrado: Protocolo seguro HTTPS configurado activamente.</span>
    `;
  } else if (protocol === "http:") {
    modalTitle = "Conexión No Segura (Sin Cifrar)";
    modalIcon = `
      <svg viewBox="0 0 24 24" style="width: 50px; height: 50px; fill: #e74c3c; margin-bottom: 12px;">
        <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/>
      </svg>
    `;
    modalText = `
      ⚠️ <strong>Advertencia de Privacidad</strong><br><br>
      La conexión con <strong>${hostname}</strong> no está cifrada.<br><br>
      Cualquier dato confidencial que ingreses en este sitio (como contraseñas, cookies de sesión o formularios) se transmitirá en texto plano y puede ser leído o modificado por intermediarios, redes de terceros o proveedores en tu red local.<br><br>
      <span style="color: #ff7675; font-weight: bold;">Se recomienda NO introducir contraseñas ni datos bancarios en este sitio.</span>
    `;
  } else if (protocol === "file:") {
    modalTitle = "Archivo Local";
    modalIcon = `
      <svg viewBox="0 0 24 24" style="width: 50px; height: 50px; fill: #3498db; margin-bottom: 12px;">
        <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
      </svg>
    `;
    modalText = `
      Estás visualizando un archivo almacenado localmente en tu sistema de archivos.<br><br>
      Al no requerir acceso a internet, no existe tráfico de red expuesto. Es seguro interactuar con este archivo siempre y cuando confíes en su origen y procedencia local.
    `;
  } else {
    modalTitle = "Recurso del Navegador";
    modalIcon = `
      <svg viewBox="0 0 24 24" style="width: 50px; height: 50px; fill: #95a5a6; margin-bottom: 12px;">
        <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM19 18H6c-2.21 0-4-1.79-4-4 0-2.05 1.53-3.76 3.56-3.97l1.07-.11.5-.95C8.08 7.14 9.94 6 12 6c2.62 0 4.88 1.86 5.39 4.43l.3 1.5 1.53.11c1.56.1 2.78 1.41 2.78 2.96 0 1.65-1.35 3-3 3z"/>
      </svg>
    `;
    modalText = `
      Estás accediendo a un recurso interno del navegador o de una extensión de Chrome (esquema <strong>${protocol}</strong>).<br><br>
      Es un entorno local aislado y seguro gestionado internamente por el propio Chrome.
    `;
  }

  const containerEl = shadow.querySelector(".mc-container");
  let leftStyle = "";
  if (containerEl) {
    const rect = containerEl.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    leftStyle = `left: ${centerX}px;`;
  }

  const overlay = document.createElement("div");
  overlay.className = "mc-modal-overlay";

  overlay.innerHTML = `
    <div class="mc-modal-box" style="text-align: center; max-width: 450px; ${leftStyle}">
      ${modalIcon}
      <h3 class="mc-modal-title" style="margin-top: 0;">${modalTitle}</h3>
      <p class="mc-modal-text" style="text-align: left; line-height: 1.5; font-size: 0.92rem;">${modalText}</p>
      <div class="mc-modal-buttons" style="justify-content: center; margin-top: 20px;">
        <button class="mc-modal-btn mc-modal-btn-confirm" id="mc-modal-ok" style="padding: 6px 24px;">Entendido</button>
      </div>
    </div>
  `;

  shadow.appendChild(overlay);

  // Forzar reflow
  overlay.offsetHeight;
  overlay.classList.add("show");

  const btnOk = overlay.querySelector("#mc-modal-ok");

  const closeModal = () => {
    overlay.classList.remove("show");
    setTimeout(() => overlay.remove(), 250);
  };

  btnOk.addEventListener("click", closeModal);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      closeModal();
    }
  });
}

// --- Accesos directos de teclado (Shortcuts) ---
function handleKeyDown(e) {
  // Solo escuchar atajos si la interfaz de la extensión está activa en la página
  if (!container) return;

  if (!isContextValid()) {
    destroyUI();
    return;
  }

  // 1. Escape: salir del modo 2x
  if (e.key === "Escape") {
    // Evitar conflictos con elementos interactivos de la propia página web
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.isContentEditable)) {
      // Si el foco está en un input (incluyendo el nuestro), solo quitamos el foco
      activeEl.blur();
      return;
    }
    try {
      chrome.runtime.sendMessage({ action: "restoreWindow" });
    } catch (err) {
      console.debug("Error de comunicación 2xScreen:", err);
      destroyUI();
    }
  }

  // 2. Ctrl + Space: Alternar visibilidad de la barra
  if (e.ctrlKey && e.code === "Space") {
    e.preventDefault();
    const rootDiv = shadow.querySelector(".mc-container");
    const notch = shadow.querySelector(".mc-notch");
    if (rootDiv && notch) {
      const isCollapsed = rootDiv.classList.toggle("collapsed");
      if (isCollapsed) {
        notch.innerText = "v";
        notch.title = "Mostrar barra (Ctrl+Space)";
        notch.className = "mc-notch notch-down";
      } else {
        notch.innerText = "∧";
        notch.title = "Ocultar barra (Ctrl+Space)";
        notch.className = "mc-notch notch-up";
        const inputUrl = shadow.querySelector("#mc-url");
        if (inputUrl) setTimeout(() => inputUrl.focus(), 150);
      }
      // Guardar el estado en el storage local
      try {
        chrome.storage.local.set({ isBarCollapsed: isCollapsed });
      } catch (err) {
        console.debug("Error guardando configuración 2xScreen:", err);
        destroyUI();
      }
    }
  }
}

// --- Modal de Configuración Nativa de 2xScreen ---
function showConfigModal() {
  if (!shadow) return;

  const containerEl = shadow.querySelector(".mc-container");
  let leftStyle = "";
  if (containerEl) {
    const rect = containerEl.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    leftStyle = `left: ${centerX}px;`;
  }

  const overlay = document.createElement("div");
  overlay.className = "mc-modal-overlay mc-config-overlay";

  overlay.innerHTML = `
    <div class="mc-modal-box mc-config-box" style="${leftStyle}">
      <h3 class="mc-modal-title">Configuración de Pantalla Doble</h3>
      <div class="mc-config-content">
        <div class="mc-status-row">
          <span class="mc-status-label">Comunicación con el sistema:</span>
          <span class="mc-status-badge mc-status-loading">Verificando...</span>
        </div>
        <p class="mc-config-desc" id="mc-config-text">Por favor, espera un momento mientras validamos la conexión nativa.</p>
        <div class="mc-config-actions" id="mc-config-actions">
          <!-- Dinámico -->
        </div>
      </div>
      <button class="mc-config-close" id="mc-config-close">&times;</button>
    </div>
  `;

  shadow.appendChild(overlay);
  
  // Forzar reflow
  overlay.offsetHeight;
  overlay.classList.add("show");

  const btnClose = overlay.querySelector("#mc-config-close");
  const closeModal = () => {
    overlay.classList.remove("show");
    setTimeout(() => overlay.remove(), 250);
  };
  btnClose.addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });

  const updateStatus = () => {
    const badge = overlay.querySelector(".mc-status-badge");
    const desc = overlay.querySelector("#mc-config-text");
    const actions = overlay.querySelector("#mc-config-actions");

    chrome.runtime.sendMessage({ action: "check_native_status" }, (res) => {
      const isConnected = !!(res && res.connected);

      if (isConnected) {
        badge.className = "mc-status-badge mc-status-ok";
        badge.textContent = "Conectado y Listo";
        desc.textContent = "La comunicación nativa está funcionando de manera óptima en tu sistema operativo. El modo de ocultación de barras nativas está activo.";
        actions.innerHTML = `
          <button class="mc-modal-btn mc-modal-btn-confirm" id="mc-btn-sync" style="background-color: rgba(60, 207, 137, 0.9);">Sincronizar Navegadores</button>
        `;

        const btnSync = actions.querySelector("#mc-btn-sync");
        btnSync.addEventListener("click", () => {
          btnSync.disabled = true;
          btnSync.textContent = "Sincronizando...";
          chrome.runtime.sendMessage({ action: "register_id_manually" }, (regRes) => {
            if (regRes && regRes.success) {
              showToast("Sincronización Completa", "El ID de la extensión ha sido inyectado en Chrome y Edge con éxito.");
              btnSync.textContent = "Sincronizado";
              setTimeout(() => {
                btnSync.disabled = false;
                btnSync.textContent = "Sincronizar Navegadores";
              }, 2000);
            } else {
              showToast("Error", "No se pudo sincronizar automáticamente.");
              btnSync.disabled = false;
              btnSync.textContent = "Sincronizar Navegadores";
            }
          });
        });

      } else {
        badge.className = "mc-status-badge mc-status-err";
        badge.textContent = "Requiere Configuración";
        desc.textContent = "Para permitir que la extensión oculte la barra de título nativa del sistema operativo, es necesario realizar una configuración automática de una sola vez.";
        actions.innerHTML = `
          <button class="mc-modal-btn mc-modal-btn-confirm mc-btn-primary" id="mc-btn-install" style="background-color: rgba(90, 107, 255, 0.9); font-size: 13px; padding: 11px;">Configurar en 1 Clic</button>
          
          <div class="mc-steps-container" style="display: none; margin-top: 18px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 15px;">
            <div class="mc-step-item" id="step-1" style="display: flex; align-items: flex-start; gap: 12px; margin-bottom: 12px; font-size: 12px; color: rgba(255,255,255,0.65); transition: color 0.3s;">
              <span class="mc-step-num" style="display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 50%; background: rgba(255,255,255,0.1); color: #fff; font-size: 10px; font-weight: bold; flex-shrink: 0; transition: all 0.3s;">1</span>
              <div>
                <p style="margin: 0; font-weight: 600; color: #fff; font-size: 12px;">Descargar Configurador Seguro</p>
                <p style="margin: 3px 0 0 0; font-size: 11px; opacity: 0.8; line-height: 1.4;">Se ha guardado un script seguro de automatización local en tu carpeta de descargas.</p>
              </div>
            </div>

            <div class="mc-step-item" id="step-2" style="display: flex; align-items: flex-start; gap: 12px; margin-bottom: 12px; font-size: 12px; color: rgba(255,255,255,0.65); transition: color 0.3s;">
              <span class="mc-step-num" style="display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 50%; background: rgba(255,255,255,0.1); color: #fff; font-size: 10px; font-weight: bold; flex-shrink: 0; transition: all 0.3s;">2</span>
              <div>
                <p style="margin: 0; font-weight: 600; color: #fff; font-size: 12px;">Ejecutar Configurador</p>
                <p style="margin: 3px 0 0 0; font-size: 11px; opacity: 0.8; line-height: 1.4;">Haz clic en el archivo descargado (<code style="background: rgba(255,255,255,0.08); padding: 2px 5px; border-radius: 4px; font-family: monospace; font-size: 10.5px; color: #51a2ff;" id="mc-script-name">install_2xscreen</code>) para habilitar el modo de pantalla completa.</p>
              </div>
            </div>

            <div class="mc-step-item" id="step-3" style="display: flex; align-items: flex-start; gap: 12px; font-size: 12px; color: rgba(255,255,255,0.65); transition: color 0.3s;">
              <span class="mc-step-num" style="display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 50%; background: rgba(255,255,255,0.1); color: #fff; font-size: 10px; font-weight: bold; flex-shrink: 0; transition: all 0.3s;">3</span>
              <div>
                <p style="margin: 0; font-weight: 600; color: #fff; font-size: 12px;">Validación Automática</p>
                <p style="margin: 3px 0 0 0; font-size: 11px; opacity: 0.8; line-height: 1.4;" id="mc-step-3-text">Esperando la activación del sistema...</p>
              </div>
            </div>
          </div>
        `;

        const btnInstall = actions.querySelector("#mc-btn-install");
        const stepsContainer = actions.querySelector(".mc-steps-container");

        btnInstall.addEventListener("click", () => {
          btnInstall.disabled = true;
          btnInstall.textContent = "Preparando conector...";
          stepsContainer.style.display = "block";

          chrome.runtime.sendMessage({ action: "get_installer_data" }, (installRes) => {
            if (installRes && installRes.success) {
              try {
                // Descarga HTML5 Blob
                const blob = new Blob([installRes.fileContent], { type: "application/octet-stream" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = installRes.filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                
                // Actualizar UI del paso 1 a completado
                const s1Num = stepsContainer.querySelector("#step-1 .mc-step-num");
                s1Num.style.background = "#3ccf89";
                s1Num.style.borderColor = "#3ccf89";
                s1Num.innerHTML = "✓";
                stepsContainer.querySelector("#step-1").style.color = "rgba(255,255,255,0.9)";
                
                // Actualizar UI del paso 2 a activo
                const s2Num = stepsContainer.querySelector("#step-2 .mc-step-num");
                s2Num.style.background = "#297ad7";
                s2Num.style.boxShadow = "0 0 8px rgba(81, 162, 255, 0.4)";
                stepsContainer.querySelector("#step-2").style.color = "#fff";
                
                // Actualizar nombre de script
                const scriptName = stepsContainer.querySelector("#mc-script-name");
                if (scriptName) scriptName.textContent = installRes.filename;
                
                btnInstall.textContent = "Esperando ejecución...";
                showToast("Descarga Exitosa", "Por favor, abre el instalador descargado para activar la extensión.");
              } catch (e) {
                console.error("Error al descargar instalador nativo:", e);
                showToast("Error de Descarga", "No se pudo descargar automáticamente.");
                btnInstall.disabled = false;
                btnInstall.textContent = "Configurar en 1 Clic";
                stepsContainer.style.display = "none";
                return;
              }
              
              let attempts = 0;
              const interval = setInterval(() => {
                chrome.runtime.sendMessage({ action: "check_native_status" }, (checkRes) => {
                  attempts++;
                  
                  // Microanimación en el paso 3 (espera)
                  const step3Text = stepsContainer.querySelector("#mc-step-3-text");
                  if (step3Text) {
                    const dots = ".".repeat((attempts % 3) + 1);
                    step3Text.textContent = `Validando activación local${dots}`;
                  }
                  
                  if (checkRes && checkRes.connected) {
                    clearInterval(interval);
                    
                    // Marcar pasos 2 y 3 como completados
                    const s2Num = stepsContainer.querySelector("#step-2 .mc-step-num");
                    s2Num.style.background = "#3ccf89";
                    s2Num.style.boxShadow = "none";
                    s2Num.innerHTML = "✓";
                    
                    const s3Num = stepsContainer.querySelector("#step-3 .mc-step-num");
                    s3Num.style.background = "#3ccf89";
                    s3Num.innerHTML = "✓";
                    stepsContainer.querySelector("#step-3").style.color = "rgba(255,255,255,0.9)";
                    
                    const s3Text = stepsContainer.querySelector("#mc-step-3-text");
                    if (s3Text) s3Text.textContent = "¡Activación completada con éxito!";
                    
                    showToast("Configuración Completada", "La comunicación nativa se ha activado correctamente.");
                    setTimeout(() => {
                      updateStatus();
                    }, 1000);
                  } else if (attempts > 90) { // Timeout de 45 segundos
                    clearInterval(interval);
                    btnInstall.disabled = false;
                    btnInstall.textContent = "Intentar de nuevo";
                    const s3Text = stepsContainer.querySelector("#mc-step-3-text");
                    if (s3Text) s3Text.textContent = "No se detectó la ejecución. Inténtalo de nuevo.";
                  }
                });
              }, 500);
            } else {
              showToast("Error de Configuración", "No se pudieron obtener los datos de instalación.");
              btnInstall.disabled = false;
              btnInstall.textContent = "Configurar en 1 Clic";
              stepsContainer.style.display = "none";
            }
          });
        });
      }
    });
  };

  updateStatus();
}

// --- Modal de Advertencia de Conexión Nativa ---
function showNativeWarningModal() {
  if (!shadow) return;

  const containerEl = shadow.querySelector(".mc-container");
  let leftStyle = "";
  if (containerEl) {
    const rect = containerEl.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    leftStyle = `left: ${centerX}px;`;
  }

  const overlay = document.createElement("div");
  overlay.className = "mc-modal-overlay mc-warning-overlay";

  overlay.innerHTML = `
    <div class="mc-modal-box mc-warning-box" style="${leftStyle}">
      <h3 class="mc-modal-title" style="color: #ff6b6b; font-size: 14px;">¿Deseas ocultar la barra de título?</h3>
      <p class="mc-modal-text" style="margin-bottom: 15px;">Hemos detectado que la barra de título de la ventana sigue visible porque falta realizar la configuración nativa en tu sistema.</p>
      
      <div style="margin-bottom: 20px; display: flex; align-items: center; justify-content: center; gap: 8px;">
        <input type="checkbox" id="mc-warning-ignore" style="cursor: pointer; margin: 0;" />
        <label for="mc-warning-ignore" style="font-size: 11px; color: rgba(255, 255, 255, 0.7); cursor: pointer; user-select: none;">No volver a mostrar este aviso</label>
      </div>

      <div class="mc-modal-buttons">
        <button class="mc-modal-btn mc-modal-btn-cancel" id="mc-warning-close">Cerrar</button>
        <button class="mc-modal-btn mc-modal-btn-confirm" id="mc-warning-setup" style="background-color: rgba(90, 107, 255, 0.9);">Configurar ahora</button>
      </div>
    </div>
  `;

  shadow.appendChild(overlay);
  
  // Forzar reflow
  overlay.offsetHeight;
  overlay.classList.add("show");

  const btnClose = overlay.querySelector("#mc-warning-close");
  const btnSetup = overlay.querySelector("#mc-warning-setup");
  const chkIgnore = overlay.querySelector("#mc-warning-ignore");

  const saveIgnoreState = async () => {
    if (chkIgnore.checked) {
      try {
        await chrome.storage.local.set({ ignoreNativeWarning: true });
        showToast("Preferencia Guardada", "No volveremos a mostrarte este aviso.");
      } catch (e) {
        console.debug("Error guardando ignoreNativeWarning:", e);
      }
    }
  };

  const closeModal = async () => {
    await saveIgnoreState();
    overlay.classList.remove("show");
    setTimeout(() => overlay.remove(), 250);
  };

  btnClose.addEventListener("click", closeModal);
  btnSetup.addEventListener("click", async () => {
    await saveIgnoreState();
    overlay.classList.remove("show");
    setTimeout(() => {
      overlay.remove();
      showConfigModal();
    }, 250);
  });

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      closeModal();
    }
  });
}

async function checkAndAlertNativeConnection() {
  if (!isContextValid()) return;
  try {
    const storage = await chrome.storage.local.get("ignoreNativeWarning");
    if (storage.ignoreNativeWarning) {
      return; // El usuario eligió no ver el aviso
    }
    chrome.runtime.sendMessage({ action: "check_native_status" }, (res) => {
      if (!res || !res.connected) {
        // No está conectado, mostrar la modal de advertencia después de un breve delay
        setTimeout(() => {
          showNativeWarningModal();
        }, 1200);
      }
    });
  } catch (err) {
    console.debug("Error en checkAndAlertNativeConnection:", err);
  }
}

document.addEventListener("keydown", handleKeyDown);

// Arrancar script
init();
