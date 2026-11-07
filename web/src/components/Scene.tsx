import { Billboard, CameraControls, ContactShadows, Environment, Html, Lightformer, useGLTF } from '@react-three/drei'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { EffectComposer, N8AO, SMAA } from '@react-three/postprocessing'
import { Suspense, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { organColor } from '../palette'
import { useStore, type Organ } from '../store'

const tmpV = new THREE.Vector3()
const RADII = new Map<number, number>()
// live world positions of finding markers, for screen-space picking through their host organ
const FINDING_POS = new Map<number, THREE.Vector3>()
const tmpV2 = new THREE.Vector3()

export function useOrganGeometry(url: string) {
  const { scene } = useGLTF(url)
  return useMemo(() => {
    let g: THREE.BufferGeometry | null = null
    scene.traverse((c) => {
      if (!g && (c as THREE.Mesh).isMesh) g = (c as THREE.Mesh).geometry
    })
    const geo = (g as THREE.BufferGeometry | null)?.clone() ?? new THREE.BufferGeometry()
    geo.deleteAttribute('color')
    geo.computeVertexNormals()
    geo.computeBoundingSphere()
    return geo
  }, [scene])
}

function OrganMesh({ o, isoIndex, isoCount }: { o: Organ; isoIndex: number; isoCount: number }) {
  const geo = useOrganGeometry(o.url)
  RADII.set(o.id, geo.boundingSphere?.radius ?? 0.3)
  const group = useRef<THREE.Group>(null!)
  const mat = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(organColor(o.name, o.color)),
        roughness: o.system === 'skeletal' ? 0.62 : 0.42,
        metalness: 0,
        clearcoat: o.system === 'skeletal' ? 0.1 : 0.55,
        clearcoatRoughness: 0.35,
        sheen: 0.6,
        sheenRoughness: 0.5,
        sheenColor: new THREE.Color('#ffffff'),
        transparent: true,
        emissive: new THREE.Color(o.finding ? '#ff3b30' : '#2f5bff'),
        emissiveIntensity: 0,
      }),
    [o.color, o.system, o.finding],
  )
  const born = useRef(performance.now())
  const drag = useRef<{ plane: THREE.Plane; start: THREE.Vector3; startOff: THREE.Vector3; sx: number; sy: number; moved: boolean } | null>(null)
  const { camera, size } = useThree()
  const nearFinding = (e: ThreeEvent<PointerEvent | MouseEvent>): number | null => {
    if (o.finding || useStore.getState().hiddenSystems.includes('lesion')) return null
    for (const [fid, wp] of FINDING_POS) {
      const p = wp.clone().project(camera)
      const dx = ((p.x - e.pointer.x) * size.width) / 2
      const dy = ((p.y - e.pointer.y) * size.height) / 2
      if (Math.hypot(dx, dy) < 24 && p.z < 1) return fid
    }
    return null
  }
  const base = useMemo(() => new THREE.Vector3(...o.position), [o.position])

  useFrame((state, dt) => {
    const s = useStore.getState()
    const g = group.current
    if (!g) return
    const selected = s.selected.includes(o.id)
    const anySel = s.selected.length > 0
    const hidden = (s.hiddenSystems.includes(o.system) || s.hiddenIds.includes(o.id)) && !selected
    const off = s.offsets[o.id] ?? [0, 0, 0]
    // target position
    if (s.isolate && selected) {
      const spread = (isoIndex - (isoCount - 1) / 2) * 1.1
      tmpV.set(spread, 0, 0)
    } else {
      tmpV.copy(base).multiplyScalar(1 + s.explode * 1.4)
      tmpV.add(tmpV2.set(off[0], off[1], off[2]))
    }
    const k = 1 - Math.exp(-dt * (drag.current ? 30 : 7))
    g.position.lerp(tmpV, k)
    // appear animation
    const age = (performance.now() - born.current) / 700
    const sc = age >= 1 ? 1 : 1 - Math.pow(1 - age, 3) * 0.6
    const sTarget = s.isolate && selected ? 1.6 / Math.max(1, isoCount * 0.6) : 1
    const cur = g.scale.x
    g.scale.setScalar(THREE.MathUtils.lerp(cur, sTarget * sc, age >= 1 ? k : 1))
    // opacity
    let op = 1
    if (hidden) op = 0
    else if (s.isolate && !selected) op = 0
    else if (anySel && !selected) op = s.selected.some((id) => s.organs[id]?.finding) && o.name === 'liver' ? 0.28 : 0.1
    else if (o.name === 'liver' && s.findings.length) op = 0.42 // let the finding glow through
    op *= Math.min(1, age)
    mat.opacity = THREE.MathUtils.lerp(mat.opacity, op, k)
    mat.depthWrite = mat.opacity > 0.9
    g.visible = mat.opacity > 0.01
    // hover / selection glow; findings breathe
    const hov = s.hovered === o.id
    const flagged = o.finding && s.lesionFlagged
    const glow = o.finding ? (flagged ? 0.55 : 0.25) + 0.25 * Math.sin(state.clock.elapsedTime * 3) : hov ? 0.18 : selected ? 0.08 : 0
    mat.emissiveIntensity = THREE.MathUtils.lerp(mat.emissiveIntensity, glow, k)
  })

  // a finding sits inside its organ: let clicks pass through the organ to the finding marker
  const defer = (e: ThreeEvent<PointerEvent | MouseEvent>) =>
    !o.finding && e.intersections.some((i) => i.object.userData?.finding && i.object.visible)
  const onDown = (e: ThreeEvent<PointerEvent>) => {
    if (useStore.getState().isolate && !useStore.getState().selected.includes(o.id)) return
    const fid = nearFinding(e)
    if (fid !== null) {
      e.stopPropagation()
      useStore.setState({ selected: [fid], isolate: false })
      return
    }
    if (defer(e)) return
    e.stopPropagation()
    ;(e.target as any).setPointerCapture?.(e.pointerId)
    const n = camera.getWorldDirection(new THREE.Vector3()).negate()
    const p = group.current.getWorldPosition(new THREE.Vector3())
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, p)
    const start = new THREE.Vector3()
    e.ray.intersectPlane(plane, start)
    const off = useStore.getState().offsets[o.id] ?? [0, 0, 0]
    drag.current = { plane, start, startOff: new THREE.Vector3(...off), sx: e.clientX, sy: e.clientY, moved: false }
  }
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current
    if (!d) return
    e.stopPropagation()
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 4) {
      d.moved = true
      useStore.setState({ dragging: true })
      document.body.style.cursor = 'grabbing'
    }
    if (!d.moved) return
    const hit = new THREE.Vector3()
    if (e.ray.intersectPlane(d.plane, hit)) {
      const scale = 1 + useStore.getState().explode * 1.4
      hit.sub(d.start).divideScalar(1).add(d.startOff)
      void scale
      useStore.getState().setOffset(o.id, [hit.x, hit.y, hit.z])
    }
  }
  const onUp = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current
    drag.current = null
    ;(e.target as any).releasePointerCapture?.(e.pointerId)
    useStore.setState({ dragging: false })
    document.body.style.cursor = useStore.getState().hovered === o.id ? 'grab' : 'auto'
    if (d && !d.moved) useStore.getState().select(o.id, e.shiftKey || e.metaKey)
  }

  return (
    <group ref={group} position={base.toArray()}>
      <mesh
        geometry={geo}
        material={mat}
        castShadow
        receiveShadow
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        userData={{ finding: !!o.finding }}
        onDoubleClick={(e) => {
          if (defer(e)) return
          e.stopPropagation()
          useStore.setState({ selected: [o.id], isolate: true })
        }}
        onPointerOver={(e) => {
          if (defer(e)) return
          e.stopPropagation()
          const s = useStore.getState()
          if (s.hiddenSystems.includes(o.system) || s.hiddenIds.includes(o.id) || (s.selected.length && !s.selected.includes(o.id))) return
          useStore.setState({ hovered: o.id })
          document.body.style.cursor = 'grab'
        }}
        onPointerOut={() => {
          if (useStore.getState().hovered === o.id) useStore.setState({ hovered: undefined })
          if (!drag.current) document.body.style.cursor = 'auto'
        }}
      />
      <HoverLabel o={o} r={geo.boundingSphere?.radius ?? 0.2} />
      {o.finding && <FindingMarker id={o.id} />}
    </group>
  )
}

function FindingMarker({ id }: { id: number }) {
  const ring = useRef<THREE.Mesh>(null!)
  const anchor = useRef<THREE.Group>(null!)
  const pick = {
    userData: { finding: true },
    onPointerDown: (e: ThreeEvent<PointerEvent>) => e.stopPropagation(),
    onClick: (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation()
      useStore.setState({ selected: [id], isolate: false })
    },
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation()
      useStore.setState({ hovered: id })
      document.body.style.cursor = 'pointer'
    },
    onPointerOut: () => {
      if (useStore.getState().hovered === id) useStore.setState({ hovered: undefined })
      document.body.style.cursor = 'auto'
    },
  }
  const ring2 = useRef<THREE.Mesh>(null!)
  useEffect(() => () => void FINDING_POS.delete(id), [id])
  useFrame((st) => {
    if (anchor.current) {
      FINDING_POS.set(id, anchor.current.getWorldPosition(FINDING_POS.get(id) ?? new THREE.Vector3()))
      // once you're looking at the finding itself, the beacon is no longer needed
      anchor.current.visible = !useStore.getState().selected.includes(id)
    }
    const t = st.clock.elapsedTime
    const flagged = useStore.getState().lesionFlagged
    for (const [m, ph] of [[ring.current, 0], [ring2.current, 0.5]] as const) {
      if (!m) continue
      const k = ((t * 0.8 + ph) % 1)
      m.scale.setScalar(0.6 + k * 1.6)
      ;(m.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.9
      ;(m.material as THREE.MeshBasicMaterial).color.set(flagged ? '#18a058' : '#ff3b30')
    }
  })
  return (
    <group ref={anchor}>
    <Billboard>
      <mesh ref={ring} renderOrder={10}>
        <ringGeometry args={[0.09, 0.105, 64]} />
        <meshBasicMaterial color="#ff3b30" transparent depthTest={false} />
      </mesh>
      <mesh ref={ring2} renderOrder={10}>
        <ringGeometry args={[0.09, 0.105, 64]} />
        <meshBasicMaterial color="#ff3b30" transparent depthTest={false} />
      </mesh>
      <mesh renderOrder={11}>
        <circleGeometry args={[0.028, 32]} />
        <meshBasicMaterial color="#ff3b30" depthTest={false} />
      </mesh>
      {/* generous invisible hit target so an 8 mm finding is easy to click */}
      <mesh {...pick} renderOrder={12}>
        <circleGeometry args={[0.13, 32]} />
        <meshBasicMaterial transparent opacity={0} depthTest={false} depthWrite={false} />
      </mesh>
    </Billboard>
    </group>
  )
}

function HoverLabel({ o, r }: { o: Organ; r: number }) {
  const hovered = useStore((s) => s.hovered === o.id)
  const dragging = useStore((s) => s.dragging)
  if (!hovered || dragging) return null
  return (
    <Html position={[0, r * 0.9, 0]} center style={{ pointerEvents: 'none' }} zIndexRange={[20, 0]}>
      <div className="glass" style={{ padding: '6px 10px', borderRadius: 999, whiteSpace: 'nowrap', fontSize: 12, fontWeight: 500, display: 'flex', gap: 8, alignItems: 'center', transform: 'translateY(-18px)' }}>
        <span className="dot" style={{ background: o.color }} />
        {o.label}
        <span className="muted mono" style={{ fontSize: 11 }}>{o.volume_ml} mL</span>
      </div>
    </Html>
  )
}

const CONTROLS: { current: CameraControls | null } = { current: null }

export type Shot = { key: string; title: string; caption: string; url: string }
type View = { key: string; title: string; caption: string; hidden: string[]; selected?: number[]; camera?: [number, number, number, number, number, number] }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Report snapshots: drive the real scene through a few views and grab frames from the WebGL canvas. */
export const capture: { run?: () => Promise<Shot[]> } = {}

function Capturer() {
  const { gl, scene, camera } = useThree()
  useEffect(() => {
    capture.run = async () => {
      const st = useStore.getState()
      const saved = { selected: st.selected, isolate: st.isolate, hiddenSystems: st.hiddenSystems, explode: st.explode, spin: st.spin, offsets: st.offsets }
      const findings = Object.values(st.organs).filter((o) => o.finding)
      const views: View[] = [
        { key: 'overview', title: 'Whole scan', caption: 'Every segmented structure in its true position (muscles hidden).', hidden: ['muscular'], camera: [0, 0.6, 8.6, 0, 0.15, 0] },
        { key: 'organs', title: 'Organs and vessels', caption: 'Bowel, bone and muscle hidden to show the solid organs and major vessels.', hidden: ['muscular', 'digestive', 'skeletal'], camera: [0, 0.8, 7.6, 0, 0.45, 0] },
        { key: 'side', title: 'Side view', caption: 'Seen from the patient’s right side.', hidden: ['muscular', 'digestive'], camera: [-8.2, 0.8, 1.2, 0, 0.2, 0] },
        ...findings.map((f) => ({ key: `finding-${f.id}`, title: f.label, caption: 'Close-up of the finding inside the see-through liver.', hidden: ['muscular'], selected: [f.id] })),
      ]
      const shots: Shot[] = []
      for (const v of views) {
        useStore.setState({ spin: false, isolate: false, explode: 0, offsets: {}, hiddenSystems: v.hidden, selected: v.selected ?? [] })
        await sleep(120) // let the camera rig react to the selection
        if (v.camera) await CONTROLS.current?.setLookAt(...v.camera, false)
        await sleep(1500) // opacity / position easing settles
        gl.render(scene, camera)
        const src = gl.domElement
        const w = 1400
        const h = Math.round((src.height / src.width) * w)
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        const ctx = c.getContext('2d')!
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, w, h)
        ctx.drawImage(src, 0, 0, w, h)
        shots.push({ key: v.key, title: v.title, caption: v.caption, url: c.toDataURL('image/jpeg', 0.88) })
      }
      useStore.setState(saved)
      return shots
    }
    return () => {
      capture.run = undefined
    }
  }, [gl, scene, camera])
  return null
}

function Rig() {
  const ref = useRef<CameraControls>(null!)
  useEffect(() => {
    CONTROLS.current = ref.current
  })
  const selected = useStore((s) => s.selected)
  const isolate = useStore((s) => s.isolate)
  const dragging = useStore((s) => s.dragging)
  const tick = useStore((s) => s.assembleTick)
  const organs = useStore((s) => s.organs)
  const stage = useStore((s) => s.stage)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    if (isolate && selected.length) {
      const n = selected.length
      const scale = 1.6 / Math.max(1, n * 0.6)
      const maxR = Math.max(...selected.map((id) => RADII.get(id) ?? 0.3)) * scale
      c.setLookAt(0, 0.15, 5, 0, 0, 0, false)
      c.fitToSphere(new THREE.Sphere(new THREE.Vector3(), Math.max(0.12, maxR * 1.3 + ((n - 1) * 1.1) / 2)), true)
    } else if (selected.length) {
      const box = new THREE.Box3()
      const off = useStore.getState().offsets
      for (const id of selected) {
        const o = organs[id]
        if (!o) continue
        const p = new THREE.Vector3(...o.position).multiplyScalar(1 + useStore.getState().explode * 1.4)
        if (off[id]) p.add(new THREE.Vector3(...off[id]))
        const r = RADII.get(id) ?? 0.3
        box.expandByPoint(p.clone().addScalar(r)).expandByPoint(p.clone().addScalar(-r))
      }
      const sphere = box.getBoundingSphere(new THREE.Sphere())
      sphere.radius = Math.max(sphere.radius * 1.35, 0.35)
      // keep the current viewing direction, shift target right so the inspector panel doesn't cover it
      c.fitToSphere(sphere, true)
    } else {
      c.setLookAt(0, 0.9, 11.5, 0, 0.1, 0, true)
    }
  }, [selected, isolate, tick, stage]) // eslint-disable-line react-hooks/exhaustive-deps
  const touched = useRef(false)
  useFrame((_, dt) => {
    const s = useStore.getState()
    if (s.spin && !s.dragging) ref.current?.rotate(dt * 0.25, 0, false)
    else if (s.stage === 'building' && !s.selected.length && !touched.current) ref.current?.rotate(dt * 0.12, 0, false)
  })
  return (
    <CameraControls
      ref={ref}
      makeDefault
      enabled={!dragging}
      smoothTime={0.45}
      minDistance={0.6}
      maxDistance={22}
      onStart={() => {
        // the user grabbed the camera: stop any automatic motion
        touched.current = true
        if (useStore.getState().spin) useStore.setState({ spin: false })
      }}
    />
  )
}

function Organs() {
  const organs = useStore((s) => s.organs)
  const selected = useStore((s) => s.selected)
  const list = Object.values(organs)
  return (
    <>
      {list.map((o) => (
        <Suspense key={o.id} fallback={null}>
          <OrganMesh o={o} isoIndex={Math.max(0, selected.indexOf(o.id))} isoCount={selected.length} />
        </Suspense>
      ))}
    </>
  )
}

export default function Scene() {
  const clear = useStore((s) => s.clearSelection)
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      gl={{ antialias: false, alpha: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
      camera={{ position: [0, 0.9, 11.5], fov: 30, near: 0.05, far: 80 }}
      onPointerMissed={(e) => {
        if (e.type === 'click' && !useStore.getState().dragging) clear()
      }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <ambientLight intensity={0.55} />
      <directionalLight position={[3, 6, 5]} intensity={1.6} castShadow shadow-mapSize={[1024, 1024]} shadow-bias={-0.0004} />
      <directionalLight position={[-5, 2, -3]} intensity={0.5} color="#dbe6ff" />
      <Environment resolution={256}>
        <Lightformer form="rect" intensity={3} position={[0, 5, 4]} scale={[10, 4, 1]} />
        <Lightformer form="rect" intensity={1.5} position={[-6, 1, 2]} rotation-y={Math.PI / 2} scale={[8, 3, 1]} color="#eef3ff" />
        <Lightformer form="rect" intensity={1.2} position={[6, 1, 2]} rotation-y={-Math.PI / 2} scale={[8, 3, 1]} color="#fff3ea" />
        <Lightformer form="ring" intensity={2} position={[0, -4, 6]} scale={3} />
      </Environment>
      <Organs />
      <ContactShadows position={[0, -2.05, 0]} opacity={0.28} scale={40} blur={3.2} far={6} resolution={1024} color="#3a3020" />
      <Rig />
      <Capturer />
      <EffectComposer multisampling={0}>
        <N8AO aoRadius={0.35} intensity={1.6} distanceFalloff={0.6} halfRes />
        <SMAA />
      </EffectComposer>
    </Canvas>
  )
}
