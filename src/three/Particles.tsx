import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { PALETTE } from '../lib/palette'
import { getState } from '../lib/store'

const COUNT = 260

export function Particles() {
  const pointsRef = useRef<THREE.Points>(null!)
  const materialRef = useRef<THREE.PointsMaterial>(null!)

  const { positions, speeds } = useMemo(() => {
    const positions = new Float32Array(COUNT * 3)
    const speeds = new Float32Array(COUNT)
    for (let i = 0; i < COUNT; i += 1) {
      positions[i * 3] = (Math.random() - 0.5) * 7
      positions[i * 3 + 1] = Math.random() * 3.6
      positions[i * 3 + 2] = (Math.random() - 0.5) * 3.4
      speeds[i] = 0.06 + Math.random() * 0.16
    }
    return { positions, speeds }
  }, [])

  const target = useMemo(() => new THREE.Color(), [])

  useFrame((_, delta) => {
    const geometry = pointsRef.current?.geometry
    if (!geometry) return

    const state = getState()
    const palette = PALETTE[state.emotion]
    const factor =
      state.emotion === 'happy' ? 3.2 : state.emotion === 'angry' ? 2.4 : state.emotion === 'sleepy' ? 0.35 : state.emotion === 'sad' ? 0.4 : 1

    const attribute = geometry.getAttribute('position') as THREE.BufferAttribute
    const array = attribute.array as Float32Array

    for (let i = 0; i < COUNT; i += 1) {
      array[i * 3 + 1] += speeds[i] * delta * factor
      array[i * 3] += Math.sin((array[i * 3 + 1] + i) * 0.6) * delta * 0.02 * factor
      if (array[i * 3 + 1] > 3.8) {
        array[i * 3 + 1] = -0.1
        array[i * 3] = (Math.random() - 0.5) * 7
        array[i * 3 + 2] = (Math.random() - 0.5) * 3.4
      }
    }
    attribute.needsUpdate = true

    const material = materialRef.current
    if (material) {
      target.set(palette.particle)
      material.color.lerp(target, 1 - Math.exp(-delta * 2.4))
      material.opacity = (0.28 + Math.min(1, factor) * 0.3) * (0.6 + (state.affinity / 100) * 0.6)
    }
  })

  return (
    <points ref={pointsRef} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        ref={materialRef}
        size={0.028}
        sizeAttenuation
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        opacity={0.5}
      />
    </points>
  )
}
