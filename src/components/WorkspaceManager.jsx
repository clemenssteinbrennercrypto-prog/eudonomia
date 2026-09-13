import { lazy, Suspense, useEffect, useState } from 'react'
import WorkspaceSetup from './WorkspaceSetup'
import WorkspaceCalibration from './WorkspaceCalibration'
import WorkspaceAttentionMap from './WorkspaceAttentionMap'
import { WORKSPACE_OBJECT_TYPES, WORKSPACE_ROLE_LABELS, WORKSPACE_ROLES, defaultRoleForType } from '../lib/workspaceObjects'
import {
  customScreenConfig,
  defaultWorkspaceSize,
  sizePresetsForType,
  suggestedCustomScreenSize,
  workspaceSizeFromPhysicalScreen,
  workspaceSizeFromPreset,
} from '../lib/workspaceSizePresets'
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
const PALETTE_OBJECT_TYPES = [...WORKSPACE_OBJECT_TYPES].sort((a, b) => Number(b.id === 'camera') - Number(a.id === 'camera'))
const HEIGHT_ADJUSTABLE_TYPES = new Set(['monitor', 'laptop', 'camera'])
const ROTATABLE_TYPES = new Set(['monitor', 'laptop', 'ipad', 'phone', 'keyboard', 'paper', 'notebook', 'book'])

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

function WorkspaceMiniature({ workspace }) {
  return <WorkspaceAttentionMap
    devices={workspace.objects}
    className="workspace-card-preview"
    ariaLabel={`Attention field for ${workspace.name} with ${workspace.objects.length} objects`}
  />
}

function CustomScreenSizeEditor({ config, physicalSize, onChange }) {
  const [diagonal, setDiagonal] = useState(String(physicalSize.diagonalInches))

  useEffect(() => setDiagonal(String(physicalSize.diagonalInches)), [physicalSize.diagonalInches])

  const commitDiagonal = () => {
    onChange(diagonal, physicalSize.aspectRatio)
  }

  return <div className="workspace-custom-screen-size">
    <label>Diagonal (in)<div className="workspace-measure-input"><input aria-label="Screen diagonal in inches" type="number" min={config.min} max={config.max} step="0.1" value={diagonal} onChange={event => setDiagonal(event.target.value)} onBlur={commitDiagonal} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }}/><span>in</span></div></label>
    <label>Aspect ratio<select aria-label="Screen aspect ratio" value={physicalSize.aspectRatio} onChange={event => onChange(physicalSize.diagonalInches, event.target.value)}>{config.ratios.map(ratio => <option key={ratio} value={ratio}>{ratio}</option>)}</select></label>
    <small>{Math.round(physicalSize.diagonalInches * 2.54 * 10) / 10} cm diagonal · proportions and gaze area update together. Calibration remains the source of truth.</small>
  </div>
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
  const selectedType = WORKSPACE_OBJECT_TYPES.find(type => type.id === selected?.type)
  const selectedSizePresets = selected ? sizePresetsForType(selected.type) : []
  const selectedCustomConfig = selected ? customScreenConfig(selected.type) : null

  const addObject = type => {
    if (type === 'camera') {
      const existing = draft.objects.find(object => object.type === 'camera')
      if (existing) return setSelectedId(existing.id)
    }
    const id = `${type}_${Date.now()}`
    const legacy = { id, type, role: defaultRoleForType(type), col: .5, row: .5, scale: 1, ...defaultWorkspaceSize(type) }
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
  const updateSizePreset = presetId => {
    if (presetId === 'custom' && selectedCustomConfig) {
      const physical = suggestedCustomScreenSize(selected)
      return updatePhysicalScreenSize(physical.diagonalInches, physical.aspectRatio)
    }
    const size = workspaceSizeFromPreset(selected?.type, presetId)
    if (!size) return
    setDraft(current => ({
      ...current,
      objects: current.objects.map(object => object.id === selectedId
        ? { ...object, ...size, scene: { ...object.scene, scale: 1 } }
        : object),
    }))
  }
  const updatePhysicalScreenSize = (diagonalInches, aspectRatio) => {
    const size = workspaceSizeFromPhysicalScreen(selected?.type, diagonalInches, aspectRatio)
    if (!size) return
    setDraft(current => ({
      ...current,
      objects: current.objects.map(object => object.id === selectedId
        ? { ...object, ...size, scene: { ...object.scene, scale: 1 } }
        : object),
    }))
  }
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
      <aside className="workspace-palette"><h3>Objects</h3>{PALETTE_OBJECT_TYPES.map(type => <button key={type.id} className={type.id === 'camera' ? 'is-camera' : ''} onClick={() => addObject(type.id)}><span>{deviceGlyph(type.id)}</span>{type.id === 'camera' ? 'Tracking camera' : type.label}</button>)}</aside>
      <section className="workspace-stage">
        <div className="workspace-view-tabs">{['iso', 'top', 'front'].map(item => <button key={item} className={view === item ? 'is-active' : ''} onClick={() => setView(item)}>{item === 'iso' ? 'Isometric' : item === 'top' ? 'Top' : 'Front'}</button>)}</div>
        <Suspense fallback={<div className="workspace-3d-loading">Preparing 3D workspace…</div>}>
          <Workspace3DScene objects={draft.objects} view={view} selectedId={selectedId} onSelect={setSelectedId} onMove={moveObject}/>
        </Suspense>
        <div className="workspace-quality"><strong>{calibrated}/{draft.objects.length} calibrated</strong><span>{hasPrimary ? 'Primary screen set' : 'Primary screen missing'} · {hasCamera ? 'Camera set' : 'Camera missing'}</span>{error && <em>{error}</em>}<button disabled={!hasPrimary || !hasCamera} onClick={() => setCalibrating(true)}>Calibrate every object</button></div>
      </section>
      <aside className="workspace-properties"><h3>Properties</h3>{selected ? <>
        <div className="workspace-object-kind"><span>{deviceGlyph(selected.type)}</span><div><strong>{selectedType?.label || selected.type}</strong><small>{selected.sizePreset ? 'Standard proportions' : selected.physicalSize ? 'Custom physical size' : 'Existing custom proportions'}</small></div></div>
        <label>Role<select value={selected.role} onChange={event => updateRole(event.target.value)}>{WORKSPACE_ROLES.map(role => <option key={role.id} value={role.id}>{role.label}</option>)}</select></label>
        <div className="workspace-property-section">Size</div>
        {selectedSizePresets.length > 1 ? <>
          <label>Device size<select aria-label="Device size" value={selected.sizePreset || 'custom'} onChange={event => updateSizePreset(event.target.value)}>{selectedCustomConfig && <option value="custom">Custom size</option>}{!selected.sizePreset && !selectedCustomConfig && <option value="custom" disabled>Custom (existing)</option>}{selectedSizePresets.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select><small>Preset diagonals show inches and approximate centimetres.</small></label>
          {selectedCustomConfig && !selected.sizePreset && (selected.physicalSize
            ? <CustomScreenSizeEditor config={selectedCustomConfig} physicalSize={selected.physicalSize} onChange={updatePhysicalScreenSize}/>
            : <div className="workspace-custom-screen-size workspace-unmeasured-size"><small>This older custom shape has no physical measurement yet.</small><button type="button" onClick={() => { const physical = suggestedCustomScreenSize(selected); updatePhysicalScreenSize(physical.diagonalInches, physical.aspectRatio) }}>Enter measured size</button></div>)}
        </> : <div className="workspace-fixed-size"><span>Device size</span><strong>{selected.sizePreset ? selectedSizePresets[0]?.label || 'Standard' : 'Custom (existing)'}</strong>{!selected.sizePreset && selectedSizePresets[0] && <button type="button" onClick={() => updateSizePreset(selectedSizePresets[0].id)}>Use standard</button>}</div>}
        <div className="workspace-property-section">Placement</div>
        <label>Left / right<input type="range" min="-1" max="1" step="0.05" value={selected.scene.x} onChange={event => updateScene({ x: Number(event.target.value) })}/></label>
        <label>Far / near<input type="range" min="0" max="1" step="0.05" value={selected.scene.z} onChange={event => updateScene({ z: Number(event.target.value) })}/></label>
        {HEIGHT_ADJUSTABLE_TYPES.has(selected.type) && <label>Vertical position<input type="range" min="-1" max="1" step="0.05" value={selected.scene.y} onChange={event => updateScene({ y: Number(event.target.value) })}/></label>}
        {ROTATABLE_TYPES.has(selected.type) && <label>Rotation<input type="range" min="-45" max="45" step="5" value={selected.scene.rotation} onChange={event => updateScene({ rotation: Number(event.target.value) })}/></label>}
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
  if (mode === 'templates') return <main className="workspace-templates"><header><span>Workspace setup</span><h1>Build the desk Eudaimonai will understand.</h1><p>Start visually, then refine every gaze target. Nothing leaves this device.</p></header><div className="workspace-template-grid">{Object.keys(TEMPLATE_OBJECTS).map(kind => <button key={kind} onClick={() => setEditing(templateWorkspace(kind, state.workspaces.length))}><div className={`workspace-template-scene ${kind}`}><i/><i/><i/></div><strong>{kind === 'laptop' ? 'Laptop' : kind === 'desktop' ? 'Desktop' : 'Dual screen'}</strong><span>Open editable scene</span></button>)}</div><button className="workspace-quick-link" onClick={() => setMode('quick')}>Use quick question setup instead</button></main>
  return <main className="workspace-library">
    <header><div><span>Workspace library</span><h1>Your focus environments</h1><p>The active workspace gives every session its spatial context.</p></div><button onClick={() => setMode('templates')}>New workspace</button></header>
    {error && <p className="workspace-error">{error}</p>}
    <div className="workspace-card-grid">{state.workspaces.map(workspace => {
      const isActive = workspace.id === state.activeWorkspaceId
      const count = Object.keys(workspace.calibration?.targets || {}).length
      return <article key={workspace.id} className={isActive ? 'is-active' : ''}>
        <div className="workspace-card-main">
          <WorkspaceMiniature workspace={workspace} />
          <div className="workspace-card-copy"><div><strong>{workspace.name}</strong>{isActive && <em>Active</em>}</div><p>{workspace.objects.length} objects · {count}/{workspace.objects.length} calibrated · revision {workspace.revision}</p></div>
        </div>
        <div className="workspace-card-actions">{!isActive && <button onClick={() => commit({ ...state, activeWorkspaceId: workspace.id })}>Use</button>}<button onClick={() => setEditing(workspace)}>Edit</button><button onClick={() => commit(duplicateWorkspace(state, workspace.id))}>Duplicate</button><button disabled={state.workspaces.length <= 1} onClick={() => commit(deleteWorkspace(state, workspace.id))}>Delete</button></div>
      </article>
    })}</div>
    <footer><span>{active ? `${active.name} will be used for the next session.` : 'Create a workspace to continue.'}</span><button disabled={!active} onClick={onContinue}>Done</button></footer>
  </main>
}
