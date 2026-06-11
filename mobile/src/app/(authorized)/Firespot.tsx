import { useCallback, useEffect } from 'react'
import { View, Text, StyleSheet, ScrollView, Alert, TouchableOpacity } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useFireStore } from '@/stores/fireStore'
import { formatDetectedAt } from '@/utils/format'

export default function Firespot() {
  const reservedFire = useFireStore((s) => s.reservedFire)
  const loadReservedFire = useFireStore((s) => s.loadReservedFire)
  const resolveFire = useFireStore((s) => s.resolveFire)
  const online = useFireStore((s) => s.online)

  useEffect(() => {
    loadReservedFire()
  }, [loadReservedFire])

  const onResolve = useCallback(() => {
    Alert.alert('ยืนยันการดับไฟ', 'ยืนยันว่าไฟจุดนี้ถูกดับเรียบร้อยแล้วใช่หรือไม่', [
      { text: 'ยกเลิก', style: 'cancel' },
      {
        text: 'ยืนยัน',
        onPress: async () => {
          try {
            await resolveFire()
          } catch (e) {
            Alert.alert(
              'ไม่สำเร็จ',
              e instanceof Error ? e.message : 'ไม่สามารถบันทึกการดับไฟได้ กรุณาลองใหม่อีกครั้ง',
            )
          }
        },
      },
    ])
  }, [resolveFire])

  if (!reservedFire) {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="flame-outline" size={48} color="#d1d5db" />
        <Text style={styles.emptyText}>ยังไม่มีไฟที่จอง</Text>
        <Text style={styles.emptyHint}>กดปุ่ม "จอง" ในรายการไฟบนแผนที่เพื่อรับผิดชอบไฟ</Text>
      </View>
    )
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Ionicons
          name={reservedFire.status ? 'checkmark-circle' : 'flame'}
          size={28}
          color={reservedFire.status ? '#10b981' : '#ef4444'}
        />
        <Text style={styles.title}>{reservedFire.name}</Text>
        <View style={[styles.badge, reservedFire.status ? styles.badgeResolved : styles.badgeActive]}>
          <Text style={styles.badgeText}>{reservedFire.status ? 'ดับแล้ว' : 'กำลังไหม้'}</Text>
        </View>
      </View>

      <View style={styles.card}>
        <Row label="ตรวจพบเมื่อ" value={formatDetectedAt(reservedFire.detected_at)} />
        <Row label="สถานะ" value={reservedFire.status ? 'ดับแล้ว' : 'กำลังไหม้'} />
        <Row label="ประเภท" value={reservedFire.type} />
        <Row label="ตำบล" value={reservedFire.tumboon} />
        <Row label="อำเภอ" value={reservedFire.aumper} />
        <Row label="จังหวัด" value={reservedFire.province} />
        <Row
          label="พิกัด"
          value={`${reservedFire.lat.toFixed(5)}, ${reservedFire.lng.toFixed(5)}`}
        />
      </View>

      {!reservedFire.status && (
        <TouchableOpacity
          style={[styles.resolveButton, !online && styles.resolveButtonDisabled]}
          disabled={!online}
          onPress={onResolve}
        >
          <Ionicons name="checkmark-circle-outline" size={20} color="#ffffff" />
          <Text style={styles.resolveButtonText}>ดับไฟแล้ว</Text>
        </TouchableOpacity>
      )}

      <Text style={styles.note}>
        {reservedFire.status
          ? 'ดับไฟเรียบร้อยแล้ว คุณสามารถจองจุดไฟใหม่ได้จากแผนที่'
          : online
            ? 'เจ้าหน้าที่ 1 คน จองได้ครั้งละ 1 จุดไฟ ต้องดับไฟเดิมก่อนจึงจะจองจุดใหม่ได้'
            : 'คุณอยู่ในสถานะออฟไลน์ ต้องออนไลน์ก่อนจึงจะบันทึกการดับไฟได้'}
      </Text>
    </ScrollView>
  )
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value ?? '-'}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  content: {
    padding: 16,
    paddingTop: 48,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    marginLeft: 8,
    flexShrink: 1,
  },
  badge: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginLeft: 'auto',
  },
  badgeActive: {
    backgroundColor: '#ef4444',
  },
  badgeResolved: {
    backgroundColor: '#10b981',
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    paddingHorizontal: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  rowLabel: {
    fontSize: 14,
    color: '#6b7280',
  },
  rowValue: {
    fontSize: 14,
    fontWeight: '500',
    flexShrink: 1,
    textAlign: 'right',
    marginLeft: 16,
  },
  resolveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#10b981',
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 16,
  },
  resolveButtonDisabled: {
    backgroundColor: '#d1d5db',
  },
  resolveButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  note: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 12,
    textAlign: 'center',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6b7280',
    marginTop: 12,
  },
  emptyHint: {
    fontSize: 13,
    color: '#9ca3af',
    marginTop: 4,
    textAlign: 'center',
  },
})
