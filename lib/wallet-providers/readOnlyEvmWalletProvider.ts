// TODO: Improve type safety
/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  createPublicClient,
  http,
  TransactionRequest,
  PublicClient as ViemPublicClient,
  ReadContractParameters,
  ReadContractReturnType,
  Abi,
  ContractFunctionName,
  ContractFunctionArgs,
  Chain,
} from "viem";
import { EvmWalletProvider, NETWORK_ID_TO_VIEM_CHAIN, Network } from "@coinbase/agentkit";

/**
 * Configuration for ReadOnlyEvmWalletProvider.
 */
export interface ReadOnlyEvmWalletProviderConfig {
  /**
   * The network ID (e.g., "base-sepolia", "ethereum-mainnet").
   */
  networkId: string;

  /**
   * Optional RPC URL override. If not provided, uses the default RPC from viem chain config.
   */
  rpcUrl?: string;

  /**
   * Optional wallet address. If provided, this address will be returned by getAddress().
   * Useful for tracking the user's wallet address when preparing transactions for external wallets.
   */
  address?: string;
}

/**
 * ReadOnlyEvmWalletProvider is a wallet provider that only supports read operations.
 * It cannot sign transactions or messages. This is useful for preparing transactions
 * that will be signed by external wallets (e.g., user's browser wallet).
 */
export class ReadOnlyEvmWalletProvider extends EvmWalletProvider {
  #publicClient: ViemPublicClient;
  #chain: Chain;
  #networkId: string;
  #address?: string;

  /**
   * Private constructor. Use `configure()` factory method instead.
   *
   * @param chain - The viem chain.
   * @param networkId - The network ID.
   * @param rpcUrl - Optional RPC URL override.
   * @param address - Optional wallet address.
   */
  private constructor(chain: Chain, networkId: string, rpcUrl?: string, address?: string) {
    super();
    this.#chain = chain;
    this.#networkId = networkId;
    this.#address = address;
    const transport = rpcUrl ? http(rpcUrl) : http();
    this.#publicClient = createPublicClient({
      chain,
      transport,
    }) as unknown as ViemPublicClient;
  }

  /**
   * Factory method to create a ReadOnlyEvmWalletProvider.
   *
   * @param config - Configuration for the wallet provider.
   * @returns A new ReadOnlyEvmWalletProvider instance.
   */
  static configure(config: ReadOnlyEvmWalletProviderConfig): ReadOnlyEvmWalletProvider {
    const chain = NETWORK_ID_TO_VIEM_CHAIN[config.networkId];
    if (!chain) {
      throw new Error(`Unsupported network ID: ${config.networkId}`);
    }

    return new ReadOnlyEvmWalletProvider(chain, config.networkId, config.rpcUrl, config.address);
  }

  /**
   * Gets the wallet address if configured, otherwise returns zero address.
   * When an address is provided in the config, it represents the external wallet address
   * that will sign transactions prepared by this provider.
   *
   * @returns The configured wallet address or zero address if not set.
   */
  getAddress(): string {
    return this.#address || "0x0000000000000000000000000000000000000000";
  }

  /**
   * Gets the network of the wallet provider.
   *
   * @returns The network of the wallet provider.
   */
  getNetwork(): Network {
    return {
      protocolFamily: "evm" as const,
      chainId: String(this.#chain.id),
      networkId: this.#networkId,
    };
  }

  /**
   * Gets the name of the wallet provider.
   *
   * @returns The name of the wallet provider.
   */
  getName(): string {
    return "read_only_evm_wallet_provider";
  }

  /**
   * Gets the Viem PublicClient used for read-only operations.
   *
   * @returns The Viem PublicClient instance.
   */
  getPublicClient(): ViemPublicClient {
    return this.#publicClient;
  }

  /**
   * Gets the balance. This throws an error since read-only provider doesn't have a wallet.
   *
   * @throws Error always, as this is a read-only provider.
   */
  async getBalance(): Promise<bigint> {
    throw new Error(
      "ReadOnlyEvmWalletProvider does not support getBalance. This provider is read-only and does not have a wallet.",
    );
  }

  /**
   * Signs a raw hash. This is not supported for read-only providers.
   *
   * @throws Error always, as this is a read-only provider.
   */
  async sign(_hash: `0x${string}`): Promise<`0x${string}`> {
    throw new Error(
      "ReadOnlyEvmWalletProvider does not support signing. Use an external wallet for signing operations.",
    );
  }

  /**
   * Signs a message. This is not supported for read-only providers.
   *
   * @throws Error always, as this is a read-only provider.
   */
  async signMessage(_message: string | Uint8Array): Promise<`0x${string}`> {
    throw new Error(
      "ReadOnlyEvmWalletProvider does not support signing. Use an external wallet for signing operations.",
    );
  }

  /**
   * Signs typed data. This is not supported for read-only providers.
   *
   * @throws Error always, as this is a read-only provider.
   */
  async signTypedData(_typedData: any): Promise<`0x${string}`> {
    throw new Error(
      "ReadOnlyEvmWalletProvider does not support signing. Use an external wallet for signing operations.",
    );
  }

  /**
   * Signs a transaction. This is not supported for read-only providers.
   *
   * @throws Error always, as this is a read-only provider.
   */
  async signTransaction(_transaction: TransactionRequest): Promise<`0x${string}`> {
    throw new Error(
      "ReadOnlyEvmWalletProvider does not support signing. Use an external wallet for signing operations.",
    );
  }

  /**
   * Sends a transaction. This is not supported for read-only providers.
   *
   * @throws Error always, as this is a read-only provider.
   */
  async sendTransaction(_transaction: TransactionRequest): Promise<`0x${string}`> {
    throw new Error(
      "ReadOnlyEvmWalletProvider does not support sending transactions. Use an external wallet for transaction execution.",
    );
  }

  /**
   * Waits for a transaction receipt.
   *
   * @param txHash - The hash of the transaction to wait for.
   * @returns The transaction receipt.
   */
  async waitForTransactionReceipt(txHash: `0x${string}`): Promise<any> {
    return await this.#publicClient.waitForTransactionReceipt({ hash: txHash });
  }

  /**
   * Reads a contract.
   *
   * @param params - The parameters to read the contract.
   * @returns The response from the contract.
   */
  async readContract<
    const abi extends Abi | readonly unknown[],
    functionName extends ContractFunctionName<abi, "pure" | "view">,
    const args extends ContractFunctionArgs<abi, "pure" | "view", functionName>,
  >(
    params: ReadContractParameters<abi, functionName, args>,
  ): Promise<ReadContractReturnType<abi, functionName, args>> {
    return this.#publicClient.readContract<abi, functionName, args>(params);
  }

  /**
   * Transfer the native asset. This is not supported for read-only providers.
   *
   * @throws Error always, as this is a read-only provider.
   */
  async nativeTransfer(_to: string, _value: string): Promise<string> {
    throw new Error(
      "ReadOnlyEvmWalletProvider does not support native transfers. Use an external wallet for transaction execution.",
    );
  }
}

