const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(':memory:');

db.exec(`PRAGMA foreign_keys = ON;`);

const schema = `
CREATE TABLE ingredients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(100) NOT NULL,
    unit VARCHAR(16) NOT NULL,
    last_unit_price DECIMAL(10,2) NOT NULL,
    current_stock DECIMAL(10,3) NOT NULL DEFAULT 0,
    min_stock_level DECIMAL(10,3) NOT NULL DEFAULT 0
);

CREATE TABLE menu_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(100) NOT NULL,
    selling_price DECIMAL(10,2) NOT NULL,
    category VARCHAR(50) NOT NULL
);

CREATE TABLE recipes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    menu_item_id INTEGER NOT NULL,
    ingredient_id INTEGER NOT NULL,
    quantity DECIMAL(10,3) NOT NULL,
    unit_waste_rate DECIMAL(5,2) DEFAULT 0,
    FOREIGN KEY (menu_item_id) REFERENCES menu_items(id),
    FOREIGN KEY (ingredient_id) REFERENCES ingredients(id)
);

CREATE TABLE waste_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ingredient_id INTEGER NOT NULL,
    quantity DECIMAL(10,3) NOT NULL,
    reason VARCHAR(255),
    logged_by_user_id INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ingredient_id) REFERENCES ingredients(id)
);

CREATE TABLE purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_name VARCHAR(100),
    invoice_no VARCHAR(50),
    purchase_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    total_amount DECIMAL(12,2) DEFAULT 0,
    notes TEXT,
    created_by_user_id INTEGER
);

CREATE TABLE purchase_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_id INTEGER NOT NULL,
    ingredient_id INTEGER NOT NULL,
    quantity DECIMAL(10,3) NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    line_total DECIMAL(12,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
    FOREIGN KEY (purchase_id) REFERENCES purchases(id),
    FOREIGN KEY (ingredient_id) REFERENCES ingredients(id)
);

CREATE TABLE orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_no VARCHAR(50),
    order_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) NOT NULL DEFAULT 'completed',
    total_amount DECIMAL(12,2) DEFAULT 0,
    source VARCHAR(30) DEFAULT 'POS',
    created_by_user_id INTEGER
);

CREATE TABLE order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    menu_item_id INTEGER NOT NULL,
    quantity DECIMAL(10,3) NOT NULL DEFAULT 1,
    unit_selling_price DECIMAL(10,2) NOT NULL,
    line_total DECIMAL(12,2) GENERATED ALWAYS AS (quantity * unit_selling_price) STORED,
    FOREIGN KEY (order_id) REFERENCES orders(id),
    FOREIGN KEY (menu_item_id) REFERENCES menu_items(id)
);

CREATE TABLE stock_counts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    count_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    counted_by_user_id INTEGER,
    status VARCHAR(20) DEFAULT 'draft',
    notes TEXT
);

CREATE TABLE stock_count_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stock_count_id INTEGER NOT NULL,
    ingredient_id INTEGER NOT NULL,
    theoretical_qty DECIMAL(10,3) NOT NULL,
    counted_qty DECIMAL(10,3) NOT NULL,
    variance_qty DECIMAL(10,3) GENERATED ALWAYS AS (theoretical_qty - counted_qty) STORED,
    FOREIGN KEY (stock_count_id) REFERENCES stock_counts(id),
    FOREIGN KEY (ingredient_id) REFERENCES ingredients(id)
);

-- Triggers
CREATE TRIGGER trg_purchase_item_stock_in
AFTER INSERT ON purchase_items
BEGIN
    UPDATE ingredients
    SET
        current_stock = ROUND(current_stock + NEW.quantity, 3),
        last_unit_price = NEW.unit_price
    WHERE id = NEW.ingredient_id;

    UPDATE purchases
    SET total_amount = (
        SELECT COALESCE(SUM(quantity * unit_price), 0)
        FROM purchase_items
        WHERE purchase_id = NEW.purchase_id
    )
    WHERE id = NEW.purchase_id;
END;

CREATE TRIGGER trg_order_item_backflush
AFTER INSERT ON order_items
WHEN (SELECT status FROM orders WHERE id = NEW.order_id) = 'completed'
BEGIN
    UPDATE ingredients
    SET current_stock = ROUND(current_stock - (
        SELECT COALESCE(SUM(
            r.quantity * (1 + COALESCE(r.unit_waste_rate, 0) / 100.0) * NEW.quantity
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
        SELECT COALESCE(SUM(quantity * unit_selling_price), 0)
        FROM order_items
        WHERE order_id = NEW.order_id
    )
    WHERE id = NEW.order_id;
END;

CREATE TRIGGER trg_order_completed_backflush
AFTER UPDATE OF status ON orders
WHEN OLD.status != 'completed' AND NEW.status = 'completed'
BEGIN
    UPDATE ingredients
    SET current_stock = ROUND(current_stock - (
        SELECT COALESCE(SUM(
            r.quantity * (1 + COALESCE(r.unit_waste_rate, 0) / 100.0) * oi.quantity
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

CREATE TRIGGER trg_waste_stock_out
AFTER INSERT ON waste_logs
BEGIN
    UPDATE ingredients
    SET current_stock = ROUND(current_stock - NEW.quantity, 3)
    WHERE id = NEW.ingredient_id;
END;

CREATE TRIGGER trg_stock_count_apply
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
`;

db.exec(schema);

// Seed
db.exec(`
INSERT INTO ingredients (name, unit, last_unit_price, current_stock, min_stock_level) VALUES
('Dana Kıyma', 'kg', 400, 10, 2),
('Brioş Ekmek', 'adet', 10, 40, 10),
('Cheddar Peyniri', 'kg', 500, 5, 1);

INSERT INTO menu_items (name, selling_price, category) VALUES
('Cheeseburger', 350, 'Burgerler'),
('Fettuccine Alfredo', 310, 'Makarnalar');

INSERT INTO recipes (menu_item_id, ingredient_id, quantity, unit_waste_rate) VALUES
(1, 1, 0.15, 0),
(1, 2, 1, 0),
(1, 3, 0.02, 5);

INSERT INTO waste_logs (ingredient_id, quantity, reason, logged_by_user_id) VALUES
(1, 0.1, 'Son kullanma tarihi geçti', 2),
(3, 0.05, 'Döküldü/Bozuldu', 3);

-- Note: purchase adds stock if trigger is active
INSERT INTO purchases (supplier_name, invoice_no, purchase_date, total_amount, created_by_user_id) VALUES
('Et Tedarik A.Ş.', 'IRS-2026-001', datetime('now', '-5 days'), 4500, 1);

INSERT INTO purchase_items (purchase_id, ingredient_id, quantity, unit_price) VALUES
(1, 1, 10, 400),
(1, 3, 1, 500);

INSERT INTO orders (order_no, order_date, status, total_amount, source) VALUES
('POS-1001', datetime('now', '-3 days'), 'completed', 700, 'POS');

INSERT INTO order_items (order_id, menu_item_id, quantity, unit_selling_price) VALUES
(1, 1, 2, 350);

INSERT INTO stock_counts (count_date, counted_by_user_id, status, notes) VALUES
(datetime('now', '-1 days'), 1, 'completed', 'Haftalık mutfak sayımı');

INSERT INTO stock_count_items (stock_count_id, ingredient_id, theoretical_qty, counted_qty) VALUES
(1, 1, 9.60, 9.40),
(1, 2, 38, 37),
(1, 3, 4.91, 4.85);
`);

console.log('Stock state after initial seed:');
const stocks = db.prepare('SELECT * FROM ingredients').all();
console.table(stocks);

console.log('\n--- Query A: Menu Item Unit Cost & Profit Margin ---');
const queryA = `
SELECT
    mi.id AS menu_item_id,
    mi.name AS menu_item,
    mi.selling_price,
    ROUND(SUM(
        r.quantity * (1 + COALESCE(r.unit_waste_rate, 0) / 100.0) * i.last_unit_price
    ), 2) AS unit_cost,
    ROUND(
        mi.selling_price - SUM(
            r.quantity * (1 + COALESCE(r.unit_waste_rate, 0) / 100.0) * i.last_unit_price
        ), 2
    ) AS profit_amount,
    ROUND(
        100.0 * (
            mi.selling_price - SUM(
                r.quantity * (1 + COALESCE(r.unit_waste_rate, 0) / 100.0) * i.last_unit_price
            )
        ) / NULLIF(mi.selling_price, 0), 2
    ) AS profit_margin_pct,
    ROUND(
        100.0 * SUM(
            r.quantity * (1 + COALESCE(r.unit_waste_rate, 0) / 100.0) * i.last_unit_price
        ) / NULLIF(mi.selling_price, 0), 2
    ) AS food_cost_pct_item
FROM menu_items mi
LEFT JOIN recipes r ON r.menu_item_id = mi.id
LEFT JOIN ingredients i ON i.id = r.ingredient_id
GROUP BY mi.id, mi.name, mi.selling_price;
`;
console.table(db.prepare(queryA).all());

console.log('\n--- Query B: Food Cost % (Dashboard) ---');
const queryB = `
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
                * (1 + COALESCE(r.unit_waste_rate, 0) / 100.0)
                * i.last_unit_price
            )
            FROM orders o
            JOIN order_items oi ON oi.order_id = o.id
            JOIN recipes r ON r.menu_item_id = oi.menu_item_id
            JOIN ingredients i ON i.id = r.ingredient_id
            WHERE o.status = 'completed'
              AND o.order_date >= date('now', '-30 day')
        ) AS kitchen_cost,
        (
            SELECT SUM(oi.quantity * oi.unit_selling_price)
            FROM orders o
            JOIN order_items oi ON oi.order_id = o.id
            WHERE o.status = 'completed'
              AND o.order_date >= date('now', '-30 day')
        ) AS sales_revenue
);
`;
console.table(db.prepare(queryB).all());

console.log('\n--- Query C: Critical Stock Warning ---');
const queryC = `
SELECT
    id,
    name,
    unit,
    current_stock,
    min_stock_level,
    last_unit_price,
    ROUND(min_stock_level - current_stock, 3) AS shortage_qty
FROM ingredients
WHERE current_stock <= min_stock_level
ORDER BY (current_stock / NULLIF(min_stock_level, 0)) ASC;
`;
console.table(db.prepare(queryC).all());

console.log('\n--- Query D: Variance Analysis ---');
const queryD = `
WITH period AS (
    SELECT
        date('now', '-7 day') AS start_dt,
        datetime('now') AS end_dt
),
latest_count AS (
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
    sci.theoretical_qty,
    sci.counted_qty AS physical_qty,
    sci.variance_qty,
    ROUND(sci.variance_qty * i.last_unit_price, 2) AS variance_cost,
    ROUND(
        100.0 * sci.variance_qty / NULLIF(sci.theoretical_qty, 0), 2
    ) AS variance_pct
FROM latest_count lc
JOIN stock_count_items sci ON sci.stock_count_id = lc.stock_count_id
JOIN ingredients i ON i.id = sci.ingredient_id
ORDER BY ABS(sci.variance_qty) DESC;
`;
console.table(db.prepare(queryD).all());
