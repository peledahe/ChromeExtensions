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
function drawArrow(shape) {
  const head = Math.max(10, shape.w * 3);
  const dx = shape.x2 - shape.x1;
  const dy = shape.y2 - shape.y1;
  const ang = Math.atan2(dy, dx);

  ctx.beginPath();
  ctx.moveTo(shape.x1, shape.y1);
  ctx.lineTo(shape.x2, shape.y2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(shape.x2, shape.y2);
  ctx.lineTo(shape.x2 - head * Math.cos(ang - Math.PI / 6), shape.y2 - head * Math.sin(ang - Math.PI / 6));
  ctx.lineTo(shape.x2 - head * Math.cos(ang + Math.PI / 6), shape.y2 - head * Math.sin(ang + Math.PI / 6));
  ctx.closePath();
  ctx.fillStyle = shape.color;
  ctx.fill();
}

function drawShape(shape) {
  ctx.strokeStyle = shape.color;
  ctx.fillStyle = shape.color;
  ctx.lineWidth = shape.w;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (shape.type === 'rect') {
    const r = normRect(shape);
    ctx.strokeRect(r.x, r.y, r.w, r.h);
  } else if (shape.type === 'highlight') {
    const r = normRect(shape);
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.restore();
    ctx.strokeRect(r.x, r.y, r.w, r.h);
  } else if (shape.type === 'blur') {
    const r = normRect(shape);
    if (r.w > 2 && r.h > 2) {
      const blurPx = Math.max(4, Math.min(24, shape.w * 2));
      
      ctx.save();
      // Crear un canvas temporal para el fragmento
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = r.w;
      tempCanvas.height = r.h;
      const tCtx = tempCanvas.getContext('2d');
      
      // Dibujar parte del canvas actual en el temporal
      tCtx.drawImage(canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      
      // Aplicar filtro de desenfoque al canvas principal en esa área
      ctx.filter = `blur(${blurPx}px)`;
      ctx.drawImage(tempCanvas, r.x, r.y);
      ctx.filter = 'none';
      ctx.restore();
      
      // Dibujar borde sutil sobre la zona oculta
      ctx.save();
      ctx.fillStyle = 'rgba(15, 23, 42, 0.08)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.restore();
    }
  } else if (shape.type === 'arrow') {
    drawArrow(shape);
  } else if (shape.type === 'text') {
    const fontSize = shape.size || Math.max(14, shape.w * 5);
    ctx.save();
    ctx.font = `bold ${fontSize}px Inter, Arial, sans-serif`;
    ctx.fillText(shape.text, shape.x1, shape.y1);
    ctx.restore();
  } else if (shape.type === 'number') {
    const radius = shape.size || Math.max(14, shape.w * 5);
    ctx.save();
    ctx.beginPath();
    ctx.arc(shape.x1, shape.y1, radius, 0, Math.PI * 2);
    ctx.fillStyle = shape.color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.max(11, radius * 0.9)}px Inter, Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(shape.n), shape.x1, shape.y1 + 1);
    ctx.restore();
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
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(state.baseImage, 0, 0, canvas.width, canvas.height);
  
  // Dibujar todas las formas guardadas
  state.shapes.forEach(drawShape);
  
  // Dibujar forma temporal (borrador) si existe
  if (state.draft && state.tool !== 'select') {
    drawShape(state.draft);
  }
  
  // Mostrar caja de selección de recorte activa
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
  state.draft.x2 = p.x;
  state.draft.y2 = p.y;
  render();
});

window.addEventListener('mouseup', () => {
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
  // Obtener la imagen temporal guardada en el almacenamiento local de Chrome
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
      
      // Ajustar dimensiones del canvas nativas
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      
      applyZoom(80);
      
      render();
      updateNumberBadge();
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

init();
