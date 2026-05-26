/*
  Warnings:

  - A unique constraint covering the columns `[token_hash]` on the table `refresh_tokens` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "api_keys" ADD COLUMN     "prefix" VARCHAR(8);

-- CreateIndex
CREATE INDEX "api_keys_prefix_is_revoked_idx" ON "api_keys"("prefix", "is_revoked");

-- CreateIndex
CREATE INDEX "api_keys_user_id_is_revoked_idx" ON "api_keys"("user_id", "is_revoked");

-- CreateIndex
CREATE INDEX "notifications_user_id_is_read_idx" ON "notifications"("user_id", "is_read");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "transactions_account_id_created_at_idx" ON "transactions"("account_id", "created_at" DESC);
