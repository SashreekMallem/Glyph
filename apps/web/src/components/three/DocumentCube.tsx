"use client";

/**
 * `<DocumentCube>` — a slowly-rotating 3D cube representing the Glyph
 * metaphor: every face is a page of a document. Used as a decoration
 * on document cards / finalize screen.
 */

import { Canvas, useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Group } from "three";

function Cube() {
  const ref = useRef<Group>(null);
  useFrame((_, dt) => {
    if (ref.current) {
      ref.current.rotation.x += dt * 0.18;
      ref.current.rotation.y += dt * 0.22;
    }
  });
  return (
    <group ref={ref}>
      <mesh>
        <boxGeometry args={[1.4, 1.9, 0.15]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.45} metalness={0.15} />
      </mesh>
      <mesh position={[0, 0, 0.08]}>
        <planeGeometry args={[1.1, 1.6]} />
        <meshBasicMaterial color="#e2e8f0" />
      </mesh>
    </group>
  );
}

export function DocumentCube({ className }: { className?: string }) {
  return (
    <div className={className}>
      <Canvas dpr={[1, 1.5]} camera={{ position: [0, 0, 4], fov: 38 }} gl={{ alpha: true }}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[3, 4, 3]} intensity={1.2} />
        <directionalLight position={[-3, -2, 1]} intensity={0.4} color="#6366f1" />
        <Cube />
      </Canvas>
    </div>
  );
}
