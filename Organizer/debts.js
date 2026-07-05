// debts.js - Lógica y UI para el planificador de deudas (Bola de Nieve)

const debtsState = {
    debts: [],
    budget: 0 // Presupuesto mensual asignado a deudas
};

function fmtNum(n) {
    return Number(n || 0).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function getCurrencySymbol() {
    return window.currencyState?.symbol || 'Q';
}

// Cargar deudas y presupuesto
async function fetchDebts() {
    try {
        if (!py) return;

        const [debtsList, budgetVal] = await Promise.all([
            py.get_debts(),
            py.get_debts_budget()
        ]);

        debtsState.debts = Array.isArray(debtsList) ? debtsList : [];
        debtsState.budget = Number(budgetVal) || 0;

        // Sincronizar presupuesto de deudas en el input
        const budgetInput = document.getElementById('debts-budget-input');
        if (budgetInput) {
            budgetInput.value = debtsState.budget;
        }

        renderDebtsList();
        renderSnowballProjection();
    } catch (err) {
        console.error('Error fetching debts:', err);
        const container = document.getElementById('debts-list');
        if (container) {
            container.innerHTML = '<div class="ag-empty">Error al cargar las deudas</div>';
        }
    }
}

// Guardar deudas y presupuesto
async function saveDebtsState() {
    if (!py) return;
    await Promise.all([
        py.save_debts(debtsState.debts),
        py.save_debts_budget(debtsState.budget)
    ]);
}

// Renderizar la lista de deudas en la UI
function renderDebtsList() {
    const container = document.getElementById('debts-list');
    if (!container) return;

    if (debtsState.debts.length === 0) {
        container.innerHTML = '<div class="ag-empty">No tienes deudas registradas 🎉</div>';
        return;
    }

    const sym = getCurrencySymbol();

    // Ordenar deudas por saldo de menor a mayor (orden de la Bola de Nieve)
    const sortedDebts = [...debtsState.debts].sort((a, b) => a.balance - b.balance);

    container.innerHTML = sortedDebts.map((d, index) => `
        <div class="ag-item debt-item-card" style="background: var(--ag-card-bg); border: 1px solid var(--ag-border); border-radius: 8px; padding: 14px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
            <div style="display: flex; align-items: center; gap: 12px;">
                <span class="debt-order-badge" style="background: var(--ag-accent); color: #fff; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.8rem; font-weight: 700;">${index + 1}</span>
                <div>
                    <div style="font-weight: 600; font-size: 0.92rem; color: var(--ag-text);">${escapeHtml(d.name)}</div>
                    <div style="font-size: 0.78rem; color: var(--ag-text-muted);">Pago Mínimo: ${sym} ${fmtNum(d.minPayment)}</div>
                </div>
            </div>
            <div style="text-align: right; display: flex; align-items: center; gap: 16px;">
                <div>
                    <div style="font-weight: 700; color: #ff7675; font-size: 1rem;">${sym} ${fmtNum(d.balance)}</div>
                    <div style="font-size: 0.75rem; color: var(--ag-text-muted);">Saldo Pendiente</div>
                </div>
                <div style="display: flex; gap: 4px;">
                    <button class="ag-btn debt-pay-btn" data-id="${d.id}" style="padding: 4px 8px; font-size: 0.78rem; background: rgba(46, 213, 115, 0.15); border: 1px solid #2ed573; color: #2ed573; font-weight: 600; cursor: pointer;" title="Registrar pago mensual">Abonar</button>
                    <button class="ag-edit-btn debt-edit-btn" data-id="${d.id}" style="background:none; border:none; cursor:pointer; font-size:0.85rem;">✏️</button>
                    <button class="ag-delete-btn debt-delete-btn" data-id="${d.id}" style="background:none; border:none; cursor:pointer; font-size:0.85rem;">🗑️</button>
                </div>
            </div>
        </div>
    `).join('');
}

// Motor del simulador Bola de Nieve y renderizado de la proyección
function renderSnowballProjection() {
    const container = document.getElementById('debts-projection-timeline');
    if (!container) return;

    if (debtsState.debts.length === 0) {
        container.innerHTML = '<div class="ag-empty">Agrega deudas para ver la proyección</div>';
        return;
    }

    const sym = getCurrencySymbol();
    const sortedDebts = [...debtsState.debts].sort((a, b) => a.balance - b.balance);
    const totalMinPayment = sortedDebts.reduce((sum, d) => sum + d.minPayment, 0);

    // Si hay un presupuesto establecido, validar si cubre el pago mínimo
    if (debtsState.budget > 0 && debtsState.budget < totalMinPayment) {
        container.innerHTML = `
            <div style="background: rgba(255, 118, 117, 0.12); border: 1px solid #ff7675; border-radius: 8px; padding: 14px; color: #ff7675; font-size: 0.88rem; display: flex; align-items: center; gap: 10px;">
                <span>⚠️</span>
                <div>
                    <strong>Presupuesto insuficiente:</strong> Tu presupuesto de deudas (${sym} ${fmtNum(debtsState.budget)}) es menor que la suma de los pagos mínimos obligatorios (${sym} ${fmtNum(totalMinPayment)}). Por favor incrementa el presupuesto.
                </div>
            </div>
        `;
        return;
    }

    // Inicializar simulación
    const simulationDebts = sortedDebts.map(d => ({
        id: d.id,
        name: d.name,
        balance: d.balance,
        minPayment: d.minPayment,
        monthsToClear: 0,
        paymentsHistory: []
    }));

    let month = 0;
    const maxMonths = 120; // Límite de 10 años para evitar loops infinitos

    while (simulationDebts.some(d => d.balance > 0) && month < maxMonths) {
        month++;

        // Dinero mensual disponible total para deudas en este mes
        let monthlyAvailable = debtsState.budget > 0 ? debtsState.budget : simulationDebts.filter(d => d.balance > 0).reduce((sum, d) => sum + d.minPayment, 0);

        // 1. Asignar pagos mínimos a todas las deudas activas
        const activeDebts = simulationDebts.filter(d => d.balance > 0);
        
        // Pagar los mínimos
        activeDebts.forEach(d => {
            const payment = Math.min(d.balance, d.minPayment);
            d.balance -= payment;
            monthlyAvailable -= payment;
            d.paymentsHistory.push({ month, amount: payment });
        });

        // 2. Si sobra presupuesto (bola de nieve), inyectarlo en la deuda activa más baja
        if (monthlyAvailable > 0 && activeDebts.length > 0) {
            const targetDebt = activeDebts[0];
            const extraPayment = Math.min(targetDebt.balance, monthlyAvailable);
            targetDebt.balance -= extraPayment;
            
            const lastPaymentIdx = targetDebt.paymentsHistory.length - 1;
            if (lastPaymentIdx >= 0) {
                targetDebt.paymentsHistory[lastPaymentIdx].amount += extraPayment;
            }
            
            monthlyAvailable -= extraPayment;
        }

        // Registrar los meses transcurridos para cada deuda liquidada
        simulationDebts.forEach(d => {
            if (d.balance <= 0 && d.monthsToClear === 0) {
                d.monthsToClear = month;
            }
        });
    }

    // Calcular resumen
    const totalDebtAmount = debtsState.debts.reduce((sum, d) => sum + d.balance, 0);
    const monthsRequired = Math.max(...simulationDebts.map(d => d.monthsToClear));

    let summaryHtml = `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px;">
            <div style="background: rgba(108, 92, 231, 0.04); border: 1px solid rgba(108, 92, 231, 0.1); padding: 12px; border-radius: 8px; text-align: center;">
                <div style="font-size: 0.8rem; color: var(--ag-text-muted);">Monto Total Adeudado</div>
                <div style="font-size: 1.25rem; font-weight: 700; color: #ff7675; margin-top: 4px;">${sym} ${fmtNum(totalDebtAmount)}</div>
            </div>
            <div style="background: rgba(46, 213, 115, 0.04); border: 1px solid rgba(46, 213, 115, 0.1); padding: 12px; border-radius: 8px; text-align: center;">
                <div style="font-size: 0.8rem; color: var(--ag-text-muted);">Tiempo Estimado Libre de Deuda</div>
                <div style="font-size: 1.25rem; font-weight: 700; color: #2ed573; margin-top: 4px;">${monthsRequired} ${monthsRequired === 1 ? 'Mes' : 'Meses'}</div>
            </div>
        </div>
    `;

    // Renderizar tabla/línea temporal de liquidación
    let timelineHtml = `
        <div style="margin-top: 10px;">
            <h3 style="font-size: 0.95rem; font-weight: 600; margin-bottom: 12px; color: var(--ag-text);">Calendario de Liquidación (Bola de Nieve)</h3>
            <div style="display: flex; flex-direction: column; gap: 8px;">
                ${simulationDebts.map(d => {
                    const finalPaymentMonth = d.monthsToClear;
                    return `
                        <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); border-radius: 8px; padding: 10px 14px; display: flex; flex-direction: column; gap: 6px;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <span style="font-weight: 600; font-size: 0.88rem; color: var(--ag-text);">${escapeHtml(d.name)}</span>
                                <span style="font-size: 0.82rem; font-weight: 700; color: #2ed573; background: rgba(46, 213, 115, 0.1); padding: 2px 8px; border-radius: 99px;">Liquidada en Mes ${finalPaymentMonth}</span>
                            </div>
                            <div style="font-size: 0.76rem; color: var(--ag-text-muted); display: flex; justify-content: space-between;">
                                <span>Cuotas proyectadas: ${finalPaymentMonth} meses</span>
                                <span>Abono final acumulado: ${sym} ${fmtNum(d.paymentsHistory[d.paymentsHistory.length - 1]?.amount || 0)} / mes</span>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;

    container.innerHTML = summaryHtml + timelineHtml;
}

// Abrir modal de deuda (para agregar o editar)
function openDebtModal(id = null) {
    const modal = document.getElementById('debt-editor-modal');
    if (!modal) return;

    const title = document.getElementById('debt-modal-title');
    const nameInput = document.getElementById('debt-name-input');
    const balanceInput = document.getElementById('debt-balance-input');
    const minPayInput = document.getElementById('debt-minpay-input');
    const idInput = document.getElementById('debt-id-hidden');

    if (id) {
        const debt = debtsState.debts.find(d => d.id === id);
        if (!debt) return;

        title.textContent = 'Editar Deuda';
        nameInput.value = debt.name;
        balanceInput.value = debt.balance;
        minPayInput.value = debt.minPayment;
        idInput.value = debt.id;
    } else {
        title.textContent = 'Nueva Deuda';
        nameInput.value = '';
        balanceInput.value = '';
        minPayInput.value = '';
        idInput.value = '';
    }

    modal.classList.add('active');
}

// Guardar los datos de una deuda
async function saveDebt() {
    const name = (document.getElementById('debt-name-input')?.value || '').trim();
    const balance = parseFloat(document.getElementById('debt-balance-input')?.value || '0');
    const minPayment = parseFloat(document.getElementById('debt-minpay-input')?.value || '0');
    const id = document.getElementById('debt-id-hidden')?.value;

    if (!name || Number.isNaN(balance) || Number.isNaN(minPayment) || balance < 0 || minPayment < 0) {
        window.showToast('Por favor completa todos los campos con valores válidos', 'error');
        return;
    }

    if (id) {
        // Modo Edición
        const debt = debtsState.debts.find(d => d.id === Number(id));
        if (debt) {
            debt.name = name;
            debt.balance = balance;
            debt.minPayment = minPayment;
        }
    } else {
        // Modo Creación
        const newId = debtsState.debts.length > 0 ? Math.max(...debtsState.debts.map(d => d.id)) + 1 : 1;
        debtsState.debts.push({ id: newId, name, balance, minPayment });
    }

    await saveDebtsState();
    document.getElementById('debt-editor-modal')?.classList.remove('active');
    window.showToast('Deuda guardada exitosamente', 'success');
    fetchDebts();
}

// Eliminar deuda
async function deleteDebt(id) {
    window.showConfirm('¿Borrar esta deuda?', async (ok) => {
        if (!ok) return;
        debtsState.debts = debtsState.debts.filter(d => d.id !== id);
        await saveDebtsState();
        window.showToast('Deuda eliminada exitosamente', 'success');
        fetchDebts();
    });
}

// Abonar / Registrar el pago mensual a una deuda
async function payDebtQuota(id) {
    const debtIndex = debtsState.debts.findIndex(d => d.id === id);
    if (debtIndex === -1) return;

    const debt = debtsState.debts[debtIndex];
    
    let paymentAmount = debt.minPayment;
    const sorted = [...debtsState.debts].sort((a, b) => a.balance - b.balance);
    const totalMin = sorted.reduce((sum, d) => sum + d.minPayment, 0);
    
    if (debtsState.budget >= totalMin) {
        let extra = debtsState.budget - totalMin;
        const targetDebt = sorted[0]; 
        if (targetDebt.id === id) {
            paymentAmount += extra;
        }
    }

    const finalPayment = Math.min(debt.balance, paymentAmount);
    const sym = getCurrencySymbol();

    window.showConfirm(`¿Registrar abono de ${sym} ${fmtNum(finalPayment)} a "${debt.name}"?`, async (ok) => {
        if (!ok) return;

        debt.balance = Math.max(0, debt.balance - finalPayment);
        
        // Registrar abono como Gasto en el presupuesto general
        if (py && py.add_shopping) {
            await py.add_shopping(
                `Abono de deuda: ${debt.name}`, 
                finalPayment, 
                'local', // Moneda local por defecto
                new Date().toISOString().split('T')[0], 
                '', 
                'Deudas'
            );
        }

        await saveDebtsState();
        window.showToast(`Abono de ${sym} ${fmtNum(finalPayment)} registrado exitosamente`, 'success');
        fetchDebts();
        
        // Recargar presupuesto si está activo
        if (document.getElementById('view-budget')?.classList.contains('active')) {
            if (window.fetchBudget) window.fetchBudget();
        }
    });
}

// Inicializar escuchas del planificador de deudas (programático)
function initDebtsListeners() {
    const addDebtDialogBtn = document.getElementById('btn-add-debt-dialog');
    if (addDebtDialogBtn) {
        addDebtDialogBtn.addEventListener('click', () => {
            openDebtModal();
        });
    }

    const debtsList = document.getElementById('debts-list');
    if (debtsList) {
        debtsList.addEventListener('click', (e) => {
            const payBtn = e.target.closest('.debt-pay-btn');
            if (payBtn) {
                payDebtQuota(Number(payBtn.getAttribute('data-id')));
                return;
            }
            const editBtn = e.target.closest('.debt-edit-btn');
            if (editBtn) {
                openDebtModal(Number(editBtn.getAttribute('data-id')));
                return;
            }
            const deleteBtn = e.target.closest('.debt-delete-btn');
            if (deleteBtn) {
                deleteDebt(Number(deleteBtn.getAttribute('data-id')));
                return;
            }
        });
    }

    const saveBudgetBtn = document.getElementById('save-debts-budget-btn');
    if (saveBudgetBtn) {
        saveBudgetBtn.addEventListener('click', () => {
            const input = document.getElementById('debts-budget-input');
            if (input) {
                debtsState.budget = Number(input.value) || 0;
                saveDebtsState();
                window.showToast('Presupuesto de deudas actualizado', 'success');
                fetchDebts();
                if (window.fetchBudget) window.fetchBudget();
            }
        });
    }

    const saveDebtBtn = document.getElementById('save-debt-modal-btn');
    if (saveDebtBtn) {
        saveDebtBtn.addEventListener('click', saveDebt);
    }

    const closeCancelBtn = document.getElementById('close-debt-modal-cancel');
    if (closeCancelBtn) {
        closeCancelBtn.addEventListener('click', () => {
            document.getElementById('debt-editor-modal')?.classList.remove('active');
        });
    }

    const closeXBtn = document.getElementById('close-debt-modal-x');
    if (closeXBtn) {
        closeXBtn.addEventListener('click', () => {
            document.getElementById('debt-editor-modal')?.classList.remove('active');
        });
    }
}

// Ejecutar al cargar la página
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDebtsListeners);
} else {
    initDebtsListeners();
}

// Exponer funciones necesarias globalmente
window.fetchDebts = fetchDebts;
window.openDebtModal = openDebtModal;
window.saveDebt = saveDebt;
window.deleteDebt = deleteDebt;
window.payDebtQuota = payDebtQuota;
