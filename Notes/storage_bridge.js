// ============================================================
// storage_bridge.js - Polyfill para simular el puente de Python (py y pw)
// a través del almacenamiento local del navegador (chrome.storage.local).
// ============================================================

(function() {
  // Inicialización de la estructura mock de QWebChannel
  window.qt = {
    webChannelTransport: {}
  };

  // Helper para interactuar con chrome.storage.local de forma asíncrona
  const storage = {
    get: function(key, defaultValue) {
      return new Promise((resolve) => {
        try {
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
      return new Promise((resolve) => {
        try {
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

  // Helper para obtener el siguiente ID de una lista
  function getNextId(items) {
    if (!items || items.length === 0) return 1;
    return Math.max(...items.map(item => Number(item.id) || 0)) + 1;
  }

  // --- MOCK DE PY (AgendaBridge) ---
  const mockPy = {
    // Control de ventanas (no operativo en extensión de Chrome)
    window_minimize: async function() {},
    window_maximize: async function() {},
    window_close: async function() {
      window.close();
    },
    close_app: async function() {
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
      const idx = list.findIndex(item => item.id === aid);
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
      list = list.filter(item => item.id !== aid);
      await storage.set('agenda', list);
    },
    toggle_agenda: async function(aid, done) {
      const list = await storage.get('agenda', []);
      const idx = list.findIndex(item => item.id === aid);
      if (idx !== -1) {
        list[idx].done = !!done;
        await storage.set('agenda', list);
      }
    },
    set_item_notes: async function(table, itemId, notes) {
      const list = await storage.get(table, []);
      const idx = list.findIndex(item => item.id === itemId);
      if (idx !== -1) {
        list[idx].notes = notes;
        await storage.set(table, list);
      }
    },

    // Compras (Gastos)
    get_shopping: async function() {
      return await storage.get('shopping', []);
    },
    add_shopping: async function(text, val, cur, date, pm) {
      const list = await storage.get('shopping', []);
      const newItem = {
        id: getNextId(list),
        text: text,
        value: Number(val) || 0,
        currency: cur,
        dueDate: date,
        paymentMethod: pm,
        done: false,
        notes: ''
      };
      list.unshift(newItem);
      await storage.set('shopping', list);
    },
    update_shopping: async function(sid, text, val, cur, date, pm) {
      const list = await storage.get('shopping', []);
      const idx = list.findIndex(item => item.id === sid);
      if (idx !== -1) {
        list[idx].text = text;
        list[idx].value = Number(val) || 0;
        list[idx].currency = cur;
        list[idx].dueDate = date;
        list[idx].paymentMethod = pm;
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
    add_income: async function(text, val, cur, date) {
      const list = await storage.get('income', []);
      const newItem = {
        id: getNextId(list),
        text: text,
        value: Number(val) || 0,
        currency: cur,
        dueDate: date,
        received: false,
        notes: ''
      };
      list.unshift(newItem);
      await storage.set('income', list);
    },
    update_income: async function(iid, text, val, cur, date) {
      const list = await storage.get('income', []);
      const idx = list.findIndex(item => item.id === iid);
      if (idx !== -1) {
        list[idx].text = text;
        list[idx].value = Number(val) || 0;
        list[idx].currency = cur;
        list[idx].dueDate = date;
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
      allCards = allCards.filter(card => card.id !== cid);
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
    set_config: async function(key, val) {
      const config = await storage.get('app_config', {});
      config[key] = String(val);
      await storage.set('app_config', config);
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
