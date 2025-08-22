import { SourceStatus } from './oracle';

export interface PriceData {
  base: string;              // Base currency (e.g., 'BTC')
  quote: string;             // Quote currency (e.g., 'USD')
  price: number;             // Current price
  timestamp: number;         // Unix timestamp
  source: string;            // Data source name
  volume24h?: number;        // 24h trading volume
  change24h?: number;        // 24h price change percentage
  marketCap?: number;        // Market capitalization
  confidence?: number;       // Confidence score (0-100)
}

export interface AggregatedPriceData {
  base: string;
  quote: string;
  price: number;             // Aggregated price (median/average)
  timestamp: number;
  sources: string[];         // Contributing sources
  sourceCount: number;       // Number of sources used
  standardDeviation: number; // Price variance across sources
  confidence: number;        // Aggregation confidence (0-100)
  outliers: PriceData[];     // Removed outlier data points
}

export interface TradingPair {
  base: string;
  quote: string;
  symbol: string;            // e.g., 'BTCUSDT'
  isActive: boolean;
  minPrice: number;          // Minimum valid price
  maxPrice: number;          // Maximum valid price
  decimalPlaces: number;     // Price precision
}

export interface PriceOracleConfig {
  supportedPairs: TradingPair[];
  sources: PriceSourceConfig[];
  aggregationMethod: 'median' | 'average' | 'weighted';
  outlierThreshold: number;   // Standard deviations for outlier detection
  minSourcesRequired: number;
  maxPriceAge: number;       // Maximum age in seconds
  updateInterval: number;
  deviationThreshold: number;
}

export interface PriceSourceConfig {
  name: string;
  enabled: boolean;
  apiKey?: string;
  apiSecret?: string;
  weight: number;            // Weight for weighted average
  rateLimit: number;         // Requests per minute
  timeout: number;           // Request timeout in ms
  endpoints: {
    baseUrl: string;
    priceEndpoint: string;
  };
}

export interface PriceSource {
  name: string;
  isOnline: boolean;
  
  fetchPrice(base: string, quote: string): Promise<PriceData>;
  fetchMultiplePrices(pairs: TradingPair[]): Promise<PriceData[]>;
  getSupportedPairs(): Promise<TradingPair[]>;
  getStatus(): Promise<SourceStatus>;
}

export interface PriceValidationRules {
  minPrice: number;
  maxPrice: number;
  maxPriceChange: number;    // Maximum price change percentage
  maxAge: number;            // Maximum data age in seconds
  requiredSources: number;
  outlierDetection: boolean;
}

export interface PriceUpdate {
  pair: TradingPair;
  oldPrice: number;
  newPrice: number;
  change: number;            // Percentage change
  timestamp: number;
  trigger: 'time' | 'threshold' | 'manual';
  transactionHash?: string;
}

export interface PriceHistory {
  pair: TradingPair;
  prices: Array<{
    price: number;
    timestamp: number;
    source: string;
  }>;
  period: '1h' | '24h' | '7d' | '30d';
}

export enum PriceSourceType {
  CENTRALIZED_EXCHANGE = 'cex',
  DECENTRALIZED_EXCHANGE = 'dex', 
  PRICE_AGGREGATOR = 'aggregator',
  ORACLE_NETWORK = 'oracle'
}

// SourceStatus is now imported from ./oracle