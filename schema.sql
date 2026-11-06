-- =============================================================================
-- Mutfak ERP - Düzeltilmiş ve Optimize Edilmiş SQLite Veritabanı Şeması
-- =============================================================================
PRAGMA foreign_keys = ON;

-- -----------------------------------------------------------------------------
-- 1. ingredients (Hammaddeler / Stok Kalemleri)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ingredients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(100) NOT NULL,
    unit VARCHAR(16) NOT NULL,
    last_unit_price DECIMAL(10,2) NOT NULL,
    current_stock DECIMAL(10,3) NOT NULL DEFAULT 0,
    min_stock_level DECIMAL(10,3) NOT NULL DEFAULT 0
);

-- -----------------------------------------------------------------------------
-- 2. menu_items (Satışa Sunulan Menü Ürünleri)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS menu_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(100) NOT NULL,
    selling_price DECIMAL(10,2) NOT NULL,
    category VARCHAR(50) NOT NULL,
    image_url TEXT
);

-- -----------------------------------------------------------------------------
-- 3. recipes (Reçete Detayları - Many-to-Many)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recipes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    menu_item_id INTEGER NOT NULL,
    ingredient_id INTEGER NOT NULL,
    quantity DECIMAL(10,3) NOT NULL,
    unit_waste_rate DECIMAL(5,2) DEFAULT 0,
    FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE,
    FOREIGN KEY (ingredient_id) REFERENCES ingredients(id) ON DELETE CASCADE
);

-- -----------------------------------------------------------------------------
-- 4. waste_logs (Fire / Zayiat Kayıtları)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS waste_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ingredient_id INTEGER NOT NULL,
    quantity DECIMAL(10,3) NOT NULL,
    reason VARCHAR(255),
    logged_by_user_id INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ingredient_id) REFERENCES ingredients(id) ON DELETE CASCADE
);

-- -----------------------------------------------------------------------------
-- 5. purchases & purchase_items (Satın Alma / Stok Girişleri)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_name VARCHAR(100),
    invoice_no VARCHAR(50),
    purchase_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    total_amount DECIMAL(12,2) DEFAULT 0,
    notes TEXT,
    created_by_user_id INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS purchase_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_id INTEGER NOT NULL,
    ingredient_id INTEGER NOT NULL,
    quantity DECIMAL(10,3) NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    line_total DECIMAL(12,2) GENERATED ALWAYS AS (ROUND(quantity * unit_price, 2)) STORED,
    FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE,
    FOREIGN KEY (ingredient_id) REFERENCES ingredients(id) ON DELETE CASCADE
);

-- -----------------------------------------------------------------------------
-- 6. orders & order_items (Satış Kayıtları / POS)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_no VARCHAR(50),
    order_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) NOT NULL DEFAULT 'completed',
    total_amount DECIMAL(12,2) DEFAULT 0,
    source VARCHAR(30) DEFAULT 'POS',
    created_by_user_id INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    menu_item_id INTEGER NOT NULL,
    quantity DECIMAL(10,3) NOT NULL DEFAULT 1,
    unit_selling_price DECIMAL(10,2) NOT NULL,
    line_total DECIMAL(12,2) GENERATED ALWAYS AS (ROUND(quantity * unit_selling_price, 2)) STORED,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE
);

-- -----------------------------------------------------------------------------
-- 7. stock_counts & stock_count_items (Fiziki Stok Sayımları)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_counts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    count_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    counted_by_user_id INTEGER DEFAULT 1,
    status VARCHAR(20) DEFAULT 'draft',
    notes TEXT
);

CREATE TABLE IF NOT EXISTS stock_count_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stock_count_id INTEGER NOT NULL,
    ingredient_id INTEGER NOT NULL,
    theoretical_qty DECIMAL(10,3) NOT NULL,
    counted_qty DECIMAL(10,3) NOT NULL,
    variance_qty DECIMAL(10,3) GENERATED ALWAYS AS (ROUND(theoretical_qty - counted_qty, 3)) STORED,
    FOREIGN KEY (stock_count_id) REFERENCES stock_counts(id) ON DELETE CASCADE,
    FOREIGN KEY (ingredient_id) REFERENCES ingredients(id) ON DELETE CASCADE
);

-- =============================================================================
-- TETİKLEYİCİLER (TRIGGERS)
-- =============================================================================

-- 1. Satın alma kalemi eklendiğinde stok artar + son birim fiyat güncellenir
CREATE TRIGGER IF NOT EXISTS trg_purchase_item_stock_in
AFTER INSERT ON purchase_items
BEGIN
    UPDATE ingredients
    SET
        current_stock = ROUND(current_stock + NEW.quantity, 3),
        last_unit_price = NEW.unit_price
    WHERE id = NEW.ingredient_id;

    UPDATE purchases
    SET total_amount = (
        SELECT COALESCE(SUM(ROUND(quantity * unit_price, 2)), 0)
        FROM purchase_items
        WHERE purchase_id = NEW.purchase_id
    )
    WHERE id = NEW.purchase_id;
END;

-- 2. Sipariş tamamlandığında backflushing: reçeteye göre hammadde düşümü
-- (Fire dahil: quantity × (1 + unit_waste_rate/100) × satılan adet)
CREATE TRIGGER IF NOT EXISTS trg_order_item_backflush
AFTER INSERT ON order_items
WHEN (SELECT status FROM orders WHERE id = NEW.order_id) = 'completed'
BEGIN
    UPDATE ingredients
    SET current_stock = ROUND(current_stock - (
        SELECT COALESCE(SUM(
            r.quantity * (1.0 + COALESCE(r.unit_waste_rate, 0) / 100.0) * NEW.quantity
        ), 0)
        FROM recipes r
        WHERE r.menu_item_id = NEW.menu_item_id
          AND r.ingredient_id = ingredients.id
    ), 3)
    WHERE id IN (
        SELECT ingredient_id FROM recipes WHERE menu_item_id = NEW.menu_item_id
    );

    UPDATE orders
    SET total_amount = (
        SELECT COALESCE(SUM(ROUND(quantity * unit_selling_price, 2)), 0)
        FROM order_items
        WHERE order_id = NEW.order_id
    )
    WHERE id = NEW.order_id;
END;

-- 3. Sipariş status'ü completed'a çekilirse (önce pending kaydedildiyse) stok düş
CREATE TRIGGER IF NOT EXISTS trg_order_completed_backflush
AFTER UPDATE OF status ON orders
WHEN OLD.status != 'completed' AND NEW.status = 'completed'
BEGIN
    UPDATE ingredients
    SET current_stock = ROUND(current_stock - (
        SELECT COALESCE(SUM(
            r.quantity * (1.0 + COALESCE(r.unit_waste_rate, 0) / 100.0) * oi.quantity
        ), 0)
        FROM order_items oi
        JOIN recipes r ON r.menu_item_id = oi.menu_item_id
        WHERE oi.order_id = NEW.id
          AND r.ingredient_id = ingredients.id
    ), 3)
    WHERE id IN (
        SELECT r.ingredient_id
        FROM order_items oi
        JOIN recipes r ON r.menu_item_id = oi.menu_item_id
        WHERE oi.order_id = NEW.id
    );
END;

-- 4. Sipariş iptal edilirse (completed -> cancelled) stokları geri iade et
CREATE TRIGGER IF NOT EXISTS trg_order_cancelled_restock
AFTER UPDATE OF status ON orders
WHEN OLD.status = 'completed' AND NEW.status = 'cancelled'
BEGIN
    UPDATE ingredients
    SET current_stock = ROUND(current_stock + (
        SELECT COALESCE(SUM(
            r.quantity * (1.0 + COALESCE(r.unit_waste_rate, 0) / 100.0) * oi.quantity
        ), 0)
        FROM order_items oi
        JOIN recipes r ON r.menu_item_id = oi.menu_item_id
        WHERE oi.order_id = NEW.id
          AND r.ingredient_id = ingredients.id
    ), 3)
    WHERE id IN (
        SELECT r.ingredient_id
        FROM order_items oi
        JOIN recipes r ON r.menu_item_id = oi.menu_item_id
        WHERE oi.order_id = NEW.id
    );
END;

-- 5. Zayiat kaydı: bozulan/dökülen malzeme stoktan düşer
CREATE TRIGGER IF NOT EXISTS trg_waste_stock_out
AFTER INSERT ON waste_logs
BEGIN
    UPDATE ingredients
    SET current_stock = ROUND(current_stock - NEW.quantity, 3)
    WHERE id = NEW.ingredient_id;
END;

-- 6. Zayiat kaydı silinirse: stok geri iade edilir
CREATE TRIGGER IF NOT EXISTS trg_waste_stock_restore
AFTER DELETE ON waste_logs
BEGIN
    UPDATE ingredients
    SET current_stock = ROUND(current_stock + OLD.quantity, 3)
    WHERE id = OLD.ingredient_id;
END;

-- 7. Fiziki sayım onaylandığında: stok = sayılan miktar (dengeleme)
CREATE TRIGGER IF NOT EXISTS trg_stock_count_apply
AFTER UPDATE OF status ON stock_counts
WHEN OLD.status != 'completed' AND NEW.status = 'completed'
BEGIN
    UPDATE ingredients
    SET current_stock = (
        SELECT sci.counted_qty
        FROM stock_count_items sci
        WHERE sci.stock_count_id = NEW.id
          AND sci.ingredient_id = ingredients.id
    )
    WHERE id IN (
        SELECT ingredient_id FROM stock_count_items WHERE stock_count_id = NEW.id
    );
END;
