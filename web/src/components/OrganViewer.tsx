import { Bounds, Environment, Lightformer, OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { Suspense, useMemo, useState } from 'react'
import * as THREE from 'three'
import type { Organ } from '../store'
import { useOrganGeometry } from './Scene'

function ViewerMesh({ o, ghost }: { o: Organ; ghost: boolean }) {
  const geo = useOrganGeometry(o.url)
  const mat = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(o.color),
        roughness: o.system === 'skeletal' ? 0.6 : 0.42,
        clearcoat: o.system === 'skeletal' ? 0.1 : 0.55,
        clearcoatRoughness: 0.35,
        sheen: 0.6,
        sheenColor: new THREE.Color('#ffffff'),
        transparent: ghost,
        opacity: ghost ? 0.38 : 1,
        depthWrite: !ghost,
        emissive: new THREE.Color(o.finding ? '#ff3b30' : '#000000'),
        emissiveIntensity: o.finding ? 0.45 : 0,
      }),
    [o.color, o.system, o.finding, ghost],
  )
  return <mesh geometry={geo} material={mat} position={o.position} renderOrder={o.finding ? 2 : 1} />
}

/** Small, self-contained interactive 3D view of one or more structures, in their true relative positions. */
export default function OrganViewer({ organs, height = 260 }: { organs: Organ[]; height?: number }) {
  const [touched, setTouched] = useState(false)
  const hasFinding = organs.some((o) => o.finding)
  return (
    <div style={{ position: 'relative', height, borderRadius: 16, overflow: 'hidden', border: '1px solid var(--line)', background: 'radial-gradient(600px 300px at 50% 40%, #fff, #efeee9)' }} onPointerDown={() => setTouched(true)}>
      <Canvas dpr={[1, 2]} gl={{ preserveDrawingBuffer: true, antialias: true, alpha: true }} camera={{ position: [0, 0.4, 5], fov: 30 }}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[3, 5, 4]} intensity={1.5} />
        <directionalLight position={[-4, 1, -3]} intensity={0.5} color="#dbe6ff" />
        <Environment resolution={128}>
          <Lightformer form="rect" intensity={3} position={[0, 5, 4]} scale={[10, 4, 1]} />
          <Lightformer form="rect" intensity={1.4} position={[-6, 1, 2]} rotation-y={Math.PI / 2} scale={[8, 3, 1]} />
        </Environment>
        <Suspense fallback={null}>
          <Bounds fit clip observe margin={1.7}>
            <group>
              {organs.map((o) => (
                <ViewerMesh key={o.id} o={o} ghost={hasFinding && !o.finding && o.name === 'liver'} />
              ))}
            </group>
          </Bounds>
        </Suspense>
        <OrbitControls makeDefault enableDamping autoRotate={!touched} autoRotateSpeed={1.2} />
      </Canvas>
      <div className="no-print muted" style={{ position: 'absolute', left: 12, bottom: 8, fontSize: 11, pointerEvents: 'none' }}>Drag to rotate · scroll to zoom</div>
    </div>
  )
}
