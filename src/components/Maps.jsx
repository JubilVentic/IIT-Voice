import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { campusEmbedUrl, statusLabels, useVoice } from '../lib.js';
import { currentLocation } from '../current-location.js';

const emptyReports = [];
const pinIcon = resolved => L.divIcon({ className: '', html: `<div class="map-pin ${resolved ? 'resolved' : ''}"></div>`, iconSize: [22, 22], iconAnchor: [11, 11] });

export function ReportMap({ reports = emptyReports, large = false, pick = false, pin = null, onPick }) {
  const { data, openReport, toast } = useVoice();
  const container = useRef(null), mapRef = useRef(null), pickedMarker = useRef(null);
  const [locating, setLocating] = useState(false), [locationError, setLocationError] = useState(''), [accuracy, setAccuracy] = useState(null);
  const [locationPhase, setLocationPhase] = useState('');
  const locationRequest = useRef(0);
  const callbacks = useRef({ openReport, toast, onPick });
  callbacks.current = { openReport, toast, onPick };
  async function useCurrentLocation() {
    if (!navigator.geolocation) { setLocationError('This browser does not support current location. Select a pin on the map.'); return; }
    if (!window.isSecureContext) { setLocationError('Current location requires HTTPS or localhost. Select a pin manually.'); return; }
    const request = ++locationRequest.current;
    setLocating(true); setLocationError(''); setAccuracy(null);
    setLocationPhase('Finding your location…');
    try {
      const position = await currentLocation(navigator.geolocation, () => {
        if (request === locationRequest.current && mapRef.current) setLocationPhase('Retrying location…');
      });
      if (request !== locationRequest.current || !mapRef.current) return;
      const { latitude, longitude, accuracy } = position.coords;
      callbacks.current.onPick?.({ latitude: +latitude.toFixed(6), longitude: +longitude.toFixed(6) });
      mapRef.current.panTo([latitude, longitude], { animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches, duration: 0.35 });
      setAccuracy(Math.round(accuracy));
    } catch (error) {
      if (request !== locationRequest.current || !mapRef.current) return;
      setLocationError(error.code === 1 ? 'Location access is blocked. Allow location for this site and enable Location Services for your browser.' : 'Your browser could not provide a location. Check Location Services, or open IIT Voice in Chrome or Safari and allow location. You can still click or drag a pin.');
    } finally {
      if (request === locationRequest.current && mapRef.current) setLocating(false);
    }
  }
  useEffect(() => {
    const animate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const map = L.map(container.current, {
      zoomAnimation: animate, fadeAnimation: animate, markerZoomAnimation: animate,
      zoomSnap: 0.5, zoomDelta: 0.5, wheelPxPerZoomLevel: 180, wheelDebounceTime: 120,
    }).setView(data.map.center, data.map.zoom);
    mapRef.current = map;
    let errors = 0;
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' })
      .on('tileerror', () => { if (++errors === 3) callbacks.current.toast('Map tiles unavailable. Written campus locations remain available.'); }).addTo(map);
    if (pick) map.on('click', e => { locationRequest.current++; setLocating(false); setAccuracy(null); setLocationError(''); callbacks.current.onPick?.({ latitude: +e.latlng.lat.toFixed(6), longitude: +e.latlng.lng.toFixed(6) }); });
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container.current);
    return () => { locationRequest.current++; observer.disconnect(); map.remove(); mapRef.current = null; pickedMarker.current = null; };
  }, [data.map.center[0], data.map.center[1], data.map.zoom, pick]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || pick) return;
    const markers = L.layerGroup().addTo(map), points = [];
    reports.forEach(r => {
      if (r.latitude === null || r.longitude === null) return;
      points.push([r.latitude, r.longitude]);
      const popup = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = r.title;
      const status = document.createElement('span'); status.textContent = statusLabels[r.status];
      const button = document.createElement('button'); button.type = 'button'; button.className = 'btn link'; button.textContent = 'View concern →'; button.addEventListener('click', () => callbacks.current.openReport(r.id));
      popup.append(title, document.createElement('br'), status, document.createElement('br'), button);
      L.marker([r.latitude, r.longitude], { title: r.title, alt: r.title, icon: pinIcon(['resolved', 'closed'].includes(r.status)) }).bindPopup(popup).addTo(markers);
    });
    if (points.length) map.fitBounds(points, { padding: [35, 35], maxZoom: 17 });
    return () => { markers.remove(); };
  }, [reports, pick]);
  useEffect(() => {
    if (!pick || !mapRef.current) return;
    const map = mapRef.current;
    if (!pin) { pickedMarker.current?.remove(); pickedMarker.current = null; setAccuracy(null); return; }
    const point = [pin.latitude, pin.longitude];
    if (pickedMarker.current) {
      pickedMarker.current.getElement()?.classList.add('pin-glide');
      pickedMarker.current.setLatLng(point);
    }
    else pickedMarker.current = L.marker(point, { icon: pinIcon(false), draggable: true, autoPan: true, title: 'Drag to adjust report location', alt: 'Selected report location' })
      .on('dragstart', e => { e.target.getElement()?.classList.remove('pin-glide'); })
      .on('dragend', e => {
        const point = e.target.getLatLng();
        locationRequest.current++; setLocating(false); setLocationError('');
        setAccuracy(null);
        callbacks.current.onPick?.({ latitude: +point.lat.toFixed(6), longitude: +point.lng.toFixed(6) });
      }).addTo(map);
    if (!map.getBounds().contains(point)) map.panTo(point, { animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches, duration: 0.35 });
  }, [pin, pick]);
  return <>{pick && <><button type="button" className="btn primary" onClick={useCurrentLocation} disabled={locating}>{locating ? locationPhase : 'Use current location'}</button><p className="map-caption" role="status">{accuracy !== null ? `Device accuracy: about ${accuracy} m. Drag the pin to the exact spot.` : 'Click to place a pin, then drag it to adjust. Current location asks for browser permission.'}</p>{locationError && <p className="inline-error" role="alert">{locationError}</p>}</>}<div ref={container} id={pick ? 'pick-map' : 'campus-map'} className={`map ${large ? 'large' : ''} ${pick ? 'pick' : ''}`} aria-label={pick ? 'Click to select report location' : 'Campus concern map'}/></>;
}

export function CampusMap({ reports, large = false }) {
  const [view, setView] = useState('google');
  return <><div className="map-switch" role="group" aria-label="Campus map view"><button type="button" className="btn" data-map-view="google" aria-pressed={view === 'google'} onClick={() => setView('google')}>Google campus map</button><button type="button" className="btn" data-map-view="reports" aria-pressed={view === 'reports'} onClick={() => setView('reports')}>Report pins</button></div>{view === 'google' ? <iframe className={`campus-embed ${large ? 'large' : ''}`} title="MSU–IIT campus location on Google Maps" src={campusEmbedUrl} allowFullScreen loading="lazy" referrerPolicy="strict-origin-when-cross-origin"/> : <ReportMap reports={reports} large={large}/>}<p className="map-caption">{view === 'google' ? 'Explore the campus on Google Maps. Select Report pins to view IIT Voice concerns.' : 'IIT Voice report pins · Maroon: active · Gold: resolved. Select a pin for details.'}</p></>;
}
