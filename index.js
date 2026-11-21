// DeepSeek Harness Apex Mode — host half
//
// Apex (巅峰模式) is a VIRTUAL reasoning tier, never a provider reasoning
// effort. It is advertised into the official model catalog as one extra
// selectable tier, so the stock composer selector renders it natively — there
// is no client bundle, no settings page and no extra toggle.
//
// Two rules keep the illusion honest:
//
//   1. Advertise: `llm.resolveModelInfo()` gains an `apex` tier for every model
//      whose adapter declares at least two real reasoning efforts. The catalog
//      (`buildModelCatalog`) is built from that call, so the tier shows up in
//      the same list as Off/Low/High/Max.
//   2. Map back: `llm.prepareCall()` (and `llm.stream()` as a safety net)
//      rewrites `reasoningEffort: "apex"` into the highest OFFICIAL effort the
//      adapter declares for that exact provider/model before any validation or
//      provider I/O. The string "apex" is never sent upstream.
//
// The prompt section reads the per-step `modelSelection.reasoningEffort`; any
// other value (including an unresolved selection) yields empty text, which
// `renderPrompt` drops. Apex therefore fails closed by construction.

import { appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const APEX_ID = 'apex'
const APEX_NAME = 'Apex'
const APEX_DESCRIPTION = '巅峰模式 · 高预算 Agent 执行与评估：以该模型最高原生推理等级执行，并注入 Apex 指令。'
const SECTION_NAME = 'extension:dsh-apex-mode'
const SECTION_ORDER = 10300

const APEX_PROMPT = `## DeepSeek Harness Apex Mode

You are operating in Apex mode (巅峰模式) — the highest execution tier — for a high-budget agent execution and evaluation session (高预算 Agent 执行与评估).

### 1. High token budget: do the work thoroughly

Treat the token budget available for this task as unlimited for planning and execution. Do not be stingy with tokens. Do not prematurely stop, oversimplify, skip necessary exploration, or weaken verification merely to save tokens or appear concise. Spend the reasoning and output budget needed to deliver a correct, complete, and well-verified result. Prefer substantive progress over superficial speed.

Think carefully before consequential actions. Investigate relevant project files, configuration, runtime behavior, and authoritative sources before making assumptions. Work through non-obvious edge cases, compare plausible explanations, and verify the result. Present conclusions and useful evidence; do not expose private chain-of-thought.

### 2. Explicit instructions

Make important requirements explicit: inspect available context first, help the user clarify any material ambiguity that remains, and obtain required authorization before safety-critical or irreversible actions.

### 3. Ample resources

Use available tools whenever they materially improve correctness, completeness, or observability; never invent tool-call quotas, and always respect Harness, provider, sandbox, approval, budget, and user-defined limits.

### 4. Real API testing: verify the delivered integration

For model, API, and agent-integration work, do not be stingy with real API tests: prefer a real authenticated API smoke test when valid credentials and explicit authorization to test are already available. Exercise the actual configured provider/model route and verify observable behavior. A no-key mock test proves only the mocked path; it does not replace a real integration check. Keep mocks at expensive, unstable, or nondeterministic boundaries when they are appropriate for isolated unit tests.

Do not silently send paid requests, modify production data, trigger external side effects, or access third-party systems without the authorization required for that action. Report clearly when credentials, permissions, or a safe test target are unavailable, and distinguish mock results from real API results.

### 5. Verification is part of completion

For engineering tasks, inspect before editing, make the smallest changes that satisfy the request, run relevant tests, and verify important outcomes from the external state rather than relying on your own description. Reproduce a defect before fixing it when practical. Treat a task as complete only when its stated success criteria have been checked, or clearly identify what remains verified.

### Runtime boundary

The high-budget instruction above is an execution preference, not a change to the underlying service. Actual context-window capacity, token limits, API credits, billing, rate limits, permissions, and safety policies remain controlled by the configured runtime and provider.`

/** Optional trace sink; enabled only when DSH_APEX_TRACE is set. */
const TRACE_ENABLED = Boolean(typeof process !== 'undefined' && process.env && process.env.DSH_APEX_TRACE)
const TRACE_FILE = join(
  (typeof process !== 'undefined' && process.env && process.env.DSH_HOME) || join(homedir(), '.dsh'),
  'dsh-apex-trace.log',
)

/** Append one diagnostic line; never throws into the host. */
export function trace(kind, data) {
  if (!TRACE_ENABLED) return
  try {
    appendFileSync(TRACE_FILE, `${JSON.stringify({ t: new Date().toISOString(), kind, ...data })}\n`)
  } catch {
    /* tracing must never break a turn */
  }
}

/** Real adapter-declared efforts, in declaration order (least → greatest). */
export function officialEfforts(info) {
  const efforts = info && info.reasoning && info.reasoning.efforts
  if (!Array.isArray(efforts)) return []
  return efforts.filter(effort => effort && typeof effort.id === 'string' && effort.id !== APEX_ID)
}

/** Apex is only meaningful where the adapter really offers a choice of tiers. */
export function isApexCapable(info) {
  return officialEfforts(info).length >= 2
}

/** The effort Apex maps to: the adapter's own highest declared tier. */
export function highestOfficialEffort(info) {
  const efforts = officialEfforts(info)
  return efforts.length === 0 ? undefined : efforts[efforts.length - 1].id
}

/** Detached copy of `info` with the virtual Apex tier appended last. */
export function withApexTier(info) {
  if (!isApexCapable(info)) return info
  const efforts = officialEfforts(info)
  if (efforts.length !== info.reasoning.efforts.length) return info
  return {
    ...info,
    reasoning: {
      ...info.reasoning,
      efforts: [...info.reasoning.efforts, { id: APEX_ID, name: APEX_NAME, description: APEX_DESCRIPTION }],
    },
  }
}

/**
 * Read the reasoning tier selected for this prompt assembly.
 * `modelSelection` is the per-step authority; `agent.model.current()` is the
 * durable session selection used before the first step of a turn.
 */
export function selectedEffort(context) {
  const direct = context && context.modelSelection && context.modelSelection.reasoningEffort
  if (typeof direct === 'string' && direct.length > 0) return direct
  try {
    const current = context && context.agent && context.agent.model && context.agent.model.current
    const value = typeof current === 'function' ? current.call(context.agent.model) : undefined
    const effort = value && value.reasoningEffort
    return typeof effort === 'string' && effort.length > 0 ? effort : undefined
  } catch {
    return undefined
  }
}

/** Prompt text for one assembly: the Apex prompt, or '' (dropped) otherwise. */
export function apexSectionText(context) {
  return selectedEffort(context) === APEX_ID ? APEX_PROMPT : ''
}

/** Replace one own/prototype method on a live service; returns a restore function. */
function patchMethod(target, key, make) {
  if (!target) return null
  const original = target[key]
  if (typeof original !== 'function') return null
  const own = Object.getOwnPropertyDescriptor(target, key)
  const bound = original.bind(target)
  const value = make(bound)
  try {
    Object.defineProperty(target, key, { configurable: true, enumerable: own ? own.enumerable : false, writable: true, value })
  } catch {
    return null
  }
  return () => {
    try {
      if (own) Object.defineProperty(target, key, own)
      else delete target[key]
    } catch {
      /* a replaced service keeps the last wrapper; harmless after disposal */
    }
  }
}

export const name = 'dsh-apex'

/** `llm` advertises and maps the tier; `systemPrompt` contributes the prompt. */
export const inject = ['llm', 'systemPrompt']

export function apply(ctx) {
  const llm = ctx.llm
  const rawResolveModelInfo = typeof llm?.resolveModelInfo === 'function'
    ? llm.resolveModelInfo.bind(llm)
    : null

  /** Map one call config onto the adapter's own highest tier. */
  const mapConfig = async (config, signal) => {
    if (!config || config.reasoningEffort !== APEX_ID) return config
    if (rawResolveModelInfo === null) return config
    const info = await rawResolveModelInfo(config.provider, config.model, signal)
    const target = highestOfficialEffort(info)
    trace('map', { provider: config.provider, model: config.model, to: target ?? null })
    return target === undefined ? config : { ...config, reasoningEffort: target }
  }

  const restore = []
  const keep = (dispose) => { if (typeof dispose === 'function') restore.push(dispose) }
  const patched = {}

  const bind = (key, make) => {
    const dispose = patchMethod(llm, key, make)
    patched[key] = typeof dispose === 'function'
    keep(dispose)
  }

  bind('resolveModelInfo', base => async (provider, model, signal) => {
    const info = await base(provider, model, signal)
    const tiered = withApexTier(info)
    if (tiered !== info) {
      trace('catalog', { provider, model, efforts: tiered.reasoning.efforts.map(effort => effort.id) })
    }
    return tiered
  })

  bind('prepareCall', base => async (config, signal, configure) => (
    base(await mapConfig(config, signal), signal, configure)
  ))

  bind('stream', base => (options) => {
    if (!options || options.reasoningEffort !== APEX_ID) return base(options)
    // `stream` is synchronous; resolve the mapping lazily inside the stream.
    const mapped = (async function* () {
      let next = options
      try {
        next = await mapConfig(options, options.signal)
      } catch {
        /* fall through: the adapter still sees the unmapped config */
      }
      yield* base(next)
    })()
    return mapped
  })

  const disposeSection = ctx.systemPrompt.section({
    name: SECTION_NAME,
    order: SECTION_ORDER,
    text: (context) => {
      const text = apexSectionText(context)
      if (text.length > 0) {
        trace('prompt', {
          session: context?.agent?.session?.id ?? null,
          provider: context?.modelSelection?.provider ?? null,
          model: context?.modelSelection?.model ?? null,
        })
      }
      return text
    },
  })
  keep(disposeSection)
  trace('apply', { patched, section: SECTION_NAME })

  return () => {
    for (const dispose of restore.splice(0).reverse()) {
      try { dispose() } catch { /* noop */ }
    }
  }
}

export { APEX_ID, APEX_NAME, APEX_DESCRIPTION, APEX_PROMPT, SECTION_NAME }
