import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { 
  PriceData, 
  PriceSource, 
  TradingPair, 
  SourceStatus, 
  PriceSourceType,
  Logger, 
  MetricsCollector,
  NetworkError 
} from '@/types';

export abstract class DataFetcher implements PriceSource {
  protected client: AxiosInstance;
  protected config: {
    baseUrl: string;
    apiKey?: string;
    timeout: number;
    rateLimit: number;
  };
  protected logger: Logger;
  protected metrics: MetricsCollector;
  protected requestCount: number = 0;
  protected lastRequestTime: number = 0;
  protected errorCount: number = 0;

  abstract name: string;
  abstract isOnline: boolean;

  constructor(
    config: { baseUrl: string; apiKey?: string; timeout?: number; rateLimit?: number },
    logger: Logger,
    metrics: MetricsCollector
  ) {
    this.config = {
      timeout: 10000,
      rateLimit: 60, // requests per minute
      ...config
    };
    this.logger = logger;
    this.metrics = metrics;

    this.client = axios.create({
      baseURL: this.config.baseUrl,
      timeout: this.config.timeout,
      headers: {
        'User-Agent': 'TonOracle/1.0.0',
        'Accept': 'application/json',
        ...(this.config.apiKey && { 'X-API-Key': this.config.apiKey })
      }
    });

    this.setupInterceptors();
  }

  abstract fetchPrice(base: string, quote: string): Promise<PriceData>;
  abstract fetchMultiplePrices(pairs: TradingPair[]): Promise<PriceData[]>;
  abstract getSupportedPairs(): Promise<TradingPair[]>;

  async getStatus(): Promise<SourceStatus> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    const isOnline = await this.checkConnection();

    return {
      name: this.name,
      type: 'cex',
      isOnline,
      lastSuccessfulFetch: this.lastRequestTime,
      errorCount: this.errorCount,
      averageResponseTime: 0, // Would need to track this
      rateLimit: {
        current: this.requestCount,
        limit: this.config.rateLimit,
        resetTime: now + (60 * 1000) // Reset every minute
      }
    };
  }

  protected async makeRequest<T>(config: AxiosRequestConfig): Promise<T> {
    await this.checkRateLimit();
    
    const startTime = Date.now();
    
    try {
      this.requestCount++;
      this.lastRequestTime = Date.now();
      
      const response = await this.client.request<T>(config);
      const duration = Date.now() - startTime;
      
      this.metrics.timing(`data_fetcher.request_duration`, duration, { 
        source: this.name,
        status: 'success'
      });
      this.metrics.increment(`data_fetcher.request_success`, { source: this.name });
      
      this.logger.debug(`Request successful for ${this.name}`, { 
        url: config.url,
        duration 
      });
      
      return response.data;
      
    } catch (error) {
      this.errorCount++;
      const duration = Date.now() - startTime;
      
      this.metrics.timing(`data_fetcher.request_duration`, duration, { 
        source: this.name,
        status: 'error'
      });
      this.metrics.increment(`data_fetcher.request_error`, { source: this.name });
      
      const networkError = new NetworkError(
        `Request failed for ${this.name}: ${error}`,
        { source: this.name, config, originalError: error }
      );
      
      this.logger.error(`Request failed for ${this.name}`, { 
        error: networkError.message,
        duration 
      });
      
      throw networkError;
    }
  }

  protected async checkConnection(): Promise<boolean> {
    try {
      await this.client.get('/ping', { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  private async checkRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    const minInterval = (60 * 1000) / this.config.rateLimit; // ms between requests
    
    if (timeSinceLastRequest < minInterval) {
      const waitTime = minInterval - timeSinceLastRequest;
      this.logger.debug(`Rate limiting: waiting ${waitTime}ms`, { source: this.name });
      await this.sleep(waitTime);
    }
  }

  private setupInterceptors(): void {
    this.client.interceptors.response.use(
      (response) => {
        this.metrics.increment('data_fetcher.response_success', { source: this.name });
        return response;
      },
      (error) => {
        this.metrics.increment('data_fetcher.response_error', { 
          source: this.name,
          status: error.response?.status || 'network_error'
        });
        return Promise.reject(error);
      }
    );
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  protected validatePriceData(data: Partial<PriceData>): PriceData {
    if (!data.base || !data.quote || typeof data.price !== 'number') {
      throw new Error('Invalid price data structure');
    }

    if (data.price <= 0) {
      throw new Error('Price must be positive');
    }

    if (!data.timestamp) {
      data.timestamp = Date.now();
    }

    return {
      base: data.base,
      quote: data.quote,
      price: data.price,
      timestamp: data.timestamp,
      source: this.name,
      volume24h: data.volume24h,
      change24h: data.change24h,
      marketCap: data.marketCap,
      confidence: data.confidence || 100
    };
  }
}

// CoinGecko Implementation
export class CoinGeckoFetcher extends DataFetcher {
  name = 'coingecko';
  isOnline = true;

  private coinIdMap: Map<string, string> = new Map([
    ['BTC', 'bitcoin'],
    ['ETH', 'ethereum'],
    ['TON', 'the-open-network'],
    ['USDT', 'tether']
  ]);

  async fetchPrice(base: string, quote: string): Promise<PriceData> {
    const coinId = this.coinIdMap.get(base.toUpperCase());
    if (!coinId) {
      throw new Error(`Unsupported coin: ${base}`);
    }

    const response = await this.makeRequest({
      url: '/simple/price',
      params: {
        ids: coinId,
        vs_currencies: quote.toLowerCase(),
        include_24hr_vol: true,
        include_24hr_change: true,
        include_market_cap: true
      }
    });

    const coinData = response[coinId];
    if (!coinData) {
      throw new Error(`No data found for ${base}/${quote}`);
    }

    return this.validatePriceData({
      base: base.toUpperCase(),
      quote: quote.toUpperCase(),
      price: coinData[quote.toLowerCase()],
      volume24h: coinData[`${quote.toLowerCase()}_24h_vol`],
      change24h: coinData[`${quote.toLowerCase()}_24h_change`],
      marketCap: coinData[`${quote.toLowerCase()}_market_cap`],
      timestamp: Date.now(),
      confidence: 95
    });
  }

  async fetchMultiplePrices(pairs: TradingPair[]): Promise<PriceData[]> {
    const results: PriceData[] = [];
    
    for (const pair of pairs) {
      try {
        const priceData = await this.fetchPrice(pair.base, pair.quote);
        results.push(priceData);
      } catch (error) {
        this.logger.warn(`Failed to fetch ${pair.base}/${pair.quote} from CoinGecko`, { error });
      }
    }
    
    return results;
  }

  async getSupportedPairs(): Promise<TradingPair[]> {
    return Array.from(this.coinIdMap.keys()).map(base => ({
      base,
      quote: 'USD',
      symbol: `${base}USD`,
      isActive: true,
      minPrice: 0.000001,
      maxPrice: 1000000,
      decimalPlaces: 6
    }));
  }
}

// Binance Implementation  
export class BinanceFetcher extends DataFetcher {
  name = 'binance';
  isOnline = true;

  async fetchPrice(base: string, quote: string): Promise<PriceData> {
    const symbol = `${base.toUpperCase()}${quote.toUpperCase()}`;
    
    const [priceResponse, statsResponse] = await Promise.all([
      this.makeRequest<{price: string}>({
        url: '/ticker/price',
        params: { symbol }
      }),
      this.makeRequest<{volume: string, priceChangePercent: string}>({
        url: '/ticker/24hr',
        params: { symbol }
      })
    ]);

    return this.validatePriceData({
      base: base.toUpperCase(),
      quote: quote.toUpperCase(),
      price: parseFloat(priceResponse.price),
      volume24h: parseFloat(statsResponse.volume),
      change24h: parseFloat(statsResponse.priceChangePercent),
      timestamp: Date.now(),
      confidence: 98
    });
  }

  async fetchMultiplePrices(pairs: TradingPair[]): Promise<PriceData[]> {
    const symbols = pairs.map(p => `${p.base.toUpperCase()}${p.quote.toUpperCase()}`);
    
    const response = await this.makeRequest<Array<{symbol: string, price: string}>>({
      url: '/ticker/price',
      params: { symbols: JSON.stringify(symbols) }
    });

    return response.map((item: any) => {
      const base = item.symbol.slice(0, -4); // Assuming quote is always 4 chars (USDT)
      const quote = item.symbol.slice(-4);
      
      return this.validatePriceData({
        base,
        quote,
        price: parseFloat(item.price),
        timestamp: Date.now(),
        confidence: 98
      });
    });
  }

  async getSupportedPairs(): Promise<TradingPair[]> {
    const response = await this.makeRequest<{symbols: any[]}>({
      url: '/exchangeInfo'
    });

    return response.symbols
      .filter((s: any) => s.status === 'TRADING')
      .map((s: any) => ({
        base: s.baseAsset,
        quote: s.quoteAsset,
        symbol: s.symbol,
        isActive: true,
        minPrice: parseFloat(s.filters.find((f: any) => f.filterType === 'PRICE_FILTER')?.minPrice || '0'),
        maxPrice: parseFloat(s.filters.find((f: any) => f.filterType === 'PRICE_FILTER')?.maxPrice || '1000000'),
        decimalPlaces: s.quotePrecision
      }));
  }
}

// CoinMarketCap Implementation
export class CoinMarketCapFetcher extends DataFetcher {
  name = 'coinmarketcap';
  isOnline = true;

  private symbolIdMap: Map<string, number> = new Map([
    ['BTC', 1],
    ['ETH', 1027],
    ['TON', 11419],
    ['USDT', 825]
  ]);

  async fetchPrice(base: string, quote: string): Promise<PriceData> {
    const id = this.symbolIdMap.get(base.toUpperCase());
    if (!id) {
      throw new Error(`Unsupported coin: ${base}`);
    }

    const response = await this.makeRequest<{data: any}>({
      url: '/v1/cryptocurrency/quotes/latest',
      params: {
        id: id.toString(),
        convert: quote.toUpperCase()
      }
    });

    const coinData = response.data[id];
    const quoteData = coinData.quote[quote.toUpperCase()];

    return this.validatePriceData({
      base: base.toUpperCase(),
      quote: quote.toUpperCase(),
      price: quoteData.price,
      volume24h: quoteData.volume_24h,
      change24h: quoteData.percent_change_24h,
      marketCap: quoteData.market_cap,
      timestamp: new Date(coinData.last_updated).getTime(),
      confidence: 96
    });
  }

  async fetchMultiplePrices(pairs: TradingPair[]): Promise<PriceData[]> {
    const results: PriceData[] = [];
    
    for (const pair of pairs) {
      try {
        const priceData = await this.fetchPrice(pair.base, pair.quote);
        results.push(priceData);
      } catch (error) {
        this.logger.warn(`Failed to fetch ${pair.base}/${pair.quote} from CoinMarketCap`, { error });
      }
    }
    
    return results;
  }

  async getSupportedPairs(): Promise<TradingPair[]> {
    return Array.from(this.symbolIdMap.keys()).map(base => ({
      base,
      quote: 'USD',
      symbol: `${base}USD`,
      isActive: true,
      minPrice: 0.000001,
      maxPrice: 1000000,
      decimalPlaces: 6
    }));
  }
}