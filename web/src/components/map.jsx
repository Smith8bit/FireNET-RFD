import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

function addOverlay(map, marker) {
    if (!map.getSource(marker.id)) {
        map.addSource(marker.id, {
            type: 'raster',
            tiles: marker.tiles,
            tileSize: marker.tileSize || 256,
        });
    }
    if (!map.getLayer(marker.id)) {
        map.addLayer({
            id: marker.id,
            type: 'raster',
            source: marker.id,
            paint: { 'raster-opacity': 0.7 },
        });
    }
}

export default function Map({ layer, startPoint, markers }) {
    const mapRef = useRef(null);
    const activeOverlaysRef = useRef([]);

    useEffect(() => {
        const map = new maplibregl.Map({
            container: "map",
            style: layer,
            center: [startPoint.lng, startPoint.lat],
            zoom: 12,
            maxZoom: 20
        });

        map.setRenderWorldCopies(false);
        map.dragRotate.disable();
        map.doubleClickZoom.disable();
        map.addControl(new maplibregl.NavigationControl(), 'top-right');

        map.on('style.load', () => {
            activeOverlaysRef.current.forEach(m => addOverlay(map, m));
        });

        mapRef.current = map;
        return () => map.remove();
    }, []);

    useEffect(() => {
        if (mapRef.current) {
            mapRef.current.setStyle(layer);
        }
    }, [layer]);

    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        const apply = () => {
            const prevIds = activeOverlaysRef.current.map(m => m.id);
            const newIds = markers.map(m => m.id);

            prevIds.filter(id => !newIds.includes(id)).forEach(id => {
                if (map.getLayer(id)) map.removeLayer(id);
                if (map.getSource(id)) map.removeSource(id);
            });

            markers.forEach(m => addOverlay(map, m));
            activeOverlaysRef.current = markers;
        };

        if (map.isStyleLoaded()) {
            apply();
        } else {
            map.once('style.load', apply);
        }
    }, [markers]);

    return (
        <div style={{ width: '100%', height: '100%' }}>
            <div id="map" style={{ width: '100%', height: '100%' }}></div>
        </div>
    );
}
