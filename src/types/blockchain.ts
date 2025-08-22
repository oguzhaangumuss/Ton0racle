import { Address, Cell, Contract } from '@ton/core';
import { PriceHistory } from './price';

export interface TONConfig {
  network: 'mainnet' | 'testnet';
  endpoint: string;
  apiKey?: string;
  gasLimit: number;
  gasPrice: number;
  maxRetries: number;
  retryDelay: number;
}

export interface WalletConfig {
  privateKey: string;
  address: string;
  publicKey?: string;
}

export interface ContractConfig {
  address: string;
  abi?: any;
  code?: Cell;
}

export interface TransactionRequest {
  to: string;
  value: string;
  data?: Cell;
  bounce?: boolean;
}

export interface TransactionResult {
  hash: string;
  success: boolean;
  gasUsed: number;
  blockNumber?: number;
  timestamp: number;
  error?: string;
}

export interface BlockchainStatus {
  isConnected: boolean;
  latestBlock: number;
  networkId: string;
  gasPrice: number;
  balance: string;
}

export interface ContractState {
  balance: string;
  lastTransaction: string;
  isActive: boolean;
  data?: any;
}

export interface OracleContractMethods {
  updatePrice(base: string, quote: string, price: number, timestamp: number): Promise<TransactionResult>;
  getPrice(base: string, quote: string): Promise<{ price: number; timestamp: number }>;
  getPriceHistory(base: string, quote: string, limit: number): Promise<PriceHistory>;
  addAuthorizedOracle(address: string): Promise<TransactionResult>;
  removeAuthorizedOracle(address: string): Promise<TransactionResult>;
  pause(): Promise<TransactionResult>;
  unpause(): Promise<TransactionResult>;
}

export interface EventFilter {
  fromBlock?: number;
  toBlock?: number;
  address?: string;
  topics?: string[];
}

export interface ContractEvent {
  eventName: string;
  blockNumber: number;
  transactionHash: string;
  timestamp: number;
  args: Record<string, any>;
}

export interface GasEstimate {
  gasLimit: number;
  gasPrice: number;
  totalCost: string;
}

export enum TransactionStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  FAILED = 'failed',
  TIMEOUT = 'timeout'
}

export interface TransactionMonitor {
  hash: string;
  status: TransactionStatus;
  confirmations: number;
  submittedAt: number;
  confirmedAt?: number;
  maxWaitTime: number;
}

export interface BlockchainError extends Error {
  code: string;
  txHash?: string;
  blockNumber?: number;
  gasUsed?: number;
  reason?: string;
}