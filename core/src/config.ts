export type NetworkConfig = {
  /** Passed to `setNetworkId` and midnight-js providers */
  networkId: string;
  /** Wallet SDK network (FluentWalletBuilder) */
  walletNetworkId: string;
  indexer: string;
  indexerWS: string;
  node: string;
  nodeWS: string;
  proofServer: string;
  faucet: string;
};

export const LOCAL_CONFIG: NetworkConfig = {
  networkId: 'undeployed',
  walletNetworkId: 'undeployed',
  indexer: 'http://127.0.0.1:8088/api/v4/graphql',
  indexerWS: 'ws://127.0.0.1:8088/api/v4/graphql/ws',
  node: 'http://127.0.0.1:9944',
  nodeWS: 'ws://127.0.0.1:9944',
  proofServer: 'http://127.0.0.1:6300',
  faucet: '',
};

/** Public preprod endpoints — see https://docs.midnight.network/guides/deploy-mn-app */
export const PREPROD_CONFIG: NetworkConfig = {
  networkId: 'preprod',
  walletNetworkId: 'preprod',
  indexer: 'https://indexer.preprod.midnight.network/api/v4/graphql',
  indexerWS: 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
  node: 'https://rpc.preprod.midnight.network',
  nodeWS: 'wss://rpc.preprod.midnight.network',
  proofServer:
    process.env['MIDNIGHT_PROOF_SERVER']?.trim() || 'http://127.0.0.1:6300',
  faucet: 'https://faucet.preprod.midnight.network/api/request-tokens',
};

export type MidnightNetworkName = 'local' | 'preprod';

export function getConfig(): NetworkConfig {
  const network = (process.env['MIDNIGHT_NETWORK'] ?? 'local') as MidnightNetworkName;
  switch (network) {
    case 'local':
      return LOCAL_CONFIG;
    case 'preprod':
      return PREPROD_CONFIG;
    default:
      throw new Error(
        `Unknown MIDNIGHT_NETWORK: ${network}. Supported: local, preprod`,
      );
  }
}
