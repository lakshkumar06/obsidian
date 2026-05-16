/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MIDNIGHT_NETWORK_ID?: string;
  /** From monorepo `.env` `OBSIDIAN_CONTRACT_ADDRESS` (injected by Vite config). */
  readonly VITE_OBSIDIAN_CONTRACT_ADDRESS?: string;
  /** Override proof-server base URL (default dev: same-origin /midnight-proof via Vite proxy). */
  readonly VITE_PROOF_SERVER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
