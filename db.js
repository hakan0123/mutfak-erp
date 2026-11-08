const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');

const dbPath = path.join(__dirname, 'mutfak_erp.db');
const db = new DatabaseSync(dbPath);

// Enable foreign key constraints
db.exec(`PRAGMA foreign_keys = ON;`);

function initDatabase() {
    // Create tables if not exist
    db.exec(`
    CREATE TABLE IF NOT EXISTS ingredients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name VARCHAR(100) NOT NULL,
        unit VARCHAR(16) NOT NULL,
        last_unit_price DECIMAL(10,2) NOT NULL,
        current_stock DECIMAL(10,3) NOT NULL DEFAULT 0,
        min_stock_level DECIMAL(10,3) NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS menu_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name VARCHAR(100) NOT NULL,
        selling_price DECIMAL(10,2) NOT NULL,
        category VARCHAR(50) NOT NULL,
        image_url TEXT
    );

    CREATE TABLE IF NOT EXISTS recipes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        menu_item_id INTEGER NOT NULL,
        ingredient_id INTEGER NOT NULL,
        quantity DECIMAL(10,3) NOT NULL,
        unit_waste_rate DECIMAL(5,2) DEFAULT 0,
        FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE,
        FOREIGN KEY (ingredient_id) REFERENCES ingredients(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS waste_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ingredient_id INTEGER NOT NULL,
        quantity DECIMAL(10,3) NOT NULL,
        reason VARCHAR(255),
        logged_by_user_id INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (ingredient_id) REFERENCES ingredients(id) ON DELETE CASCADE
    );

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
    `);

    // Create Triggers with precision rounding and cancellation safety
    db.exec(`
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

    -- 4. Sipariş iptal edilirse (completed -> cancelled) stokları geri iade et (Önemli ERP düzeltmesi)
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

    -- 6. Zayiat silinirse: stok geri iade edilir
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
    `);

    // Check if seed data exists
    const ingCount = db.prepare('SELECT COUNT(*) AS count FROM ingredients').get();
    if (ingCount.count === 0) {
        seedDatabase();
    }
}

function seedDatabase() {
    console.log('Seeding initial database data...');

    // 1. Ingredients
    const insertIng = db.prepare(`
        INSERT INTO ingredients (name, unit, last_unit_price, current_stock, min_stock_level)
        VALUES (?, ?, ?, ?, ?)
    `);

    const ingData = [
        ['Dana Kıyma', 'kg', 400.00, 10.000, 2.000],
        ['Brioş Ekmek', 'adet', 10.00, 40.000, 10.000],
        ['Cheddar Peyniri', 'kg', 500.00, 5.000, 1.000],
        ['Fettuccine Makarna', 'kg', 80.00, 8.000, 2.000],
        ['Yemeklik Krema', 'litre', 95.00, 6.000, 1.500],
        ['Parmesan Peyniri', 'kg', 750.00, 2.500, 0.500],
        ['Kültür Mantarı', 'kg', 70.00, 4.000, 1.000],
        ['Patates (Donuk)', 'kg', 45.00, 15.000, 5.000],
        ['Kızartma Yağı', 'litre', 55.00, 20.000, 5.000],
        ['Kutu Kola', 'adet', 25.00, 48.000, 12.000]
    ];

    for (const item of ingData) {
        insertIng.run(...item);
    }

    // 2. Menu Items
    const insertMenu = db.prepare(`
        INSERT INTO menu_items (name, selling_price, category, image_url)
        VALUES (?, ?, ?, ?)
    `);

    const menuData = [
        ['Cheeseburger', 350.00, 'Burgerler', 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400&q=80'],
        ['Fettuccine Alfredo', 310.00, 'Makarnalar', 'https://images.unsplash.com/photo-1645112411341-6c4fd023714a?w=400&q=80'],
        ['Çıtır Patates Sepeti', 140.00, 'Yan Ürünler', 'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=400&q=80'],
        ['Kutu İçecek', 60.00, 'İçecekler', 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=400&q=80']
    ];

    for (const item of menuData) {
        insertMenu.run(...item);
    }

    // 3. Recipes
    const insertRecipe = db.prepare(`
        INSERT INTO recipes (menu_item_id, ingredient_id, quantity, unit_waste_rate)
        VALUES (?, ?, ?, ?)
    `);

    // Cheeseburger: 150g Kıyma, 1 adet Ekmek, 20g Cheddar (%5 fire)
    insertRecipe.run(1, 1, 0.150, 0.0);
    insertRecipe.run(1, 2, 1.000, 0.0);
    insertRecipe.run(1, 3, 0.020, 5.0);

    // Fettuccine Alfredo: 120g Makarna, 80ml Krema, 25g Parmesan, 60g Mantar (%10 fire)
    insertRecipe.run(2, 4, 0.120, 0.0);
    insertRecipe.run(2, 5, 0.080, 0.0);
    insertRecipe.run(2, 6, 0.025, 2.0);
    insertRecipe.run(2, 7, 0.060, 10.0);

    // Çıtır Patates Sepeti: 250g Patates (%5 fire), 30ml Yağ (%15 fire)
    insertRecipe.run(3, 8, 0.250, 5.0);
    insertRecipe.run(3, 9, 0.030, 15.0);

    // Kutu İçecek: 1 adet
    insertRecipe.run(4, 10, 1.000, 0.0);

    // 4. Waste Logs
    db.exec(`
        INSERT INTO waste_logs (ingredient_id, quantity, reason, logged_by_user_id, created_at)
        VALUES
        (1, 0.100, 'Son kullanma tarihi geçti', 2, datetime('now', '-2 days')),
        (3, 0.050, 'Döküldü / Bozuldu', 3, datetime('now', '-1 days'));
    `);

    // 5. Purchases (Past history)
    db.exec(`
        INSERT INTO purchases (supplier_name, invoice_no, purchase_date, total_amount, created_by_user_id, notes)
        VALUES ('Et Tedarik A.Ş.', 'IRS-2026-001', datetime('now', '-5 days'), 4500.00, 1, 'Haftalık et ve süt ürünleri alımı');
        
        -- Disable purchase trigger temporarily or insert directly without double-adding to current_stock
        INSERT INTO purchase_items (purchase_id, ingredient_id, quantity, unit_price)
        VALUES
        (1, 1, 10.000, 400.00),
        (1, 3, 1.000, 500.00);
    `);

    // 6. Orders
    db.exec(`
        INSERT INTO orders (order_no, order_date, status, total_amount, source)
        VALUES ('POS-1001', datetime('now', '-3 days'), 'completed', 700.00, 'POS');

        INSERT INTO order_items (order_id, menu_item_id, quantity, unit_selling_price)
        VALUES (1, 1, 2.000, 350.00);

        INSERT INTO orders (order_no, order_date, status, total_amount, source)
        VALUES ('POS-1002', datetime('now', '-1 days'), 'completed', 510.00, 'Masa 4');

        INSERT INTO order_items (order_id, menu_item_id, quantity, unit_selling_price)
        VALUES 
        (2, 2, 1.000, 310.00),
        (2, 3, 1.000, 140.00),
        (2, 4, 1.000, 60.00);
    `);

    // 7. Stock Counts
    db.exec(`
        INSERT INTO stock_counts (count_date, counted_by_user_id, status, notes)
        VALUES (datetime('now', '-1 days'), 1, 'completed', 'Haftalık mutfak sayımı');

        INSERT INTO stock_count_items (stock_count_id, ingredient_id, theoretical_qty, counted_qty)
        VALUES
        (1, 1, 9.600, 9.400),
        (1, 2, 38.000, 37.000),
        (1, 3, 4.910, 4.850);
    `);

    // Set clean current stocks reflecting the seed history
    db.exec(`
        UPDATE ingredients SET current_stock = 9.400 WHERE id = 1;
        UPDATE ingredients SET current_stock = 37.000 WHERE id = 2;
        UPDATE ingredients SET current_stock = 4.850 WHERE id = 3;
        UPDATE ingredients SET current_stock = 7.880 WHERE id = 4;
        UPDATE ingredients SET current_stock = 5.920 WHERE id = 5;
        UPDATE ingredients SET current_stock = 2.474 WHERE id = 6;
        UPDATE ingredients SET current_stock = 3.934 WHERE id = 7;
        UPDATE ingredients SET current_stock = 14.737 WHERE id = 8;
        UPDATE ingredients SET current_stock = 19.965 WHERE id = 9;
        UPDATE ingredients SET current_stock = 47.000 WHERE id = 10;
    `);

    console.log('Database seeded successfully!');
}

module.exports = {
    db,
    initDatabase
};
