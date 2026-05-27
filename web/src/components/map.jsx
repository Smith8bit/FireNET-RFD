import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useHoverStore } from '../functions/stateStore'

const DEFAULT_STYLE = {
    width: '16px',
    height: '16px',
    borderRadius: '50%',
    background: '#ef4444',
    border: '2px solid white',
    boxShadow: '0 0 2px rgba(0,0,0,0.4)',
    cursor: 'pointer',
    transition: 'transform 120ms ease, background 120ms ease, box-shadow 120ms ease',
    transform: 'scale(1)',
};

const HOVER_STYLE = {
    background: '#facc15',
    transform: 'scale(1.8)',
    boxShadow: '0 0 0 4px rgba(250, 204, 21, 0.4)',
};

function applyStyle(el, style) {
    Object.assign(el.style, style);
}

export default function Map({ layer, startPoint, markers }) {
    const mapRef = useRef(null);
    const markerInstancesRef = useRef([]);
    const markerElementsRef = useRef(new window.Map());

    const hoveredId = useHoverStore((s) => s.hoveredMarker?.id ?? null);

    useEffect(() => {
        const map = new maplibregl.Map({
            container: "map",
            style: layer,
            center: [startPoint.lng, startPoint.lat],
            zoom: 8,
            maxZoom: 20,
            preserveDrawingBuffer: true
        });

        map.setRenderWorldCopies(false);
        map.dragRotate.disable();
        map.doubleClickZoom.disable();
        map.addControl(new maplibregl.NavigationControl(), 'top-right');

        mapRef.current = map;
        return () => map.remove();
    }, []);

    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        if (map.isStyleLoaded()) {
            map.setStyle(layer);
        } else {
            const apply = () => map.setStyle(layer);
            map.once('load', apply);
            return () => map.off('load', apply);
        }
    }, [layer]);

    useEffect(() => {
        if (!mapRef.current) return;

        markerInstancesRef.current.forEach((m) => m.remove());
        markerInstancesRef.current = [];
        markerElementsRef.current = new window.Map();

        markers.forEach((group) => {
            group.forEach((feature, i) => {
                const wrapper = document.createElement('div');
                const el = document.createElement('div');
                applyStyle(el, DEFAULT_STYLE);
                wrapper.appendChild(el);

                const m = new maplibregl.Marker({ element: wrapper })
                    .setLngLat([feature.LONGITUDE, feature.LATITUDE])
                    .setPopup(new maplibregl.Popup().setHTML(`
                        <div>
                            <h3>${feature.DATE}</h3>
                            <p>ตำบล: ${feature.TUMBOON}</p>
                            <p>อำเภอ: ${feature.AUMPER}</p>
                            <p>จังหวัด: ${feature.PROVINCE}</p>
                            <p>Lat/Lan: ${feature.LATITUDE}/${feature.LONGITUDE}</p>
                        </div>
                    `))
                    .addTo(mapRef.current);

                markerInstancesRef.current.push(m);
                markerElementsRef.current.set(i, el);
            });
        });
    }, [markers]);

    useEffect(() => {
        markerElementsRef.current.forEach((el) => applyStyle(el, DEFAULT_STYLE));
        if (hoveredId != null) {
            const el = markerElementsRef.current.get(hoveredId);
            if (el) applyStyle(el, HOVER_STYLE);
        }
    }, [hoveredId]);

    return (
        <div style={{ width: '100%', height: '100%' }}>
            <div id="map" style={{ width: '100%', height: '100%' }}></div>
        </div>
    );
}
