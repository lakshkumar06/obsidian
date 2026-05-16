import {
  ZKConfigProvider,
  createProverKey,
  createVerifierKey,
  createZKIR,
} from '@midnight-ntwrk/midnight-js-types';

export type ObsidianCircuitId = 'submit_order' | 'propose_match' | 'atomic_settle';

async function fetchBytes(relPath: string, baseUrl: string): Promise<Uint8Array> {
  const url = `${baseUrl.replace(/\/+$/, '')}/${relPath.replace(/^\/+/, '')}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`ZK asset fetch failed (${res.status}) ${url}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

/** Loads .prover / .verifier / .bzkir from same-origin URLs (served under /zk via Vite public/). */
export class UrlZkConfigProvider extends ZKConfigProvider<ObsidianCircuitId> {
  constructor(private readonly baseUrl: string) {
    super();
  }

  getProverKey(circuitId: ObsidianCircuitId) {
    return fetchBytes(`keys/${circuitId}.prover`, this.baseUrl).then(createProverKey);
  }

  getVerifierKey(circuitId: ObsidianCircuitId) {
    return fetchBytes(`keys/${circuitId}.verifier`, this.baseUrl).then(createVerifierKey);
  }

  getZKIR(circuitId: ObsidianCircuitId) {
    return fetchBytes(`zkir/${circuitId}.bzkir`, this.baseUrl).then(createZKIR);
  }
}
