// ui_helpers.js - Funciones globales de UI y controladores de clics delegados para cumplir con CSP en Manifest V3

window.showToast = (msg, type = 'success') => {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    
    // Configurar diseño base del toast
    toast.style.padding = '10px 20px';
    toast.style.background = type === 'success' ? 'rgba(46, 204, 113, 0.95)' : 'rgba(108, 92, 231, 0.95)';
    toast.style.color = '#fff';
    toast.style.borderRadius = '8px';
    toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.35)';
    toast.style.fontSize = '0.88rem';
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(20px)';
    toast.style.transition = 'all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)';
    toast.style.display = 'flex';
    toast.style.alignItems = 'center';
    toast.style.justifyContent = 'space-between';
    toast.style.gap = '16px';
    
    const textSpan = document.createElement('span');
    textSpan.innerText = msg;
    toast.appendChild(textSpan);
    
    const isSticky = (type === 'success');
    
    if (isSticky) {
        const closeBtn = document.createElement('button');
        closeBtn.innerText = '✕';
        closeBtn.style.background = 'none';
        closeBtn.style.border = 'none';
        closeBtn.style.color = '#fff';
        closeBtn.style.cursor = 'pointer';
        closeBtn.style.fontSize = '0.85rem';
        closeBtn.style.padding = '2px';
        closeBtn.style.opacity = '0.7';
        closeBtn.style.transition = 'opacity 0.2s';
        closeBtn.style.fontWeight = 'bold';
        
        closeBtn.addEventListener('mouseenter', () => { closeBtn.style.opacity = '1'; });
        closeBtn.addEventListener('mouseleave', () => { closeBtn.style.opacity = '0.7'; });
        closeBtn.onclick = (e) => {
            e.stopPropagation();
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(20px)';
            setTimeout(() => toast.remove(), 300);
        };
        toast.appendChild(closeBtn);
    }
    
    container.appendChild(toast);
    
    setTimeout(() => { 
        toast.style.opacity = '1'; 
        toast.style.transform = 'translateY(0)'; 
    }, 10);
    
    const duration = isSticky ? 6000 : 3000;
    setTimeout(() => {
        if (toast.parentNode) {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(20px)';
            setTimeout(() => toast.remove(), 300);
        }
    }, duration);
};

window.showConfirm = (msg, callback) => {
    const modal = document.getElementById('global-confirm-modal');
    if (!modal) return;
    
    document.getElementById('global-confirm-msg').innerText = msg;
    modal.classList.add('active');
    
    const okBtn = document.getElementById('global-confirm-ok');
    const cancelBtn = document.getElementById('global-confirm-cancel');
    
    const cleanup = () => {
        modal.classList.remove('active');
        okBtn.replaceWith(okBtn.cloneNode(true));
        cancelBtn.replaceWith(cancelBtn.cloneNode(true));
    };
    
    okBtn.addEventListener('click', () => { cleanup(); callback(true); });
    cancelBtn.addEventListener('click', () => { cleanup(); callback(false); });
};

// Delegación de eventos para evitar event handlers inline (violaciones de CSP en MV3)
document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    
    const action = el.dataset.action;
    
    try {
        switch (action) {
            case 'toggleReminder': {
                const id = parseInt(el.dataset.id);
                const done = el.dataset.done === 'true';
                if (window.toggleReminder) await window.toggleReminder(id, done);
                break;
            }
            case 'openObsModal': {
                const tab = el.dataset.tab;
                const id = parseInt(el.dataset.id);
                const notes = el.dataset.notes || '';
                if (window.openObsModal) window.openObsModal(tab, id, notes);
                break;
            }
            case 'openEditModal': {
                const type = el.dataset.type;
                const json = JSON.parse(el.dataset.json || '{}');
                if (window.openEditModal) window.openEditModal(type, json);
                break;
            }
            case 'deleteReminder': {
                const id = parseInt(el.dataset.id);
                if (window.deleteReminder) await window.deleteReminder(id);
                break;
            }
            case 'toggleShopping': {
                const id = parseInt(el.dataset.id);
                const done = el.dataset.done === 'true';
                if (window.toggleShopping) await window.toggleShopping(id, done);
                break;
            }
            case 'deleteShopping': {
                const id = parseInt(el.dataset.id);
                if (window.deleteShopping) await window.deleteShopping(id);
                break;
            }
            case 'toggleIncome': {
                const id = parseInt(el.dataset.id);
                const done = el.dataset.done === 'true';
                if (window.toggleIncome) await window.toggleIncome(id, done);
                break;
            }
            case 'deleteIncome': {
                const id = parseInt(el.dataset.id);
                if (window.deleteIncome) await window.deleteIncome(id);
                break;
            }
            case 'removePmDraft': {
                const idx = parseInt(el.dataset.idx);
                if (window.removePmDraft) window.removePmDraft(idx);
                break;
            }
            case 'toggleKbLabel': {
                const label = el.dataset.label;
                if (window.toggleKbLabel) window.toggleKbLabel(label);
                break;
            }
            case 'editKanbanCard': {
                const id = parseInt(el.dataset.id);
                if (window.editKanbanCard) window.editKanbanCard(id);
                break;
            }
            case 'deleteKanbanCard': {
                const id = parseInt(el.dataset.id);
                if (window.deleteKanbanCard) window.deleteKanbanCard(id);
                break;
            }
            case 'toggleKbLabelFilter': {
                const label = el.dataset.label;
                if (window.toggleKbLabelFilter) await window.toggleKbLabelFilter(label);
                break;
            }
            case 'pwCopy': {
                const text = decodeURIComponent(el.dataset.text || '');
                if (window.pwCopy) window.pwCopy(text, el);
                break;
            }
            case 'togglePwVisibility': {
                const id = parseInt(el.dataset.id);
                if (window.togglePwVisibility) window.togglePwVisibility(id);
                break;
            }
            case 'openPasswordModal': {
                const json = JSON.parse(el.dataset.json || '{}');
                if (window.openPasswordModal) window.openPasswordModal(json);
                break;
            }
            case 'deletePassword': {
                const id = parseInt(el.dataset.id);
                if (window.deletePassword) await window.deletePassword(id);
                break;
            }
        }
    } catch (err) {
        console.error(`Error al ejecutar acción delegada ${action}:`, err);
    }
});

// Vincular dinámicamente los botones de formato Kanban fijos en el HTML al cargar la página
document.addEventListener('DOMContentLoaded', () => {
    const boldBtn = document.getElementById('kb-tool-bold');
    const italicBtn = document.getElementById('kb-tool-italic');
    const codeBtn = document.getElementById('kb-tool-code');
    const linkBtn = document.getElementById('kb-link-tool-btn');
    const listBtn = document.getElementById('kb-tool-list');

    if (boldBtn) boldBtn.addEventListener('click', () => { if (window.kbApplyFormat) window.kbApplyFormat('bold'); });
    if (italicBtn) italicBtn.addEventListener('click', () => { if (window.kbApplyFormat) window.kbApplyFormat('italic'); });
    if (codeBtn) codeBtn.addEventListener('click', () => { if (window.kbApplyFormat) window.kbApplyFormat('code'); });
    if (linkBtn) linkBtn.addEventListener('click', () => { if (window.kbApplyFormat) window.kbApplyFormat('link'); });
    if (listBtn) listBtn.addEventListener('click', () => { if (window.kbApplyFormat) window.kbApplyFormat('list'); });
});
