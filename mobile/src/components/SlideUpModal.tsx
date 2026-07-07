import { useEffect, useState } from 'react'
import { Modal, Pressable, View, type StyleProp, type ViewStyle } from 'react-native'
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
  runOnJS,
  useReducedMotion,
} from 'react-native-reanimated'

export default function SlideUpModal({
  visible,
  onClose,
  dismissable = true,
  sheetStyle,
  children,
}: {
  visible: boolean
  onClose: () => void
  dismissable?: boolean
  sheetStyle?: StyleProp<ViewStyle>
  children: React.ReactNode
}) {
  const [mounted, setMounted] = useState(visible)
  const reduced = useReducedMotion()

  useEffect(() => {
    if (visible) setMounted(true)
  }, [visible])

  if (!mounted) return null

  const dur = reduced ? 1 : 250
  const requestClose = () => dismissable && onClose()

  return (
    <Modal transparent visible animationType="none" onRequestClose={requestClose}>
      <View className="flex-1 justify-end">
        {visible && (
          <>
            <Animated.View
              entering={FadeIn.duration(dur)}
              exiting={FadeOut.duration(dur)}
              className="absolute inset-0 bg-black/40"
            >
              <Pressable className="flex-1" onPress={requestClose} />
            </Animated.View>
            <Animated.View
              entering={SlideInDown.duration(dur)}
              exiting={SlideOutDown.duration(dur).withCallback((finished) => {
                'worklet'
                if (finished) runOnJS(setMounted)(false)
              })}
              className="rounded-t-3xl bg-foreground p-5"
              style={sheetStyle}
            >
              {children}
            </Animated.View>
          </>
        )}
      </View>
    </Modal>
  )
}
