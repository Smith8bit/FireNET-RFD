import { useEffect, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import * as Location from 'expo-location'

const API_URL = 'http://10.0.2.2:8000'

type SendStatus = 'idle' | 'sending' | 'sent' | 'error'

export default function MapView() {
  const [location, setLocation] = useState<Location.LocationObject | null>(null)
  const [locationError, setLocationError] = useState<string | null>(null)
  const [sendStatus, setSendStatus] = useState<SendStatus>('idle')
  const [lastSentAt, setLastSentAt] = useState<string | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)

  async function getAndSendLocation() {
    setLocationError(null)
    setSendError(null)
    setSendStatus('idle')

    const { status } = await Location.requestForegroundPermissionsAsync()
    if (status !== 'granted') {
      setLocationError('Location permission denied')
      return
    }

    let loc: Location.LocationObject
    try {
      loc = await Location.getCurrentPositionAsync({})
      setLocation(loc)
    } catch {
      setLocationError('Location unavailable. Enable location services and try again.')
      return
    }

    setSendStatus('sending')
    try {
      const res = await fetch(`${API_URL}/officers/me/location`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.detail ?? `HTTP ${res.status}`)
      }
      const data = await res.json()
      setLastSentAt(data.last_updated)
      setSendStatus('sent')
    } catch (e: any) {
      setSendError(e?.message ?? 'Failed to send location')
      setSendStatus('error')
    }
  }

  useEffect(() => {
    getAndSendLocation()
  }, [])

  const sentAt = lastSentAt
    ? new Date(lastSentAt).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'medium' })
    : null

  return (
    <View style={styles.container}>
      {location ? (
        <View style={styles.coordBox}>
          <Text style={styles.label}>Latitude</Text>
          <Text style={styles.value}>{location.coords.latitude.toFixed(6)}</Text>
          <Text style={styles.label}>Longitude</Text>
          <Text style={styles.value}>{location.coords.longitude.toFixed(6)}</Text>
        </View>
      ) : locationError ? (
        <Text style={styles.error}>{locationError}</Text>
      ) : (
        <Text style={styles.loading}>Getting location...</Text>
      )}

      {sendStatus === 'sending' && (
        <View style={styles.statusRow}>
          <ActivityIndicator size="small" color="#007AFF" />
          <Text style={styles.statusText}>Sending location...</Text>
        </View>
      )}
      {sendStatus === 'sent' && sentAt && (
        <Text style={styles.sent}>Stored at {sentAt}</Text>
      )}
      {sendStatus === 'error' && sendError && (
        <Text style={styles.error}>{sendError}</Text>
      )}

      <TouchableOpacity style={styles.button} onPress={getAndSendLocation}>
        <Text style={styles.buttonText}>Refresh & Send Location</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 },
  coordBox: { alignItems: 'center', gap: 4 },
  label: { fontSize: 12, color: '#888', textTransform: 'uppercase', letterSpacing: 1 },
  value: { fontSize: 24, fontWeight: '600', color: '#111' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusText: { color: '#007AFF' },
  sent: { fontSize: 13, color: '#34C759' },
  error: { color: 'red', textAlign: 'center', paddingHorizontal: 24 },
  loading: { color: '#888' },
  button: { marginTop: 8, paddingVertical: 10, paddingHorizontal: 24, backgroundColor: '#007AFF', borderRadius: 8 },
  buttonText: { color: '#fff', fontWeight: '600' },
})
