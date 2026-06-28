import "../../global.css"; // NativeWind: load Tailwind styles at app root
import { useEffect } from "react";
import { Stack } from "expo-router";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
// Per-weight subpath imports so Metro only bundles the weights we use (not all 18).
import { Kanit_400Regular } from "@expo-google-fonts/kanit/400Regular";
import { Kanit_500Medium } from "@expo-google-fonts/kanit/500Medium";
import { Kanit_600SemiBold } from "@expo-google-fonts/kanit/600SemiBold";
import { Kanit_700Bold } from "@expo-google-fonts/kanit/700Bold";
import { Sarabun_400Regular } from "@expo-google-fonts/sarabun/400Regular";
import { Sarabun_500Medium } from "@expo-google-fonts/sarabun/500Medium";
import { Sarabun_600SemiBold } from "@expo-google-fonts/sarabun/600SemiBold";
import { Sarabun_700Bold } from "@expo-google-fonts/sarabun/700Bold";
import AuthProvider from "@/providers/AuthProvider";
import Toaster from "@/components/Toaster";
import { requestNotificationPermission } from "@/lib/push";
import "@/lib/locationTask"; // registers the background location task at every (incl. headless) launch

// Keep the native splash visible until the custom fonts are ready.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Kanit_400Regular,
    Kanit_500Medium,
    Kanit_600SemiBold,
    Kanit_700Bold,
    Sarabun_400Regular,
    Sarabun_500Medium,
    Sarabun_600SemiBold,
    Sarabun_700Bold,
  });

  // Ask for the notification permission as soon as the app launches, rather than
  // waiting until a verified field officer signs in (registerPushToken).
  useEffect(() => {
    requestNotificationPermission().catch(() => {});
  }, []);

  // Hide the splash once fonts resolve — but don't block the app if a font fails.
  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <AuthProvider>
      <Stack screenOptions={{ headerShown: false }} />
      <Toaster />
    </AuthProvider>
  );
}
