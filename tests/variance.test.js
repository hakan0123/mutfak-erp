const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

// Test in-memory database to verify physical count reconciliation and Query D variance analysis
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON;');

// Load schema
const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf-8');
db.exec(schemaSql);

console.log('🧪 Mutfak ERP - Fiziki Sayım ve Sapma (Variance / Query D) Testleri Başlatılıyor...\n');

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

// 1. Setup ingredients with known stock
db.exec(`
    INSERT INTO ingredients (id, name, unit, last_unit_price, current_stock, min_stock_level)
    VALUES 
    (1, 'Dana Kıyma', 'kg', 400.00, 10.000, 2.000),
    (2, 'Brioş Ekmek', 'adet', 10.00, 40.000, 10.000),
    (3, 'Cheddar Peyniri', 'kg', 500.00, 5.000, 1.000);
`);

// 2. Initiate a new draft stock count
db.exec(`
    INSERT INTO stock_counts (id, count_date, status, notes)
    VALUES (1, datetime('now'), 'draft', 'Haftalık Sayım');

    -- Theoretical stocks pre-filled from ingredients:
    -- Kıyma: 10.000 kg theoretical, 9.400 kg physically counted (0.600 kg shortage / fire)
    -- Ekmek: 40.000 adet theoretical, 38.000 adet physically counted (2 adet shortage)
    -- Cheddar: 5.000 kg theoretical, 5.200 kg physically counted (0.200 kg surplus / fazla)
    INSERT INTO stock_count_items (stock_count_id, ingredient_id, theoretical_qty, counted_qty)
    VALUES 
    (1, 1, 10.000, 9.400),
    (1, 2, 40.000, 38.000),
    (1, 3, 5.000, 5.200);
`);

// Test 1: Stored Generated variance_qty calculation
const sciKiyma = db.prepare('SELECT theoretical_qty, counted_qty, variance_qty FROM stock_count_items WHERE stock_count_id = 1 AND ingredient_id = 1').get();
const sciCheddar = db.prepare('SELECT theoretical_qty, counted_qty, variance_qty FROM stock_count_items WHERE stock_count_id = 1 AND ingredient_id = 3').get();

assert(sciKiyma.variance_qty === 0.600, 'Sanal Kolon (variance_qty): 10.000 - 9.400 = 0.600 kg eksiklik doğru hesaplandı');
assert(sciCheddar.variance_qty === -0.200, 'Sanal Kolon (variance_qty): 5.000 - 5.200 = -0.200 kg fazlalık doğru hesaplandı');

// Test 2: Sayımı Tamamla (draft -> completed) & Stok Dengeleme Tetikleyicisi (trg_stock_count_apply)
db.exec(`
    UPDATE stock_counts SET status = 'completed' WHERE id = 1;
`);

const ing1AfterCount = db.prepare('SELECT current_stock FROM ingredients WHERE id = 1').get();
const ing2AfterCount = db.prepare('SELECT current_stock FROM ingredients WHERE id = 2').get();
const ing3AfterCount = db.prepare('SELECT current_stock FROM ingredients WHERE id = 3').get();

assert(ing1AfterCount.current_stock === 9.400, 'trg_stock_count_apply: Kıyma stoğu fiziki sayılan 9.400 kg ile eşitlendi');
assert(ing2AfterCount.current_stock === 38.000, 'trg_stock_count_apply: Ekmek stoğu fiziki sayılan 38 adet ile eşitlendi');
assert(ing3AfterCount.current_stock === 5.200, 'trg_stock_count_apply: Cheddar stoğu fiziki sayılan 5.200 kg ile eşitlendi');

// Test 3: Query D (Variance Analizi ve Mali Fark Hesabı)
const queryD = `
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
        ) AS variance_pct
    FROM latest_count lc
    JOIN stock_count_items sci ON sci.stock_count_id = lc.stock_count_id
    JOIN ingredients i ON i.id = sci.ingredient_id
    ORDER BY ABS(sci.variance_qty * i.last_unit_price) DESC;
`;

const varianceResults = db.prepare(queryD).all();
assert(varianceResults.length === 3, 'Query D: 3 hammadde için sapma raporu üretildi');

// Kıyma: 0.600 kg * 400 TL = 240.00 TL zarar
const kiymaVariance = varianceResults.find(v => v.ingredient_id === 1);
assert(kiymaVariance.variance_cost === 240.00, 'Query D: Kıyma sapma maliyeti 240.00 TL doğru hesaplandı');
assert(kiymaVariance.variance_pct === 6.00, 'Query D: Kıyma sapma oranı %6.00 doğru hesaplandı');

// Cheddar: -0.200 kg * 500 TL = -100.00 TL sayım fazlası
const cheddarVariance = varianceResults.find(v => v.ingredient_id === 3);
assert(cheddarVariance.variance_cost === -100.00, 'Query D: Cheddar sayım fazlalığı -100.00 TL doğru hesaplandı');

console.log(`\n🎉 Tüm Fiziki Sayım ve Sapma Analiz testleri başarıyla tamamlandı (${passedTests}/${passedTests})!\n`);
