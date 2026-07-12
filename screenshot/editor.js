const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');
const toastContainer = document.getElementById('toast-container');

// Modales
const confirmDialog = document.getElementById('confirm-dialog');
const textDialog = document.getElementById('text-dialog');
const textInput = document.getElementById('text-input');

let textResolve = null; // Para manejar el prompt de texto de manera asíncrona

const state = {
  tool: 'rect',
  color: '#ff2d55',
  width: 3,
  textSize: 24, // Tamaño por defecto de textos y números
  shapes: [],
  draft: null,
  drawing: false,
  baseImage: null,
  step: 1,
  selection: null,
  originalPath: '',
  zoom: 80, // Escala de visualización inicial a 80%
  offscreenCanvas: null,
  offscreenCtx: null,
  showBrowserLogo: true,
  browserLogoImg: null,
};

// --- Sistema de Notificaciones (Sticky Toasts) ---
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  const textSpan = document.createElement('span');
  textSpan.textContent = message;
  toast.appendChild(textSpan);
  
  const closeBtn = document.createElement('button');
  closeBtn.className = 'toast-close';
  closeBtn.innerHTML = '&times;';
  closeBtn.onclick = () => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 200);
  };
  toast.appendChild(closeBtn);
  
  toastContainer.appendChild(toast);
  
  // Auto-eliminar después de 4 segundos
  setTimeout(() => {
    if (toast.parentNode) {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 200);
    }
  }, 4000);
}

function setStatus(text) {
  statusEl.textContent = text;
}

function updateNumberBadge() {
  const badge = document.getElementById('num-badge');
  if (badge) badge.textContent = String(state.step);
}

function normRect(a) {
  const x = Math.min(a.x1, a.x2);
  const y = Math.min(a.y1, a.y2);
  const w = Math.max(1, Math.abs(a.x2 - a.x1));
  const h = Math.max(1, Math.abs(a.y2 - a.y1));
  return { x, y, w, h };
}

function setTool(tool) {
  state.tool = tool;
  document.querySelectorAll('.icon-btn').forEach((b) => {
    if (b.id.startsWith('tool-')) b.classList.remove('active');
  });
  const active = document.getElementById(`tool-${tool}`);
  if (active) active.classList.add('active');
  setStatus(`Herramienta activa: ${tool.toUpperCase()}`);
}

function getPos(e) {
  const r = canvas.getBoundingClientRect();
  // Escalar posiciones si el CSS cambia el tamaño mostrado en pantalla
  const scaleX = canvas.width / r.width;
  const scaleY = canvas.height / r.height;
  return { 
    x: (e.clientX - r.left) * scaleX, 
    y: (e.clientY - r.top) * scaleY 
  };
}

// --- Diálogos Personalizados (Evitando Prompts/Alerts) ---
function promptTextCustom() {
  return new Promise((resolve) => {
    textResolve = resolve;
    textInput.value = '';
    textDialog.showModal();
    setTimeout(() => textInput.focus(), 100);
  });
}

document.getElementById('btn-text-submit').onclick = () => {
  if (textResolve) {
    textResolve(textInput.value.trim());
    textResolve = null;
  }
  textDialog.close();
};

document.getElementById('btn-text-cancel').onclick = () => {
  if (textResolve) {
    textResolve(null);
    textResolve = null;
  }
  textDialog.close();
};

textInput.onkeydown = (e) => {
  if (e.key === 'Enter') {
    document.getElementById('btn-text-submit').click();
  }
};

function confirmClearCustom() {
  return new Promise((resolve) => {
    confirmDialog.showModal();
    document.getElementById('btn-confirm-accept').onclick = () => {
      confirmDialog.close();
      resolve(true);
    };
    document.getElementById('btn-confirm-cancel').onclick = () => {
      confirmDialog.close();
      resolve(false);
    };
  });
}

// --- Funciones de Dibujo en Canvas ---
function drawArrow(shape, context = ctx) {
  const head = Math.max(10, shape.w * 3);
  const dx = shape.x2 - shape.x1;
  const dy = shape.y2 - shape.y1;
  const ang = Math.atan2(dy, dx);

  context.beginPath();
  context.moveTo(shape.x1, shape.y1);
  context.lineTo(shape.x2, shape.y2);
  context.stroke();

  context.beginPath();
  context.moveTo(shape.x2, shape.y2);
  context.lineTo(shape.x2 - head * Math.cos(ang - Math.PI / 6), shape.y2 - head * Math.sin(ang - Math.PI / 6));
  context.lineTo(shape.x2 - head * Math.cos(ang + Math.PI / 6), shape.y2 - head * Math.sin(ang + Math.PI / 6));
  context.closePath();
  context.fillStyle = shape.color;
  context.fill();
}

function drawShape(shape, context = ctx) {
  context.strokeStyle = shape.color;
  context.fillStyle = shape.color;
  context.lineWidth = shape.w;
  context.lineCap = 'round';
  context.lineJoin = 'round';

  if (shape.type === 'rect') {
    const r = normRect(shape);
    context.strokeRect(r.x, r.y, r.w, r.h);
  } else if (shape.type === 'highlight') {
    const r = normRect(shape);
    context.save();
    context.globalAlpha = 0.28;
    context.fillRect(r.x, r.y, r.w, r.h);
    context.restore();
    context.strokeRect(r.x, r.y, r.w, r.h);
  } else if (shape.type === 'blur') {
    const r = normRect(shape);
    if (r.w > 2 && r.h > 2) {
      const blurPx = 10; // Radio menor para mantener la textura del fondo y que se note el efecto blur
      const margin = blurPx * 2;
      
      // Clampear las coordenadas de origen de la imagen
      const sx = Math.max(0, r.x - margin);
      const sy = Math.max(0, r.y - margin);
      const sw = Math.min(state.baseImage.naturalWidth - sx, r.w + (r.x - sx) + margin);
      const sh = Math.min(state.baseImage.naturalHeight - sy, r.h + (r.y - sy) + margin);

      context.save();
      
      // Aplicar máscara de recorte al área exacta que queremos cubrir
      context.beginPath();
      context.rect(r.x, r.y, r.w, r.h);
      context.clip();
      
      // Crear canvas temporal con el área ampliada
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = sw;
      tempCanvas.height = sh;
      const tCtx = tempCanvas.getContext('2d');
      
      tCtx.drawImage(state.baseImage, sx, sy, sw, sh, 0, 0, sw, sh);
      
      // Dibujar la versión ampliada y desenfocada
      context.filter = `blur(${blurPx}px)`;
      context.drawImage(tempCanvas, sx, sy);
      context.filter = 'none';
      context.restore();
      
      // Dibujar borde sutil sin fondo de color para que sea 100% transparente y natural
      context.save();
      context.strokeStyle = 'rgba(255, 255, 255, 0.1)'; // Borde muy suave para delimitar la zona
      context.lineWidth = 1;
      context.strokeRect(r.x, r.y, r.w, r.h);
      context.restore();
    }
  } else if (shape.type === 'circle') {
    const r = normRect(shape);
    context.beginPath();
    context.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
    context.stroke();
  } else if (shape.type === 'curve') {
    if (shape.points && shape.points.length > 0) {
      let pts = shape.points;
      // Realizar dos pasadas de promedio móvil para suavizar y redondear la curvatura enormemente
      for (let pass = 0; pass < 2; pass++) {
        if (pts.length >= 3) {
          const temp = [pts[0]];
          for (let i = 1; i < pts.length - 1; i++) {
            temp.push({
              x: (pts[i - 1].x + pts[i].x + pts[i + 1].x) / 3,
              y: (pts[i - 1].y + pts[i].y + pts[i + 1].y) / 3
            });
          }
          temp.push(pts[pts.length - 1]);
          pts = temp;
        }
      }

      context.beginPath();
      context.moveTo(pts[0].x, pts[0].y);
      if (pts.length === 1) {
        context.lineTo(pts[0].x, pts[0].y);
      } else if (pts.length === 2) {
        context.lineTo(pts[1].x, pts[1].y);
      } else {
        for (let i = 1; i < pts.length - 1; i++) {
          const xc = (pts[i].x + pts[i + 1].x) / 2;
          const yc = (pts[i].y + pts[i + 1].y) / 2;
          context.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
        }
        context.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
      }
      context.stroke();
    }
  } else if (shape.type === 'arrow') {
    drawArrow(shape, context);
  } else if (shape.type === 'text') {
    const fontSize = shape.size || Math.max(14, shape.w * 5);
    context.save();
    context.font = `bold ${fontSize}px Inter, Arial, sans-serif`;
    context.fillText(shape.text, shape.x1, shape.y1);
    context.restore();
  } else if (shape.type === 'number') {
    const radius = shape.size || Math.max(14, shape.w * 5);
    context.save();
    context.beginPath();
    context.arc(shape.x1, shape.y1, radius, 0, Math.PI * 2);
    context.fillStyle = shape.color;
    context.fill();
    context.lineWidth = 2;
    context.strokeStyle = '#ffffff';
    context.stroke();
    
    context.fillStyle = '#ffffff';
    context.font = `bold ${Math.max(11, radius * 0.9)}px Inter, Arial, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(String(shape.n), shape.x1, shape.y1 + 1);
    context.restore();
  } else if (shape.type === 'pencil' || shape.type === 'eraser') {
    if (shape.points && shape.points.length > 0) {
      context.beginPath();
      context.moveTo(shape.points[0].x, shape.points[0].y);
      for (let i = 1; i < shape.points.length; i++) {
        context.lineTo(shape.points[i].x, shape.points[i].y);
      }
      context.stroke();
    }
  }
}

function drawSelectionBox(rect) {
  if (!rect || rect.w < 2 || rect.h < 2) return;
  ctx.save();
  ctx.setLineDash([6, 3]);
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 2;
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  ctx.fillStyle = 'rgba(37, 99, 235, 0.08)';
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.restore();
}

function render() {
  if (!state.baseImage) return;
  
  // 1. Limpiar canvas principal
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // 2. Dibujar imagen base en el canvas principal
  ctx.drawImage(state.baseImage, 0, 0, canvas.width, canvas.height);
  
  // 3. Preparar canvas offscreen para las anotaciones
  const oCanvas = state.offscreenCanvas;
  const oCtx = state.offscreenCtx;
  if (oCanvas && oCtx) {
    oCtx.clearRect(0, 0, oCanvas.width, oCanvas.height);
    
    // Dibujar todas las formas guardadas en el canvas offscreen
    state.shapes.forEach(shape => {
      if (shape.type === 'eraser') {
        oCtx.save();
        oCtx.globalCompositeOperation = 'destination-out';
        drawShape(shape, oCtx);
        oCtx.restore();
      } else {
        drawShape(shape, oCtx);
      }
    });
    
    // Dibujar forma temporal (borrador) en el canvas offscreen si existe
    if (state.draft && state.tool !== 'select') {
      if (state.draft.type === 'eraser') {
        oCtx.save();
        oCtx.globalCompositeOperation = 'destination-out';
        drawShape(state.draft, oCtx);
        oCtx.restore();
      } else {
        drawShape(state.draft, oCtx);
      }
    }
    
    // 4. Dibujar el canvas offscreen sobre el principal
    ctx.drawImage(oCanvas, 0, 0);
  } else {
    // Fallback si no está inicializado el canvas offscreen
    state.shapes.forEach(shape => drawShape(shape, ctx));
    if (state.draft && state.tool !== 'select') {
      drawShape(state.draft, ctx);
    }
  }
  
  // 4.5. Dibujar marca de agua del navegador
  if (state.showBrowserLogo && state.browserLogoImg) {
    const size = 32;
    const padding = 16;
    
    let lx, ly;
    // Si hay un recorte activo y es lo suficientemente grande, movemos el logo al recorte
    if (state.selection && state.selection.w > (size + padding * 2) && state.selection.h > (size + padding * 2)) {
      lx = state.selection.x + state.selection.w - size - padding;
      ly = state.selection.y + state.selection.h - size - padding;
    } else {
      lx = canvas.width - size - padding;
      ly = canvas.height - size - padding;
    }
    
    ctx.save();
    ctx.globalAlpha = 0.65; // Transparencia para que deje ver la imagen de fondo sutilmente
    ctx.beginPath();
    ctx.arc(lx + size / 2, ly + size / 2, size / 2 + 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2;
    ctx.fill();
    
    ctx.drawImage(state.browserLogoImg, lx, ly, size, size);
    ctx.restore();
  }
  
  // 5. Mostrar caja de selección de recorte activa
  if (state.selection) {
    drawSelectionBox(state.selection);
  }
  if (state.draft && state.tool === 'select') {
    drawSelectionBox(normRect(state.draft));
  }
}

// --- Eventos de Dibujo ---
canvas.addEventListener('mousedown', async (e) => {
  if (!state.baseImage) return;
  const p = getPos(e);

  if (state.tool === 'number') {
    state.shapes.push({ 
      type: 'number', 
      x1: p.x, 
      y1: p.y, 
      color: state.color, 
      w: state.width, 
      n: state.step++,
      size: state.textSize
    });
    updateNumberBadge();
    render();
    setStatus('Paso numerado agregado.');
    return;
  }

  if (state.tool === 'text') {
    const text = await promptTextCustom();
    if (text) {
      state.shapes.push({ 
        type: 'text', 
        x1: p.x, 
        y1: p.y, 
        text: text, 
        color: state.color, 
        w: state.width,
        size: state.textSize
      });
      render();
      setStatus('Texto agregado.');
      showToast('Texto agregado con éxito.', 'success');
    }
    return;
  }

  if (state.tool === 'pencil' || state.tool === 'eraser' || state.tool === 'curve') {
    state.drawing = true;
    state.draft = {
      type: state.tool,
      points: [p],
      color: state.tool === 'eraser' ? 'rgba(0,0,0,1)' : state.color,
      w: state.tool === 'eraser' ? state.width * 2 + 6 : state.width, // Borrador un poco más ancho
    };
    return;
  }

  state.drawing = true;
  state.draft = {
    type: state.tool,
    x1: p.x,
    y1: p.y,
    x2: p.x,
    y2: p.y,
    color: state.color,
    w: state.width,
  };
});

canvas.addEventListener('mousemove', (e) => {
  if (!state.drawing || !state.draft) return;
  const p = getPos(e);
  if (state.draft.type === 'pencil' || state.draft.type === 'eraser') {
    state.draft.points.push(p);
  } else if (state.draft.type === 'curve') {
    const pts = state.draft.points;
    const lastPt = pts[pts.length - 1];
    const dist = Math.hypot(p.x - lastPt.x, p.y - lastPt.y);
    if (dist > 24) { // Espaciar puntos de control (mínimo 24px de separación) para suavizar
      pts.push(p);
    }
  } else {
    state.draft.x2 = p.x;
    state.draft.y2 = p.y;
  }
  render();
});

window.addEventListener('mouseup', (e) => {
  if (!state.drawing || !state.draft) return;

  if (state.tool === 'select') {
    const rect = normRect(state.draft);
    state.selection = (rect.w > 4 && rect.h > 4) ? rect : null;
    state.draft = null;
    state.drawing = false;
    render();
    if (state.selection) {
      setStatus('Área seleccionada. Guardar/Copiar exportará solo este recorte.');
      showToast('Recorte fijado correctamente.');
    } else {
      setStatus('Selección cancelada.');
    }
    return;
  }

  if (state.draft.type === 'curve') {
    const p = getPos(e);
    state.draft.points.push(p);
  }

  state.shapes.push(state.draft);
  state.draft = null;
  state.drawing = false;
  render();
  setStatus('Anotación agregada.');
});

// --- Manejadores de Herramientas ---
document.getElementById('tool-select').onclick = () => setTool('select');
document.getElementById('tool-rect').onclick = () => setTool('rect');
document.getElementById('tool-arrow').onclick = () => setTool('arrow');
document.getElementById('tool-circle').onclick = () => setTool('circle');
document.getElementById('tool-curve').onclick = () => setTool('curve');
document.getElementById('tool-pencil').onclick = () => setTool('pencil');
document.getElementById('tool-eraser').onclick = () => setTool('eraser');
document.getElementById('tool-text').onclick = () => setTool('text');
document.getElementById('tool-highlight').onclick = () => setTool('highlight');
document.getElementById('tool-blur').onclick = () => setTool('blur');
document.getElementById('tool-number').onclick = () => setTool('number');

document.getElementById('color').oninput = (e) => {
  state.color = e.target.value;
};

document.getElementById('width').oninput = (e) => {
  state.width = Number(e.target.value) || 3;
};

document.getElementById('text-size').oninput = (e) => {
  state.textSize = Number(e.target.value) || 24;
};

function applyZoom(zoomVal) {
  state.zoom = zoomVal;
  if (state.baseImage) {
    const scale = zoomVal / 100;
    canvas.style.width = `${state.baseImage.naturalWidth * scale}px`;
    canvas.style.height = `${state.baseImage.naturalHeight * scale}px`;
  }
  const rangeInput = document.getElementById('zoom-range');
  const valSpan = document.getElementById('zoom-value');
  if (rangeInput) rangeInput.value = zoomVal;
  if (valSpan) valSpan.textContent = `${zoomVal}%`;
}

const zoomRangeInput = document.getElementById('zoom-range');
if (zoomRangeInput) {
  zoomRangeInput.oninput = (e) => {
    applyZoom(Number(e.target.value) || 80);
  };
}

function handleUndo() {
  const popped = state.shapes.pop();
  if (popped && popped.type === 'number') {
    state.step = Math.max(1, state.step - 1);
    updateNumberBadge();
  }
  render();
  setStatus('Se deshizo la última anotación.');
  showToast('Acción deshecha.');
}

document.getElementById('undo').onclick = handleUndo;

document.getElementById('clear-selection').onclick = () => {
  state.selection = null;
  render();
  setStatus('Selección de área eliminada.');
  showToast('Recorte quitado.');
};

document.getElementById('clear').onclick = async () => {
  const confirmClear = await confirmClearCustom();
  if (confirmClear) {
    state.shapes = [];
    state.draft = null;
    state.step = 1;
    updateNumberBadge();
    render();
    setStatus('Anotaciones limpiadas.');
    showToast('Se limpiaron todos los dibujos.', 'danger');
  }
};

// --- Acciones de Exportación (Copiar y Descargar) ---
function getExportCanvasDataUrl() {
  // Si no hay selección, exporta el lienzo completo
  if (!state.selection) {
    return canvas.toDataURL('image/png');
  }
  
  const { x, y, w, h } = state.selection;
  if (w < 2 || h < 2) {
    return canvas.toDataURL('image/png');
  }

  // Crear un canvas intermedio para extraer el recorte
  const out = document.createElement('canvas');
  out.width = Math.floor(w);
  out.height = Math.floor(h);
  const octx = out.getContext('2d');
  
  // Dibujar sólo el recorte del canvas de dibujo (el cual ya tiene la base + formas)
  octx.drawImage(canvas, x, y, w, h, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

// Descarga nativa y multiplataforma
document.getElementById('save').onclick = () => {
  if (!state.baseImage) return;
  
  try {
    const dataUrl = getExportCanvasDataUrl();
    const link = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    link.download = `screenshot_${timestamp}.png`;
    link.href = dataUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showToast('¡Imagen descargada con éxito!', 'success');
    setStatus('Imagen guardada. Cerrando editor...');
    
    // Cerrar pestaña después de un breve retardo para permitir la descarga y ver el toast
    setTimeout(() => {
      window.close();
    }, 450);
  } catch (error) {
    console.error("Error al descargar la imagen:", error);
    showToast('No se pudo descargar la imagen.', 'danger');
  }
};

// Copiado de imagen al portapapeles nativo
document.getElementById('copy').onclick = async () => {
  if (!state.baseImage) return;
  
  setStatus('Copiando al portapapeles...');
  try {
    const dataUrl = getExportCanvasDataUrl();
    
    // Convertir Data URL a un Blob
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    
    // Escribir en el portapapeles usando la API nativa de Chrome
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': blob })
    ]);
    
    showToast('¡Imagen copiada al portapapeles!', 'success');
    setStatus('Imagen copiada. Cerrando editor...');
    
    // Cerrar pestaña después de un breve retardo para ver el toast de éxito
    setTimeout(() => {
      window.close();
    }, 450);
  } catch (error) {
    console.error('Error al copiar al portapapeles:', error);
    showToast('Error al copiar. Asegúrate de dar permisos de portapapeles.', 'danger');
    setStatus('No se pudo copiar la imagen.');
  }
};

// Cancelar y cerrar pestaña
document.getElementById('cancel').onclick = () => {
  // Cerrar la pestaña actual de la extensión
  window.close();
};

// --- Atajos de Teclado ---
window.addEventListener('keydown', (e) => {
  // Deshacer con Ctrl+Z (o Cmd+Z en macOS)
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
    e.preventDefault();
    handleUndo();
  }
  
  // Limpiar selección con Escape
  if (e.key === 'Escape') {
    if (state.selection) {
      document.getElementById('clear-selection').click();
    }
  }
});

// --- Inicialización y Carga de la Captura ---
function init() {
  // Resetear estado para la nueva captura
  state.shapes = [];
  state.draft = null;
  state.step = 1;
  state.selection = null;
  updateNumberBadge();

  chrome.storage.local.get('tempScreenshot', (data) => {
    const raw = data.tempScreenshot;
    if (!raw) {
      setStatus('No se recibió ninguna captura de pantalla para editar.');
      showToast('Error: No se encontró la captura en el almacenamiento.', 'danger');
      return;
    }

    const img = new Image();
    img.onload = () => {
      state.baseImage = img;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      state.offscreenCanvas = document.createElement('canvas');
      state.offscreenCanvas.width = canvas.width;
      state.offscreenCanvas.height = canvas.height;
      state.offscreenCtx = state.offscreenCanvas.getContext('2d');
      applyZoom(80);
      render();
      setTool('rect');
      setStatus('Captura cargada con éxito. Listo para anotar.');
      showToast('Captura de pantalla cargada.');
    };
    img.onerror = () => {
      setStatus('Error al cargar la captura.');
      showToast('No se pudo renderizar la captura de pantalla.', 'danger');
    };
    img.src = raw;
  });
}

// Recargar la imagen si la pestaña ya estaba abierta y llega una nueva captura
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.tempScreenshot) {
    init();
  }
});

// --- Detección de Navegador y Logo (Marca de Agua) ---
const isEdge = navigator.userAgent.includes("Edg");
const isFirefox = navigator.userAgent.includes("Firefox");
const isOpera = navigator.userAgent.includes("OPR") || navigator.userAgent.includes("Opera");

let browserLogoSvg;
if (isEdge) {
  browserLogoSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="32" height="32"><path fill="#0C59A4" d="M117 76c0 23-18 41-41 41-30 0-54-24-54-54S46 9 76 9c9 0 18 2 26 6L88 34c-4-2-8-3-12-3-19 0-34 15-34 34s15 34 34 34c11 0 21-5 27-14l14 21z"/><path fill="#1CA9E7" d="M117 76c0-6 0-39-33-40h-8c-19 0-34 15-34 34s15 34 34 34c11 0 21-5 27-14l14 21z" opacity=".2"/><path fill="#00A4EF" d="M76 9c19 0 35 12 40 29l-30 9c-3-3-6-5-10-5-11 0-21 9-21 21v31l-21 16C23 99 15 88 15 76c0-30 24-54 54-54 2 0 5 0 7 1z"/><path fill="#7FBA00" d="M116 38c2 7 3 15 3 24l-31-8c0-3 1-7 3-10l25-6z"/></svg>`;
} else if (isFirefox) {
  browserLogoSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 1c3.12 0 5.86 1.8 7.2 4.45-1.04-1.2-2.53-1.95-4.2-1.95-3.03 0-5.5 2.47-5.5 5.5s2.47 5.5 5.5 5.5c1.67 0 3.16-.75 4.2-1.95C17.86 19.2 15.12 21 12 21c-4.97 0-9-4.03-9-9s4.03-9 9-9z" fill="#E66000"/><circle cx="12" cy="12" r="5" fill="#3B78C2"/><path d="M12 7c-2.76 0-5 2.24-5 5 0 .62.11 1.21.32 1.76C7.94 11.23 9.8 9.5 12 9.5c2.2 0 4.06 1.73 4.68 4.26.21-.55.32-1.14.32-1.76 0-2.76-2.24-5-5-5z" fill="#FF9500"/></svg>`;
} else if (isOpera) {
  browserLogoSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 2c3.58 0 6.5 3.58 6.5 8s-2.92 8-6.5 8-6.5-3.58-6.5-8 2.92-8 6.5-8z" fill="#CC0F0F"/></svg>`;
} else {
  browserLogoSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32"><circle cx="12" cy="12" r="10" fill="#f1f3f4"/><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z" fill="#4285F4"/><path d="M12 2a9.96 9.96 0 0 1 7.6 3.48L14.7 13.8a3 3 0 0 0-2.7-1.8H4.6A9.96 9.96 0 0 1 12 2z" fill="#EA4335"/><path d="M19.6 5.48A9.96 9.96 0 0 1 22 12c0 4.88-3.5 8.94-8.1 9.8l-4.9-8.49a3 3 0 0 0 .5-3.32l10.1-4.51z" fill="#FBBC05"/><path d="M13.9 21.8c-.62.1-1.25.2-1.9.2A9.96 9.96 0 0 1 4.6 12L9.7 3.17a3 3 0 0 0 2.2 5.13h7.7v1.5c0 4.88-3.5 8.94-8.1 9.8z" fill="#34A853"/><circle cx="12" cy="12" r="4.5" fill="#ffffff"/><circle cx="12" cy="12" r="3.5" fill="#4285F4"/></svg>`;
}

const logoImg = new Image();
logoImg.onload = () => {
  render();
};
logoImg.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(browserLogoSvg);
state.browserLogoImg = logoImg;

const toggleLogoInput = document.getElementById('toggle-logo');
if (toggleLogoInput) {
  toggleLogoInput.onchange = (e) => {
    state.showBrowserLogo = e.target.checked;
    render();
  };
}

// --- Modal Acerca de ---
const aboutDialog = document.getElementById('about-dialog');
const logoAbout = document.getElementById('logo-about');
if (logoAbout && aboutDialog) {
  logoAbout.onclick = () => {
    aboutDialog.style.display = 'flex';
  };
}
const btnAboutClose = document.getElementById('btn-about-close');
if (btnAboutClose && aboutDialog) {
  btnAboutClose.onclick = () => {
    aboutDialog.style.display = 'none';
  };
}
if (aboutDialog) {
  aboutDialog.onclick = (e) => {
    if (e.target === aboutDialog) {
      aboutDialog.style.display = 'none';
    }
  };
}
const aboutLink = document.getElementById('screenshot-about-modal-link');
if (aboutLink) {
  aboutLink.onclick = (e) => {
    e.preventDefault();
    window.open('https://ext.merke.net', '_blank');
  };
}

init();

