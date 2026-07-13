// Single source of truth for fire status colors, shared by the map markers and the
// list/legend so a status always reads the same everywhere. Keyed by lifecycle state:
export const FIRE_COLORS = {
    free: '#ef4444',     // red   — unclaimed / active fire needing attention.
    booked: '#facc15',   // yellow — claimed by an officer, in progress.
    resolved: '#d1d5dc', // gray  — closed/resolved, visually de-emphasized.
}
