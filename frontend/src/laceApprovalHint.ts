/** User-visible Lace steps — each on-chain circuit needs balance + submit in the extension. */
export type LaceApprovalStep =
  | 'submit_order'
  | 'propose_match'
  | 'atomic_settle'
  | 'balance'
  | 'submit';

export function laceApprovalMessage(
  step: LaceApprovalStep,
  opts?: { index?: number; total?: number },
): string {
  const prefix =
    opts?.index !== undefined && opts?.total !== undefined
      ? `Lace approval ${opts.index}/${opts.total}: `
      : 'Check Lace extension — approve ';

  switch (step) {
    case 'submit_order':
      return `${prefix}submit_order (publish your commitment).`;
    case 'propose_match':
      return `${prefix}propose_match (ZK match proof + fee).`;
    case 'atomic_settle':
      return `${prefix}atomic_settle (clear commitments + audit blob).`;
    case 'balance':
      return `${prefix}transaction balancing (fees).`;
    case 'submit':
      return `${prefix}transaction submit.`;
    default:
      return `${prefix}${step}.`;
  }
}

/** Midnight browser dapps cannot sign without the extension — security model. */
export const LACE_SIGNING_EXPLAINER =
  'Each circuit (submit_order, propose_match, atomic_settle) is a separate on-chain transaction. ' +
  'Lace is asked to balance fees and submit for each one (often 2 extension prompts per circuit). ' +
  'ZK proofs usually run on the HTTP proof server — not in Lace. ' +
  'When a cross exists, submitting the second leg auto-runs match + settle (watch the match log; if you only see one Lace prompt, match/settle did not run).';
