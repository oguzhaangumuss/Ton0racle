# TonOracle

A high-performance, multi-source Oracle system for the TON blockchain with extensible architecture for various data types.

## 🎯 Overview

TonOracle is a decentralized oracle platform built specifically for the TON blockchain ecosystem. Initially focused on cryptocurrency price feeds, the system is designed with a modular architecture to support additional oracle types including weather data, sports results, and custom data feeds.

## ✨ Features

- 🔗 **Multi-Source Price Aggregation**: CoinGecko, Binance, CoinMarketCap integration
- ⚡ **Real-Time Updates**: Configurable update intervals and threshold-based triggers
- 🛡️ **Robust Security**: Signature verification, outlier detection, circuit breakers
- 🔧 **Extensible Architecture**: Easy addition of new oracle types
- 📊 **TON Native**: Optimized for TON blockchain's unique architecture
- 🎛️ **Flexible Configuration**: Environment-based settings for all parameters

## 🏗️ Architecture

### Off-Chain Components
```
Data Sources → Validation → Aggregation → TON Blockchain
     ↓             ↓           ↓              ↓
CoinGecko      Signature    Median/Avg    Smart Contract
Binance        Timestamp    Outlier       Price Storage  
CMC            Range Check  Detection     Event Emission
```

### On-Chain Components
- **Oracle Contract**: Stores validated price data on TON blockchain
- **Consumer Contracts**: Access oracle data for DeFi applications
- **Governance Contract**: Manages oracle parameters and access control

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- TON wallet with testnet TON
- API keys for data sources

### Installation
```bash
git clone https://github.com/yourusername/TonOracle.git
cd TonOracle
npm install
```

### Configuration
```bash
cp .env.example .env
# Edit .env with your configuration
```

### Development
```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run test         # Run tests
npm run lint         # Lint code
```

### Deployment
```bash
npm run deploy:testnet   # Deploy to TON testnet
npm run deploy:mainnet   # Deploy to TON mainnet
```

## 📋 Configuration

### Required Environment Variables

```bash
# TON Network
TON_NETWORK=testnet
TON_API_KEY=your_ton_api_key
TON_ENDPOINT=https://testnet.toncenter.com/api/v2/jsonRPC

# Oracle Settings
ORACLE_PRIVATE_KEY=your_oracle_private_key
UPDATE_INTERVAL=300                    # Update every 5 minutes
DEVIATION_THRESHOLD=1.0               # 1% price change threshold
MIN_DATA_SOURCES=2                    # Minimum sources required

# Data Source APIs
COINGECKO_API_KEY=your_coingecko_key
BINANCE_API_KEY=your_binance_key
CMC_API_KEY=your_coinmarketcap_key
```

### Supported Assets (Initial)
- BTC/USD
- ETH/USD
- TON/USD
- USDT/USD

## 🔧 Usage

### Basic Price Oracle
```typescript
import { PriceOracle } from './src/oracles/price/PriceOracle';

const oracle = new PriceOracle({
  sources: ['coingecko', 'binance', 'cmc'],
  updateInterval: 300,
  deviationThreshold: 1.0
});

// Start oracle
await oracle.start();

// Get latest price
const btcPrice = await oracle.getPrice('BTC', 'USD');
console.log(`BTC/USD: $${btcPrice}`);
```

### Custom Oracle Implementation
```typescript
import { OracleBase } from './src/oracles/base/OracleBase';

class WeatherOracle extends OracleBase {
  async fetchData(): Promise<WeatherData> {
    // Implement weather data fetching
  }
  
  async validateData(data: WeatherData): Promise<boolean> {
    // Implement validation logic
  }
}
```

## 🛡️ Security Features

### Data Validation
- **Multi-source verification**: Cross-reference data from multiple APIs
- **Signature verification**: Cryptographic validation of data sources
- **Timestamp validation**: Prevent replay attacks
- **Outlier detection**: Statistical analysis to remove anomalous data

### Economic Security
- **Circuit breakers**: Automatic pause on abnormal conditions
- **Gas optimization**: Efficient transaction batching
- **Fallback mechanisms**: Redundant data sources and nodes
- **Access control**: Role-based permissions for critical functions

### Smart Contract Security
- **Formal verification**: Mathematical proofs for critical functions
- **Audit trail**: Comprehensive logging and monitoring
- **Upgrade patterns**: Secure contract upgrade mechanisms
- **Emergency procedures**: Manual override capabilities

## 📊 API Reference

### Price Oracle Methods
```typescript
// Get current price
getPrice(base: string, quote: string): Promise<number>

// Get price with metadata
getPriceWithMetadata(base: string, quote: string): Promise<PriceData>

// Subscribe to price updates
subscribeToPriceUpdates(callback: (price: PriceData) => void): void

// Get supported trading pairs
getSupportedPairs(): Promise<TradingPair[]>
```

### Oracle Management
```typescript
// Start oracle service
start(): Promise<void>

// Stop oracle service  
stop(): Promise<void>

// Get oracle status
getStatus(): Promise<OracleStatus>

// Update configuration
updateConfig(config: OracleConfig): Promise<void>
```

## 🧪 Testing

### Unit Tests
```bash
npm test                    # Run all tests
npm test -- --watch        # Watch mode
npm test -- --coverage     # Coverage report
```

### Integration Tests
```bash
npm run test:integration    # Test with real APIs
npm run test:contracts      # Test smart contracts
```

### Load Testing
```bash
npm run test:load          # Performance testing
```

## 🛠️ Development

### Project Structure
```
src/
├── oracles/              # Oracle implementations
│   ├── base/            # Abstract oracle interfaces
│   ├── price/           # Price oracle implementation
│   └── future/          # Future oracle types
├── contracts/           # Smart contract interfaces
├── services/            # Core services (fetcher, validator, relayer)
├── types/               # TypeScript type definitions
├── utils/               # Utility functions
└── index.ts            # Main entry point
```

### Adding New Oracle Types
1. Extend `OracleBase` abstract class
2. Implement required methods (`fetchData`, `validateData`, `processData`)
3. Add configuration to environment variables
4. Register oracle in main application

### Contributing Guidelines
1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'feat: add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📈 Roadmap

### Phase 1: Core Price Oracle (Current)
- [x] Multi-source price aggregation
- [x] TON blockchain integration
- [x] Basic security mechanisms
- [ ] Comprehensive testing
- [ ] Mainnet deployment

### Phase 2: Advanced Features
- [ ] Additional oracle types (weather, sports)
- [ ] Cross-chain bridge integration
- [ ] Advanced governance mechanisms
- [ ] Performance optimizations

### Phase 3: Ecosystem Integration
- [ ] DeFi protocol partnerships
- [ ] Developer SDK and tools
- [ ] Community governance token
- [ ] Enterprise API services

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🤝 Support

- **Documentation**: [docs/](./docs/)
- **Issues**: [GitHub Issues](https://github.com/yourusername/TonOracle/issues)
- **Discord**: [Join our community](https://discord.gg/tonoracle)
- **Email**: support@tonoracle.com

## 👥 Team

Built with ❤️ by [Oğuzhan Gümüş](https://github.com/oguzhaangumuss)

---

**Disclaimer**: This software is provided as-is. Oracle data accuracy is dependent on external sources. Use at your own risk in production environments.