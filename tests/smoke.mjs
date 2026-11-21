// Apex Mode host-half smoke tests.
//
// These tests drive the real exported `apply()` against a fake Cordis context
// that mimics the two host services the plugin touches: the LLM registry
// (whose `resolveModelInfo` feeds the browser model catalog) and the system
// prompt registry. Every assertion is about observable behaviour — what the
// catalog advertises and what would be sent upstream — never about internals.

import assert from 'node:assert/strict'
import {
  APEX_ID,
  APEX_PROMPT,
  SECTION_NAME,
  apply,
  apexSectionText,
  highestOfficialEffort,
  isApexCapable,
  name as pluginName,
  inject as pluginInject,
  selectedEffort,
  withApexTier,
} from '../index.js'

const DEEPSEEK = {
  provider: 'deepseek',
  id: 'deepseek-v4-1-flash-261017',
  name: 'DeepSeek V4.1 Flash',
  reasoning: {
    efforts: [
      { id: 'off', name: 'Off' },
      { id: 'low', name: 'Low' },
      { id: 'high', name: 'High' },
      { id: 'max', name: 'Max' },
    ],
    defaultEffort: 'high',
  },
}

const MULTI = {
  provider: 'acme',
  id: 'acme-thinker',
  name: 'Acme Thinker',
  reasoning: {
    efforts: [
      { id: 'low', name: 'Low' },
      { id: 'medium', name: 'Medium' },
      { id: 'high', name: 'High' },
      { id: 'xhigh', name: 'Extra High' },
    ],
  },
}

const PLAIN = { provider: 'acme', id: 'acme-plain', name: 'Acme Plain' }
const OFF_ONLY = { provider: 'acme', id: 'acme-off-only', name: 'Off only', reasoning: { efforts: [{ id: 'off', name: 'Off' }] } }
const MODELS = new Map([[DEEPSEEK.id, DEEPSEEK], [MULTI.id, MULTI], [PLAIN.id, PLAIN], [OFF_ONLY.id, OFF_ONLY]])

function fakeRuntime() {
  const calls = { prepare: [], stream: [], resolve: [] }
  const llm = {
    async resolveModelInfo(provider, model) {
      calls.resolve.push([provider, model])
      const found = MODELS.get(model)
      if (!found) throw new Error(`unknown model ${model}`)
      return structuredClone(found)
    },
    async prepareCall(config, signal, configure) {
      calls.prepare.push({ config, configure })
      return { config: { ...config }, stream: () => (async function* () {})() }
    },
    stream(options) {
      calls.stream.push(options)
      return (async function* () { yield { type: 'seen', options } })()
    },
  }
  const sections = []
  const ctx = {
    llm,
    systemPrompt: {
      section(section) {
        sections.push(section)
        return () => sections.splice(sections.indexOf(section), 1)
      },
    },
  }
  return { ctx, calls, sections, llm }
}

function testMetadata() {
  assert.equal(pluginName, 'dsh-apex')
  assert.deepEqual([...pluginInject].sort(), ['llm', 'systemPrompt'])
}

function testTierHelpers() {
  assert.equal(isApexCapable(DEEPSEEK), true)
  assert.equal(isApexCapable(OFF_ONLY), false)
  assert.equal(isApexCapable(PLAIN), false)
  assert.equal(highestOfficialEffort(DEEPSEEK), 'max')
  assert.equal(highestOfficialEffort(MULTI), 'xhigh')
  assert.equal(highestOfficialEffort(PLAIN), undefined)

  const tiered = withApexTier(DEEPSEEK)
  assert.equal(tiered.reasoning.efforts.at(-1).id, APEX_ID)
  assert.equal(tiered.reasoning.efforts.length, DEEPSEEK.reasoning.efforts.length + 1)
  assert.equal(DEEPSEEK.reasoning.efforts.at(-1).id, 'max', 'source must stay untouched')
  // Re-applying must not stack a second Apex row.
  assert.equal(withApexTier(tiered).reasoning.efforts.length, tiered.reasoning.efforts.length)
}

function testSelectionReaders() {
  assert.equal(selectedEffort({ modelSelection: { reasoningEffort: APEX_ID } }), APEX_ID)
  assert.equal(selectedEffort({ agent: { model: { current: () => ({ reasoningEffort: APEX_ID }) } } }), APEX_ID)
  assert.equal(selectedEffort({ agent: { model: { current: () => ({}) } } }), undefined)
  assert.equal(selectedEffort(undefined), undefined)
  assert.equal(selectedEffort({ modelSelection: { reasoningEffort: 'max' } }), 'max')

  assert.equal(apexSectionText({ modelSelection: { reasoningEffort: APEX_ID } }), APEX_PROMPT)
  assert.equal(apexSectionText({ modelSelection: { reasoningEffort: 'max' } }), '')
  assert.equal(apexSectionText({}), '')
  assert.equal(apexSectionText(undefined), '')
}

async function testCatalogAdvertisesApex() {
  const { ctx } = fakeRuntime()
  const dispose = apply(ctx)
  try {
    const info = await ctx.llm.resolveModelInfo('deepseek', DEEPSEEK.id)
    assert.deepEqual(info.reasoning.efforts.map(e => e.id), ['off', 'low', 'high', 'max', APEX_ID])
    assert.equal(info.reasoning.defaultEffort, 'high', 'default effort must not move')
    assert.equal(info.reasoning.efforts.at(-1).name, 'Apex')

    const plain = await ctx.llm.resolveModelInfo('acme', PLAIN.id)
    assert.equal(plain.reasoning, undefined)

    const offOnly = await ctx.llm.resolveModelInfo('acme', OFF_ONLY.id)
    assert.deepEqual(offOnly.reasoning.efforts.map(e => e.id), ['off'])
  } finally {
    dispose()
  }
  // Disposal restores the untouched registry projection.
  const after = await ctx.llm.resolveModelInfo('deepseek', DEEPSEEK.id)
  assert.equal(after.reasoning.efforts.some(e => e.id === APEX_ID), false)
}

async function testPrepareCallMapsApexToHighestOfficial() {
  const { ctx, calls } = fakeRuntime()
  const dispose = apply(ctx)
  try {
    await ctx.llm.prepareCall({ provider: 'deepseek', model: DEEPSEEK.id, reasoningEffort: APEX_ID })
    assert.equal(calls.prepare.at(-1).config.reasoningEffort, 'max')

    await ctx.llm.prepareCall({ provider: 'acme', model: MULTI.id, reasoningEffort: APEX_ID })
    assert.equal(calls.prepare.at(-1).config.reasoningEffort, 'xhigh')

    // Every other tier passes through untouched, including "off".
    await ctx.llm.prepareCall({ provider: 'deepseek', model: DEEPSEEK.id, reasoningEffort: 'off' })
    assert.equal(calls.prepare.at(-1).config.reasoningEffort, 'off')
    await ctx.llm.prepareCall({ provider: 'deepseek', model: DEEPSEEK.id })
    assert.equal(calls.prepare.at(-1).config.reasoningEffort, undefined)
  } finally {
    dispose()
  }
}

async function testStreamSafetyNet() {
  const { ctx } = fakeRuntime()
  const dispose = apply(ctx)
  try {
    const chunks = []
    for await (const chunk of ctx.llm.stream({ provider: 'deepseek', model: DEEPSEEK.id, reasoningEffort: APEX_ID })) chunks.push(chunk)
    assert.equal(chunks.length, 1)
    assert.equal(chunks[0].options.reasoningEffort, 'max')

    const passthrough = []
    for await (const chunk of ctx.llm.stream({ provider: 'deepseek', model: DEEPSEEK.id, reasoningEffort: 'low' })) passthrough.push(chunk)
    assert.equal(passthrough[0].options.reasoningEffort, 'low')
  } finally {
    dispose()
  }
}

function testSectionRegistration() {
  const { ctx, sections } = fakeRuntime()
  const dispose = apply(ctx)
  assert.equal(sections.length, 1)
  assert.equal(sections[0].name, SECTION_NAME)
  assert.equal(sections[0].text({ modelSelection: { reasoningEffort: APEX_ID } }), APEX_PROMPT)
  assert.equal(sections[0].text({ modelSelection: { reasoningEffort: 'high' } }), '')
  dispose()
  assert.equal(sections.length, 0, 'section must be released on disposal')
}

async function main() {
  testMetadata()
  testTierHelpers()
  testSelectionReaders()
  await testCatalogAdvertisesApex()
  await testPrepareCallMapsApexToHighestOfficial()
  await testStreamSafetyNet()
  testSectionRegistration()
  console.log('apex smoke: all assertions passed')
}

await main()
