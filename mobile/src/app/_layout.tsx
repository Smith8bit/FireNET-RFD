import "../../global.css";
import { useEffect } from "react";
import { Stack } from "expo-router";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
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
import "@/lib/locationTask";

// Keep the native splash screen up until fonts are ready, avoiding a flash of fallback-font text.
SplashScreen.preventAutoHideAsync();

/**
 * Root layout for the whole app (outside any route group): loads custom
 * fonts, requests notification permission once, and wraps every screen in
 * `AuthProvider` plus the global `Toaster` so toasts can be triggered from
 * anywhere without prop drilling.
 *
 * `../../global.css` and `@/lib/locationTask` are imported for their side
 * effects only (Tailwind setup and background-location task registration,
 * respectively) — neither exports anything consumed here.
 *
 * @returns null until fonts resolve (loaded or errored), then the app's `Stack` navigator
 */
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

  useEffect(() => {
    requestNotificationPermission().catch(() => {});
  }, []);

  useEffect(() => {
    // A font load error still unblocks the splash screen — the app renders with fallback fonts rather than hanging.
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
