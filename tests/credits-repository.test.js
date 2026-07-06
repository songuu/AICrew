import test from "node:test";
import assert from "node:assert/strict";
import { createSeededCreditSystemWallet } from "../lib/credit-system.js";
import { normalizeCreditWalletFromWorkspace } from "../lib/db/repositories/credits.js";

test("normalizeCreditWalletFromWorkspace does not mark an already normalized wallet dirty", () => {
  const wallet = createSeededCreditSystemWallet({
    id: "wallet_default",
    workspaceId: "default",
    initialCredits: 10000,
    label: "Server wallet seed",
    idempotencyKey: "grant:default:server-seed"
  });
  const result = normalizeCreditWalletFromWorkspace("default", {
    credits: 10000,
    payload: { creditSystemWallet: wallet }
  });

  assert.equal(result.dirty, false);
  assert.equal(result.wallet.availableCredits, 10000);
});

test("normalizeCreditWalletFromWorkspace marks missing or scalar wallets dirty for writeback", () => {
  const missing = normalizeCreditWalletFromWorkspace("default", { credits: 10000, payload: {} });
  const scalar = normalizeCreditWalletFromWorkspace("default", {
    credits: 10000,
    payload: {
      creditSystemWallet: {
        id: "wallet_default",
        workspaceId: "default",
        availableCredits: 10000,
        reservedCredits: 0,
        buckets: [],
        transactions: []
      }
    }
  });

  assert.equal(missing.dirty, true);
  assert.equal(scalar.dirty, true);
  assert.ok(missing.wallet.buckets.length > 0);
  assert.ok(scalar.wallet.buckets.length > 0);
});
