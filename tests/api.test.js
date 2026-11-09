const app = require('../server');

async function runApiTests() {
    console.log('🧪 Mutfak ERP - REST API ve Analitik Endpoint Testleri Başlatılıyor...\n');
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

    // Start server on ephemeral port (port 0) for testing
    const server = app.listen(0);
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
        // Test 1: GET /api/dashboard
        const dashRes = await fetch(`${baseUrl}/api/dashboard`);
        const dashJson = await dashRes.json();
        assert(dashRes.status === 200, 'GET /api/dashboard HTTP 200 OK döndü');
        assert(dashJson.success === true, 'GET /api/dashboard success: true');
        assert(typeof dashJson.data.food_cost_pct === 'number', 'GET /api/dashboard: food_cost_pct metrik hesabı mevcut');
        assert(typeof dashJson.data.total_inventory_value === 'number', 'GET /api/dashboard: total_inventory_value hesaplandı');

        // Test 2: GET /api/ingredients
        const ingRes = await fetch(`${baseUrl}/api/ingredients`);
        const ingJson = await ingRes.json();
        assert(ingRes.status === 200, 'GET /api/ingredients HTTP 200 OK döndü');
        assert(Array.isArray(ingJson.data) && ingJson.data.length > 0, 'GET /api/ingredients: Hammadde listesi dolu');
        assert(ingJson.data[0].last_unit_price > 0, 'GET /api/ingredients: Birim fiyatlar doğru');

        // Test 3: GET /api/menu-items (Query A)
        const menuRes = await fetch(`${baseUrl}/api/menu-items`);
        const menuJson = await menuRes.json();
        assert(menuRes.status === 200, 'GET /api/menu-items HTTP 200 OK döndü');
        assert(Array.isArray(menuJson.data) && menuJson.data.length > 0, 'GET /api/menu-items: Menü ürünleri listelendi');
        const cheeseburger = menuJson.data.find(m => m.name === 'Cheeseburger');
        assert(cheeseburger && cheeseburger.unit_cost > 0, 'GET /api/menu-items: Reçete porsiyon maliyeti (Query A) hesaplandı');
        assert(cheeseburger && cheeseburger.profit_amount > 0, 'GET /api/menu-items: Kar tutarı ve marjı hesaplandı');

        // Test 4: POST /api/orders (POS & Backflushing)
        const orderPayload = {
            order_no: `TEST-ORDER-${Date.now()}`,
            source: 'Masa 9 (API Test)',
            status: 'completed',
            items: [
                {
                    menu_item_id: cheeseburger.id,
                    quantity: 1,
                    unit_selling_price: cheeseburger.selling_price
                }
            ]
        };
        const orderRes = await fetch(`${baseUrl}/api/orders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(orderPayload)
        });
        const orderJson = await orderRes.json();
        assert(orderRes.status === 200, 'POST /api/orders HTTP 200 OK döndü');
        assert(orderJson.success === true, 'POST /api/orders: Sipariş başarıyla kaydedildi');
        assert(orderJson.order_no.startsWith('TEST-ORDER'), 'POST /api/orders: Sipariş numarası üretildi');

        // Test 5: GET /api/reports/variance (Query D)
        const varRes = await fetch(`${baseUrl}/api/reports/variance`);
        const varJson = await varRes.json();
        assert(varRes.status === 200, 'GET /api/reports/variance HTTP 200 OK döndü');
        assert(varJson.success === true, 'GET /api/reports/variance success: true');
        assert(Array.isArray(varJson.data), 'GET /api/reports/variance: Sayım sapma listesi döndü');

        console.log(`\n🎉 Tüm REST API endpoint testleri başarıyla tamamlandı (${passedTests}/${passedTests})!\n`);
    } finally {
        server.close();
    }
}

runApiTests().catch(err => {
    console.error('Test hatası:', err);
    process.exit(1);
});
