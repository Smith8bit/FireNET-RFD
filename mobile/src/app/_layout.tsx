import { useEffect } from "react";
import { Stack } from "expo-router";
import AuthProvider from "@/providers/AuthProvider";
import { requestNotificationPermission } from "@/lib/push";
import "@/lib/locationTask"; // registers the background location task at every (incl. headless) launch

export default function RootLayout() {
  // Ask for the notification permission as soon as the app launches, rather than
  // waiting until a verified field officer signs in (registerPushToken).
  useEffect(() => {
    requestNotificationPermission().catch(() => {});
  }, []);

  return (
    <AuthProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </AuthProvider>
  );
}
