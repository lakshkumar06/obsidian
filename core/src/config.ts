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

export type MidnightNetworkName = 'local' | 'preview' | 'preprod';

/** Remote deploy targets (preview / preprod) — not local Docker. */
export function isRemoteMidnightNetwork(networkId: string): boolean {
  return networkId === 'preview' || networkId === 'preprod';
}

function proofServerUrl(hostedDefault: string): string {
  const override = process.env['MIDNIGHT_PROOF_SERVER']?.trim();
  return override && override.length > 0 ? override : hostedDefault;
}

export const LOCAL_CONFIG: NetworkConfig = {
  networkId: 'undeployed',
  walletNetworkId: 'undeployed',
  indexer: 'http://127.0.0.1:8088/api/v4/graphql',
  indexerWS: 'ws://127.0.0.1:8088/api/v4/graphql/ws',
  node: 'http://127.0.0.1:9944',
  nodeWS: 'ws://127.0.0.1:9944',
  proofServer: proofServerUrl('http://127.0.0.1:6300'),
  faucet: '',
};

/**
 * Preview — public testnet (Lace default). Endpoints:
 * https://docs.midnight.network/relnotes/network#preview
 */
export const PREVIEW_CONFIG: NetworkConfig = {
  networkId: 'preview',
  walletNetworkId: 'preview',
  indexer: 'https://indexer.preview.midnight.network/api/v4/graphql',
  indexerWS: 'wss://indexer.preview.midnight.network/api/v4/graphql/ws',
  node: 'https://rpc.preview.midnight.network',
  nodeWS: 'wss://rpc.preview.midnight.network',
  proofServer: proofServerUrl('https://lace-proof-pub.preview.midnight.network'),
  faucet: 'https://faucet.preview.midnight.network/api/request-tokens',
};

/**
 * Preprod — staging before mainnet. Endpoints:
 * https://docs.midnight.network/relnotes/network#preprod
 */
export const PREPROD_CONFIG: NetworkConfig = {
  networkId: 'preprod',
  walletNetworkId: 'preprod',
  indexer: 'https://indexer.preprod.midnight.network/api/v4/graphql',
  indexerWS: 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
  node: 'https://rpc.preprod.midnight.network',
  nodeWS: 'wss://rpc.preprod.midnight.network',
  proofServer: proofServerUrl('https://lace-proof-pub.preprod.midnight.network'),
  faucet: 'https://faucet.preprod.midnight.network/api/request-tokens',
};

export function getConfig(): NetworkConfig {
  const network = (process.env['MIDNIGHT_NETWORK'] ?? 'local') as MidnightNetworkName;
  switch (network) {
    case 'local':
      return LOCAL_CONFIG;
    case 'preview':
      return PREVIEW_CONFIG;
    case 'preprod':
      return PREPROD_CONFIG;
    default:
      throw new Error(
        `Unknown MIDNIGHT_NETWORK: ${network}. Supported: local, preview, preprod`,
      );
  }
}
