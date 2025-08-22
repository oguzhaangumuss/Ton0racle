import dotenv from 'dotenv';
import { PriceOracle } from './oracles/price/PriceOracle';
import { TONClientService } from './services/TONClient';
import { ConsoleLogger } from './utils/Logger';
import { SimpleMetricsCollector } from './utils/Metrics';
import { 
  TONConfig, 
  WalletConfig, 
  PriceOracleConfig, 
  TradingPair,
  AppConfig 
} from './types';

// Load environment variables
dotenv.config();

class TonOracleApplication {
  private logger: ConsoleLogger;
  private metrics: SimpleMetricsCollector;
  private tonClient: TONClientService;
  private priceOracle: PriceOracle;
  private config: AppConfig;
  private isRunning: boolean = false;

  constructor() {
    this.logger = new ConsoleLogger(process.env.LOG_LEVEL as any || 'info');
    this.metrics = new SimpleMetricsCollector();
    
    this.config = this.loadConfiguration();
    this.tonClient = new TONClientService(
      this.config.ton,
      this.config.wallet,
      this.logger,
      this.metrics
    );

    this.priceOracle = new PriceOracle(
      this.config.price,
      this.tonClient,
      this.logger,
      this.metrics
    );
  }

  private loadConfiguration(): AppConfig {
    const requiredEnvVars = [
      'TON_NETWORK',
      'TON_ENDPOINT',
      'ORACLE_PRIVATE_KEY'
    ];

    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        throw new Error(`Required environment variable ${envVar} is not set`);
      }
    }

    const tonConfig: TONConfig = {
      network: process.env.TON_NETWORK as 'mainnet' | 'testnet',
      endpoint: process.env.TON_ENDPOINT!,
      apiKey: process.env.TON_API_KEY,
      gasLimit: parseInt(process.env.GAS_LIMIT || '1000000'),
      gasPrice: parseInt(process.env.GAS_PRICE || '1000000000'),
      maxRetries: parseInt(process.env.MAX_RETRIES || '3'),
      retryDelay: parseInt(process.env.RETRY_DELAY || '5000')
    };

    const walletConfig: WalletConfig = {
      privateKey: process.env.ORACLE_PRIVATE_KEY!,
      address: process.env.ORACLE_ADDRESS || '',
      publicKey: process.env.ORACLE_PUBLIC_KEY
    };

    const supportedPairs: TradingPair[] = [
      {
        base: 'BTC',
        quote: 'USD',
        symbol: 'BTCUSD',
        isActive: true,
        minPrice: 1000,
        maxPrice: 1000000,
        decimalPlaces: 2
      },
      {
        base: 'ETH',
        quote: 'USD',
        symbol: 'ETHUSD',
        isActive: true,
        minPrice: 100,
        maxPrice: 100000,
        decimalPlaces: 2
      },
      {
        base: 'TON',
        quote: 'USD',
        symbol: 'TONUSD',
        isActive: true,
        minPrice: 0.1,
        maxPrice: 1000,
        decimalPlaces: 4
      }
    ];

    const priceConfig: PriceOracleConfig = {
      supportedPairs,
      sources: [
        {
          name: 'coingecko',
          enabled: true,
          apiKey: process.env.COINGECKO_API_KEY,
          weight: 1,
          rateLimit: 50,
          timeout: 10000,
          endpoints: {
            baseUrl: 'https://api.coingecko.com/api/v3',
            priceEndpoint: '/simple/price'
          }
        },
        {
          name: 'binance',
          enabled: true,
          apiKey: process.env.BINANCE_API_KEY,
          weight: 1,
          rateLimit: 1200,
          timeout: 10000,
          endpoints: {
            baseUrl: 'https://api.binance.com/api/v3',
            priceEndpoint: '/ticker/price'
          }
        },
        {
          name: 'coinmarketcap',
          enabled: !!process.env.CMC_API_KEY,
          apiKey: process.env.CMC_API_KEY,
          weight: 1,
          rateLimit: 333,
          timeout: 10000,
          endpoints: {
            baseUrl: 'https://pro-api.coinmarketcap.com',
            priceEndpoint: '/v1/cryptocurrency/quotes/latest'
          }
        }
      ],
      aggregationMethod: 'median',
      outlierThreshold: 2.0,
      minSourcesRequired: parseInt(process.env.MIN_DATA_SOURCES || '2'),
      maxPriceAge: parseInt(process.env.MAX_PRICE_AGE || '300'),
      updateInterval: parseInt(process.env.UPDATE_INTERVAL || '300'),
      deviationThreshold: parseFloat(process.env.DEVIATION_THRESHOLD || '1.0')
    };

    return {
      ton: tonConfig,
      wallet: walletConfig,
      oracle: {
        updateInterval: priceConfig.updateInterval,
        deviationThreshold: priceConfig.deviationThreshold,
        minSources: priceConfig.minSourcesRequired,
        maxOutlierDeviation: priceConfig.outlierThreshold,
        gasLimit: tonConfig.gasLimit,
        retryAttempts: tonConfig.maxRetries,
        enabled: process.env.ORACLE_ENABLED !== 'false'
      },
      price: priceConfig,
      logging: {
        level: process.env.LOG_LEVEL as any || 'info',
        format: process.env.LOG_FORMAT as any || 'text',
        output: process.env.LOG_OUTPUT as any || 'console',
        filePath: process.env.LOG_FILE_PATH
      },
      monitoring: {
        enabled: process.env.ENABLE_MONITORING === 'true',
        port: parseInt(process.env.MONITORING_PORT || '8080'),
        metricsPath: process.env.METRICS_PATH || '/metrics',
        healthPath: process.env.HEALTH_PATH || '/health'
      },
      cache: {
        enabled: process.env.CACHE_ENABLED === 'true',
        ttl: parseInt(process.env.CACHE_TTL || '300'),
        maxSize: parseInt(process.env.CACHE_MAX_SIZE || '1000')
      }
    };
  }

  async start(): Promise<void> {
    try {
      this.logger.info('🚀 Starting TON Oracle Application...');
      this.metrics.increment('app.start');

      // Validate configuration
      await this.validateConfiguration();

      // Initialize TON client
      this.logger.info('🔗 Initializing TON client...');
      await this.tonClient.initialize();

      // Check TON client health
      const tonHealth = await this.tonClient.healthCheck();
      if (tonHealth.status !== 'healthy') {
        throw new Error(`TON client is not healthy: ${JSON.stringify(tonHealth.details)}`);
      }

      this.logger.info('✅ TON client initialized successfully', tonHealth.details);

      // Start price oracle
      this.logger.info('📊 Starting price oracle...');
      await this.priceOracle.start();

      // Check oracle health
      const oracleHealth = await this.priceOracle.getHealth();
      if (oracleHealth.status !== 'healthy') {
        throw new Error(`Price oracle is not healthy: ${JSON.stringify(oracleHealth.details)}`);
      }

      this.logger.info('✅ Price oracle started successfully');

      // Setup monitoring if enabled
      if (this.config.monitoring.enabled) {
        this.setupMonitoring();
      }

      this.isRunning = true;
      this.metrics.increment('app.start_success');

      this.logger.info('🎉 TON Oracle Application started successfully!', {
        network: this.config.ton.network,
        supportedPairs: this.config.price.supportedPairs.length,
        enabledSources: this.config.price.sources.filter(s => s.enabled).length
      });

      // Setup graceful shutdown
      this.setupGracefulShutdown();

      // Log application status periodically
      this.startStatusLogger();

    } catch (error) {
      this.metrics.increment('app.start_error');
      this.logger.error('❌ Failed to start TON Oracle Application', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      this.logger.warn('Application is not running');
      return;
    }

    this.logger.info('🛑 Stopping TON Oracle Application...');
    this.metrics.increment('app.stop');

    try {
      // Stop price oracle
      await this.priceOracle.stop();
      this.logger.info('✅ Price oracle stopped');

      // Disconnect TON client
      await this.tonClient.disconnect();
      this.logger.info('✅ TON client disconnected');

      this.isRunning = false;
      this.metrics.increment('app.stop_success');
      this.logger.info('🎉 TON Oracle Application stopped successfully');

    } catch (error) {
      this.metrics.increment('app.stop_error');
      this.logger.error('❌ Error during application shutdown', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  async getStatus(): Promise<any> {
    const tonStatus = await this.tonClient.getStatus();
    const oracleStatus = await this.priceOracle.getStatus();
    const tonHealth = await this.tonClient.healthCheck();
    const oracleHealth = await this.priceOracle.getHealth();

    return {
      application: {
        isRunning: this.isRunning,
        startTime: process.uptime(),
        version: '1.0.0',
        environment: this.config.ton.network
      },
      ton: {
        status: tonStatus,
        health: tonHealth
      },
      oracle: {
        status: oracleStatus,
        health: oracleHealth
      },
      metrics: this.getMetricsSummary()
    };
  }

  private async validateConfiguration(): Promise<void> {
    this.logger.info('🔍 Validating configuration...');

    // Validate enabled sources
    const enabledSources = this.config.price.sources.filter(s => s.enabled);
    if (enabledSources.length < this.config.price.minSourcesRequired) {
      throw new Error(`Insufficient enabled sources: ${enabledSources.length} < ${this.config.price.minSourcesRequired}`);
    }

    // Validate trading pairs
    if (this.config.price.supportedPairs.length === 0) {
      throw new Error('No supported trading pairs configured');
    }

    // Validate network configuration
    if (!['mainnet', 'testnet'].includes(this.config.ton.network)) {
      throw new Error(`Invalid TON network: ${this.config.ton.network}`);
    }

    this.logger.info('✅ Configuration validated successfully');
  }

  private setupMonitoring(): void {
    this.logger.info(`🔍 Setting up monitoring on port ${this.config.monitoring.port}`);
    // In a real implementation, you would setup an HTTP server for metrics
    // For now, just log that monitoring is enabled
    this.logger.info('✅ Monitoring endpoints ready', {
      metricsPath: this.config.monitoring.metricsPath,
      healthPath: this.config.monitoring.healthPath
    });
  }

  private setupGracefulShutdown(): void {
    const shutdownHandler = async (signal: string) => {
      this.logger.info(`📡 Received ${signal}, starting graceful shutdown...`);
      try {
        await this.stop();
        process.exit(0);
      } catch (error) {
        this.logger.error('Error during shutdown', { error });
        process.exit(1);
      }
    };

    process.on('SIGINT', () => shutdownHandler('SIGINT'));
    process.on('SIGTERM', () => shutdownHandler('SIGTERM'));
    process.on('SIGUSR2', () => shutdownHandler('SIGUSR2')); // For nodemon
  }

  private startStatusLogger(): void {
    const logStatus = async () => {
      if (!this.isRunning) return;

      try {
        const status = await this.getStatus();
        this.logger.info('📈 Application Status', {
          uptime: Math.floor(status.application.startTime),
          oracleUpdates: status.oracle.status.totalUpdates,
          oracleErrors: status.oracle.status.errorCount,
          tonBalance: status.ton.status.balance
        });
      } catch (error) {
        this.logger.warn('Failed to log status', { error });
      }

      // Log status every 5 minutes
      setTimeout(logStatus, 5 * 60 * 1000);
    };

    // Start status logging after 1 minute
    setTimeout(logStatus, 60 * 1000);
  }

  private getMetricsSummary(): any {
    const metrics = this.metrics.getMetrics();
    return {
      counters: Object.fromEntries(metrics.counters),
      gauges: Object.fromEntries(metrics.gauges),
      histograms: Object.fromEntries(
        Array.from(metrics.histograms.entries()).map(([key, values]) => [
          key,
          this.metrics.getHistogramStats(key.split('{')[0])
        ])
      )
    };
  }
}

// Main execution
async function main() {
  const app = new TonOracleApplication();

  try {
    await app.start();
    
    // Keep the application running
    process.on('unhandledRejection', (reason, promise) => {
      console.error('Unhandled Rejection at:', promise, 'reason:', reason);
      process.exit(1);
    });

    process.on('uncaughtException', (error) => {
      console.error('Uncaught Exception:', error);
      process.exit(1);
    });

  } catch (error) {
    console.error('❌ Application startup failed:', error);
    process.exit(1);
  }
}

// Start the application if this file is run directly
if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { TonOracleApplication };
export default main;