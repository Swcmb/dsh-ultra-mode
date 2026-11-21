/**
 * dsh-ultra-mode — browser half · DeepSeek Harness Apex Mode
 *
 * Apex is a virtual top tier in the model selector. It is NOT a real reasoning
 * effort: selecting it sends the model's highest OFFICIAL effort upstream and
 * marks the session Apex-active through the host state route. The host half
 * injects the Apex prompt only for that session and only for the target model.
 * No settings page, no separate toggle, no reasoningEffort spoofing.
 *
 * Extension points (proven by dsh-ultra-slider):
 *   - conversation.input.model seat takeover (priority -20)
 *   - a directory store built on remote.session.modelCatalog()/selectModel
 *     (the official directoryFor() is unavailable to third-party plugins)
 */
window.__ModuleLoader__.load({
  id: 'dsh-ultra-mode',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useSyncExternalStore } = React
    const NS = 'dsh-apex'
    const SEAT = 'conversation.input.model'
    const ENTRY = 'dsh-apex'
    const SEAT_PRIORITY = -20
    const APEX_ID = 'apex'
    const STATE_ROUTE = '/dsh-apex/state'
    const STATE_KEY = 'dsh_apex_active'
    const APEX_PREFERRED = ['max', 'xhigh', 'high', 'medium', 'low']

    const DICT = {
      zh: { apex: 'Apex', highest: '最高执行等级', models: '模型', efforts: '推理等级', loadError: '目录加载失败', none: '无可用档位' },
      en: { apex: 'Apex', highest: 'Highest execution tier', models: 'Model', efforts: 'Reasoning effort', loadError: 'Catalog load failed', none: 'No tiers available' },
    }

    /* ── remote directory store ──────────────────────────────────────────
     * Copied in minimal form from the proven dsh-ultra-slider implementation.
     * The official ModelDirectoryResolver cannot be used by third-party plugins
     * ("cannot get property remote.session without inject"), so the catalog and
     * selection go through the remote.session RPC directly.
     */
    function createRemoteDirectory(remoteSession, sessionId, projectedProvider) {
      let snapshot = { current: null, routable: null, groups: [], failures: [], status: 'loading', error: null }
      const listeners = new Set()
      let catalogValue = null
      let inflight = null
      let closed = false
      let kickStarted = false
      let projectedCache = null
      let stopProjection = null
      let pendingSelected = null
      let selectGeneration = 0
      let loadGeneration = 0

      const publish = (patch) => {
        snapshot = Object.assign({}, snapshot, patch)
        for (const fn of [...listeners]) { try { fn() } catch (e) { /* noop */ } }
      }
      const getProjected = () => {
        if (projectedCache !== null && typeof projectedCache.getSnapshot === 'function') return projectedCache
        let candidate = null
        try { candidate = typeof projectedProvider === 'function' ? projectedProvider() : projectedProvider } catch (e) { candidate = null }
        if (candidate !== null && candidate !== undefined && candidate !== projectedCache) {
          if (stopProjection) { try { stopProjection() } catch (e) {} stopProjection = null }
          projectedCache = candidate
          try { if (typeof candidate.subscribe === 'function') stopProjection = candidate.subscribe(() => syncFromCatalog()) } catch (e) { stopProjection = null }
        }
        return projectedCache
      }
      const currentFromProjection = () => {
        if (catalogValue === null) return null
        let value
        try { const face = getProjected(); value = face === null ? undefined : face.getSnapshot() } catch (e) { value = undefined }
        const next = value && value.next ? value.next : null
        if (next !== null) { pendingSelected = null; return next }
        if (pendingSelected !== null) return pendingSelected
        if (value === undefined) return snapshot.current !== null ? snapshot.current : (catalogValue.default || null)
        return catalogValue.default || null
      }
      function syncFromCatalog() {
        if (closed || catalogValue === null) return
        const current = currentFromProjection()
        const groups = Array.isArray(catalogValue.groups) ? catalogValue.groups : []
        const marked = groups.map((group) => {
          const models = Array.isArray(group && group.models) ? group.models : []
          return Object.assign({}, group, {
            models: models.map((model) => {
              const isCurrent = current !== null && model && model.id === current.model &&
                (current.provider === undefined || group.id === current.provider || group.provider === current.provider || group.namespace === current.provider)
              return Object.assign({}, model, { selected: isCurrent === true })
            }),
          })
        })
        publish({
          current,
          routable: Array.isArray(catalogValue.routableProviders) && current !== null
            ? catalogValue.routableProviders.indexOf(current.provider) >= 0 : null,
          groups: marked,
          failures: Array.isArray(catalogValue.failures) ? catalogValue.failures : [],
          status: 'ready', error: null,
        })
      }
      function load() {
        if (closed) return Promise.resolve(snapshot)
        if (inflight !== null) return inflight
        if (!remoteSession || typeof remoteSession.modelCatalog !== 'function') {
          publish({ status: 'error', error: 'modelCatalog unavailable' })
          return Promise.resolve(snapshot)
        }
        publish({ status: snapshot.groups.length > 0 ? snapshot.status : 'loading', error: null })
        const attemptGeneration = loadGeneration
        const attempt = Promise.resolve()
          .then(() => remoteSession.modelCatalog())
          .then((response) => {
            if (closed || attemptGeneration !== loadGeneration) return snapshot
            if (!response || response.ok !== true) {
              publish({ status: 'error', error: response?.error ? String(response.error.code) + ': ' + String(response.error.message) : 'modelCatalog failed' })
              return snapshot
            }
            catalogValue = response.value
            syncFromCatalog()
            return snapshot
          })
          .catch((error) => {
            if (closed || attemptGeneration !== loadGeneration) return snapshot
            publish({ status: 'error', error: String(error?.message || error) })
            return snapshot
          })
          .then((value) => { if (inflight === attempt) inflight = null; return value })
        inflight = attempt
        return attempt
      }
      function select(selection) {
        if (closed) return Promise.resolve({ ok: false, error: { code: 'closed' } })
        if (!remoteSession || typeof remoteSession.selectModel !== 'function') return Promise.resolve({ ok: false, error: { code: 'unavailable' } })
        const generation = ++selectGeneration
        publish({ status: 'selecting', error: null })
        return Promise.resolve()
          .then(() => remoteSession.selectModel({
            sessionId,
            provider: selection.provider,
            model: selection.model,
            ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
          }))
          .then((result) => {
            if (closed || generation !== selectGeneration) return result
            if (!result || result.ok !== true) {
              publish({ status: 'error', error: result?.error ? String(result.error.message) : 'selectModel failed' })
              return result
            }
            const selected = result.value && result.value.selected ? result.value.selected : {
              provider: selection.provider, model: selection.model,
              ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
            }
            pendingSelected = selected
            inflight = null
            publish({ current: selected, status: 'ready', error: null })
            void load()
            return result
          })
          .catch((error) => {
            if (closed || generation !== selectGeneration) return { ok: false, error: { code: 'superseded' } }
            publish({ status: 'error', error: String(error?.message || error) })
            return { ok: false, error: { code: 'threw' } }
          })
      }
      return {
        getSnapshot: () => {
          if (!kickStarted && !closed) { kickStarted = true; try { void load() } catch (e) {} }
          return snapshot
        },
        subscribe: (listener) => {
          if (closed) return () => {}
          listeners.add(listener)
          if (!kickStarted) { kickStarted = true; try { void load() } catch (e) {} }
          return () => listeners.delete(listener)
        },
        load, select,
        resetConnected: () => {
          if (closed) return
          loadGeneration += 1; selectGeneration += 1
          inflight = null; catalogValue = null; pendingSelected = null
          if (stopProjection) { try { stopProjection() } catch (e) {} stopProjection = null }
          projectedCache = null
          publish({ current: null, routable: null, groups: [], failures: [], status: 'loading', error: null })
          void load()
        },
        dispose: () => { closed = true; listeners.clear(); if (stopProjection) { try { stopProjection() } catch (e) {} } },
      }
    }

    /* ── Apex session state ────────────────────────────────────────────── */
    const apexCache = {}
    const apexListeners = new Set()
    const readStore = () => {
      try { const raw = window.localStorage.getItem(STATE_KEY); const p = raw ? JSON.parse(raw) : null; if (p && typeof p === 'object') return p } catch (e) {}
      return {}
    }
    const activeFor = (sessionId) => {
      if (!(sessionId in apexCache)) apexCache[sessionId] = readStore()[sessionId] === true
      return apexCache[sessionId] === true
    }
    const setActive = (sessionId, active) => {
      apexCache[sessionId] = active === true
      try { const s = readStore(); if (active) s[sessionId] = true; else delete s[sessionId]; window.localStorage.setItem(STATE_KEY, JSON.stringify(s)) } catch (e) {}
      try {
        void fetch(STATE_ROUTE, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-dsh-apex': '1' },
          body: JSON.stringify({ sessionId, active: active === true }),
        }).catch(() => {})
      } catch (e) {}
      for (const fn of [...apexListeners]) { try { fn() } catch (e) {} }
    }
    const useApex = (sessionId) => {
      const [, force] = useState(0)
      useEffect(() => { const fn = () => force((n) => n + 1); apexListeners.add(fn); return () => apexListeners.delete(fn) }, [])
      return activeFor(sessionId)
    }

    /* ── directory helpers ─────────────────────────────────────────────── */
    const modelOf = (state) => {
      const cur = state?.current
      if (!cur || typeof cur.provider !== 'string' || typeof cur.model !== 'string') return null
      for (const group of (Array.isArray(state?.groups) ? state.groups : [])) {
        if (!group || group.id !== cur.provider) continue
        for (const model of (Array.isArray(group.models) ? group.models : [])) if (model && model.id === cur.model) return model
      }
      return null
    }
    const officialOf = (state) => {
      const model = modelOf(state)
      const efforts = model?.reasoning && Array.isArray(model.reasoning.efforts) ? model.reasoning.efforts : []
      return efforts.filter((e) => e && typeof e.id === 'string' && e.id.length > 0)
        .map((e) => ({ id: e.id, name: typeof e.name === 'string' && e.name.length > 0 ? e.name : e.id }))
    }
    const wireForApex = (official) => {
      const ids = official.map((e) => e.id)
      for (const level of APEX_PREFERRED) if (ids.includes(level)) return level
      return ids.length > 0 ? ids[ids.length - 1] : null
    }
    const defaultEffortOf = (state, provider, modelId) => {
      for (const group of (Array.isArray(state?.groups) ? state.groups : [])) {
        if (!group || group.id !== provider) continue
        const model = (Array.isArray(group.models) ? group.models : []).find((m) => m && m.id === modelId)
        if (model?.reasoning?.defaultEffort) return model.reasoning.defaultEffort
      }
      return null
    }

    /* ── seat UI ───────────────────────────────────────────────────────── */
    function ApexSeat({ directory, select, load, available, sessionId, t }) {
      const snapshot = useSyncExternalStore(
        (fn) => directory ? directory.subscribe(fn) : () => {},
        () => directory ? directory.getSnapshot() : { current: null, groups: [], status: 'loading' },
      )
      const apexActive = useApex(sessionId)
      const [panel, setPanel] = useState(null)
      const [busy, setBusy] = useState(false)
      const [err, setErr] = useState(null)
      useEffect(() => { if (directory) load?.() }, [directory])

      const current = snapshot.current || null
      const official = officialOf(snapshot)
      const apexWire = wireForApex(official)
      const shownTier = apexActive && apexWire ? APEX_ID : (current?.reasoningEffort || null)
      const tierName = apexActive ? t('apex') : (official.find((e) => e.id === shownTier)?.name || shownTier || t('apex'))
      const groups = Array.isArray(snapshot.groups) ? snapshot.groups : []

      const commit = async (selection, wanted) => {
        setBusy(true); setErr(null); setPanel(null)
        setActive(sessionId, wanted)
        try {
          const result = await select(selection)
          if (result && result.ok === false) setErr(String(result.error?.message || 'select failed'))
        } catch (e) { setErr(String(e?.message || e)) }
        finally { setBusy(false) }
      }
      const chooseEffort = (levelId) => {
        if (!current || !available || busy) return
        const wanted = levelId === APEX_ID
        const wire = wanted ? apexWire : levelId
        if (wanted && !wire) { setErr(t('none')); return }
        const selection = { provider: current.provider, model: current.model }
        if (wire) selection.reasoningEffort = wire
        void commit(selection, wanted)
      }
      const chooseModel = (provider, modelId) => {
        if (!available || busy) return
        const effort = defaultEffortOf(snapshot, provider, modelId)
        const selection = { provider, model: modelId }
        if (effort) selection.reasoningEffort = effort
        void commit(selection, false)
      }

      const chipStyle = {
        display: 'inline-flex', alignItems: 'center', gap: 6, height: 24,
        padding: '0 9px', margin: 0, fontFamily: 'inherit', fontSize: 12, lineHeight: 1,
        maxWidth: '100%', borderRadius: 'var(--dsw-radius-sm, 8px)',
        border: '1px solid ' + (apexActive ? 'var(--dsw-alias-state-success-secondary, #4ed17e)' : 'var(--dsw-alias-border-l2, #0000001a)'),
        background: apexActive ? 'var(--dsw-alias-state-success-tertiary, #e6faed)' : 'transparent',
        color: apexActive ? 'var(--dsw-alias-label-primary, #0f1115)' : 'var(--dsw-alias-label-secondary, #61666b)',
        cursor: available && !busy ? 'pointer' : 'default', userSelect: 'none',
      }
      const panelStyle = {
        position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, zIndex: 50,
        minWidth: 210, maxHeight: 320, overflow: 'auto', padding: 6,
        borderRadius: 'var(--dsw-radius-md, 8px)',
        border: '1px solid var(--dsw-alias-border-l2, #0000001a)',
        background: 'var(--dsw-alias-bg-elevated, #fff)', color: 'var(--dsw-alias-label-primary, #0f1115)',
        boxShadow: 'var(--dsw-alias-elevation-2, 0 8px 24px rgba(0,0,0,.12))',
      }
      const rowStyle = {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        width: '100%', padding: '6px 8px', border: 0, borderRadius: 6,
        background: 'transparent', color: 'inherit', font: 'inherit', fontSize: 13,
        textAlign: 'left', cursor: 'pointer',
      }
      const menu = panel === 'root'
        ? h('div', null,
            h('button', { type: 'button', role: 'menuitem', style: rowStyle, onClick: () => setPanel('models') }, h('span', null, t('models')), h('span', null, current?.model || '')),
            h('button', { type: 'button', role: 'menuitem', style: rowStyle, onClick: () => setPanel('efforts') }, h('span', null, t('efforts')), h('span', null, tierName)),
          )
        : panel === 'efforts'
          ? h('div', null,
              official.length > 0
                ? [h('button', {
                    key: 'apex', type: 'button', role: 'menuitemradio', 'aria-checked': apexActive,
                    style: { ...rowStyle, color: apexActive ? 'var(--dsw-alias-state-success, #15803d)' : 'inherit', fontWeight: 600 },
                    onClick: () => chooseEffort(APEX_ID),
                  }, h('span', null, `Apex · ${t('highest')}`), h('span', null, apexWire ? `→ ${apexWire}` : '')),
                  ...official.map((e) => h('button', {
                    key: e.id, type: 'button', role: 'menuitemradio', 'aria-checked': !apexActive && shownTier === e.id,
                    style: rowStyle, onClick: () => chooseEffort(e.id),
                  }, h('span', null, e.name), h('span', null, '')))]
                : h('div', { style: { padding: 8, fontSize: 12 } }, t('none')),
            )
          : h('div', null, groups.map((g) => h('div', { key: g.id },
              h('div', { style: { padding: '4px 8px', fontSize: 11, opacity: .6 } }, g.name || g.id),
              (Array.isArray(g.models) ? g.models : []).map((m) => h('button', {
                key: m.id, type: 'button', role: 'menuitemradio',
                'aria-checked': current?.provider === g.id && current?.model === m.id,
                style: rowStyle, onClick: () => chooseModel(g.id, m.id),
              }, h('span', null, m.name || m.id), h('span', null, ''))),
            )))

      return h('span', { style: { position: 'relative', display: 'inline-flex' } },
        h('button', {
          type: 'button', disabled: !available || busy,
          'aria-haspopup': 'menu', 'aria-expanded': panel !== null,
          'aria-label': (current ? `${current.provider}/${current.model} · ` : '') + tierName,
          onClick: () => setPanel(panel === null ? 'root' : null),
          style: chipStyle,
        },
          h('span', { 'aria-hidden': 'true' }, apexActive ? '▲' : '◆'),
          h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 } }, current ? current.model : t('apex')),
          h('span', { style: { fontWeight: 600, color: apexActive ? 'inherit' : 'var(--dsw-alias-state-business-primary, #4d93f8)' } }, tierName),
        ),
        panel !== null ? h('div', { role: 'menu', style: panelStyle }, menu) : null,
        err ? h('div', { role: 'alert', style: { position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, padding: 6, background: 'var(--dsw-alias-bg-danger, #fff1f1)', color: 'var(--dsw-alias-label-danger, #b42318)', borderRadius: 6, fontSize: 12 } }, err) : null,
      )
    }

    /* ── registration ──────────────────────────────────────────────────── */
    function apply(ctx) {
      ctx.effect(() => ctx.locale?.register?.(NS, DICT), 'dsh-apex: dictionaries')
      const t = (key) => {
        try {
          const bound = ctx.locale?.bind?.(NS)
          if (bound && bound(key)) return bound(key)
        } catch (e) { /* fallback below */ }
        const lang = (() => { try { return ctx.locale?.language?.() } catch (e) { return null } })()
        return (DICT[lang] || DICT.en)[key] || key
      }
      const accessors = new Map()
      const accessFor = (sessionId) => {
        if (typeof sessionId !== 'string' || sessionId === '') return null
        if (accessors.has(sessionId)) return accessors.get(sessionId)
        const remote = ctx.remote && ctx.remote.session ? ctx.remote.session : null
        if (!remote || typeof remote.modelCatalog !== 'function') return null
        const projected = () => {
          try {
            const sessions = ctx.get('sessions')
            const bound = sessions && typeof sessions.binding === 'function' ? sessions.binding(sessionId) : null
            return bound && bound.session && bound.session.projections && typeof bound.session.projections.faceOf === 'function'
              ? bound.session.projections.faceOf('modelSelection') : null
          } catch (e) { return null }
        }
        const dir = createRemoteDirectory(remote, sessionId, projected)
        accessors.set(sessionId, dir)
        return dir
      }

      ctx.inject(['modelDirectories'], (scope) => {
        scope.slots.inject(SEAT, () => scope.slots.register(
          { name: SEAT, id: ENTRY, priority: SEAT_PRIORITY, label: () => 'Apex' },
          (props) => h(ApexSeat, {
            ...props,
            t,
            directory: accessFor(props.sessionId),
            load: () => accessFor(props.sessionId)?.load(),
            select: (selection) => { const d = accessFor(props.sessionId); return d ? d.select(selection) : Promise.resolve({ ok: false }) },
          }),
        ))
      })

      ctx.effect(() => {
        const reset = () => { for (const d of accessors.values()) { try { d.resetConnected() } catch (e) {} } }
        try { ctx.on('connection/reset', reset) } catch (e) {}
        try { ctx.remote?.$on?.('llm/adapters-updated', reset) } catch (e) {}
      })
    }

    const inject = ['slots', 'sessions', 'modelDirectories', 'remote', 'remote.session']
    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
