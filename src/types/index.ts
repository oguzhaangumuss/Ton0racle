// Oracle types
export * from './oracle';

// Price oracle types  
export * from './price';

// Blockchain interaction types
export * from './blockchain';

// Common utility types
export interface Logger {
  info(message: string, meta?: any): void;
  warn(message: string, meta?: any): void;
  error(message: string, meta?: any): void;
  debug(message: string, meta?: any): void;
}

export interface ConfigManager {
  get<T>(key: string): T;
  set<T>(key: string, value: T): void;
  has(key: string): boolean;
  getAll(): Record<string, any>;
}

export interface CacheManager {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  has(key: string): Promise<boolean>;
}

export interface MetricsCollector {
  increment(metric: string, tags?: Record<string, string>): void;
  gauge(metric: string, value: number, tags?: Record<string, string>): void;
  timing(metric: string, duration: number, tags?: Record<string, string>): void;
  histogram(metric: string, value: number, tags?: Record<string, string>): void;
}

export interface HealthCheck {
  name: string;
  status: 'healthy' | 'unhealthy' | 'degraded';
  message?: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface ServiceStatus {
  service: string;
  version: string;
  uptime: number;
  startTime: number;
  healthChecks: HealthCheck[];
  dependencies: Record<string, boolean>;
}

// Error types
export class OracleError extends Error {
  code: string;
  metadata?: any;

  constructor(message: string, code: string, metadata?: any) {
    super(message);
    this.name = 'OracleError';
    this.code = code;
    this.metadata = metadata;
  }
}

export class ValidationError extends OracleError {
  constructor(message: string, metadata?: any) {
    super(message, 'VALIDATION_ERROR', metadata);
    this.name = 'ValidationError';
  }
}

export class NetworkError extends OracleError {
  constructor(message: string, metadata?: any) {
    super(message, 'NETWORK_ERROR', metadata);
    this.name = 'NetworkError';
  }
}

export class ContractError extends OracleError {
  constructor(message: string, metadata?: any) {
    super(message, 'CONTRACT_ERROR', metadata);
    this.name = 'ContractError';
  }
}

// Configuration types
export interface AppConfig {
  ton: TONConfig;
  wallet: WalletConfig;
  oracle: OracleConfig;
  price: PriceOracleConfig;
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    format: 'json' | 'text';
    output: 'console' | 'file' | 'both';
    filePath?: string;
  };
  monitoring: {
    enabled: boolean;
    port: number;
    metricsPath: string;
    healthPath: string;
  };
  cache: {
    enabled: boolean;
    ttl: number;
    maxSize: number;
  };
}