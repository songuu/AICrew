const DEFAULT_CURRENCY = "credits";
const DEFAULT_DISPLAY_NAME = "算力积分";
const ACTIVE_RESERVATION_STATUS = "reserved";
const TERMINAL_RESERVATION_STATUSES = new Set(["settled", "released", "expired"]);
const CREDIT_TRANSACTION_TYPES = new Set([
  "grant",
  "daily_refresh_free",
  "daily_refresh_membership",
  "signup_bonus",
  "membership_grant",
  "topup_purchase",
  "redeem_code",
  "admin_adjustment",
  "reserve",
  "settle",
  "release",
  "refund",
  "expire"
]);

export const CREDIT_CATALOG_VERSION = "aicrew-credit-catalog-2026-07";

export const creditMembershipPlans = [
  {
    id: "free",
    name: "免费版",
    priceCny: 0,
    signupBonus: 70,
    dailyRefreshFirstWeek: 20,
    dailyRefreshAfterWeek: 10,
    monthlyGrant: 0,
    concurrentTaskLimit: 2
  },
  {
    id: "standard_monthly",
    name: "普通会员",
    priceCny: 68,
    signupBonus: 0,
    dailyRefreshFirstWeek: 20,
    dailyRefreshAfterWeek: 20,
    monthlyGrant: 1300,
    concurrentTaskLimit: 5
  },
  {
    id: "pro_monthly",
    name: "高级会员",
    priceCny: 328,
    signupBonus: 0,
    dailyRefreshFirstWeek: 20,
    dailyRefreshAfterWeek: 20,
    monthlyGrant: 6500,
    concurrentTaskLimit: 7
  },
  {
    id: "flagship_monthly",
    name: "旗舰会员",
    priceCny: 763,
    signupBonus: 0,
    dailyRefreshFirstWeek: 20,
    dailyRefreshAfterWeek: 20,
    monthlyGrant: 16000,
    concurrentTaskLimit: null
  }
];

export const creditTopupProducts = [
  { id: "topup_300", name: "300 积分包", priceCny: 30, baseCredits: 300, bonusCredits: 0 },
  { id: "topup_680", name: "680 积分包", priceCny: 68, baseCredits: 680, bonusCredits: 0 },
  { id: "topup_980", name: "980 积分包", priceCny: 98, baseCredits: 980, bonusCredits: 50 },
  { id: "topup_1680", name: "1680 积分包", priceCny: 168, baseCredits: 1680, bonusCredits: 170 },
  { id: "topup_3280", name: "3280 积分包", priceCny: 328, baseCredits: 3280, bonusCredits: 520 },
  { id: "topup_6480", name: "6480 积分包", priceCny: 648, baseCredits: 6480, bonusCredits: 1520 }
].map(product => ({ ...product, totalCredits: product.baseCredits + product.bonusCredits }));

export const creditPriceRules = [
  { id: "llm_text", category: "文案/脚本", unit: "agent", baseCredits: 6, highPatternCredits: 10 },
  { id: "image_generation", category: "图片生成", unit: "image", baseCredits: 18, highPatternCredits: 28 },
  { id: "video_generation", category: "视频生成", unit: "15s video", baseCredits: 36, highPatternCredits: 58 },
  { id: "quality_review", category: "质量检查", unit: "task", baseCredits: 6, highPatternCredits: 8 },
  { id: "export_bundle", category: "导出打包", unit: "bundle", baseCredits: 8, highPatternCredits: 12 },
  { id: "agent_retry", category: "Agent 重试", unit: "attempt", baseCredits: 8, highPatternCredits: 12 }
];

export class CreditSystemError extends Error {
  constructor(code, message, context = {}) {
    super(message);
    this.name = "CreditSystemError";
    this.code = code;
    this.context = context;
  }
}

export function getCreditCatalog() {
  return clonePlain({
    version: CREDIT_CATALOG_VERSION,
    currency: DEFAULT_CURRENCY,
    displayName: DEFAULT_DISPLAY_NAME,
    membershipPlans: creditMembershipPlans,
    topupProducts: creditTopupProducts,
    priceRules: creditPriceRules
  });
}

export function createCreditSystemWallet(source = {}) {
  const buckets = asArray(source.buckets).map(normalizeBucket);
  const reservations = asArray(source.reservations).map(normalizeReservation);
  const transactions = asArray(source.transactions).map(normalizeTransaction);
  const hasBuckets = buckets.length > 0;
  const availableCredits = hasBuckets
    ? sumCredits(buckets.map(bucket => bucket.remainingAmount))
    : creditAmount(pickNumber(source, ["availableCredits", "available_credits", "available", "initialCredits"], 0), "availableCredits", { allowZero: true });
  const reservedCredits = hasBuckets
    ? sumCredits(buckets.map(bucket => bucket.reservedAmount))
    : creditAmount(pickNumber(source, ["reservedCredits", "reserved_credits", "reserved"], 0), "reservedCredits", { allowZero: true });

  return {
    id: String(source.id ?? "wallet_default"),
    workspaceId: String(source.workspaceId ?? source.workspace_id ?? "default"),
    userId: source.userId ?? source.user_id ?? null,
    currency: source.currency ?? DEFAULT_CURRENCY,
    displayName: source.displayName ?? source.display_name ?? DEFAULT_DISPLAY_NAME,
    planId: source.planId ?? source.plan_id ?? "free",
    availableCredits,
    reservedCredits,
    lifetimeGranted: creditAmount(source.lifetimeGranted ?? source.lifetime_granted ?? 0, "lifetimeGranted", { allowZero: true }),
    lifetimePurchased: creditAmount(source.lifetimePurchased ?? source.lifetime_purchased ?? 0, "lifetimePurchased", { allowZero: true }),
    lifetimeConsumed: creditAmount(source.lifetimeConsumed ?? source.lifetime_consumed ?? 0, "lifetimeConsumed", { allowZero: true }),
    buckets,
    reservations,
    transactions,
    metadata: objectOr(source.metadata),
    createdAt: source.createdAt ?? source.created_at ?? null,
    updatedAt: source.updatedAt ?? source.updated_at ?? null
  };
}

export function createSeededCreditSystemWallet(source = {}) {
  const initialCredits = creditAmount(source.initialCredits ?? source.availableCredits ?? 0, "initialCredits", { allowZero: true });
  const wallet = createCreditSystemWallet({ ...source, availableCredits: 0, reservedCredits: 0, buckets: [], transactions: [], reservations: [] });
  if (initialCredits <= 0) return wallet;
  return grantCreditBucket(wallet, {
    amount: initialCredits,
    sourceType: source.sourceType ?? "grant",
    label: source.label ?? "Initial server wallet grant",
    bucketId: source.bucketId ?? `${wallet.id}:seed`,
    idempotencyKey: source.idempotencyKey ?? `grant:${wallet.id}:seed`,
    priority: source.priority ?? 90,
    createdAt: source.createdAt ?? null,
    metadata: { seed: true }
  }).wallet;
}

export function quoteCreditCost(input = {}) {
  const estimated = creditAmount(input.amount ?? input.estimatedCredits ?? input.estimated ?? 0, "estimatedCredits", { allowZero: true });
  const catalogVersion = input.priceCatalogVersion ?? CREDIT_CATALOG_VERSION;
  return {
    quoteId: input.quoteId ?? `quote:${input.referenceId ?? "manual"}:${estimated}:${catalogVersion}`,
    currency: DEFAULT_CURRENCY,
    displayName: DEFAULT_DISPLAY_NAME,
    estimatedCredits: estimated,
    maxReservableCredits: estimated,
    priceCatalogVersion: catalogVersion,
    lines: asArray(input.lines).length > 0
      ? asArray(input.lines)
      : [{ category: input.category ?? "task", amount: estimated, unit: input.unit ?? "run" }]
  };
}

export function claimSignupBonus(walletInput, input = {}) {
  const wallet = createCreditSystemWallet(walletInput);
  const plan = findMembershipPlan(input.planId ?? wallet.planId);
  if (!plan.signupBonus) return { wallet, bucket: null, transaction: null, idempotent: true };
  return grantCreditBucket(wallet, {
    amount: plan.signupBonus,
    sourceType: "signup_bonus",
    label: input.label ?? "首次注册赠送",
    bucketId: input.bucketId ?? `${wallet.id}:signup_bonus`,
    idempotencyKey: input.idempotencyKey ?? `signup_bonus:${wallet.id}`,
    priority: 80,
    expiresAt: null,
    createdAt: input.now ?? input.createdAt ?? null,
    metadata: { planId: plan.id }
  });
}

export function claimDailyRefresh(walletInput, input = {}) {
  const wallet = createCreditSystemWallet(walletInput);
  const plan = findMembershipPlan(input.planId ?? wallet.planId);
  const now = parseDate(input.now, new Date());
  const accountCreatedAt = parseDate(input.accountCreatedAt ?? wallet.createdAt, now);
  const ageDays = Math.max(0, Math.floor((startOfUtcDay(now) - startOfUtcDay(accountCreatedAt)) / 86400000));
  const amount = ageDays < 7 ? plan.dailyRefreshFirstWeek : plan.dailyRefreshAfterWeek;
  if (!amount) return { wallet, bucket: null, transaction: null, idempotent: true };
  const day = utcDateKey(now);
  return grantCreditBucket(wallet, {
    amount,
    sourceType: plan.id === "free" ? "daily_refresh_free" : "daily_refresh_membership",
    label: input.label ?? "每日刷新积分",
    bucketId: input.bucketId ?? `${wallet.id}:daily:${day}`,
    idempotencyKey: input.idempotencyKey ?? `daily_refresh:${wallet.id}:${plan.id}:${day}`,
    priority: 10,
    expiresAt: endOfUtcDay(now).toISOString(),
    createdAt: now.toISOString(),
    metadata: { planId: plan.id, day, ageDays }
  });
}

export function grantCreditBucket(walletInput, input = {}) {
  const wallet = createCreditSystemWallet(walletInput);
  const amount = creditAmount(input.amount ?? input.totalCredits, "amount");
  const idempotencyKey = stringOr(input.idempotencyKey, `grant:${wallet.id}:${input.sourceType ?? "grant"}:${input.bucketId ?? wallet.buckets.length + 1}`);
  const existing = findTransactionByIdempotency(wallet, idempotencyKey);
  if (existing) return { wallet, bucket: wallet.buckets.find(bucket => bucket.id === existing.bucketId) ?? null, transaction: existing, idempotent: true };

  const bucket = normalizeBucket({
    id: input.bucketId ?? `bucket_${wallet.buckets.length + 1}`,
    sourceType: input.sourceType ?? "grant",
    originalAmount: amount,
    remainingAmount: amount,
    reservedAmount: 0,
    expiresAt: input.expiresAt ?? null,
    priority: input.priority ?? priorityForSource(input.sourceType),
    grantPolicyId: input.grantPolicyId ?? null,
    orderId: input.orderId ?? null,
    metadata: input.metadata,
    createdAt: input.createdAt ?? null
  });
  const nextAvailable = wallet.availableCredits + amount;
  const transaction = createTransaction(wallet, {
    type: transactionTypeForGrant(bucket.sourceType),
    status: "posted",
    amount,
    label: input.label ?? labelForSource(bucket.sourceType),
    bucketId: bucket.id,
    idempotencyKey,
    balanceAfter: nextAvailable + wallet.reservedCredits,
    reservedAfter: wallet.reservedCredits,
    referenceType: input.referenceType ?? "bucket",
    referenceId: input.referenceId ?? bucket.id,
    createdAt: input.createdAt ?? null,
    metadata: input.metadata
  });

  return {
    wallet: reconcileCreditSystemWallet({
      ...wallet,
      availableCredits: nextAvailable,
      lifetimeGranted: wallet.lifetimeGranted + (bucket.sourceType === "topup_purchase" ? 0 : amount),
      lifetimePurchased: wallet.lifetimePurchased + (bucket.sourceType === "topup_purchase" ? amount : 0),
      buckets: [...wallet.buckets, bucket],
      transactions: [...wallet.transactions, transaction]
    }),
    bucket,
    transaction,
    idempotent: false
  };
}

export function reserveCreditAmount(walletInput, input = {}) {
  const wallet = createCreditSystemWallet(walletInput);
  const amount = creditAmount(input.amount ?? input.estimatedAmount, "amount");
  const reservationId = stringOr(input.reservationId ?? input.id, `reservation_${wallet.reservations.length + 1}`);
  const idempotencyKey = stringOr(input.idempotencyKey, `reserve:${reservationId}`);
  const existingReservation = wallet.reservations.find(reservation => reservation.idempotencyKey === idempotencyKey);
  if (existingReservation) {
    return {
      wallet,
      reservation: existingReservation,
      transaction: wallet.transactions.find(tx => tx.type === "reserve" && tx.reservationId === existingReservation.id) ?? null,
      idempotent: true
    };
  }
  if (wallet.reservations.some(reservation => reservation.id === reservationId)) {
    throw new CreditSystemError("DUPLICATE_RESERVATION", `Reservation ${reservationId} already exists.`, { reservationId, walletId: wallet.id });
  }

  const now = parseDate(input.now, new Date());
  let remaining = amount;
  const allocations = [];
  const nextBuckets = wallet.buckets.map(bucket => ({ ...bucket }));
  for (const bucket of spendOrder(nextBuckets, now)) {
    if (remaining <= 0) break;
    const take = Math.min(bucket.remainingAmount, remaining);
    if (take <= 0) continue;
    bucket.remainingAmount -= take;
    bucket.reservedAmount += take;
    allocations.push({
      bucketId: bucket.id,
      amountReserved: take,
      amountSettled: 0,
      sourceType: bucket.sourceType,
      sourceExpiresAt: bucket.expiresAt
    });
    remaining -= take;
  }
  if (remaining > 0) {
    throw new CreditSystemError("INSUFFICIENT_CREDITS", `Cannot reserve ${amount} credits; only ${amount - remaining} spendable credits are available.`, {
      walletId: wallet.id,
      requestedAmount: amount,
      availableCredits: wallet.availableCredits,
      spendableCredits: amount - remaining
    });
  }

  const nextAvailable = wallet.availableCredits - amount;
  const nextReserved = wallet.reservedCredits + amount;
  const reservation = normalizeReservation({
    id: reservationId,
    walletId: wallet.id,
    status: ACTIVE_RESERVATION_STATUS,
    taskId: input.taskId ?? null,
    quoteId: input.quoteId ?? null,
    amountReserved: amount,
    amountSettled: 0,
    priceCatalogVersion: input.priceCatalogVersion ?? CREDIT_CATALOG_VERSION,
    idempotencyKey,
    expiresAt: input.expiresAt ?? null,
    allocations,
    metadata: input.metadata,
    createdAt: input.createdAt ?? null
  });
  const transaction = createTransaction(wallet, {
    type: "reserve",
    status: "pending",
    amount: -amount,
    label: input.label ?? "积分冻结",
    reservationId,
    idempotencyKey,
    balanceAfter: nextAvailable + nextReserved,
    reservedAfter: nextReserved,
    referenceType: input.referenceType ?? "task",
    referenceId: input.referenceId ?? input.taskId ?? reservationId,
    priceCatalogVersion: reservation.priceCatalogVersion,
    createdAt: input.createdAt ?? null,
    metadata: input.metadata
  });

  return {
    wallet: reconcileCreditSystemWallet({
      ...wallet,
      availableCredits: nextAvailable,
      reservedCredits: nextReserved,
      buckets: nextBuckets,
      reservations: [...wallet.reservations, reservation],
      transactions: [...wallet.transactions, transaction]
    }),
    reservation,
    transaction,
    idempotent: false
  };
}

export function settleCreditReservation(walletInput, reservationId, input = {}) {
  const wallet = createCreditSystemWallet(walletInput);
  const reservation = findReservation(wallet, reservationId, "settle");
  if (reservation.status !== ACTIVE_RESERVATION_STATUS) {
    return {
      wallet,
      reservation,
      transaction: findTerminalReservationTransaction(wallet, reservation.id),
      settledAmount: reservation.amountSettled,
      releasedAmount: reservation.status === "released" ? reservation.amountReserved : 0,
      expiredAmount: 0,
      idempotent: true
    };
  }

  const actualAmount = creditAmount(input.actualAmount ?? input.actual ?? 0, "actualAmount", { allowZero: true });
  const settledAmount = Math.min(actualAmount, reservation.amountReserved);
  let remainingToConsume = settledAmount;
  let releasedAmount = 0;
  let expiredAmount = 0;
  const now = parseDate(input.now, new Date());
  const nextBuckets = wallet.buckets.map(bucket => ({ ...bucket }));
  const nextAllocations = allocationSpendOrder(reservation.allocations).map(allocation => {
    const consume = Math.min(remainingToConsume, allocation.amountReserved);
    remainingToConsume -= consume;
    const back = allocation.amountReserved - consume;
    const bucket = nextBuckets.find(candidate => candidate.id === allocation.bucketId);
    if (!bucket) {
      throw new CreditSystemError("BUCKET_NOT_FOUND", `Reservation allocation references missing bucket ${allocation.bucketId}.`, {
        reservationId: reservation.id,
        bucketId: allocation.bucketId
      });
    }
    bucket.reservedAmount -= allocation.amountReserved;
    if (bucket.reservedAmount < 0) {
      throw new CreditSystemError("BUCKET_RESERVED_UNDERFLOW", `Bucket ${bucket.id} reserved credits are inconsistent.`, {
        bucketId: bucket.id,
        reservationId: reservation.id
      });
    }
    if (back > 0) {
      if (isExpiredAt(allocation.sourceExpiresAt, now)) {
        expiredAmount += back;
      } else {
        bucket.remainingAmount += back;
        releasedAmount += back;
      }
    }
    return { ...allocation, amountSettled: consume };
  });

  const nextAvailable = wallet.availableCredits + releasedAmount;
  const nextReserved = wallet.reservedCredits - reservation.amountReserved;
  const isRelease = settledAmount === 0;
  const nextReservation = normalizeReservation({
    ...reservation,
    status: isRelease ? "released" : "settled",
    amountSettled: settledAmount,
    allocations: nextAllocations,
    settledAt: isRelease ? null : input.settledAt ?? input.now ?? null,
    releasedAt: isRelease ? input.releasedAt ?? input.now ?? null : null
  });
  const transaction = createTransaction(wallet, {
    type: isRelease ? "release" : "settle",
    status: "posted",
    amount: -settledAmount,
    label: input.label ?? (isRelease ? "积分释放" : "积分结算"),
    reservationId: reservation.id,
    idempotencyKey: input.idempotencyKey ?? `${isRelease ? "release" : "settle"}:${reservation.id}`,
    balanceAfter: nextAvailable + nextReserved,
    reservedAfter: nextReserved,
    referenceType: input.referenceType ?? "task",
    referenceId: input.referenceId ?? reservation.taskId ?? reservation.id,
    priceCatalogVersion: reservation.priceCatalogVersion,
    createdAt: input.settledAt ?? input.releasedAt ?? input.now ?? null,
    metadata: input.metadata
  });
  const expireTransaction = expiredAmount > 0
    ? createTransaction(wallet, {
        type: "expire",
        status: "posted",
        amount: -expiredAmount,
        label: input.expireLabel ?? "释放时已过期积分失效",
        reservationId: reservation.id,
        idempotencyKey: input.expireIdempotencyKey ?? `${transaction.type}:expire:${reservation.id}`,
        balanceAfter: nextAvailable + nextReserved,
        reservedAfter: nextReserved,
        referenceType: "reservation",
        referenceId: reservation.id,
        priceCatalogVersion: reservation.priceCatalogVersion,
        createdAt: input.now ?? null
      })
    : null;
  const nextTransactions = expireTransaction
    ? [...wallet.transactions, transaction, expireTransaction]
    : [...wallet.transactions, transaction];

  return {
    wallet: reconcileCreditSystemWallet({
      ...wallet,
      availableCredits: nextAvailable,
      reservedCredits: nextReserved,
      lifetimeConsumed: wallet.lifetimeConsumed + settledAmount,
      buckets: nextBuckets,
      reservations: wallet.reservations.map(candidate => candidate.id === reservation.id ? nextReservation : candidate),
      transactions: nextTransactions
    }),
    reservation: nextReservation,
    transaction,
    settledAmount,
    releasedAmount,
    expiredAmount,
    idempotent: false
  };
}

export function releaseCreditReservation(walletInput, reservationId, input = {}) {
  return settleCreditReservation(walletInput, reservationId, { ...input, actualAmount: 0 });
}

export function spendCreditAmount(walletInput, input = {}) {
  const amount = Math.abs(creditAmount(input.amount ?? input.actualAmount, "amount"));
  const reservationId = stringOr(input.reservationId, `spend:${input.idempotencyKey ?? input.transactionId ?? walletInput.id ?? "wallet"}:${amount}`);
  const reserved = reserveCreditAmount(walletInput, {
    amount,
    reservationId,
    idempotencyKey: input.reserveIdempotencyKey ?? `reserve:${reservationId}`,
    label: input.reserveLabel ?? "积分冻结",
    taskId: input.taskId,
    referenceId: input.referenceId,
    referenceType: input.referenceType,
    priceCatalogVersion: input.priceCatalogVersion,
    metadata: input.metadata,
    now: input.now
  });
  const settled = settleCreditReservation(reserved.wallet, reservationId, {
    actualAmount: amount,
    idempotencyKey: input.idempotencyKey ?? input.transactionId ?? `settle:${reservationId}`,
    label: input.label ?? "积分消费",
    referenceId: input.referenceId,
    referenceType: input.referenceType,
    metadata: input.metadata,
    now: input.now
  });
  return { ...settled, reservation: settled.reservation, idempotent: reserved.idempotent && settled.idempotent };
}

export function adjustCreditBalance(walletInput, input = {}) {
  const amount = signedInteger(input.amount, "amount");
  const reason = stringOr(input.reason, "");
  if (!reason) {
    throw new CreditSystemError("ADJUSTMENT_REASON_REQUIRED", "Admin adjustment requires a reason.", { amount });
  }
  if (amount === 0) return { wallet: createCreditSystemWallet(walletInput), transaction: null, idempotent: true };
  if (amount > 0) {
    return grantCreditBucket(walletInput, {
      amount,
      sourceType: "admin_adjustment",
      label: input.label ?? "后台调增",
      idempotencyKey: input.idempotencyKey ?? input.transactionId,
      priority: input.priority ?? 70,
      metadata: { ...objectOr(input.metadata), reason, operatorId: input.operatorId ?? null },
      createdAt: input.now ?? null
    });
  }
  return spendCreditAmount(walletInput, {
    amount: Math.abs(amount),
    label: input.label ?? "后台扣减",
    idempotencyKey: input.idempotencyKey ?? input.transactionId,
    reason,
    referenceType: "admin_adjustment",
    referenceId: input.operatorId ?? "admin",
    metadata: { ...objectOr(input.metadata), reason, operatorId: input.operatorId ?? null },
    now: input.now
  });
}

export function expireCreditBuckets(walletInput, input = {}) {
  const wallet = createCreditSystemWallet(walletInput);
  const now = parseDate(input.now, new Date());
  let expiredTotal = 0;
  const transactions = [];
  const nextBuckets = wallet.buckets.map(bucket => {
    if (!isExpiredAt(bucket.expiresAt, now) || bucket.remainingAmount <= 0) return bucket;
    const expiredAmount = bucket.remainingAmount;
    expiredTotal += expiredAmount;
    const nextBucket = { ...bucket, remainingAmount: 0 };
    transactions.push(createTransaction(wallet, {
      type: "expire",
      status: "posted",
      amount: -expiredAmount,
      label: input.label ?? "积分过期",
      bucketId: bucket.id,
      idempotencyKey: `${input.idempotencyPrefix ?? "expire"}:${bucket.id}:${utcDateKey(now)}`,
      balanceAfter: wallet.availableCredits - expiredTotal + wallet.reservedCredits,
      reservedAfter: wallet.reservedCredits,
      referenceType: "bucket",
      referenceId: bucket.id,
      createdAt: now.toISOString()
    }));
    return nextBucket;
  });
  if (expiredTotal === 0) return { wallet, expiredAmount: 0, transactions: [], idempotent: true };
  return {
    wallet: reconcileCreditSystemWallet({
      ...wallet,
      availableCredits: wallet.availableCredits - expiredTotal,
      buckets: nextBuckets,
      transactions: [...wallet.transactions, ...transactions]
    }),
    expiredAmount: expiredTotal,
    transactions,
    idempotent: false
  };
}

export function reconcileCreditSystemWallet(walletInput) {
  const wallet = createCreditSystemWallet(walletInput);
  const expectedAvailable = sumCredits(wallet.buckets.map(bucket => bucket.remainingAmount));
  const expectedReserved = sumCredits(wallet.buckets.map(bucket => bucket.reservedAmount));
  const failures = [];

  if (wallet.availableCredits !== expectedAvailable) failures.push({ field: "availableCredits", actual: wallet.availableCredits, expected: expectedAvailable });
  if (wallet.reservedCredits !== expectedReserved) failures.push({ field: "reservedCredits", actual: wallet.reservedCredits, expected: expectedReserved });
  for (const bucket of wallet.buckets) {
    if (bucket.remainingAmount + bucket.reservedAmount > bucket.originalAmount) failures.push({ field: "buckets", bucketId: bucket.id, reason: "remaining+reserved exceeds original" });
  }
  for (const reservation of wallet.reservations) {
    const allocationTotal = sumCredits(reservation.allocations.map(allocation => allocation.amountReserved));
    if (allocationTotal !== reservation.amountReserved) failures.push({ field: "reservations", reservationId: reservation.id, reason: "allocation total mismatch" });
    if (reservation.amountSettled > reservation.amountReserved) failures.push({ field: "reservations", reservationId: reservation.id, reason: "settled exceeds reserved" });
  }
  const latest = wallet.transactions.at(-1);
  if (latest && latest.balanceAfter !== wallet.availableCredits + wallet.reservedCredits) {
    failures.push({ field: "transactions.balanceAfter", transactionId: latest.id, actual: latest.balanceAfter, expected: wallet.availableCredits + wallet.reservedCredits });
  }
  if (latest && latest.reservedAfter !== wallet.reservedCredits) {
    failures.push({ field: "transactions.reservedAfter", transactionId: latest.id, actual: latest.reservedAfter, expected: wallet.reservedCredits });
  }

  if (failures.length > 0) {
    throw new CreditSystemError("WALLET_RECONCILE_FAILED", `Wallet ${wallet.id} failed credit reconciliation.`, {
      walletId: wallet.id,
      availableCredits: wallet.availableCredits,
      reservedCredits: wallet.reservedCredits,
      failures
    });
  }
  return wallet;
}

export function buildCreditWalletOverview(walletInput, options = {}) {
  const wallet = createCreditSystemWallet(walletInput);
  const now = parseDate(options.now, new Date());
  const buckets = wallet.buckets.map(bucket => ({
    ...bucket,
    expired: isExpiredAt(bucket.expiresAt, now),
    totalAmount: bucket.remainingAmount + bucket.reservedAmount
  }));
  const expiringTodayCredits = sumCredits(buckets
    .filter(bucket => bucket.expiresAt && !bucket.expired && utcDateKey(parseDate(bucket.expiresAt, now)) === utcDateKey(now))
    .map(bucket => bucket.remainingAmount));
  const permanentCredits = sumCredits(buckets.filter(bucket => !bucket.expiresAt).map(bucket => bucket.remainingAmount));
  const receivedLedger = wallet.transactions.filter(transaction => transaction.amount > 0 || ["grant", "daily_refresh_free", "daily_refresh_membership", "signup_bonus", "membership_grant", "topup_purchase", "redeem_code", "refund"].includes(transaction.type));
  const usedLedger = wallet.transactions.filter(transaction => transaction.amount < 0 || ["settle", "expire", "admin_adjustment"].includes(transaction.type));

  return {
    walletId: wallet.id,
    workspaceId: wallet.workspaceId,
    currency: wallet.currency,
    displayName: wallet.displayName,
    planId: wallet.planId,
    availableCredits: wallet.availableCredits,
    reservedCredits: wallet.reservedCredits,
    totalCredits: wallet.availableCredits + wallet.reservedCredits,
    expiringTodayCredits,
    permanentCredits,
    buckets,
    reservations: wallet.reservations,
    transactions: wallet.transactions,
    receivedLedger,
    usedLedger,
    catalog: getCreditCatalog()
  };
}

export function transactionsForDisplay(walletInput) {
  const wallet = createCreditSystemWallet(walletInput);
  return wallet.transactions
    .filter(transaction => transaction.type !== "reserve")
    .map(transaction => ({
      id: transaction.id,
      type: displayTypeForTransaction(transaction),
      amount: transaction.amount,
      label: transaction.label,
      reservationId: transaction.reservationId,
      taskId: transaction.referenceType === "task" ? transaction.referenceId : null,
      createdAt: transaction.createdAt
    }))
    .reverse();
}

function normalizeBucket(source = {}) {
  const originalAmount = creditAmount(source.originalAmount ?? source.original_amount, "originalAmount", { allowZero: true });
  const remainingAmount = creditAmount(source.remainingAmount ?? source.remaining_amount ?? originalAmount, "remainingAmount", { allowZero: true });
  const reservedAmount = creditAmount(source.reservedAmount ?? source.reserved_amount ?? 0, "reservedAmount", { allowZero: true });
  if (remainingAmount + reservedAmount > originalAmount) {
    throw new CreditSystemError("INVALID_BUCKET_AMOUNT", "Bucket remaining + reserved cannot exceed original amount.", {
      bucketId: source.id,
      originalAmount,
      remainingAmount,
      reservedAmount
    });
  }
  return {
    id: String(source.id),
    sourceType: source.sourceType ?? source.source_type ?? "grant",
    originalAmount,
    remainingAmount,
    reservedAmount,
    expiresAt: source.expiresAt ?? source.expires_at ?? null,
    priority: Number.isInteger(source.priority) ? source.priority : priorityForSource(source.sourceType ?? source.source_type),
    grantPolicyId: source.grantPolicyId ?? source.grant_policy_id ?? null,
    orderId: source.orderId ?? source.order_id ?? null,
    metadata: objectOr(source.metadata),
    createdAt: source.createdAt ?? source.created_at ?? null
  };
}

function normalizeReservation(source = {}) {
  const status = source.status ?? ACTIVE_RESERVATION_STATUS;
  if (status !== ACTIVE_RESERVATION_STATUS && !TERMINAL_RESERVATION_STATUSES.has(status)) {
    throw new CreditSystemError("INVALID_RESERVATION_STATUS", `Unsupported reservation status: ${status}.`, { reservationId: source.id, status });
  }
  const amountReserved = creditAmount(source.amountReserved ?? source.amount_reserved, "amountReserved", { allowZero: true });
  const amountSettled = creditAmount(source.amountSettled ?? source.amount_settled ?? 0, "amountSettled", { allowZero: true });
  if (amountSettled > amountReserved) {
    throw new CreditSystemError("INVALID_RESERVATION_AMOUNT", "Reservation settled amount cannot exceed reserved amount.", { reservationId: source.id });
  }
  return {
    id: String(source.id),
    walletId: source.walletId ?? source.wallet_id ?? null,
    taskId: source.taskId ?? source.task_id ?? null,
    quoteId: source.quoteId ?? source.quote_id ?? null,
    status,
    amountReserved,
    amountSettled,
    priceCatalogVersion: source.priceCatalogVersion ?? source.price_catalog_version ?? CREDIT_CATALOG_VERSION,
    idempotencyKey: source.idempotencyKey ?? source.idempotency_key ?? null,
    expiresAt: source.expiresAt ?? source.expires_at ?? null,
    allocations: asArray(source.allocations).map(normalizeAllocation),
    metadata: objectOr(source.metadata),
    createdAt: source.createdAt ?? source.created_at ?? null,
    settledAt: source.settledAt ?? source.settled_at ?? null,
    releasedAt: source.releasedAt ?? source.released_at ?? null
  };
}

function normalizeAllocation(source = {}) {
  return {
    bucketId: String(source.bucketId ?? source.bucket_id),
    amountReserved: creditAmount(source.amountReserved ?? source.amount_reserved, "allocation.amountReserved", { allowZero: true }),
    amountSettled: creditAmount(source.amountSettled ?? source.amount_settled ?? 0, "allocation.amountSettled", { allowZero: true }),
    sourceType: source.sourceType ?? source.source_type ?? null,
    sourceExpiresAt: source.sourceExpiresAt ?? source.source_expires_at ?? null
  };
}

function normalizeTransaction(source = {}) {
  const type = source.type ?? "grant";
  if (!CREDIT_TRANSACTION_TYPES.has(type)) {
    throw new CreditSystemError("INVALID_TRANSACTION_TYPE", `Unsupported credit transaction type: ${type}.`, { type });
  }
  return {
    id: String(source.id),
    walletId: source.walletId ?? source.wallet_id ?? null,
    bucketId: source.bucketId ?? source.bucket_id ?? null,
    reservationId: source.reservationId ?? source.reservation_id ?? null,
    type,
    status: source.status ?? "posted",
    amount: signedInteger(source.amount, "transaction.amount"),
    balanceAfter: creditAmount(source.balanceAfter ?? source.balance_after ?? 0, "balanceAfter", { allowZero: true }),
    reservedAfter: creditAmount(source.reservedAfter ?? source.reserved_after ?? 0, "reservedAfter", { allowZero: true }),
    label: source.label ?? source.description ?? "",
    idempotencyKey: source.idempotencyKey ?? source.idempotency_key ?? null,
    priceCatalogVersion: source.priceCatalogVersion ?? source.price_catalog_version ?? null,
    referenceType: source.referenceType ?? source.reference_type ?? null,
    referenceId: source.referenceId ?? source.reference_id ?? null,
    metadata: objectOr(source.metadata),
    createdAt: source.createdAt ?? source.created_at ?? null
  };
}

function createTransaction(wallet, input) {
  return normalizeTransaction({
    id: input.id ?? transactionIdFromKey(input.idempotencyKey) ?? `txn_${wallet.transactions.length + 1}`,
    walletId: wallet.id,
    bucketId: input.bucketId ?? null,
    reservationId: input.reservationId ?? null,
    type: input.type,
    status: input.status ?? "posted",
    amount: input.amount,
    balanceAfter: input.balanceAfter,
    reservedAfter: input.reservedAfter,
    label: input.label ?? input.type,
    idempotencyKey: input.idempotencyKey,
    priceCatalogVersion: input.priceCatalogVersion ?? null,
    referenceType: input.referenceType ?? null,
    referenceId: input.referenceId ?? null,
    metadata: input.metadata,
    createdAt: input.createdAt ?? null
  });
}

function transactionIdFromKey(idempotencyKey) {
  if (!idempotencyKey) return null;
  return "txn_" + String(idempotencyKey).replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 120);
}

function findMembershipPlan(planId) {
  return creditMembershipPlans.find(plan => plan.id === planId) ?? creditMembershipPlans[0];
}

function findTransactionByIdempotency(wallet, idempotencyKey) {
  return wallet.transactions.find(transaction => transaction.idempotencyKey === idempotencyKey) ?? null;
}

function findReservation(wallet, reservationId, action) {
  const id = typeof reservationId === "object" ? reservationId.id : reservationId;
  const reservation = wallet.reservations.find(candidate => candidate.id === id);
  if (!reservation) {
    throw new CreditSystemError("RESERVATION_NOT_FOUND", `Cannot ${action} missing reservation ${id}.`, { walletId: wallet.id, reservationId: id });
  }
  return reservation;
}

function findTerminalReservationTransaction(wallet, reservationId) {
  return wallet.transactions.find(transaction => ["settle", "release"].includes(transaction.type) && transaction.reservationId === reservationId) ?? null;
}

function spendOrder(buckets, now) {
  return buckets
    .filter(bucket => bucket.remainingAmount > 0 && !isExpiredAt(bucket.expiresAt, now))
    .sort(compareBucketSpendOrder);
}

function allocationSpendOrder(allocations) {
  return [...allocations].sort((left, right) => compareNullableDate(left.sourceExpiresAt, right.sourceExpiresAt) || 0);
}

function compareBucketSpendOrder(left, right) {
  return (left.priority - right.priority)
    || compareNullableDate(left.expiresAt, right.expiresAt)
    || compareNullableDate(left.createdAt, right.createdAt)
    || left.id.localeCompare(right.id);
}

function compareNullableDate(left, right) {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return parseDate(left, new Date(0)).getTime() - parseDate(right, new Date(0)).getTime();
}

function isExpiredAt(expiresAt, now) {
  return Boolean(expiresAt) && parseDate(expiresAt, now).getTime() <= now.getTime();
}

function priorityForSource(sourceType = "grant") {
  if (sourceType.startsWith("daily_refresh")) return 10;
  if (sourceType === "signup_bonus") return 30;
  if (sourceType === "membership_period_grant" || sourceType === "membership_grant") return 40;
  if (sourceType === "redeem_code") return 50;
  if (sourceType === "admin_adjustment") return 70;
  if (sourceType === "topup_purchase") return 100;
  return 90;
}

function transactionTypeForGrant(sourceType = "grant") {
  if (CREDIT_TRANSACTION_TYPES.has(sourceType)) return sourceType;
  if (sourceType === "membership_period_grant") return "membership_grant";
  return "grant";
}

function labelForSource(sourceType = "grant") {
  const labels = {
    signup_bonus: "首次注册赠送",
    daily_refresh_free: "免费版每日刷新",
    daily_refresh_membership: "会员每日刷新",
    membership_grant: "会员月度赠送",
    membership_period_grant: "会员月度赠送",
    topup_purchase: "单购积分包",
    redeem_code: "兑换码",
    admin_adjustment: "后台调整"
  };
  return labels[sourceType] ?? "积分发放";
}

function displayTypeForTransaction(transaction) {
  if (["settle", "expire"].includes(transaction.type)) return "consume";
  if (transaction.type === "release") return "release";
  return transaction.amount >= 0 ? "grant" : "consume";
}

function pickNumber(source, keys, fallback) {
  for (const key of keys) {
    if (source[key] != null) return source[key];
  }
  return fallback;
}

function creditAmount(value, field, options = {}) {
  const allowZero = options.allowZero === true;
  if (!Number.isInteger(value) || value < 0 || (!allowZero && value === 0)) {
    throw new CreditSystemError("INVALID_CREDIT_AMOUNT", `${field} must be a ${allowZero ? "non-negative" : "positive"} integer.`, { field, value });
  }
  return value;
}

function signedInteger(value, field) {
  if (!Number.isInteger(value)) throw new CreditSystemError("INVALID_CREDIT_AMOUNT", `${field} must be an integer.`, { field, value });
  return value;
}

function stringOr(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function objectOr(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function sumCredits(values) {
  return values.reduce((total, value) => total + value, 0);
}

function parseDate(value, fallback) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return fallback instanceof Date ? fallback : new Date(fallback);
}

function startOfUtcDay(date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function endOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

function utcDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value));
}



