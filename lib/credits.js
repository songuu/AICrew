const DEFAULT_CURRENCY = "credits";
const ACTIVE_RESERVATION_STATUS = "reserved";
const TERMINAL_RESERVATION_STATUSES = new Set(["settled", "released", "expired"]);

export class CreditAccountingError extends Error {
  constructor(code, message, context = {}) {
    super(message);
    this.name = "CreditAccountingError";
    this.code = code;
    this.context = context;
  }
}

export function createCreditWallet(source = {}) {
  const initialAvailable = pickNumber(source, ["available", "availableCredits", "available_credits", "initialCredits"], 0);
  const initialReserved = pickNumber(source, ["reserved", "reservedCredits", "reserved_credits"], 0);

  return normalizeCreditWallet({
    id: source.id ?? "wallet_default",
    currency: source.currency ?? DEFAULT_CURRENCY,
    available: initialAvailable,
    reserved: initialReserved,
    reservations: source.reservations ?? [],
    ledger: source.ledger ?? [],
    openingBalance: source.openingBalance ?? initialAvailable + initialReserved
  });
}

export function normalizeCreditWallet(source = {}) {
  const reservations = asArray(source.reservations).map(normalizeReservation);
  const ledger = asArray(source.ledger).map(normalizeLedgerEntry);
  const available = toCreditAmount(pickNumber(source, ["available", "availableCredits", "available_credits"], 0), "available", {
    allowZero: true
  });
  const reserved = toCreditAmount(pickNumber(source, ["reserved", "reservedCredits", "reserved_credits"], 0), "reserved", {
    allowZero: true
  });
  const openingBalance = source.openingBalance == null
    ? deriveOpeningBalance({ available, reserved, reservations })
    : toCreditAmount(source.openingBalance, "openingBalance", { allowZero: true });

  return {
    id: String(source.id ?? "wallet_default"),
    currency: source.currency ?? DEFAULT_CURRENCY,
    available,
    reserved,
    openingBalance,
    reservations,
    ledger
  };
}

export function reserveCredits(walletInput, reservationInput = {}) {
  const wallet = normalizeCreditWallet(walletInput);
  const amount = toCreditAmount(reservationInput.amount ?? reservationInput.estimatedAmount, "amount");
  const reservationId = String(reservationInput.reservationId ?? reservationInput.id ?? nextId(wallet.reservations, "reservation"));
  const idempotencyKey = reservationInput.idempotencyKey ?? `reserve:${reservationId}`;
  const existingReservation = wallet.reservations.find(reservation => reservation.idempotencyKey === idempotencyKey);

  if (existingReservation) {
    return {
      wallet,
      reservation: existingReservation,
      ledgerEntry: findLedgerEntry(wallet, "reserve", existingReservation.id),
      idempotent: true
    };
  }

  if (wallet.available < amount) {
    throw new CreditAccountingError(
      "INSUFFICIENT_CREDITS",
      `Cannot reserve ${amount} credits because wallet ${wallet.id} only has ${wallet.available} available credits.`,
      {
        walletId: wallet.id,
        requestedAmount: amount,
        available: wallet.available,
        reserved: wallet.reserved,
        balance: wallet.available + wallet.reserved
      }
    );
  }

  ensureUniqueReservationId(wallet, reservationId);

  const nextAvailable = wallet.available - amount;
  const nextReserved = wallet.reserved + amount;
  const reservation = {
    id: reservationId,
    walletId: wallet.id,
    status: ACTIVE_RESERVATION_STATUS,
    amountReserved: amount,
    amountSettled: 0,
    idempotencyKey,
    referenceId: reservationInput.referenceId ?? null,
    priceCatalogVersion: reservationInput.priceCatalogVersion ?? null,
    createdAt: reservationInput.createdAt ?? null,
    expiresAt: reservationInput.expiresAt ?? null,
    metadata: clonePlainObject(reservationInput.metadata)
  };
  const ledgerEntry = createLedgerEntry(wallet, {
    type: "reserve",
    status: "pending",
    amount: -amount,
    reservationId,
    idempotencyKey,
    availableAfter: nextAvailable,
    reservedAfter: nextReserved,
    createdAt: reservationInput.createdAt ?? null,
    metadata: clonePlainObject(reservationInput.metadata)
  });
  const nextWallet = {
    ...wallet,
    available: nextAvailable,
    reserved: nextReserved,
    reservations: [...wallet.reservations, reservation],
    ledger: [...wallet.ledger, ledgerEntry]
  };

  return { wallet: nextWallet, reservation, ledgerEntry, idempotent: false };
}

export function settleReservation(walletInput, reservationId, settleInput = {}) {
  const wallet = normalizeCreditWallet(walletInput);
  const options = typeof settleInput === "number" ? { actualAmount: settleInput } : settleInput;
  const actualAmount = toCreditAmount(options.actualAmount ?? options.actual ?? 0, "actualAmount", { allowZero: true });
  const reservation = findReservationOrThrow(wallet, reservationId, "settle");

  if (reservation.status !== ACTIVE_RESERVATION_STATUS) {
    return {
      wallet,
      reservation,
      ledgerEntry: findLedgerEntry(wallet, "settle", reservation.id) ?? findLedgerEntry(wallet, "release", reservation.id),
      settledAmount: reservation.amountSettled,
      releasedAmount: reservation.status === "released" ? reservation.amountReserved : 0,
      idempotent: true
    };
  }

  const reservedAmount = reservation.amountReserved - reservation.amountSettled;
  ensureWalletHasReservedAmount(wallet, reservation, "settle");

  const settledAmount = Math.min(actualAmount, reservedAmount);
  const releasedAmount = reservedAmount - settledAmount;
  const nextAvailable = wallet.available + releasedAmount;
  const nextReserved = wallet.reserved - reservedAmount;
  const nextReservation = {
    ...reservation,
    status: "settled",
    amountSettled: settledAmount,
    settledAt: options.settledAt ?? null
  };
  const ledgerEntry = createLedgerEntry(wallet, {
    type: "settle",
    status: "posted",
    amount: -settledAmount,
    reservationId: reservation.id,
    idempotencyKey: options.idempotencyKey ?? `settle:${reservation.id}`,
    availableAfter: nextAvailable,
    reservedAfter: nextReserved,
    createdAt: options.settledAt ?? null,
    metadata: clonePlainObject(options.metadata)
  });
  const nextWallet = replaceReservation(wallet, nextReservation, {
    available: nextAvailable,
    reserved: nextReserved,
    ledgerEntry
  });

  return { wallet: nextWallet, reservation: nextReservation, ledgerEntry, settledAmount, releasedAmount, idempotent: false };
}

export function releaseReservation(walletInput, reservationId, releaseInput = {}) {
  const wallet = normalizeCreditWallet(walletInput);
  const reservation = findReservationOrThrow(wallet, reservationId, "release");

  if (reservation.status !== ACTIVE_RESERVATION_STATUS) {
    return {
      wallet,
      reservation,
      ledgerEntry: findLedgerEntry(wallet, "release", reservation.id) ?? findLedgerEntry(wallet, "settle", reservation.id),
      releasedAmount: reservation.status === "released" ? reservation.amountReserved : 0,
      idempotent: true
    };
  }

  const reservedAmount = reservation.amountReserved - reservation.amountSettled;
  ensureWalletHasReservedAmount(wallet, reservation, "release");

  const nextAvailable = wallet.available + reservedAmount;
  const nextReserved = wallet.reserved - reservedAmount;
  const nextReservation = {
    ...reservation,
    status: "released",
    releasedAt: releaseInput.releasedAt ?? null
  };
  const ledgerEntry = createLedgerEntry(wallet, {
    type: "release",
    status: "posted",
    amount: reservedAmount,
    reservationId: reservation.id,
    idempotencyKey: releaseInput.idempotencyKey ?? `release:${reservation.id}`,
    availableAfter: nextAvailable,
    reservedAfter: nextReserved,
    createdAt: releaseInput.releasedAt ?? null,
    metadata: clonePlainObject(releaseInput.metadata)
  });
  const nextWallet = replaceReservation(wallet, nextReservation, {
    available: nextAvailable,
    reserved: nextReserved,
    ledgerEntry
  });

  return { wallet: nextWallet, reservation: nextReservation, ledgerEntry, releasedAmount: reservedAmount, idempotent: false };
}

export function reconcileWallet(walletInput) {
  const wallet = normalizeCreditWallet(walletInput);
  const activeReserved = sumCredits(wallet.reservations
    .filter(reservation => reservation.status === ACTIVE_RESERVATION_STATUS)
    .map(reservation => reservation.amountReserved - reservation.amountSettled));
  const settledTotal = sumCredits(wallet.reservations
    .filter(reservation => reservation.status === "settled")
    .map(reservation => reservation.amountSettled));
  const expectedReserved = activeReserved;
  const expectedAvailable = wallet.openingBalance - settledTotal - activeReserved;
  const failures = [];

  if (wallet.reserved !== expectedReserved) {
    failures.push({ field: "reserved", actual: wallet.reserved, expected: expectedReserved });
  }
  if (wallet.available !== expectedAvailable) {
    failures.push({ field: "available", actual: wallet.available, expected: expectedAvailable });
  }

  validateReservations(wallet, failures);
  validateLedger(wallet, failures);

  if (failures.length > 0) {
    throw new CreditAccountingError(
      "WALLET_RECONCILE_FAILED",
      `Wallet ${wallet.id} failed credit reconciliation.`,
      {
        walletId: wallet.id,
        available: wallet.available,
        reserved: wallet.reserved,
        openingBalance: wallet.openingBalance,
        expectedAvailable,
        expectedReserved,
        failures
      }
    );
  }

  return wallet;
}

function pickNumber(source, keys, fallback) {
  for (const key of keys) {
    if (source[key] != null) {
      return source[key];
    }
  }
  return fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeReservation(source) {
  const amountReserved = toCreditAmount(source.amountReserved ?? source.amount_reserved, "amountReserved", { allowZero: true });
  const amountSettled = toCreditAmount(source.amountSettled ?? source.amount_settled ?? 0, "amountSettled", { allowZero: true });
  const status = source.status ?? ACTIVE_RESERVATION_STATUS;

  if (status !== ACTIVE_RESERVATION_STATUS && !TERMINAL_RESERVATION_STATUSES.has(status)) {
    throw new CreditAccountingError("INVALID_RESERVATION_STATUS", `Unsupported reservation status: ${status}.`, {
      reservationId: source.id,
      status
    });
  }

  if (amountSettled > amountReserved) {
    throw new CreditAccountingError("INVALID_RESERVATION_AMOUNT", "Reservation settled amount cannot exceed reserved amount.", {
      reservationId: source.id,
      amountReserved,
      amountSettled
    });
  }

  return {
    ...source,
    id: String(source.id),
    walletId: source.walletId ?? source.wallet_id ?? null,
    status,
    amountReserved,
    amountSettled,
    idempotencyKey: source.idempotencyKey ?? source.idempotency_key ?? null,
    referenceId: source.referenceId ?? source.reference_id ?? null,
    priceCatalogVersion: source.priceCatalogVersion ?? source.price_catalog_version ?? null,
    createdAt: source.createdAt ?? source.created_at ?? null,
    settledAt: source.settledAt ?? source.settled_at ?? null,
    releasedAt: source.releasedAt ?? source.released_at ?? null,
    expiresAt: source.expiresAt ?? source.expires_at ?? null,
    metadata: clonePlainObject(source.metadata)
  };
}

function normalizeLedgerEntry(source) {
  return {
    ...source,
    id: String(source.id),
    walletId: source.walletId ?? source.wallet_id ?? null,
    reservationId: source.reservationId ?? source.reservation_id ?? null,
    type: source.type,
    status: source.status,
    amount: toSignedCreditAmount(source.amount, "ledger.amount"),
    balanceAfter: toCreditAmount(source.balanceAfter ?? source.balance_after, "balanceAfter", { allowZero: true }),
    reservedAfter: toCreditAmount(source.reservedAfter ?? source.reserved_after ?? 0, "reservedAfter", { allowZero: true }),
    idempotencyKey: source.idempotencyKey ?? source.idempotency_key ?? null,
    createdAt: source.createdAt ?? source.created_at ?? null,
    metadata: clonePlainObject(source.metadata)
  };
}

function deriveOpeningBalance({ available, reserved, reservations }) {
  const settledTotal = sumCredits(reservations
    .filter(reservation => reservation.status === "settled")
    .map(reservation => reservation.amountSettled));
  return available + reserved + settledTotal;
}

function toCreditAmount(value, field, options = {}) {
  const allowZero = options.allowZero === true;

  if (!Number.isInteger(value) || value < 0 || (!allowZero && value === 0)) {
    throw new CreditAccountingError("INVALID_CREDIT_AMOUNT", `${field} must be a ${allowZero ? "non-negative" : "positive"} integer.`, {
      field,
      value
    });
  }

  return value;
}

function toSignedCreditAmount(value, field) {
  if (!Number.isInteger(value)) {
    throw new CreditAccountingError("INVALID_CREDIT_AMOUNT", `${field} must be an integer.`, { field, value });
  }

  return value;
}

function nextId(items, prefix) {
  return `${prefix}_${items.length + 1}`;
}

function ensureUniqueReservationId(wallet, reservationId) {
  if (wallet.reservations.some(reservation => reservation.id === reservationId)) {
    throw new CreditAccountingError("DUPLICATE_RESERVATION", `Reservation ${reservationId} already exists in wallet ${wallet.id}.`, {
      walletId: wallet.id,
      reservationId
    });
  }
}

function createLedgerEntry(wallet, input) {
  return {
    id: nextId(wallet.ledger, "ledger"),
    walletId: wallet.id,
    reservationId: input.reservationId,
    type: input.type,
    status: input.status,
    amount: input.amount,
    balanceAfter: input.availableAfter + input.reservedAfter,
    reservedAfter: input.reservedAfter,
    idempotencyKey: input.idempotencyKey,
    createdAt: input.createdAt,
    metadata: input.metadata
  };
}

function findReservationOrThrow(wallet, reservationId, action) {
  const resolvedId = typeof reservationId === "object" ? reservationId.id : reservationId;
  const reservation = wallet.reservations.find(candidate => candidate.id === resolvedId);

  if (!reservation) {
    throw new CreditAccountingError("RESERVATION_NOT_FOUND", `Cannot ${action} missing reservation ${resolvedId}.`, {
      walletId: wallet.id,
      reservationId: resolvedId,
      action
    });
  }

  return reservation;
}

function ensureWalletHasReservedAmount(wallet, reservation, action) {
  const reservedAmount = reservation.amountReserved - reservation.amountSettled;

  if (wallet.reserved < reservedAmount) {
    throw new CreditAccountingError("WALLET_RESERVED_UNDERFLOW", `Cannot ${action} reservation ${reservation.id}; wallet reserved balance is inconsistent.`, {
      walletId: wallet.id,
      reservationId: reservation.id,
      walletReserved: wallet.reserved,
      reservationReserved: reservedAmount,
      action
    });
  }
}

function replaceReservation(wallet, reservation, updates) {
  return {
    ...wallet,
    available: updates.available,
    reserved: updates.reserved,
    reservations: wallet.reservations.map(candidate => candidate.id === reservation.id ? reservation : candidate),
    ledger: [...wallet.ledger, updates.ledgerEntry]
  };
}

function findLedgerEntry(wallet, type, reservationId) {
  return wallet.ledger.find(entry => entry.type === type && entry.reservationId === reservationId) ?? null;
}

function validateReservations(wallet, failures) {
  const seenReservationIds = new Set();

  for (const reservation of wallet.reservations) {
    if (seenReservationIds.has(reservation.id)) {
      failures.push({ field: "reservations", reservationId: reservation.id, reason: "duplicate reservation id" });
    }
    seenReservationIds.add(reservation.id);

    if (reservation.amountSettled > reservation.amountReserved) {
      failures.push({
        field: "reservations",
        reservationId: reservation.id,
        reason: "settled amount exceeds reserved amount"
      });
    }
  }
}

function validateLedger(wallet, failures) {
  const expectedBalance = wallet.available + wallet.reserved;
  const latestEntry = wallet.ledger.at(-1);

  for (const entry of wallet.ledger) {
    if (!["reserve", "settle", "release"].includes(entry.type)) {
      failures.push({ field: "ledger", ledgerId: entry.id, reason: "unsupported ledger type" });
    }
    if (!Number.isInteger(entry.amount)) {
      failures.push({ field: "ledger", ledgerId: entry.id, reason: "amount is not an integer" });
    }
    if (!Number.isInteger(entry.balanceAfter) || !Number.isInteger(entry.reservedAfter)) {
      failures.push({ field: "ledger", ledgerId: entry.id, reason: "missing balanceAfter or reservedAfter" });
    }
  }

  if (latestEntry && latestEntry.balanceAfter !== expectedBalance) {
    failures.push({
      field: "ledger.balanceAfter",
      ledgerId: latestEntry.id,
      actual: latestEntry.balanceAfter,
      expected: expectedBalance
    });
  }
  if (latestEntry && latestEntry.reservedAfter !== wallet.reserved) {
    failures.push({
      field: "ledger.reservedAfter",
      ledgerId: latestEntry.id,
      actual: latestEntry.reservedAfter,
      expected: wallet.reserved
    });
  }
}

function sumCredits(values) {
  return values.reduce((total, value) => total + value, 0);
}

function clonePlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return { ...value };
}
