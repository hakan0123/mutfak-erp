const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

// Test in-memory database to verify all 7 triggers
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON;');

// Load schema
const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf-8');
db.exec(schemaSql);

console.log('🧪 Mutfak ERP - Tetikleyici (Trigger) ve Backflushing Testleri Başlatılıyor...\n');

let passedTests = 0;
function assert(condition, testName) {
    if (condition) {
        console.log(`✅ [BAŞARILI] ${testName}`);
        passedTests++;
    } else {
        console.error(`❌ [BAŞARISIZ] ${testName}`);
        process.exit(1);
    }
}

// 1. Initial Ingredient & Menu Item Setup
db.exec(`
    INSERT INTO ingredients (id, name, unit, last_unit_price, current_stock, min_stock_level)
    VALUES 
    (1, 'Dana Kıyma', 'kg', 400.00, 10.000, 2.000),
    (2, 'Brioş Ekmek', 'adet', 10.00, 40.000, 10.000),
    (3, 'Cheddar Peyniri', 'kg', 500.00, 5.000, 1.000);

    INSERT INTO menu_items (id, name, selling_price, category)
    VALUES (1, 'Cheeseburger', 350.00, 'Burgerler');

    -- Cheeseburger Recipe: 150g Kıyma (0% fire), 1 Ekmek (0% fire), 20g Cheddar (%5 fire -> 0.021 kg)
    INSERT INTO recipes (menu_item_id, ingredient_id, quantity, unit_waste_rate)
    VALUES 
    (1, 1, 0.150, 0.0),
    (1, 2, 1.000, 0.0),
    (1, 3, 0.020, 5.0);
`);

// Test 1: Satın alma kalemi eklendiğinde stok artışı & son fiyat güncellemesi (trg_purchase_item_stock_in)
db.exec(`
    INSERT INTO purchases (id, supplier_name, invoice_no) VALUES (1, 'Test Tedarikçi', 'IRS-001');
    INSERT INTO purchase_items (purchase_id, ingredient_id, quantity, unit_price)
    VALUES (1, 1, 5.000, 420.00);
`);
const ing1AfterPurchase = db.prepare('SELECT current_stock, last_unit_price FROM ingredients WHERE id = 1').get();
const pur1Total = db.prepare('SELECT total_amount FROM purchases WHERE id = 1').get();

assert(ing1AfterPurchase.current_stock === 15.000, 'trg_purchase_item_stock_in: Stok 10 + 5 = 15.000 kg oldu');
assert(ing1AfterPurchase.last_unit_price === 420.00, 'trg_purchase_item_stock_in: Son alış fiyatı 420 TL güncellendi');
assert(pur1Total.total_amount === 2100.00, 'trg_purchase_item_stock_in: Fatura toplamı 2100 TL hesaplandı');

// Test 2: Tamamlanan sipariş kaleminde backflushing stok düşümü (trg_order_item_backflush)
db.exec(`
    INSERT INTO orders (id, order_no, status) VALUES (1, 'POS-TEST-1', 'completed');
    -- 2 Adet Cheeseburger satışı:
    -- Kıyma düşüşü: 2 * 0.150 = 0.300 kg -> 15.000 - 0.300 = 14.700 kg
    -- Ekmek düşüşü: 2 * 1.000 = 2 adet -> 40.000 - 2 = 38.000 adet
    -- Cheddar düşüşü: 2 * (0.020 * 1.05) = 0.042 kg -> 5.000 - 0.042 = 4.958 kg
    INSERT INTO order_items (order_id, menu_item_id, quantity, unit_selling_price)
    VALUES (1, 1, 2, 350.00);
`);

const ing1AfterOrder = db.prepare('SELECT current_stock FROM ingredients WHERE id = 1').get();
const ing2AfterOrder = db.prepare('SELECT current_stock FROM ingredients WHERE id = 2').get();
const ing3AfterOrder = db.prepare('SELECT current_stock FROM ingredients WHERE id = 3').get();
const order1Total = db.prepare('SELECT total_amount FROM orders WHERE id = 1').get();

assert(ing1AfterOrder.current_stock === 14.700, 'trg_order_item_backflush: Kıyma stoğu 14.700 kg düştü (Backflushing)');
assert(ing2AfterOrder.current_stock === 38.000, 'trg_order_item_backflush: Ekmek stoğu 38 adet düştü');
assert(ing3AfterOrder.current_stock === 4.958, 'trg_order_item_backflush: Cheddar %5 fire dahil 4.958 kg düştü');
assert(order1Total.total_amount === 700.00, 'trg_order_item_backflush: Sipariş toplam tutarı 700 TL oldu');

// Test 3: Sipariş iptal edildiğinde stokların eksiksiz iadesi (trg_order_cancelled_restock)
db.exec(`
    UPDATE orders SET status = 'cancelled' WHERE id = 1;
`);
const ing1AfterCancel = db.prepare('SELECT current_stock FROM ingredients WHERE id = 1').get();
const ing2AfterCancel = db.prepare('SELECT current_stock FROM ingredients WHERE id = 2').get();
const ing3AfterCancel = db.prepare('SELECT current_stock FROM ingredients WHERE id = 3').get();

assert(ing1AfterCancel.current_stock === 15.000, 'trg_order_cancelled_restock: İptal edilen siparişle kıyma geri yüklendi (15.000 kg)');
assert(ing2AfterCancel.current_stock === 40.000, 'trg_order_cancelled_restock: İptal edilen siparişle ekmek geri yüklendi (40 adet)');
assert(ing3AfterCancel.current_stock === 5.000, 'trg_order_cancelled_restock: İptal edilen siparişle cheddar geri yüklendi (5.000 kg)');

// Test 4: Zayiat ve Fire kaydı stoktan düşümü (trg_waste_stock_out)
db.exec(`
    INSERT INTO waste_logs (id, ingredient_id, quantity, reason)
    VALUES (1, 1, 0.500, 'Tarihi geçti');
`);
const ing1AfterWaste = db.prepare('SELECT current_stock FROM ingredients WHERE id = 1').get();
assert(ing1AfterWaste.current_stock === 14.500, 'trg_waste_stock_out: Zayiat kaydı ile kıyma 14.500 kg düştü');

// Test 5: Zayiat kaydı silindiğinde stok iadesi (trg_waste_stock_restore)
db.exec(`
    DELETE FROM waste_logs WHERE id = 1;
`);
const ing1AfterWasteRestore = db.prepare('SELECT current_stock FROM ingredients WHERE id = 1').get();
assert(ing1AfterWasteRestore.current_stock === 15.000, 'trg_waste_stock_restore: Silinen zayiat ile kıyma 15.000 kg geri iade edildi');

// Test 6: Fiziki sayım onaylandığında stok dengeleme (trg_stock_count_apply)
db.exec(`
    INSERT INTO stock_counts (id, status, notes) VALUES (1, 'draft', 'Haftalık Sayım');
    INSERT INTO stock_count_items (stock_count_id, ingredient_id, theoretical_qty, counted_qty)
    VALUES (1, 1, 15.000, 14.200);

    -- Sayımı onayla (draft -> completed)
    UPDATE stock_counts SET status = 'completed' WHERE id = 1;
`);
const ing1AfterCount = db.prepare('SELECT current_stock FROM ingredients WHERE id = 1').get();
assert(ing1AfterCount.current_stock === 14.200, 'trg_stock_count_apply: Fiziki sayım sonrası stok sayılan 14.200 kg miktarına eşitlendi');

console.log(`\n🎉 Tüm tetikleyici testleri başarıyla tamamlandı (${passedTests}/${passedTests})!\n`);
