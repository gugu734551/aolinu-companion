import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Component, Suspense, useEffect, useMemo, useRef, type ReactNode } from 'react'
import * as THREE from 'three'
import { PALETTE } from '../lib/palette'
import { getState, setFps } from '../lib/store'
import { Particles } from './Particles'
import { Robot } from './Robot'

/* ------------------------------- lights ------------------------------- */

function Lights() {
  const keyRef = useRef<THREE.PointLight>(null!)
  const rimRef = useRef<THREE.PointLight>(null!)
  const fillRef = useRef<THREE.DirectionalLight>(null!)
  const keyColor = useMemo(() => new THREE.Color(), [])
  const rimColor = useMemo(() => new THREE.Color(), [])

  useFrame((_, delta) => {
    const state = getState()
    const palette = PALETTE[state.emotion]
    keyColor.set(state.lightColor ?? palette.key)
    rimColor.set(palette.rim)

    const key = keyRef.current
    const rim = rimRef.current
    const fill = fillRef.current
    if (!key || !rim || !fill) return

    key.color.lerp(keyColor, 1 - Math.exp(-delta * 2.6))
    rim.color.lerp(rimColor, 1 - Math.exp(-delta * 2.2))

    const energy =
      state.emotion === 'sleepy' ? 0.45 : state.emotion === 'happy' ? 1.35 : state.emotion === 'angry' ? 1.25 : state.emotion === 'sad' ? 0.6 : 1

    /* 好感度越高，灯越亮、轮廓越暖 —— 关系是看得见的 */
    const affinityBoost = 0.78 + (state.affinity / 100) * 0.44
    key.intensity = THREE.MathUtils.damp(key.intensity, 2.7 * energy * affinityBoost, 2.4, delta)
    rim.intensity = THREE.MathUtils.damp(rim.intensity, 3.6 * energy, 2.2, delta)
    fill.intensity = THREE.MathUtils.damp(fill.intensity, 0.3 + energy * 0.3, 2, delta)
  })

  return (
    <>
      <ambientLight intensity={0.17} color="#9fb2da" />
      <hemisphereLight args={['#8ea6ff', '#04060b', 0.18]} />
      <directionalLight ref={fillRef} position={[0, 5, 3.5]} intensity={0.6} color="#eaf1ff" />
      <pointLight ref={keyRef} position={[2.3, 3.1, 2.4]} intensity={2.7} decay={0} distance={0} />
      <pointLight ref={rimRef} position={[-2.9, 2.1, -2.3]} intensity={3.6} decay={0} distance={0} />
    </>
  )
}

/* ----------------------------- environment ---------------------------- */

function StudioEnv() {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)

  useEffect(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 64
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const sky = ctx.createLinearGradient(0, 0, 0, 64)
    sky.addColorStop(0, '#25324f')
    sky.addColorStop(0.5, '#101728')
    sky.addColorStop(1, '#05070c')
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, 128, 64)

    const warm = ctx.createRadialGradient(38, 18, 0, 38, 18, 34)
    warm.addColorStop(0, 'rgba(255, 214, 170, 0.95)')
    warm.addColorStop(1, 'rgba(255, 214, 170, 0)')
    ctx.fillStyle = warm
    ctx.fillRect(0, 0, 128, 64)

    const cool = ctx.createRadialGradient(96, 24, 0, 96, 24, 40)
    cool.addColorStop(0, 'rgba(120, 170, 255, 0.75)')
    cool.addColorStop(1, 'rgba(120, 170, 255, 0)')
    ctx.fillStyle = cool
    ctx.fillRect(0, 0, 128, 64)

    const texture = new THREE.CanvasTexture(canvas)
    texture.mapping = THREE.EquirectangularReflectionMapping
    texture.colorSpace = THREE.SRGBColorSpace

    const pmrem = new THREE.PMREMGenerator(gl)
    const target = pmrem.fromEquirectangular(texture)
    scene.environment = target.texture
    scene.environmentIntensity = 0.85

    texture.dispose()
    pmrem.dispose()

    return () => {
      target.dispose()
      scene.environment = null
    }
  }, [gl, scene])

  return null
}

/* --------------------------- contact shadow --------------------------- */

function ContactShadow() {
  const texture = useMemo(() => {
    const size = 256
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (ctx) {
      const gradient = ctx.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2)
      gradient.addColorStop(0, 'rgba(0, 0, 0, 0.72)')
      gradient.addColorStop(0.42, 'rgba(0, 0, 0, 0.3)')
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, size, size)
    }
    const map = new THREE.CanvasTexture(canvas)
    map.colorSpace = THREE.SRGBColorSpace
    return map
  }, [])

  useEffect(() => () => texture.dispose(), [texture])

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0.06]}>
      <planeGeometry args={[3.0, 3.0]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} opacity={0.9} />
    </mesh>
  )
}

/* ----------------------------- stage ring ----------------------------- */

function StageRing() {
  const groupRef = useRef<THREE.Group>(null!)
  const innerRef = useRef<THREE.Mesh>(null!)
  const outerRef = useRef<THREE.Mesh>(null!)
  const color = useMemo(() => new THREE.Color(), [])
  const lastEmotion = useRef<string | null>(null)
  const flash = useRef(0)

  useFrame((rootState, delta) => {
    const state = getState()
    color.set(state.lightColor ?? PALETTE[state.emotion].glow)

    const inner = innerRef.current?.material as THREE.MeshBasicMaterial | undefined
    const outer = outerRef.current?.material as THREE.MeshBasicMaterial | undefined
    if (!inner || !outer) return

    /* 状态切换的一瞬间，舞台环像被踩了一脚：亮一下、涨一下 */
    if (lastEmotion.current !== state.emotion) {
      lastEmotion.current = state.emotion
      flash.current = 1
    }
    flash.current = Math.max(0, flash.current - delta * 1.7)

    inner.color.lerp(color, 1 - Math.exp(-delta * 2.4))
    outer.color.lerp(color, 1 - Math.exp(-delta * 2.4))

    const pulse = 0.5 + Math.sin(rootState.clock.elapsedTime * 0.9) * 0.12
    inner.opacity = THREE.MathUtils.damp(inner.opacity, pulse + flash.current * 0.8, 3, delta)
    outer.opacity = THREE.MathUtils.damp(outer.opacity, pulse * 0.4 + flash.current * 0.5, 3, delta)

    const scale = 1 + flash.current * 0.06
    groupRef.current?.scale.setScalar(scale)
  })

  return (
    <group ref={groupRef} position={[0, 0.008, 0]}>
      <mesh ref={innerRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.02, 1.045, 128]} />
        <meshBasicMaterial transparent opacity={0.5} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={outerRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.3, 1.312, 128]} />
        <meshBasicMaterial transparent opacity={0.2} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

/* ----------------------------- camera rig ----------------------------- */

function CameraRig() {
  const camera = useThree((state) => state.camera)

  useFrame((rootState, delta) => {
    const { pointer } = rootState
    camera.position.x = THREE.MathUtils.damp(camera.position.x, pointer.x * 0.3, 2.4, delta)
    camera.position.y = THREE.MathUtils.damp(camera.position.y, 1.36 + pointer.y * 0.14, 2.4, delta)
    camera.lookAt(0, 1.02, 0)
  })

  return null
}

/* ------------------------------- stats -------------------------------- */

function FrameStats() {
  const acc = useRef({ frames: 0, elapsed: 0 })

  useFrame((_, delta) => {
    acc.current.frames += 1
    acc.current.elapsed += delta
    if (acc.current.elapsed >= 0.5) {
      setFps(acc.current.frames / acc.current.elapsed)
      acc.current.frames = 0
      acc.current.elapsed = 0
    }
  })

  return null
}

/* ------------------------------- stage -------------------------------- */

function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'))
  } catch {
    return false
  }
}

interface BoundaryState {
  failed: boolean
  reason: string
}

/** 3D 场景失败（无 WebGL / 模型加载失败）时给一条明确提示，而不是白屏卡在「正在唤醒」 */
class SceneBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { failed: false, reason: '' }

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { failed: true, reason: error instanceof Error ? error.message : '未知错误' }
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="stage-fallback" role="alert">
          <div className="fallback-card">
            <b>3D 场景没有加载起来</b>
            <p>可能是浏览器禁用了 WebGL，或模型文件加载失败。</p>
            <p>建议用 Chrome / Edge 打开，或刷新重试；调试台与情绪状态机仍然可用。</p>
            <code>{this.state.reason || 'webgl unavailable'}</code>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

export function Stage() {
  const webgl = useMemo(() => supportsWebGL(), [])

  if (!webgl) {
    return (
      <div className="canvas-layer">
        <div className="stage-fallback" role="alert">
          <div className="fallback-card">
            <b>当前浏览器没有可用的 WebGL</b>
            <p>请用 Chrome / Edge 打开，或在设置里开启硬件加速后刷新。</p>
            <p>右侧调试台和情绪状态机不受影响，可以继续演示。</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="canvas-layer">
      <SceneBoundary>
        <Canvas
          dpr={[1, 2]}
          gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
          camera={{ position: [0, 1.36, 5.2], fov: 32, near: 0.1, far: 40 }}
          onCreated={({ gl }) => {
            gl.toneMapping = THREE.ACESFilmicToneMapping
            gl.toneMappingExposure = 0.95
          }}
        >
          <Suspense fallback={null}>
            <StudioEnv />
            <Lights />
            <CameraRig />
            <FrameStats />
            <ContactShadow />
            <StageRing />
            <Particles />
            <Robot />
          </Suspense>
        </Canvas>
      </SceneBoundary>
    </div>
  )
}
