import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeClientStateForSave } from "../lib/db/repositories/state.js";

test("sanitizeClientStateForSave treats credit fields as server-owned", () => {
  const sanitized = sanitizeClientStateForSave(
    {
      workspace: { name: "Client", credits: 999999, reservedCredits: 500, creditOpeningBalance: 999999, plan: "pro" },
      creditLedger: [{ id: "fake", amount: 999999 }],
      creditReservations: [{ id: "fake-reservation" }],
      creditReservationLedger: [{ id: "fake-ledger" }],
      tasks: [{ id: "task-1" }]
    },
    {
      workspace: { credits: 120, reservedCredits: 10, creditOpeningBalance: 200 },
      creditLedger: [{ id: "server-ledger", amount: -30 }],
      creditReservations: [{ id: "server-reservation" }],
      creditReservationLedger: [{ id: "server-reservation-ledger" }]
    }
  );

  assert.equal(sanitized.workspace.name, "Client");
  assert.equal(sanitized.workspace.plan, "pro");
  assert.equal(sanitized.workspace.credits, 120);
  assert.equal(sanitized.workspace.reservedCredits, 10);
  assert.equal(sanitized.workspace.creditOpeningBalance, 200);
  assert.deepEqual(sanitized.creditLedger, [{ id: "server-ledger", amount: -30 }]);
  assert.deepEqual(sanitized.creditReservations, [{ id: "server-reservation" }]);
  assert.deepEqual(sanitized.creditReservationLedger, [{ id: "server-reservation-ledger" }]);
  assert.deepEqual(sanitized.tasks, [{ id: "task-1" }]);
});

test("sanitizeClientStateForSave defaults new workspaces to the server grant", () => {
  const sanitized = sanitizeClientStateForSave({ workspace: { credits: 1 }, creditLedger: [{ id: "fake" }] });
  assert.equal(sanitized.workspace.credits, 5000);
  assert.equal(sanitized.workspace.reservedCredits, 0);
  assert.equal(sanitized.workspace.creditOpeningBalance, 5000);
  assert.deepEqual(sanitized.creditLedger, []);
});
