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
