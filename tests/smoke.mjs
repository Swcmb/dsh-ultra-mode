import assert from 'node:assert/strict'
import { apply, inject, name, isTargetModel, shouldInject, TARGET_MODEL, ULTRA_MODE_PROMPT } from '../index.js'

// ── metadata ──────────────────────────────────────────────────────────────
assert.equal(name, 'dsh-ultra-mode')
assert.deepEqual(inject, ['systemPrompt'])
assert.equal(TARGET_MODEL, 'deepseek-v4-1-flash-261017')

// ── helpers to build request contexts / configs ──────────────────────────
const ctxFor = (provider, model) => ({ agent: { options: { provider, model } } })
const cfg = (overrides = {}) => ({ manualEnable: false, aliases: [], ...overrides })
const volatile = (value) => ({ get: () => value })

// ── isTargetModel: canonical + explicit aliases only ─────────────────────
assert.equal(isTargetModel({ provider: 'opencode2api', model: TARGET_MODEL }, []), true,
  'canonical model id matches under any provider')
assert.equal(isTargetModel({ provider: 'any-provider', model: TARGET_MODEL }, []), true,
  'canonical model id is provider-independent')

assert.equal(isTargetModel({ provider: 'opencode2api', model: 'alias-free' }, ['alias-free']), true,
  'bare alias matches under any provider')
assert.equal(isTargetModel({ provider: 'opencode2api', model: 'alias-free' }, ['opencode2api/alias-free']), true,
  'provider/model alias matches exact route')
assert.equal(isTargetModel({ provider: 'other-provider', model: 'alias-free' }, ['opencode2api/alias-free']), false,
  'provider/model alias does not match a different provider')
assert.equal(isTargetModel({ provider: 'opencode2api', model: 'alias-free' }, ['other/alias-free']), false,
  'provider/model alias does not match a different route')

assert.equal(isTargetModel({ provider: 'opencode2api', model: 'hy4-flash-free' }, []), false,
  'hy4-flash-free is NOT auto-recognized with an empty alias list')
assert.equal(isTargetModel({ provider: 'opencode2api', model: 'deepseek-v4.1-flash-free' }, []), false,
  'similar name is NOT auto-recognized (no similarity inference)')

assert.equal(isTargetModel(null, []), false, 'null selection fails closed')
assert.equal(isTargetModel({ provider: 'p' }, ['x']), false, 'selection missing model fails closed')
assert.equal(isTargetModel({ model: 'x' }, null), false, 'non-array aliases fail closed')
assert.equal(isTargetModel({ provider: 'p', model: 'x' }, ['', null, 42]), false,
  'malformed alias entries are ignored')

// ── shouldInject: gating + manual override ───────────────────────────────
assert.equal(shouldInject(ctxFor('opencode2api', TARGET_MODEL), cfg()), true,
  'canonical model injects by default')
assert.equal(shouldInject(ctxFor('opencode2api', 'alias-free'), cfg({ aliases: ['opencode2api/alias-free'] })), true,
  'configured alias injects')
assert.equal(shouldInject(ctxFor('opencode2api', 'hy4-flash-free'), cfg()), false,
  'unknown model does not inject')
assert.equal(shouldInject(ctxFor('opencode2api', 'deepseek-v4.1-flash-free'), cfg()), false,
  'similar-name model does not inject')
assert.equal(shouldInject({}, cfg()), false, 'context without agent fails closed')
assert.equal(shouldInject({ agent: {} }, cfg()), false, 'options missing fails closed')
assert.equal(shouldInject({ agent: { options: { provider: '', model: TARGET_MODEL } } }, cfg()), false,
  'empty provider fails closed')
assert.equal(shouldInject({ agent: { options: { provider: 'p', model: '' } } }, cfg()), false,
  'empty model fails closed')
assert.equal(shouldInject(ctxFor('opencode2api', 'hy4-flash-free'), {}), false,
  'missing config fields fail closed')
assert.equal(shouldInject(ctxFor('opencode2api', TARGET_MODEL), { aliases: 'not-an-array' }), true,
  'canonical still matches even if aliases malformed')

// manual override -> highest priority, including non-target and missing fields
assert.equal(shouldInject(ctxFor('opencode2api', 'hy4-flash-free'), cfg({ manualEnable: true })), true,
  'manual switch enables a non-target model')
assert.equal(shouldInject({}, cfg({ manualEnable: true })), true,
  'manual switch works even when model fields are missing')
assert.equal(shouldInject(ctxFor('opencode2api', TARGET_MODEL), cfg({ manualEnable: false })), true,
  'switch off still allows the canonical model')
assert.equal(shouldInject(ctxFor('opencode2api', 'hy4-flash-free'), cfg({ manualEnable: 'true' })), false,
  'string "true" does not enable')
assert.equal(shouldInject(ctxFor('opencode2api', 'hy4-flash-free'), cfg({ manualEnable: 1 })), false,
  'number 1 does not enable')

// volatile config values (live references from DSH) are unwrapped
assert.equal(shouldInject(ctxFor('opencode2api', 'hy4-flash-free'), { manualEnable: volatile(true), aliases: volatile([]) }), true,
  'volatile manualEnable reference is unwrapped')
assert.equal(shouldInject(ctxFor('opencode2api', 'alias-free'), { manualEnable: volatile(false), aliases: volatile(['alias-free']) }), true,
  'volatile aliases reference is unwrapped')

// ── apply: registration + dynamic text + lifecycle ───────────────────────
let registered
let disposed = false
const ctx = {
  systemPrompt: {
    section(section) {
      registered = section
      return () => {
        registered = undefined
        disposed = true
      }
    },
  },
  effect(register) {
    this.dispose = register()
    return this.dispose
  },
}

const runtimeConfig = { manualEnable: false, aliases: ['opencode2api/alias-free'] }
apply(ctx, runtimeConfig)
assert.equal(registered.name, 'extension:dsh-ultra-mode')
assert.equal(registered.order, 10300)
assert.equal(typeof registered.text, 'function', 'text is a per-assembly callback')
assert.match(ULTRA_MODE_PROMPT, /help the user clarify any material ambiguity that remains/)
assert.match(ULTRA_MODE_PROMPT, /never invent tool-call quotas/)

assert.equal(registered.text(ctxFor('opencode2api', TARGET_MODEL)), ULTRA_MODE_PROMPT,
  'text returns prompt for canonical model')
assert.equal(registered.text(ctxFor('opencode2api', 'alias-free')), ULTRA_MODE_PROMPT,
  'text returns prompt for configured alias')
assert.equal(registered.text(ctxFor('opencode2api', 'hy4-flash-free')), '',
  'text returns empty string for unknown model (section dropped)')

// closing the manual switch takes effect immediately on the next assembly
runtimeConfig.manualEnable = true
assert.equal(registered.text(ctxFor('opencode2api', 'hy4-flash-free')), ULTRA_MODE_PROMPT,
  'text returns prompt after manual switch is turned on')
runtimeConfig.manualEnable = false
assert.equal(registered.text(ctxFor('opencode2api', 'hy4-flash-free')), '',
  'text returns empty again immediately after manual switch is turned off')

// volatile reference toggled at runtime
const live = { manualEnable: volatile(false), aliases: volatile([]) }
apply(ctx, live)
let flag = false
live.manualEnable = { get: () => flag }
assert.equal(registered.text(ctxFor('opencode2api', 'hy4-flash-free')), '', 'volatile off -> empty')
flag = true
assert.equal(registered.text(ctxFor('opencode2api', 'hy4-flash-free')), ULTRA_MODE_PROMPT, 'volatile on -> prompt')

ctx.dispose()
assert.equal(registered, undefined)
assert.equal(disposed, true)

console.log('DSH Ultra Mode smoke test passed')
