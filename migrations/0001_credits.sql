-- 账号积分与退款。
-- 所有积分均来自付费充值（当前不存在赠送积分），因此 credit_lot 不再区分 source。

CREATE TABLE IF NOT EXISTS credit_lot (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  app_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  credits INTEGER NOT NULL,
  remaining INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  paid_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS credit_lot_app_order_idx ON credit_lot (app_id, order_id);
CREATE INDEX IF NOT EXISTS credit_lot_user_idx ON credit_lot (user_id, paid_at);

CREATE TABLE IF NOT EXISTS credit_ledger (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  app_id TEXT,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ref TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS credit_ledger_user_idx ON credit_ledger (user_id, created_at DESC);

-- 应用消费幂等。幂等键必须带 user_id：requestId 由应用生成（可能受客户端影响），
-- 只用 (app_id, request_id) 会让不同用户撞到同一 requestId 时被误判为重复请求而不扣费。
CREATE TABLE IF NOT EXISTS app_usage (
  app_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  credits INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (app_id, user_id, request_id)
);

CREATE INDEX IF NOT EXISTS app_usage_user_idx ON app_usage (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS refund_request (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL,
  estimated_credits INTEGER NOT NULL DEFAULT 0,
  estimated_cents INTEGER NOT NULL DEFAULT 0,
  final_credits INTEGER NOT NULL DEFAULT 0,
  final_cents INTEGER NOT NULL DEFAULT 0,
  manual_cents INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  reviewed_by TEXT,
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER,
  completed_at INTEGER
);

CREATE INDEX IF NOT EXISTS refund_request_user_idx ON refund_request (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS refund_request_status_idx ON refund_request (status, created_at);

-- 一个账号同一时间只允许一笔处理中的退款。
CREATE UNIQUE INDEX IF NOT EXISTS refund_one_active
  ON refund_request (user_id)
  WHERE status IN ('pending', 'reviewing', 'approved');

CREATE TABLE IF NOT EXISTS refund_item (
  id TEXT PRIMARY KEY NOT NULL,
  refund_id TEXT NOT NULL,
  lot_id TEXT NOT NULL,
  credits INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  final_credits INTEGER NOT NULL DEFAULT 0,
  final_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  refund_no TEXT,
  provider_ref TEXT,
  message TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS refund_item_refund_idx ON refund_item (refund_id);
