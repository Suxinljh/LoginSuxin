-- 每日对账结果：余额、台账与超时退款申请的一致性检查留痕，方便在管理页面回看。
CREATE TABLE IF NOT EXISTS reconcile_report (
  id TEXT PRIMARY KEY NOT NULL,
  created_at INTEGER NOT NULL,
  users_checked INTEGER NOT NULL,
  mismatches INTEGER NOT NULL,
  expired_refunds INTEGER NOT NULL,
  skipped_items INTEGER NOT NULL DEFAULT 0,
  detail TEXT
);

CREATE INDEX IF NOT EXISTS reconcile_report_created_idx ON reconcile_report (created_at DESC);
