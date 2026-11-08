import { useFrame, useLoader } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  CLIP_BY_EMOTION,
  EXIT_CLIP_BY_EMOTION,
  HOLD_CLIP_BY_EMOTION,
  PALETTE,
  POSE_BY_EMOTION,
  TIME_SCALE_BY_EMOTION,
} from '../lib/palette'
import type { Emotion } from '../lib/types'
import { getState, setReady, subscribe } from '../lib/store'

const MODEL_URL = '/models/RobotExpressive.glb'
const BODY_HEIGHT = 2.05

export function Robot() {
  const gltf = useLoader(GLTFLoader, MODEL_URL)
  const poseRef = useRef<THREE.Group>(null!)

  /** retint the CC0 robot into a neutral shell so the emotion lighting reads clearly */
  const shell = useMemo(() => {
    const materials: THREE.MeshStandardMaterial[] = []
    gltf.scene.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh) return
      const source = mesh.material as THREE.MeshStandardMaterial
      if (!source || !('isMeshStandardMaterial' in source)) return
      const material = source.clone()
      const name = source.name
      if (name === 'Main') {
        material.color = new THREE.Color('#c3ccdd')
        material.roughness = 0.5
        material.metalness = 0.2
        material.emissive = new THREE.Color('#000000')
        material.emissiveIntensity = 0
        materials.push(material)
      } else if (name === 'Grey') {
        material.color = new THREE.Color('#7b8798')
        material.roughness = 0.45
        material.metalness = 0.55
      } else {
        material.color = new THREE.Color('#121822')
        material.roughness = 0.22
        material.metalness = 0.4
      }
      mesh.material = material
    })
    return materials
  }, [gltf.scene])

  const mixer = useMemo(() => new THREE.AnimationMixer(gltf.scene), [gltf.scene])

  const actions = useMemo(() => {
    const map: Record<string, THREE.AnimationAction> = {}
    for (const clip of gltf.animations) {
      map[clip.name] = mixer.clipAction(clip)
    }
    return map
  }, [gltf.animations, mixer])

  /** uniform scale + offset so the robot stands on y = 0 and is BODY_HEIGHT tall */
  const fit = useMemo(() => {
    const box = new THREE.Box3().setFromObject(gltf.scene)
    const size = new THREE.Vector3()
    const center = new THREE.Vector3()
    box.getSize(size)
    box.getCenter(center)
    const scale = BODY_HEIGHT / Math.max(size.y, 0.001)
    return {
      scale,
      offset: new THREE.Vector3(-center.x * scale, -box.min.y * scale, -center.z * scale),
    }
  }, [gltf.scene])

  const currentRef = useRef<THREE.AnimationAction | null>(null)
  const oneShotRef = useRef<THREE.AnimationAction | null>(null)
  const lastReactionId = useRef(0)
  const lastEmotionRef = useRef<Emotion | null>(null)

  const fadeTo = (name: string, timeScale: number, duration = 0.5, hold = false) => {
    const next = actions[name]
    if (!next) return
    if (currentRef.current === next) {
      if (hold) {
        /* 已经停在末帧的坐姿：不要重新循环，只同步速度 */
        next.setEffectiveTimeScale(timeScale)
        return
      }
      /* the same clip can be re-used by a one-shot reaction: restore looping */
      next.setLoop(THREE.LoopRepeat, Infinity)
      next.clampWhenFinished = false
      next.setEffectiveTimeScale(timeScale)
      if (!next.isRunning()) next.play()
      return
    }
    next.reset()
    next.enabled = true
    next.setLoop(hold ? THREE.LoopOnce : THREE.LoopRepeat, hold ? 1 : Infinity)
    next.clampWhenFinished = hold
    next.setEffectiveTimeScale(timeScale)
    next.setEffectiveWeight(1)
    next.fadeIn(duration).play()
    currentRef.current?.fadeOut(duration)
    currentRef.current = next
    oneShotRef.current = null
  }

  /** 当前情绪对应的动画：坐下这类过渡只播一次并停在末帧 */
  const playEmotionClip = (emotion: Emotion, duration = 0.5) => {
    fadeTo(
      CLIP_BY_EMOTION[emotion],
      TIME_SCALE_BY_EMOTION[emotion],
      duration,
      HOLD_CLIP_BY_EMOTION[emotion] === true,
    )
  }

  const playOnce = (name: string, duration = 0.3) => {
    const action = actions[name]
    if (!action) return
    action.reset()
    action.setLoop(THREE.LoopOnce, 1)
    action.clampWhenFinished = true
    action.setEffectiveTimeScale(1)
    action.setEffectiveWeight(1)
    action.fadeIn(duration).play()
    if (currentRef.current && currentRef.current !== action) currentRef.current.fadeOut(duration)
    currentRef.current = action
    oneShotRef.current = action
  }

  useEffect(() => {
    const onFinished = (event: { action: THREE.AnimationAction }) => {
      if (oneShotRef.current && event.action === oneShotRef.current) {
        oneShotRef.current = null
        const { emotion } = getState()
        playEmotionClip(emotion, 0.45)
      }
    }
    mixer.addEventListener('finished', onFinished)
    return () => mixer.removeEventListener('finished', onFinished)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mixer, actions])

  useEffect(() => {
    const apply = () => {
      const state = getState()
      const previous = lastEmotionRef.current
      const emotionChanged = state.emotion !== previous
      lastEmotionRef.current = state.emotion

      if (state.reaction && state.reaction.id !== lastReactionId.current) {
        lastReactionId.current = state.reaction.id
        if (actions[state.reaction.clip]) {
          playOnce(state.reaction.clip)
          return
        }
      }

      /* never cut a one-shot reaction short just because fps/logs re-rendered */
      if (oneShotRef.current && !emotionChanged) return

      /* 从坐姿醒来：先播起身过渡，结束后再切到目标情绪 */
      const exitClip = previous ? EXIT_CLIP_BY_EMOTION[previous] : undefined
      if (emotionChanged && exitClip && actions[exitClip]) {
        playOnce(exitClip, 0.3)
        return
      }

      playEmotionClip(state.emotion)
    }
    apply()
    const unsubscribe = subscribe(apply)
    setReady(true)
    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actions])

  const emissiveTarget = useMemo(() => new THREE.Color(), [])

  useFrame((rootState, delta) => {
    mixer.update(delta)

    const state = getState()
    const pose = POSE_BY_EMOTION[state.emotion]
    const group = poseRef.current
    if (!group) return

    const t = rootState.clock.elapsedTime
    const breath = 1 + Math.sin(t * pose.breath) * 0.008

    /* body panels pick up the current mood as a slow emissive pulse */
    emissiveTarget.set(state.lightColor ?? PALETTE[state.emotion].glow)
    const pulse =
      (state.emotion === 'sleepy' ? 0.03 : 0.085) +
      (state.affinity / 100) * 0.05 +
      Math.sin(t * pose.breath) * 0.05
    for (const material of shell) {
      material.emissive.lerp(emissiveTarget, 1 - Math.exp(-delta * 2.2))
      material.emissiveIntensity = THREE.MathUtils.damp(material.emissiveIntensity, pulse, 2.5, delta)
    }

    group.rotation.x = THREE.MathUtils.damp(group.rotation.x, pose.tilt, 3.2, delta)
    group.rotation.y = THREE.MathUtils.damp(
      group.rotation.y,
      pose.yaw + rootState.pointer.x * 0.15,
      2.4,
      delta,
    )
    group.rotation.z = THREE.MathUtils.damp(
      group.rotation.z,
      Math.sin(t * 0.7) * 0.006,
      2,
      delta,
    )
    group.position.y = THREE.MathUtils.damp(
      group.position.y,
      pose.lift + Math.sin(t * 0.9) * 0.012,
      2.5,
      delta,
    )
    const nextScale = THREE.MathUtils.damp(group.scale.x, pose.scale * breath, 4, delta)
    group.scale.setScalar(nextScale)
  })

  return (
    <group ref={poseRef}>
      <group scale={fit.scale} position={fit.offset}>
        <primitive object={gltf.scene} />
      </group>
    </group>
  )
}
