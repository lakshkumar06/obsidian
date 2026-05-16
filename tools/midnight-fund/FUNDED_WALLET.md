# Funded dev wallets (local undeployed)

**LOCAL DEV ONLY** — do not use on mainnet.

Lace: **Undeployed** profile, indexer `http://127.0.0.1:8088/api/v4/graphql`, node `http://127.0.0.1:9944`.

---

## Wallet A — ObsidianBrowser (first side)

**Mnemonic:**

```
abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art
```

| Field | Value |
|-------|--------|
| Unshielded | `mn_addr_undeployed19kxg8sxrsty37elmm6yd68tuy7prryjst2r48eapf2fdtd8z4gpqauuvtx` |
| DUST | `mn_dust_undeployed1wwd54rhuw4nqajtn34qjslfk0hdc6jlspdkqvvlmmjrsuckpzurpwkns5qg` |

---

## Wallet B — ObsidianBrowserB (second side) ← use in incognito

**Mnemonic:**

```
zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo vote
```

| Field | Value |
|-------|--------|
| Unshielded | `mn_addr_undeployed1z7k7swt4cwxaq3px2gemzpqhtcjm5dvg9a5vmr2h3kc24n66u4tqsnwyn0` |
| DUST | `mn_dust_undeployed1wv366gqlcfy9p2fstxl95h98zxjlf8a3qmj28qwxwt88rjumzh4qyj66lrt` |

Both have ~50,000 NIGHT + DUST for fees.

---

## Two-sided UI test

1. **Normal window:** Lace → restore **Wallet A** → submit order.
2. **Incognito:** Lace extension → restore **Wallet B** → same contract address → submit order.

Re-fund: `./tools/midnight-fund/fund.sh`
