import test from "node:test";
import assert from "node:assert/strict";
import {
  CreditAccountingError,
  createCreditWallet,
  reconcileWallet,
  releaseReservation,
  reserveCredits,
  settleReservation
} from "../lib/credits.js";
import {
  buildCreditWalletOverview,
  claimDailyRefresh,
  claimSignupBonus,
  createCreditSystemWallet,
  createSeededCreditSystemWallet,
  ensureCreditSystemDefaultGrant,
  creditMembershipPlans,
  creditTopupProducts,
  getCreditCatalog,
  getDailyCheckInState,
  grantCreditBucket,
  reconcileCreditSystemWallet,
  releaseCreditReservation,
  reserveCreditAmount,
  settleCreditReservation
} from "../lib/credit-system.js";

test("reserve then partial settle consumes actual amount and returns unused credits", () => {
  const wallet = createCreditWallet({ id: "wallet-1", available: 100 });

  const reserved = reserveCredits(wallet, {
    amount: 50,
    reservationId: "reservation-1",
    idempotencyKey: "reserve:reservation-1"
  });

  assert.equal(reserved.wallet.available, 50);
  assert.equal(reserved.wallet.reserved, 50);
  assert.equal(reserved.reservation.status, "reserved");
  assert.equal(reserved.reservation.amountReserved, 50);
  assert.equal(reserved.ledgerEntry.type, "reserve");
  assert.equal(reserved.ledgerEntry.status, "pending");
  assert.equal(reserved.ledgerEntry.amount, -50);
  assert.equal(reserved.ledgerEntry.balanceAfter, 100);
  assert.equal(reserved.ledgerEntry.reservedAfter, 50);

  const settled = settleReservation(reserved.wallet, "reservation-1", { actualAmount: 30 });

  assert.equal(settled.wallet.available, 70);
  assert.equal(settled.wallet.reserved, 0);
  assert.equal(settled.reservation.status, "settled");
  assert.equal(settled.reservation.amountSettled, 30);
  assert.equal(settled.settledAmount, 30);
  assert.equal(settled.releasedAmount, 20);
  assert.equal(settled.ledgerEntry.type, "settle");
  assert.equal(settled.ledgerEntry.status, "posted");
  assert.equal(settled.ledgerEntry.amount, -30);
  assert.equal(settled.ledgerEntry.balanceAfter, 70);
  assert.equal(settled.ledgerEntry.reservedAfter, 0);
  assert.equal(wallet.available, 100);
  assert.equal(wallet.reserved, 0);

  assert.doesNotThrow(() => reconcileWallet(settled.wallet));
});

test("release returns the full reserved amount and writes a release ledger entry", () => {
  const wallet = createCreditWallet({ id: "wallet-2", available: 80 });
  const reserved = reserveCredits(wallet, { amount: 35, reservationId: "reservation-2" });

  const released = releaseReservation(reserved.wallet, "reservation-2");

  assert.equal(released.wallet.available, 80);
  assert.equal(released.wallet.reserved, 0);
  assert.equal(released.reservation.status, "released");
  assert.equal(released.releasedAmount, 35);
  assert.equal(released.ledgerEntry.type, "release");
  assert.equal(released.ledgerEntry.status, "posted");
  assert.equal(released.ledgerEntry.amount, 35);
  assert.equal(released.ledgerEntry.balanceAfter, 80);
  assert.equal(released.ledgerEntry.reservedAfter, 0);
  assert.doesNotThrow(() => reconcileWallet(released.wallet));
});

test("reserve throws contextual error when available credits are insufficient", () => {
  const wallet = createCreditWallet({ id: "wallet-3", available: 10 });

  assert.throws(
    () => reserveCredits(wallet, { amount: 11, reservationId: "reservation-3" }),
    error => {
      assert.ok(error instanceof CreditAccountingError);
      assert.equal(error.code, "INSUFFICIENT_CREDITS");
      assert.equal(error.context.walletId, "wallet-3");
      assert.equal(error.context.requestedAmount, 11);
      assert.equal(error.context.available, 10);
      assert.equal(error.context.reserved, 0);
      return true;
    }
  );
});

test("settle and release are idempotent after a reservation reaches a terminal state", () => {
  const wallet = createCreditWallet({ id: "wallet-4", available: 100 });
  const reserved = reserveCredits(wallet, { amount: 60, reservationId: "reservation-4" });
  const settled = settleReservation(reserved.wallet, "reservation-4", { actualAmount: 40 });
  const repeatedSettle = settleReservation(settled.wallet, "reservation-4", { actualAmount: 60 });
  const lateRelease = releaseReservation(repeatedSettle.wallet, "reservation-4");

  assert.equal(repeatedSettle.idempotent, true);
  assert.equal(repeatedSettle.wallet.available, 60);
  assert.equal(repeatedSettle.wallet.reserved, 0);
  assert.equal(repeatedSettle.wallet.ledger.length, 2);
  assert.equal(lateRelease.idempotent, true);
  assert.equal(lateRelease.wallet.available, 60);
  assert.equal(lateRelease.wallet.reserved, 0);
  assert.equal(lateRelease.wallet.ledger.length, 2);

  const secondReservation = reserveCredits(lateRelease.wallet, { amount: 20, reservationId: "reservation-5" });
  const released = releaseReservation(secondReservation.wallet, "reservation-5");
  const repeatedRelease = releaseReservation(released.wallet, "reservation-5");
  const lateSettle = settleReservation(repeatedRelease.wallet, "reservation-5", { actualAmount: 20 });

  assert.equal(repeatedRelease.idempotent, true);
  assert.equal(repeatedRelease.wallet.available, 60);
  assert.equal(repeatedRelease.wallet.reserved, 0);
  assert.equal(repeatedRelease.wallet.ledger.length, 4);
  assert.equal(lateSettle.idempotent, true);
  assert.equal(lateSettle.wallet.available, 60);
  assert.equal(lateSettle.wallet.reserved, 0);
  assert.equal(lateSettle.wallet.ledger.length, 4);
  assert.doesNotThrow(() => reconcileWallet(lateSettle.wallet));
});

test("reconcileWallet fails when wallet cache diverges from active reservations", () => {
  const wallet = createCreditWallet({ id: "wallet-5", available: 90 });
  const reserved = reserveCredits(wallet, { amount: 25, reservationId: "reservation-6" });
  const corruptedWallet = {
    ...reserved.wallet,
    available: 80,
    reserved: 0
  };

  assert.throws(
    () => reconcileWallet(corruptedWallet),
    error => {
      assert.ok(error instanceof CreditAccountingError);
      assert.equal(error.code, "WALLET_RECONCILE_FAILED");
      assert.equal(error.context.expectedAvailable, 65);
      assert.equal(error.context.expectedReserved, 25);
      assert.deepEqual(
        error.context.failures.map(failure => failure.field),
        ["reserved", "available", "ledger.balanceAfter", "ledger.reservedAfter"]
      );
      return true;
    }
  );
});


test("reserve is idempotent for the same idempotency key and rejects duplicate reservation ids", () => {
  const wallet = createCreditWallet({ id: "wallet-6", available: 100 });
  const reserved = reserveCredits(wallet, { amount: 30, reservationId: "reservation-7", idempotencyKey: "same-key" });
  const repeated = reserveCredits(reserved.wallet, { amount: 30, reservationId: "reservation-7", idempotencyKey: "same-key" });

  assert.equal(repeated.idempotent, true);
  assert.equal(repeated.wallet.available, 70);
  assert.equal(repeated.wallet.reserved, 30);
  assert.equal(repeated.wallet.ledger.length, 1);
  assert.throws(
    () => reserveCredits(repeated.wallet, { amount: 10, reservationId: "reservation-7", idempotencyKey: "other-key" }),
    /already exists/
  );
});

test("settle rejects actual usage that exceeds the reserved amount", () => {
  const wallet = createCreditWallet({ id: "wallet-7", available: 100 });
  const reserved = reserveCredits(wallet, { amount: 40, reservationId: "reservation-8" });

  assert.throws(
    () => settleReservation(reserved.wallet, "reservation-8", { actualAmount: 41 }),
    error => {
      assert.ok(error instanceof CreditAccountingError);
      assert.equal(error.code, "ACTUAL_EXCEEDS_RESERVED");
      assert.equal(error.context.actualAmount, 41);
      assert.equal(error.context.reservedAmount, 40);
      return true;
    }
  );
});

test("createCreditWallet rehydrates opening balance from settled reservations", () => {
  const wallet = createCreditWallet({ id: "wallet-8", available: 120 });
  const settled = settleReservation(
    reserveCredits(wallet, { amount: 50, reservationId: "reservation-9" }).wallet,
    "reservation-9",
    { actualAmount: 35 }
  );
  const rehydrated = createCreditWallet({
    id: "wallet-8",
    available: settled.wallet.available,
    reserved: settled.wallet.reserved,
    reservations: settled.wallet.reservations,
    ledger: settled.wallet.ledger
  });

  assert.equal(rehydrated.openingBalance, 120);
  assert.doesNotThrow(() => reconcileWallet(rehydrated));
});

test("default testing credit grant tops existing wallets up to 10000 once", () => {
  const oldDefaultWallet = createSeededCreditSystemWallet({
    id: "wallet-default-upgrade",
    initialCredits: 5000,
    idempotencyKey: "grant:old-default"
  });
  const upgraded = ensureCreditSystemDefaultGrant(oldDefaultWallet, {
    targetCredits: 10000,
    idempotencyKey: "grant:wallet-default-upgrade:testing-default:10000"
  });
  const repeated = ensureCreditSystemDefaultGrant(upgraded, {
    targetCredits: 10000,
    idempotencyKey: "grant:wallet-default-upgrade:testing-default:10000"
  });

  assert.equal(oldDefaultWallet.availableCredits, 5000);
  assert.equal(upgraded.availableCredits, 10000);
  assert.equal(repeated.availableCredits, 10000);
  assert.equal(repeated.transactions.filter(transaction => transaction.idempotencyKey === "grant:wallet-default-upgrade:testing-default:10000").length, 1);
  assert.doesNotThrow(() => reconcileCreditSystemWallet(repeated));
});

test("credit catalog exposes membership plans, topups, and price rules as data", () => {
  const catalog = getCreditCatalog();
  assert.ok(catalog.version);
  assert.deepEqual(catalog.membershipPlans.map(plan => plan.id), creditMembershipPlans.map(plan => plan.id));
  assert.deepEqual(catalog.topupProducts.map(product => product.id), creditTopupProducts.map(product => product.id));
  assert.equal(catalog.topupProducts.find(product => product.id === "topup_980").totalCredits, 1030);
  assert.equal(catalog.membershipPlans.find(plan => plan.id === "flagship_monthly").concurrentTaskLimit, null);
  assert.ok(catalog.priceRules.some(rule => rule.id === "agent_retry"));
});

test("signup bonus and daily refresh are bucketed and idempotent", () => {
  const empty = createCreditSystemWallet({ id: "wallet-full-1", workspaceId: "default" });
  const signup = claimSignupBonus(empty, { now: "2026-07-02T01:00:00.000Z" });
  const daily = claimDailyRefresh(signup.wallet, {
    now: "2026-07-02T02:00:00.000Z",
    accountCreatedAt: "2026-06-30T00:00:00.000Z"
  });
  const repeatedDaily = claimDailyRefresh(daily.wallet, {
    now: "2026-07-02T03:00:00.000Z",
    accountCreatedAt: "2026-06-30T00:00:00.000Z"
  });

  assert.equal(signup.wallet.availableCredits, 70);
  assert.equal(daily.wallet.availableCredits, 90);
  assert.equal(daily.bucket.expiresAt, "2026-07-02T23:59:59.999Z");
  assert.equal(repeatedDaily.idempotent, true);
  assert.equal(repeatedDaily.wallet.availableCredits, 90);
  assert.equal(repeatedDaily.wallet.buckets.length, 2);
  assert.doesNotThrow(() => reconcileCreditSystemWallet(repeatedDaily.wallet));
});

test("daily check-in state reflects today's signed-in status", () => {
  const empty = createCreditSystemWallet({
    walletId: "wallet-checkin-1",
    workspaceId: "default",
    createdAt: "2026-06-30T00:00:00.000Z"
  });
  const before = getDailyCheckInState(empty, {
    now: "2026-07-02T01:00:00.000Z",
    accountCreatedAt: "2026-06-30T00:00:00.000Z"
  });
  const claimed = claimDailyRefresh(empty, {
    now: "2026-07-02T02:00:00.000Z",
    accountCreatedAt: "2026-06-30T00:00:00.000Z"
  });
  const after = getDailyCheckInState(claimed.wallet, {
    now: "2026-07-02T03:00:00.000Z",
    accountCreatedAt: "2026-06-30T00:00:00.000Z"
  });
  const overview = buildCreditWalletOverview(claimed.wallet, {
    now: "2026-07-02T04:00:00.000Z",
    accountCreatedAt: "2026-06-30T00:00:00.000Z"
  });
  const nextDay = getDailyCheckInState(claimed.wallet, {
    now: "2026-07-03T01:00:00.000Z",
    accountCreatedAt: "2026-06-30T00:00:00.000Z"
  });

  assert.equal(before.checkedIn, false);
  assert.equal(before.amount, 20);
  assert.equal(before.expiresAt, "2026-07-02T23:59:59.999Z");
  assert.equal(claimed.wallet.availableCredits, 20);
  assert.equal(after.checkedIn, true);
  assert.equal(after.transactionId, claimed.transaction.id);
  assert.equal(after.remainingTodayCredits, 20);
  assert.equal(overview.dailyCheckIn.checkedIn, true);
  assert.equal(overview.dailyCheckIn.transactionId, claimed.transaction.id);
  assert.equal(nextDay.checkedIn, false);
  assert.equal(nextDay.day, "2026-07-03");
  assert.doesNotThrow(() => reconcileCreditSystemWallet(claimed.wallet));
});

test("bucket reservations spend the earliest expiring bucket first and settle partial usage", () => {
  const seeded = createSeededCreditSystemWallet({ id: "wallet-full-2", initialCredits: 0 });
  const daily = grantCreditBucket(seeded, {
    amount: 20,
    sourceType: "daily_refresh_free",
    bucketId: "bucket-daily",
    expiresAt: "2026-07-02T23:59:59.999Z",
    idempotencyKey: "grant:daily",
    createdAt: "2026-07-02T00:00:00.000Z"
  });
  const topup = grantCreditBucket(daily.wallet, {
    amount: 100,
    sourceType: "topup_purchase",
    bucketId: "bucket-topup",
    idempotencyKey: "grant:topup",
    createdAt: "2026-07-02T00:01:00.000Z"
  });
  const reserved = reserveCreditAmount(topup.wallet, {
    amount: 50,
    reservationId: "reservation-full-1",
    idempotencyKey: "reserve:full-1",
    now: "2026-07-02T12:00:00.000Z"
  });
  const settled = settleCreditReservation(reserved.wallet, "reservation-full-1", {
    actualAmount: 35,
    now: "2026-07-02T12:01:00.000Z"
  });
  const dailyBucket = settled.wallet.buckets.find(bucket => bucket.id === "bucket-daily");
  const topupBucket = settled.wallet.buckets.find(bucket => bucket.id === "bucket-topup");

  assert.deepEqual(reserved.reservation.allocations.map(item => [item.bucketId, item.amountReserved]), [
    ["bucket-daily", 20],
    ["bucket-topup", 30]
  ]);
  assert.equal(settled.wallet.availableCredits, 85);
  assert.equal(settled.wallet.reservedCredits, 0);
  assert.equal(settled.settledAmount, 35);
  assert.equal(settled.releasedAmount, 15);
  assert.equal(dailyBucket.remainingAmount, 0);
  assert.equal(topupBucket.remainingAmount, 85);
  assert.doesNotThrow(() => reconcileCreditSystemWallet(settled.wallet));
});

test("release after source bucket expiry does not revive expired free credits", () => {
  const granted = grantCreditBucket(createCreditSystemWallet({ id: "wallet-full-3" }), {
    amount: 20,
    sourceType: "daily_refresh_free",
    bucketId: "bucket-expiring",
    expiresAt: "2026-07-02T23:59:59.999Z",
    idempotencyKey: "grant:expiring",
    createdAt: "2026-07-02T00:00:00.000Z"
  });
  const reserved = reserveCreditAmount(granted.wallet, {
    amount: 20,
    reservationId: "reservation-expiring",
    now: "2026-07-02T12:00:00.000Z"
  });
  const released = releaseCreditReservation(reserved.wallet, "reservation-expiring", {
    now: "2026-07-03T00:00:00.000Z"
  });

  assert.equal(released.wallet.availableCredits, 0);
  assert.equal(released.wallet.reservedCredits, 0);
  assert.equal(released.expiredAmount, 20);
  assert.equal(released.wallet.buckets[0].remainingAmount, 0);
  assert.ok(released.wallet.transactions.some(transaction => transaction.type === "expire" && transaction.amount === -20));
  assert.doesNotThrow(() => reconcileCreditSystemWallet(released.wallet));
});
