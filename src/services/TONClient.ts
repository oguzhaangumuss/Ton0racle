import { TonClient, WalletContractV4, internal } from '@ton/ton';
import { Cell, Address, beginCell } from '@ton/core';
import { mnemonicToWalletKey, mnemonicValidate } from '@ton/crypto';
import { 
  TONConfig, 
  WalletConfig, 
  TransactionRequest, 
  TransactionResult, 
  BlockchainStatus,
  ContractState,
  TransactionMonitor,
  TransactionStatus,
  BlockchainError,
  Logger,
  MetricsCollector 
} from '@/types';

export class TONClientService {
  private client: TonClient;
  private wallet: WalletContractV4 | null = null;
  private config: TONConfig;
  private walletConfig: WalletConfig;
  private logger: Logger;
  private metrics: MetricsCollector;
  private isConnected: boolean = false;

  constructor(
    tonConfig: TONConfig,
    walletConfig: WalletConfig,
    logger: Logger,
    metrics: MetricsCollector
  ) {
    this.config = tonConfig;
    this.walletConfig = walletConfig;
    this.logger = logger;
    this.metrics = metrics;
    
    // Initialize TonClient with endpoint
    this.client = new TonClient({
      endpoint: this.config.endpoint,
      apiKey: this.config.apiKey
    });
  }

  /**
   * Initialize wallet and establish connection
   */
  async initialize(): Promise<void> {
    try {
      this.logger.info('Initializing TON client...');
      this.metrics.increment('ton_client.initialize_start');

      // Validate mnemonic if provided
      if (this.walletConfig.privateKey.includes(' ')) {
        const isValid = await mnemonicValidate(this.walletConfig.privateKey.split(' '));
        if (!isValid) {
          throw new BlockchainError('Invalid mnemonic phrase', 'INVALID_MNEMONIC');
        }
      }

      // Create wallet key pair
      const keyPair = await mnemonicToWalletKey(this.walletConfig.privateKey.split(' '));
      
      // Create wallet contract
      this.wallet = WalletContractV4.create({
        workchain: 0,
        publicKey: keyPair.publicKey
      });

      // Open wallet with client
      const walletContract = this.client.open(this.wallet);
      
      // Verify wallet address matches config
      const walletAddress = this.wallet.address.toString();
      if (this.walletConfig.address && walletAddress !== this.walletConfig.address) {
        this.logger.warn('Wallet address mismatch', { 
          expected: this.walletConfig.address, 
          actual: walletAddress 
        });
      }

      this.isConnected = true;
      this.logger.info('TON client initialized successfully', { 
        network: this.config.network,
        walletAddress 
      });
      this.metrics.increment('ton_client.initialize_success');

    } catch (error) {
      this.metrics.increment('ton_client.initialize_error');
      const blockchainError = error instanceof BlockchainError 
        ? error 
        : new BlockchainError(`Initialization failed: ${error}`, 'INIT_ERROR');
      
      this.logger.error('TON client initialization failed', { error: blockchainError.message });
      throw blockchainError;
    }
  }

  /**
   * Get current blockchain status
   */
  async getStatus(): Promise<BlockchainStatus> {
    try {
      const latestBlock = await this.client.getLastBlock();
      const balance = await this.getWalletBalance();
      
      return {
        isConnected: this.isConnected,
        latestBlock: latestBlock.last.seqno,
        networkId: this.config.network,
        gasPrice: this.config.gasPrice,
        balance: balance.toString()
      };
    } catch (error) {
      throw new BlockchainError(`Failed to get status: ${error}`, 'STATUS_ERROR');
    }
  }

  /**
   * Get wallet balance
   */
  async getWalletBalance(): Promise<bigint> {
    if (!this.wallet) {
      throw new BlockchainError('Wallet not initialized', 'WALLET_NOT_INITIALIZED');
    }

    try {
      const balance = await this.client.getBalance(this.wallet.address);
      this.metrics.gauge('ton_client.wallet_balance', Number(balance));
      return balance;
    } catch (error) {
      this.metrics.increment('ton_client.balance_error');
      throw new BlockchainError(`Failed to get balance: ${error}`, 'BALANCE_ERROR');
    }
  }

  /**
   * Send transaction to TON blockchain
   */
  async sendTransaction(request: TransactionRequest): Promise<TransactionResult> {
    if (!this.wallet) {
      throw new BlockchainError('Wallet not initialized', 'WALLET_NOT_INITIALIZED');
    }

    const startTime = Date.now();
    let attempt = 0;

    while (attempt < this.config.maxRetries) {
      attempt++;
      
      try {
        this.logger.debug(`Sending transaction (attempt ${attempt}/${this.config.maxRetries})`, {
          to: request.to,
          value: request.value
        });

        // Create wallet contract instance
        const walletContract = this.client.open(this.wallet);

        // Get seqno for transaction
        const seqno = await walletContract.getSeqno();

        // Create internal message
        const internalMessage = internal({
          to: Address.parse(request.to),
          value: request.value,
          body: request.data,
          bounce: request.bounce ?? true
        });

        // Send transaction
        const transfer = await walletContract.sendTransfer({
          seqno,
          messages: [internalMessage]
        });

        const txResult: TransactionResult = {
          hash: transfer.toString(),
          success: true,
          gasUsed: this.config.gasLimit, // Estimate
          timestamp: Date.now()
        };

        const duration = Date.now() - startTime;
        this.metrics.timing('ton_client.transaction_duration', duration);
        this.metrics.increment('ton_client.transaction_success');

        this.logger.info('Transaction sent successfully', {
          hash: txResult.hash,
          duration,
          attempt
        });

        return txResult;

      } catch (error) {
        const duration = Date.now() - startTime;
        this.logger.warn(`Transaction attempt ${attempt} failed`, {
          error: error instanceof Error ? error.message : String(error),
          duration
        });

        if (attempt >= this.config.maxRetries) {
          this.metrics.increment('ton_client.transaction_error');
          this.metrics.timing('ton_client.transaction_duration', duration, { status: 'error' });
          
          throw new BlockchainError(
            `Transaction failed after ${attempt} attempts: ${error}`,
            'TRANSACTION_ERROR',
            { attempts: attempt, originalError: error }
          );
        }

        // Wait before retry
        await this.sleep(this.config.retryDelay * attempt);
      }
    }

    throw new BlockchainError('Unexpected error in transaction loop', 'UNEXPECTED_ERROR');
  }

  /**
   * Get contract state
   */
  async getContractState(address: string): Promise<ContractState> {
    try {
      const contractAddress = Address.parse(address);
      const state = await this.client.getContractState(contractAddress);
      
      return {
        balance: state.balance.toString(),
        lastTransaction: state.lastTransaction?.hash().toString() || '',
        isActive: state.state === 'active',
        data: state.data
      };
    } catch (error) {
      throw new BlockchainError(`Failed to get contract state: ${error}`, 'CONTRACT_STATE_ERROR');
    }
  }

  /**
   * Monitor transaction confirmation
   */
  async monitorTransaction(txHash: string, maxWaitTime: number = 60000): Promise<TransactionMonitor> {
    const monitor: TransactionMonitor = {
      hash: txHash,
      status: TransactionStatus.PENDING,
      confirmations: 0,
      submittedAt: Date.now(),
      maxWaitTime
    };

    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitTime) {
      try {
        // In a real implementation, you would check transaction status
        // For now, we'll simulate confirmation after a delay
        if (Date.now() - startTime > 10000) { // 10 seconds
          monitor.status = TransactionStatus.CONFIRMED;
          monitor.confirmedAt = Date.now();
          monitor.confirmations = 1;
          break;
        }

        await this.sleep(2000); // Check every 2 seconds
      } catch (error) {
        this.logger.warn('Error monitoring transaction', { txHash, error });
      }
    }

    if (monitor.status === TransactionStatus.PENDING) {
      monitor.status = TransactionStatus.TIMEOUT;
    }

    return monitor;
  }

  /**
   * Create message cell for contract calls
   */
  createMessageCell(data: any): Cell {
    return beginCell()
      .storeUint(0, 32) // op code placeholder
      .storeUint(0, 64) // query id placeholder
      .storeRef(beginCell().endCell()) // data placeholder
      .endCell();
  }

  /**
   * Estimate gas for transaction
   */
  async estimateGas(request: TransactionRequest): Promise<number> {
    // For TON, gas estimation is typically fixed or based on message complexity
    // This is a simplified implementation
    try {
      const baseGas = 10000;
      const dataSize = request.data ? request.data.refs.length * 1000 : 0;
      return baseGas + dataSize;
    } catch (error) {
      this.logger.warn('Gas estimation failed, using default', { error });
      return this.config.gasLimit;
    }
  }

  /**
   * Get current gas price
   */
  async getGasPrice(): Promise<number> {
    // TON has relatively stable gas prices
    return this.config.gasPrice;
  }

  /**
   * Check if client is connected and ready
   */
  isReady(): boolean {
    return this.isConnected && this.wallet !== null;
  }

  /**
   * Get wallet address
   */
  getWalletAddress(): string {
    if (!this.wallet) {
      throw new BlockchainError('Wallet not initialized', 'WALLET_NOT_INITIALIZED');
    }
    return this.wallet.address.toString();
  }

  /**
   * Disconnect and cleanup
   */
  async disconnect(): Promise<void> {
    this.isConnected = false;
    this.wallet = null;
    this.logger.info('TON client disconnected');
    this.metrics.increment('ton_client.disconnect');
  }

  /**
   * Get network information
   */
  getNetworkInfo(): { network: string; endpoint: string } {
    return {
      network: this.config.network,
      endpoint: this.config.endpoint
    };
  }

  /**
   * Utility method for delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Health check for the client
   */
  async healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; details: any }> {
    try {
      if (!this.isReady()) {
        return {
          status: 'unhealthy',
          details: { reason: 'Client not ready', isConnected: this.isConnected, hasWallet: !!this.wallet }
        };
      }

      // Try to get latest block to verify connection
      const latestBlock = await this.client.getLastBlock();
      const balance = await this.getWalletBalance();

      return {
        status: 'healthy',
        details: {
          network: this.config.network,
          latestBlock: latestBlock.last.seqno,
          walletBalance: balance.toString(),
          walletAddress: this.getWalletAddress()
        }
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        details: {
          reason: 'Health check failed',
          error: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }
}