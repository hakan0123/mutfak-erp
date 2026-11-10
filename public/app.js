// =============================================================================
// Mutfak ERP - Frontend Application Logic
// =============================================================================

let state = {
    currentTab: 'dashboard',
    dashboardData: null,
    ingredients: [],
    menuItems: [],
    purchases: [],
    orders: [],
    wasteLogs: [],
    stockCounts: [],
    posCart: [], // { menuItem, quantity }
    activeRecipeMenuItemId: null,
    currentCountSessionId: null
};

let categorySalesChartInstance = null;

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

async function initApp() {
    await loadDashboard();
    await loadIngredients();
    await loadMenuItems();
}

function refreshCurrentTab() {
    switch (state.currentTab) {
        case 'dashboard':
            loadDashboard();
            break;
        case 'ingredients':
            loadIngredients();
            break;
        case 'recipes':
            loadMenuItems();
            break;
        case 'purchases':
            loadPurchases();
            break;
        case 'pos':
            loadPosView();
            break;
        case 'waste':
            loadWasteLogs();
            break;
        case 'stock-counts':
            loadStockCounts();
            break;
    }
    showToast('Veriler güncellendi', 'info');
}

// -----------------------------------------------------------------------------
// TAB NAVIGATION
// -----------------------------------------------------------------------------
function switchTab(tabId) {
    state.currentTab = tabId;

    // Update active classes for sidebar
    document.querySelectorAll('#sidebar-nav .nav-item').forEach(btn => {
        if (btn.getAttribute('data-tab') === tabId) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Update mobile nav buttons
    document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
        if (btn.getAttribute('data-tab') === tabId) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Hide all panes, show target pane
    document.querySelectorAll('.tab-pane').forEach(pane => {
        pane.classList.remove('active');
        pane.classList.add('hidden');
    });

    const target = document.getElementById(`tab-${tabId}`);
    if (target) {
        target.classList.remove('hidden');
        target.classList.add('active');
    }

    // Load data specific to tab
    if (tabId === 'dashboard') loadDashboard();
    else if (tabId === 'ingredients') loadIngredients();
    else if (tabId === 'recipes') loadMenuItems();
    else if (tabId === 'purchases') loadPurchases();
    else if (tabId === 'pos') loadPosView();
    else if (tabId === 'waste') loadWasteLogs();
    else if (tabId === 'stock-counts') loadStockCounts();
}

// -----------------------------------------------------------------------------
// 1. DASHBOARD
// -----------------------------------------------------------------------------
async function loadDashboard() {
    try {
        const res = await fetch('/api/dashboard');
        const json = await res.json();
        if (!json.success) return;

        const data = json.data;
        state.dashboardData = data;

        // Header and Card Food Cost %
        const foodCost = data.food_cost_pct || 0;
        document.getElementById('header-food-cost').textContent = `%${foodCost.toFixed(1)}`;
        document.getElementById('kpi-food-cost-val').textContent = `%${foodCost.toFixed(1)}`;

        // Badge & Color
        const badge = document.getElementById('kpi-food-cost-badge');
        const bar = document.getElementById('kpi-food-cost-bar');
        bar.style.width = `${Math.min(foodCost * 2, 100)}%`;

        if (foodCost === 0) {
            badge.className = 'text-xs px-2 py-0.5 rounded-full font-bold bg-slate-700 text-slate-300';
            badge.textContent = 'Veri Yok';
            bar.className = 'h-full bg-slate-500 transition-all duration-500';
        } else if (foodCost >= 28 && foodCost <= 35) {
            badge.className = 'text-xs px-2 py-0.5 rounded-full font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
            badge.textContent = 'İdeal Sektör Aralığı';
            bar.className = 'h-full bg-emerald-500 transition-all duration-500';
            document.getElementById('header-food-cost').className = 'font-bold text-emerald-400';
        } else if (foodCost < 28) {
            badge.className = 'text-xs px-2 py-0.5 rounded-full font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30';
            badge.textContent = 'Düşük Maliyet (Yüksek Kar)';
            bar.className = 'h-full bg-blue-500 transition-all duration-500';
            document.getElementById('header-food-cost').className = 'font-bold text-blue-400';
        } else {
            badge.className = 'text-xs px-2 py-0.5 rounded-full font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30';
            badge.textContent = 'Yüksek Maliyet (Müdahale Gerekli)';
            bar.className = 'h-full bg-rose-500 transition-all duration-500';
            document.getElementById('header-food-cost').className = 'font-bold text-rose-400';
        }

        // Revenue, Kitchen Cost, Inventory
        document.getElementById('kpi-sales-revenue').textContent = formatCurrency(data.total_sales_revenue);
        document.getElementById('kpi-kitchen-cost').textContent = formatCurrency(data.total_kitchen_cost);
        document.getElementById('kpi-gross-profit').textContent = formatCurrency(data.gross_profit);
        document.getElementById('kpi-profit-margin').textContent = `%${data.gross_profit_margin_pct.toFixed(1)} Marj`;
        document.getElementById('kpi-inventory-val').textContent = formatCurrency(data.total_inventory_value);
        document.getElementById('kpi-ing-count').textContent = data.total_ingredients_count;

        // Critical stock count badge
        const critCount = data.critical_stock_count;
        const sideBadge = document.getElementById('badge-critical-count');
        if (critCount > 0) {
            sideBadge.textContent = critCount;
            sideBadge.classList.remove('hidden');
            document.getElementById('kpi-critical-alert').textContent = `${critCount} kritik seviyede!`;
            document.getElementById('kpi-critical-alert').className = 'text-xs text-rose-400 font-bold cursor-pointer hover:underline animate-pulse';
        } else {
            sideBadge.classList.add('hidden');
            document.getElementById('kpi-critical-alert').textContent = 'Stoklar güvenli';
            document.getElementById('kpi-critical-alert').className = 'text-xs text-emerald-400 font-semibold cursor-pointer';
        }

        // Render Critical Stock list in Dashboard
        renderDashboardCriticalStocks(data.critical_stocks);

        // Render Recent Orders in Dashboard
        renderDashboardRecentOrders(data.recent_orders);

        // Render Recent Waste in Dashboard
        renderDashboardRecentWaste(data.recent_waste);

        // Render Category Sales Chart
        renderCategorySalesChart(data.category_distribution);

    } catch (err) {
        console.error('Error loading dashboard:', err);
    }
}

function renderDashboardCriticalStocks(stocks) {
    const container = document.getElementById('critical-stock-list');
    if (!stocks || stocks.length === 0) {
        container.innerHTML = `
            <div class="text-center py-6 text-xs text-slate-500">
                <i class="fa-solid fa-circle-check text-emerald-400 text-lg mb-1 block"></i>
                Tüm hammadde stokları güvenli eşik üzerinde.
            </div>`;
        return;
    }

    container.innerHTML = stocks.map(s => `
        <div class="flex items-center justify-between p-2.5 rounded-xl bg-slate-900/80 border border-rose-500/30 text-xs">
            <div>
                <div class="font-bold text-slate-200">${s.name}</div>
                <div class="text-[11px] text-slate-400">
                    Mevcut: <b class="text-rose-400">${s.current_stock} ${s.unit}</b> | Min: ${s.min_stock_level} ${s.unit}
                </div>
            </div>
            <div class="text-right">
                <span class="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 font-bold text-[10px]">
                    -${s.shortage_qty} ${s.unit} Eksik
                </span>
            </div>
        </div>
    `).join('');
}

function renderDashboardRecentOrders(orders) {
    const tbody = document.getElementById('recent-orders-tbody');
    if (!orders || orders.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="py-4 text-center text-slate-500">Henüz sipariş kaydı yok.</td></tr>`;
        return;
    }

    tbody.innerHTML = orders.map(o => `
        <tr class="hover:bg-slate-700/30 transition">
            <td class="py-2.5 font-semibold text-slate-200">${o.order_no}</td>
            <td class="py-2.5 text-slate-400">${o.source || 'POS'}</td>
            <td class="py-2.5 font-bold text-emerald-400">${formatCurrency(o.total_amount)}</td>
            <td class="py-2.5">
                <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold ${o.status === 'completed' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-600 text-slate-300'}">
                    ${o.status === 'completed' ? 'Tamamlandı' : o.status}
                </span>
            </td>
            <td class="py-2.5 text-slate-400 text-[11px]">${formatDate(o.order_date)}</td>
        </tr>
    `).join('');
}

function renderDashboardRecentWaste(wastes) {
    const tbody = document.getElementById('recent-waste-tbody');
    if (!wastes || wastes.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="py-4 text-center text-slate-500">Kayıtlı zayiat bulunmuyor.</td></tr>`;
        return;
    }

    tbody.innerHTML = wastes.map(w => `
        <tr class="hover:bg-slate-700/30 transition">
            <td class="py-2.5 font-semibold text-slate-200">${w.ingredient_name}</td>
            <td class="py-2.5 text-rose-400 font-bold">${w.quantity} ${w.unit}</td>
            <td class="py-2.5 text-slate-300">${formatCurrency(w.waste_cost)}</td>
            <td class="py-2.5 text-slate-400 text-[11px] truncate max-w-[120px]" title="${w.reason}">${w.reason || '-'}</td>
        </tr>
    `).join('');
}

function renderCategorySalesChart(categoryData) {
    const ctx = document.getElementById('categorySalesChart');
    if (!ctx) return;

    if (categorySalesChartInstance) {
        categorySalesChartInstance.destroy();
    }

    const labels = (categoryData || []).map(c => c.category);
    const data = (categoryData || []).map(c => c.total_revenue);

    categorySalesChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels.length ? labels : ['Kayıt Yok'],
            datasets: [{
                label: 'Satış Cirosu (TL)',
                data: data.length ? data : [0],
                backgroundColor: [
                    'rgba(249, 115, 22, 0.85)',
                    'rgba(16, 185, 129, 0.85)',
                    'rgba(59, 130, 246, 0.85)',
                    'rgba(168, 85, 247, 0.85)'
                ],
                borderRadius: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#94a3b8' }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: '#94a3b8' }
                }
            }
        }
    });
}

// -----------------------------------------------------------------------------
// 2. INGREDIENTS (HAMMADDE & STOK KALEMLERİ)
// -----------------------------------------------------------------------------
async function loadIngredients() {
    try {
        const res = await fetch('/api/ingredients');
        const json = await res.json();
        if (!json.success) return;

        state.ingredients = json.data;
        renderIngredientsTable(state.ingredients);
    } catch (err) {
        console.error('Error loading ingredients:', err);
    }
}

function renderIngredientsTable(items) {
    const tbody = document.getElementById('ingredients-tbody');
    if (!items || items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="py-6 text-center text-slate-500">Kayıtlı hammadde bulunamadı.</td></tr>`;
        return;
    }

    tbody.innerHTML = items.map(item => {
        const isCritical = item.current_stock <= item.min_stock_level;
        return `
        <tr class="hover:bg-slate-700/40 transition">
            <td class="py-3 px-4 font-mono text-slate-500">${item.id}</td>
            <td class="py-3 px-4 font-bold text-slate-200">${item.name}</td>
            <td class="py-3 px-4 text-slate-400 font-mono">${item.unit}</td>
            <td class="py-3 px-4 font-semibold text-slate-200">${formatCurrency(item.last_unit_price)}</td>
            <td class="py-3 px-4 font-bold ${isCritical ? 'text-rose-400' : 'text-slate-100'}">
                ${item.current_stock} ${item.unit}
            </td>
            <td class="py-3 px-4 text-slate-400">${item.min_stock_level} ${item.unit}</td>
            <td class="py-3 px-4 font-bold text-blue-400">${formatCurrency(item.total_inventory_value)}</td>
            <td class="py-3 px-4">
                <span class="px-2.5 py-1 rounded-full text-[10px] font-bold ${isCritical ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'}">
                    ${isCritical ? 'KRİTİK STOK' : 'YETERLİ'}
                </span>
            </td>
            <td class="py-3 px-4 text-right space-x-1">
                <button onclick="editIngredient(${item.id})" class="p-1.5 text-blue-400 hover:text-white hover:bg-blue-600/30 rounded-lg transition" title="Düzenle">
                    <i class="fa-solid fa-pen-to-square"></i>
                </button>
                <button onclick="deleteIngredient(${item.id})" class="p-1.5 text-rose-400 hover:text-white hover:bg-rose-600/30 rounded-lg transition" title="Sil">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </td>
        </tr>`;
    }).join('');
}

function filterIngredientsTable() {
    const q = document.getElementById('ing-search').value.toLowerCase();
    const status = document.getElementById('ing-status-filter').value;

    const filtered = state.ingredients.filter(i => {
        const matchesQuery = i.name.toLowerCase().includes(q) || i.unit.toLowerCase().includes(q);
        const isCritical = i.current_stock <= i.min_stock_level;
        if (status === 'critical') return matchesQuery && isCritical;
        if (status === 'normal') return matchesQuery && !isCritical;
        return matchesQuery;
    });

    renderIngredientsTable(filtered);
}

function openIngredientModal(data = null) {
    document.getElementById('form-ingredient').reset();
    if (data) {
        document.getElementById('modal-ingredient-title').textContent = 'Hammadde Düzenle';
        document.getElementById('ing-id').value = data.id;
        document.getElementById('ing-name').value = data.name;
        document.getElementById('ing-unit').value = data.unit;
        document.getElementById('ing-price').value = data.last_unit_price;
        document.getElementById('ing-stock').value = data.current_stock;
        document.getElementById('ing-min-stock').value = data.min_stock_level;
    } else {
        document.getElementById('modal-ingredient-title').textContent = 'Yeni Hammadde Tanımla';
        document.getElementById('ing-id').value = '';
    }
    openModal('modal-ingredient');
}

function editIngredient(id) {
    const item = state.ingredients.find(i => i.id === id);
    if (item) openIngredientModal(item);
}

async function handleSaveIngredient(e) {
    e.preventDefault();
    const id = document.getElementById('ing-id').value;
    const payload = {
        name: document.getElementById('ing-name').value,
        unit: document.getElementById('ing-unit').value,
        last_unit_price: parseFloat(document.getElementById('ing-price').value),
        current_stock: parseFloat(document.getElementById('ing-stock').value || 0),
        min_stock_level: parseFloat(document.getElementById('ing-min-stock').value || 0)
    };

    try {
        const url = id ? `/api/ingredients/${id}` : '/api/ingredients';
        const method = id ? 'PUT' : 'POST';
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const json = await res.json();
        if (json.success) {
            closeModal('modal-ingredient');
            showToast('Hammadde başarıyla kaydedildi.', 'success');
            await loadIngredients();
            loadDashboard();
        } else {
            showToast(json.error || 'Hata oluştu', 'error');
        }
    } catch (err) {
        showToast('Bağlantı hatası', 'error');
    }
}

async function deleteIngredient(id) {
    if (!confirm('Bu hammaddeyi silmek istediğinize emin misiniz?')) return;
    try {
        const res = await fetch(`/api/ingredients/${id}`, { method: 'DELETE' });
        const json = await res.json();
        if (json.success) {
            showToast('Hammadde silindi.', 'success');
            await loadIngredients();
            loadDashboard();
        } else {
            showToast(json.error || 'Silinemedi', 'error');
        }
    } catch (err) {
        showToast('Hata oluştu', 'error');
    }
}

// -----------------------------------------------------------------------------
// 3. MENU ITEMS & RECIPES (Query A)
// -----------------------------------------------------------------------------
async function loadMenuItems() {
    try {
        const res = await fetch('/api/menu-items');
        const json = await res.json();
        if (!json.success) return;

        state.menuItems = json.data;
        renderMenuItemsGrid(state.menuItems);
    } catch (err) {
        console.error('Error loading menu items:', err);
    }
}

function renderMenuItemsGrid(items) {
    const grid = document.getElementById('menu-items-grid');
    if (!items || items.length === 0) {
        grid.innerHTML = `<div class="col-span-full py-10 text-center text-slate-500">Kayıtlı menü ürünü bulunamadı.</div>`;
        return;
    }

    grid.innerHTML = items.map(item => {
        const unitCost = item.unit_cost || 0;
        const profit = item.profit_amount || (item.selling_price - unitCost);
        const marginPct = item.profit_margin_pct != null ? item.profit_margin_pct : (item.selling_price ? ((profit / item.selling_price) * 100) : 0);
        const foodCostPct = item.food_cost_pct_item != null ? item.food_cost_pct_item : (item.selling_price ? ((unitCost / item.selling_price) * 100) : 0);

        return `
        <div class="bg-slate-800/70 border border-slate-700/80 rounded-2xl p-5 flex flex-col justify-between hover:border-slate-600 transition shadow-sm group">
            <div class="space-y-3">
                <div class="flex items-start justify-between gap-3">
                    <div class="flex items-center gap-3">
                        <img src="${item.image_url || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=100'}" alt="${item.name}" class="w-12 h-12 rounded-xl object-cover border border-slate-700 shrink-0">
                        <div>
                            <span class="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-slate-700 text-slate-300 uppercase">${item.category}</span>
                            <h3 class="text-base font-bold text-white mt-1 group-hover:text-orange-400 transition">${item.name}</h3>
                        </div>
                    </div>
                    <div class="text-right">
                        <div class="text-base font-black text-emerald-400">${formatCurrency(item.selling_price)}</div>
                        <span class="text-[10px] text-slate-500">Satış Fiyatı</span>
                    </div>
                </div>

                <!-- Query A Metrics Grid -->
                <div class="grid grid-cols-3 gap-2 bg-slate-900/80 p-3 rounded-xl border border-slate-700/60 text-center text-xs">
                    <div>
                        <span class="text-[10px] text-slate-400 block">Reçete Maliyeti</span>
                        <span class="font-bold text-rose-400">${formatCurrency(unitCost)}</span>
                    </div>
                    <div>
                        <span class="text-[10px] text-slate-400 block">Kar Tutarı</span>
                        <span class="font-bold text-emerald-400">${formatCurrency(profit)}</span>
                    </div>
                    <div>
                        <span class="text-[10px] text-slate-400 block">Food Cost %</span>
                        <span class="font-bold ${foodCostPct > 35 ? 'text-rose-400' : 'text-slate-200'}">%${foodCostPct.toFixed(1)}</span>
                    </div>
                </div>

                <div class="flex items-center justify-between text-xs text-slate-400">
                    <span>Reçete: <b class="text-slate-200">${item.recipe_item_count}</b> hammadde</span>
                    <span>Brüt Kar Marjı: <b class="text-emerald-400 font-bold">%${marginPct.toFixed(1)}</b></span>
                </div>
            </div>

            <div class="mt-4 pt-3 border-t border-slate-700/60 flex items-center justify-between gap-2">
                <button onclick="openRecipeModal(${item.id})" class="flex-1 py-2 px-3 rounded-xl bg-orange-600/20 hover:bg-orange-600/30 text-orange-400 border border-orange-500/30 font-semibold text-xs flex items-center justify-center gap-1.5 transition">
                    <i class="fa-solid fa-list-check"></i> Reçeteyi Düzenle
                </button>
                <button onclick="editMenuItem(${item.id})" class="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-700/50 transition" title="Ürün Düzenle">
                    <i class="fa-solid fa-pen"></i>
                </button>
                <button onclick="deleteMenuItem(${item.id})" class="p-2 text-rose-400 hover:text-rose-300 rounded-xl hover:bg-slate-700/50 transition" title="Ürün Sil">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        </div>`;
    }).join('');
}

function openMenuItemModal(data = null) {
    document.getElementById('form-menu-item').reset();
    if (data) {
        document.getElementById('modal-menu-title').textContent = 'Menü Ürünü Düzenle';
        document.getElementById('menu-id').value = data.id;
        document.getElementById('menu-name').value = data.name;
        document.getElementById('menu-price').value = data.selling_price;
        document.getElementById('menu-category').value = data.category;
        document.getElementById('menu-image').value = data.image_url || '';
    } else {
        document.getElementById('modal-menu-title').textContent = 'Yeni Menü Ürünü Ekle';
        document.getElementById('menu-id').value = '';
    }
    openModal('modal-menu-item');
}

function editMenuItem(id) {
    const item = state.menuItems.find(m => m.id === id);
    if (item) openMenuItemModal(item);
}

async function handleSaveMenuItem(e) {
    e.preventDefault();
    const id = document.getElementById('menu-id').value;
    const payload = {
        name: document.getElementById('menu-name').value,
        selling_price: parseFloat(document.getElementById('menu-price').value),
        category: document.getElementById('menu-category').value,
        image_url: document.getElementById('menu-image').value
    };

    try {
        const url = id ? `/api/menu-items/${id}` : '/api/menu-items';
        const method = id ? 'PUT' : 'POST';
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const json = await res.json();
        if (json.success) {
            closeModal('modal-menu-item');
            showToast('Menü ürünü kaydedildi.', 'success');
            await loadMenuItems();
            loadDashboard();
        } else {
            showToast(json.error || 'Hata oluştu', 'error');
        }
    } catch (err) {
        showToast('Hata', 'error');
    }
}

async function deleteMenuItem(id) {
    if (!confirm('Bu menü ürününü ve reçetesini silmek istediğinize emin misiniz?')) return;
    try {
        const res = await fetch(`/api/menu-items/${id}`, { method: 'DELETE' });
        const json = await res.json();
        if (json.success) {
            showToast('Menü ürünü silindi.', 'success');
            await loadMenuItems();
            loadDashboard();
        }
    } catch (err) {
        showToast('Hata', 'error');
    }
}

// -----------------------------------------------------------------------------
// RECIPE DETAIL & COSTING MODAL
// -----------------------------------------------------------------------------
async function openRecipeModal(menuItemId) {
    state.activeRecipeMenuItemId = menuItemId;
    const menuItem = state.menuItems.find(m => m.id === menuItemId);
    if (!menuItem) return;

    document.getElementById('recipe-modal-title').textContent = `${menuItem.name} - Reçete Detayı`;
    document.getElementById('recipe-selling-price').textContent = formatCurrency(menuItem.selling_price);

    const container = document.getElementById('recipe-rows-container');
    container.innerHTML = `<div class="text-center py-4 text-slate-500 text-xs">Yükleniyor...</div>`;

    openModal('modal-recipe');

    try {
        const res = await fetch(`/api/menu-items/${menuItemId}/recipe`);
        const json = await res.json();
        const recipeItems = json.data || [];

        container.innerHTML = '';
        if (recipeItems.length === 0) {
            addRecipeIngredientRow();
        } else {
            for (const r of recipeItems) {
                addRecipeIngredientRow(r);
            }
        }
        recalculateRecipeCostSummary();
    } catch (err) {
        console.error(err);
    }
}

function addRecipeIngredientRow(data = null) {
    const container = document.getElementById('recipe-rows-container');
    const rowId = `recipe-row-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;

    const div = document.createElement('div');
    div.id = rowId;
    div.className = 'grid grid-cols-12 gap-2 items-center bg-slate-900/90 p-2.5 rounded-xl border border-slate-700/80 text-xs';

    const ingOptions = state.ingredients.map(i => `
        <option value="${i.id}" data-unit="${i.unit}" data-price="${i.last_unit_price}" ${data && data.ingredient_id === i.id ? 'selected' : ''}>
            ${i.name} (${formatCurrency(i.last_unit_price)} / ${i.unit})
        </option>
    `).join('');

    div.innerHTML = `
        <div class="col-span-5">
            <select class="recipe-ing-select w-full bg-slate-800 border border-slate-700 text-slate-200 rounded-lg px-2 py-1.5 focus:outline-none" onchange="recalculateRecipeCostSummary()">
                ${ingOptions}
            </select>
        </div>
        <div class="col-span-3">
            <div class="flex items-center gap-1">
                <input type="number" step="0.001" class="recipe-qty-input w-full bg-slate-800 border border-slate-700 text-slate-200 rounded-lg px-2 py-1.5 focus:outline-none" placeholder="Miktar" value="${data ? data.quantity : 0.1}" oninput="recalculateRecipeCostSummary()">
                <span class="recipe-unit-label text-[11px] text-slate-400 font-mono w-8">${data ? data.unit : 'kg'}</span>
            </div>
        </div>
        <div class="col-span-2">
            <div class="flex items-center gap-0.5">
                <input type="number" step="0.5" class="recipe-waste-input w-full bg-slate-800 border border-slate-700 text-slate-200 rounded-lg px-2 py-1.5 focus:outline-none" placeholder="% Fire" value="${data ? (data.unit_waste_rate || 0) : 0}" oninput="recalculateRecipeCostSummary()">
                <span class="text-[11px] text-slate-400">%</span>
            </div>
        </div>
        <div class="col-span-1 text-right font-bold text-rose-400 recipe-cost-calc">
            ₺0,00
        </div>
        <div class="col-span-1 text-right">
            <button type="button" onclick="document.getElementById('${rowId}').remove(); recalculateRecipeCostSummary();" class="text-rose-400 hover:text-white p-1">
                <i class="fa-solid fa-trash-can"></i>
            </button>
        </div>
    `;

    container.appendChild(div);
    recalculateRecipeCostSummary();
}

function recalculateRecipeCostSummary() {
    let totalCost = 0;
    const rows = document.querySelectorAll('#recipe-rows-container > div');

    rows.forEach(row => {
        const select = row.querySelector('.recipe-ing-select');
        const qtyInput = row.querySelector('.recipe-qty-input');
        const wasteInput = row.querySelector('.recipe-waste-input');
        const unitLabel = row.querySelector('.recipe-unit-label');
        const costLabel = row.querySelector('.recipe-cost-calc');

        if (!select || !select.selectedOptions[0]) return;

        const opt = select.selectedOptions[0];
        const unit = opt.getAttribute('data-unit') || '';
        const price = parseFloat(opt.getAttribute('data-price') || 0);
        const qty = parseFloat(qtyInput.value || 0);
        const wastePct = parseFloat(wasteInput.value || 0);

        unitLabel.textContent = unit;

        // Formula: Miktar * (1 + Fire/100) * Birim Fiyat
        const grossQty = qty * (1.0 + (wastePct / 100.0));
        const lineCost = grossQty * price;
        totalCost += lineCost;

        costLabel.textContent = formatCurrency(lineCost);
    });

    const menuItem = state.menuItems.find(m => m.id === state.activeRecipeMenuItemId);
    const sellingPrice = menuItem ? menuItem.selling_price : 0;
    const profit = sellingPrice - totalCost;
    const marginPct = sellingPrice > 0 ? (profit / sellingPrice) * 100 : 0;

    document.getElementById('recipe-total-cost').textContent = formatCurrency(totalCost);
    document.getElementById('recipe-profit-margin').textContent = `%${marginPct.toFixed(1)}`;
}

async function saveRecipeDetails() {
    if (!state.activeRecipeMenuItemId) return;

    const rows = document.querySelectorAll('#recipe-rows-container > div');
    const items = [];

    rows.forEach(row => {
        const select = row.querySelector('.recipe-ing-select');
        const qtyInput = row.querySelector('.recipe-qty-input');
        const wasteInput = row.querySelector('.recipe-waste-input');

        if (select && select.value && qtyInput && parseFloat(qtyInput.value) > 0) {
            items.push({
                ingredient_id: parseInt(select.value),
                quantity: parseFloat(qtyInput.value),
                unit_waste_rate: parseFloat(wasteInput.value || 0)
            });
        }
    });

    try {
        const res = await fetch(`/api/menu-items/${state.activeRecipeMenuItemId}/recipe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items })
        });
        const json = await res.json();
        if (json.success) {
            closeModal('modal-recipe');
            showToast('Reçete başarıyla güncellendi.', 'success');
            await loadMenuItems();
            loadDashboard();
        } else {
            showToast(json.error || 'Hata oluştu', 'error');
        }
    } catch (err) {
        showToast('Bağlantı hatası', 'error');
    }
}

// -----------------------------------------------------------------------------
// 4. PURCHASES (SATIN ALMA VE İRSALİYE GİRİŞİ)
// -----------------------------------------------------------------------------
async function loadPurchases() {
    try {
        const res = await fetch('/api/purchases');
        const json = await res.json();
        if (!json.success) return;

        state.purchases = json.data;
        renderPurchasesList(state.purchases);
    } catch (err) {
        console.error('Error loading purchases:', err);
    }
}

function renderPurchasesList(purchases) {
    const list = document.getElementById('purchases-list');
    if (!purchases || purchases.length === 0) {
        list.innerHTML = `<div class="p-8 text-center text-slate-500 bg-slate-800/50 rounded-2xl border border-slate-700">Kayıtlı satın alma faturası bulunamadı.</div>`;
        return;
    }

    list.innerHTML = purchases.map(p => `
        <div class="bg-slate-800/70 border border-slate-700/80 rounded-2xl p-5 space-y-3 shadow-sm">
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-700/60">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center text-lg">
                        <i class="fa-solid fa-file-invoice-dollar"></i>
                    </div>
                    <div>
                        <h4 class="font-bold text-white text-sm">${p.supplier_name || 'Tedarikçi'}</h4>
                        <div class="text-xs text-slate-400 flex items-center gap-2">
                            <span>Fatura No: <b class="text-slate-200">${p.invoice_no}</b></span>
                            <span>•</span>
                            <span>${formatDate(p.purchase_date)}</span>
                        </div>
                    </div>
                </div>
                <div class="text-right">
                    <span class="text-xs text-slate-400 block">Fatura Tutarı</span>
                    <span class="text-lg font-black text-cyan-400">${formatCurrency(p.total_amount)}</span>
                </div>
            </div>

            <!-- Items breakdown -->
            <div class="overflow-x-auto">
                <table class="w-full text-left text-xs">
                    <thead>
                        <tr class="text-slate-400 uppercase text-[10px] border-b border-slate-700/40">
                            <th class="pb-2">Hammadde</th>
                            <th class="pb-2">Alınan Miktar</th>
                            <th class="pb-2">Birim Alış Fiyatı</th>
                            <th class="pb-2 text-right">Satır Toplamı</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-700/30">
                        ${(p.items || []).map(it => `
                            <tr>
                                <td class="py-2 font-semibold text-slate-200">${it.ingredient_name}</td>
                                <td class="py-2 text-slate-300">${it.quantity} ${it.unit}</td>
                                <td class="py-2 text-slate-400">${formatCurrency(it.unit_price)}</td>
                                <td class="py-2 text-right font-bold text-cyan-300">${formatCurrency(it.line_total)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `).join('');
}

function openPurchaseModal() {
    document.getElementById('form-purchase').reset();
    document.getElementById('purchase-rows-container').innerHTML = '';
    addPurchaseRow();
    openModal('modal-purchase');
}

function addPurchaseRow() {
    const container = document.getElementById('purchase-rows-container');
    const rowId = `pur-row-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;

    const div = document.createElement('div');
    div.id = rowId;
    div.className = 'grid grid-cols-12 gap-2 items-center bg-slate-900/90 p-2.5 rounded-xl border border-slate-700/80 text-xs';

    const ingOptions = state.ingredients.map(i => `
        <option value="${i.id}" data-unit="${i.unit}" data-price="${i.last_unit_price}">
            ${i.name} (Son Fiyat: ${formatCurrency(i.last_unit_price)} / ${i.unit})
        </option>
    `).join('');

    div.innerHTML = `
        <div class="col-span-5">
            <select class="pur-ing-select w-full bg-slate-800 border border-slate-700 text-slate-200 rounded-lg px-2 py-1.5 focus:outline-none" onchange="updatePurchaseRowDefaults(this)">
                ${ingOptions}
            </select>
        </div>
        <div class="col-span-3">
            <div class="flex items-center gap-1">
                <input type="number" step="0.001" class="pur-qty-input w-full bg-slate-800 border border-slate-700 text-slate-200 rounded-lg px-2 py-1.5 focus:outline-none" placeholder="Miktar" value="1" oninput="calculatePurchaseTotal()">
                <span class="pur-unit-label text-[11px] text-slate-400 font-mono w-8">kg</span>
            </div>
        </div>
        <div class="col-span-3">
            <input type="number" step="0.01" class="pur-price-input w-full bg-slate-800 border border-slate-700 text-slate-200 rounded-lg px-2 py-1.5 focus:outline-none" placeholder="Birim Fiyat" value="100" oninput="calculatePurchaseTotal()">
        </div>
        <div class="col-span-1 text-right">
            <button type="button" onclick="document.getElementById('${rowId}').remove(); calculatePurchaseTotal();" class="text-rose-400 hover:text-white p-1">
                <i class="fa-solid fa-trash-can"></i>
            </button>
        </div>
    `;

    container.appendChild(div);
    const select = div.querySelector('.pur-ing-select');
    updatePurchaseRowDefaults(select);
}

function updatePurchaseRowDefaults(selectEl) {
    if (!selectEl || !selectEl.selectedOptions[0]) return;
    const row = selectEl.closest('.grid');
    const opt = selectEl.selectedOptions[0];
    const unit = opt.getAttribute('data-unit') || '';
    const price = opt.getAttribute('data-price') || '0';

    row.querySelector('.pur-unit-label').textContent = unit;
    row.querySelector('.pur-price-input').value = price;
    calculatePurchaseTotal();
}

function calculatePurchaseTotal() {
    let total = 0;
    const rows = document.querySelectorAll('#purchase-rows-container > div');
    rows.forEach(row => {
        const qty = parseFloat(row.querySelector('.pur-qty-input').value || 0);
        const price = parseFloat(row.querySelector('.pur-price-input').value || 0);
        total += (qty * price);
    });
    document.getElementById('purchase-total-calc').textContent = formatCurrency(total);
}

async function handleSavePurchase(e) {
    e.preventDefault();
    const rows = document.querySelectorAll('#purchase-rows-container > div');
    const items = [];

    rows.forEach(row => {
        const select = row.querySelector('.pur-ing-select');
        const qty = parseFloat(row.querySelector('.pur-qty-input').value || 0);
        const price = parseFloat(row.querySelector('.pur-price-input').value || 0);

        if (select && select.value && qty > 0) {
            items.push({
                ingredient_id: parseInt(select.value),
                quantity: qty,
                unit_price: price
            });
        }
    });

    if (items.length === 0) {
        showToast('En az bir kalem ekleyin.', 'error');
        return;
    }

    const payload = {
        supplier_name: document.getElementById('pur-supplier').value,
        invoice_no: document.getElementById('pur-invoice').value,
        items
    };

    try {
        const res = await fetch('/api/purchases', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const json = await res.json();
        if (json.success) {
            closeModal('modal-purchase');
            showToast('Fatura kaydedildi ve hammadde stokları artırıldı!', 'success');
            await loadPurchases();
            await loadIngredients();
            loadDashboard();
        } else {
            showToast(json.error || 'Hata oluştu', 'error');
        }
    } catch (err) {
        showToast('Hata', 'error');
    }
}

// -----------------------------------------------------------------------------
// 5. POS / HIZLI SİPARİŞ & BACKFLUSHING
// -----------------------------------------------------------------------------
function loadPosView() {
    renderPosCategories();
    renderPosGrid('all');
    renderPosCart();
}

function renderPosCategories() {
    const categories = ['all', ...new Set(state.menuItems.map(m => m.category))];
    const container = document.getElementById('pos-categories');
    container.innerHTML = categories.map(cat => `
        <button onclick="filterPosCategory('${cat}')" class="pos-cat-btn ${cat === 'all' ? 'active' : ''} px-3.5 py-1.5 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold whitespace-nowrap hover:bg-slate-700 transition" data-category="${cat}">
            ${cat === 'all' ? 'Tüm Ürünler' : cat}
        </button>
    `).join('');
}

function filterPosCategory(category) {
    document.querySelectorAll('.pos-cat-btn').forEach(btn => {
        if (btn.getAttribute('data-category') === category) {
            btn.classList.add('active');
            btn.classList.remove('bg-slate-800', 'text-slate-300');
        } else {
            btn.classList.remove('active');
            btn.classList.add('bg-slate-800', 'text-slate-300');
        }
    });

    renderPosGrid(category);
}

function renderPosGrid(category) {
    const grid = document.getElementById('pos-items-grid');
    const items = category === 'all' ? state.menuItems : state.menuItems.filter(m => m.category === category);

    if (items.length === 0) {
        grid.innerHTML = `<div class="col-span-full py-8 text-center text-slate-500 text-xs">Bu kategoride ürün bulunmuyor.</div>`;
        return;
    }

    grid.innerHTML = items.map(m => `
        <div onclick="addToPosCart(${m.id})" class="bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 hover:border-orange-500/50 rounded-2xl p-3.5 flex flex-col justify-between cursor-pointer transition shadow-sm active:scale-95 group">
            <div class="flex items-start gap-3">
                <img src="${m.image_url || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=100'}" class="w-12 h-12 rounded-xl object-cover border border-slate-700 shrink-0">
                <div>
                    <h4 class="font-bold text-white text-xs group-hover:text-orange-400 transition leading-snug">${m.name}</h4>
                    <span class="text-[10px] text-slate-400">${m.category}</span>
                </div>
            </div>
            <div class="mt-3 pt-2 border-t border-slate-700/60 flex items-center justify-between">
                <span class="text-xs font-black text-emerald-400">${formatCurrency(m.selling_price)}</span>
                <span class="w-6 h-6 rounded-lg bg-orange-600/20 text-orange-400 flex items-center justify-center text-xs group-hover:bg-orange-600 group-hover:text-white transition">
                    <i class="fa-solid fa-plus"></i>
                </span>
            </div>
        </div>
    `).join('');
}

function addToPosCart(menuItemId) {
    const menuItem = state.menuItems.find(m => m.id === menuItemId);
    if (!menuItem) return;

    const existing = state.posCart.find(c => c.menuItem.id === menuItemId);
    if (existing) {
        existing.quantity += 1;
    } else {
        state.posCart.push({ menuItem, quantity: 1 });
    }
    renderPosCart();
}

function updatePosCartQty(menuItemId, delta) {
    const idx = state.posCart.findIndex(c => c.menuItem.id === menuItemId);
    if (idx >= 0) {
        state.posCart[idx].quantity += delta;
        if (state.posCart[idx].quantity <= 0) {
            state.posCart.splice(idx, 1);
        }
    }
    renderPosCart();
}

function clearPosCart() {
    state.posCart = [];
    renderPosCart();
}

function renderPosCart() {
    const container = document.getElementById('pos-cart-items');
    if (state.posCart.length === 0) {
        container.innerHTML = `
            <div class="text-center py-10 text-slate-500 text-xs">
                <i class="fa-solid fa-basket-shopping text-2xl mb-2 text-slate-600 block"></i>
                Sepetiniz boş. Soldaki menüden ürün seçin.
            </div>`;
        document.getElementById('pos-subtotal').textContent = '₺0,00';
        document.getElementById('pos-total').textContent = '₺0,00';
        return;
    }

    let total = 0;
    container.innerHTML = state.posCart.map(c => {
        const lineTotal = c.quantity * c.menuItem.selling_price;
        total += lineTotal;
        return `
        <div class="flex items-center justify-between p-2 rounded-xl bg-slate-900 border border-slate-700 text-xs">
            <div class="flex-1 pr-2">
                <div class="font-bold text-slate-200">${c.menuItem.name}</div>
                <div class="text-[10px] text-slate-400">${formatCurrency(c.menuItem.selling_price)} / adet</div>
            </div>
            <div class="flex items-center gap-1.5">
                <button onclick="updatePosCartQty(${c.menuItem.id}, -1)" class="w-6 h-6 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 flex items-center justify-center font-bold">-</button>
                <span class="w-6 text-center font-bold text-white">${c.quantity}</span>
                <button onclick="updatePosCartQty(${c.menuItem.id}, 1)" class="w-6 h-6 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 flex items-center justify-center font-bold">+</button>
            </div>
            <div class="w-16 text-right font-black text-emerald-400">
                ${formatCurrency(lineTotal)}
            </div>
        </div>`;
    }).join('');

    document.getElementById('pos-subtotal').textContent = formatCurrency(total);
    document.getElementById('pos-total').textContent = formatCurrency(total);
}

async function submitPosOrder() {
    if (state.posCart.length === 0) {
        showToast('Lütfen sepete en az bir ürün ekleyin.', 'error');
        return;
    }

    const table = document.getElementById('pos-table-select').value;
    const items = state.posCart.map(c => ({
        menu_item_id: c.menuItem.id,
        quantity: c.quantity,
        unit_selling_price: c.menuItem.selling_price
    }));

    const payload = {
        source: table,
        status: 'completed',
        items
    };

    try {
        const res = await fetch('/api/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const json = await res.json();
        if (json.success) {
            // Trigger trg_order_item_backflush ran!
            showToast(`Sipariş ${json.order_no} tamamlandı! Reçeteye göre hammaddeler stoktan otomatik düşüldü (Backflushing).`, 'success', 5000);
            clearPosCart();
            await loadIngredients();
            loadDashboard();
        } else {
            showToast(json.error || 'Sipariş tamamlanamadı', 'error');
        }
    } catch (err) {
        showToast('Bağlantı hatası', 'error');
    }
}

// -----------------------------------------------------------------------------
// 6. WASTE & FIRE TAKİBİ
// -----------------------------------------------------------------------------
async function loadWasteLogs() {
    try {
        const res = await fetch('/api/waste');
        const json = await res.json();
        if (!json.success) return;

        state.wasteLogs = json.data;
        renderWasteTable(state.wasteLogs);
    } catch (err) {
        console.error('Error loading waste:', err);
    }
}

function renderWasteTable(logs) {
    const tbody = document.getElementById('waste-tbody');
    if (!logs || logs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="py-6 text-center text-slate-500">Kayıtlı zayiat / fire bulunamadı.</td></tr>`;
        return;
    }

    tbody.innerHTML = logs.map(l => `
        <tr class="hover:bg-slate-700/40 transition">
            <td class="py-3 px-4 font-mono text-slate-500">${l.id}</td>
            <td class="py-3 px-4 font-bold text-slate-200">${l.ingredient_name}</td>
            <td class="py-3 px-4 font-bold text-rose-400">${l.quantity} ${l.unit}</td>
            <td class="py-3 px-4 text-slate-400">${formatCurrency(l.last_unit_price)}</td>
            <td class="py-3 px-4 font-black text-rose-300">${formatCurrency(l.waste_cost)}</td>
            <td class="py-3 px-4 text-slate-300">${l.reason}</td>
            <td class="py-3 px-4 text-slate-400">${formatDate(l.created_at)}</td>
            <td class="py-3 px-4 text-right">
                <button onclick="deleteWaste(${l.id})" class="p-1.5 text-rose-400 hover:text-white hover:bg-rose-600/30 rounded-lg transition" title="Sil ve Stoğa İade Et">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

function openWasteModal() {
    document.getElementById('form-waste').reset();
    const select = document.getElementById('waste-ing-select');
    select.innerHTML = state.ingredients.map(i => `
        <option value="${i.id}">
            ${i.name} (Mevcut: ${i.current_stock} ${i.unit})
        </option>
    `).join('');
    openModal('modal-waste');
}

async function handleSaveWaste(e) {
    e.preventDefault();
    const payload = {
        ingredient_id: parseInt(document.getElementById('waste-ing-select').value),
        quantity: parseFloat(document.getElementById('waste-qty').value),
        reason: document.getElementById('waste-reason').value
    };

    try {
        const res = await fetch('/api/waste', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const json = await res.json();
        if (json.success) {
            closeModal('modal-waste');
            showToast('Zayiat kaydedildi ve stoktan düşüldü.', 'success');
            await loadWasteLogs();
            await loadIngredients();
            loadDashboard();
        } else {
            showToast(json.error || 'Hata oluştu', 'error');
        }
    } catch (err) {
        showToast('Hata', 'error');
    }
}

async function deleteWaste(id) {
    if (!confirm('Bu zayiat kaydını silip hammaddeyi stoğa iade etmek istiyor musunuz?')) return;
    try {
        const res = await fetch(`/api/waste/${id}`, { method: 'DELETE' });
        const json = await res.json();
        if (json.success) {
            showToast('Zayiat silindi ve stok geri iade edildi.', 'success');
            await loadWasteLogs();
            await loadIngredients();
            loadDashboard();
        }
    } catch (err) {
        showToast('Hata', 'error');
    }
}

// -----------------------------------------------------------------------------
// 7. STOCK COUNTS & VARIANCE RECONCILIATION (Query D)
// -----------------------------------------------------------------------------
async function loadStockCounts() {
    try {
        // A) Load past counts list
        const resCounts = await fetch('/api/stock-counts');
        const jsonCounts = await resCounts.json();
        if (jsonCounts.success) {
            state.stockCounts = jsonCounts.data;
            renderStockCountsArchive(state.stockCounts);
        }

        // B) Load latest completed variance report (Query D)
        const resVariance = await fetch('/api/reports/variance');
        const jsonVariance = await resVariance.json();
        if (jsonVariance.success) {
            renderVarianceReport(jsonVariance.data);
        }
    } catch (err) {
        console.error('Error loading stock counts:', err);
    }
}

function renderVarianceReport(reportItems) {
    const tbody = document.getElementById('variance-report-tbody');
    const badge = document.getElementById('variance-date-badge');

    if (!reportItems || reportItems.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="py-6 text-center text-slate-500">Henüz onaylanmış fiziki sayım bulunmuyor.</td></tr>`;
        badge.textContent = 'Henüz Sayım Yok';
        return;
    }

    badge.textContent = `Sayım Tarihi: ${formatDate(reportItems[0].count_date)}`;

    tbody.innerHTML = reportItems.map(item => {
        const variance = item.variance_qty; // theoretical - counted
        const isShortage = variance > 0;
        const isSurplus = variance < 0;

        return `
        <tr class="hover:bg-slate-700/30 transition">
            <td class="py-2.5 font-bold text-slate-200">${item.name}</td>
            <td class="py-2.5 text-slate-400 font-mono">${item.unit}</td>
            <td class="py-2.5 text-slate-300">${item.theoretical_qty}</td>
            <td class="py-2.5 font-semibold text-white">${item.physical_qty}</td>
            <td class="py-2.5">
                <span class="font-bold ${isShortage ? 'text-rose-400' : isSurplus ? 'text-blue-400' : 'text-emerald-400'}">
                    ${variance > 0 ? `+${variance}` : variance} ${item.unit}
                    <span class="text-[10px] ml-1 font-normal opacity-80">(${isShortage ? 'Eksik / Fire' : isSurplus ? 'Fazla' : 'Tam'})</span>
                </span>
            </td>
            <td class="py-2.5 text-slate-400">${formatCurrency(item.last_unit_price)}</td>
            <td class="py-2.5 font-black ${isShortage ? 'text-rose-400' : 'text-emerald-400'}">
                ${formatCurrency(item.variance_cost)}
            </td>
            <td class="py-2.5 font-bold ${Math.abs(item.variance_pct || 0) > 5 ? 'text-rose-400' : 'text-slate-300'}">
                %${(item.variance_pct || 0).toFixed(1)}
            </td>
        </tr>`;
    }).join('');
}

function renderStockCountsArchive(counts) {
    const container = document.getElementById('stock-counts-list');
    if (!counts || counts.length === 0) {
        container.innerHTML = `<div class="p-6 text-center text-slate-500 bg-slate-800/40 rounded-xl">Kayıtlı sayım geçmişi bulunamadı.</div>`;
        return;
    }

    container.innerHTML = counts.map(c => `
        <div class="bg-slate-800/60 border border-slate-700/80 rounded-2xl p-4 flex items-center justify-between">
            <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl ${c.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-purple-500/10 text-purple-400'} flex items-center justify-center text-base">
                    <i class="fa-solid fa-clipboard-check"></i>
                </div>
                <div>
                    <h4 class="font-bold text-white text-xs">${c.notes || 'Periyodik Mutfak Sayımı'}</h4>
                    <span class="text-[10px] text-slate-400">${formatDate(c.count_date)} • ${c.item_count} Kalem Sayıldı</span>
                </div>
            </div>
            <div class="text-right">
                <span class="text-[10px] px-2 py-0.5 rounded-full font-bold ${c.status === 'completed' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-300'}">
                    ${c.status === 'completed' ? 'Onaylandı (Stoklar Eşitlendi)' : 'Taslak'}
                </span>
                <div class="text-xs font-bold text-slate-300 mt-1">
                    Toplam Sapma: <span class="text-rose-400">${formatCurrency(c.total_variance_cost || 0)}</span>
                </div>
            </div>
        </div>
    `).join('');
}

async function startNewStockCountSession() {
    try {
        // Create draft stock count
        const res = await fetch('/api/stock-counts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ notes: `Haftalık Sayım - ${new Date().toLocaleDateString('tr-TR')}` })
        });
        const json = await res.json();
        if (!json.success) {
            showToast('Sayım oturumu açılamadı', 'error');
            return;
        }

        state.currentCountSessionId = json.stock_count_id;
        openCountSessionModal();
    } catch (err) {
        showToast('Hata', 'error');
    }
}

function openCountSessionModal() {
    const tbody = document.getElementById('count-session-tbody');
    tbody.innerHTML = state.ingredients.map(i => `
        <tr data-ing-id="${i.id}" data-price="${i.last_unit_price}" data-theoretical="${i.current_stock}" class="hover:bg-slate-700/30">
            <td class="py-2 px-3 font-bold text-slate-200">${i.name}</td>
            <td class="py-2 px-3 text-slate-400 font-mono">${i.unit}</td>
            <td class="py-2 px-3 text-slate-300 font-bold">${i.current_stock}</td>
            <td class="py-2 px-3">
                <input type="number" step="0.001" class="counted-qty-input w-28 px-2 py-1 bg-slate-900 border border-slate-700 rounded-lg text-white font-bold text-xs focus:outline-none focus:border-purple-500" value="${i.current_stock}" oninput="recalculateCountSessionRow(this)">
            </td>
            <td class="py-2 px-3 font-bold text-slate-300 row-variance-qty">0.000</td>
            <td class="py-2 px-3 font-bold text-slate-300 row-variance-cost">₺0,00</td>
        </tr>
    `).join('');

    recalculateCountSessionTotal();
    openModal('modal-count-session');
}

function recalculateCountSessionRow(inputEl) {
    const tr = inputEl.closest('tr');
    const theoretical = parseFloat(tr.getAttribute('data-theoretical') || 0);
    const price = parseFloat(tr.getAttribute('data-price') || 0);
    const counted = parseFloat(inputEl.value || 0);

    const variance = Math.round((theoretical - counted) * 1000) / 1000;
    const cost = Math.round((variance * price) * 100) / 100;

    const varLabel = tr.querySelector('.row-variance-qty');
    const costLabel = tr.querySelector('.row-variance-cost');

    varLabel.textContent = variance > 0 ? `+${variance}` : `${variance}`;
    costLabel.textContent = formatCurrency(cost);

    if (variance > 0) {
        varLabel.className = 'py-2 px-3 font-bold text-rose-400 row-variance-qty';
        costLabel.className = 'py-2 px-3 font-bold text-rose-400 row-variance-cost';
    } else if (variance < 0) {
        varLabel.className = 'py-2 px-3 font-bold text-blue-400 row-variance-qty';
        costLabel.className = 'py-2 px-3 font-bold text-blue-400 row-variance-cost';
    } else {
        varLabel.className = 'py-2 px-3 font-bold text-emerald-400 row-variance-qty';
        costLabel.className = 'py-2 px-3 font-bold text-emerald-400 row-variance-cost';
    }

    recalculateCountSessionTotal();
}

function recalculateCountSessionTotal() {
    let totalCost = 0;
    const rows = document.querySelectorAll('#count-session-tbody tr');
    rows.forEach(tr => {
        const theoretical = parseFloat(tr.getAttribute('data-theoretical') || 0);
        const price = parseFloat(tr.getAttribute('data-price') || 0);
        const counted = parseFloat(tr.querySelector('.counted-qty-input').value || 0);
        const variance = theoretical - counted;
        totalCost += (variance * price);
    });
    document.getElementById('session-total-variance-cost').textContent = formatCurrency(totalCost);
}

async function submitCompletedStockCount() {
    if (!state.currentCountSessionId) return;

    const rows = document.querySelectorAll('#count-session-tbody tr');
    const items = [];

    rows.forEach(tr => {
        const ingredient_id = parseInt(tr.getAttribute('data-ing-id'));
        const counted_qty = parseFloat(tr.querySelector('.counted-qty-input').value || 0);
        items.push({ ingredient_id, counted_qty });
    });

    try {
        const res = await fetch(`/api/stock-counts/${state.currentCountSessionId}/complete`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items })
        });
        const json = await res.json();
        if (json.success) {
            closeModal('modal-count-session');
            showToast('Fiziki sayım onaylandı ve hammadde stokları başarıyla eşitlendi!', 'success');
            await loadStockCounts();
            await loadIngredients();
            loadDashboard();
        } else {
            showToast(json.error || 'Sayım uygulanamadı', 'error');
        }
    } catch (err) {
        showToast('Hata', 'error');
    }
}

// -----------------------------------------------------------------------------
// MODAL & UTILITY FUNCTIONS
// -----------------------------------------------------------------------------
function openModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('hidden');
}

function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
}

function formatCurrency(val) {
    if (val == null || isNaN(val)) return '₺0,00';
    return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(val);
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function showToast(message, type = 'info', duration = 3500) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast-item flex items-center gap-3 px-4 py-3 rounded-2xl shadow-2xl border text-xs font-semibold backdrop-blur ${
        type === 'success' ? 'bg-emerald-950/90 text-emerald-200 border-emerald-500/50' :
        type === 'error' ? 'bg-rose-950/90 text-rose-200 border-rose-500/50' :
        'bg-slate-900/90 text-slate-200 border-slate-700'
    }`;

    const icon = type === 'success' ? 'fa-circle-check text-emerald-400' :
                 type === 'error' ? 'fa-triangle-exclamation text-rose-400' :
                 'fa-circle-info text-blue-400';

    toast.innerHTML = `<i class="fa-solid ${icon} text-base"></i><span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}
