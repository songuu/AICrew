import { DEFAULT_WORKSPACE_ID, getSql } from "../client.js";
import {
  adjustCreditBalance,
  buildCreditWalletOverview,
  claimDailyRefresh,
  claimSignupBonus,
  createCreditSystemWallet,
  createSeededCreditSystemWallet,
  ensureCreditSystemDefaultGrant,
  getCreditCatalog,
  grantCreditBucket,
  quoteCreditCost,
  releaseCreditReservation,
  reserveCreditAmount,
  settleCreditReservation,
  spendCreditAmount,
  transactionsForDisplay
} from "../../credit-system.js";

const SERVER_DEFAULT_CREDITS = 10000;
const VALID_TRANSACTION_TYPES = new Set(["consume", "grant", "refund", "release", "adjustment", "admin_adjustment", "topup_purchase"]);
const CREDIT_WALLET_PAYLOAD_KEY = "creditSystemWallet";

export class CreditTransactionError extends Error {
  constructor(code, message, status = 400, context = {}) {
    super(message);
    this.name = "CreditTransactionError";
    this.code = code;
    this.status = status;
    this.context = context;
  }
}

function intOr(value, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Math.trunc(numberValue) : fallback;
}

function objectOr(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function boundedString(value, field, limit, { required = false } = {}) {
  const text = typeof value === "string" ? value.trim() : "";
  if (required && !text) throw new CreditTransactionError("INVALID_INPUT", field + " is required.");
  if (text.length > limit) throw new CreditTransactionError("INVALID_INPUT", field + " is too long.");
  return text;
}

function normalizeCreditTransactionInput(input = {}) {
  const transactionId = boundedString(input.transactionId || input.id || input.idempotencyKey, "transactionId", 160, { required: true });
  const type = boundedString(input.type || "consume", "type", 40, { required: true });
  if (!VALID_TRANSACTION_TYPES.has(type)) throw new CreditTransactionError("INVALID_INPUT", "Unsupported credit transaction type.");
  const amount = intOr(input.amount, NaN);
  if (!Number.isFinite(amount)) throw new CreditTransactionError("INVALID_INPUT", "amount must be a finite integer.");
  return {
    transactionId,
    type,
    amount,
    label: boundedString(input.label || type, "label", 240) || type,
    reservationId: boundedString(input.reservationId, "reservationId", 180),
    taskId: boundedString(input.taskId, "taskId", 180),
    reason: boundedString(input.reason, "reason", 160),
    operatorId: boundedString(input.operatorId, "operatorId", 120),
    metadata: objectOr(input.metadata)
  };
}

function normalizeReserveInput(input = {}) {
  const amount = intOr(input.amount ?? input.estimatedAmount, NaN);
  if (!Number.isFinite(amount) || amount <= 0) throw new CreditTransactionError("INVALID_INPUT", "amount must be a positive integer.");
  const reservationId = boundedString(input.reservationId || input.id, "reservationId", 180, { required: true });
  return {
    amount,
    reservationId,
    idempotencyKey: boundedString(input.idempotencyKey || `reserve:${reservationId}`, "idempotencyKey", 180, { required: true }),
    label: boundedString(input.label || "积分冻结", "label", 240) || "积分冻结",
    taskId: boundedString(input.taskId, "taskId", 180),
    quoteId: boundedString(input.quoteId, "quoteId", 180),
    priceCatalogVersion: boundedString(input.priceCatalogVersion || getCreditCatalog().version, "priceCatalogVersion", 80),
    metadata: objectOr(input.metadata)
  };
}

function normalizeSettleInput(input = {}) {
  const reservationId = boundedString(input.reservationId || input.id, "reservationId", 180, { required: true });
  const actualAmount = intOr(input.actualAmount ?? input.actual ?? 0, NaN);
  if (!Number.isFinite(actualAmount) || actualAmount < 0) throw new CreditTransactionError("INVALID_INPUT", "actualAmount must be a non-negative integer.");
  return {
    reservationId,
    actualAmount,
    idempotencyKey: boundedString(input.idempotencyKey || `${actualAmount === 0 ? "release" : "settle"}:${reservationId}`, "idempotencyKey", 180, { required: true }),
    label: boundedString(input.label || (actualAmount === 0 ? "积分释放" : "积分结算"), "label", 240),
    metadata: objectOr(input.metadata)
  };
}

function walletIdFor(workspaceId) {
  return `wallet_${workspaceId}`;
}

async function loadWalletForUpdate(tx, workspaceId) {
  await tx`
    insert into public.aicrew_workspaces (id, credits)
    values (${workspaceId}, ${SERVER_DEFAULT_CREDITS})
    on conflict (id) do nothing
  `;
  const [workspace] = await tx`
    select credits, payload from public.aicrew_workspaces where id = ${workspaceId} for update
  `;
  const payload = objectOr(workspace?.payload);
  const storedWallet = objectOr(payload[CREDIT_WALLET_PAYLOAD_KEY], null);
  const loadedWallet = storedWallet
    ? createCreditSystemWallet(storedWallet)
    : createSeededCreditSystemWallet({
        id: walletIdFor(workspaceId),
        workspaceId,
        initialCredits: intOr(workspace?.credits, SERVER_DEFAULT_CREDITS),
        sourceType: "grant",
        label: "Server wallet seed",
        idempotencyKey: `grant:${workspaceId}:server-seed`
      });
  const migratedWallet = loadedWallet.buckets.length === 0 && loadedWallet.availableCredits > 0
    ? createSeededCreditSystemWallet({
        ...loadedWallet,
        initialCredits: loadedWallet.availableCredits,
        label: "Server wallet scalar migration",
        idempotencyKey: `grant:${workspaceId}:scalar-migration`
      })
    : loadedWallet;
  const wallet = ensureCreditSystemDefaultGrant(migratedWallet, {
    targetCredits: SERVER_DEFAULT_CREDITS,
    label: "Testing default credits",
    idempotencyKey: `grant:${workspaceId}:testing-default:${SERVER_DEFAULT_CREDITS}`
  });
  return { payload, wallet };
}

async function saveWallet(tx, workspaceId, payload, wallet) {
  const nextPayload = {
    ...payload,
    [CREDIT_WALLET_PAYLOAD_KEY]: wallet,
    creditWalletUpdatedAt: new Date().toISOString()
  };
  await tx`
    update public.aicrew_workspaces
    set credits = ${wallet.availableCredits}, payload = ${tx.json(nextPayload)}, updated_at = now()
    where id = ${workspaceId}
  `;
  await mirrorCreditLedger(tx, workspaceId, wallet);
  return nextPayload;
}

async function mirrorCreditLedger(tx, workspaceId, wallet) {
  const ledger = transactionsForDisplay(wallet);
  await tx`delete from public.aicrew_credit_ledger where workspace_id = ${workspaceId}`;
  for (let index = 0; index < ledger.length; index += 1) {
    const entry = ledger[index];
    await tx`
      insert into public.aicrew_credit_ledger (id, workspace_id, type, amount, label, sort_order, payload)
      values (${entry.id}, ${workspaceId}, ${entry.type}, ${entry.amount}, ${entry.label}, ${index}, ${tx.json(entry)})
      on conflict (workspace_id, id) do update
        set type = excluded.type, amount = excluded.amount, label = excluded.label, sort_order = excluded.sort_order, payload = excluded.payload
    `;
  }
}

function serviceResult(wallet, extra = {}) {
  const ledger = transactionsForDisplay(wallet);
  return {
    ...extra,
    credits: wallet.availableCredits,
    reservedCredits: wallet.reservedCredits,
    openingBalance: wallet.availableCredits + wallet.reservedCredits + wallet.lifetimeConsumed,
    wallet,
    creditWallet: buildCreditWalletOverview(wallet),
    ledgerEntry: ledger[0] ?? null
  };
}

export async function loadCreditWalletOverview(workspaceId = DEFAULT_WORKSPACE_ID) {
  const sql = getSql();
  return sql.begin(async tx => {
    const { payload, wallet } = await loadWalletForUpdate(tx, workspaceId);
    await saveWallet(tx, workspaceId, payload, wallet);
    return serviceResult(wallet, { catalog: getCreditCatalog(), ledger: transactionsForDisplay(wallet) });
  });
}

export function quoteCreditTransaction(input = {}) {
  return {
    quote: quoteCreditCost(input),
    catalog: getCreditCatalog()
  };
}

export async function applyCreditTransaction(input, workspaceId = DEFAULT_WORKSPACE_ID) {
  const txInput = normalizeCreditTransactionInput(input);
  const sql = getSql();
  return sql.begin(async tx => {
    const { payload, wallet } = await loadWalletForUpdate(tx, workspaceId);
    let result;
    if (txInput.amount < 0 || txInput.type === "consume") {
      result = spendCreditAmount(wallet, {
        amount: Math.abs(txInput.amount),
        reservationId: txInput.reservationId || `reservation:${txInput.transactionId}`,
        idempotencyKey: txInput.transactionId,
        label: txInput.label,
        taskId: txInput.taskId,
        referenceType: txInput.taskId ? "task" : txInput.type,
        referenceId: txInput.taskId || txInput.transactionId,
        metadata: { ...txInput.metadata, reason: txInput.reason }
      });
    } else if (txInput.type === "adjustment" || txInput.type === "admin_adjustment") {
      result = adjustCreditBalance(wallet, {
        amount: txInput.amount,
        idempotencyKey: txInput.transactionId,
        label: txInput.label,
        reason: txInput.reason || txInput.label,
        operatorId: txInput.operatorId || "system",
        metadata: txInput.metadata
      });
    } else {
      result = grantCreditBucket(wallet, {
        amount: txInput.amount,
        sourceType: txInput.type === "release" ? "refund" : txInput.type,
        idempotencyKey: txInput.transactionId,
        label: txInput.label,
        metadata: { ...txInput.metadata, reason: txInput.reason }
      });
    }
    await saveWallet(tx, workspaceId, payload, result.wallet);
    return serviceResult(result.wallet, { idempotent: result.idempotent === true });
  });
}

export async function grantCreditEntitlement(input = {}, workspaceId = DEFAULT_WORKSPACE_ID) {
  const action = boundedString(input.action || input.type || "daily_refresh", "action", 80, { required: true });
  const sql = getSql();
  return sql.begin(async tx => {
    const { payload, wallet } = await loadWalletForUpdate(tx, workspaceId);
    let result;
    if (action === "signup_bonus") {
      result = claimSignupBonus(wallet, input);
    } else if (action === "daily_refresh") {
      result = claimDailyRefresh(wallet, input);
    } else if (action === "topup_purchase") {
      const amount = intOr(input.amount ?? input.totalCredits, NaN);
      if (!Number.isFinite(amount) || amount <= 0) throw new CreditTransactionError("INVALID_INPUT", "topup amount must be a positive integer.");
      result = grantCreditBucket(wallet, {
        amount,
        sourceType: "topup_purchase",
        idempotencyKey: boundedString(input.idempotencyKey || input.orderId || `topup:${Date.now()}`, "idempotencyKey", 180, { required: true }),
        label: boundedString(input.label || "单购积分包", "label", 240),
        orderId: input.orderId,
        metadata: objectOr(input.metadata)
      });
    } else {
      throw new CreditTransactionError("INVALID_INPUT", "Unsupported entitlement action.");
    }
    await saveWallet(tx, workspaceId, payload, result.wallet);
    return serviceResult(result.wallet, { idempotent: result.idempotent === true, action });
  });
}

export async function reserveServerCredits(input = {}, workspaceId = DEFAULT_WORKSPACE_ID) {
  const reserveInput = normalizeReserveInput(input);
  const sql = getSql();
  return sql.begin(async tx => {
    const { payload, wallet } = await loadWalletForUpdate(tx, workspaceId);
    let result;
    try {
      result = reserveCreditAmount(wallet, reserveInput);
    } catch (error) {
      if (error?.code === "INSUFFICIENT_CREDITS") {
        throw new CreditTransactionError("INSUFFICIENT_CREDITS", error.message, 409, error.context);
      }
      throw error;
    }
    await saveWallet(tx, workspaceId, payload, result.wallet);
    return serviceResult(result.wallet, { idempotent: result.idempotent === true, reservation: result.reservation });
  });
}

export async function settleServerCredits(input = {}, workspaceId = DEFAULT_WORKSPACE_ID) {
  const settleInput = normalizeSettleInput(input);
  const sql = getSql();
  return sql.begin(async tx => {
    const { payload, wallet } = await loadWalletForUpdate(tx, workspaceId);
    const result = settleCreditReservation(wallet, settleInput.reservationId, settleInput);
    await saveWallet(tx, workspaceId, payload, result.wallet);
    return serviceResult(result.wallet, {
      idempotent: result.idempotent === true,
      reservation: result.reservation,
      settledAmount: result.settledAmount,
      releasedAmount: result.releasedAmount,
      expiredAmount: result.expiredAmount
    });
  });
}

export async function releaseServerCredits(input = {}, workspaceId = DEFAULT_WORKSPACE_ID) {
  const reservationId = boundedString(input.reservationId || input.id, "reservationId", 180, { required: true });
  const sql = getSql();
  return sql.begin(async tx => {
    const { payload, wallet } = await loadWalletForUpdate(tx, workspaceId);
    const result = releaseCreditReservation(wallet, reservationId, input);
    await saveWallet(tx, workspaceId, payload, result.wallet);
    return serviceResult(result.wallet, {
      idempotent: result.idempotent === true,
      reservation: result.reservation,
      releasedAmount: result.releasedAmount,
      expiredAmount: result.expiredAmount
    });
  });
}
