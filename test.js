const axios = require('axios');

// Basit test scripti - API'leri test edelim
async function testAPIs() {
  console.log('🚀 Testing Price Oracle APIs...\n');

  // Test CoinGecko
  try {
    console.log('📊 Testing CoinGecko API...');
    const response = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
      params: {
        ids: 'bitcoin,ethereum,the-open-network',
        vs_currencies: 'usd',
        include_24hr_vol: true,
        include_24hr_change: true
      },
      timeout: 10000
    });
    
    console.log('✅ CoinGecko Response:');
    console.log('BTC:', response.data.bitcoin);
    console.log('ETH:', response.data.ethereum);
    console.log('TON:', response.data['the-open-network']);
    console.log('');
  } catch (error) {
    console.log('❌ CoinGecko Error:', error.message);
  }

  // Test Binance
  try {
    console.log('📊 Testing Binance API...');
    const response = await axios.get('https://api.binance.com/api/v3/ticker/price', {
      params: { symbol: 'BTCUSDT' },
      timeout: 10000
    });
    
    console.log('✅ Binance Response:');
    console.log('BTC/USDT:', response.data);
    console.log('');
  } catch (error) {
    console.log('❌ Binance Error:', error.message);
  }

  // Test price aggregation
  try {
    console.log('🧮 Testing Price Aggregation...');
    
    const [coinGecko, binance] = await Promise.all([
      axios.get('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd'),
      axios.get('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT')
    ]);

    const cgPrice = coinGecko.data.bitcoin.usd;
    const binancePrice = parseFloat(binance.data.price);
    
    const prices = [cgPrice, binancePrice];
    const average = prices.reduce((sum, price) => sum + price, 0) / prices.length;
    const median = prices.sort((a, b) => a - b)[Math.floor(prices.length / 2)];
    
    console.log('✅ Price Aggregation Results:');
    console.log('CoinGecko BTC/USD:', cgPrice);
    console.log('Binance BTC/USDT:', binancePrice);
    console.log('Average:', average.toFixed(2));
    console.log('Median:', median.toFixed(2));
    console.log('Deviation:', Math.abs(cgPrice - binancePrice).toFixed(2));
    console.log('');
  } catch (error) {
    console.log('❌ Aggregation Error:', error.message);
  }

  console.log('🎉 API Tests Completed!');
}

// Oracle simulation
function simulateOracle() {
  console.log('\n🔄 Starting Oracle Simulation...');
  
  let updateCount = 0;
  const maxUpdates = 5;
  
  const interval = setInterval(async () => {
    updateCount++;
    console.log(`\n📡 Oracle Update #${updateCount}`);
    
    try {
      const response = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
        params: {
          ids: 'bitcoin,ethereum,the-open-network',
          vs_currencies: 'usd'
        },
        timeout: 5000
      });
      
      const prices = response.data;
      console.log(`BTC: $${prices.bitcoin.usd}`);
      console.log(`ETH: $${prices.ethereum.usd}`);
      console.log(`TON: $${prices['the-open-network'].usd}`);
      console.log('✅ Oracle update successful');
      
    } catch (error) {
      console.log('❌ Oracle update failed:', error.message);
    }
    
    if (updateCount >= maxUpdates) {
      clearInterval(interval);
      console.log('\n🛑 Oracle simulation completed!');
      console.log('\n💡 To test the full system:');
      console.log('1. Fix TypeScript compilation errors');
      console.log('2. Set up proper .env with mnemonic');
      console.log('3. Run: npm run dev');
    }
  }, 10000); // Update every 10 seconds
}

// Run tests
async function main() {
  await testAPIs();
  simulateOracle();
}

main().catch(console.error);