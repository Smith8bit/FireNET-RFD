import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

export default function Map({ layer, startPoint, markers }) {
    const mapRef = useRef(null);

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
        if (mapRef.current) {
            mapRef.current.setStyle(layer);
        }
    }, [layer]);
    
    useEffect(() => {
       markers.forEach((marker) => {
        marker.forEach((feature) => {
            const m = new maplibregl.Marker()
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
       }); 
    });
    }, [markers]);

    return (
        <div style={{ width: '100%', height: '100%' }}>
            <div id="map" style={{ width: '100%', height: '100%' }}></div>
        </div>
    );
}
