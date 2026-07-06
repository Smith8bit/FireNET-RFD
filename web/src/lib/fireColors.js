// Fire-state palette, shared by the map's WebGL circle layer (components/map.jsx)
// and the map legend (pages/MapViewPage.jsx). Lives in its own module so both can
// import it without a component file having to export a non-component (which would
// trip react-refresh). Mirrors the mobile app's fire states.
export const FIRE_COLORS = {
    free: '#ef4444',     // ไฟอิสระ กำลังไหม้
    booked: '#facc15',   // ถูกเจ้าหน้าที่จอง
    resolved: '#d1d5dc', // ดับแล้ว
}
