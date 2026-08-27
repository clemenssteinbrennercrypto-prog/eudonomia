import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

const COLORS = {
  ink: 0x070b1a,
  surface: 0x0a1028,
  panel: 0x151f4b,
  ultra: 0x2c46ff,
  bright: 0x7a98ff,
  pale: 0xb8c5f2,
  desk: 0x101943,
  edge: 0x405bc7,
  white: 0xe8edff,
  danger: 0xf05d75,
}

function material(color, roughness = .48, metalness = .22) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness })
}

function mesh(geometry, color, { y = 0, x = 0, z = 0, rotationX = 0, cast = true } = {}) {
  const item = new THREE.Mesh(geometry, material(color))
  item.position.set(x, y, z)
  item.rotation.x = rotationX
  item.castShadow = cast
  item.receiveShadow = true
  return item
}

function box(w, h, d, color, options) {
  return mesh(new THREE.BoxGeometry(w, h, d), color, options)
}

function screenPanel(width = 1.25, height = .72) {
  const group = new THREE.Group()
  const shell = box(width, height, .09, COLORS.panel, { y: .75 })
  const glass = box(width * .91, height * .84, .018, COLORS.ultra, { y: .75, z: .055 })
  glass.material.emissive = new THREE.Color(0x172c92)
  glass.material.emissiveIntensity = .7
  group.add(shell, glass)
  return group
}

function cameraLabel() {
  const canvas = document.createElement('canvas')
  canvas.width = 384
  canvas.height = 96
  const context = canvas.getContext('2d')
  context.fillStyle = 'rgba(7,11,26,.92)'
  context.beginPath()
  if (typeof context.roundRect === 'function') context.roundRect(4, 4, 376, 88, 34)
  else context.rect(4, 4, 376, 88)
  context.fill()
  context.strokeStyle = '#7a98ff'
  context.lineWidth = 4
  context.stroke()
  context.fillStyle = '#e8edff'
  context.font = '700 27px -apple-system, BlinkMacSystemFont, sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText('TRACKING CAMERA', 192, 49)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false })
  const sprite = new THREE.Sprite(spriteMaterial)
  sprite.position.set(0, .78, 0)
  sprite.scale.set(1.5, .375, 1)
  sprite.renderOrder = 100
  sprite.userData.labelTexture = texture
  sprite.userData.dimensionInvariant = true
  return sprite
}

function deviceModel(type) {
  const group = new THREE.Group()
  if (type === 'monitor') {
    const panel = screenPanel()
    group.add(panel, box(.1, .48, .1, COLORS.pale, { y: .35 }), box(.55, .06, .3, COLORS.edge, { y: .07 }))
  } else if (type === 'laptop') {
    group.add(box(1.1, .08, .75, COLORS.edge, { y: .06, z: .08 }))
    const display = screenPanel(1.05, .64)
    display.position.set(0, .02, -.29)
    display.rotation.x = -.14
    group.add(display)
  } else if (type === 'camera') {
    const body = box(.42, .22, .18, COLORS.panel, { y: .15 })
    const lens = mesh(new THREE.CylinderGeometry(.075, .075, .035, 24), COLORS.bright, { y: .15, z: .105 })
    lens.rotation.x = Math.PI / 2
    lens.material.emissive = new THREE.Color(COLORS.ultra)
    lens.material.emissiveIntensity = 1.6
    lens.material.depthTest = false
    lens.renderOrder = 90
    const beaconMaterial = new THREE.MeshBasicMaterial({ color: COLORS.bright, transparent: true, opacity: .82, depthTest: false })
    const beacon = new THREE.Mesh(new THREE.TorusGeometry(.25, .018, 10, 40), beaconMaterial)
    beacon.position.set(0, .15, .13)
    beacon.renderOrder = 90
    beacon.userData.dimensionInvariant = true
    const halo = new THREE.Mesh(new THREE.TorusGeometry(.34, .009, 8, 40), beaconMaterial.clone())
    halo.position.set(0, .15, .125)
    halo.material.opacity = .38
    halo.renderOrder = 89
    halo.userData.dimensionInvariant = true
    const label = cameraLabel()
    group.add(body, lens, beacon, halo, label, box(.16, .05, .14, COLORS.edge, { y: .025 }))
    for (const item of [beacon, halo, label]) {
      item.userData.basePosition = item.position.clone()
      item.userData.baseScale = item.scale.clone()
    }
  } else if (type === 'phone' || type === 'ipad') {
    const w = type === 'ipad' ? .66 : .32, d = type === 'ipad' ? .86 : .62
    group.add(box(w, .055, d, COLORS.panel, { y: .04 }))
    const glass = box(w * .88, .012, d * .9, type === 'phone' ? COLORS.danger : COLORS.ultra, { y: .076 })
    glass.material.emissive = new THREE.Color(type === 'phone' ? 0x711d36 : 0x172c92)
    glass.material.emissiveIntensity = .45
    group.add(glass)
  } else if (type === 'keyboard') {
    group.add(box(1.05, .08, .38, COLORS.panel, { y: .05 }))
    for (let row = 0; row < 4; row += 1) for (let col = 0; col < 11; col += 1) {
      group.add(box(.072, .018, .055, COLORS.edge, { x: -.42 + col * .085, y: .1, z: -.13 + row * .085, cast: false }))
    }
  } else if (type === 'mouse') {
    const mouse = mesh(new THREE.SphereGeometry(.2, 24, 16), COLORS.panel, { y: .1 })
    mouse.scale.set(.72, .55, 1.1)
    group.add(mouse)
  } else {
    const colors = { paper: 0xe8edff, notebook: COLORS.bright, book: 0xd5a951 }
    const height = type === 'book' ? .12 : .045
    group.add(box(.7, height, .88, colors[type] || COLORS.pale, { y: height / 2 }))
    if (type === 'notebook') group.add(box(.05, .07, .88, COLORS.panel, { x: -.31, y: .06 }))
  }
  group.traverse(child => {
    if (!child.isMesh) return
    child.userData.isWorkspaceMesh = true
    child.material.userData.baseEmissive = child.material.emissive?.getHex?.() || 0
    child.material.userData.baseEmissiveIntensity = child.material.emissiveIntensity || 0
  })
  return group
}

function scenePosition(object) {
  return {
    x: (object.scene?.x || 0) * 3.15,
    y: Math.max(-.15, Math.min(1.4, (object.scene?.y || 0) * .48)),
    z: ((object.scene?.z ?? .5) - .5) * 3.8,
  }
}

export default function Workspace3DScene({ objects, selectedId, view, onSelect, onMove }) {
  const hostRef = useRef(null)
  const runtimeRef = useRef(null)
  const [sceneError, setSceneError] = useState('')
  const callbacksRef = useRef({ onSelect, onMove })
  callbacksRef.current = { onSelect, onMove }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let renderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
    } catch (error) {
      console.error('[Workspace3DScene] WebGL unavailable', error)
      setSceneError('3D preview is unavailable on this device. Your workspace settings are still editable.')
      return
    }
    setSceneError('')
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(COLORS.ink)
    scene.fog = new THREE.FogExp2(COLORS.ink, .055)
    const camera = new THREE.PerspectiveCamera(38, 1, .1, 100)
    camera.position.set(6.4, 5.4, 7.2)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.12
    host.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = .075
    controls.minDistance = 4.5
    controls.maxDistance = 13
    controls.maxPolarAngle = Math.PI * .48
    controls.target.set(0, .35, 0)

    scene.add(new THREE.HemisphereLight(0x9bb0ff, 0x080b18, 2.1))
    const key = new THREE.DirectionalLight(0xb8c8ff, 4.2)
    key.position.set(-4, 8, 5)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.camera.left = -7; key.shadow.camera.right = 7; key.shadow.camera.top = 7; key.shadow.camera.bottom = -7
    scene.add(key)
    const rim = new THREE.PointLight(COLORS.ultra, 32, 14, 2)
    rim.position.set(4, 3, -3)
    scene.add(rim)

    const desk = box(7.3, .22, 4.7, COLORS.desk, { y: -.18 })
    desk.material.roughness = .34
    desk.material.metalness = .12
    scene.add(desk)
    const deskEdge = box(7.38, .045, 4.78, COLORS.edge, { y: -.055 })
    deskEdge.material.emissive = new THREE.Color(0x102265)
    deskEdge.material.emissiveIntensity = .6
    scene.add(deskEdge)
    for (const x of [-3.15, 3.15]) for (const z of [-1.85, 1.85]) scene.add(box(.18, 2.3, .18, COLORS.surface, { x, y: -1.4, z }))
    const userMarker = new THREE.Group()
    const userRing = mesh(new THREE.RingGeometry(.42, .5, 48), COLORS.ultra, { y: -.03, rotationX: -Math.PI / 2, cast: false })
    userRing.material.emissive = new THREE.Color(COLORS.ultra)
    userRing.material.emissiveIntensity = 1.4
    const userHead = mesh(new THREE.SphereGeometry(.17, 24, 18), COLORS.bright, { y: .55 })
    const userShoulders = mesh(new THREE.SphereGeometry(.38, 24, 18), COLORS.panel, { y: .17 })
    userShoulders.scale.set(1.25, .55, .7)
    userMarker.add(userRing, userHead, userShoulders)
    userMarker.position.z = 3.05
    scene.add(userMarker)
    const floor = mesh(new THREE.PlaneGeometry(30, 30), 0x050713, { y: -2.56, rotationX: -Math.PI / 2, cast: false })
    scene.add(floor)
    const grid = new THREE.GridHelper(22, 44, COLORS.edge, 0x111936)
    grid.position.y = -2.54
    grid.material.opacity = .22
    grid.material.transparent = true
    scene.add(grid)

    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    let draggingId = null
    let desiredCamera = null
    const objectGroups = new Map()

    const pointerFor = event => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
    }
    const pointerDown = event => {
      pointerFor(event)
      const hits = raycaster.intersectObjects([...objectGroups.values()], true)
      const id = hits[0]?.object?.userData?.objectId
      callbacksRef.current.onSelect?.(id || null)
      if (id) {
        draggingId = id
        controls.enabled = false
        renderer.domElement.setPointerCapture?.(event.pointerId)
      }
    }
    const pointerMove = event => {
      if (!draggingId) return
      pointerFor(event)
      const point = new THREE.Vector3()
      if (!raycaster.ray.intersectPlane(dragPlane, point)) return
      callbacksRef.current.onMove?.(draggingId, {
        x: Math.max(-1, Math.min(1, point.x / 3.15)),
        z: Math.max(0, Math.min(1, point.z / 3.8 + .5)),
      })
    }
    const pointerUp = event => {
      draggingId = null
      controls.enabled = true
      renderer.domElement.releasePointerCapture?.(event.pointerId)
    }
    const contextLost = event => {
      event.preventDefault()
      setSceneError('The 3D preview stopped responding. Your workspace settings are still editable.')
    }
    renderer.domElement.addEventListener('pointerdown', pointerDown)
    renderer.domElement.addEventListener('pointermove', pointerMove)
    renderer.domElement.addEventListener('pointerup', pointerUp)
    renderer.domElement.addEventListener('webglcontextlost', contextLost)

    const resize = () => {
      const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height, false)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()
    let frame = 0
    const animate = () => {
      frame = requestAnimationFrame(animate)
      if (desiredCamera) {
        camera.position.lerp(desiredCamera, .085)
        if (camera.position.distanceTo(desiredCamera) < .035) desiredCamera = null
      }
      controls.update()
      renderer.render(scene, camera)
    }
    animate()
    runtimeRef.current = { scene, camera, controls, renderer, objectGroups, setDesiredCamera: value => { desiredCamera = value } }
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      renderer.domElement.removeEventListener('pointerdown', pointerDown)
      renderer.domElement.removeEventListener('pointermove', pointerMove)
      renderer.domElement.removeEventListener('pointerup', pointerUp)
      renderer.domElement.removeEventListener('webglcontextlost', contextLost)
      controls.dispose()
      renderer.dispose()
      renderer.domElement.remove()
      scene.traverse(item => {
        item.geometry?.dispose?.()
        if (Array.isArray(item.material)) item.material.forEach(entry => { entry.map?.dispose?.(); entry.dispose?.() })
        else { item.material?.map?.dispose?.(); item.material?.dispose?.() }
      })
      runtimeRef.current = null
    }
  }, [])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    const liveIds = new Set(objects.map(object => object.id))
    for (const [id, group] of runtime.objectGroups) {
      if (liveIds.has(id)) continue
      runtime.scene.remove(group)
      group.traverse(child => { child.geometry?.dispose?.(); child.material?.map?.dispose?.(); child.material?.dispose?.() })
      runtime.objectGroups.delete(id)
    }
    for (const object of objects) {
      let group = runtime.objectGroups.get(object.id)
      if (!group) {
        group = deviceModel(object.type)
        group.userData.objectId = object.id
        group.traverse(child => { child.userData.objectId = object.id })
        runtime.objectGroups.set(object.id, group)
        runtime.scene.add(group)
      }
      const position = scenePosition(object)
      group.position.set(position.x, position.y, position.z)
      group.rotation.y = THREE.MathUtils.degToRad(-(object.scene?.rotation || 0))
      const scale = object.scene?.scale || 1
      const dimensions = object.dimensions || {}
      group.scale.set(
        scale * (dimensions.width || 1),
        scale * (dimensions.height || 1),
        scale * (dimensions.depth || 1),
      )
      group.traverse(child => {
        if (!child.userData.dimensionInvariant) return
        const basePosition = child.userData.basePosition
        const baseScale = child.userData.baseScale
        child.position.set(
          basePosition.x / (dimensions.width || 1),
          basePosition.y / (dimensions.height || 1),
          basePosition.z / (dimensions.depth || 1),
        )
        child.scale.set(
          baseScale.x / (dimensions.width || 1),
          baseScale.y / (dimensions.height || 1),
          baseScale.z / (dimensions.depth || 1),
        )
      })
      group.traverse(child => {
        if (!child.isMesh || !child.material?.emissive) return
        if (object.id === selectedId) {
          child.material.emissive.setHex(child.material.userData.baseEmissive || 0x172c92)
          child.material.emissiveIntensity = Math.max(child.material.userData.baseEmissiveIntensity || 0, .55)
        } else {
          child.material.emissive.setHex(child.material.userData.baseEmissive || 0)
          child.material.emissiveIntensity = child.material.userData.baseEmissiveIntensity || 0
        }
      })
    }
  }, [objects, selectedId])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    const positions = {
      iso: new THREE.Vector3(6.4, 5.4, 7.2),
      top: new THREE.Vector3(0, 10.8, .01),
      front: new THREE.Vector3(0, 3.2, 10.2),
    }
    runtime.controls.target.set(0, .25, 0)
    runtime.setDesiredCamera(positions[view] || positions.iso)
  }, [view])

  return <div ref={hostRef} className="workspace-3d-host" aria-label="Interactive 3D workspace editor">
    {sceneError && <div className="workspace-3d-error" role="status">{sceneError}</div>}
  </div>
}
