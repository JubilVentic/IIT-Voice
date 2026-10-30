import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { priorities, reportCategories, statusLabels, useVoice } from '../lib.js';
import campusPlanUrl from '../assets/tibanga-site-plan.png';
import {
  campusBounds,
  planPosition,
  gpsPosition,
  isOnPlan,
  planUnitsPerMeter,
} from '../campus-plan.js';
import { reportHotspots } from '../report-summary.js';
import { currentLocation } from '../current-location.js';
import { CategoryOptions } from './Categories.jsx';
import { campusImagePoint, indoorBuildings } from '../indoor-location.js';
import {
  categoryPins,
  priorityPins,
  pinAppearance,
  hasMapPin,
  filterMapReports,
} from '../map-markers.js';

const emptyReports = [];
function buildingHoverImage(building, id) {
  const width = campusBounds[1][1] - campusBounds[0][1],
    height = campusBounds[1][0] - campusBounds[0][0];
  const xs = building.outline.map(([x]) => x * width),
    ys = building.outline.map(([, y]) => y * height);
  const points = xs.map((x, index) => `${x},${ys[index]}`).join(' ');
  const center = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('aria-hidden', 'true');
  // Only the roof is copied; the courtyard and nearby buildings stay on the base map.
  svg.innerHTML = `
    <defs><clipPath id="${id}"><polygon points="${points}" /></clipPath></defs>
    <polygon class="building-hover-original" points="${points}" fill="white" />
    <g class="building-hover-image" style="transform-origin:${center[0]}px ${center[1]}px">
      <image href="${campusPlanUrl}" width="${width}" height="${height}" clip-path="url(#${id})" />
    </g>`;
  return svg;
}
export const pinIcon = ({ color = '#7a203c', symbol = '' } = {}) =>
  L.divIcon({
    className: 'report-marker',
    html: `<svg class="map-pin" viewBox="0 0 32 44" aria-hidden="true"><path fill="${color}" stroke="white" stroke-width="2.5" d="M16 1.5C8 1.5 1.5 8 1.5 16c0 10 14.5 25.5 14.5 25.5S30.5 26 30.5 16C30.5 8 24 1.5 16 1.5Z"/>${symbol ? `<text x="16" y="20" text-anchor="middle" fill="white" font-size="13" font-weight="700" font-family="sans-serif">${symbol}</text>` : '<circle cx="16" cy="16" r="5" fill="white"/>'}</svg>`,
    iconSize: [32, 44],
    iconAnchor: [16, 42],
    popupAnchor: [0, -38],
  });

export function ReportMap({
  reports = emptyReports,
  large = false,
  pick = false,
  pin = null,
  onPick,
  onBuildingPick,
  colorBy = 'priority',
  density = false,
  mapFrameClassName = '',
  mapOverlay,
  hidePickControls = false,
  fitCampusOnResize = false,
}) {
  const { openReport, toast } = useVoice();
  const container = useRef(null),
    mapRef = useRef(null),
    pickedMarker = useRef(null);
  const [locating, setLocating] = useState(false),
    [locationError, setLocationError] = useState(''),
    [accuracy, setAccuracy] = useState(null);
  const [locationPhase, setLocationPhase] = useState('');
  const locationRequest = useRef(0);
  const fittedReports = useRef(reports);
  const callbacks = useRef({ openReport, toast, onPick, pin, onBuildingPick, fitCampusOnResize });
  callbacks.current = { openReport, toast, onPick, pin, onBuildingPick, fitCampusOnResize };
  async function useCurrentLocation() {
    if (!navigator.geolocation) {
      setLocationError('This browser does not support current location. Select a pin on the map.');
      return;
    }
    if (!window.isSecureContext) {
      setLocationError('Current location requires HTTPS or localhost. Select a pin manually.');
      return;
    }
    const request = ++locationRequest.current;
    setLocating(true);
    setLocationError('');
    setAccuracy(null);
    setLocationPhase('Finding your location…');
    try {
      const position = await currentLocation(navigator.geolocation, () => {
        if (request === locationRequest.current && mapRef.current)
          setLocationPhase('Retrying location…');
      });
      if (request !== locationRequest.current || !mapRef.current) return;
      const { latitude, longitude, accuracy } = position.coords;
      if (!isOnPlan({ latitude, longitude })) {
        setLocationError(
          'Your device location is outside the supplied MSU–IIT site plan. Select the concern’s campus location on the plan.'
        );
        return;
      }
      callbacks.current.onPick?.({
        latitude: +latitude.toFixed(6),
        longitude: +longitude.toFixed(6),
      });
      mapRef.current.panTo(planPosition({ latitude, longitude }), {
        animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        duration: 0.35,
      });
      setAccuracy(Math.round(accuracy));
    } catch (error) {
      if (request !== locationRequest.current || !mapRef.current) return;
      setLocationError(
        error.code === 1
          ? 'Location access is blocked. Allow location for this site and enable Location Services for your browser.'
          : 'Your browser could not provide a location. Check Location Services, or open IIT Voice in Chrome or Safari and allow location. You can still click or drag a pin.'
      );
    } finally {
      if (request === locationRequest.current && mapRef.current) setLocating(false);
    }
  }
  useEffect(() => {
    const animate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const map = L.map(container.current, {
      crs: L.CRS.Simple,
      minZoom: -4,
      maxZoom: 2.5,
      maxBounds: L.latLngBounds(campusBounds).pad(0.15),
      maxBoundsViscosity: 1,
      zoomAnimation: animate,
      fadeAnimation: animate,
      markerZoomAnimation: animate,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 180,
      wheelDebounceTime: 120,
    }).setView([437, 605], -1);
    mapRef.current = map;
    L.imageOverlay(campusPlanUrl, campusBounds, {
      alt: 'MSU–IIT Tibanga campus site development plan',
      attribution:
        'MSU–IIT · Tibanga site plan · Building lookup: © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
    })
      .on('error', () => {
        callbacks.current.toast(
          'Campus plan unavailable. Written campus locations remain available.'
        );
      })
      .addTo(map);
    const fitControl = L.control({ position: 'topright' });
    fitControl.onAdd = () => {
      const button = L.DomUtil.create('button', 'btn campus-fit');
      button.type = 'button';
      button.textContent = 'Fit campus';
      button.setAttribute('aria-label', 'Show the whole campus plan');
      L.DomEvent.disableClickPropagation(button);
      L.DomEvent.disableScrollPropagation(button);
      button.addEventListener('click', () => map.fitBounds(campusBounds, { padding: [16, 16] }));
      return button;
    };
    fitControl.addTo(map);
    const northControl = L.control({ position: 'bottomleft' });
    northControl.onAdd = () => {
      const compass = L.DomUtil.create('div', 'campus-north');
      compass.textContent = 'N →';
      compass.title = 'Geographic north points approximately right on this site plan';
      compass.setAttribute('aria-label', compass.title);
      return compass;
    };
    northControl.addTo(map);
    if (pick)
      map.on('click', (e) => {
        const point = gpsPosition(e.latlng);
        if (!isOnPlan(point)) {
          setLocationError('Select a location within the campus drawing.');
          return;
        }
        locationRequest.current++;
        setLocating(false);
        setAccuracy(null);
        setLocationError('');
        callbacks.current.onPick?.(point);
      });
    let fitted = false;
    const observer = new ResizeObserver(() => {
      // A hidden wizard step has no size; preserve the map view until it is visible again.
      if (!container.current?.clientWidth || !container.current?.clientHeight) return;
      map.invalidateSize();
      if (
        (!fitted || callbacks.current.fitCampusOnResize) &&
        container.current?.clientWidth &&
        container.current?.clientHeight
      ) {
        map.fitBounds(campusBounds, { padding: [16, 16], animate: false });
        // A whole landscape plan becomes unreadably small on a phone.
        // Start closer to campus; Fit campus remains available for orientation.
        if (!callbacks.current.fitCampusOnResize && container.current.clientWidth < 600)
          map.setZoom(Math.max(map.getZoom(), -0.5), { animate: false });
        fitted = true;
      }
    });
    observer.observe(container.current);
    return () => {
      locationRequest.current++;
      observer.disconnect();
      // Leaflet 1.9 leaves a zoom-transition timer running after remove().
      map._animatingZoom = false;
      map.remove();
      mapRef.current = null;
      pickedMarker.current = null;
    };
  }, [pick]);
  useEffect(() => {
    if (fitCampusOnResize && mapRef.current) {
      mapRef.current.invalidateSize();
      mapRef.current.fitBounds(campusBounds, { padding: [16, 16], animate: false });
    }
  }, [fitCampusOnResize]);
  const selectableBuildings = pick && Boolean(onBuildingPick);
  useEffect(() => {
    if (!selectableBuildings || !mapRef.current) return;
    const outlines = L.layerGroup().addTo(mapRef.current);
    indoorBuildings.forEach((building) => {
      const shape = L.polygon(building.outline.map(campusImagePoint), {
        color: '#404040',
        weight: 1.25,
        opacity: 0,
        fillColor: '#404040',
        fillOpacity: 0,
        bubblingMouseEvents: false,
        className: 'indoor-building-outline',
      }).addTo(outlines);
      const open = () => callbacks.current.onBuildingPick?.(building);
      shape.on('click', open);
      const element = shape.getElement();
      const image = buildingHoverImage(building, `building-clip-${L.stamp(shape)}`);
      image.dataset.buildingId = building.id;
      L.svgOverlay(image, campusBounds, { className: 'building-hover-overlay' }).addTo(outlines);
      let hovering = false;
      const updateHover = () => {
        const active = hovering || element.matches(':focus');
        element.classList.toggle('is-hovered', active);
        image.classList.toggle('is-hovered', active);
      };
      shape.on('mouseover', () => {
        hovering = true;
        updateHover();
      });
      shape.on('mouseout', () => {
        hovering = false;
        updateHover();
      });
      element.dataset.buildingId = building.id;
      element.setAttribute('tabindex', '0');
      element.setAttribute('role', 'button');
      element.setAttribute(
        'aria-label',
        building.floors.length ? `Open ${building.name} floor plans` : `Select ${building.name}`
      );
      element.addEventListener('focus', updateHover);
      element.addEventListener('blur', updateHover);
      element.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          L.DomEvent.stop(event);
          open();
        }
      });
    });
    return () => outlines.remove();
  }, [selectableBuildings]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || pick) return;
    const markers = L.layerGroup().addTo(map);
    if (density) {
      reportHotspots(reports).forEach((cell) => {
        const color = cell.count >= 4 ? '#98283d' : cell.count >= 2 ? '#bb5630' : '#aa701b';
        const size = 28 + Math.min(14, cell.count * 2);
        const popup = document.createElement('div');
        const heading = document.createElement('strong');
        heading.textContent = `${cell.count} ${cell.count === 1 ? 'report' : 'reports'} in this area`;
        popup.append(heading);
        const list = document.createElement('div');
        list.className = 'hotspot-report-list';
        cell.reports.forEach((report) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'btn link';
          button.textContent = `IV-${String(report.id).padStart(4, '0')} · ${report.title}`;
          button.addEventListener('click', () => callbacks.current.openReport(report.id));
          list.append(button);
        });
        popup.append(list);
        L.circle(planPosition(cell), {
          radius: 35 * planUnitsPerMeter,
          stroke: false,
          fillColor: color,
          fillOpacity: 0.18,
          interactive: false,
        }).addTo(markers);
        const marker = L.marker(planPosition(cell), {
          title: `${cell.count} reports in this area`,
          icon: L.divIcon({
            className: 'hotspot-marker',
            html: `<span style="background:${color};width:${size}px;height:${size}px">${cell.count}</span>`,
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2],
          }),
        })
          .bindPopup(popup)
          .addTo(markers);
        marker
          .getElement()
          .setAttribute('aria-label', `${cell.count} reports in this area. Open report list.`);
        marker.getElement().dataset.count = cell.count;
      });
    } else
      reports.forEach((r) => {
        if (!hasMapPin(r)) return;
        const popup = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = r.title;
        const status = document.createElement('span');
        status.textContent = statusLabels[r.status];
        const priority = document.createElement('p');
        priority.textContent = `Priority: ${priorities[r.priority]?.label || r.priority}`;
        const categories = document.createElement('p');
        categories.textContent = `Categories: ${reportCategories(r).join(' · ')} (primary: ${r.category})`;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn link';
        button.textContent = 'View concern →';
        button.addEventListener('click', () => callbacks.current.openReport(r.id));
        popup.append(title, document.createElement('br'), status, priority, categories, button);
        const label = `${r.title} · ${priorities[r.priority]?.label || r.priority} priority · ${r.category} · ${statusLabels[r.status]}`;
        const marker = L.marker(planPosition(r), {
          title: label,
          alt: label,
          icon: pinIcon(pinAppearance(r, colorBy)),
        })
          .bindPopup(popup)
          .addTo(markers);
        marker.getElement().setAttribute('aria-label', label);
        marker.getElement().dataset.reportId = r.id;
        marker.getElement().dataset.priority = r.priority;
      });
    return () => {
      markers.remove();
    };
  }, [reports, pick, colorBy, density]);
  useEffect(() => {
    if (pick || !mapRef.current) return;
    if (fittedReports.current === reports) return;
    fittedReports.current = reports;
    const points = reports.filter((r) => hasMapPin(r) && isOnPlan(r)).map(planPosition);
    if (points.length) mapRef.current.fitBounds(points, { padding: [60, 60], maxZoom: 0.5 });
  }, [reports, pick]);
  useEffect(() => {
    if (!pick || !mapRef.current) return;
    const map = mapRef.current;
    if (!pin) {
      pickedMarker.current?.remove();
      pickedMarker.current = null;
      setAccuracy(null);
      return;
    }
    if (!isOnPlan(pin)) {
      pickedMarker.current?.remove();
      pickedMarker.current = null;
      return;
    }
    const point = planPosition(pin);
    if (pickedMarker.current) {
      pickedMarker.current.getElement()?.classList.add('pin-glide');
      pickedMarker.current.setLatLng(point);
    } else
      pickedMarker.current = L.marker(point, {
        icon: pinIcon(),
        draggable: true,
        autoPan: true,
        title: 'Drag to adjust report location',
        alt: 'Selected report location',
      })
        .on('dragstart', (e) => {
          e.target.getElement()?.classList.remove('pin-glide');
        })
        .on('dragend', (e) => {
          const point = gpsPosition(e.target.getLatLng());
          locationRequest.current++;
          setLocating(false);
          setAccuracy(null);
          if (!isOnPlan(point)) {
            e.target.setLatLng(planPosition(callbacks.current.pin));
            setLocationError('Keep the pin within the campus drawing.');
            return;
          }
          setLocationError('');
          callbacks.current.onPick?.(point);
        })
        .addTo(map);
    if (!map.getBounds().contains(point))
      map.panTo(point, {
        animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        duration: 0.35,
      });
  }, [pin, pick]);
  return (
    <>
      {pick && !hidePickControls && (
        <>
          <button
            type="button"
            className="btn primary"
            onClick={useCurrentLocation}
            disabled={locating}
          >
            {locating ? locationPhase : 'Use current location'}
          </button>
          <p className="map-caption" role="status">
            {accuracy !== null
              ? `Device accuracy: about ${accuracy} m. Drag the pin to the exact spot.`
              : 'Click to place a pin, then drag it to adjust. Current location asks for browser permission.'}
          </p>
          {locationError && (
            <p className="inline-error" role="alert">
              {locationError}
            </p>
          )}
        </>
      )}
      <div className={mapFrameClassName || undefined}>
        <div
          ref={container}
          id={pick ? 'pick-map' : 'campus-map'}
          className={`map ${large ? 'large' : ''} ${pick ? 'pick' : ''}`}
          aria-label={
            pick
              ? 'Click to select report location'
              : density
                ? 'Report concentration map'
                : 'Campus concern map'
          }
        />
        {mapOverlay}
      </div>
      <p className="map-caption site-plan-note" hidden={hidePickControls}>
        MSU–IIT Tibanga site plan · GPS alignment is approximate. Confirm the building and adjust
        the pin.
      </p>
      {pick && pin && !isOnPlan(pin) && (
        <p className="inline-error" role="alert">
          The selected GPS location is outside the supplied campus plan. Select a campus location
          manually.
        </p>
      )}
    </>
  );
}

export function CampusMap({ reports, large = false }) {
  const { data } = useVoice();
  const [view, setView] = useState('reports');
  const [colorBy, setColorBy] = useState('priority'),
    [category, setCategory] = useState(''),
    [priority, setPriority] = useState(''),
    [status, setStatus] = useState('');
  const visible = useMemo(
    () => filterMapReports(reports, { category, priority, status }),
    [reports, category, priority, status]
  );
  const legend =
    colorBy === 'priority'
      ? Object.keys(priorities).map((value) => ({
          value,
          label: priorities[value].label,
          ...priorityPins[value],
        }))
      : data.categories
          .filter((value) => visible.some((r) => r.category === value))
          .map((value) => ({ value, label: value, ...categoryPins[value] }));
  return (
    <>
      <div className="map-switch" role="group" aria-label="Campus map view">
        <button
          type="button"
          className="btn"
          data-map-view="plan"
          aria-pressed={view === 'plan'}
          onClick={() => setView('plan')}
        >
          Campus plan
        </button>
        <button
          type="button"
          className="btn"
          data-map-view="reports"
          aria-pressed={view === 'reports'}
          onClick={() => setView('reports')}
        >
          Report pins
        </button>
      </div>
      {view === 'reports' && (
        <>
          <div className="map-filters" role="group" aria-label="Filter report pins">
            <label>
              Color pins by
              <select
                aria-label="Color pins by"
                value={colorBy}
                onChange={(e) => setColorBy(e.target.value)}
              >
                <option value="priority">Priority</option>
                <option value="category">Primary category</option>
              </select>
            </label>
            <label>
              Category
              <select
                aria-label="Category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">All categories</option>
                <CategoryOptions />
              </select>
            </label>
            <label>
              Priority
              <select
                aria-label="Priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              >
                <option value="">All priorities</option>
                {Object.entries(priorities).map(([value, item]) => (
                  <option key={value} value={value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select
                aria-label="Status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="">All statuses</option>
                {Object.entries(statusLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="map-results">
            <p className="map-caption" role="status">
              {visible.length} of {reports.filter(hasMapPin).length} pinned concerns
            </p>
            {(category || priority || status) && (
              <button
                type="button"
                className="btn link"
                onClick={() => {
                  setCategory('');
                  setPriority('');
                  setStatus('');
                }}
              >
                Reset map filters
              </button>
            )}
          </div>
          {!visible.length && (
            <p className="notice" role="status">
              No pinned concerns match these filters.
            </p>
          )}
        </>
      )}
      <ReportMap
        reports={view === 'reports' ? visible : emptyReports}
        large={large}
        colorBy={colorBy}
      />
      {view === 'reports' && (
        <div
          className="map-legend"
          aria-label={colorBy === 'priority' ? 'Priority legend' : 'Primary category legend'}
        >
          {legend.map((item) => (
            <span key={item.value}>
              <span
                className="legend-symbol"
                aria-hidden="true"
                style={{ backgroundColor: item.color }}
              >
                {item.symbol}
              </span>
              {item.label}
            </span>
          ))}
        </div>
      )}
      <p className="map-caption">
        {view === 'plan'
          ? 'Explore the MSU–IIT campus plan. Select Report pins to view IIT Voice concerns.'
          : colorBy === 'category'
            ? 'Pin colors and numbers show the primary category. Category filters include additional categories too. Select a pin for details.'
            : 'Pin colors and letters show priority. Select a pin for status, categories and report details.'}
      </p>
    </>
  );
}
