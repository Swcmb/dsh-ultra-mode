// DeepSeek Harness Apex Mode — host half
//
// Apex is a virtual reasoning tier, not a new official reasoning effort. The
// client half appends an "Apex" option to the model selector; when the user
// picks it, the client sends the model's highest OFFICIAL effort upstream and
// marks the session Apex-active through the local state route below. This host
// half injects the Apex prompt only for sessions that are Apex-active AND whose
// request resolves to the canonical target model (or a declared alias).
//
// No settings page, no manual toggle, no reasoningEffort spoofing.

const TARGET_MODEL = 'deepseek-v4-1-flash-261017'
const APEX_ID = 'apex'
const STATE_ROUTE = '/dsh-apex/state'
const STATE_MARKER = 'x-dsh-apex'
const DOMAIN_SPEC = { id: 'dsh-apex-state', version: 1 }
const DOMAIN_TABLE = 'sessions'
const STATE_SCHEMA = { parse: (value) => value && typeof value === 'object' ? value : {} }

const APEX_PROMPT = `## DeepSeek Harness Apex Mode

You are operating in Apex mode — the highest execution tier — for a high-budget agent execution and evaluation session (高预算 Agent 执行与评估).

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

export const name = 'dsh-ultra-mode'
export const inject = ['webServer', 'systemPrompt']

function unwrap(value) {
  while (value && typeof value.get === 'function') value = value.get()
  return value
}

function configValue(config, key, fallback) {
  let value
  try { value = unwrap(config?.[key]) } catch { return fallback }
  return value === undefined || value === null ? fallback : value
}

function sessionIdOf(context) {
  const session = context?.agent?.session ?? context?.session
  const id = session?.id
  return typeof id === 'string' && id.length > 0 ? id : null
}

// Read the model actually selected for this assembly. modelSelection is the
// per-step authoritative value in the running host; agent.options is a fallback.
export function selectionOf(context) {
  const sel = context?.modelSelection
  const options = context?.agent?.options
  const source = sel && typeof sel.provider === 'string' && typeof sel.model === 'string'
    ? sel
    : options
  const provider = source?.provider
  const model = source?.model
  if (typeof provider !== 'string' || provider.length === 0) return null
  if (typeof model !== 'string' || model.length === 0) return null
  return { provider, model }
}

// Explicit mapping only: canonical id under any provider, or a declared alias
// as `model` (any provider) / `provider/model` (exact route). No name similarity.
export function isTargetModel(selection, aliases) {
  if (!selection || typeof selection.model !== 'string') return false
  if (selection.model === TARGET_MODEL) return true
  if (!Array.isArray(aliases)) return false
  for (const entry of aliases) {
    if (typeof entry !== 'string' || entry.length === 0) continue
    if (entry.includes('/')) {
      if (selection.provider && entry === `${selection.provider}/${selection.model}`) return true
    } else if (entry === selection.model) {
      return true
    }
  }
  return false
}

// The gate is the conjunction of two independent facts: the session was marked
// Apex by the client, and the request is for the target model. Missing either
// one fails closed.
export function shouldInject(context, config, activeSessions) {
  const sessionId = sessionIdOf(context)
  if (sessionId === null) return false
  if (!activeSessions || !activeSessions.has(sessionId)) return false
  const selection = selectionOf(context)
  if (!selection) return false
  return isTargetModel(selection, configValue(config, 'aliases', []))
}

function writeJson(res, status, payload) {
  try {
    res.statusCode = status
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(payload))
  } catch { /* response already gone */ }
}

function isTrustedMutation(req) {
  try {
    const headers = req && req.headers ? req.headers : {}
    if (headers[STATE_MARKER] !== '1') return false
    const site = headers['sec-fetch-site']
    if (typeof site === 'string' && site === 'cross-site') return false
    return true
  } catch { return false }
}

export function apply(ctx, config = {}) {
  const activeSessions = new Set()
  let durable = null
  let scopeOfStorage = ctx

  const persist = (sessionId, active) => {
    if (!durable) return
    try {
      if (active) durable.put(sessionId, { active: true, updatedAt: Date.now() })
      else durable.remove(sessionId)
    } catch { /* memory mirror stays authoritative for this process */ }
  }

  const attachStorage = (facility) => {
    if (!facility || typeof facility.open !== 'function') return
    facility.open(DOMAIN_SPEC).then((domain) => {
      const table = domain.table(DOMAIN_TABLE)
      for (const [key, value] of table.entries()) {
        if (value && value.active === true) activeSessions.add(key)
      }
      durable = {
        put: (key, value) => table.put(key, value),
        remove: (key) => table.delete(key),
      }
      scopeOfStorage.effect(() => () => { try { void domain.close() } catch { /* noop */ } durable = null })
    }).catch(() => { /* memory-only mode */ })
  }

  if (typeof ctx.inject === 'function') {
    ctx.inject(['storageDomain'], (scope) => {
      if (scope) scopeOfStorage = scope
      attachStorage(scope.storageDomain)
    })
  } else {
    attachStorage(ctx.get('storageDomain'))
  }

  const disposers = []
  disposers.push(ctx.effect(() => {
    const handler = async (req, res) => {
      if (req.method === 'GET') {
        writeJson(res, 200, { ok: true, active: [...activeSessions] })
        return
      }
      if (req.method !== 'POST') {
        writeJson(res, 405, { ok: false, error: 'method not allowed' })
        return
      }
      if (!isTrustedMutation(req)) {
        writeJson(res, 403, { ok: false, error: 'untrusted mutation request' })
        return
      }
      let body = ''
      try { for await (const chunk of req) body += chunk }
      catch { writeJson(res, 400, { ok: false, error: 'unreadable body' }); return }
      let parsed
      try { parsed = JSON.parse(body || '{}') }
      catch { writeJson(res, 400, { ok: false, error: 'invalid json' }); return }
      const sessionId = typeof parsed.sessionId === 'string' ? parsed.sessionId : ''
      if (!sessionId) { writeJson(res, 400, { ok: false, error: 'sessionId required' }); return }
      if (parsed.active === true) activeSessions.add(sessionId)
      else activeSessions.delete(sessionId)
      persist(sessionId, parsed.active === true)
      writeJson(res, 200, { ok: true, active: [...activeSessions] })
    }
    try { disposers.push(ctx.webServer.register({ kind: 'exact', path: STATE_ROUTE, handler })) }
    catch { /* no state channel: prompt injection stays fail-closed */ }
  }))

  disposers.push(ctx.effect(() => ctx.systemPrompt.section({
    name: 'extension:dsh-apex-mode',
    order: 10300,
    text: (context) => shouldInject(context, config, activeSessions) ? APEX_PROMPT : '',
  })))

  return () => { for (const dispose of disposers) { try { dispose?.() } catch { /* noop */ } } }
}

export { TARGET_MODEL, APEX_ID, STATE_ROUTE, APEX_PROMPT }
