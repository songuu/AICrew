import { DEFAULT_WORKSPACE_ID, getSql } from "../client.js";

const SERVER_DEFAULT_CREDITS = 5000;
const VALID_TRANSACTION_TYPES = new Set(["consume", "grant", "refund", "release", "adjustment"]);

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
    reason: boundedString(input.reason, "reason", 80)
  };
}

function ledgerPayload(entry) {
  return Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== undefined && value !== ""));
}

export async function applyCreditTransaction(input, workspaceId = DEFAULT_WORKSPACE_ID) {
  const txInput = normalizeCreditTransactionInput(input);
  const sql = getSql();
  return sql.begin(async tx => {
    await tx`
      insert into public.aicrew_workspaces (id, credits)
      values (${workspaceId}, ${SERVER_DEFAULT_CREDITS})
      on conflict (id) do nothing
    `;
    const [workspace] = await tx`
      select credits from public.aicrew_workspaces where id = ${workspaceId} for update
    `;
    const currentCredits = intOr(workspace?.credits, SERVER_DEFAULT_CREDITS);
    const [existing] = await tx`
      select payload from public.aicrew_credit_ledger where workspace_id = ${workspaceId} and id = ${txInput.transactionId}
    `;
    if (existing?.payload) {
      return {
        idempotent: true,
        credits: currentCredits,
        ledgerEntry: existing.payload
      };
    }

    const nextCredits = currentCredits + txInput.amount;
    if (nextCredits < 0) {
      throw new CreditTransactionError(
        "INSUFFICIENT_CREDITS",
        "Insufficient credits for transaction.",
        409,
        { workspaceId, currentCredits, amount: txInput.amount }
      );
    }

    const createdAt = new Date().toISOString();
    const entry = ledgerPayload({
      id: txInput.transactionId,
      type: txInput.type,
      amount: txInput.amount,
      label: txInput.label,
      reservationId: txInput.reservationId,
      taskId: txInput.taskId,
      reason: txInput.reason,
      createdAt
    });

    await tx`
      update public.aicrew_workspaces
      set credits = ${nextCredits}, updated_at = now()
      where id = ${workspaceId}
    `;
    await tx`
      insert into public.aicrew_credit_ledger (id, workspace_id, type, amount, label, sort_order, payload)
      values (${txInput.transactionId}, ${workspaceId}, ${txInput.type}, ${txInput.amount}, ${txInput.label}, ${Date.now()}, ${tx.json(entry)})
    `;

    return {
      idempotent: false,
      credits: nextCredits,
      ledgerEntry: entry
    };
  });
}
