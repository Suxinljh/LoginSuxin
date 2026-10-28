import type { Env } from './env'
import {
  REFUND_PENDING_TTL_MS,
  REFUND_WINDOW_MS,
  getBalance,
  getPendingRefund,
  getRefundEstimate,
  refundCents,
  refundOrder,
  type CreditLot,
  type RefundItem,
  type RefundRequest,
} from './credits'

class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } })
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

const MAX_CREDITS = 100_000
const MAX_AMOUNT_CENTS = 100_000_000
/** 付费时间允许的最早值（2020-01-01）；避免 0/缺失被当成 1970 年的订单。 */
const MIN_PAID_AT = Date.UTC(2020, 0, 1)
const PAID_AT_FUTURE_MS = 24 * 60 * 60 * 1000

/**
 * 严格整数校验：类型不对、越界都返回 400，不做默认值兜底。
 * 之前用「非法值 = 最小值」会让 {"credits":"30"} 按 1 积分扣费并写进幂等表，后续正确重试被当成重复。
 */
function requireInt(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new ApiError(400, `${field} 必须是 ${min}～${max} 的整数`)
  }
  return value
}

function requireId(value: unknown, field: string, maxLength = 120): string {
  const id = text(value).trim()
  if (!id || id.length > maxLength) throw new ApiError(400, `${field} 无效`)
  return id
}

function requirePaidAt(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < MIN_PAID_AT || value > Date.now() + PAID_AT_FUTURE_MS) {
    throw new ApiError(400, 'paidAt 必须是支付成功时间的毫秒时间戳')
  }
  return value
}

type ReviewItem = RefundItem & {
  lot_credits: number
  lot_remaining: number
  lot_amount: number
  lot_paid: number
  lot_app: string
  lot_order: string
}

/**
 * 每个账号一个 Durable Object，串行化消费、退款申请与退款审核，
 * 避免「计费延迟 + 并发退款」造成超额退款或余额负数。
 */
export class AccountDO implements DurableObject {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(_ctx: DurableObjectState, private readonly env: Env) {}

  fetch(request: Request): Promise<Response> {
    const run = this.queue.then(() => this.handle(request))
    this.queue = run.then(() => undefined, () => undefined)
    return run
  }

  private async handle(request: Request): Promise<Response> {
    let body: Record<string, unknown>
    try {
      body = (await request.json()) as Record<string, unknown>
    } catch {
      return json({ error: '请求体必须是 JSON' }, 400)
    }
    try {
      return json(await this.dispatch(body))
    } catch (error) {
      if (error instanceof ApiError) return json({ error: error.message }, error.status)
      console.error('[credits]', error)
      return json({ error: '操作失败，请稍后重试' }, 500)
    }
  }

  private async dispatch(body: Record<string, unknown>): Promise<unknown> {
    const userId = text(body.userId)
    if (!userId) throw new ApiError(400, '缺少用户标识')
    switch (body.op) {
      case 'consume': return this.consume(userId, body)
      case 'credit': return this.credit(userId, body)
      case 'import': return this.importLots(userId, body)
      case 'apply': return this.apply(userId)
      case 'review': return this.review(body)
      case 'platformRefund': return this.platformRefund(body)
      default: throw new ApiError(400, '未知操作')
    }
  }

  private async getRequest(id: string): Promise<RefundRequest | null> {
    return this.env.DB.prepare('select * from refund_request where id = ?').bind(id).first<RefundRequest>()
  }

  private async getItems(refundId: string): Promise<RefundItem[]> {
    const rows = await this.env.DB.prepare('select * from refund_item where refund_id = ? order by created_at asc')
      .bind(refundId)
      .all<RefundItem>()
    return rows.results ?? []
  }

  /**
   * 处理中的申请超时失效：把申请置为 expired，并把没处理过的明细置为 skipped。
   * 必须在提交新申请前调用，否则 `refund_one_active` 唯一索引会让新申请直接插入失败。
   */
  private async expireStaleRefunds(userId: string, now: number): Promise<string[]> {
    const stale = await this.env.DB.prepare(
      "select id from refund_request where user_id = ? and status in ('pending','reviewing','approved') and created_at < ?",
    ).bind(userId, now - REFUND_PENDING_TTL_MS).all<{ id: string }>()
    const ids = (stale.results ?? []).map(row => row.id)
    if (ids.length === 0) return []
    const statements: D1PreparedStatement[] = []
    for (const id of ids) {
      statements.push(
        this.env.DB.prepare(
          "update refund_request set status = 'expired', note = ?, completed_at = ? where id = ? and status in ('pending','reviewing','approved')",
        ).bind('超过 14 天未审核，申请已自动失效；可重新提交。', now, id),
        this.env.DB.prepare("update refund_item set status = 'skipped', message = ? where refund_id = ? and status = 'pending'")
          .bind('退款申请已失效', id),
      )
    }
    await this.env.DB.batch(statements)
    return ids
  }

  /** 应用扣减：同一 appId + userId + requestId 幂等；按付费订单时间 FIFO 扣减。 */
  private async consume(userId: string, body: Record<string, unknown>) {
    const appId = requireId(body.appId, 'appId', 64)
    const requestId = requireId(body.requestId, 'requestId')
    const credits = requireInt(body.credits, 'credits', 1, MAX_CREDITS)
    const existing = await this.env.DB.prepare('select credits from app_usage where app_id = ? and user_id = ? and request_id = ?')
      .bind(appId, userId, requestId)
      .first<{ credits: number }>()
    if (existing) {
      return { duplicate: true, credits: existing.credits, balance: await getBalance(this.env, userId) }
    }

    const rows = await this.env.DB.prepare(
      'select * from credit_lot where user_id = ? and remaining > 0 order by paid_at asc, created_at asc',
    ).bind(userId).all<CreditLot>()
    const lots = rows.results ?? []
    const available = lots.reduce((sum, lot) => sum + lot.remaining, 0)
    if (available < credits) throw new ApiError(402, '积分不足，请先充值')

    const now = Date.now()
    const statements: D1PreparedStatement[] = []
    let left = credits
    for (const lot of lots) {
      if (left <= 0) break
      const take = Math.min(left, lot.remaining)
      statements.push(
        this.env.DB.prepare('update credit_lot set remaining = remaining - ? where id = ? and remaining >= ?')
          .bind(take, lot.id, take),
      )
      left -= take
    }
    const ledgerId = crypto.randomUUID()
    statements.push(
      this.env.DB.prepare('insert into credit_ledger (id, user_id, app_id, delta, reason, ref, created_at) values (?, ?, ?, ?, ?, ?, ?)')
        .bind(ledgerId, userId, appId, -credits, 'consume', requestId, now),
    )
    statements.push(
      this.env.DB.prepare('insert into app_usage (app_id, user_id, request_id, credits, created_at) values (?, ?, ?, ?, ?)')
        .bind(appId, userId, requestId, credits, now),
    )
    await this.env.DB.batch(statements)
    return { duplicate: false, credits, balance: await getBalance(this.env, userId), ledgerId }
  }

  /** 充值/付费订单入账；同一 appId + orderId 幂等。 */
  private async credit(userId: string, body: Record<string, unknown>) {
    const appId = requireId(body.appId, 'appId', 64)
    const orderId = requireId(body.orderId, 'orderId')
    const credits = requireInt(body.credits, 'credits', 1, MAX_CREDITS)
    const amountCents = requireInt(body.amountCents, 'amountCents', 1, MAX_AMOUNT_CENTS)
    const paidAt = requirePaidAt(body.paidAt)
    const existing = await this.env.DB.prepare('select id from credit_lot where app_id = ? and order_id = ?')
      .bind(appId, orderId)
      .first<{ id: string }>()
    if (existing) return { duplicate: true, lotId: existing.id, balance: await getBalance(this.env, userId) }

    const id = crypto.randomUUID()
    const now = Date.now()
    const results = await this.env.DB.batch([
      this.env.DB.prepare(
        `insert into credit_lot (id, user_id, app_id, order_id, credits, remaining, amount_cents, paid_at, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?) on conflict(app_id, order_id) do nothing`,
      ).bind(id, userId, appId, orderId, credits, credits, amountCents, paidAt, now),
      this.env.DB.prepare(
        `insert into credit_ledger (id, user_id, app_id, delta, reason, ref, created_at)
         select ?, ?, ?, ?, 'recharge', ?, ? where changes() = 1`,
      ).bind(crypto.randomUUID(), userId, appId, credits, orderId, now),
    ])
    return { duplicate: results[0]?.meta.changes !== 1, lotId: id, balance: await getBalance(this.env, userId) }
  }

  /**
   * 存量积分导入（EchoMind 等应用迁移用）。
   * 单条明细不合法时跳过并回报原因，不阻塞同批其他订单；重复订单计入 duplicates。
   */
  private async importLots(userId: string, body: Record<string, unknown>) {
    const appId = requireId(body.appId, 'appId', 64)
    const lots = Array.isArray(body.lots) ? body.lots : []
    if (lots.length === 0 || lots.length > 500) throw new ApiError(400, '导入参数无效')
    let imported = 0
    let duplicates = 0
    const skipped: { orderId: string; reason: string }[] = []
    for (const raw of lots) {
      const lot = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null
      const rawOrderId = lot ? text(lot.orderId).trim() : ''
      try {
        if (!lot) throw new ApiError(400, '明细必须是对象')
        const orderId = requireId(lot.orderId, 'orderId')
        const credits = requireInt(lot.credits, 'credits', 1, MAX_CREDITS)
        const remaining = requireInt(lot.remaining, 'remaining', 0, credits)
        const amountCents = requireInt(lot.amountCents, 'amountCents', 1, MAX_AMOUNT_CENTS)
        const paidAt = requirePaidAt(lot.paidAt)
        const now = Date.now()
        const results = await this.env.DB.batch([
          this.env.DB.prepare(
            `insert into credit_lot (id, user_id, app_id, order_id, credits, remaining, amount_cents, paid_at, created_at)
             values (?, ?, ?, ?, ?, ?, ?, ?, ?) on conflict(app_id, order_id) do nothing`,
          ).bind(crypto.randomUUID(), userId, appId, orderId, credits, remaining, amountCents, paidAt, now),
          this.env.DB.prepare(
            `insert into credit_ledger (id, user_id, app_id, delta, reason, ref, created_at)
             select ?, ?, ?, ?, 'import', ?, ? where changes() = 1`,
          ).bind(crypto.randomUUID(), userId, appId, remaining, orderId, now),
        ])
        if (results[0]?.meta.changes === 1) { imported += 1; continue }
        duplicates += 1
        // 重复订单不覆盖已有记录：把字段差异明确报出来（而不是静默忽略），
        // 让迁移/更正方能看出“已有数据与本次导入不一致”。
        const existing = await this.env.DB.prepare(
          'select user_id, credits, remaining, amount_cents, paid_at from credit_lot where app_id = ? and order_id = ?',
        ).bind(appId, orderId).first<{ user_id: string; credits: number; remaining: number; amount_cents: number; paid_at: number }>()
        if (!existing) continue
        const diffs: string[] = []
        if (existing.user_id !== userId) diffs.push('归属账号不同')
        else {
          if (existing.credits !== credits) diffs.push(`积分 ${existing.credits} → ${credits}`)
          if (existing.remaining !== remaining) diffs.push(`剩余 ${existing.remaining} → ${remaining}`)
          if (existing.amount_cents !== amountCents) diffs.push(`金额 ${existing.amount_cents} → ${amountCents}`)
          if (existing.paid_at !== paidAt) diffs.push('支付时间不同')
        }
        if (diffs.length > 0) {
          skipped.push({ orderId, reason: `订单已存在且数据不一致（${diffs.join('，')}），导入不会覆盖已有记录` })
        }
      } catch (error) {
        if (!(error instanceof ApiError)) throw error
        skipped.push({ orderId: rawOrderId, reason: error.message })
      }
    }
    return { imported, duplicates, skipped, balance: await getBalance(this.env, userId) }
  }

  /** 用户提交退款申请；不冻结积分，审核时按当时余额重算（符合“计费延迟”规则）。 */
  private async apply(userId: string) {
    const now = Date.now()
    await this.expireStaleRefunds(userId, now)
    const pending = await getPendingRefund(this.env, userId, now)
    if (pending) throw new ApiError(409, '你有一笔退款正在处理中，完成前不能提交新的申请')
    const estimate = await getRefundEstimate(this.env, userId, now)
    if (estimate.refundable_credits <= 0 || estimate.estimated_cents < 1) {
      throw new ApiError(400, '当前没有可退的未消耗付费积分')
    }
    const id = crypto.randomUUID()
    const statements: D1PreparedStatement[] = [
      this.env.DB.prepare(
        `insert into refund_request (id, user_id, kind, status, estimated_credits, estimated_cents, created_at)
         values (?, ?, 'user', 'pending', ?, ?, ?)`,
      ).bind(id, userId, estimate.refundable_credits, estimate.estimated_cents, now),
    ]
    for (const lot of estimate.lots) {
      if (lot.refund_cents <= 0) continue
      statements.push(
        this.env.DB.prepare(
          `insert into refund_item (id, refund_id, lot_id, credits, amount_cents, created_at)
           values (?, ?, ?, ?, ?, ?)`,
        ).bind(crypto.randomUUID(), id, lot.id, lot.remaining, lot.refund_cents, now),
      )
    }
    await this.env.DB.batch(statements)
    return { request: await this.getRequest(id), items: await this.getItems(id) }
  }

  /** 管理员审核：按审核时余额重算最终金额；≤12 个月原路退，>12 个月转人工。 */
  private async review(body: Record<string, unknown>) {
    const refundId = text(body.refundId)
    const action = text(body.action)
    const note = text(body.note)
    const admin = text(body.admin) || 'admin'
    if (!refundId || !['approve', 'reject'].includes(action)) throw new ApiError(400, '审核参数无效')
    const request = await this.getRequest(refundId)
    if (!request) throw new ApiError(404, '退款申请不存在')
    // `failed` 允许重新审核：已退款/转人工/跳过的明细会被跳过，只重试失败项。
    if (request.status === 'expired') throw new ApiError(409, '该退款申请已失效，请让用户重新提交')
    if (!['pending', 'reviewing', 'failed'].includes(request.status)) throw new ApiError(409, '该退款申请已处理')
    const now = Date.now()

    if (action === 'reject') {
      await this.env.DB.prepare(
        "update refund_request set status = 'rejected', note = ?, reviewed_by = ?, reviewed_at = ?, completed_at = ? where id = ?",
      ).bind(note, admin, now, now, refundId).run()
      return { request: await this.getRequest(refundId), items: await this.getItems(refundId) }
    }

    const rows = await this.env.DB.prepare(
      `select i.*, l.credits as lot_credits, l.remaining as lot_remaining, l.amount_cents as lot_amount,
              l.paid_at as lot_paid, l.app_id as lot_app, l.order_id as lot_order
       from refund_item i join credit_lot l on l.id = i.lot_id where i.refund_id = ? order by i.created_at asc`,
    ).bind(refundId).all<ReviewItem>()
    const items = rows.results ?? []
    const finals = items.map(item => {
      if (item.status === 'refunded' || item.status === 'manual') {
        return {
          item,
          finalCredits: item.final_credits,
          finalCents: item.final_cents,
          manual: item.status === 'manual',
          done: true,
        }
      }
      if (item.status === 'skipped') {
        return { item, finalCredits: 0, finalCents: 0, manual: false, done: true }
      }
      const finalCredits = Math.max(0, Math.min(item.credits, item.lot_remaining))
      return {
        item,
        finalCredits,
        finalCents: refundCents(finalCredits, item.lot_amount, item.lot_credits),
        manual: item.lot_paid < now - REFUND_WINDOW_MS,
        done: false,
      }
    })
    const finalTotal = finals.reduce((sum, entry) => sum + entry.finalCents, 0)
    if (finalTotal < 1) {
      // 拒绝时把未处理的明细一起关闭，避免留下永远停在 pending 的明细。
      const statements: D1PreparedStatement[] = [
        this.env.DB.prepare(
          "update refund_request set status = 'rejected', note = ?, reviewed_by = ?, reviewed_at = ?, completed_at = ?, final_cents = 0, final_credits = 0 where id = ?",
        ).bind('审核完成时可退金额不足 0.01 元，不再发起退款。', admin, now, now, refundId),
      ]
      for (const entry of finals) {
        if (entry.done) continue
        statements.push(
          this.env.DB.prepare("update refund_item set status = 'skipped', message = ? where id = ?")
            .bind('审核完成时可退金额不足 0.01 元', entry.item.id),
        )
      }
      await this.env.DB.batch(statements)
      return { request: await this.getRequest(refundId), items: await this.getItems(refundId) }
    }

    let finalCents = 0
    let finalCredits = 0
    let manualCents = 0
    let failed = 0
    for (const entry of finals) {
      const { item, finalCredits: credits, finalCents: cents, manual } = entry
      if (entry.done) {
        finalCents += cents
        finalCredits += credits
        if (manual) manualCents += cents
        continue
      }
      if (cents <= 0 || credits <= 0) {
        await this.env.DB.prepare("update refund_item set status = 'skipped', message = ? where id = ?")
          .bind('审核时已无未消耗积分', item.id).run()
        continue
      }
      if (manual) {
        // 超过 12 个月无法自动原路退：扣减积分、记台账，转人工退款。
        await this.env.DB.batch([
          this.env.DB.prepare('update credit_lot set remaining = remaining - ? where id = ? and remaining >= ?')
            .bind(credits, item.lot_id, credits),
          this.env.DB.prepare('insert into credit_ledger (id, user_id, app_id, delta, reason, ref, created_at) values (?, ?, ?, ?, ?, ?, ?)')
            .bind(crypto.randomUUID(), request.user_id, item.lot_app, -credits, 'refund', item.id, now),
          this.env.DB.prepare(
            "update refund_item set final_credits = ?, final_cents = ?, status = 'manual', message = ? where id = ?",
          ).bind(credits, cents, '订单超过 12 个月，需人工退款', item.id),
        ])
        finalCents += cents
        finalCredits += credits
        manualCents += cents
        continue
      }

      await this.env.DB.prepare("update refund_item set status = 'processing', refund_no = ?, message = ? where id = ?")
        .bind(item.id, '正在发起原路退款', item.id).run()
      const refunded = await refundOrder(this.env, item.lot_app, item.lot_order, cents, item.id)
      if (!refunded.ok) {
        failed += 1
        await this.env.DB.prepare("update refund_item set status = 'failed', message = ? where id = ?")
          .bind(refunded.message, item.id).run()
        continue
      }
      await this.env.DB.batch([
        this.env.DB.prepare('update credit_lot set remaining = remaining - ? where id = ? and remaining >= ?')
          .bind(credits, item.lot_id, credits),
        this.env.DB.prepare('insert into credit_ledger (id, user_id, app_id, delta, reason, ref, created_at) values (?, ?, ?, ?, ?, ?, ?)')
          .bind(crypto.randomUUID(), request.user_id, item.lot_app, -credits, 'refund', item.id, now),
        this.env.DB.prepare(
          "update refund_item set final_credits = ?, final_cents = ?, status = 'refunded', provider_ref = ?, message = ? where id = ?",
        ).bind(credits, cents, refunded.providerRef, '原路退款已发起', item.id),
      ])
      finalCents += cents
      finalCredits += credits
    }

    const status = failed > 0 ? 'failed' : 'completed'
    await this.env.DB.prepare(
      `update refund_request set status = ?, final_credits = ?, final_cents = ?, manual_cents = ?,
         note = ?, reviewed_by = ?, reviewed_at = ?, completed_at = ? where id = ?`,
    ).bind(status, finalCredits, finalCents, manualCents, note, admin, now, now, refundId).run()
    return { request: await this.getRequest(refundId), items: await this.getItems(refundId) }
  }

  /** 平台原因退款：管理员发起，按未使用付费积分对价退款，不要求用户先提交申请。 */
  private async platformRefund(body: Record<string, unknown>) {
    const userId = text(body.userId)
    const reason = text(body.reason) || '平台原因退款'
    const admin = text(body.admin) || 'admin'
    if (!userId) throw new ApiError(400, '缺少用户标识')
    const now = Date.now()
    await this.expireStaleRefunds(userId, now)
    const pending = await getPendingRefund(this.env, userId, now)
    if (pending) throw new ApiError(409, '该账号已有处理中的退款申请')
    const estimate = await getRefundEstimate(this.env, userId, now)
    if (estimate.refundable_credits <= 0 || estimate.estimated_cents < 1) {
      throw new ApiError(400, '该账号没有可退的未使用付费积分')
    }
    const id = crypto.randomUUID()
    const statements: D1PreparedStatement[] = [
      this.env.DB.prepare(
        `insert into refund_request (id, user_id, kind, status, estimated_credits, estimated_cents, created_at)
         values (?, ?, 'platform', 'pending', ?, ?, ?)`,
      ).bind(id, userId, estimate.refundable_credits, estimate.estimated_cents, now),
    ]
    for (const lot of estimate.lots) {
      if (lot.refund_cents <= 0) continue
      statements.push(
        this.env.DB.prepare(
          `insert into refund_item (id, refund_id, lot_id, credits, amount_cents, created_at)
           values (?, ?, ?, ?, ?, ?)`,
        ).bind(crypto.randomUUID(), id, lot.id, lot.remaining, lot.refund_cents, now),
      )
    }
    await this.env.DB.batch(statements)
    return this.review({ refundId: id, action: 'approve', note: reason, admin })
  }
}
