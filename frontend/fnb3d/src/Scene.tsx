/**
 * The dining room as an isometric 3D scene.
 *
 * Lives in its own Vite micro-app (frontend/fnb3d) and is embedded by the Next app through an
 * iframe. Not for bundle size: @react-three/fiber augments JSX.IntrinsicElements globally, and
 * with it in the Next program every MUI polymorphic component tripped TS2590. Keeping three.js
 * in a separate TypeScript program is the only clean cure.
 *
 * Tables are extruded blocks on a to-scale floor, coloured by what is happening at them, with a
 * slow breathing pulse on any table whose food is ready and going cold. Tapping a table hands
 * control back to the page; the camera nudges toward it so the eye follows.
 *
 * Deliberately light: a couple of lights, flat-shaded meshes, no post-processing, no shadows
 * beyond a contact blob — this has to run at 60 fps on a cheap Android tablet all afternoon.
 * The page swaps in the 2D plan when WebGL is missing or the frame rate collapses.
 */

import { OrthographicCamera, RoundedBox, Text } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { STATUS_COLOR, zoneBoxes, type FloorData, type Table, type TableStatus } from './floor';

export interface FloorPlanProps {
  floor: FloorData;
  statusOf: (tableId: string) => TableStatus;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Reported once a second so the host can fall back to 2D when this device cannot keep up. */
  onFps?: (fps: number) => void;
}

/** Scene units are metres; the floor's centre sits at the origin, so this is its top-left corner. */
type Origin = { ox: number; oz: number };
const originOf = (floor: FloorData): Origin => ({ ox: -floor.width / 2, oz: -floor.depth / 2 });

function TableMesh({ table, status, selected, onSelect, origin: { ox, oz } }: { table: Table; status: TableStatus; selected: boolean; onSelect: () => void; origin: Origin }) {
  const group = useRef<THREE.Group>(null);
  const [hover, setHover] = useState(false);
  const color = STATUS_COLOR[status];
  const size: [number, number, number] = table.shape === 'long' ? [1.8, 0.75, 0.9] : table.shape === 'square' ? [0.9, 0.75, 0.9] : [0.8, 0.75, 0.8];

  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    // food waiting on the pass breathes; a selected table stands a little taller
    const pulse = status === 'ready' ? 1 + Math.sin(clock.elapsedTime * 4) * 0.04 : 1;
    const lift = selected ? 0.12 : hover ? 0.05 : 0;
    g.scale.setScalar(pulse);
    g.position.y = THREE.MathUtils.lerp(g.position.y, lift, 0.2);
  });

  return (
    <group position={[ox + table.x, 0, oz + table.y]}>
      <group ref={group} rotation={[0, ((table.rotation ?? 0) * Math.PI) / 180, 0]}>
        {table.shape === 'round' ? (
          <mesh position={[0, size[1] / 2, 0]} onClick={onSelect} onPointerOver={() => setHover(true)} onPointerOut={() => setHover(false)}>
            <cylinderGeometry args={[size[0] / 2, size[0] / 2, size[1], 32]} />
            <meshStandardMaterial color={color} roughness={0.55} metalness={0.05} emissive={color} emissiveIntensity={selected ? 0.35 : hover ? 0.2 : 0.08} />
          </mesh>
        ) : (
          <RoundedBox args={size} radius={0.08} smoothness={3} position={[0, size[1] / 2, 0]} onClick={onSelect} onPointerOver={() => setHover(true)} onPointerOut={() => setHover(false)}>
            <meshStandardMaterial color={color} roughness={0.55} metalness={0.05} emissive={color} emissiveIntensity={selected ? 0.35 : hover ? 0.2 : 0.08} />
          </RoundedBox>
        )}
        {/* contact shadow: a dark disc is cheaper than a shadow map and reads just as well */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
          <circleGeometry args={[Math.max(size[0], size[2]) * 0.62, 24]} />
          <meshBasicMaterial color="#000" transparent opacity={0.22} />
        </mesh>
        <Text position={[0, size[1] + 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.34} color="#fff" anchorX="center" anchorY="middle" outlineWidth={0.02} outlineColor="rgba(0,0,0,0.6)">
          {table.name}
        </Text>
      </group>
      {/* seat count as in-scene text, not a drei <Html> badge: under an orthographic camera Html's
          distance scaling blows the badge up to cover the whole floor, and DOM overlays cost more
          than a few glyphs on a tablet anyway */}
      <Text position={[0, size[1] + 0.05, 0.28]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.16} color="rgba(255,255,255,0.75)" anchorX="center" anchorY="middle">
        {`${table.seats} seats`}
      </Text>
    </group>
  );
}

function ZoneFloor({ floor }: { floor: FloorData }) {
  const { ox, oz } = originOf(floor);
  // each zone is a patch of floor a metre round its tables, so a moved table moves its zone with it
  const parts = useMemo(() => zoneBoxes(floor), [floor]);
  return (
    <group>
      {/* the room itself */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <planeGeometry args={[floor.width, floor.depth]} />
        <meshStandardMaterial color="#141d2b" roughness={1} />
      </mesh>
      {parts.map((p) => (
        <group key={p.zone.id}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[ox + p.x + p.w / 2, 0, oz + p.y + p.d / 2]}>
            <planeGeometry args={[p.w - 0.04, p.d - 0.04]} />
            <meshStandardMaterial color={p.zone.color} roughness={0.95} />
          </mesh>
          <Text position={[ox + p.x + 0.25, 0.01, oz + p.y + 0.35]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.28} color="rgba(255,255,255,0.55)" anchorX="left" anchorY="top">
            {p.zone.name}
          </Text>
        </group>
      ))}
      {/* a low wall along the back edge gives the room a sense of depth */}
      <mesh position={[0, 0.25, oz - 0.1]}>
        <boxGeometry args={[floor.width + 0.4, 0.5, 0.2]} />
        <meshStandardMaterial color="#1a2432" roughness={0.9} />
      </mesh>
    </group>
  );
}

/** Eases the camera toward the selected table; leaves it alone otherwise. */
function CameraRig({ target }: { target: THREE.Vector3 | null }) {
  const { camera } = useThree();
  const look = useRef(new THREE.Vector3(0, 0, 0));
  useFrame(() => {
    const want = target ?? new THREE.Vector3(0, 0, 0);
    look.current.lerp(want, 0.08);
    camera.position.set(look.current.x + 10, 12, look.current.z + 10);
    camera.lookAt(look.current);
  });
  return null;
}

/** With ?debug=1 the r3f store is put on window for support tooling and for the e2e probes. */
function DebugExpose() {
  const get = useThree((s) => s.get);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('debug') === '1') {
      (window as unknown as { __r3f?: unknown }).__r3f = get;
    }
  }, [get]);
  return null;
}

function FpsProbe({ onFps }: { onFps?: (fps: number) => void }) {
  const frames = useRef(0);
  const last = useRef(performance.now());
  useFrame(() => {
    frames.current += 1;
    const now = performance.now();
    if (now - last.current >= 1000) {
      onFps?.((frames.current * 1000) / (now - last.current));
      frames.current = 0;
      last.current = now;
    }
  });
  return null;
}

export default function FloorPlan3D({ floor, statusOf, selectedId, onSelect, onFps }: FloorPlanProps) {
  const origin = useMemo(() => originOf(floor), [floor]);
  const target = useMemo(() => {
    const tb = selectedId ? floor.tables.find((t) => t.id === selectedId) : null;
    return tb ? new THREE.Vector3(origin.ox + tb.x, 0, origin.oz + tb.y) : null;
  }, [selectedId, floor, origin]);

  // preserveDrawingBuffer: the host can screenshot or print the plan and the frame survives a
  // readPixels — cheap for a scene this small
  return (
    <Canvas dpr={[1, 1.5]} gl={{ antialias: true, powerPreference: 'low-power', preserveDrawingBuffer: true }} style={{ width: '100%', height: '100%' }} data-testid="floor-3d">
      <color attach="background" args={['#0b1220']} />
      <OrthographicCamera makeDefault zoom={48} position={[10, 12, 10]} near={0.1} far={100} />
      <ambientLight intensity={0.75} />
      <directionalLight position={[6, 10, 4]} intensity={1.1} />
      <ZoneFloor floor={floor} />
      {floor.tables.map((tb) => (
        <TableMesh key={tb.id} table={tb} status={statusOf(tb.id)} selected={tb.id === selectedId} onSelect={() => onSelect(tb.id)} origin={origin} />
      ))}
      <CameraRig target={target} />
      <FpsProbe onFps={onFps} />
      <DebugExpose />
    </Canvas>
  );
}
