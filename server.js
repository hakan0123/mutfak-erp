const express = require('express');
const path = require('node:path');
const { db, initDatabase } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize database
initDatabase();

// =============================================================================
// API ROUTES
// =============================================================================

// -----------------------------------------------------------------------------
// 1. DASHBOARD & KPIS
// -----------------------------------------------------------------------------
app.get('/api/dashboard', (req, res) => {
    try {
        // A) Food Cost % & Sales Summary (Query B - last 30 days or all-time)
        const foodCostData = db.prepare(`
            SELECT
                ROUND(COALESCE(kitchen_cost, 0), 2) AS total_kitchen_cost,
                ROUND(COALESCE(sales_revenue, 0), 2) AS total_sales_revenue,
                ROUND(
                    100.0 * COALESCE(kitchen_cost, 0) / NULLIF(sales_revenue, 0), 2
                ) AS food_cost_pct
            FROM (
                SELECT
                    (
                        SELECT SUM(
                            oi.quantity * r.quantity
                            * (1.0 + COALESCE(r.unit_waste_rate, 0) / 100.0)
                            * i.last_unit_price
                        )
                        FROM orders o
                        JOIN order_items oi ON oi.order_id = o.id
                        JOIN recipes r ON r.menu_item_id = oi.menu_item_id
                        JOIN ingredients i ON i.id = r.ingredient_id
                        WHERE o.status = 'completed'
                    ) AS kitchen_cost,
                    (
                        SELECT SUM(oi.quantity * oi.unit_selling_price)
                        FROM orders o
                        JOIN order_items oi ON oi.order_id = o.id
                        WHERE o.status = 'completed'
                    ) AS sales_revenue
            );
        `).get();

        // B) Inventory Valuation
        const inventoryValuation = db.prepare(`
            SELECT 
                ROUND(SUM(current_stock * last_unit_price), 2) AS total_inventory_value,
                COUNT(*) AS total_ingredients_count
            FROM ingredients;
        `).get();

        // C) Critical Stock Count & Items (Query C)
        const criticalStocks = db.prepare(`
            SELECT
                id,
                name,
                unit,
                ROUND(current_stock, 3) AS current_stock,
                ROUND(min_stock_level, 3) AS min_stock_level,
                last_unit_price,
                ROUND(min_stock_level - current_stock, 3) AS shortage_qty
            FROM ingredients
            WHERE current_stock <= min_stock_level
            ORDER BY (current_stock / NULLIF(min_stock_level, 0)) ASC;
        `).all();

        // D) Recent Orders
        const recentOrders = db.prepare(`
            SELECT 
                o.id,
                o.order_no,
                o.order_date,
                o.status,
                o.total_amount,
                o.source,
                COUNT(oi.id) AS item_count
            FROM orders o
            LEFT JOIN order_items oi ON oi.order_id = o.id
            GROUP BY o.id
            ORDER BY o.order_date DESC
            LIMIT 5;
        `).all();

        // E) Recent Waste
        const recentWaste = db.prepare(`
            SELECT 
                w.id,
                w.quantity,
                w.reason,
                w.created_at,
                i.name AS ingredient_name,
                i.unit,
                ROUND(w.quantity * i.last_unit_price, 2) AS waste_cost
            FROM waste_logs w
            JOIN ingredients i ON i.id = w.ingredient_id
            ORDER BY w.created_at DESC
            LIMIT 5;
        `).all();

        // F) Sales Category Distribution
        const categoryData = db.prepare(`
            SELECT 
                mi.category,
                ROUND(SUM(oi.line_total), 2) AS total_revenue,
                SUM(oi.quantity) AS total_quantity
            FROM order_items oi
            JOIN orders o ON o.id = oi.order_id
            JOIN menu_items mi ON mi.id = oi.menu_item_id
            WHERE o.status = 'completed'
            GROUP BY mi.category;
        `).all();

        // G) Latest Stock Count Variance
        const latestVariance = db.prepare(`
            SELECT
                ROUND(SUM(sci.variance_qty * i.last_unit_price), 2) AS total_variance_cost,
                COUNT(sci.id) AS counted_items_count
            FROM stock_counts sc
            JOIN stock_count_items sci ON sci.stock_count_id = sc.id
            JOIN ingredients i ON i.id = sci.ingredient_id
            WHERE sc.status = 'completed'
              AND sc.id = (SELECT id FROM stock_counts WHERE status = 'completed' ORDER BY count_date DESC LIMIT 1);
        `).get();

        res.json({
            success: true,
            data: {
                total_sales_revenue: foodCostData?.total_sales_revenue || 0,
                total_kitchen_cost: foodCostData?.total_kitchen_cost || 0,
                food_cost_pct: foodCostData?.food_cost_pct || 0,
                target_food_cost_range: { min: 28.0, max: 35.0 },
                gross_profit: Math.round(((foodCostData?.total_sales_revenue || 0) - (foodCostData?.total_kitchen_cost || 0)) * 100) / 100,
                gross_profit_margin_pct: foodCostData?.total_sales_revenue ? 
                    Math.round((((foodCostData.total_sales_revenue - foodCostData.total_kitchen_cost) / foodCostData.total_sales_revenue) * 100) * 100) / 100 : 0,
                total_inventory_value: inventoryValuation?.total_inventory_value || 0,
                total_ingredients_count: inventoryValuation?.total_ingredients_count || 0,
                critical_stock_count: criticalStocks.length,
                critical_stocks: criticalStocks,
                recent_orders: recentOrders,
                recent_waste: recentWaste,
                category_distribution: categoryData,
                latest_variance: latestVariance || { total_variance_cost: 0, counted_items_count: 0 }
            }
        });
    } catch (err) {
        console.error('Error fetching dashboard data:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// -----------------------------------------------------------------------------
// 2. INGREDIENTS (Hammaddeler / Stok Kalemleri)
// -----------------------------------------------------------------------------
app.get('/api/ingredients', (req, res) => {
    try {
        const ingredients = db.prepare(`
            SELECT 
                id,
                name,
                unit,
                last_unit_price,
                ROUND(current_stock, 3) AS current_stock,
                ROUND(min_stock_level, 3) AS min_stock_level,
                ROUND(current_stock * last_unit_price, 2) AS total_inventory_value,
                CASE 
                    WHEN current_stock <= min_stock_level THEN 1
                    ELSE 0
                END AS is_critical
            FROM ingredients
            ORDER BY name ASC;
        `).all();
        res.json({ success: true, data: ingredients });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/ingredients', (req, res) => {
    try {
        const { name, unit, last_unit_price, current_stock, min_stock_level } = req.body;
        if (!name || !unit || last_unit_price == null) {
            return res.status(400).json({ success: false, error: 'İsim, birim ve birim fiyat zorunludur.' });
        }
        const stmt = db.prepare(`
            INSERT INTO ingredients (name, unit, last_unit_price, current_stock, min_stock_level)
            VALUES (?, ?, ?, ?, ?)
        `);
        const result = stmt.run(name, unit, Number(last_unit_price), Number(current_stock || 0), Number(min_stock_level || 0));
        res.json({ success: true, id: result.lastInsertRowid });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.put('/api/ingredients/:id', (req, res) => {
    try {
        const { name, unit, last_unit_price, current_stock, min_stock_level } = req.body;
        const stmt = db.prepare(`
            UPDATE ingredients
            SET name = ?, unit = ?, last_unit_price = ?, current_stock = ?, min_stock_level = ?
            WHERE id = ?
        `);
        stmt.run(name, unit, Number(last_unit_price), Number(current_stock), Number(min_stock_level), req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/ingredients/:id', (req, res) => {
    try {
        // Check if used in recipes
        const usedInRecipe = db.prepare('SELECT COUNT(*) AS count FROM recipes WHERE ingredient_id = ?').get(req.params.id);
        if (usedInRecipe.count > 0) {
            return res.status(400).json({ success: false, error: 'Bu hammadde bir veya daha fazla reçetede kullanıldığı için silinemez.' });
        }
        db.prepare('DELETE FROM ingredients WHERE id = ?').run(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// -----------------------------------------------------------------------------
// 3. MENU ITEMS & RECIPES (Menü Ürünleri & Reçeteler - Query A)
// -----------------------------------------------------------------------------
app.get('/api/menu-items', (req, res) => {
    try {
        // Query A: Menu Item Unit Cost + Profit Margin + Food Cost %
        const menuItems = db.prepare(`
            SELECT
                mi.id,
                mi.name,
                mi.selling_price,
                mi.category,
                mi.image_url,
                COUNT(r.id) AS recipe_item_count,
                ROUND(COALESCE(SUM(
                    r.quantity * (1.0 + COALESCE(r.unit_waste_rate, 0) / 100.0) * i.last_unit_price
                ), 0), 2) AS unit_cost,
                ROUND(
                    mi.selling_price - COALESCE(SUM(
                        r.quantity * (1.0 + COALESCE(r.unit_waste_rate, 0) / 100.0) * i.last_unit_price
                    ), 0), 2
                ) AS profit_amount,
                ROUND(
                    100.0 * (
                        mi.selling_price - COALESCE(SUM(
                            r.quantity * (1.0 + COALESCE(r.unit_waste_rate, 0) / 100.0) * i.last_unit_price
                        ), 0)
                    ) / NULLIF(mi.selling_price, 0), 2
                ) AS profit_margin_pct,
                ROUND(
                    100.0 * COALESCE(SUM(
                        r.quantity * (1.0 + COALESCE(r.unit_waste_rate, 0) / 100.0) * i.last_unit_price
                    ), 0) / NULLIF(mi.selling_price, 0), 2
                ) AS food_cost_pct_item
            FROM menu_items mi
            LEFT JOIN recipes r ON r.menu_item_id = mi.id
            LEFT JOIN ingredients i ON i.id = r.ingredient_id
            GROUP BY mi.id, mi.name, mi.selling_price, mi.category, mi.image_url
            ORDER BY mi.category, mi.name;
        `).all();
        res.json({ success: true, data: menuItems });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/menu-items', (req, res) => {
    try {
        const { name, selling_price, category, image_url } = req.body;
        if (!name || selling_price == null || !category) {
            return res.status(400).json({ success: false, error: 'Ürün adı, satış fiyatı ve kategori zorunludur.' });
        }
        const stmt = db.prepare(`
            INSERT INTO menu_items (name, selling_price, category, image_url)
            VALUES (?, ?, ?, ?)
        `);
        const result = stmt.run(name, Number(selling_price), category, image_url || '');
        res.json({ success: true, id: result.lastInsertRowid });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.put('/api/menu-items/:id', (req, res) => {
    try {
        const { name, selling_price, category, image_url } = req.body;
        db.prepare(`
            UPDATE menu_items
            SET name = ?, selling_price = ?, category = ?, image_url = ?
            WHERE id = ?
        `).run(name, Number(selling_price), category, image_url || '', req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/menu-items/:id', (req, res) => {
    try {
        db.prepare('DELETE FROM menu_items WHERE id = ?').run(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Reçete Detayları
app.get('/api/menu-items/:id/recipe', (req, res) => {
    try {
        const recipeItems = db.prepare(`
            SELECT 
                r.id,
                r.menu_item_id,
                r.ingredient_id,
                i.name AS ingredient_name,
                i.unit,
                i.last_unit_price,
                r.quantity,
                r.unit_waste_rate,
                ROUND(r.quantity * (1.0 + COALESCE(r.unit_waste_rate, 0) / 100.0), 4) AS gross_quantity,
                ROUND(r.quantity * (1.0 + COALESCE(r.unit_waste_rate, 0) / 100.0) * i.last_unit_price, 2) AS item_cost
            FROM recipes r
            JOIN ingredients i ON i.id = r.ingredient_id
            WHERE r.menu_item_id = ?
            ORDER BY r.id ASC;
        `).all(req.params.id);
        res.json({ success: true, data: recipeItems });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/menu-items/:id/recipe', (req, res) => {
    try {
        const menuItemId = req.params.id;
        const { items } = req.body; // array of { ingredient_id, quantity, unit_waste_rate }
        
        db.exec('BEGIN TRANSACTION;');
        try {
            db.prepare('DELETE FROM recipes WHERE menu_item_id = ?').run(menuItemId);
            const insertStmt = db.prepare(`
                INSERT INTO recipes (menu_item_id, ingredient_id, quantity, unit_waste_rate)
                VALUES (?, ?, ?, ?)
            `);
            if (Array.isArray(items)) {
                for (const it of items) {
                    if (it.ingredient_id && it.quantity > 0) {
                        insertStmt.run(menuItemId, it.ingredient_id, Number(it.quantity), Number(it.unit_waste_rate || 0));
                    }
                }
            }
            db.exec('COMMIT;');
            res.json({ success: true });
        } catch (e) {
            db.exec('ROLLBACK;');
            throw e;
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// -----------------------------------------------------------------------------
// 4. PURCHASES (Satın Alma & Stok Girişi)
// -----------------------------------------------------------------------------
app.get('/api/purchases', (req, res) => {
    try {
        const purchases = db.prepare(`
            SELECT 
                p.id,
                p.supplier_name,
                p.invoice_no,
                p.purchase_date,
                p.total_amount,
                p.notes,
                COUNT(pi.id) AS item_count
            FROM purchases p
            LEFT JOIN purchase_items pi ON pi.purchase_id = p.id
            GROUP BY p.id
            ORDER BY p.purchase_date DESC;
        `).all();

        // Also fetch items for each purchase
        const getItems = db.prepare(`
            SELECT 
                pi.id,
                pi.purchase_id,
                pi.ingredient_id,
                i.name AS ingredient_name,
                i.unit,
                pi.quantity,
                pi.unit_price,
                pi.line_total
            FROM purchase_items pi
            JOIN ingredients i ON i.id = pi.ingredient_id
            WHERE pi.purchase_id = ?;
        `);

        for (const p of purchases) {
            p.items = getItems.all(p.id);
        }

        res.json({ success: true, data: purchases });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/purchases', (req, res) => {
    try {
        const { supplier_name, invoice_no, purchase_date, notes, items } = req.body;
        if (!items || items.length === 0) {
            return res.status(400).json({ success: false, error: 'En az bir alış kalemi gereklidir.' });
        }

        db.exec('BEGIN TRANSACTION;');
        try {
            const pStmt = db.prepare(`
                INSERT INTO purchases (supplier_name, invoice_no, purchase_date, notes)
                VALUES (?, ?, COALESCE(?, datetime('now')), ?)
            `);
            const pRes = pStmt.run(supplier_name || 'Genel Tedarikçi', invoice_no || `FAT-${Date.now()}`, purchase_date || null, notes || '');
            const purchaseId = pRes.lastInsertRowid;

            const itemStmt = db.prepare(`
                INSERT INTO purchase_items (purchase_id, ingredient_id, quantity, unit_price)
                VALUES (?, ?, ?, ?)
            `);

            for (const it of items) {
                // Triggers automatically increment ingredients.current_stock & last_unit_price
                // and update purchases.total_amount!
                itemStmt.run(purchaseId, it.ingredient_id, Number(it.quantity), Number(it.unit_price));
            }

            db.exec('COMMIT;');
            res.json({ success: true, purchase_id: purchaseId });
        } catch (e) {
            db.exec('ROLLBACK;');
            throw e;
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// -----------------------------------------------------------------------------
// 5. ORDERS & POS (Siparişler & Backflushing)
// -----------------------------------------------------------------------------
app.get('/api/orders', (req, res) => {
    try {
        const orders = db.prepare(`
            SELECT 
                o.id,
                o.order_no,
                o.order_date,
                o.status,
                o.total_amount,
                o.source
            FROM orders o
            ORDER BY o.order_date DESC;
        `).all();

        const getItems = db.prepare(`
            SELECT 
                oi.id,
                oi.order_id,
                oi.menu_item_id,
                mi.name AS menu_item_name,
                oi.quantity,
                oi.unit_selling_price,
                oi.line_total
            FROM order_items oi
            JOIN menu_items mi ON mi.id = oi.menu_item_id
            WHERE oi.order_id = ?;
        `);

        for (const o of orders) {
            o.items = getItems.all(o.id);
        }

        res.json({ success: true, data: orders });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/orders', (req, res) => {
    try {
        const { order_no, source, status, items } = req.body;
        if (!items || items.length === 0) {
            return res.status(400).json({ success: false, error: 'Siparişte en az bir ürün bulunmalıdır.' });
        }

        db.exec('BEGIN TRANSACTION;');
        try {
            const orderStatus = status || 'completed';
            const oStmt = db.prepare(`
                INSERT INTO orders (order_no, status, source)
                VALUES (?, ?, ?)
            `);
            const generatedNo = order_no || `POS-${Math.floor(1000 + Math.random() * 9000)}`;
            const oRes = oStmt.run(generatedNo, orderStatus, source || 'POS');
            const orderId = oRes.lastInsertRowid;

            const itemStmt = db.prepare(`
                INSERT INTO order_items (order_id, menu_item_id, quantity, unit_selling_price)
                VALUES (?, ?, ?, ?)
            `);

            for (const it of items) {
                // If order status is completed, trg_order_item_backflush automatically drops stock!
                itemStmt.run(orderId, it.menu_item_id, Number(it.quantity), Number(it.unit_selling_price));
            }

            db.exec('COMMIT;');
            res.json({ success: true, order_id: orderId, order_no: generatedNo });
        } catch (e) {
            db.exec('ROLLBACK;');
            throw e;
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.put('/api/orders/:id/status', (req, res) => {
    try {
        const { status } = req.body;
        // Triggers handle backflushing if completed, or restock if cancelled!
        db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// -----------------------------------------------------------------------------
// 6. WASTE LOGS (Zayiat & Fire)
// -----------------------------------------------------------------------------
app.get('/api/waste', (req, res) => {
    try {
        const logs = db.prepare(`
            SELECT 
                w.id,
                w.ingredient_id,
                i.name AS ingredient_name,
                i.unit,
                i.last_unit_price,
                ROUND(w.quantity, 3) AS quantity,
                ROUND(w.quantity * i.last_unit_price, 2) AS waste_cost,
                w.reason,
                w.created_at
            FROM waste_logs w
            JOIN ingredients i ON i.id = w.ingredient_id
            ORDER BY w.created_at DESC;
        `).all();
        res.json({ success: true, data: logs });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/waste', (req, res) => {
    try {
        const { ingredient_id, quantity, reason } = req.body;
        if (!ingredient_id || !quantity) {
            return res.status(400).json({ success: false, error: 'Hammadde ve miktar zorunludur.' });
        }
        // trg_waste_stock_out drops stock automatically
        const stmt = db.prepare(`
            INSERT INTO waste_logs (ingredient_id, quantity, reason)
            VALUES (?, ?, ?)
        `);
        const resObj = stmt.run(ingredient_id, Number(quantity), reason || 'Belirtilmedi');
        res.json({ success: true, id: resObj.lastInsertRowid });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/waste/:id', (req, res) => {
    try {
        // trg_waste_stock_restore restores stock automatically
        db.prepare('DELETE FROM waste_logs WHERE id = ?').run(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// -----------------------------------------------------------------------------
// 7. STOCK COUNTS & VARIANCE RECONCILIATION (Fiziki Sayım & Sapma Analizi)
// -----------------------------------------------------------------------------
app.get('/api/stock-counts', (req, res) => {
    try {
        const counts = db.prepare(`
            SELECT 
                sc.id,
                sc.count_date,
                sc.status,
                sc.notes,
                COUNT(sci.id) AS item_count,
                ROUND(SUM(sci.variance_qty * i.last_unit_price), 2) AS total_variance_cost
            FROM stock_counts sc
            LEFT JOIN stock_count_items sci ON sci.stock_count_id = sc.id
            LEFT JOIN ingredients i ON i.id = sci.ingredient_id
            GROUP BY sc.id
            ORDER BY sc.count_date DESC;
        `).all();

        const getItems = db.prepare(`
            SELECT 
                sci.id,
                sci.stock_count_id,
                sci.ingredient_id,
                i.name AS ingredient_name,
                i.unit,
                i.last_unit_price,
                ROUND(sci.theoretical_qty, 3) AS theoretical_qty,
                ROUND(sci.counted_qty, 3) AS counted_qty,
                ROUND(sci.variance_qty, 3) AS variance_qty,
                ROUND(sci.variance_qty * i.last_unit_price, 2) AS variance_cost,
                ROUND(100.0 * sci.variance_qty / NULLIF(sci.theoretical_qty, 0), 2) AS variance_pct
            FROM stock_count_items sci
            JOIN ingredients i ON i.id = sci.ingredient_id
            WHERE sci.stock_count_id = ?
            ORDER BY ABS(sci.variance_qty * i.last_unit_price) DESC;
        `);

        for (const c of counts) {
            c.items = getItems.all(c.id);
        }

        res.json({ success: true, data: counts });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Start a new physical count sheet (populates theoretical stock from current_stock)
app.post('/api/stock-counts', (req, res) => {
    try {
        const { notes, items } = req.body;

        db.exec('BEGIN TRANSACTION;');
        try {
            const scStmt = db.prepare(`
                INSERT INTO stock_counts (status, notes)
                VALUES ('draft', ?)
            `);
            const scRes = scStmt.run(notes || 'Haftalık / Aylık Periyodik Sayım');
            const countId = scRes.lastInsertRowid;

            const itemStmt = db.prepare(`
                INSERT INTO stock_count_items (stock_count_id, ingredient_id, theoretical_qty, counted_qty)
                VALUES (?, ?, ?, ?)
            `);

            // If user supplied specific counts, use them; otherwise populate all ingredients with current theoretical stock
            if (Array.isArray(items) && items.length > 0) {
                for (const it of items) {
                    itemStmt.run(countId, it.ingredient_id, Number(it.theoretical_qty), Number(it.counted_qty));
                }
            } else {
                const ingredients = db.prepare('SELECT id, current_stock FROM ingredients').all();
                for (const ing of ingredients) {
                    itemStmt.run(countId, ing.id, Number(ing.current_stock), Number(ing.current_stock));
                }
            }

            db.exec('COMMIT;');
            res.json({ success: true, stock_count_id: countId });
        } catch (e) {
            db.exec('ROLLBACK;');
            throw e;
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Complete and apply stock count (triggers trg_stock_count_apply which sets current_stock = counted_qty)
app.put('/api/stock-counts/:id/complete', (req, res) => {
    try {
        const countId = req.params.id;
        const { items } = req.body;

        db.exec('BEGIN TRANSACTION;');
        try {
            // Update items if supplied
            if (Array.isArray(items)) {
                const updateItem = db.prepare(`
                    UPDATE stock_count_items
                    SET counted_qty = ?
                    WHERE stock_count_id = ? AND ingredient_id = ?
                `);
                for (const it of items) {
                    updateItem.run(Number(it.counted_qty), countId, it.ingredient_id);
                }
            }

            // Update status to completed -> Fires trg_stock_count_apply trigger!
            db.prepare(`UPDATE stock_counts SET status = 'completed' WHERE id = ?`).run(countId);

            db.exec('COMMIT;');
            res.json({ success: true, message: 'Fiziki sayım onaylandı ve hammadde stokları güncellendi.' });
        } catch (e) {
            db.exec('ROLLBACK;');
            throw e;
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// -----------------------------------------------------------------------------
// 8. REPORTS: Query D (Variance Analysis) & Menu Matrix
// -----------------------------------------------------------------------------
app.get('/api/reports/variance', (req, res) => {
    try {
        // Query D implementation
        const varianceReport = db.prepare(`
            WITH latest_count AS (
                SELECT sc.id AS stock_count_id, sc.count_date
                FROM stock_counts sc
                WHERE sc.status = 'completed'
                ORDER BY sc.count_date DESC
                LIMIT 1
            )
            SELECT
                i.id AS ingredient_id,
                i.name,
                i.unit,
                ROUND(sci.theoretical_qty, 3) AS theoretical_qty,
                ROUND(sci.counted_qty, 3) AS physical_qty,
                ROUND(sci.variance_qty, 3) AS variance_qty,
                ROUND(sci.variance_qty * i.last_unit_price, 2) AS variance_cost,
                ROUND(
                    100.0 * sci.variance_qty / NULLIF(sci.theoretical_qty, 0), 2
                ) AS variance_pct,
                lc.count_date
            FROM latest_count lc
            JOIN stock_count_items sci ON sci.stock_count_id = lc.stock_count_id
            JOIN ingredients i ON i.id = sci.ingredient_id
            ORDER BY ABS(sci.variance_qty * i.last_unit_price) DESC;
        `).all();

        res.json({ success: true, data: varianceReport });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Menu Engineering Matrix (BCG / Menu Matrix: Yıldızlar, Sabanlar, Bilmeceler, Köpekler)
app.get('/api/reports/menu-matrix', (req, res) => {
    try {
        const matrix = db.prepare(`
            SELECT 
                mi.id,
                mi.name,
                mi.category,
                mi.selling_price,
                ROUND(COALESCE(SUM(r.quantity * (1.0 + COALESCE(r.unit_waste_rate, 0) / 100.0) * i.last_unit_price), 0), 2) AS unit_cost,
                ROUND(mi.selling_price - COALESCE(SUM(r.quantity * (1.0 + COALESCE(r.unit_waste_rate, 0) / 100.0) * i.last_unit_price), 0), 2) AS unit_profit,
                COALESCE(sold.qty, 0) AS units_sold,
                ROUND(COALESCE(sold.qty, 0) * (mi.selling_price - COALESCE(SUM(r.quantity * (1.0 + COALESCE(r.unit_waste_rate, 0) / 100.0) * i.last_unit_price), 0)), 2) AS total_profit
            FROM menu_items mi
            LEFT JOIN recipes r ON r.menu_item_id = mi.id
            LEFT JOIN ingredients i ON i.id = r.ingredient_id
            LEFT JOIN (
                SELECT oi.menu_item_id, SUM(oi.quantity) AS qty
                FROM order_items oi
                JOIN orders o ON o.id = oi.order_id
                WHERE o.status = 'completed'
                GROUP BY oi.menu_item_id
            ) sold ON sold.menu_item_id = mi.id
            GROUP BY mi.id;
        `).all();

        res.json({ success: true, data: matrix });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Start Server
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`\n======================================================`);
        console.log(`🚀 Mutfak ERP Sistemi başarıyla başlatıldı!`);
        console.log(`🌐 Localhost Adresi: http://localhost:${PORT}`);
        console.log(`======================================================\n`);
    });
}

module.exports = app;
