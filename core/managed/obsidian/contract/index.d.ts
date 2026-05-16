import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Witnesses<PS> = {
}

export type ImpureCircuits<PS> = {
  submit_order(context: __compactRuntime.CircuitContext<PS>,
               commitment_0: Uint8Array,
               nullifier_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  propose_match(context: __compactRuntime.CircuitContext<PS>,
                buyer_commitment_0: Uint8Array,
                seller_commitment_0: Uint8Array,
                buyer_max_price_0: bigint,
                seller_min_price_0: bigint,
                buyer_asset_0: Uint8Array,
                seller_asset_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  atomic_settle(context: __compactRuntime.CircuitContext<PS>,
                buyer_commitment_0: Uint8Array,
                seller_commitment_0: Uint8Array,
                encrypted_compliance_data_0: string): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  submit_order(context: __compactRuntime.CircuitContext<PS>,
               commitment_0: Uint8Array,
               nullifier_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  propose_match(context: __compactRuntime.CircuitContext<PS>,
                buyer_commitment_0: Uint8Array,
                seller_commitment_0: Uint8Array,
                buyer_max_price_0: bigint,
                seller_min_price_0: bigint,
                buyer_asset_0: Uint8Array,
                seller_asset_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  atomic_settle(context: __compactRuntime.CircuitContext<PS>,
                buyer_commitment_0: Uint8Array,
                seller_commitment_0: Uint8Array,
                encrypted_compliance_data_0: string): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
}

export type Circuits<PS> = {
  submit_order(context: __compactRuntime.CircuitContext<PS>,
               commitment_0: Uint8Array,
               nullifier_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  propose_match(context: __compactRuntime.CircuitContext<PS>,
                buyer_commitment_0: Uint8Array,
                seller_commitment_0: Uint8Array,
                buyer_max_price_0: bigint,
                seller_min_price_0: bigint,
                buyer_asset_0: Uint8Array,
                seller_asset_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  atomic_settle(context: __compactRuntime.CircuitContext<PS>,
                buyer_commitment_0: Uint8Array,
                seller_commitment_0: Uint8Array,
                encrypted_compliance_data_0: string): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  order_commitments: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<[Uint8Array, boolean]>
  };
  nullifiers: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<Uint8Array>
  };
  match_log: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<[Uint8Array, boolean]>
  };
  audit_ciphertexts: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): string;
    [Symbol.iterator](): Iterator<[Uint8Array, string]>
  };
  readonly regulator_pk: Uint8Array;
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
