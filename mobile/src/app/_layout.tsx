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

  useEffect(() => {
    requestNotificationPermission().catch(() => {});
  }, []);

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
