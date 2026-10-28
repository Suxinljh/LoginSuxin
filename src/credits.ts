import type { Env } from './env'

/** 12 个月按审核时计算。 */
export const REFUND_WINDOW_MS = 365 * 24 * 60 * 60 * 1000
/**
 * 处理中的退款申请超过该时长仍未审核即自动失效。
 * 否则一笔无人审核的申请会让该账号永久无法提交新的退款（`refund_one_active` 唯一索引）。
 */
export const REFUND_PENDING_TTL_MS = 14 * 24 * 60 * 60 * 1000
/** 原路退款是跨服务的写请求：超时后结果未知，不能当成“未退款”直接重试。 */
const REFUND_FETCH_TIMEOUT_MS = 10_000

export type CreditLot = {
  id: string
  user_id: string
  app_id: string
  order_id: string
  credits: number
  remaining: number
  amount_cents: number
  paid_at: number
  created_at: number
}

export type RefundRequest = {
  id: string
  user_id: string
  kind: string
  status: string
  estimated_credits: number
  estimated_cents: number
  final_credits: number
  final_cents: number
  manual_cents: number
  note: string | null
  reviewed_by: string | null
  created_at: number
  reviewed_at: number | null
  completed_at: number | null
}

export type RefundItem = {
  id: string
  refund_id: string
  lot_id: string
  credits: number
  amount_cents: number
  final_credits: number
  final_cents: number
  status: string
  refund_no: string | null
  provider_ref: string | null
  message: string | null
  created_at: number
}

export type EstimateLot = CreditLot & { refund_cents: number; over_12m: boolean }

export type RefundEstimate = {
  balance: number
  refundable_credits: number
  estimated_cents: number
  lots: EstimateLot[]
  pending: RefundRequest | null
}

/** 按该笔订单的实际人民币对价比例计算可退金额，单笔向下取整到分。 */
export function refundCents(remaining: number, amountCents: number, credits: number): number {
  if (credits <= 0 || remaining <= 0) return 0
  return Math.floor((Math.min(remaining, credits) * amountCents) / credits)
}

export async function getBalance(env: Env, userId: string): Promise<number> {
  const row = await env.DB.prepare('select coalesce(sum(remaining), 0) as balance from credit_lot where user_id = ?')
    .bind(userId)
    .first<{ balance: number }>()
  return row?.balance ?? 0
}

export async function getPendingRefund(env: Env, userId: string, now = Date.now()): Promise<RefundRequest | null> {
  return env.DB.prepare(
    "select * from refund_request where user_id = ? and status in ('pending','reviewing','approved') and created_at >= ? order by created_at desc limit 1",
  ).bind(userId, now - REFUND_PENDING_TTL_MS).first<RefundRequest>()
}

export async function getRefundEstimate(env: Env, userId: string, now = Date.now()): Promise<RefundEstimate> {
  const rows = await env.DB.prepare(
    'select * from credit_lot where user_id = ? and remaining > 0 order by paid_at asc, created_at asc',
  ).bind(userId).all<CreditLot>()
  const lots: EstimateLot[] = (rows.results ?? []).map(lot => ({
    ...lot,
    refund_cents: refundCents(lot.remaining, lot.amount_cents, lot.credits),
    over_12m: lot.paid_at < now - REFUND_WINDOW_MS,
  }))
  return {
    balance: lots.reduce((sum, lot) => sum + lot.remaining, 0),
    refundable_credits: lots.reduce((sum, lot) => sum + lot.remaining, 0),
    estimated_cents: lots.reduce((sum, lot) => sum + lot.refund_cents, 0),
    lots,
    pending: await getPendingRefund(env, userId),
  }
}

/**
 * 原路退款通道。当前付费订单由 EchoMind 的支付宝商户号收款，
 * 账号中心通过 EchoMind 的管理员退款接口发起原路退款；后续可替换为账号中心自己的支付适配器。
 */
export async function refundOrder(
  env: Env,
  appId: string,
  orderId: string,
  amountCents: number,
  refundNo: string,
): Promise<{ ok: true; providerRef: string } | { ok: false; message: string }> {
  if (appId !== 'echomind') return { ok: false, message: '该订单所属应用暂未配置原路退款通道' }
  if (!env.ECHOMIND_REFUND_URL || !env.ECHOMIND_PAY_ADMIN_TOKEN) {
    return { ok: false, message: '原路退款通道尚未配置' }
  }
  try {
    const response = await fetch(env.ECHOMIND_REFUND_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-pay-admin': env.ECHOMIND_PAY_ADMIN_TOKEN,
      },
      body: JSON.stringify({ outTradeNo: orderId, amountCents, refundNo }),
      signal: AbortSignal.timeout(REFUND_FETCH_TIMEOUT_MS),
    })
    const data = await response.json().catch(() => ({})) as {
      error?: string
      result?: { trade_no?: string; out_trade_no?: string }
    }
    if (!response.ok) return { ok: false, message: data.error || `原路退款失败（HTTP ${response.status}）` }
    return { ok: true, providerRef: data.result?.trade_no || data.result?.out_trade_no || '' }
  } catch (error) {
    // 超时代表“结果未知”：退款可能已在支付宝侧成功，必须人工核对后再重试，避免重复退款。
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      return { ok: false, message: '原路退款请求超时，结果未知；请先在支付宝后台核对该订单，确认未退款后再重试' }
    }
    return { ok: false, message: '无法连接原路退款服务' }
  }
}
