import {
  AnimatedBackgroundButton,
  AnimatedCartoonButton,
  AnimatedGradientBackgroundButton,
  AnimatedIconButton,
  AnimatedScrollingButton,
  AnimatedShadowButton,
  BouncingButton,
  PulsingButton,
  ResizingButton,
  TadaButton,
} from '@/components/AnimatedButtons'
import { toast } from '@/lib/toastStore'
import { ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

// Dev showcase for AnimatedButtons.tsx — every variant, tap to see it fire.
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="gap-2">
      <Text className="text-sm font-head text-muted-foreground">{label}</Text>
      {children}
    </View>
  )
}

export default function ButtonDemo() {
  const ping = (name: string) => toast.info(`${name} pressed`)
  return (
    <SafeAreaView className="flex-1 bg-foreground" edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 48, gap: 24 }}>
        <Section label="Animated Background">
          <AnimatedBackgroundButton label="Hold me" onPress={() => ping('Background')} />
        </Section>
        <Section label="Resizing">
          <ResizingButton label="ยืนยัน" onPress={() => ping('Resizing')} />
        </Section>
        <Section label="Animated Shadow">
          <AnimatedShadowButton label="Press me" onPress={() => ping('Shadow')} />
        </Section>
        <Section label="Cartoon">
          <AnimatedCartoonButton label="Squish!" onPress={() => ping('Cartoon')} />
        </Section>
        <Section label="Icon (like)">
          <AnimatedIconButton onPress={(liked) => ping(liked ? 'Liked' : 'Unliked')} />
        </Section>
        <Section label="Scrolling">
          <AnimatedScrollingButton label="More" onPress={() => ping('Scrolling')} />
        </Section>
        <Section label="Gradient Background">
          <AnimatedGradientBackgroundButton label="Gradient" onPress={() => ping('Gradient')} />
        </Section>
        <Section label="Pulsing">
          <PulsingButton label="แจ้งไฟไหม้" onPress={() => ping('Pulsing')} />
        </Section>
        <Section label="Bouncing">
          <BouncingButton label="Bounce" onPress={() => ping('Bouncing')} />
        </Section>
        <Section label="Tada">
          <TadaButton label="Tada!" onPress={() => ping('Tada')} />
        </Section>
      </ScrollView>
    </SafeAreaView>
  )
}
