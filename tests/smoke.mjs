import assert from 'node:assert/strict'
import { apply, inject, name, isTargetModel, shouldInject, selectionOf, TARGET_MODEL, APEX_ID, STATE_ROUTE, APEX_PROMPT } from '../index.js'

// ── metadata ──────────────────────────────────────────────────────────────
assert.equal(name, 'dsh-ultra-mode')
assert.deepEqual(inject, ['webServer', 'systemPrompt'])
assert.equal(TARGET_MODEL, 'deepseek-v4-1-flash-261017')
assert.equal(APEX_ID, 'apex')
assert.equal(STATE_ROUTE, '/dsh-apex/state')
assert.match(APEX_PROMPT, /DeepSeek Harness Apex Mode/)
assert.match(APEX_PROMPT, /Apex mode .* high-budget agent execution and evaluation session/)

const cfg = (overrides = {}) => ({ aliases: [], ...overrides })
const ctxFor = (sessionId, provider, model) => ({
  agent: { session: { id: sessionId }, options: { provider, model } },
})
const active = (...ids) => new Set(ids)

// ── selectionOf ───────────────────────────────────────────────────────────
assert.deepEqual(selectionOf(ctxFor('s1', 'p', 'm')), { provider: 'p', model: 'm' })
assert.deepEqual(selectionOf({ modelSelection: { provider: 'p2', model: 'm2' }, agent: { options: { provider: 'p', model: 'm' } } }), { provider: 'p2', model: 'm2' })
assert.equal(selectionOf({ modelSelection: { provider: '', model: 'm' } }), null)
assert.equal(selectionOf({}), null)

// ── isTargetModel ─────────────────────────────────────────────────────────
assert.equal(isTargetModel({ provider: 'p', model: TARGET_MODEL }, []), true)
assert.equal(isTargetModel({ provider: 'any', model: TARGET_MODEL }, []), true)
assert.equal(isTargetModel({ provider: 'p', model: 'alias-x' }, ['alias-x']), true)
assert.equal(isTargetModel({ provider: 'p', model: 'alias-x' }, ['p/alias-x']), true)
assert.equal(isTargetModel({ provider: 'q', model: 'alias-x' }, ['p/alias-x']), false)
assert.equal(isTargetModel({ provider: 'p', model: 'hy4-flash-free' }, []), false)
assert.equal(isTargetModel({ provider: 'p', model: 'deepseek-v4.1-flash-free' }, []), false)
assert.equal(isTargetModel(null, []), false)
assert.equal(isTargetModel({ provider: 'p' }, ['x']), false)
assert.equal(isTargetModel({ provider: 'p', model: 'x' }, ['', null, 42]), false)

// ── shouldInject: session marked Apex AND target model ────────────────────
assert.equal(shouldInject(ctxFor('s1', 'p', TARGET_MODEL), cfg(), active('s1')), true)
assert.equal(shouldInject(ctxFor('s1', 'p', 'hy4-flash-free'), cfg(), active('s1')), false)
assert.equal(shouldInject(ctxFor('s1', 'p', TARGET_MODEL), cfg(), active('s2')), false)
assert.equal(shouldInject(ctxFor('s1', 'p', TARGET_MODEL), cfg(), new Set()), false)
assert.equal(shouldInject(ctxFor('s1', 'p', TARGET_MODEL), cfg(), null), false)
assert.equal(shouldInject(ctxFor('s1', 'p', 'alias-x'), cfg({ aliases: ['alias-x'] }), active('s1')), true)
assert.equal(shouldInject({}, cfg(), active('s1')), false, 'no session -> no inject')
assert.equal(shouldInject({ agent: { session: { id: 's1' } } }, cfg(), active('s1')), false, 'no model -> no inject')
assert.equal(shouldInject(ctxFor('s1', 'p', TARGET_MODEL), { aliases: 'bad' }, active('s1')), true)
assert.equal(shouldInject(ctxFor('s1', 'p', 'x'), { aliases: { get: () => ['x'] } }, active('s1')), true, 'volatile aliases unwrapped')

// ── apply: registration, dynamic text, state route, lifecycle ────────────
let section
let routeHandler
let disposedSection = false
let disposedRoute = false
const routes = []
const ctx = {
  webServer: {
    register(route) {
      routes.push(route)
      if (route.path === STATE_ROUTE) routeHandler = route.handler
      return () => { disposedRoute = true }
    },
  },
  systemPrompt: {
    section(s) { section = s; return () => { section = undefined; disposedSection = true } },
  },
  effect(register) { const d = register(); this.disposers = (this.disposers || []).concat([d]); return d },
  inject(service, cb) { if (typeof cb === 'function') cb({}); return () => {} },
}
const dispose = apply(ctx, cfg())
assert.equal(section.name, 'extension:dsh-apex-mode')
assert.equal(section.order, 10300)
assert.equal(typeof section.text, 'function')
assert.ok(routes.some((r) => r.path === STATE_ROUTE), 'state route registered')
assert.equal(typeof routeHandler, 'function')

assert.equal(section.text(ctxFor('s1', 'p', TARGET_MODEL)), '', 'no apex session -> empty')
const jsonResponse = () => ({ statusCode: 200, setHeader() {}, end(body) { this.body = body } })
const request = (sessionId, activeFlag, marker) => ({
  method: 'POST',
  headers: marker === false ? {} : { 'x-dsh-apex': '1' },
  async *[Symbol.asyncIterator]() { yield JSON.stringify({ sessionId, active: activeFlag }) },
})
const res1 = jsonResponse()
await routeHandler(request('s1', true), res1)
assert.equal(res1.statusCode, 200)
assert.equal(section.text(ctxFor('s1', 'p', TARGET_MODEL)), APEX_PROMPT, 'apex + target -> prompt')
assert.equal(section.text(ctxFor('s1', 'p', 'hy4-flash-free')), '', 'apex + non-target -> empty')
const res2 = jsonResponse()
await routeHandler(request('s1', false), res2)
assert.equal(section.text(ctxFor('s1', 'p', TARGET_MODEL)), '', 'deactivated -> empty')

const bad = jsonResponse()
await routeHandler(request('s1', true, false), bad)
assert.equal(bad.statusCode, 403, 'missing marker -> 403')
const get = jsonResponse()
await routeHandler({ method: 'GET', headers: {} }, get)
assert.equal(get.statusCode, 200)

dispose()
assert.equal(section, undefined)
assert.equal(disposedSection, true)
assert.equal(disposedRoute, true)

console.log('DSH Apex Mode smoke test passed')
