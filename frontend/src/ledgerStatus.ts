import { ledger } from '@obsidian/managed-contract';
import type { ContractAddress } from '@midnight-ntwrk/compact-runtime';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';

import { hexToBytes32 } from './obsidianBytes';
import type { LedgerOrderStatus, OrderRow } from './types';

export type LedgerPollResult = {
  status: LedgerOrderStatus;
  indexerError: string | null;
};

export async function pollOrderLedgerStatus(
  providers: MidnightProviders,
  contractAddress: ContractAddress,
  order: OrderRow,
): Promise<LedgerPollResult> {
  if (!order.commitmentHex) {
    return {
      status: { ...emptyLedgerStatus(), pollError: 'No commitment hex on row' },
      indexerError: null,
    };
  }

  try {
    const commitment = hexToBytes32(order.commitmentHex);
    const state = await providers.publicDataProvider.queryContractState(contractAddress);
    if (!state) {
      return {
        status: {
          ...emptyLedgerStatus(),
          pollError: 'Indexer returned no contract state',
        },
        indexerError: 'No contract state',
      };
    }

    const view = ledger(state.data);
    const commitmentActive = view.order_commitments.member(commitment);
    const inMatchLog =
      order.side === 'BUY' ? view.match_log.member(commitment) : false;
    let auditPresent = false;
    let auditCiphertext: string | undefined;
    if (order.side === 'BUY') {
      try {
        const ciphertext = view.audit_ciphertexts.lookup(commitment);
        auditPresent = true;
        auditCiphertext = ciphertext;
      } catch {
        auditPresent = false;
      }
    }

    return {
      status: {
        commitmentActive,
        inMatchLog,
        auditPresent,
        auditCiphertext,
        polledAt: new Date().toISOString(),
        pollError: null,
      },
      indexerError: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      status: { ...emptyLedgerStatus(), pollError: msg },
      indexerError: msg,
    };
  }
}

function emptyLedgerStatus(): LedgerOrderStatus {
  return {
    commitmentActive: null,
    inMatchLog: false,
    auditPresent: false,
    polledAt: undefined,
    pollError: null,
  };
}

/** Link SELL rows to BUY peers in the same browser session (contract keys audit by buyer only). */
export function enrichOrderLedgerStatuses(orders: OrderRow[]): OrderRow[] {
  const buyers = orders.filter((o) => o.side === 'BUY' && o.ledgerStatus);

  return orders.map((order) => {
    if (order.side !== 'SELL' || !order.ledgerStatus || !order.assetIdHex) {
      return order;
    }

    const peerBuyers = buyers.filter((b) => b.assetIdHex === order.assetIdHex);
    const settledBuyer = peerBuyers.find((b) => b.ledgerStatus?.auditPresent);
    if (settledBuyer?.ledgerStatus) {
      return {
        ...order,
        ledgerStatus: {
          ...order.ledgerStatus,
          pairedSettled: true,
          pairedBuyerCommitmentHex: settledBuyer.commitmentHex,
          pairedAuditCiphertext: settledBuyer.ledgerStatus.auditCiphertext,
        },
      };
    }

    const matchedBuyer = peerBuyers.find(
      (b) => b.ledgerStatus?.inMatchLog && !b.ledgerStatus?.auditPresent,
    );
    if (matchedBuyer && order.ledgerStatus.commitmentActive) {
      return {
        ...order,
        ledgerStatus: {
          ...order.ledgerStatus,
          pairedMatchPending: true,
          pairedBuyerCommitmentHex: matchedBuyer.commitmentHex,
        },
      };
    }

    return order;
  });
}

export function formatLifecyclePhase(order: OrderRow): string {
  const ls = order.ledgerStatus;
  if (!ls) {
    return order.status || 'submitted';
  }
  if (ls.pollError) {
    return `indexer: ${ls.pollError}`;
  }
  if (ls.auditPresent || ls.pairedSettled) {
    return 'settled (audit on-chain)';
  }
  if (ls.inMatchLog || ls.pairedMatchPending) {
    return 'matched (awaiting settle)';
  }
  if (ls.commitmentActive === true) {
    return 'on-chain (active commitment)';
  }
  if (ls.commitmentActive === false) {
    return 'cleared from order_commitments';
  }
  return order.status || 'unknown';
}
