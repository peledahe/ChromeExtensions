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
      await initUI(!!response.alignRightScreen, isCollapsed);
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
            await initUI(!!message.alignRightScreen, isCollapsed);
          } catch (err) {
            console.debug("Error leyendo almacenamiento en set2xMode:", err);
            destroyUI();
          }
        })();
      } else {
        destroyUI();
      }
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
async function initUI(alignRightScreen, isCollapsed) {
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
      <button class="mc-btn" id="mc-reload" title="Recargar">↻</button>
      
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
      
      <button class="mc-btn" id="mc-screenshot" title="Tomar captura (ScreenShot Merke)" style="display: flex; align-items: center; justify-content: center;">
        <svg viewBox="0 0 24 24" style="width:14px; height:14px; fill:none; stroke:currentColor; stroke-width:2.5; stroke-linecap:round; stroke-linejoin:round;">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
          <circle cx="12" cy="13" r="4"/>
        </svg>
      </button>

      <button class="mc-btn" id="mc-agenda" title="Abrir Agenda (Notes)" style="display: flex; align-items: center; justify-content: center;">
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
  const btnReload = shadow.querySelector("#mc-reload");
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
  const btnRestore = shadow.querySelector("#mc-2x");
  const btnCloseWindow = shadow.querySelector("#mc-close-window");

  // Ocultar botones si las extensiones correspondientes no están instaladas/activas
  if (extensionsStatus) {
    if (!extensionsStatus.agenda && btnAgenda) btnAgenda.style.display = "none";
    if (!extensionsStatus.videoplayer && btnVideoPlayer) btnVideoPlayer.style.display = "none";
    if (!extensionsStatus.imageplayer && btnImagePlayer) btnImagePlayer.style.display = "none";
  }

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
  btnReload.addEventListener("click", () => {
    if (!isContextValid()) return destroyUI();
    startLoadingState();
    chrome.runtime.sendMessage({ action: "reload" });
  });

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

  // Acción de captura de pantalla
  if (btnScreenshot) {
    btnScreenshot.addEventListener("click", () => {
      if (!isContextValid()) return destroyUI();
      chrome.runtime.sendMessage({ action: "take_screenshot" });
    });
  }

  // Abrir Agenda / Notes
  if (btnAgenda) {
    btnAgenda.addEventListener("click", () => {
      if (!isContextValid()) return destroyUI();
      chrome.runtime.sendMessage({
        action: "open_url",
        url: "chrome-extension://bgiopnnblbijgffgdohgmnkhopbonefd/notes.html"
      }, (response) => {
        if (chrome.runtime.lastError) {
          showToast("Error de Comunicación", `Asegúrate de recargar la extensión 2xScreen en chrome://extensions. Detalle: ${chrome.runtime.lastError.message}`);
        } else if (response && response.error) {
          showToast("Error al abrir Agenda", response.error);
        }
      });
    });
  }

  // Abrir Video Player
  if (btnVideoPlayer) {
    btnVideoPlayer.addEventListener("click", () => {
      if (!isContextValid()) return destroyUI();
      chrome.runtime.sendMessage({
        action: "open_url",
        url: "chrome-extension://akmbookdeplgfocoehhjajjakckkdfke/videoplayer.html"
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
      chrome.runtime.sendMessage({
        action: "open_url",
        url: "chrome-extension://dkpgjcdnjhempmphhmgnbabiimlccgne/imageplayer.html"
      }, (response) => {
        if (chrome.runtime.lastError) {
          showToast("Error de Comunicación", `Asegúrate de recargar la extensión 2xScreen en chrome://extensions. Detalle: ${chrome.runtime.lastError.message}`);
        } else if (response && response.error) {
          showToast("Error al abrir Image Player", response.error);
        }
      });
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
  const overlay = document.createElement("div");
  overlay.className = "mc-modal-overlay";

  overlay.innerHTML = `
    <div class="mc-modal-box">
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

  const overlay = document.createElement("div");
  overlay.className = "mc-modal-overlay";

  overlay.innerHTML = `
    <div class="mc-modal-box" style="text-align: center; max-width: 450px;">
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

document.addEventListener("keydown", handleKeyDown);

// Arrancar script
init();
