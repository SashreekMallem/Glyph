"use client";

/**
 * `<GridField>` — ambient 3D backdrop: a perspective plane of subtle
 * grid lines that gently parallaxes on scroll/cursor. Used behind hero
 * sections. Intentionally cheap (two planes, no post-processing) so it
 * never costs more than a couple of draw calls.
 */

import { Canvas, useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Mesh } from "three";

function Plane({ y = 0, color = "#6366f1", rot = 0 }: { y?: number; color?: string; rot?: number }) {
  const ref = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.position.x = Math.sin(clock.elapsedTime * 0.15) * 0.3;
    }
  });
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2.4 + rot, 0, 0]} position={[0, y, -4]}>
      <planeGeometry args={[18, 12, 40, 30]} />
      <meshBasicMaterial color={color} wireframe opacity={0.18} transparent />
    </mesh>
  );
}

export function GridField({ className, tint = "#6366f1" }: { className?: string; tint?: string }) {
  return (
    <div className={className} aria-hidden>
      <Canvas
        dpr={[1, 1.5]}
        camera={{ position: [0, 1.2, 5], fov: 55 }}
        gl={{ antialias: true, alpha: true }}
      >
        <Plane y={-1.2} color={tint} />
        <Plane y={1.6} color={tint} rot={Math.PI / 1.2} />
      </Canvas>
    </div>
  );
}
