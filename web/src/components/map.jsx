import { useEffect, useRef, createElement, forwardRef, useImperativeHandle, memo } from 'react'
import { createRoot } from 'react-dom/client'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { UserCircleIcon } from '@heroicons/react/20/solid'
import { useMapSelection } from '../lib/stateStore'

// Fires are drawn as a WebGL circle layer (one source, not one DOM marker per
// fire) so the map stays smooth with thousands of points.
const FIRES_SOURCE = 'fires'
const FIRES_LAYER = 'fire-circles'

// same palette as the mobile app's fire states (mirrored in MapViewPage's legend)
const FIRE_COLORS = {
    resolved: '#d1d5dc', // ดับแล้ว
    booked: '#facc15', // ถูกเจ้าหน้าที่จอง
    free: '#ef4444', // ไฟอิสระ กำลังไหม้
}

function firesToGeoJSON(points) {
    return {
        type: 'FeatureCollection',
        features: points.map((p) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
            properties: { id: p.id, status: p.status, booked: p.booked },
        })),
    }
}

// like mobile: color tells the fire's state; selection grows the dot + stroke
function firePaint(activeId) {
    const isActive = ['==', ['get', 'id'], activeId ?? '']
    return {
        'circle-color': [
            'case',
            isActive,
            '#FFBF00', // selected/focused spot
            ['==', ['get', 'status'], true],
            FIRE_COLORS.resolved,
            ['==', ['get', 'booked'], true],
            FIRE_COLORS.booked,
            FIRE_COLORS.free,
        ],
        'circle-radius': ['case', isActive, 8, 4.5],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': ['case', isActive, 2.5, 1.5],
    }
}

// last-location timestamp shown under an officer's name on the map
const LOC_TIME_FORMAT = new Intl.DateTimeFormat('th-TH', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
})

function formatLocTime(value) {
    if (!value) return ''
    const d = new Date(value)
    return isNaN(d) ? '' : `${LOC_TIME_FORMAT.format(d)} น.`
}

function makeOfficerEl(active, name, lastUpdated) {
    const wrapper = document.createElement('div')
    Object.assign(wrapper.style, {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '2px',
        cursor: 'pointer',
    })

    const label = document.createElement('div')
    Object.assign(label.style, {
        fontSize: '11px',
        fontWeight: '600',
        color: '#111',
        background: 'rgba(255,255,255,0.85)',
        borderRadius: '4px',
        padding: '1px 5px',
        whiteSpace: 'nowrap',
        boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
        lineHeight: '1.4',
        textAlign: 'center',
    })

    const nameLine = document.createElement('div')
    nameLine.textContent = name ?? 'เจ้าหน้าที่'
    label.appendChild(nameLine)

    const timeText = formatLocTime(lastUpdated)
    if (timeText) {
        const timeLine = document.createElement('div')
        Object.assign(timeLine.style, {
            fontSize: '10px',
            fontWeight: '400',
            color: '#6b7280',
        })
        timeLine.textContent = timeText
        label.appendChild(timeLine)
    }

    const circle = document.createElement('div')
    Object.assign(circle.style, {
        width: '20px',
        height: '20px',
        borderRadius: '50%',
        border: `2.5px solid ${active ? '#22c55e' : '#9ca3af'}`,
        background: 'white',
        boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'border-color 120ms ease',
    })
    circle._reactRoot = createRoot(circle)
    circle._reactRoot.render(createElement(UserCircleIcon, {
        style: { color: active ? '#16a34a' : '#9ca3af', width: '20px', height: '20px' }
    }))

    wrapper.appendChild(label)
    wrapper.appendChild(circle)
    wrapper._reactRoot = circle._reactRoot
    return wrapper
}

const MapView = forwardRef(function MapView({ layer, startPoint, startZoom = 10, points, officers = [] }, ref) {
    const mapRef = useRef(null)
    const pointsRef = useRef(points)
    const activeIdRef = useRef(null)
    const officerMarkerInstancesRef = useRef([])

    const focusedId = useMapSelection((s) => s.focusedId)
    const hoveredId = useMapSelection((s) => s.hoveredId)
    const setFocused = useMapSelection((s) => s.setFocused)
    const clearSelection = useMapSelection((s) => s.clear)

    // let the parent recenter the map to the user's starting view, plus drive
    // the zoom buttons that live in the floating map-control group
    useImperativeHandle(ref, () => ({
        resetView: () => {
            mapRef.current?.flyTo({ center: [startPoint.lng, startPoint.lat], zoom: startZoom, duration: 800 })
        },
        zoomIn: () => mapRef.current?.zoomIn(),
        zoomOut: () => mapRef.current?.zoomOut(),
    }), [startPoint, startZoom])

    useEffect(() => {
        const map = new maplibregl.Map({
            container: 'map',
            style: layer,
            center: [startPoint.lng, startPoint.lat],
            zoom: startZoom,
            maxZoom: 20,
            preserveDrawingBuffer: true,
        })

        map.setRenderWorldCopies(false)
        map.dragRotate.disable()
        map.doubleClickZoom.disable()
        // zoom buttons live in the floating control group (see MapViewPage) so they
        // stay grouped with the other controls and shift left when the panel opens

        // setStyle() wipes custom sources, so re-add fires after every style load
        map.on('style.load', () => {
            if (map.getSource(FIRES_SOURCE)) return
            map.addSource(FIRES_SOURCE, { type: 'geojson', data: firesToGeoJSON(pointsRef.current) })
            map.addLayer({ id: FIRES_LAYER, type: 'circle', source: FIRES_SOURCE, paint: firePaint(activeIdRef.current) })
        })
        map.on('click', FIRES_LAYER, (e) => {
            const feature = e.features?.[0]
            if (feature) setFocused(feature.properties.id)
        })
        // a click on empty map (not on a fire) clears the current selection
        map.on('click', (e) => {
            const hit = map.getLayer(FIRES_LAYER)
                && map.queryRenderedFeatures(e.point, { layers: [FIRES_LAYER] }).length > 0
            if (!hit) clearSelection()
        })
        map.on('mouseenter', FIRES_LAYER, () => { map.getCanvas().style.cursor = 'pointer' })
        map.on('mouseleave', FIRES_LAYER, () => { map.getCanvas().style.cursor = '' })

        mapRef.current = map

        // the map container resizes when side panels collapse/expand, which
        // doesn't fire a window resize — keep the canvas in sync ourselves
        const ro = new ResizeObserver(() => map.resize())
        ro.observe(map.getContainer())

        return () => {
            ro.disconnect()
            map.remove()
        }
    }, [])

    useEffect(() => {
        const map = mapRef.current
        if (!map) return
        if (map.isStyleLoaded()) {
            map.setStyle(layer)
        } else {
            const apply = () => map.setStyle(layer)
            map.once('load', apply)
            return () => map.off('load', apply)
        }
    }, [layer])

    useEffect(() => {
        pointsRef.current = points
        const source = mapRef.current?.getSource(FIRES_SOURCE)
        if (source) source.setData(firesToGeoJSON(points))
        // if the style is still loading, the style.load handler adds the
        // source with the latest pointsRef
    }, [points])

    // like mobile: selecting a fire (map click or list card) flies the camera to it
    useEffect(() => {
        const map = mapRef.current
        if (!map || !focusedId) return
        const p = pointsRef.current?.find((x) => x.id === focusedId)
        if (p) map.flyTo({ center: [p.lng, p.lat], zoom: 14, duration: 1000 })
    }, [focusedId])

    useEffect(() => {
        const activeId = hoveredId ?? focusedId ?? null
        activeIdRef.current = activeId
        const map = mapRef.current
        if (!map?.getLayer(FIRES_LAYER)) return
        const paint = firePaint(activeId)
        map.setPaintProperty(FIRES_LAYER, 'circle-color', paint['circle-color'])
        map.setPaintProperty(FIRES_LAYER, 'circle-radius', paint['circle-radius'])
        map.setPaintProperty(FIRES_LAYER, 'circle-stroke-width', paint['circle-stroke-width'])
    }, [hoveredId, focusedId])

    useEffect(() => {
        if (!mapRef.current) return

        officerMarkerInstancesRef.current.forEach((m) => {
            m.getElement()._reactRoot?.unmount()
            m.remove()
        })
        officerMarkerInstancesRef.current = []

        officers
            .filter((o) => o.location?.latitude != null && o.location?.longitude != null)
            .forEach((o) => {
                const el = makeOfficerEl(o.active, o.name, o.last_updated)

                const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
                    .setLngLat([o.location.longitude, o.location.latitude])
                    .addTo(mapRef.current)

                officerMarkerInstancesRef.current.push(marker)
            })
    }, [officers])

    return (
        <div style={{ width: '100%', height: '100%' }}>
            <div id="map" style={{ width: '100%', height: '100%' }}></div>
        </div>
    )
})

// the map instance is built once; collapsing side panels only changes layout,
// so skip re-rendering as long as the data/layer props are unchanged
export default memo(MapView)
