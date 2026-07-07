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

/**
 * Bottom sheet modal that slides up on open and slides down on close.
 *
 * `visible` (controlled by the parent) and `mounted` (local) are deliberately
 * decoupled: when `visible` flips to false we must keep the RN `Modal`
 * mounted long enough for the exit animation to play, then unmount on the
 * animation's completion callback. Without this split the modal would
 * disappear instantly instead of sliding out.
 *
 * @param visible - whether the sheet should be open; false triggers the exit animation rather than an immediate unmount
 * @param onClose - called when the backdrop is pressed or the sheet is dismissed via hardware back (Android)
 * @param dismissable - when false, backdrop/back-button dismissal is ignored (e.g. while a submit is in-flight); defaults to true
 * @param sheetStyle - style forwarded to the sheet container, e.g. to reserve space for the keyboard
 * @param children - sheet content
 * @returns null while unmounted (before first open, or after the exit animation finishes)
 */
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
  // Tracks whether the underlying RN Modal is in the tree; stays true during the exit animation.
  const [mounted, setMounted] = useState(visible)
  const reduced = useReducedMotion()

  useEffect(() => {
    if (visible) setMounted(true)
  }, [visible])

  if (!mounted) return null

  // Respect the OS "reduce motion" setting by collapsing the animation to effectively instant.
  const dur = reduced ? 1 : 250
  const requestClose = () => dismissable && onClose()

  return (
    // `visible` is always true here (Modal itself is only rendered while `mounted`);
    // RN's own `visible` prop is bypassed so we control show/hide via our own animations instead.
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
                // Runs on the UI thread; hop back to JS to unmount only once the slide-out actually completes.
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
