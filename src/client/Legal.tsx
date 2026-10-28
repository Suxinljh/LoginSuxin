import { Fragment, type ReactNode } from 'react'
import { AuthShell, TextLink } from './components'

const SUPPORT_MAILTO = 'mailto:support@ljhsu.xin'
const UPDATED_AT = '2026-10-28'

/** 邮箱不直接展示：正文里用「客服邮箱」四个字作为 mailto 链接。 */
function SupportLink({ children = '客服邮箱' }: { children?: ReactNode }) {
  return <a href={SUPPORT_MAILTO} className="underline underline-offset-2">{children}</a>
}

function RichText({ text }: { text: string }) {
  const parts = text.split('{{support}}')
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {part}
          {index < parts.length - 1 ? <SupportLink /> : null}
        </Fragment>
      ))}
    </>
  )
}

type SubBlock = { title: string; paragraphs?: string[]; items?: string[] }
type Block = { id?: string; title: string; paragraphs?: string[]; items?: string[]; subs?: SubBlock[] }

function BlockList({ blocks }: { blocks: Block[] }) {
  return (
    <div className="grid gap-4">
      {blocks.map(block => (
        <section key={block.title} id={block.id} className="scroll-mt-6 rounded-xl border border-border bg-surface-secondary p-4">
          <h3 className="mb-2 text-sm font-semibold">{block.title}</h3>
          {block.paragraphs?.map((paragraph, index) => (
            <p key={index} className="mb-2 last:mb-0"><RichText text={paragraph} /></p>
          ))}
          {block.items && (
            <ul className="list-disc space-y-1 pl-5">
              {block.items.map((item, index) => <li key={index}><RichText text={item} /></li>)}
            </ul>
          )}
          {block.subs?.map(sub => (
            <div key={sub.title} className="mt-3 first:mt-0">
              <h4 className="mb-1 text-sm font-semibold">{sub.title}</h4>
              {sub.paragraphs?.map((paragraph, index) => (
                <p key={index} className="mb-1 last:mb-0"><RichText text={paragraph} /></p>
              ))}
              {sub.items && (
                <ul className="list-disc space-y-1 pl-5">
                  {sub.items.map((item, index) => <li key={index}><RichText text={item} /></li>)}
                </ul>
              )}
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}

const PRIVACY: Block[] = [
  {
    title: '1. 我们的基本立场：统一身份，隔离数据，不建画像',
    paragraphs: [
      '本平台采用统一账户体系（Suxin 统一账号）。你只需注册一个账号，即可登录并使用 EchoMind 及同一运营方提供的现有及未来产品。为提供这种便捷体验，我们在后台维护一个统一的账户标识（系统生成的不可逆数字 ID）。',
      '统一账户仅用于身份验证和资产结算，不用于跨产品的隐私追踪或广告画像。',
      '注册和登录需要邮箱；使用 GitHub / Google 登录时，我们会从对应服务获得昵称和邮箱。昵称由你自行填写，可以是化名。我们不收集你的手机号码、身份证号码、精确地理位置、通讯录、生物识别等可直接识别身份的信息，也不将你的使用行为用于广告画像。',
      '你通过本平台输入、录制、同步或生成的内容（以下统称“用户内容”）的所有权与处置权归你。本平台是技术服务提供者，不是你内容的所有者或控制者。',
    ],
  },
  {
    title: '2. 权限调用清单与处理方式',
    paragraphs: ['本平台仅在对应功能被你主动触发时申请或调用相关权限。拒绝或关闭某项权限，不影响其他不依赖该权限的功能。'],
    items: [
      '麦克风权限：仅在你点击“录音”“语音输入”或类似主动操作时调用。音频在你的设备本地完成采集与处理；停止录音后，原始音频默认仅保留在本地，除非你在该功能界面中另行选择导出或云端处理。默认模式下不上传至服务器，EchoMind 的录音不会上传。',
      '剪切板权限：仅在你于输入框内执行粘贴操作时，读取你主动粘贴的文本内容，用于填入当前输入框。我们不读取剪切板中的其他内容，不在后台静默读取，不回传至服务器。',
      '练习历史与使用日志：EchoMind 在你登录后，会把练习历史（原始转写、语义稿、评分和报告，不含音频）自动同步到 EchoMind 的 D1 数据库，并在本机保留缓存，用于跨设备恢复。EchoMind 目前没有单独的同步开关；退出登录后停止同步。其他产品的历史记录可能仅保存在本地，具体以该产品界面说明为准。',
      '账号与积分数据：账号中心保存你的邮箱、昵称、登录会话、积分余额、充值订单、消费台账、退款申请与审核记录，用于登录、计费和退款。',
      '模型调用：使用平台模型时，出题、评价和分析所需的文字会发送给 EchoMind 的模型服务，结果会在服务端缓存最多 1 小时，用于避免网络重试导致重复扣费；使用自备模型时，你配置的 API Key 只保存在当前标签页会话，文字经本站服务转发给你选择的模型提供商。音频不会发送给模型提供商。',
      '主动同步或云端备份：其他需要云端存储的功能，仅在你主动启用时上传选定内容。',
    ],
  },
  {
    title: '3. 我们不主动读取的内容',
    paragraphs: [
      '除上述清单明确列出的场景外，本平台不会在后台或无关场景中读取你的剪切板、麦克风、位置、通讯录、相册或已安装应用列表。本平台不将用户内容用于训练面向公众的 AI 模型，也不在未经你单独同意的情况下向第三方共享可识别你身份的信息。',
    ],
  },
  {
    title: '4. 统一账户下的数据边界',
    items: [
      '身份与资产互通：你的账户 ID、登录状态以及购买的通用积分，在平台所有产品中互通。你在一个产品中充值获得的积分，可在其他产品中使用；退款也退回你的统一账户。',
      '内容与隐私隔离：不同产品中产生的用户内容默认相互隔离。你在 EchoMind 中产生的内容，不会自动出现在平台其他产品中，也不会被用于其他产品的功能改进，除非你在相关产品中主动开启跨产品同步或授权。',
    ],
  },
  {
    title: '5. 用户内容的存储与删除',
    items: [
      '音频：EchoMind 的录音在你的设备本地处理，不上传、不保存在练习历史中；确认回答后录音缓冲会释放。',
      '练习记录：EchoMind 的练习历史（原始转写、语义稿、评分、报告）在你登录后同步到 EchoMind 的 D1 数据库，并保留在本机缓存；不包含音频。',
      '账号与积分：保存在账号中心的 D1 数据库，用于登录、计费、退款和客服核对。',
      '模型响应缓存：平台模型的响应在服务端缓存最多 1 小时，用于避免网络重试重复扣费。',
      '本地数据：你可以在浏览器中清除本机缓存或退出登录；服务端数据的删除、更正或账户注销，请通过{{support}}联系我们。注销账户适用于本平台所有产品；如果只想停止使用某个产品，卸载该产品或清除本地数据即可，不影响其他产品和账户内积分。',
      '保存期限：为实现上述目的所必需的最短时间；你注销账户或请求删除后，我们将在合理期限内删除或匿名化处理，法律法规另有规定的除外。',
    ],
  },
  {
    title: '6. 你的控制权',
    paragraphs: ['你可以随时：'],
    items: [
      '在设备系统设置中关闭本平台对麦克风等权限的访问；',
      '在浏览器中删除本机历史记录或清除本地数据；',
      '退出登录，停止练习历史的同步；',
      '通过{{support}}联系我们，行使查阅、更正、删除相关信息的权利。',
    ],
    subs: [
      { title: '说明', paragraphs: ['由于本平台采用统一账户，你的账户注销操作将适用于本平台所有产品。如果你只想停止使用某个特定产品，只需卸载该产品或清除本地数据即可，不影响你使用其他产品及账户内通用积分。'] },
    ],
  },
  {
    title: '7. 未成年人保护',
    paragraphs: ['若你为不满十四周岁的未成年人，请在监护人陪同下阅读本政策，并在使用涉及麦克风或在线处理的功能前取得监护人同意。'],
  },
  {
    title: '8. 政策更新',
    paragraphs: ['本政策发生重大变更（如权限处理方式、数据是否上传的性质发生变化）时，我们会以弹窗或显著通知方式告知你，并在需要时重新取得你的同意。'],
  },
]

const AGREEMENT: Block[] = [
  {
    title: '1. 协议范围与统一账户',
    paragraphs: [
      '本协议是你与本平台运营方之间关于使用本平台产品与服务的约定。本平台采用统一账户体系，一个 Suxin 统一账号即可登录并使用由同一运营方提供的所有现有及未来新增产品。各产品可能另有特定功能说明或补充规则；补充规则与该产品特定功能相关，与本协议不一致的，以补充规则为准。',
    ],
  },
  {
    title: '2. 服务性质',
    paragraphs: [
      '本平台提供的是工具性与技术性服务。你使用本平台生成、处理或存储的内容，由你自行负责其合法性、准确性与完整性。本平台不声称对你的输出内容享有著作权，也不对你的使用后果作出超出法律强制性规定的保证。',
    ],
  },
  {
    title: '3. 积分与虚拟资产',
    paragraphs: ['本平台提供统一的积分、点数或其他虚拟凭证（以下统称“积分”），用于兑换或使用平台内的特定内容与功能。'],
    items: [
      '通用性：积分在你的统一账户下统筹管理，在所有接入统一账户体系的产品中通用。你在任一产品中获取或购买的积分，均可在其他产品中按规则消耗。',
      '不可转让：积分不是法定货币，不具有现金价值，不可转让给其他用户或第三方，不可兑换为人民币或其他财物，但本协议或单独公示的退款规则另有明确约定的除外。',
      '退款与结算：积分的退款申请基于你的统一账户发起，未消耗的付费积分按本协议第 4 条处理，退款金额按原支付路径退回；受原支付渠道限制的，按第 4 条处理。',
    ],
  },
  {
    id: 'refund',
    title: '4. 积分退款规则（核心附加条款）',
    paragraphs: ['本规则适用于用户通过人民币充值所获得的付费积分的退款申请与处理。因参与活动、赠送或其他非直接付费方式获得的积分，不适用本规则，但法律另有强制性规定的除外。'],
    subs: [
      {
        title: '（一）可退款情形',
        paragraphs: ['同时满足以下条件的，用户可以申请退还未使用的付费积分对应款项：'],
        items: [
          '拟退积分尚未被消耗，且不存在正在进行的计费扣减；',
          '原支付订单在审核时自支付成功之日起未超过 12 个月；超过 12 个月的订单仍可提交申请，但无法自动原路退回，按第（四）条第 2 项处理；',
          '用户账户内不存在其他处理中的退款申请。',
        ],
      },
      {
        title: '（二）不可退款情形',
        items: [
          '积分已被消耗。积分一经用于兑换、生成、下载或使用平台内容，即视为已交付并消费，对应金额不予退还。',
          '积分系通过赠送、活动奖励等非直接付费方式取得。',
        ],
      },
      {
        title: '（三）关于计费延迟与退款金额',
        items: [
          '平台计费存在一定延迟。你在提交退款申请时页面显示的“可退金额”，为系统基于截至该时点的计费数据作出的预估金额（系统界面上会做显著提示）。',
          '若在退款审核期间有新的计费记录产生，实际退款金额将以审核完成时的最终计费结果为准，并从预估金额中相应扣减。',
          '退款金额按未消耗付费积分对应的实际支付金额计算。人民币退款的最小单位为 0.01 元；可退金额不足 0.01 元的，不再单独发起退款。',
        ],
      },
      {
        title: '（四）退款渠道与超期订单处理',
        items: [
          '12 个月内的订单：审核通过后，款项将按原支付路径退回，一般在审核通过后的 5 个工作日内发起退回。具体到账时间取决于支付渠道的处理进度。',
          '超过 12 个月的支付宝订单：受支付宝渠道技术规则限制，支付成功超过 12 个月的订单，平台系统无法自动发起原路退回。针对此类订单，若你仍有退款需求，请通过{{support}}联系我们。平台核实你的积分未消耗且符合本规则其他条件后，将另行与你协商替代方案，平台不因渠道技术限制而免除退款义务。',
        ],
      },
      {
        title: '（五）退款流程限制',
        paragraphs: [
          '一个账号同一时间仅允许存在一笔处理中的退款申请。该笔申请处理完毕后，方可提交新的申请。该限制用于避免计费延迟场景下的并发退款造成超额退款或数据冲突。',
          '退款申请提交后超过 14 天仍未完成审核的，该申请将自动失效，你可以重新提交；失效前已处理的订单不会重复处理。',
        ],
      },
      {
        title: '（六）因平台原因导致的退款',
        paragraphs: ['因平台自身原因（包括但不限于服务终止、内容下架、系统故障导致付费积分无法按约定使用）致使你无法继续使用付费积分的，不受“未消耗”条件的限制：平台应就未实际使用的对应积分，按照你充值时的人民币对价比例退还相应款项，不得以“积分已发放”或“虚拟商品不退款”为由拒绝。'],
      },
      {
        title: '（七）提示与确认',
        paragraphs: ['本规则中涉及退款限制的条款（尤其是第（一）、（二）、（三）、（四）、（五）项），平台已在退款申请页面以勾选确认等显著方式提请用户注意。未履行显著提示义务的，不得以该条款对抗用户的退款请求。'],
      },
    ],
  },
  {
    title: '5. 使用规范与账户安全',
    paragraphs: [
      '你应妥善保管你的统一账户密码。你利用统一账户在平台任一产品中从事违反法律法规或本协议的活动（如黑产、违法内容生成），本平台有权视情节严重程度，对该统一账户采取限制功能、冻结积分或暂停、终止所有产品使用权限的措施。你对自己统一账户下的所有行为负责。',
    ],
  },
  {
    title: '6. 服务变更与终止',
    paragraphs: [
      '本平台可能因业务调整、技术升级或不可抗力，对具体产品进行更新、暂停或终止。涉及你已付费购买的积分或权益的，我们将依法并依据第 4 条退款规则处理，不因服务终止而单方免除对未消耗部分的责任。',
    ],
  },
  {
    title: '7. 责任限制',
    paragraphs: [
      '在法律允许的最大范围内，本平台不对因你自身设备故障、网络中断、第三方服务异常或你违反本协议使用服务所造成的间接损失承担责任。本条不排除本平台因故意或重大过失依法应承担的责任，也不排除法律强制性规定不得限制的责任。',
    ],
  },
  {
    title: '8. 协议更新与通知',
    paragraphs: [
      '本协议更新时，我们会在平台内以显著方式提示。若更新涉及你的实质性权利（如积分规则、退款政策、责任限制），我们将在生效前合理期限内通知你。',
    ],
  },
  {
    title: '9. 联系方式',
    paragraphs: ['本协议相关事宜，可通过{{support}}与我们联系。'],
  },
]

export default function Legal() {
  return (
    <AuthShell
      wider
      title="服务协议与政策"
      description="Suxin 统一账号与 EchoMind 平台的隐私政策、用户协议和积分退款规则。"
    >
      <div className="grid gap-5 text-sm leading-relaxed text-muted">
        <p className="text-xs">更新日期：{UPDATED_AT} · 生效日期：{UPDATED_AT} · <SupportLink /></p>
        <nav className="flex flex-wrap gap-2 text-xs">
          <a href="#privacy" className="rounded-full border border-border px-3 py-1">隐私政策</a>
          <a href="#agreement" className="rounded-full border border-border px-3 py-1">用户协议</a>
          <a href="#refund" className="rounded-full border border-border px-3 py-1">积分退款规则</a>
        </nav>

        <section id="privacy" className="scroll-mt-6">
          <h2 className="text-lg font-bold" style={{ color: 'var(--foreground)' }}>第一部分 隐私政策</h2>
          <p className="mt-1 text-xs">适用主体：Suxin 统一账号与 EchoMind 平台（包括 EchoMind 及未来由同一运营方提供的其他产品）。</p>
        </section>
        <BlockList blocks={PRIVACY} />

        <section id="agreement" className="scroll-mt-6 mt-2">
          <h2 className="text-lg font-bold" style={{ color: 'var(--foreground)' }}>第二部分 用户协议</h2>
          <p className="mt-1 text-xs">适用主体：Suxin 统一账号与 EchoMind 平台。</p>
        </section>
        <BlockList blocks={AGREEMENT} />

        <p className="text-center text-xs">如对本协议或政策有疑问，请通过<SupportLink />联系我们。</p>
        <p className="text-center"><TextLink href="/refunds">返回退款申请</TextLink></p>
      </div>
    </AuthShell>
  )
}
