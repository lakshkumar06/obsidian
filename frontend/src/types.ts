export type OrderSide = 'BUY' | 'SELL';

export type LedgerOrderStatus = {
  /** `order_commitments` still lists this commitment as active */
  commitmentActive: boolean | null;
  /** Buyer commitment anchor in `match_log` (seller rows stay false here) */
  inMatchLog: boolean;
  /** `audit_ciphertexts` entry keyed by buyer commitment */
  auditPresent: boolean;
  auditCiphertext?: string;
  /** SELL leg: paired BUY row in this session has `match_log` (on-chain anchor is buyer commitment) */
  pairedMatchPending?: boolean;
  /** SELL leg: paired BUY row settled — seller commitment cleared by `atomic_settle` */
  pairedSettled?: boolean;
  pairedBuyerCommitmentHex?: string;
  pairedAuditCiphertext?: string;
  polledAt?: string;
  pollError: string | null;
};

export type OrderQueueStatus = 'queued' | 'matching' | 'settling';

export type OrderRow = {
  /** UI-only row identifier */
  id: string;
  asset: string;
  qty: string;
  price: string;
  side: OrderSide;
  /** Off-chain matching pool state (relayer-driven) */
  queueStatus?: OrderQueueStatus;
  counterpartyOrderId?: string;
  matchError?: string;
  /** SHA-256 asset id hex used for relayer / propose_match */
  assetIdHex?: string;
  /** BUY max price / SELL min price (uint64 string for JSON) */
  boundPrice?: string;
  status: string;
  /** 32-byte order commitment hex actually written by `submit_order` */
  commitmentHex?: string;
  nullifierHex?: string;
  /** Finalized transaction id from Lace / indexer observation */
  txId?: string;
  /** Last indexer-backed lifecycle snapshot */
  ledgerStatus?: LedgerOrderStatus;
  submitError?: string;
  createdAt?: string;
};
