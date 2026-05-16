const CONTRACT_LS_KEY = 'obsidian.ui.contractAddress.v1';

/** From Vite (`OBSIDIAN_CONTRACT_ADDRESS` or `VITE_OBSIDIAN_CONTRACT_ADDRESS` in monorepo `.env`). */
export function contractAddressFromEnv(): string {
  return import.meta.env.VITE_OBSIDIAN_CONTRACT_ADDRESS?.trim() ?? '';
}

function readStoredContractAddress(): string {
  if (typeof window === 'undefined') {
    return '';
  }
  try {
    return window.localStorage.getItem(CONTRACT_LS_KEY) ?? '';
  } catch {
    return '';
  }
}

/** Env wins over localStorage so `.env` is the single source for local dev. */
export function resolveInitialContractAddress(): string {
  const fromEnv = contractAddressFromEnv();
  if (fromEnv.length > 0) {
    return fromEnv;
  }
  return readStoredContractAddress();
}

export function persistContractAddress(value: string): void {
  try {
    window.localStorage.setItem(CONTRACT_LS_KEY, value);
  } catch {
    /* ignore quota / private mode */
  }
}

export function contractAddressConfiguredViaEnv(): boolean {
  return contractAddressFromEnv().length > 0;
}
