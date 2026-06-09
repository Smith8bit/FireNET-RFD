import { useEffect, useRef, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { FireIcon } from '@heroicons/react/24/solid'
import { UserCircleIcon } from '@heroicons/react/20/solid'
import { useMapSelection } from '../functions/stateStore'

const ICON_DEFAULT = { color: '#ef4444', filter: 'drop-shadow(0 0 2px rgba(0,0,0,0.4))', transition: 'color 120ms ease, transform 120ms ease', transform: 'scale(1)', width: '22px', height: '22px', cursor: 'pointer' }
const ICON_HOVER   = { color: '#facc15', transform: 'scale(1.8)', filter: 'drop-shadow(0 0 4px rgba(250,204,21,0.5))' }

function renderFireIcon(container, style) {
    const icon = createElement(FireIcon, { style: { ...ICON_DEFAULT, ...style } })
    container._reactRoot ??= createRoot(container)
    container._reactRoot.render(icon)
}

function makeOfficerEl(active, name) {
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
    })
    label.textContent = name ?? 'เจ้าหน้าที่'

    const circle = document.createElement('div')
    Object.assign(circle.style, {
        width: '26px',
        height: '26px',
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

export default function MapView({ layer, startPoint, points, officers = [] }) {
    const mapRef = useRef(null)
    const markerInstancesRef = useRef([])
    const markerElementsRef = useRef(new globalThis.Map())
    const officerMarkerInstancesRef = useRef([])

    const focusedId = useMapSelection((s) => s.focusedId)
    const hoveredId = useMapSelection((s) => s.hoveredId)
    const setFocused = useMapSelection((s) => s.setFocused)

    useEffect(() => {
        const map = new maplibregl.Map({
            container: 'map',
            style: layer,
            center: [startPoint.lng, startPoint.lat],
            zoom: 8,
            maxZoom: 20,
            preserveDrawingBuffer: true,
        })

        map.setRenderWorldCopies(false)
        map.dragRotate.disable()
        map.doubleClickZoom.disable()
        map.addControl(new maplibregl.NavigationControl(), 'top-right')

        mapRef.current = map
        return () => map.remove()
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
        if (!mapRef.current) return

        markerInstancesRef.current.forEach((m) => m.remove())
        markerElementsRef.current.forEach((el) => el._reactRoot?.unmount())
        markerInstancesRef.current = []
        markerElementsRef.current = new globalThis.Map()

        points.forEach((point) => {
            const el = document.createElement('div')
            el.style.cursor = 'pointer'
            renderFireIcon(el, {})
            el.addEventListener('click', () => setFocused(point.id))

            const marker = new maplibregl.Marker({ element: el })
                .setLngLat([point.lng, point.lat])
                .addTo(mapRef.current)

            markerInstancesRef.current.push(marker)
            markerElementsRef.current.set(point.id, el)
        })
    }, [points, setFocused])

    useEffect(() => {
        markerElementsRef.current.forEach((el) => renderFireIcon(el, {}))
        const activeId = hoveredId ?? focusedId
        if (activeId != null) {
            const el = markerElementsRef.current.get(activeId)
            if (el) renderFireIcon(el, ICON_HOVER)
        }
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
                const el = makeOfficerEl(o.active, o.name)

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
}
