-- 认证接口限流：登录/注册/找回密码/重发验证邮件按 IP 的固定窗口计数。
-- 只覆盖凭据类 POST 接口，不影响服务端到服务端的 OAuth token/userinfo 调用。
CREATE TABLE IF NOT EXISTS rate_limit (
  scope TEXT NOT NULL,
  bucket TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (scope, bucket)
);
