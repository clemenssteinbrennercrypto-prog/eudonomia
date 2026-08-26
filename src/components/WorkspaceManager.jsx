import { useMemo, useRef, useState } from 'react'
import WorkspaceSetup from './WorkspaceSetup'
import WorkspaceCalibration from './WorkspaceCalibration'
import { WORKSPACE_OBJECT_TYPES, WORKSPACE_ROLE_LABELS, WORKSPACE_ROLES, defaultRoleForType } from '../lib/workspaceObjects'
import {
  createWorkspace,
  deleteWorkspace,
  duplicateWorkspace,
  getActiveWorkspace,
  invalidateObjectCalibration,
  saveWorkspaceDraft,
  sceneFromLegacy,
} from '../lib/workspaceStore'

const TEMPLATE_OBJECTS = {
  laptop: [
    { id: 'laptop_main', type: 'laptop', role: 'primary_screen', col: .5, row: .52 },
    { id: 'camera_main', type: 'camera', role: 'neutral', col: .5, row: .1 },
    { id: 'phone_main', type: 'phone', role: 'distraction_device', col: .82, row: .35 },
  ],
  desktop: [
    { id: 'monitor_main', type: 'monitor', role: 'primary_screen', col: .5, row: .28 },
    { id: 'camera_main', type: 'camera', role: 'neutral', col: .5, row: .08 },
    { id: 'keyboard_main', type: 'keyboard', role: 'input_area', col: .5, row: .68 },
    { id: 'mouse_main', type: 'mouse', role: 'input_area', col: .75, row: .68 },
  ],
  dual: [
    { id: 'monitor_main', type: 'monitor', role: 'primary_screen', col: .38, row: .28 },
    { id: 'monitor_side', type: 'monitor', role: 'secondary_screen', col: .72, row: .3 },
    { id: 'camera_main', type: 'camera', role: 'neutral', col: .38, row: .08 },
    { id: 'keyboard_main', type: 'keyboard', role: 'input_area', col: .48, row: .68 },
  ],
}

function templateWorkspace(kind, index) {
  const labels = { laptop: 'Laptop workspace', desktop: 'Desktop workspace', dual: 'Dual-screen workspace' }
  const objects = TEMPLATE_OBJECTS[kind].map(object => ({ ...object, scene: sceneFromLegacy(object), scale: 1 }))
  return createWorkspace({ name: index ? `${labels[kind]} ${index + 1}` : labels[kind], objects })
}

function project(scene, view) {
  const x = scene.x || 0, y = scene.y || 0, z = scene.z ?? .5
  if (view === 'top') return { x: 300 + x * 220, y: 85 + z * 310 }
  if (view === 'front') return { x: 300 + x * 220, y: 260 - y * 145 }
  return { x: 300 + x * 190 + (z - .5) * 90, y: 120 + z * 230 - y * 80 }
}

function legacyRowFor(object, scene) {
  return object.type === 'monitor' || object.type === 'laptop' || object.type === 'camera'
    ? (1 - scene.y) / 2
    : scene.z
}

function deviceGlyph(type) {
  return ({ monitor: '▭', laptop: '▱', camera: '◉', phone: '▯', keyboard: '⌨', mouse: '●', ipad: '▯', paper: '▤', notebook: '▥', book: '▰' })[type] || '◆'
}

function WorkspaceScene({ draft, setDraft, view, selectedId, setSelectedId }) {
  const svgRef = useRef(null)
  const dragRef = useRef(null)
  const move = event => {
    if (!dragRef.current || !svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const sx = (event.clientX - rect.left) / rect.width * 600
    const sy = (event.clientY - rect.top) / rect.height * 440
    const object = draft.objects.find(item => item.id === dragRef.current)
    if (!object) return
    let scene = { ...object.scene }
    if (view === 'top') { scene.x = (sx - 300) / 220; scene.z = (sy - 85) / 310 }
    else if (view === 'front') { scene.x = (sx - 300) / 220; scene.y = (260 - sy) / 145 }
    else { scene.x = (sx - 300 - (scene.z - .5) * 90) / 190; scene.z = Math.max(0, Math.min(1, (sy - 120 + scene.y * 80) / 230)) }
    scene.x = Math.max(-1, Math.min(1, Math.round(scene.x * 20) / 20))
    scene.y = Math.max(-1, Math.min(1, Math.round(scene.y * 20) / 20))
    scene.z = Math.max(0, Math.min(1, Math.round(scene.z * 20) / 20))
    const col = (scene.x + 1) / 2
    const row = legacyRowFor(object, scene)
    let next = { ...draft, objects: draft.objects.map(item => item.id === object.id ? { ...item, scene, col, row } : item) }
    next = invalidateObjectCalibration(next, object.id, object.type === 'camera' || object.role === 'primary_screen')
    setDraft(next)
  }
  return (
    <svg ref={svgRef} className="workspace-scene" viewBox="0 0 600 440" onPointerMove={move} onPointerUp={() => { dragRef.current = null }} onPointerLeave={() => { dragRef.current = null }}>
      <defs><linearGradient id="workspaceDesk" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#172150"/><stop offset="1" stopColor="#0a1028"/></linearGradient></defs>
      {view === 'iso' && <path d="M90 345 L215 90 L500 90 L565 345 Z" fill="url(#workspaceDesk)" stroke="#32458e" />}
      {view === 'top' && <rect x="70" y="55" width="460" height="350" rx="24" fill="url(#workspaceDesk)" stroke="#32458e" />}
      {view === 'front' && <><path d="M55 330 H545" stroke="#32458e" strokeWidth="3"/><path d="M100 330 V390 M500 330 V390" stroke="#1d2a5f" strokeWidth="14"/></>}
      <g className="workspace-grid">{Array.from({ length: 9 }).map((_, i) => <path key={i} d={`M${100 + i * 50} 70 V390`} />)}</g>
      <g transform="translate(300 420)"><circle r="11" fill="#7a98ff"/><path d="M-24 17 Q0-5 24 17" fill="#405bc7"/><text y="38" textAnchor="middle">YOU</text></g>
      {draft.objects.map(object => {
        const point = project(object.scene, view)
        const active = object.id === selectedId
        return <g key={object.id} transform={`translate(${point.x} ${point.y}) rotate(${object.scene.rotation || 0}) scale(${object.scene.scale || 1})`} className={`workspace-object ${active ? 'is-active' : ''}`} onPointerDown={event => { event.currentTarget.setPointerCapture?.(event.pointerId); dragRef.current = object.id; setSelectedId(object.id); event.preventDefault() }}>
          <rect x="-32" y="-25" width="64" height="50" rx="12" />
          <text className="glyph" textAnchor="middle" y="7">{deviceGlyph(object.type)}</text>
          <text className="label" textAnchor="middle" y="42">{WORKSPACE_OBJECT_TYPES.find(type => type.id === object.type)?.label}</text>
          {draft.calibration?.targets?.[object.id] && <circle cx="25" cy="-20" r="6" className="calibrated" />}
        </g>
      })}
    </svg>
  )
}

function Editor({ initial, onSave, onCancel }) {
  const [draft, setDraft] = useState(() => structuredClone(initial))
  const [view, setView] = useState('iso')
  const [selectedId, setSelectedId] = useState(draft.objects[0]?.id || null)
  const [calibrating, setCalibrating] = useState(false)
  const [error, setError] = useState('')
  const selected = draft.objects.find(object => object.id === selectedId)
  const hasPrimary = draft.objects.some(object => object.role === 'primary_screen')
  const hasCamera = draft.objects.some(object => object.type === 'camera')
  const calibrated = Object.keys(draft.calibration?.targets || {}).length

  const addObject = type => {
    if (type === 'camera') {
      const existing = draft.objects.find(object => object.type === 'camera')
      if (existing) return setSelectedId(existing.id)
    }
    const id = `${type}_${Date.now()}`
    const legacy = { id, type, role: defaultRoleForType(type), col: .5, row: .5, scale: 1 }
    setDraft(current => ({ ...current, objects: [...current.objects, { ...legacy, scene: sceneFromLegacy(legacy), calibrationTarget: true }] }))
    setSelectedId(id)
  }
  const updateScene = patch => setDraft(current => {
    const next = { ...current, objects: current.objects.map(object => {
      if (object.id !== selectedId) return object
      const scene = { ...object.scene, ...patch }
      return { ...object, scene, col: (scene.x + 1) / 2, row: legacyRowFor(object, scene) }
    }) }
    return invalidateObjectCalibration(next, selectedId, selected?.type === 'camera' || selected?.role === 'primary_screen')
  })
  const updateRole = role => {
    let next = {
      ...draft,
      objects: draft.objects.map(object => object.id === selectedId
        ? { ...object, role }
        : role === 'primary_screen' && object.role === 'primary_screen'
          ? { ...object, role: 'secondary_screen' }
          : object),
    }
    if (role === 'primary_screen' || selected?.role === 'primary_screen') {
      next = invalidateObjectCalibration(next, selectedId, true)
    }
    setDraft(next)
  }
  const removeSelected = () => {
    setDraft(current => ({ ...current, objects: current.objects.filter(object => object.id !== selectedId) }))
    setSelectedId(null)
  }
  if (calibrating) return <WorkspaceCalibration workspace={draft} onCancel={() => setCalibrating(false)} onDone={calibration => { setDraft(current => ({ ...current, calibration })); setCalibrating(false) }} />

  return <main className="workspace-editor">
    <header className="workspace-editor-header">
      <div><span>Workspace editor</span><input value={draft.name} maxLength={50} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))}/></div>
      <div className="workspace-actions"><button className="secondary" onClick={onCancel}>Cancel</button><button onClick={() => { if (!hasPrimary || !hasCamera) return setError('Add one primary screen and a camera before saving.'); onSave(draft) }}>Save workspace</button></div>
    </header>
    <div className="workspace-editor-body">
      <aside className="workspace-palette"><h3>Objects</h3>{WORKSPACE_OBJECT_TYPES.map(type => <button key={type.id} onClick={() => addObject(type.id)}><span>{deviceGlyph(type.id)}</span>{type.label}</button>)}</aside>
      <section className="workspace-stage">
        <div className="workspace-view-tabs">{['iso', 'top', 'front'].map(item => <button key={item} className={view === item ? 'is-active' : ''} onClick={() => setView(item)}>{item === 'iso' ? 'Isometric' : item === 'top' ? 'Top' : 'Front'}</button>)}</div>
        <WorkspaceScene draft={draft} setDraft={setDraft} view={view} selectedId={selectedId} setSelectedId={setSelectedId}/>
        <div className="workspace-quality"><strong>{calibrated}/{draft.objects.length} calibrated</strong><span>{hasPrimary ? 'Primary screen set' : 'Primary screen missing'} · {hasCamera ? 'Camera set' : 'Camera missing'}</span>{error && <em>{error}</em>}<button disabled={!hasPrimary || !hasCamera} onClick={() => setCalibrating(true)}>Calibrate every object</button></div>
      </section>
      <aside className="workspace-properties"><h3>Properties</h3>{selected ? <>
        <label>Role<select value={selected.role} onChange={event => updateRole(event.target.value)}>{WORKSPACE_ROLES.map(role => <option key={role.id} value={role.id}>{role.label}</option>)}</select></label>
        <label>Left / right<input type="range" min="-1" max="1" step="0.05" value={selected.scene.x} onChange={event => updateScene({ x: Number(event.target.value) })}/></label>
        <label>Height<input type="range" min="-1" max="1" step="0.05" value={selected.scene.y} onChange={event => updateScene({ y: Number(event.target.value) })}/></label>
        <label>Depth<input type="range" min="0" max="1" step="0.05" value={selected.scene.z} onChange={event => updateScene({ z: Number(event.target.value) })}/></label>
        <label>Scale<input type="range" min="0.6" max="1.8" step="0.1" value={selected.scene.scale} onChange={event => updateScene({ scale: Number(event.target.value) })}/></label>
        <label>Rotation<input type="range" min="-45" max="45" step="5" value={selected.scene.rotation} onChange={event => updateScene({ rotation: Number(event.target.value) })}/></label>
        <small>{WORKSPACE_ROLE_LABELS[selected.role]}</small><button className="danger" onClick={removeSelected}>Remove object</button>
      </> : <p>Select an object to place it precisely.</p>}</aside>
    </div>
  </main>
}

export default function WorkspaceManager({ state, onChange, onContinue }) {
  const [mode, setMode] = useState(state.workspaces.length ? 'library' : 'templates')
  const [editing, setEditing] = useState(null)
  const [quickDevices, setQuickDevices] = useState([])
  const [error, setError] = useState('')
  const active = getActiveWorkspace(state)
  const commit = next => { const result = onChange(next); if (result?.ok === false) setError(result.error) }
  if (mode === 'quick') return <WorkspaceSetup devices={quickDevices} setDevices={setQuickDevices} onContinue={() => {
    if (quickDevices.length) { const workspace = createWorkspace({ name: 'Quick workspace', objects: quickDevices.map(object => ({ ...object, scene: sceneFromLegacy(object) })) }); commit(saveWorkspaceDraft(state, workspace)) }
    setMode('library')
  }} />
  if (editing) return <Editor initial={editing} onCancel={() => { setEditing(null); setMode(state.workspaces.length ? 'library' : 'templates') }} onSave={draft => { commit(saveWorkspaceDraft(state, draft)); setEditing(null); setMode('library') }} />
  if (mode === 'templates') return <main className="workspace-templates"><header><span>Workspace setup</span><h1>Build the desk Eudaimonia will understand.</h1><p>Start visually, then refine every gaze target. Nothing leaves this device.</p></header><div className="workspace-template-grid">{Object.keys(TEMPLATE_OBJECTS).map(kind => <button key={kind} onClick={() => setEditing(templateWorkspace(kind, state.workspaces.length))}><div className={`workspace-template-scene ${kind}`}><i/><i/><i/></div><strong>{kind === 'laptop' ? 'Laptop' : kind === 'desktop' ? 'Desktop' : 'Dual screen'}</strong><span>Open editable scene</span></button>)}</div><button className="workspace-quick-link" onClick={() => setMode('quick')}>Use quick question setup instead</button></main>
  return <main className="workspace-library"><header><div><span>Workspace library</span><h1>Your focus environments</h1><p>The active workspace gives every session its spatial context.</p></div><button onClick={() => setMode('templates')}>New workspace</button></header>{error && <p className="workspace-error">{error}</p>}<div className="workspace-card-grid">{state.workspaces.map(workspace => {
    const isActive = workspace.id === state.activeWorkspaceId
    const count = Object.keys(workspace.calibration?.targets || {}).length
    return <article key={workspace.id} className={isActive ? 'is-active' : ''}><div className="workspace-card-preview"><span>{workspace.objects.map(object => deviceGlyph(object.type)).join(' ')}</span></div><div className="workspace-card-copy"><div><strong>{workspace.name}</strong>{isActive && <em>Active</em>}</div><p>{workspace.objects.length} objects · {count}/{workspace.objects.length} calibrated · revision {workspace.revision}</p></div><div className="workspace-card-actions">{!isActive && <button onClick={() => commit({ ...state, activeWorkspaceId: workspace.id })}>Use</button>}<button onClick={() => setEditing(workspace)}>Edit</button><button onClick={() => commit(duplicateWorkspace(state, workspace.id))}>Duplicate</button><button disabled={state.workspaces.length <= 1} onClick={() => commit(deleteWorkspace(state, workspace.id))}>Delete</button></div></article>
  })}</div><footer><span>{active ? `${active.name} will be used for the next session.` : 'Create a workspace to continue.'}</span><button disabled={!active} onClick={onContinue}>Done</button></footer></main>
}
