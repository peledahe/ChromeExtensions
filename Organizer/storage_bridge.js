// ============================================================
// storage_bridge.js - Polyfill para simular el puente de Python (py y pw)
// a través del almacenamiento local del navegador (chrome.storage.local).
// ============================================================

(function() {
  let isInjectingDemo = false;
  const genericChangeListeners = [];

  function createLocalStorageArea() {
    return {
      get: function(keys, callback) {
        const result = {};
        const keyList = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : (keys && typeof keys === 'object' ? Object.keys(keys) : null));
        if (keyList === null) {
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            try { result[k] = JSON.parse(localStorage.getItem(k)); } catch (e) { result[k] = localStorage.getItem(k); }
          }
        } else {
          keyList.forEach((k) => {
            const val = localStorage.getItem(k);
            if (val !== null) {
              try { result[k] = JSON.parse(val); } catch (e) { result[k] = val; }
            } else if (keys && typeof keys === 'object' && !Array.isArray(keys) && keys[k] !== undefined) {
              result[k] = keys[k];
            }
          });
        }
        if (typeof callback === 'function') callback(result);
      },
      set: function(items, callback) {
        const changes = {};
        if (items && typeof items === 'object') {
          Object.keys(items).forEach((k) => {
            const oldVal = localStorage.getItem(k);
            let parsedOld = undefined;
            if (oldVal !== null) {
              try { parsedOld = JSON.parse(oldVal); } catch (e) { parsedOld = oldVal; }
            }
            localStorage.setItem(k, JSON.stringify(items[k]));
            changes[k] = { oldValue: parsedOld, newValue: items[k] };
          });
        }
        genericChangeListeners.forEach((fn) => {
          try { fn(changes, 'local'); } catch (e) { console.error(e); }
        });
        if (typeof callback === 'function') callback();
      },
      remove: function(keys, callback) {
        const keyList = Array.isArray(keys) ? keys : [keys];
        const changes = {};
        keyList.forEach((k) => {
          const oldVal = localStorage.getItem(k);
          let parsedOld = undefined;
          if (oldVal !== null) {
            try { parsedOld = JSON.parse(oldVal); } catch (e) { parsedOld = oldVal; }
          }
          localStorage.removeItem(k);
          changes[k] = { oldValue: parsedOld, newValue: undefined };
        });
        genericChangeListeners.forEach((fn) => {
          try { fn(changes, 'local'); } catch (e) { console.error(e); }
        });
        if (typeof callback === 'function') callback();
      }
    };
  }

  // Polyfill de chrome.storage y chrome.identity para entorno Electron Desktop y Minichrome
  if (typeof window.chrome === 'undefined') {
    window.chrome = {};
  }
  window.chrome.runtime = window.chrome.runtime || { lastError: undefined };

  if (window.desktop) {
    const desktopChangeListeners = [];
    if (window.desktop.onStorageChanged && window.desktop.onStorageChanged.addListener) {
      window.desktop.onStorageChanged.addListener((changes, area) => {
        desktopChangeListeners.forEach((fn) => {
          try { fn(changes, area || 'local'); } catch (e) { console.error(e); }
        });
      });
    }

    function createDesktopStorageArea() {
      return {
        get: function(keys, callback) {
          window.desktop.storage.get(keys).then((res) => {
            if (typeof callback === 'function') callback(res || {});
          });
        },
        set: function(items, callback) {
          window.desktop.storage.set(items).then(() => {
            if (typeof callback === 'function') callback();
          });
        },
        remove: function(keys, callback) {
          window.desktop.storage.remove(keys).then(() => {
            if (typeof callback === 'function') callback();
          });
        }
      };
    }

    window.chrome.storage = {
      local: createDesktopStorageArea(),
      sync: createDesktopStorageArea(),
      onChanged: {
        addListener: function(fn) {
          if (typeof fn === 'function') desktopChangeListeners.push(fn);
        }
      }
    };
    window.chrome.identity = {
      getAuthToken: function(options, callback) {
        window.desktop.getAuthToken(options || {}).then((res) => {
          window.chrome.runtime.lastError = res && res.error ? { message: res.error } : undefined;
          if (typeof callback === 'function') callback(res && res.token);
        });
      },
      removeCachedAuthToken: function(_options, callback) {
        window.chrome.runtime.lastError = undefined;
        if (typeof callback === 'function') callback();
      }
    };
  } else if (!window.chrome.storage || !window.chrome.storage.local) {
    // Minichrome y navegadores web
    window.chrome.storage = {
      local: createLocalStorageArea(),
      sync: createLocalStorageArea(),
      onChanged: {
        addListener: function(fn) {
          if (typeof fn === 'function') genericChangeListeners.push(fn);
        }
      }
    };
    function loadGisLibrary() {
      return new Promise((resolve) => {
        if (window.google?.accounts?.oauth2) return resolve(true);
        const s = document.createElement('script');
        s.src = 'https://accounts.google.com/gsi/client';
        s.async = true;
        s.defer = true;
        s.onload = () => resolve(true);
        s.onerror = () => resolve(false);
        document.head.appendChild(s);
      });
    }

    function showWebAuthModal(scopes, callback) {
      const existing = document.getElementById('ag-auth-modal');
      if (existing) existing.remove();

      const overlay = document.createElement('div');
      overlay.id = 'ag-auth-modal';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;z-index:99999;font-family:sans-serif;padding:16px;';

      const modal = document.createElement('div');
      modal.style.cssText = 'background:#111827;border:1px solid rgba(255,255,255,0.15);border-radius:14px;padding:24px;max-width:460px;width:100%;color:#f3f4f6;box-shadow:0 20px 40px rgba(0,0,0,0.6);';

      modal.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
          <span style="font-size:24px;">🔑</span>
          <h3 style="margin:0;font-size:18px;font-weight:700;color:#fff;">Conectar Google Apps (Minichrome)</h3>
        </div>
        <p style="font-size:13px;color:#9ca3af;line-height:1.5;margin:0 0 16px;">
          Inicia sesión con tu cuenta de Google para sincronizar tus datos con Google Drive y Calendar.
        </p>
        <div style="display:flex;flex-direction:column;gap:12px;margin-bottom:20px;">
          <button id="ag-auth-login-btn" style="background:#2563eb;color:#fff;border:none;border-radius:8px;padding:11px 16px;font-weight:600;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;gap:8px;">
            <span>🌐</span> Iniciar sesión con Google
          </button>
          <div style="display:flex;align-items:center;gap:8px;margin:4px 0;">
            <div style="flex:1;height:1px;background:rgba(255,255,255,0.1);"></div>
            <span style="font-size:11px;color:#6b7280;text-transform:uppercase;">o ingresar token</span>
            <div style="flex:1;height:1px;background:rgba(255,255,255,0.1);"></div>
          </div>
          <input id="ag-auth-token-input" type="password" placeholder="Pegar Access Token (ya29...)" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:10px 14px;color:#fff;font-size:13px;width:100%;box-sizing:border-box;" />
        </div>
        <div style="display:flex;justify-content:flex-end;gap:10px;">
          <button id="ag-auth-cancel-btn" style="background:transparent;border:1px solid rgba(255,255,255,0.2);color:#9ca3af;border-radius:8px;padding:8px 16px;cursor:pointer;font-size:13px;">Cancelar</button>
          <button id="ag-auth-save-btn" style="background:#10b981;border:none;color:#fff;border-radius:8px;padding:8px 16px;cursor:pointer;font-weight:600;font-size:13px;">Guardar Token</button>
        </div>
      `;

      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      const close = (token) => {
        overlay.remove();
        if (typeof callback === 'function') callback(token);
      };

      modal.querySelector('#ag-auth-cancel-btn').onclick = () => close(null);
      modal.querySelector('#ag-auth-save-btn').onclick = () => {
        const tok = modal.querySelector('#ag-auth-token-input').value.trim();
        if (tok) {
          localStorage.setItem('gdrive_token', tok);
          close(tok);
        } else {
          close(null);
        }
      };

      modal.querySelector('#ag-auth-login-btn').onclick = async () => {
        const isGisReady = await loadGisLibrary();
        const clientId = localStorage.getItem('google_client_id') || '136352780967-h1r5murn40hf23gdas5f2s4ft9keb9q7.apps.googleusercontent.com';
        const scopeStr = Array.isArray(scopes) ? scopes.join(' ') : 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/calendar';
        
        if (isGisReady && window.google?.accounts?.oauth2) {
          try {
            const client = window.google.accounts.oauth2.initTokenClient({
              client_id: clientId,
              scope: scopeStr,
              callback: (res) => {
                if (res && res.access_token) {
                  localStorage.setItem('gdrive_token', res.access_token);
                  close(res.access_token);
                } else {
                  console.warn('GIS respuesta sin token:', res);
                }
              }
            });
            client.requestAccessToken({ prompt: 'consent' });
          } catch (err) {
            console.error('Error GIS client:', err);
          }
        } else {
          window.open(`https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&response_type=token&redirect_uri=${encodeURIComponent(window.location.origin || 'http://localhost')}&scope=${encodeURIComponent(scopeStr)}`, '_blank');
        }
      };
    }

    window.chrome.identity = window.chrome.identity || {
      getAuthToken: function(options, callback) {
        const cached = localStorage.getItem('gdrive_token');
        if (cached) {
          if (typeof callback === 'function') callback(cached);
          return;
        }

        if (options && options.interactive) {
          const scopes = (options.scopes && options.scopes.length > 0) ? options.scopes : ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/calendar'];
          showWebAuthModal(scopes, callback);
        } else {
          if (typeof callback === 'function') callback(null);
        }
      },
      removeCachedAuthToken: function(_options, callback) {
        localStorage.removeItem('gdrive_token');
        if (typeof callback === 'function') callback();
      }
    };
  }

  // Inicialización segura de QWebChannel sin pisar el transporte nativo de Qt si existe
  if (typeof window.qt === 'undefined') {
    window.qt = {
      webChannelTransport: {}
    };
  }

  // Helper para interactuar con chrome.storage.local/sync de forma asíncrona
  const storage = {
    get: function(key, defaultValue) {
      return new Promise((resolve) => {
        try {
          const useSync = (key === 'app_config');
          if (useSync) {
            // Estrategia híbrida: Intentar primero sync, si no hay datos o falla, hacer fallback a local
            const getFromSync = () => {
              return new Promise((resSync) => {
                if (typeof browser !== 'undefined' && browser.storage && browser.storage.sync) {
                  browser.storage.sync.get(key)
                    .then(res => resSync(res && res[key] !== undefined ? res[key] : null))
                    .catch(() => resSync(null));
                } else if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
                  chrome.storage.sync.get([key], (res) => {
                    if (chrome.runtime.lastError || !res || res[key] === undefined) {
                      resSync(null);
                    } else {
                      resSync(res[key]);
                    }
                  });
                } else {
                  resSync(null);
                }
              });
            };

            const getFromLocal = () => {
              return new Promise((resLocal) => {
                if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
                  browser.storage.local.get(key)
                    .then(res => resLocal(res && res[key] !== undefined ? res[key] : null))
                    .catch(() => resLocal(null));
                } else if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                  chrome.storage.local.get([key], (res) => {
                    if (chrome.runtime.lastError || !res || res[key] === undefined) {
                      resLocal(null);
                    } else {
                      resLocal(res[key]);
                    }
                  });
                } else {
                  resLocal(null);
                }
              });
            };

            getFromSync().then((syncVal) => {
              if (syncVal !== null) {
                resolve(syncVal);
              } else {
                getFromLocal().then((localVal) => {
                  resolve(localVal !== null ? localVal : defaultValue);
                });
              }
            });
            return;
          }

          if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
            browser.storage.local.get(key)
              .then((result) => {
                if (result && result[key] !== undefined) {
                  resolve(result[key]);
                } else {
                  resolve(defaultValue);
                }
              })
              .catch((err) => {
                console.error("browser.storage.local.get error, falling back:", err);
                resolve(defaultValue);
              });
          } else if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.get([key], (result) => {
              if (chrome.runtime.lastError) {
                console.error("chrome.storage.local.get error:", chrome.runtime.lastError);
                resolve(defaultValue);
                return;
              }
              if (result && result[key] !== undefined) {
                resolve(result[key]);
              } else {
                resolve(defaultValue);
              }
            });
          } else {
            const val = localStorage.getItem('mock_' + key);
            if (val !== null) {
              try {
                resolve(JSON.parse(val));
              } catch (e) {
                resolve(val);
              }
            } else {
              resolve(defaultValue);
            }
          }
        } catch (e) {
          console.error("Storage get general error, fallback to defaultValue:", e);
          resolve(defaultValue);
        }
      });
    },
    set: function(key, value) {
      // Guardar bandera local_data_modified si no estamos inyectando datos de demostración
      // e egnoramos las claves propias de la sincronización de gdrive para evitar ciclos.
      const syncKeys = ['gdrive_token', 'gdrive_last_sync', 'gdrive_force_download', 'local_data_modified'];
      if (!isInjectingDemo && !syncKeys.includes(key)) {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ local_data_modified: true });
        }
      }

      return new Promise((resolve) => {
        try {
          const useSync = (key === 'app_config');
          if (useSync) {
            // Guardamos concurrentemente en sync y local (si están disponibles) para tener siempre respaldo local
            const promises = [];
            if (typeof browser !== 'undefined' && browser.storage) {
              if (browser.storage.sync) {
                promises.push(browser.storage.sync.set({ [key]: value }).catch(e => console.error("browser.storage.sync.set error:", e)));
              }
              if (browser.storage.local) {
                promises.push(browser.storage.local.set({ [key]: value }).catch(e => console.error("browser.storage.local.set error:", e)));
              }
            } else if (typeof chrome !== 'undefined' && chrome.storage) {
              if (chrome.storage.sync) {
                promises.push(new Promise(r => chrome.storage.sync.set({ [key]: value }, r)));
              }
              if (chrome.storage.local) {
                promises.push(new Promise(r => chrome.storage.local.set({ [key]: value }, r)));
              }
            }
            
            if (promises.length > 0) {
              Promise.all(promises).then(() => resolve());
              return;
            }
          }

          if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
            browser.storage.local.set({ [key]: value })
              .then(() => resolve())
              .catch((err) => {
                console.error("browser.storage.local.set error:", err);
                resolve();
              });
          } else if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ [key]: value }, () => {
              if (chrome.runtime.lastError) {
                console.error("chrome.storage.local.set error:", chrome.runtime.lastError);
              }
              resolve();
            });
          } else {
            localStorage.setItem('mock_' + key, JSON.stringify(value));
            resolve();
          }
        } catch (e) {
          console.error("Storage set general error:", e);
          resolve();
        }
      });
    }
  };

  // Función para poblar la aplicación con datos de demostración en español
  async function injectDemoData(force = false) {
    if (typeof chrome === 'undefined' || !chrome.storage) return;

    const check = await storage.get('agenda', null);
    if (check !== null && !force) return;

    isInjectingDemo = true;
    try {
      console.log("Inyectando hermosos datos de demostración en español...");

    const todayStr = new Date().toISOString().split('T')[0];
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    const in3Days = new Date();
    in3Days.setDate(in3Days.getDate() + 3);
    const in3DaysStr = in3Days.toISOString().split('T')[0];

    const demoAgenda = [
      { id: 1, text: "Reunión de planificación de sprint", dueDate: todayStr, tag: "Trabajo, Reunión", done: 0, ts: new Date().toISOString() },
      { id: 2, text: "Comprar café en grano y leche de almendras", dueDate: todayStr, tag: "Personal", done: 1, ts: new Date().toISOString() },
      { id: 3, text: "Revisar balance contable del mes", dueDate: tomorrowStr, tag: "Finanzas, Urgente", done: 0, ts: new Date().toISOString() },
      { id: 4, text: "Llamar al soporte del hosting de producción", dueDate: yesterdayStr, tag: "Trabajo", done: 1, ts: new Date().toISOString() },
      { id: 5, text: "Diseñar propuesta de interfaz de usuario para cliente", dueDate: in3DaysStr, tag: "Diseño, Freelance", done: 0, ts: new Date().toISOString() }
    ];

    const demoIncome = [
      { id: 1, text: "Salario Corporativo", value: 14500, currency: "local", dueDate: todayStr, category: "Salario", status: "confirmed" },
      { id: 2, text: "Consultoría UI Freelance", value: 500, currency: "second", dueDate: tomorrowStr, category: "Freelance", status: "projected" },
      { id: 3, text: "Rendimiento Inversiones", value: 850, currency: "local", dueDate: in3DaysStr, category: "Inversiones", status: "projected" }
    ];

    const demoShopping = [
      { id: 1, text: "Alquiler de Apartamento", value: 3500, currency: "local", dueDate: todayStr, category: "Vivienda", paymentMethod: "Transferencia", status: "confirmed" },
      { id: 2, text: "Suscripción Mensual Netflix", value: 12, currency: "second", dueDate: todayStr, category: "Entretenimiento", paymentMethod: "Tarjeta Visa", status: "confirmed" },
      { id: 3, text: "Supermercado La Torre", value: 950.50, currency: "local", dueDate: todayStr, category: "Alimentación", paymentMethod: "Tarjeta Visa", status: "confirmed" },
      { id: 4, text: "Combustible Gasolinera Shell", value: 320, currency: "local", dueDate: tomorrowStr, category: "Transporte", paymentMethod: "Efectivo", status: "projected" },
      { id: 5, text: "Pago de Energía Eléctrica EEGSA", value: 410.20, currency: "local", dueDate: in3DaysStr, category: "Servicios", paymentMethod: "Banca en Línea", status: "projected" },
      { id: 6, text: "Cena en Restaurante El Portal", value: 280, currency: "local", dueDate: todayStr, category: "Entretenimiento", paymentMethod: "Efectivo", status: "confirmed" },
      { id: 7, text: "Suscripción Spotify Premium", value: 6, currency: "second", dueDate: in3DaysStr, category: "Entretenimiento", paymentMethod: "Tarjeta Visa", status: "projected" }
    ];

    const demoDebts = [
      { id: 1, name: "Tarjeta Visa Oro", balance: 4500, minPayment: 350 },
      { id: 2, name: "Préstamo Educativo", balance: 18500, minPayment: 900 },
      { id: 3, name: "Financiamiento Laptop", balance: 3200, minPayment: 400 }
    ];

    const demoLimits = {
      "Alimentación": 1500,
      "Vivienda": 4000,
      "Transporte": 800,
      "Servicios": 600,
      "Entretenimiento": 500,
      "Deudas": 2500,
      "Otros": 500
    };

    const demoTargets = {
      "Salario": 14000,
      "Freelance": 800,
      "Inversiones": 500,
      "Otros": 200
    };

    const demoKanbanCards = [
      // Col 1 – Por Hacer
      { id: 101, col_id: 1, pos: 10, text: "Renovar licencia de conducir | Llevar examen de la vista e identificación oficial | Vence: 2026-07-20 | Prioridad: medium | Etiquetas: Personal, Trámite" },
      { id: 102, col_id: 1, pos: 20, text: "Subir actualización Mk Organizer | Preparar capturas de pantalla en español para Google Web Store | Vence: 2026-07-12 | Prioridad: high | Etiquetas: Trabajo, Urgente" },
      { id: 103, col_id: 1, pos: 30, text: "Diseñar logo de la tienda | Crear versiones en SVG y PNG de 512x512 | Vence: 2026-07-18 | Prioridad: low | Etiquetas: Diseño" },
      // Col 2 – En Progreso
      { id: 104, col_id: 2, pos: 10, text: "Rediseño de interfaz de deudas | Implementar simulador de bola de nieve con gráfica de proyección | Vence: 2026-07-08 | Prioridad: high | Etiquetas: Desarrollo, Diseño" },
      { id: 105, col_id: 2, pos: 20, text: "Documentación para Google Play | Escribir descripción corta y larga en español e inglés | Vence: 2026-07-10 | Prioridad: medium | Etiquetas: Trabajo" },
      // Col 3 – Bloqueado
      { id: 106, col_id: 3, pos: 10, text: "Integración con Google Calendar | Requiere revisión de permisos OAuth adicionales | Vence: 2026-08-01 | Prioridad: medium | Etiquetas: Desarrollo, Pendiente" },
      // Col 4 – Hecho
      { id: 107, col_id: 4, pos: 10, text: "Soporte multi-moneda en presupuesto | Configuración de moneda local, secundaria y tasas de conversión | Prioridad: high | Etiquetas: Completado, Desarrollo" },
      { id: 108, col_id: 4, pos: 20, text: "Sincronización con Google Drive | Auto-sync con debounce de 3 segundos en cada cambio | Prioridad: high | Etiquetas: Completado" },
      { id: 109, col_id: 4, pos: 30, text: "Planificador de Deudas | Método Bola de Nieve con proyección mensual interactiva | Prioridad: medium | Etiquetas: Completado, Finanzas" }
    ];

    const demoNotes = [
      {
        id: 1,
        title: "💡 Ideas para Mk Organizer v1.0",
        content: "# Ideas y Mejoras Futuras\n\n1. Sincronización en la nube con Google Drive (¡Listo!).\n2. Planificador de Deudas por método Bola de Nieve (¡Listo!).\n3. Tableros Kanban de tareas para organizar flujos visuales (¡Listo!).\n4. Sistema de monedas personalizables para el presupuesto (¡Listo!).\n\n_Creado con amor por el equipo de Mk Organizer._",
        ts: new Date().toISOString()
      },
      {
        id: 2,
        title: "🛒 Lista de Compras Especiales",
        content: "- Café artesanal tostado (Grano)\n- Chocolate negro 85% cacao\n- Nueces y almendras\n- Leche de avena sin azúcar",
        ts: new Date().toISOString()
      }
    ];

    const demoPasswords = [
      { id: 1, site: "Google Account", username: "perry.dev@gmail.com", password: "mypassword123", type: "web", url: "https://accounts.google.com", notes: "Cuenta de desarrollo principal.", ts: new Date().toISOString() },
      { id: 2, site: "Banca Virtual", username: "p.gonzalez88", password: "securebankpass99", type: "web", url: "https://banca.gandt.com.gt", notes: "Usar token digital para transferencias superiores a Q5,000.", ts: new Date().toISOString() },
      { id: 3, site: "Netflix Familiar", username: "perry.casa@gmail.com", password: "netflixpremium4k", type: "web", url: "https://netflix.com", notes: "Plan Premium 4K de la casa.", ts: new Date().toISOString() }
    ];

    const demoSavings = [
      { id: 1, name: "Fondo de Emergencia", currency: "local", goal: 15000, accumulated: 4500, monthlyAmount: 800, targetDate: "2026-12-31", notes: "6 meses de gastos básicos cubiertos" },
      { id: 2, name: "Vacaciones en Cancún", currency: "second", goal: 1500, accumulated: 320, monthlyAmount: 100, targetDate: "2027-01-15", notes: "Vuelos + hotel 7 noches para dos personas" },
      { id: 3, name: "MacBook Pro M3", currency: "second", goal: 2500, accumulated: 800, monthlyAmount: 150, targetDate: "2026-10-01", notes: "Reemplazo de equipo de trabajo" },
      { id: 4, name: "Enganche Vehículo", currency: "local", goal: 50000, accumulated: 8000, monthlyAmount: 1500, targetDate: "2027-06-01", notes: "30% del valor del vehículo" }
    ];

    await Promise.all([
      storage.set('agenda', demoAgenda),
      storage.set('income', demoIncome),
      storage.set('shopping', demoShopping),
      storage.set('deudas_list', demoDebts),
      storage.set('deudas_presupuesto', 2000),
      storage.set('budget_limits', demoLimits),
      storage.set('budget_income_targets', demoTargets),
      storage.set('kanban_cards', demoKanbanCards),
      storage.set('kanban', []),
      storage.set('notes', demoNotes),
      storage.set('passwords', demoPasswords),
      storage.set('savings_goals', demoSavings),
      storage.set('budget_currency_symbol', 'Q'),
      storage.set('budget_currency_code', 'GTQ'),
      storage.set('budget_second_currency_enabled', true),
      storage.set('budget_second_currency_symbol', 'US$'),
      storage.set('budget_second_currency_code', 'USD'),
      storage.set('budget_exchange_rate', 7.8),
      storage.set('app_config', {
        agendaEnabled: true,
        budgetEnabled: true,
        debtsEnabled: true,
        kanbanEnabled: true,
        notesEnabled: true,
        passwordsEnabled: true,
        savingsEnabled: true
      })
    ]);

    console.log("Datos de demostración inyectados exitosamente.");
    } finally {
      isInjectingDemo = false;
    }
  }

  window.injectDemoData = injectDemoData;
  // Escritorio: primera instalación usa datos locales vacíos, sin demo y sin exigir Google Drive.

  // Helper para obtener el siguiente ID de una lista
  function getNextId(items) {
    if (!items || items.length === 0) return 1;
    return Math.max(...items.map(item => Number(item.id) || 0)) + 1;
  }

  let configQueue = Promise.resolve();

  // --- MOCK DE PY (AgendaBridge) ---
  const mockPy = {
    // Control de ventanas (no operativo en extensión de Chrome)
    window_minimize: async function() {
      if (window.desktop && window.desktop.minimize) return window.desktop.minimize();
    },
    window_maximize: async function() {
      if (window.desktop && window.desktop.maximize) return window.desktop.maximize();
    },
    window_close: async function() {
      if (window.desktop && window.desktop.close) return window.desktop.close();
      window.close();
    },
    close_app: async function() {
      if (window.desktop && window.desktop.close) return window.desktop.close();
      window.close();
    },

    // Agenda (Tareas y Recordatorios)
    get_agenda: async function() {
      return await storage.get('agenda', []);
    },
    add_agenda: async function(text, date, tag = '') {
      const list = await storage.get('agenda', []);
      const newItem = {
        id: getNextId(list),
        text: text,
        dueDate: date,
        done: false,
        notes: '',
        tag: (tag || '').trim()
      };
      list.unshift(newItem); // Insertar al inicio (ORDER BY id DESC)
      await storage.set('agenda', list);
    },
    update_agenda: async function(aid, text, date, tag = null) {
      const list = await storage.get('agenda', []);
      const idx = list.findIndex(item => item.id == aid);
      if (idx !== -1) {
        list[idx].text = text;
        list[idx].dueDate = date;
        if (tag !== null) {
          list[idx].tag = (tag || '').trim();
        }
        await storage.set('agenda', list);
      }
    },
    delete_agenda: async function(aid) {
      let list = await storage.get('agenda', []);
      list = list.filter(item => item.id != aid);
      await storage.set('agenda', list);
    },
    delete_agenda_batch: async function(aids) {
      if (!Array.isArray(aids) || aids.length === 0) return;
      let list = await storage.get('agenda', []);
      const aidStrings = aids.map(String);
      list = list.filter(item => !aidStrings.includes(String(item.id)));
      await storage.set('agenda', list);
    },
    toggle_agenda: async function(aid, done) {
      const list = await storage.get('agenda', []);
      const idx = list.findIndex(item => item.id == aid);
      if (idx !== -1) {
        list[idx].done = !!done;
        await storage.set('agenda', list);
      }
    },
    set_item_notes: async function(table, itemId, notes) {
      const list = await storage.get(table, []);
      const idx = list.findIndex(item => item.id == itemId);
      if (idx !== -1) {
        list[idx].notes = notes;
        await storage.set(table, list);
      }
    },

    // Compras (Gastos)
    get_shopping: async function() {
      return await storage.get('shopping', []);
    },
    add_shopping: async function(text, val, cur, date, pm, category, status) {
      const list = await storage.get('shopping', []);
      const newItem = {
        id: getNextId(list),
        text: text,
        value: Number(val) || 0,
        currency: cur,
        dueDate: date,
        paymentMethod: pm,
        category: category || 'Otros',
        status: status || 'projected',
        done: false,
        notes: ''
      };
      list.unshift(newItem);
      await storage.set('shopping', list);
    },
    update_shopping: async function(sid, text, val, cur, date, pm, category, status) {
      const list = await storage.get('shopping', []);
      const idx = list.findIndex(item => item.id === sid);
      if (idx !== -1) {
        list[idx].text = text;
        list[idx].value = Number(val) || 0;
        list[idx].currency = cur;
        list[idx].dueDate = date;
        list[idx].paymentMethod = pm;
        list[idx].category = category || 'Otros';
        if (status) list[idx].status = status;
        await storage.set('shopping', list);
      }
    },
    delete_shopping: async function(sid) {
      let list = await storage.get('shopping', []);
      list = list.filter(item => item.id !== sid);
      await storage.set('shopping', list);
    },
    toggle_shopping: async function(sid, done) {
      const list = await storage.get('shopping', []);
      const idx = list.findIndex(item => item.id === sid);
      if (idx !== -1) {
        list[idx].done = !!done;
        await storage.set('shopping', list);
      }
    },

    // Ingresos
    get_income: async function() {
      return await storage.get('income', []);
    },
    add_income: async function(text, val, cur, date, category, status) {
      const list = await storage.get('income', []);
      const newItem = {
        id: getNextId(list),
        text: text,
        value: Number(val) || 0,
        currency: cur,
        dueDate: date,
        category: category || 'Otros',
        status: status || 'projected',
        received: false,
        notes: ''
      };
      list.unshift(newItem);
      await storage.set('income', list);
    },
    update_income: async function(iid, text, val, cur, date, category, status) {
      const list = await storage.get('income', []);
      const idx = list.findIndex(item => item.id === iid);
      if (idx !== -1) {
        list[idx].text = text;
        list[idx].value = Number(val) || 0;
        list[idx].currency = cur;
        list[idx].dueDate = date;
        list[idx].category = category || 'Otros';
        if (status) list[idx].status = status;
        await storage.set('income', list);
      }
    },
    delete_income: async function(iid) {
      let list = await storage.get('income', []);
      list = list.filter(item => item.id !== iid);
      await storage.set('income', list);
    },
    toggle_income: async function(iid, received) {
      const list = await storage.get('income', []);
      const idx = list.findIndex(item => item.id === iid);
      if (idx !== -1) {
        list[idx].received = !!received;
        await storage.set('income', list);
      }
    },

    // Kanban
    get_kanban_cols: async function() {
      return [
        { id: 1, title: 'Por Hacer', pos: 0 },
        { id: 2, title: 'En Progreso', pos: 1 },
        { id: 3, title: 'Bloqueado', pos: 2 },
        { id: 4, title: 'Hecho', pos: 3 }
      ];
    },
    get_kanban_cards: async function(colId) {
      const allCards = await storage.get('kanban_cards', []);
      // Si no se pasa colId, retornar todas las tarjetas
      if (colId === undefined || colId === null || colId === '') {
        return allCards.sort((a, b) => a.pos - b.pos);
      }
      return allCards
        .filter(card => card.col_id === Number(colId))
        .sort((a, b) => a.pos - b.pos);
    },
    add_kanban_col: async function(title, pos) {}, // Columnas estáticas
    add_kanban_card: async function(colId, text, pos) {
      const allCards = await storage.get('kanban_cards', []);
      const newCard = {
        id: getNextId(allCards),
        col_id: Number(colId),
        text: text,
        pos: Number(pos) || Date.now()
      };
      allCards.push(newCard);
      await storage.set('kanban_cards', allCards);
    },
    move_kanban_card: async function(cardId, newColId, newPos) {
      const allCards = await storage.get('kanban_cards', []);
      const idx = allCards.findIndex(card => card.id === cardId);
      if (idx !== -1) {
        allCards[idx].col_id = Number(newColId);
        allCards[idx].pos = Number(newPos);
        await storage.set('kanban_cards', allCards);
      }
    },
    update_kanban_card: async function(cardId, colId, text) {
      const allCards = await storage.get('kanban_cards', []);
      const idx = allCards.findIndex(card => card.id === cardId);
      if (idx !== -1) {
        allCards[idx].col_id = Number(colId);
        allCards[idx].text = text;
        await storage.set('kanban_cards', allCards);
      }
    },
    delete_kanban_card: async function(cid) {
      let allCards = await storage.get('kanban_cards', []);
      allCards = allCards.filter(card => card.id != cid);
      await storage.set('kanban_cards', allCards);
    },
    delete_kanban_card_batch: async function(cids) {
      if (!Array.isArray(cids) || cids.length === 0) return;
      let allCards = await storage.get('kanban_cards', []);
      const cidStrings = cids.map(String);
      allCards = allCards.filter(card => !cidStrings.includes(String(card.id)));
      await storage.set('kanban_cards', allCards);
    },

    // Notas (Notas Adhesivas Flotantes)
    get_notes: async function() {
      const list = await storage.get('notes', []);
      // Retornar ordenados por zIndex para mantener el apilamiento correcto
      return list.sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
    },
    add_note: async function(color, x, y, z_index) {
      const list = await storage.get('notes', []);
      const nid = getNextId(list);
      const newNote = {
        id: nid,
        content: '',
        color: color || 'yellow',
        x: x !== undefined ? x : 20,
        y: y !== undefined ? y : 20,
        width: 220,
        height: 170,
        zIndex: z_index || 1
      };
      list.push(newNote);
      await storage.set('notes', list);
      return nid;
    },
    update_note_content: async function(nid, content) {
      const list = await storage.get('notes', []);
      const idx = list.findIndex(n => n.id === nid);
      if (idx !== -1) {
        list[idx].content = content || '';
        await storage.set('notes', list);
      }
    },
    update_note_color: async function(nid, color) {
      const list = await storage.get('notes', []);
      const idx = list.findIndex(n => n.id === nid);
      if (idx !== -1) {
        list[idx].color = color || 'yellow';
        await storage.set('notes', list);
      }
    },
    update_note_pos: async function(nid, x, y) {
      const list = await storage.get('notes', []);
      const idx = list.findIndex(n => n.id === nid);
      if (idx !== -1) {
        list[idx].x = Number(x) || 20;
        list[idx].y = Number(y) || 20;
        await storage.set('notes', list);
      }
    },
    update_note_size: async function(nid, width, height) {
      const list = await storage.get('notes', []);
      const idx = list.findIndex(n => n.id === nid);
      if (idx !== -1) {
        list[idx].width = Math.max(220, Number(width) || 220);
        list[idx].height = Math.max(170, Number(height) || 170);
        await storage.set('notes', list);
      }
    },
    update_note_zindex: async function(nid, z_index) {
      const list = await storage.get('notes', []);
      const idx = list.findIndex(n => n.id === nid);
      if (idx !== -1) {
        list[idx].zIndex = z_index || 1;
        await storage.set('notes', list);
      }
    },
    delete_note: async function(nid) {
      let list = await storage.get('notes', []);
      list = list.filter(n => n.id !== nid);
      await storage.set('notes', list);
    },

    // ── Deudas ──────────────────────────────────────────────────────────
    get_debts: async function() {
      return storage.get('deudas_list', []);
    },
    save_debts: async function(list) {
      await storage.set('deudas_list', list);
    },
    get_debts_budget: async function() {
      return storage.get('deudas_presupuesto', 0);
    },
    save_debts_budget: async function(amount) {
      await storage.set('deudas_presupuesto', Number(amount) || 0);
    },

    // ── Ahorros ─────────────────────────────────────────────────────────
    get_savings: async function() {
      return storage.get('savings_goals', []);
    },
    save_savings: async function(list) {
      await storage.set('savings_goals', list);
    },

    // Configuración General de la Aplicación (Claves y Valores)
    get_config: async function(key) {
      const config = await storage.get('app_config', {});
      const defaults = {
        exchangeRate: '7.80',
        paymentMethods: '["Efectivo","Tarjeta","Transferencia"]',
        videoEnabled: '1',
        imagesEnabled: '1',
        shoppingEnabled: '1',
        incomeEnabled: '1',
        kanbanEnabled: '1',
        notesEnabled: '1',
        arcadeEnabled: '1',
        agendaEnabled: '1',
        passwordsEnabled: '1',
        homeUrl: '',
        mediaPath: '',
        videoStartMuted: '0',
        videoSortBy: 'name-asc',
        imageMediaPath: '',
        imageSortBy: 'name-asc',
        screenshotsPath: ''
      };
      return config[key] !== undefined ? config[key] : (defaults[key] || '');
    },
    set_config: function(key, val) {
      configQueue = configQueue.then(async () => {
        try {
          const config = await storage.get('app_config', {});
          config[key] = String(val);
          await storage.set('app_config', config);
        } catch (err) {
          console.error("Error setting config:", err);
        }
      });
      return configQueue;
    },

    // Stubs para el reproductor de videos e imágenes
    get_media_path: async function() {
      return '';
    },
    get_image_media_path: async function() {
      return '';
    },
    get_image_settings: async function() {
      return '{}';
    },
    get_video_folders: async function() {
      return [];
    },
    get_image_folders: async function() {
      return [];
    },
    browse_folders: async function(startPath) {
      return '';
    },
    browse_local_path: async function(startPath) {
      return '';
    }
  };

  // --- MOCK DE PW (PasswordBridge) ---
  const mockPw = {
    get_auto_save_policy: async function() {
      const config = await storage.get('app_config', {});
      return config['passwordAutoSavePolicy'] || 'ask';
    },
    set_auto_save_policy: async function(policy) {
      const config = await storage.get('app_config', {});
      config['passwordAutoSavePolicy'] = policy;
      await storage.set('app_config', config);
    },
    get_passwords: async function() {
      const list = await storage.get('passwords', []);
      return list.sort((a, b) => (a.site || '').localeCompare(b.site || ''));
    },
    save_password: async function(site, user, pwd) {
      const list = await storage.get('passwords', []);
      const idx = list.findIndex(p => p.site === site && p.username === user);
      if (idx !== -1) {
        list[idx].password = pwd;
        list[idx].ts = new Date().toISOString();
      } else {
        list.push({
          id: getNextId(list),
          site: site,
          username: user,
          password: pwd,
          type: 'web',
          url: '',
          notes: '',
          ts: new Date().toISOString()
        });
      }
      await storage.set('passwords', list);
    },
    upsert_password: async function(pid, site, user, pwd, pwd_type, url, notes) {
      const list = await storage.get('passwords', []);
      const normType = pwd_type || 'web';
      
      let targetId = pid;
      const idx = list.findIndex(p => p.id === pid);
      
      // Buscar colisión si editamos y coincide con otro existente
      const colIdx = list.findIndex(p => p.site === site && p.username === user && p.id !== pid);
      
      if (colIdx !== -1) {
        // Combinar en el registro colisionado y eliminar el actual si existía por separado
        list[colIdx].password = pwd;
        list[colIdx].type = normType;
        list[colIdx].url = url || '';
        list[colIdx].notes = notes || '';
        list[colIdx].ts = new Date().toISOString();
        
        if (idx !== -1) {
          list.splice(idx, 1);
        }
        targetId = list[colIdx].id;
      } else if (idx !== -1) {
        // Actualizar registro existente
        list[idx].site = site;
        list[idx].username = user;
        list[idx].password = pwd;
        list[idx].type = normType;
        list[idx].url = url || '';
        list[idx].notes = notes || '';
        list[idx].ts = new Date().toISOString();
      } else {
        // Crear registro nuevo
        const newId = getNextId(list);
        list.push({
          id: newId,
          site: site,
          username: user,
          password: pwd,
          type: normType,
          url: url || '',
          notes: notes || '',
          ts: new Date().toISOString()
        });
        targetId = newId;
      }
      
      await storage.set('passwords', list);
      return targetId;
    },
    delete_password: async function(pid) {
      let list = await storage.get('passwords', []);
      list = list.filter(p => p.id !== pid);
      await storage.set('passwords', list);
    }
  };

  // Función utilitaria global para parsear JSON de forma segura
  window.parseJSON = function(value, fallback) {
    if (typeof value === 'object' && value !== null) return value;
    try {
      return value ? JSON.parse(value) : fallback;
    } catch (_err) {
      return fallback;
    }
  };

  // Función utilitaria global para escapar caracteres HTML
  window.escapeHtml = function(str) {
    return String(str === undefined || str === null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  // Función utilitaria global para asignar texto a elementos del DOM
  window.setTxt = function(id, value) {
    const el = document.getElementById(id);
    if (el) el.innerText = value;
  };

  // Función utilitaria global para serializar objetos de forma segura en atributos HTML
  window.jsonStr = function(obj) {
    return JSON.stringify(obj).replace(/'/g, '&#39;');
  };

  // Mock de QWebChannel para que agenda.js se cargue de inmediato
  window.QWebChannel = function(transport, callback) {
    const channel = {
      objects: {
        py: mockPy,
        pw: mockPw
      }
    };
    // Ejecutar callback inmediatamente simulando la conexión exitosa
    setTimeout(() => {
      callback(channel);
    }, 0);
  };
})();
