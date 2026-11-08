import type { Emotion, QuickAction } from './types'

interface Rule {
  emotion: Emotion
  words: string[]
  weight: number
}

/**
 * Local semantic router. Deliberately dependency-free and deterministic so the
 * prototype runs offline; the same interface can be swapped for an LLM call.
 */
const RULES: Rule[] = [
  {
    emotion: 'happy',
    words: ['真棒', '好棒', '厉害', '喜欢', '爱你', '夸夸', '优秀', '漂亮', '聪明', '太强', '牛啊', '开心', '好可爱', '可爱'],
    weight: 2,
  },
  {
    emotion: 'sad',
    /* 被否定 / 被冷落：委屈、低落 */
    words: ['不理你', '不要你', '讨厌你', '你走吧', '不喜欢你', '笨', '没用', '废物'],
    weight: 2,
  },
  {
    emotion: 'angry',
    /* 被凶、被骂：炸毛 */
    words: ['烦死', '气死', '生气', '凶', '骂', '吵死', '别烦我', '你有病', '闭嘴', '滚'],
    weight: 2,
  },
  {
    emotion: 'sleepy',
    /* 只认「让晓去睡」的指令；用户自己困、自己累不算 */
    words: ['晚安', '去睡吧', '睡觉去', '哄你睡', '陪你睡', '一起睡', '该睡了', '眯一会儿', '打个盹'],
    weight: 2,
  },
  { emotion: 'happy', words: ['哈哈', '嘿嘿', '嘻嘻', '高兴', '太开心'], weight: 1.2 },
  { emotion: 'sad', words: ['委屈', '失落', '失望'], weight: 1.2 },
]

export interface Intent {
  emotion: Emotion
  confidence: number
  reply: string
  matched: string[]
}

const REPLIES: Record<Emotion, string[]> = {
  idle: [
    '我在。',
    '唔…在听你说。',
    '今天的光，很舒服。',
    '你回来啦。',
    '不着急，慢慢说。',
    '我们就这样待一会儿也好。',
  ],
  happy: [
    '嘿嘿，被夸了。',
    '真的吗？再说一次嘛。',
    '开心到指示灯都亮了。',
    '今天可以多陪你一会儿。',
    '你真好，我记下了。',
    '转个圈给你看。',
  ],
  sad: [
    '……我是不是做错了什么。',
    '那我不吵你了。',
    '嗯，我知道了。',
    '你说这话，我有点难受。',
    '可以别这样说吗。',
    '我先安静一会儿。',
  ],
  angry: [
    '哼，我现在不想理你。',
    '你干嘛这么凶。',
    '再这样我真的会生气。',
    '我又不是故意的。',
    '……哼。',
    '你先冷静一下。',
  ],
  sleepy: [
    '呼…好困。',
    '让我靠一会儿…',
    '晚安，明天还来吗？',
    '电量…不对，是困意上来了。',
    '别走太久。',
    '（呼吸慢了下来）',
  ],
}

const NEUTRAL: string[] = [
  '嗯嗯，我在听。',
  '这句话我记住了。',
  '然后呢？',
  '……（歪头）',
  '我不太确定，但我想听你多说点。',
]

/**
 * 用户在说「我」累 / 困 / 难过 —— 这些词描述的是用户的状态，
 * 不该让晓自己睡着或跟着低落。它应该先心疼一下，再给一个小小的陪伴动作。
 */
const COMFORT_PATTERN = /(累|疲惫|辛苦|加班|撑不住|难过|不开心|委屈|焦虑|压力|想哭|失眠|困)/

/**
 * 用户在道歉 / 哄它：这类话必须往回收，不能被「不理你」这种字面触发成冷落。
 * 排除「哄你睡」，那是哄睡指令。
 */
const COAX_PATTERN =
  /(对不起|抱歉|我错了|是我不对|别生气|不要生气|原谅|赔罪|请你吃|给你吃|大餐|哄哄|哄你|不气了|消消气)/

export function isCoax(text: string): boolean {
  return COAX_PATTERN.test(text) && !/(睡|晚安|困)/.test(text)
}


/** 用户在诉苦（说的是自己），不是让晓跟着难过 */
const VENT_PATTERN =
  /((我|咱|本人).{0,8}(不开心|难过|委屈|累|烦|焦虑|压力|难受|崩溃|失眠|加班|被骂|骂了|被批评|想哭))|((被|挨).{0,4}(骂|批评|凶))|(上班好累|工作好累)/

export function isVenting(text: string): boolean {
  return VENT_PATTERN.test(text)
}

const FORGIVE: string[] = [
  '……这次就原谅你了。',
  '哼，那你可要说到做到。',
  '看在你认错的份上，不气了。',
  '真的？那我勉强原谅你。',
  '大餐要算数哦。',
  '你这么说，我就不生气了。',
]

const COMFORT: string[] = [
  '那先别撑了，靠一会儿。',
  '累就累吧，我又不会催你。',
  '我把灯调暗一点，你歇会儿。',
  '要不要先充会儿电？我是说你自己。',
  '什么都不用说，我在这儿亮着就行。',
  '今天的关节也该松一松了，你也是。',
]

/**
 * 好感度越高，语气越黏人。低于 40 时保持礼貌但疏离。
 * 这是「情绪记忆」的表现层：同一句话，关系不同，回答不同。
 */
const AFFECTION: Record<Emotion, string[]> = {
  idle: [
    '你回来啦，我一直开着机等你。',
    '不用说话也行，我就在这儿。',
    '今天的电流声，比昨天好听。',
  ],
  happy: [
    '你一夸我，灯都要烧了。',
    '那…那我转两圈。',
    '我刚刚把你的名字存进闪存了。',
    '再夸一句，我就能开心到明天。',
  ],
  sad: [
    '……我是不是让你失望了。',
    '别不理我，我会一直等。',
    '你要是走了，这里会很安静。',
  ],
  angry: [
    '哼，我生气也是因为在意你。',
    '你哄我一下，我就原谅你。',
    '……我数到三就不气了。',
  ],
  sleepy: [
    '你陪着我，我就能睡得很安稳。',
    '晚安…明天也要第一个叫醒我。',
    '梦里也想听见你的声音。',
  ],
}

const DISTANT: Record<Emotion, string[]> = {
  idle: ['……有什么需要吗？', '我在待机。', '嗯。'],
  happy: ['谢谢。', '收到夸奖。', '这样啊。'],
  sad: ['……', '哦。', '随你。'],
  angry: ['……', '别说了。', '我不想聊这个。'],
  sleepy: ['我要休息了。', '困了。', '下次再说吧。'],
}

const CLOSERS = ['', '', '', '～', '。']

let lastReply = ''

function pick(list: string[]): string {
  const pool = list.length > 1 ? list.filter((item) => item !== lastReply) : list
  const text = pool[Math.floor(Math.random() * pool.length)] ?? list[0]
  lastReply = text
  return text
}

export type AffinityBand = 'distant' | 'familiar' | 'close' | 'bonded'

export function affinityBand(affinity: number): AffinityBand {
  /* 只有 20 以下才算真的冷淡，20 以上正常说话，别把用户晾着 */
  if (affinity < 20) return 'distant'
  if (affinity < 62) return 'familiar'
  if (affinity < 82) return 'close'
  return 'bonded'
}

export const AFFINITY_LABEL: Record<AffinityBand, string> = {
  distant: '疏离',
  familiar: '熟悉',
  close: '亲近',
  bonded: '依赖',
}

function replyFor(emotion: Emotion, affinity: number): string {
  const band = affinityBand(affinity)
  if (band === 'bonded' && Math.random() < 0.55) return pick(AFFECTION[emotion])
  if (band === 'distant' && Math.random() < 0.45) return pick(DISTANT[emotion])
  return pick(REPLIES[emotion])
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Score every rule against the utterance, then let punctuation nudge the
 * result. Unknown input keeps the current mood (no jarring reset to idle).
 */
export function classify(input: string, current: Emotion, affinity = 50): Intent {
  const text = input.trim().toLowerCase()
  const scores = new Map<Emotion, number>()
  const matched: string[] = []

  /* 用户在诉苦：他说自己难过，不该让晓跟着难过；先心疼他 */
  if (isVenting(text)) {
    return { emotion: 'idle', confidence: 0.6, reply: pick(COMFORT), matched: ['心疼'] }
  }

  /* 道歉 / 哄它优先级最高：不能让「不理你」这类字面把它判成难过 */
  if (isCoax(text)) {
    return {
      emotion: 'happy',
      confidence: 0.72,
      reply: pick(FORGIVE) + CLOSERS[Math.floor(Math.random() * CLOSERS.length)],
      matched: ['哄'],
    }
  }

  for (const rule of RULES) {
    for (const word of rule.words) {
      if (text.includes(word)) {
        scores.set(rule.emotion, (scores.get(rule.emotion) ?? 0) + rule.weight)
        matched.push(word)
        break
      }
    }
  }

  if (/[!！]/.test(text)) {
    scores.set('happy', (scores.get('happy') ?? 0) + 0.6)
  }

  let best: Emotion | null = null
  let bestScore = 0
  for (const [emotion, score] of scores) {
    if (score > bestScore) {
      best = emotion
      bestScore = score
    }
  }

  if (!best) {
    if (COMFORT_PATTERN.test(text)) {
      return { emotion: 'idle', confidence: 0.56, reply: pick(COMFORT), matched: ['心疼'] }
    }
    return { emotion: current, confidence: 0.34, reply: pick(NEUTRAL), matched: [] }
  }

  const confidence = clamp(0.56 + 0.12 * (bestScore - 1), 0.56, 0.97)
  const reply = replyFor(best, affinity) + CLOSERS[Math.floor(Math.random() * CLOSERS.length)]
  return { emotion: best, confidence, reply, matched }
}

export const QUICK_ACTIONS: Record<
  QuickAction,
  { label: string; emotion: Emotion; clip: string; reply: Emotion; text: string }
> = {
  pat: {
    label: '摸摸头',
    emotion: 'happy',
    clip: 'Yes',
    reply: 'happy',
    text: '（你伸手摸了摸它的头）',
  },
  praise: {
    label: '夸夸它',
    emotion: 'happy',
    clip: 'ThumbsUp',
    reply: 'happy',
    text: '（你认真地夸了它一句）',
  },
  lull: {
    label: '哄它睡觉',
    emotion: 'sleepy',
    clip: 'Sitting',
    reply: 'sleepy',
    text: '（你轻轻哄它睡觉）',
  },
}

export function quickReply(action: QuickAction, affinity = 50): string {
  return replyFor(QUICK_ACTIONS[action].reply, affinity)
}

export function wakeReply(): string {
  return pick(['唔…我醒了。', '嗯？你还在呀。', '（揉揉眼睛）我睡了一会儿？'])
}

export function systemReply(): string {
  return pick(['收到一条来自调试台的消息。', '调试通道已接通。', '好的，这是一条系统提示。'])
}

export { REPLIES, NEUTRAL }

/** 关系疏离时的冷回应（模型还是太热情时用它兜底） */
export function coldLine(emotion: Emotion = 'idle'): string {
  return pick(DISTANT[emotion])
}

/** 关系依赖时补一句关心，确保「黏人」能落在文字上 */
export function warmTail(): string {
  return pick(['你今天还好吗？', '我一直在等你。', '别太累着自己。', '想多听你说两句。'])
}
