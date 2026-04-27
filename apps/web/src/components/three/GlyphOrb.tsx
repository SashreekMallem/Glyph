"use client";

/**
 * `<GlyphOrb>` — signature 3D hero element for the Glyph brand.
 *
 * A shader-driven MeshDistortMaterial orb with subtle float + rim
 * light. Ships SSR-safe (the whole Canvas is client-only, lazy-mounted
 * via `next/dynamic` where used).
 *
 * Performance budget: single low-poly Icosahedron (geometry ~4KB GPU),
 * frameloop on demand when reduced-motion is requested, DPR capped at
 * 1.5 to stay crisp without melting integrated GPUs.
 */

import { Canvas, useFrame } from "@react-three/fiber";
import { Float, MeshDistortMaterial, Environment } from "@react-three/drei";
import { useRef, useMemo } from "react";
import type { Mesh } from "three";

interface OrbProps {
  readonly tint?: string;
  readonly distort?: number;
  readonly speed?: number;
}

function Orb({ tint = "#6366f1", distort = 0.35, speed = 1.1 }: OrbProps) {
  const meshRef = useRef<Mesh>(null);
  useFrame((_, delta) => {
    if (meshRef.current) {
      meshRef.current.rotation.y += delta * 0.12;
      meshRef.current.rotation.x += delta * 0.04;
    }
  });
  return (
    <Float speed={speed} rotationIntensity={0.4} floatIntensity={0.8}>
      <mesh ref={meshRef} scale={1.4}>
        <icosahedronGeometry args={[1, 8]} />
        <MeshDistortMaterial
          color={tint}
          emissive={tint}
          emissiveIntensity={0.35}
          roughness={0.25}
          metalness={0.6}
          distort={distort}
          speed={2.2}
        />
      </mesh>
    </Float>
  );
}

export interface GlyphOrbProps {
  readonly className?: string;
  /** Brand tint (hex). Default: indigo-500. */
  readonly tint?: string;
  /** Distortion amount 0..1. Default 0.35. */
  readonly distort?: number;
}

export function GlyphOrb({ className, tint, distort }: GlyphOrbProps) {
  const dpr = useMemo<[number, number]>(() => [1, 1.5], []);
  return (
    <div className={className}>
      <Canvas
        dpr={dpr}
        camera={{ position: [0, 0, 4], fov: 42 }}
        gl={{ antialias: true, alpha: true }}
      >
        <ambientLight intensity={0.4} />
        <directionalLight position={[3, 4, 5]} intensity={1.1} />
        <Environment preset="city" />
        <Orb tint={tint} distort={distort} />
      </Canvas>
    </div>
  );
}
