export interface OracleConfig {
  updateInterval: number;        // Seconds between updates
  deviationThreshold: number;    // Percentage for threshold updates
  minSources: number;           // Minimum data sources required
  maxOutlierDeviation: number;  // Max deviation before outlier removal
  gasLimit: number;             // Gas limit for transactions
  retryAttempts: number;        // Failed transaction retries
  enabled: boolean;             // Oracle enable/disable flag
}

export interface OracleData<T = any> {
  value: T;
  timestamp: number;
  source: string;
  signature?: string;
  metadata?: Record<string, any>;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface OracleStatus {
  isActive: boolean;
  lastUpdate: number;
  totalUpdates: number;
  errorCount: number;
  sources: SourceStatus[];
}

export interface SourceStatus {
  name: string;
  isOnline: boolean;
  lastSuccessfulFetch: number;
  errorCount: number;
  averageResponseTime: number;
  type?: string;
  rateLimit?: {
    current: number;
    limit: number;
    resetTime: number;
  };
}

export abstract class OracleBase<T = any> {
  protected config: OracleConfig;
  protected isRunning: boolean = false;

  constructor(config: OracleConfig) {
    this.config = config;
  }

  abstract fetchData(): Promise<OracleData<T>[]>;
  abstract validateData(data: OracleData<T>[]): Promise<ValidationResult>;
  abstract processData(data: OracleData<T>[]): Promise<T>;
  abstract submitToBlockchain(processedData: T): Promise<string>;

  async start(): Promise<void> {
    this.isRunning = true;
    this.scheduleUpdates();
  }

  async stop(): Promise<void> {
    this.isRunning = false;
  }

  abstract getStatus(): Promise<OracleStatus>;

  private scheduleUpdates(): void {
    if (!this.isRunning) return;
    
    setTimeout(async () => {
      try {
        await this.performUpdate();
      } catch (error) {
        console.error('Oracle update failed:', error);
      }
      this.scheduleUpdates();
    }, this.config.updateInterval * 1000);
  }

  private async performUpdate(): Promise<void> {
    const data = await this.fetchData();
    const validation = await this.validateData(data);
    
    if (!validation.isValid) {
      throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
    }

    const processedData = await this.processData(data);
    await this.submitToBlockchain(processedData);
  }
}