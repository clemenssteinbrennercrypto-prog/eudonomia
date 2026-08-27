import { lazy, Suspense, useState } from 'react'
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

const Workspace3DScene = lazy(() => import('./Workspace3DScene'))

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

function legacyRowFor(object, scene) {
  return object.type === 'monitor' || object.type === 'laptop' || object.type === 'camera'
    ? (1 - scene.y) / 2
    : scene.z
}

function deviceGlyph(type) {
  return ({ monitor: '▭', laptop: '▱', camera: '◉', phone: '▯', keyboard: '⌨', mouse: '●', ipad: '▯', paper: '▤', notebook: '▥', book: '▰' })[type] || '◆'
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
  const moveObject = (id, position) => setDraft(current => {
    const object = current.objects.find(item => item.id === id)
    if (!object) return current
    const scene = {
      ...object.scene,
      x: Math.round(position.x * 20) / 20,
      z: Math.round(position.z * 20) / 20,
    }
    let next = {
      ...current,
      objects: current.objects.map(item => item.id === id
        ? { ...item, scene, col: (scene.x + 1) / 2, row: legacyRowFor(item, scene) }
        : item),
    }
    next = invalidateObjectCalibration(next, id, object.type === 'camera' || object.role === 'primary_screen')
    return next
  })
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
        <Suspense fallback={<div className="workspace-3d-loading">Preparing 3D workspace…</div>}>
          <Workspace3DScene objects={draft.objects} view={view} selectedId={selectedId} onSelect={setSelectedId} onMove={moveObject}/>
        </Suspense>
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
