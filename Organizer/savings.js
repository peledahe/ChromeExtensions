// savings.js – Módulo de Objetivos de Ahorro con Multi-moneda

const savingsState = {
    goals: []
};

// ─── Helpers de moneda ────────────────────────────────────────────────────────

function svgFmtNum(n) {
    return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function svgGetSymbol(currency) {
    if (currency === 'second') return window.currencyState?.secondSymbol || 'US$';
    return window.currencyState?.symbol || 'Q';
}

function svgGetRate() {
    return Number(window.currencyState?.exchangeRate) || 7.8;
}

function svgToLocal(amount, currency) {
    if (currency === 'second') return amount * svgGetRate();
    return amount;
}

function svgConversionLabel(amount, currency) {
    const rate = svgGetRate();
    const secondEnabled = window.currencyState?.secondEnabled;
    if (currency === 'second') {
        const localSym = window.currencyState?.symbol || 'Q';
        return `(${localSym} ${svgFmtNum(amount * rate)})`;
    } else {
        if (!secondEnabled) return '';
        const secSym = window.currencyState?.secondSymbol || 'US$';
        return `(${secSym} ${svgFmtNum(amount / rate)})`;
    }
}

// ─── Carga y guardado ────────────────────────────────────────────────────────

async function fetchSavings() {
    if (!py) return;
    try {
        const goals = await py.get_savings();
        savingsState.goals = Array.isArray(goals) ? goals : [];
        renderSavingsList();
        renderSavingsSummary();
    } catch (err) {
        console.error('fetchSavings error:', err);
    }
}

async function saveSavingsState() {
    if (!py) return;
    await py.save_savings(savingsState.goals);
}

// ─── Render – Lista de objetivos ─────────────────────────────────�    container.innerHTML = savingsState.goals.map(g => {
        const sym = svgGetSymbol(g.currency);
        const pct = Math.min(100, Math.round((g.accumulated / g.goal) * 100));
        const remaining = Math.max(0, g.goal - g.accumulated);
        const monthsLeft = g.monthlyAmount > 0 ? Math.ceil(remaining / g.monthlyAmount) : '—';
        const conv = svgConversionLabel(g.accumulated, g.currency);
        const goalConv = svgConversionLabel(g.goal, g.currency);
        const barColor = pct >= 100 ? '#2ed573' : pct >= 50 ? '#fdcb6e' : '#a29bfe';

        let dateLabel = '';
        if (g.targetDate) {
            const d = new Date(g.targetDate + 'T00:00:00');
            dateLabel = `<span style="font-size:0.75rem; color:var(--ag-text-muted);" title="Fecha meta">📅 ${d.toLocaleDateString('es-GT', { day:'2-digit', month:'2-digit', year:'2-digit' })}</span>`;
        }

        return `
        <div class="savings-goal-card" data-id="${g.id}" style="background:var(--ag-card-bg); border:1px solid var(--ag-border); border-radius:8px; padding:10px 14px; position:relative; overflow:hidden; display:flex; flex-direction:column; gap:6px;">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                <div style="flex:1; min-width:0; display:flex; flex-direction:column; gap:2px;">
                    <div style="display:flex; align-items:center; gap:6px; flex-wrap:nowrap;">
                        <span class="savings-goal-name" style="font-weight:600; font-size:0.86rem; color:var(--ag-text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(g.name)}</span>
                        <span style="font-size:0.82rem; font-weight:800; color:${barColor}; flex-shrink:0;">${pct}%</span>
                    </div>
                    <div class="savings-goal-meta" style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; line-height:1;">
                        <span class="savings-currency-badge ${g.currency}" style="font-size:0.65rem; background:rgba(255,255,255,0.06); padding:1px 4px; border-radius:3px; color:var(--ag-text-muted);">${sym}</span>
                        ${dateLabel}
                        ${g.notes ? `<span style="font-size:0.72rem; color:var(--ag-text-muted); font-style:italic; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:140px;" title="${escapeHtml(g.notes)}">${escapeHtml(g.notes)}</span>` : ''}
                    </div>
                </div>

                <div style="text-align:right; flex-shrink:0; display:flex; flex-direction:column; gap:2px; line-height:1.2;">
                    <div style="font-size:0.85rem; font-weight:700; color:var(--ag-text);">${sym} ${svgFmtNum(g.accumulated)} <span style="font-weight:400; font-size:0.7rem; color:var(--ag-text-muted);">${conv}</span></div>
                    <div style="font-size:0.75rem; color:var(--ag-text-muted);">Meta: ${sym} ${svgFmtNum(g.goal)}</div>
                </div>

                <div style="display:flex; gap:3px; align-items:center; flex-shrink:0; border-left:1px solid rgba(255,255,255,0.06); padding-left:8px; margin-left:2px;">
                    <button class="ag-btn saving-pay-btn" data-id="${g.id}" style="padding:4px 6px; font-size:0.72rem; background:rgba(46,213,115,0.1); border:1px solid rgba(46,213,115,0.3); color:#2ed573; font-weight:600; cursor:pointer; border-radius:4px;" title="Registrar aporte mensual">+Abono</button>
                    <button class="ag-edit-btn saving-edit-btn" data-id="${g.id}" style="background:none;border:none;cursor:pointer;font-size:0.8rem; padding:2px;">✏️</button>
                    <button class="ag-delete-btn saving-delete-btn" data-id="${g.id}" style="background:none;border:none;cursor:pointer;font-size:0.8rem; padding:2px;">🗑️</button>
                </div>
            </div>

            <!-- Barra de progreso minimalista al pie -->
            <div class="savings-progress-track" style="background:rgba(255,255,255,0.04); height:4px; border-radius:2px; overflow:hidden; width:100%; margin-top:2px;">
                <div class="savings-progress-bar" style="width:${pct}%; background:${barColor}; height:100%; transition:width 0.4s ease;"></div>
            </div>

            <div style="display:flex; justify-content:space-between; font-size:0.7rem; color:var(--ag-text-muted); margin-top:-2px; line-height:1;">
                <span>Mensual: <strong>${sym} ${svgFmtNum(g.monthlyAmount)}</strong></span>
                <span>${pct >= 100 ? '¡Meta lograda! 🎉' : `${monthsLeft} meses rest.`}</span>
            </div>
        </div>`;
    }).join('');iv class="savings-amount-label">Meta</div>
                </div>
            </div>

            <div style="font-size:0.78rem; color:var(--ag-text-muted); margin-top:6px; text-align:right;">
                Aporte mensual: <strong style="color:var(--ag-text);">${sym} ${svgFmtNum(g.monthlyAmount)}</strong>
            </div>
        </div>`;
    }).join('');
}

// ─── Render – Panel de Resumen ────────────────────────────────────────────────

function renderSavingsSummary() {
    const container = document.getElementById('savings-summary-panel');
    if (!container) return;

    if (savingsState.goals.length === 0) {
        container.innerHTML = '<div class="ag-empty">Agrega objetivos para ver el resumen.</div>';
        return;
    }

    const localSym = window.currencyState?.symbol || 'Q';
    const secSym = window.currencyState?.secondSymbol || 'US$';
    const secondEnabled = window.currencyState?.secondEnabled;

    const totalGoalLocal = savingsState.goals.reduce((s, g) => s + svgToLocal(g.goal, g.currency), 0);
    const totalAccLocal = savingsState.goals.reduce((s, g) => s + svgToLocal(g.accumulated, g.currency), 0);
    const totalMonthlyLocal = savingsState.goals.reduce((s, g) => s + svgToLocal(g.monthlyAmount, g.currency), 0);
    const globalPct = totalGoalLocal > 0 ? Math.min(100, Math.round((totalAccLocal / totalGoalLocal) * 100)) : 0;

    const localGoals = savingsState.goals.filter(g => g.currency === 'local');
    const secondGoals = savingsState.goals.filter(g => g.currency === 'second');

    let breakdownHtml = '';
    if (localGoals.length > 0) {
        const accL = localGoals.reduce((s, g) => s + g.accumulated, 0);
        const goalL = localGoals.reduce((s, g) => s + g.goal, 0);
        breakdownHtml += `<div class="savings-summary-row"><span>${localSym} — ${localGoals.length} objetivo${localGoals.length > 1 ? 's' : ''}</span><span>${localSym} ${svgFmtNum(accL)} / ${svgFmtNum(goalL)}</span></div>`;
    }
    if (secondEnabled && secondGoals.length > 0) {
        const accS = secondGoals.reduce((s, g) => s + g.accumulated, 0);
        const goalS = secondGoals.reduce((s, g) => s + g.goal, 0);
        breakdownHtml += `<div class="savings-summary-row"><span>${secSym} — ${secondGoals.length} objetivo${secondGoals.length > 1 ? 's' : ''}</span><span>${secSym} ${svgFmtNum(accS)} / ${svgFmtNum(goalS)}</span></div>`;
    }

    container.innerHTML = `
    <div class="savings-summary-card">
        <div style="font-size:0.8rem; color:var(--ag-text-muted); font-weight:600; margin-bottom:10px; text-transform:uppercase; letter-spacing:0.05em;">Resumen Global</div>

        <div style="margin-bottom:14px;">
            <div style="display:flex; justify-content:space-between; font-size:0.82rem; margin-bottom:4px;">
                <span style="color:var(--ag-text-muted);">Progreso general</span>
                <span style="font-weight:700; color:#a29bfe;">${globalPct}%</span>
            </div>
            <div style="background:rgba(255,255,255,0.06); border-radius:99px; height:8px; overflow:hidden;">
                <div style="height:100%; width:${globalPct}%; background:linear-gradient(90deg,#6c5ce7,#a29bfe); border-radius:99px; transition:width 0.6s ease;"></div>
            </div>
        </div>

        <div class="savings-summary-stat">
            <div class="savings-summary-label">Total Ahorrado (${localSym})</div>
            <div class="savings-summary-value" style="color:#2ed573;">${localSym} ${svgFmtNum(totalAccLocal)}</div>
        </div>
        <div class="savings-summary-stat">
            <div class="savings-summary-label">Meta Total (${localSym})</div>
            <div class="savings-summary-value">${localSym} ${svgFmtNum(totalGoalLocal)}</div>
        </div>
        <div class="savings-summary-stat">
            <div class="savings-summary-label">Aporte Mensual Total</div>
            <div class="savings-summary-value" style="color:#fdcb6e;">${localSym} ${svgFmtNum(totalMonthlyLocal)}</div>
        </div>

        <div style="border-top:1px solid rgba(255,255,255,0.06); margin:12px 0; padding-top:12px;">
            <div style="font-size:0.78rem; color:var(--ag-text-muted); font-weight:600; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.04em;">Por moneda</div>
            ${breakdownHtml}
        </div>

        <div style="border-top:1px solid rgba(255,255,255,0.06); margin:12px 0; padding-top:12px;">
            <div style="font-size:0.78rem; color:var(--ag-text-muted); font-weight:600; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.04em;">Por objetivo</div>
            ${savingsState.goals.map(g => {
                const sym = svgGetSymbol(g.currency);
                const pct = Math.min(100, Math.round((g.accumulated / g.goal) * 100));
                return `<div class="savings-summary-row">
                    <span>${escapeHtml(g.name)}</span>
                    <span style="font-weight:700; color:${pct >= 100 ? '#2ed573' : 'var(--ag-text)'};">${pct}%</span>
                </div>`;
            }).join('')}
        </div>
    </div>`;
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function openSavingModal(id = null) {
    const modal = document.getElementById('saving-editor-modal');
    if (!modal) return;

    document.getElementById('saving-modal-title').textContent = id ? 'Editar Objetivo' : 'Nuevo Objetivo de Ahorro';
    document.getElementById('saving-id-hidden').value = id || '';

    if (id) {
        const g = savingsState.goals.find(g => g.id === id);
        if (!g) return;
        document.getElementById('saving-name-input').value = g.name;
        document.getElementById('saving-currency-select').value = g.currency;
        document.getElementById('saving-goal-input').value = g.goal;
        document.getElementById('saving-accumulated-input').value = g.accumulated;
        document.getElementById('saving-monthly-input').value = g.monthlyAmount;
        document.getElementById('saving-date-input').value = g.targetDate || '';
        document.getElementById('saving-notes-input').value = g.notes || '';
    } else {
        document.getElementById('saving-name-input').value = '';
        document.getElementById('saving-currency-select').value = 'local';
        document.getElementById('saving-goal-input').value = '';
        document.getElementById('saving-accumulated-input').value = '';
        document.getElementById('saving-monthly-input').value = '';
        document.getElementById('saving-date-input').value = '';
        document.getElementById('saving-notes-input').value = '';
    }

    modal.classList.add('active');
    setTimeout(() => document.getElementById('saving-name-input')?.focus(), 50);
}

async function saveSavingGoal() {
    const name = (document.getElementById('saving-name-input')?.value || '').trim();
    const currency = document.getElementById('saving-currency-select')?.value || 'local';
    const goal = parseFloat(document.getElementById('saving-goal-input')?.value || '0');
    const accumulated = parseFloat(document.getElementById('saving-accumulated-input')?.value || '0');
    const monthlyAmount = parseFloat(document.getElementById('saving-monthly-input')?.value || '0');
    const targetDate = document.getElementById('saving-date-input')?.value || '';
    const notes = (document.getElementById('saving-notes-input')?.value || '').trim();
    const idVal = document.getElementById('saving-id-hidden')?.value;

    if (!name || isNaN(goal) || goal <= 0) {
        window.showToast('Completa al menos el nombre y la meta del objetivo', 'error');
        return;
    }

    if (idVal) {
        const g = savingsState.goals.find(g => g.id === Number(idVal));
        if (g) Object.assign(g, { name, currency, goal, accumulated, monthlyAmount, targetDate, notes });
    } else {
        const newId = savingsState.goals.length > 0 ? Math.max(...savingsState.goals.map(g => g.id)) + 1 : 1;
        savingsState.goals.push({ id: newId, name, currency, goal, accumulated, monthlyAmount, targetDate, notes });
    }

    await saveSavingsState();
    document.getElementById('saving-editor-modal')?.classList.remove('active');
    window.showToast(idVal ? 'Objetivo actualizado exitosamente' : 'Objetivo de ahorro creado', 'success');
    renderSavingsList();
    renderSavingsSummary();
}

async function deleteSavingGoal(id) {
    window.showConfirm('¿Eliminar este objetivo de ahorro? Esta acción no se puede deshacer.', async (ok) => {
        if (!ok) return;
        savingsState.goals = savingsState.goals.filter(g => g.id !== id);
        await saveSavingsState();
        window.showToast('Objetivo eliminado', 'success');
        renderSavingsList();
        renderSavingsSummary();
    });
}

async function paySavingQuota(id) {
    const g = savingsState.goals.find(g => g.id === id);
    if (!g) return;
    const sym = svgGetSymbol(g.currency);
    const amount = g.monthlyAmount;
    if (!amount || amount <= 0) {
        window.showToast('Define un monto mensual para este objetivo primero', 'error');
        return;
    }

    window.showConfirm(`¿Registrar aporte de ${sym} ${svgFmtNum(amount)} a "${g.name}"?`, async (ok) => {
        if (!ok) return;
        g.accumulated = Math.min(g.goal, g.accumulated + amount);

        if (py && py.add_shopping) {
            await py.add_shopping(
                `Ahorro: ${g.name}`,
                amount,
                g.currency,
                new Date().toISOString().split('T')[0],
                '',
                'Ahorros'
            );
        }

        await saveSavingsState();
        window.showToast(`Aporte de ${sym} ${svgFmtNum(amount)} registrado`, 'success');
        renderSavingsList();
        renderSavingsSummary();

        if (document.getElementById('view-budget')?.classList.contains('active')) {
            if (window.fetchBudget) window.fetchBudget();
        }
    });
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function initSavingsListeners() {
    const newBtn = document.getElementById('open-new-saving-btn');
    if (newBtn) newBtn.addEventListener('click', () => openSavingModal());

    const listContainer = document.getElementById('savings-goals-list');
    if (listContainer) {
        listContainer.addEventListener('click', (e) => {
            const payBtn = e.target.closest('.saving-pay-btn');
            if (payBtn) {
                paySavingQuota(Number(payBtn.getAttribute('data-id')));
                return;
            }
            const editBtn = e.target.closest('.saving-edit-btn');
            if (editBtn) {
                openSavingModal(Number(editBtn.getAttribute('data-id')));
                return;
            }
            const deleteBtn = e.target.closest('.saving-delete-btn');
            if (deleteBtn) {
                deleteSavingGoal(Number(deleteBtn.getAttribute('data-id')));
                return;
            }
        });
    }

    const saveBtn = document.getElementById('save-saving-modal-btn');
    if (saveBtn) saveBtn.addEventListener('click', saveSavingGoal);

    const cancelBtn = document.getElementById('close-saving-modal-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', () => document.getElementById('saving-editor-modal')?.classList.remove('active'));

    const closeX = document.getElementById('close-saving-modal-x');
    if (closeX) closeX.addEventListener('click', () => document.getElementById('saving-editor-modal')?.classList.remove('active'));
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSavingsListeners);
} else {
    initSavingsListeners();
}

window.fetchSavings = fetchSavings;
window.openSavingModal = openSavingModal;
window.saveSavingGoal = saveSavingGoal;
window.deleteSavingGoal = deleteSavingGoal;
window.paySavingQuota = paySavingQuota;
