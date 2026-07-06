import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated'

// Reference: "10 Animated React Native Buttons You'll Love" (youtube.com/watch?v=36FX6zWT5Zc)
// Each button is self-contained (label + onPress) so it can drop straight into a screen.
// All respect useReducedMotion, same convention as Setting.tsx's logout button.

const AnimatedPressable = Animated.createAnimatedComponent(Pressable)

type BaseProps = { label: string; onPress?: () => void }

// 1. Background crossfades brand -> flame while held.
export function AnimatedBackgroundButton({ label, onPress }: BaseProps) {
  const reduced = useReducedMotion()
  const progress = useSharedValue(0)
  const style = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], ['#D23400', '#FF4000']),
  }))
  const set = (v: number) => (progress.value = reduced ? v : withTiming(v, { duration: 200 }))
  return (
    <AnimatedPressable
      onPressIn={() => set(1)}
      onPressOut={() => set(0)}
      onPress={onPress}
      style={[{ borderRadius: 12, paddingVertical: 14, alignItems: 'center' }, style]}
    >
      <Text className="font-sans-semibold text-white">{label}</Text>
    </AnimatedPressable>
  )
}

// 2. Compact pill expands to full width to reveal the label, mirrors Setting.tsx's logout button.
export function ResizingButton({ label, onPress, icon = 'add' }: BaseProps & { icon?: keyof typeof Ionicons.glyphMap }) {
  const reduced = useReducedMotion()
  const [expanded, setExpanded] = useState(false)
  const [fullW, setFullW] = useState(0)
  const progress = useSharedValue(0)
  const style = useAnimatedStyle(() => ({
    width: fullW > 0 ? 52 + (fullW - 52) * progress.value : 52,
  }))
  const toggle = () => {
    const next = !expanded
    setExpanded(next)
    progress.value = reduced ? Number(next) : withTiming(Number(next), { duration: 240, easing: Easing.out(Easing.quad) })
    if (expanded) onPress?.()
  }
  return (
    <View className="items-start" onLayout={(e) => setFullW(e.nativeEvent.layout.width)}>
      <Animated.View style={style} className="h-[52px] overflow-hidden rounded-full bg-primary">
        <Pressable onPress={toggle} className="flex-1 flex-row items-center justify-center gap-2 px-4">
          <Ionicons name={icon} size={22} color="#fff" />
          {expanded && (
            <Text numberOfLines={1} className="font-sans-semibold text-white">
              {label}
            </Text>
          )}
        </Pressable>
      </Animated.View>
    </View>
  )
}

// 3. Shadow deepens and button lifts on press, flattens back down on release.
export function AnimatedShadowButton({ label, onPress }: BaseProps) {
  const reduced = useReducedMotion()
  const lift = useSharedValue(0)
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: -6 * lift.value }],
    shadowOpacity: 0.15 + 0.25 * lift.value,
    shadowRadius: 4 + 10 * lift.value,
    elevation: 2 + 8 * lift.value,
  }))
  const set = (v: number) => (lift.value = reduced ? v : withTiming(v, { duration: 150 }))
  return (
    <AnimatedPressable
      onPressIn={() => set(1)}
      onPressOut={() => set(0)}
      onPress={onPress}
      style={[
        { borderRadius: 12, paddingVertical: 14, alignItems: 'center', backgroundColor: '#fff', shadowColor: '#000', shadowOffset: { width: 0, height: 4 } },
        style,
      ]}
    >
      <Text className="font-sans-semibold text-accent">{label}</Text>
    </AnimatedPressable>
  )
}

// 4. Squash-and-stretch cartoon press, overshoots on release.
export function AnimatedCartoonButton({ label, onPress }: BaseProps) {
  const reduced = useReducedMotion()
  const sx = useSharedValue(1)
  const sy = useSharedValue(1)
  const style = useAnimatedStyle(() => ({ transform: [{ scaleX: sx.value }, { scaleY: sy.value }] }))
  const onPressIn = () => {
    if (reduced) return
    sx.value = withTiming(1.15, { duration: 80 })
    sy.value = withTiming(0.85, { duration: 80 })
  }
  const onPressOut = () => {
    if (reduced) return
    sx.value = withSpring(1, { damping: 4, stiffness: 180 })
    sy.value = withSpring(1, { damping: 4, stiffness: 180 })
  }
  return (
    <AnimatedPressable
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      onPress={onPress}
      style={[{ borderRadius: 16, paddingVertical: 14, alignItems: 'center', backgroundColor: '#FF6633', borderWidth: 3, borderColor: '#D23400' }, style]}
    >
      <Text className="font-sans-bold text-white">{label}</Text>
    </AnimatedPressable>
  )
}

// 5. Heart icon fills and pops on toggle (favorite/like pattern).
export function AnimatedIconButton({ onPress }: { onPress?: (liked: boolean) => void }) {
  const reduced = useReducedMotion()
  const [liked, setLiked] = useState(false)
  const scale = useSharedValue(1)
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }))
  const toggle = () => {
    const next = !liked
    setLiked(next)
    scale.value = reduced ? 1 : withSequence(withTiming(1.4, { duration: 100 }), withSpring(1, { damping: 5 }))
    onPress?.(next)
  }
  return (
    <Pressable onPress={toggle} hitSlop={8}>
      <Animated.View style={style}>
        <Ionicons name={liked ? 'heart' : 'heart-outline'} size={32} color={liked ? '#FF4000' : '#525252'} />
      </Animated.View>
    </Pressable>
  )
}

// 6. Chevron loops side to side, hinting "swipe" / "more" without a scroll gesture.
export function AnimatedScrollingButton({ label, onPress }: BaseProps) {
  const reduced = useReducedMotion()
  const x = useSharedValue(0)
  if (!reduced) x.value = withRepeat(withSequence(withTiming(6, { duration: 500 }), withTiming(0, { duration: 500 })), -1, true)
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }))
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center justify-center gap-2 rounded-full border border-border bg-white px-5 py-3"
    >
      <Text className="font-sans-medium text-accent">{label}</Text>
      <Animated.View style={style}>
        <Ionicons name="chevron-forward" size={18} color="#525252" />
      </Animated.View>
    </Pressable>
  )
}

// 7. Real diagonal gradient with a shine sweeping across on press.
export function AnimatedGradientBackgroundButton({ label, onPress }: BaseProps) {
  const reduced = useReducedMotion()
  const shine = useSharedValue(-1)
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: shine.value * 150 }, { rotate: '20deg' }] }))
  const onPressIn = () => {
    shine.value = -1
    shine.value = reduced ? 1 : withTiming(1, { duration: 450, easing: Easing.out(Easing.quad) })
  }
  return (
    <Pressable onPressIn={onPressIn} onPress={onPress} style={{ borderRadius: 12, overflow: 'hidden' }}>
      <LinearGradient colors={['#D23400', '#FF4000', '#FF6633']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ paddingVertical: 14, alignItems: 'center' }}>
        <Animated.View style={[{ position: 'absolute', top: -20, bottom: -20, width: 40, backgroundColor: 'rgba(255,255,255,0.35)' }, style]} />
        <Text className="font-sans-semibold text-white">{label}</Text>
      </LinearGradient>
    </Pressable>
  )
}

// 8. Continuous soft pulse + expanding ring, for urgent/attention CTAs (e.g. report fire).
export function PulsingButton({ label, onPress }: BaseProps) {
  const reduced = useReducedMotion()
  const pulse = useSharedValue(0)
  if (!reduced) pulse.value = withRepeat(withTiming(1, { duration: 1200, easing: Easing.out(Easing.quad) }), -1, false)
  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + pulse.value * 0.5 }],
    opacity: 1 - pulse.value,
  }))
  return (
    <Pressable onPress={onPress} className="items-center justify-center">
      <Animated.View style={[{ position: 'absolute', width: '100%', height: '100%', borderRadius: 999, backgroundColor: '#FF4000' }, ringStyle]} />
      <View className="rounded-full bg-primary px-6 py-4">
        <Text className="font-sans-semibold text-white">{label}</Text>
      </View>
    </Pressable>
  )
}

// 9. Classic tactile press: shrink on press-in, spring overshoot back on release.
export function BouncingButton({ label, onPress }: BaseProps) {
  const reduced = useReducedMotion()
  const scale = useSharedValue(1)
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }))
  const onPressIn = () => (scale.value = reduced ? 0.94 : withTiming(0.94, { duration: 80 }))
  const onPressOut = () => (scale.value = reduced ? 1 : withSpring(1, { damping: 6, stiffness: 200 }))
  return (
    <AnimatedPressable
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      onPress={onPress}
      style={[{ borderRadius: 12, paddingVertical: 14, alignItems: 'center', backgroundColor: '#292929' }, style]}
    >
      <Text className="font-sans-semibold text-white">{label}</Text>
    </AnimatedPressable>
  )
}

// 10. "Tada" wiggle (Animate.css tada) on press: scale up, rock side to side, settle.
export function TadaButton({ label, onPress }: BaseProps) {
  const reduced = useReducedMotion()
  const scale = useSharedValue(1)
  const rotate = useSharedValue(0)
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }, { rotate: `${rotate.value}deg` }] }))
  const trigger = () => {
    if (!reduced) {
      scale.value = withSequence(withTiming(0.9, { duration: 100 }), withTiming(1.1, { duration: 100 }), withTiming(1, { duration: 150 }))
      rotate.value = withSequence(
        withTiming(-3, { duration: 80 }),
        withTiming(3, { duration: 80 }),
        withTiming(-3, { duration: 80 }),
        withTiming(3, { duration: 80 }),
        withTiming(0, { duration: 80 }),
      )
    }
    onPress?.()
  }
  return (
    <AnimatedPressable
      onPress={trigger}
      style={[{ borderRadius: 12, paddingVertical: 14, alignItems: 'center', backgroundColor: '#FF4000' }, style]}
    >
      <Text className="font-sans-semibold text-white">{label}</Text>
    </AnimatedPressable>
  )
}
