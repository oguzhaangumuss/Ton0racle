import { OracleBase } from '../base/OracleBase';
import { 
  PriceData, 
  AggregatedPriceData, 
  TradingPair, 
  PriceOracleConfig,
  OracleData,
  ValidationResult,
  Logger,
  MetricsCollector,
  ValidationError,
  PriceSource
} from '@/types';
import { TONClientService } from '@/services/TONClient';
import { CoinGeckoFetcher, BinanceFetcher, CoinMarketCapFetcher } from '@/services/DataFetcher';

export class PriceOracle extends OracleBase<AggregatedPriceData> {
  private priceConfig: PriceOracleConfig;
  private tonClient: TONClientService;
  private dataSources: Map<string, PriceSource> = new Map();
  private supportedPairs: TradingPair[] = [];
  private lastPrices: Map<string, AggregatedPriceData> = new Map();

  constructor(
    priceConfig: PriceOracleConfig,
    tonClient: TONClientService,
    logger: Logger,
    metrics: MetricsCollector
  ) {
    // Convert PriceOracleConfig to OracleConfig for base class
    const oracleConfig = {
      updateInterval: priceConfig.updateInterval,
      deviationThreshold: priceConfig.deviationThreshold || 1.0,
      minSources: priceConfig.minSourcesRequired,
      maxOutlierDeviation: priceConfig.outlierThreshold,
      gasLimit: 1000000,
      retryAttempts: 3,
      enabled: true
    };

    super(oracleConfig, logger, metrics);
    this.priceConfig = priceConfig;
    this.tonClient = tonClient;
    this.supportedPairs = priceConfig.supportedPairs;
    
    this.initializeDataSources();
  }

  getOracleType(): string {
    return 'price';
  }

  private initializeDataSources(): void {
    // Initialize CoinGecko
    const coinGeckoConfig = this.priceConfig.sources.find(s => s.name === 'coingecko');
    if (coinGeckoConfig?.enabled) {
      this.dataSources.set('coingecko', new CoinGeckoFetcher(
        {
          baseUrl: 'https://api.coingecko.com/api/v3',
          apiKey: coinGeckoConfig.apiKey,
          timeout: 10000,
          rateLimit: coinGeckoConfig.rateLimit
        },
        this.logger,
        this.metrics
      ));
    }

    // Initialize Binance
    const binanceConfig = this.priceConfig.sources.find(s => s.name === 'binance');
    if (binanceConfig?.enabled) {
      this.dataSources.set('binance', new BinanceFetcher(
        {
          baseUrl: 'https://api.binance.com/api/v3',
          apiKey: binanceConfig.apiKey,
          timeout: 10000,
          rateLimit: binanceConfig.rateLimit
        },
        this.logger,
        this.metrics
      ));
    }

    // Initialize CoinMarketCap
    const cmcConfig = this.priceConfig.sources.find(s => s.name === 'coinmarketcap');
    if (cmcConfig?.enabled) {
      this.dataSources.set('coinmarketcap', new CoinMarketCapFetcher(
        {
          baseUrl: 'https://pro-api.coinmarketcap.com',
          apiKey: cmcConfig.apiKey,
          timeout: 10000,
          rateLimit: cmcConfig.rateLimit
        },
        this.logger,
        this.metrics
      ));
    }

    this.logger.info(`Initialized ${this.dataSources.size} data sources`, {
      sources: Array.from(this.dataSources.keys())
    });
  }

  async fetchData(): Promise<OracleData<PriceData>[]> {
    const allPriceData: OracleData<PriceData>[] = [];

    for (const pair of this.supportedPairs) {
      if (!pair.isActive) continue;

      const pairKey = `${pair.base}/${pair.quote}`;
      this.logger.debug(`Fetching prices for ${pairKey}`);

      for (const [sourceName, source] of this.dataSources) {
        try {
          const priceData = await source.fetchPrice(pair.base, pair.quote);
          
          allPriceData.push({
            value: priceData,
            timestamp: priceData.timestamp,
            source: sourceName,
            metadata: {
              pair: pairKey,
              confidence: priceData.confidence
            }
          });

          this.metrics.increment('price_oracle.fetch_success', {
            source: sourceName,
            pair: pairKey
          });

        } catch (error) {
          this.logger.warn(`Failed to fetch ${pairKey} from ${sourceName}`, {
            error: error instanceof Error ? error.message : String(error)
          });

          this.metrics.increment('price_oracle.fetch_error', {
            source: sourceName,
            pair: pairKey
          });
        }
      }
    }

    this.logger.info(`Fetched ${allPriceData.length} price data points from ${this.dataSources.size} sources`);
    return allPriceData;
  }

  async validateData(data: OracleData<PriceData>[]): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Group data by trading pair
    const dataByPair = this.groupDataByPair(data);

    for (const [pairKey, pairData] of dataByPair) {
      const pair = this.supportedPairs.find(p => `${p.base}/${p.quote}` === pairKey);
      if (!pair) {
        errors.push(`Unsupported trading pair: ${pairKey}`);
        continue;
      }

      // Check minimum sources requirement
      if (pairData.length < this.priceConfig.minSourcesRequired) {
        errors.push(`Insufficient data sources for ${pairKey}: ${pairData.length} < ${this.priceConfig.minSourcesRequired}`);
        continue;
      }

      // Validate individual price data
      for (const oracleData of pairData) {
        const priceData = oracleData.value;
        
        // Price range validation
        if (priceData.price < pair.minPrice || priceData.price > pair.maxPrice) {
          errors.push(`Price out of range for ${pairKey}: ${priceData.price} (valid: ${pair.minPrice}-${pair.maxPrice})`);
        }

        // Timestamp validation
        const now = Date.now();
        const maxAge = this.priceConfig.maxPriceAge * 1000;
        if (now - priceData.timestamp > maxAge) {
          warnings.push(`Stale data for ${pairKey} from ${priceData.source}: ${now - priceData.timestamp}ms old`);
        }
      }

      // Price deviation validation
      const prices = pairData.map(d => d.value.price);
      const deviation = this.calculateStandardDeviation(prices);
      const mean = prices.reduce((sum, price) => sum + price, 0) / prices.length;
      const deviationPercent = (deviation / mean) * 100;

      if (deviationPercent > this.priceConfig.outlierThreshold * 10) { // 10% threshold
        warnings.push(`High price deviation for ${pairKey}: ${deviationPercent.toFixed(2)}%`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  async processData(data: OracleData<PriceData>[]): Promise<AggregatedPriceData> {
    const dataByPair = this.groupDataByPair(data);
    const aggregatedResults: AggregatedPriceData[] = [];

    for (const [pairKey, pairData] of dataByPair) {
      const pair = this.supportedPairs.find(p => `${p.base}/${p.quote}` === pairKey);
      if (!pair || pairData.length === 0) continue;

      // Remove outliers
      const cleanedData = this.removeOutliers(pairData);
      
      if (cleanedData.length < this.priceConfig.minSourcesRequired) {
        this.logger.warn(`Insufficient data after outlier removal for ${pairKey}`);
        continue;
      }

      // Calculate aggregated price
      const aggregatedPrice = this.aggregatePrices(cleanedData);
      
      aggregatedResults.push(aggregatedPrice);

      // Store for threshold checking
      this.lastPrices.set(pairKey, aggregatedPrice);

      this.metrics.gauge('price_oracle.aggregated_price', aggregatedPrice.price, {
        pair: pairKey
      });
    }

    // For now, return the first aggregated result
    // In a full implementation, you might process multiple pairs
    if (aggregatedResults.length === 0) {
      throw new ValidationError('No valid aggregated price data available');
    }

    return aggregatedResults[0];
  }

  async submitToBlockchain(processedData: AggregatedPriceData): Promise<string> {
    try {
      const pairKey = `${processedData.base}/${processedData.quote}`;
      
      // Check if price change exceeds threshold
      const lastPrice = this.lastPrices.get(pairKey);
      if (lastPrice && !this.shouldUpdate(lastPrice.price, processedData.price)) {
        this.logger.debug(`Price change below threshold for ${pairKey}, skipping blockchain update`);
        return 'skipped';
      }

      // Create transaction data (simplified)
      const transactionData = {
        to: 'oracle_contract_address', // Would be actual contract address
        value: '0',
        data: this.createPriceUpdateData(processedData)
      };

      // Submit to TON blockchain
      const result = await this.tonClient.sendTransaction(transactionData);
      
      this.logger.info(`Price update submitted to blockchain`, {
        pair: pairKey,
        price: processedData.price,
        txHash: result.hash
      });

      this.metrics.increment('price_oracle.blockchain_update', {
        pair: pairKey,
        status: 'success'
      });

      return result.hash;

    } catch (error) {
      this.metrics.increment('price_oracle.blockchain_update', {
        pair: `${processedData.base}/${processedData.quote}`,
        status: 'error'
      });

      throw error;
    }
  }

  protected async getSourcesStatus(): Promise<any[]> {
    const statuses = [];
    
    for (const [name, source] of this.dataSources) {
      try {
        const status = await source.getStatus();
        statuses.push(status);
      } catch (error) {
        statuses.push({
          name,
          isOnline: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    
    return statuses;
  }

  // Public methods for external access
  async getCurrentPrice(base: string, quote: string): Promise<AggregatedPriceData | null> {
    const pairKey = `${base}/${quote}`;
    return this.lastPrices.get(pairKey) || null;
  }

  async getAllCurrentPrices(): Promise<Map<string, AggregatedPriceData>> {
    return new Map(this.lastPrices);
  }

  getSupportedPairs(): TradingPair[] {
    return [...this.supportedPairs];
  }

  // Private helper methods
  private groupDataByPair(data: OracleData<PriceData>[]): Map<string, OracleData<PriceData>[]> {
    const grouped = new Map<string, OracleData<PriceData>[]>();
    
    for (const oracleData of data) {
      const priceData = oracleData.value;
      const pairKey = `${priceData.base}/${priceData.quote}`;
      
      if (!grouped.has(pairKey)) {
        grouped.set(pairKey, []);
      }
      grouped.get(pairKey)!.push(oracleData);
    }
    
    return grouped;
  }

  private removeOutliers(data: OracleData<PriceData>[]): OracleData<PriceData>[] {
    if (data.length <= 2) return data;

    const prices = data.map(d => d.value.price);
    const mean = prices.reduce((sum, price) => sum + price, 0) / prices.length;
    const stdDev = this.calculateStandardDeviation(prices);
    const threshold = this.priceConfig.outlierThreshold;

    return data.filter(d => {
      const zScore = Math.abs((d.value.price - mean) / stdDev);
      return zScore <= threshold;
    });
  }

  private aggregatePrices(data: OracleData<PriceData>[]): AggregatedPriceData {
    const prices = data.map(d => d.value.price);
    const sources = data.map(d => d.source);
    const timestamps = data.map(d => d.value.timestamp);
    
    let aggregatedPrice: number;
    
    switch (this.priceConfig.aggregationMethod) {
      case 'median':
        aggregatedPrice = this.calculateMedian(prices);
        break;
      case 'weighted':
        aggregatedPrice = this.calculateWeightedAverage(data);
        break;
      case 'average':
      default:
        aggregatedPrice = prices.reduce((sum, price) => sum + price, 0) / prices.length;
    }

    const standardDeviation = this.calculateStandardDeviation(prices);
    const firstPrice = data[0].value;

    return {
      base: firstPrice.base,
      quote: firstPrice.quote,
      price: aggregatedPrice,
      timestamp: Math.max(...timestamps),
      sources: [...new Set(sources)],
      sourceCount: data.length,
      standardDeviation,
      confidence: this.calculateConfidence(data),
      outliers: [] // Would contain removed outliers
    };
  }

  private calculateMedian(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    
    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid];
  }

  private calculateWeightedAverage(data: OracleData<PriceData>[]): number {
    let totalWeight = 0;
    let weightedSum = 0;

    for (const oracleData of data) {
      const sourceConfig = this.priceConfig.sources.find(s => s.name === oracleData.source);
      const weight = sourceConfig?.weight || 1;
      
      totalWeight += weight;
      weightedSum += oracleData.value.price * weight;
    }

    return totalWeight > 0 ? weightedSum / totalWeight : 0;
  }

  private calculateStandardDeviation(values: number[]): number {
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
    const variance = squaredDiffs.reduce((sum, diff) => sum + diff, 0) / values.length;
    return Math.sqrt(variance);
  }

  private calculateConfidence(data: OracleData<PriceData>[]): number {
    // Simple confidence calculation based on source count and agreement
    const baseConfidence = Math.min(data.length / this.priceConfig.minSourcesRequired, 1) * 100;
    
    // Reduce confidence based on price variance
    const prices = data.map(d => d.value.price);
    const stdDev = this.calculateStandardDeviation(prices);
    const mean = prices.reduce((sum, price) => sum + price, 0) / prices.length;
    const coefficient = stdDev / mean;
    
    // Higher variance reduces confidence
    const variancePenalty = Math.min(coefficient * 50, 30);
    
    return Math.max(baseConfidence - variancePenalty, 0);
  }

  private shouldUpdate(oldPrice: number, newPrice: number): boolean {
    const changePercent = Math.abs((newPrice - oldPrice) / oldPrice) * 100;
    return changePercent >= this.priceConfig.deviationThreshold;
  }

  private createPriceUpdateData(priceData: AggregatedPriceData): any {
    // This would create the actual contract call data
    // For now, returning a placeholder
    return {
      method: 'updatePrice',
      params: {
        base: priceData.base,
        quote: priceData.quote,
        price: priceData.price,
        timestamp: priceData.timestamp,
        sources: priceData.sources,
        confidence: priceData.confidence
      }
    };
  }
}