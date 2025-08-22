import { OracleConfig, OracleData, ValidationResult, OracleStatus, Logger, MetricsCollector } from '@/types';

export abstract class OracleBase<T = any> {
  protected config: OracleConfig;
  protected isRunning: boolean = false;
  protected logger: Logger;
  protected metrics: MetricsCollector;
  private updateTimer?: NodeJS.Timeout;
  private errorCount: number = 0;
  private totalUpdates: number = 0;
  private lastUpdateTime: number = 0;

  constructor(
    config: OracleConfig, 
    logger: Logger, 
    metrics: MetricsCollector
  ) {
    this.config = config;
    this.logger = logger;
    this.metrics = metrics;
  }

  /**
   * Abstract methods that must be implemented by derived classes
   */
  abstract fetchData(): Promise<OracleData<T>[]>;
  abstract validateData(data: OracleData<T>[]): Promise<ValidationResult>;
  abstract processData(data: OracleData<T>[]): Promise<T>;
  abstract submitToBlockchain(processedData: T): Promise<string>;
  abstract getOracleType(): string;

  /**
   * Start the oracle service
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Oracle is already running');
      return;
    }

    if (!this.config.enabled) {
      this.logger.warn('Oracle is disabled in configuration');
      return;
    }

    this.logger.info(`Starting ${this.getOracleType()} oracle...`);
    this.isRunning = true;
    this.metrics.increment('oracle.start', { type: this.getOracleType() });

    // Perform initial update
    await this.performUpdate();

    // Schedule periodic updates
    this.scheduleUpdates();

    this.logger.info(`${this.getOracleType()} oracle started successfully`);
  }

  /**
   * Stop the oracle service
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      this.logger.warn('Oracle is not running');
      return;
    }

    this.logger.info(`Stopping ${this.getOracleType()} oracle...`);
    this.isRunning = false;

    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
      this.updateTimer = undefined;
    }

    this.metrics.increment('oracle.stop', { type: this.getOracleType() });
    this.logger.info(`${this.getOracleType()} oracle stopped`);
  }

  /**
   * Get current oracle status
   */
  async getStatus(): Promise<OracleStatus> {
    return {
      isActive: this.isRunning,
      lastUpdate: this.lastUpdateTime,
      totalUpdates: this.totalUpdates,
      errorCount: this.errorCount,
      sources: await this.getSourcesStatus()
    };
  }

  /**
   * Update oracle configuration
   */
  updateConfig(newConfig: Partial<OracleConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.logger.info('Oracle configuration updated', { newConfig });
    this.metrics.increment('oracle.config_update', { type: this.getOracleType() });
  }

  /**
   * Force immediate update
   */
  async forceUpdate(): Promise<void> {
    this.logger.info('Forcing oracle update');
    this.metrics.increment('oracle.force_update', { type: this.getOracleType() });
    await this.performUpdate();
  }

  /**
   * Abstract method to get source status
   */
  protected abstract getSourcesStatus(): Promise<any[]>;

  /**
   * Schedule periodic updates
   */
  private scheduleUpdates(): void {
    if (!this.isRunning) return;

    this.updateTimer = setTimeout(async () => {
      try {
        await this.performUpdate();
      } catch (error) {
        this.logger.error('Scheduled update failed', { error });
      }
      this.scheduleUpdates();
    }, this.config.updateInterval * 1000);
  }

  /**
   * Perform oracle update cycle
   */
  private async performUpdate(): Promise<void> {
    const startTime = Date.now();
    
    try {
      this.logger.debug('Starting oracle update cycle');
      this.metrics.increment('oracle.update_start', { type: this.getOracleType() });

      // Step 1: Fetch data from sources
      const rawData = await this.fetchDataWithRetry();
      this.logger.debug(`Fetched data from ${rawData.length} sources`);

      // Step 2: Validate data
      const validation = await this.validateData(rawData);
      if (!validation.isValid) {
        throw new Error(`Data validation failed: ${validation.errors.join(', ')}`);
      }

      if (validation.warnings.length > 0) {
        this.logger.warn('Data validation warnings', { warnings: validation.warnings });
      }

      // Step 3: Process and aggregate data
      const processedData = await this.processData(rawData);
      this.logger.debug('Data processed successfully', { processedData });

      // Step 4: Submit to blockchain
      const txHash = await this.submitToBlockchain(processedData);
      this.logger.info('Data submitted to blockchain', { txHash });

      // Update metrics and state
      this.totalUpdates++;
      this.lastUpdateTime = Date.now();
      
      const duration = Date.now() - startTime;
      this.metrics.timing('oracle.update_duration', duration, { type: this.getOracleType() });
      this.metrics.increment('oracle.update_success', { type: this.getOracleType() });

      this.logger.info('Oracle update completed successfully', { 
        duration, 
        txHash,
        totalUpdates: this.totalUpdates 
      });

    } catch (error) {
      this.errorCount++;
      const duration = Date.now() - startTime;
      
      this.logger.error('Oracle update failed', { 
        error: error instanceof Error ? error.message : String(error),
        duration,
        errorCount: this.errorCount
      });

      this.metrics.increment('oracle.update_error', { 
        type: this.getOracleType(),
        error: error instanceof Error ? error.constructor.name : 'Unknown'
      });
      this.metrics.timing('oracle.update_duration', duration, { 
        type: this.getOracleType(), 
        status: 'error' 
      });

      // Re-throw error if we've exceeded max retries
      if (this.errorCount >= this.config.retryAttempts) {
        this.logger.error('Max error count reached, stopping oracle', { 
          errorCount: this.errorCount,
          maxRetries: this.config.retryAttempts 
        });
        await this.stop();
        throw error;
      }
    }
  }

  /**
   * Fetch data with retry logic
   */
  private async fetchDataWithRetry(): Promise<OracleData<T>[]> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
      try {
        this.logger.debug(`Fetching data (attempt ${attempt}/${this.config.retryAttempts})`);
        return await this.fetchData();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.logger.warn(`Fetch attempt ${attempt} failed`, { error: lastError.message });
        
        if (attempt < this.config.retryAttempts) {
          const delay = this.calculateRetryDelay(attempt);
          this.logger.debug(`Waiting ${delay}ms before retry`);
          await this.sleep(delay);
        }
      }
    }

    throw lastError || new Error('All fetch attempts failed');
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateRetryDelay(attempt: number): number {
    const baseDelay = 1000; // 1 second
    const maxDelay = 30000; // 30 seconds
    const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
    
    // Add some jitter to prevent thundering herd
    const jitter = Math.random() * 0.1 * delay;
    return Math.floor(delay + jitter);
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get oracle health status
   */
  async getHealth(): Promise<{ status: 'healthy' | 'unhealthy' | 'degraded'; details: any }> {
    try {
      const status = await this.getStatus();
      const now = Date.now();
      const timeSinceLastUpdate = now - status.lastUpdate;
      const maxAllowedAge = this.config.updateInterval * 2 * 1000; // 2x update interval

      if (!status.isActive) {
        return {
          status: 'unhealthy',
          details: { reason: 'Oracle is not active', status }
        };
      }

      if (timeSinceLastUpdate > maxAllowedAge) {
        return {
          status: 'degraded',
          details: { reason: 'Last update is stale', timeSinceLastUpdate, maxAllowedAge, status }
        };
      }

      if (status.errorCount > this.config.retryAttempts / 2) {
        return {
          status: 'degraded',
          details: { reason: 'High error rate', status }
        };
      }

      return {
        status: 'healthy',
        details: { status }
      };

    } catch (error) {
      return {
        status: 'unhealthy',
        details: { reason: 'Health check failed', error: error instanceof Error ? error.message : String(error) }
      };
    }
  }
}