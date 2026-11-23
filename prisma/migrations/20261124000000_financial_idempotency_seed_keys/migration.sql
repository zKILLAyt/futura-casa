ALTER TABLE "Income"
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "requestHash" TEXT,
  ADD COLUMN "seedKey" TEXT;

ALTER TABLE "Expense"
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "requestHash" TEXT,
  ADD COLUMN "seedKey" TEXT;

CREATE UNIQUE INDEX "Income_householdId_idempotencyKey_key"
  ON "Income"("householdId", "idempotencyKey");

CREATE UNIQUE INDEX "Expense_householdId_idempotencyKey_key"
  ON "Expense"("householdId", "idempotencyKey");

CREATE UNIQUE INDEX "Income_seedKey_key" ON "Income"("seedKey");
CREATE UNIQUE INDEX "Expense_seedKey_key" ON "Expense"("seedKey");
