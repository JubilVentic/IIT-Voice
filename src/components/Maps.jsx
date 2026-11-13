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
import { hotspotScale, reportHotspots } from '../report-summary.js';
import { currentLocation } from '../current-location.js';
import { CategoryOptions } from './Categories.jsx';
import { FloorPlan, floorImages, floorImageStyle } from './FloorPlans.jsx';
import { campusImagePoint, campusImageRings, hasIndoorPoint, indoorBuildings } from '../indoor-location.js';
import {
  pinAppearance,
  hasMapPin,
  filterMapReports,
  statusPins,
} from '../map-markers.js';

const emptyReports = [];
export function pinIcon({
  color = '#7a203c',
  symbol = '',
  editable = false,
  completed = false,
} = {}) {
  const touchTarget = window.matchMedia('(pointer: coarse)').matches;
  return L.divIcon({
    className: `report-marker${editable ? ' report-marker-editable' : ''}${completed ? ' report-marker-completed' : ''}${touchTarget ? ' touch-pin' : ''}`,
    html: `<svg class="map-pin" viewBox="0 0 32 44" aria-hidden="true"><path fill="${color}" stroke="white" stroke-width="2.5" d="M16 1.5C8 1.5 1.5 8 1.5 16c0 10 14.5 25.5 14.5 25.5S30.5 26 30.5 16C30.5 8 24 1.5 16 1.5Z"/>${symbol ? `<text x="16" y="20" text-anchor="middle" fill="white" font-size="13" font-weight="700" font-family="sans-serif">${symbol}</text>` : '<circle cx="16" cy="16" r="5" fill="white"/>'}${completed ? '<circle cx="28" cy="5" r="8" fill="#8b6914" stroke="white" stroke-width="2"/><path d="m24 5 3 3 5-6" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' : ''}</svg>`,
    iconSize: touchTarget ? [48, 56] : [32, 44],
    iconAnchor: touchTarget ? [24, 50] : [16, 42],
    popupAnchor: [0, -38],
  });
}

export function ReportMap({
  reports = emptyReports,
  mapId,
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
  focusBuilding = null,
  selectBuildings = false,
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
  const callbacks = useRef(null);
  callbacks.current = {
    openReport,
    toast,
    onPick,
    pin,
    onBuildingPick,
    fitCampusOnResize,
    focusBuilding,
    selectBuildings,
  };
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
      button.addEventListener('click', () => {
        requestAnimationFrame(() => {
          map.invalidateSize({ pan: false, animate: false });
          map.fitBounds(campusBounds, { padding: [16, 16], maxZoom: 2.5, animate: false });
        });
      });
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
    let fitted = false,
      previousSize = null;
    const observer = new ResizeObserver(() => {
      // A hidden wizard step has no size; preserve the map view until it is visible again.
      if (!container.current?.clientWidth || !container.current?.clientHeight) return;
      const width = container.current.clientWidth,
        height = container.current.clientHeight;
      const resized =
        previousSize && (width !== previousSize.width || height !== previousSize.height);
      map.invalidateSize();
      if (
        !fitted ||
        callbacks.current.fitCampusOnResize ||
        (resized &&
          (callbacks.current.focusBuilding || window.matchMedia('(max-width: 760px)').matches))
      ) {
        map.fitBounds(callbacks.current.focusBuilding?.outline || campusBounds, {
          padding: callbacks.current.focusBuilding ? [24, 24] : [16, 16],
          maxZoom: 2.5,
          animate: false,
        });
        fitted = true;
      }
      previousSize = { width, height };
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
  useEffect(() => {
    const map = mapRef.current;
    if (!map || pick || !focusBuilding) return;
    const rings = focusBuilding.holes?.length
      ? [focusBuilding.outline, ...focusBuilding.holes]
      : focusBuilding.outline;
    const outline = L.polygon(rings, {
      color: '#7a203c',
      weight: 2,
      fillOpacity: 0.06,
      interactive: false,
      className: 'summary-building-outline',
    }).addTo(map);
    outline.getElement()?.setAttribute('aria-label', focusBuilding.name);
    return () => outline.remove();
  }, [focusBuilding, pick]);
  const selectableBuildings = (pick || selectBuildings) && Boolean(onBuildingPick);
  useEffect(() => {
    if (!selectableBuildings || !mapRef.current) return;
    const outlines = L.layerGroup().addTo(mapRef.current);
    indoorBuildings.forEach((building) => {
      const shape = L.polygon(campusImageRings(building), {
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
      let hovering = false;
      const updateHover = () => {
        const active =
          ((hovering || element.matches(':focus')) &&
            window.matchMedia('(hover: hover)').matches) ||
          element.matches(':focus-visible');
        element.classList.toggle('is-hovered', active);
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
      const scale = hotspotScale(reports);
      reportHotspots(reports).forEach((cell) => {
        const color = cell.count > scale.high ? '#98283d' : cell.count > scale.low ? '#bb5630' : '#aa701b';
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
        if (r.status === 'resolved')
          status.textContent += ' · Work marked complete; awaiting final closure';
        if (r.status === 'closed') status.textContent += ' · Final closure by Main Admin';
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
        marker.getElement().dataset.status = r.status;
      });
    return () => {
      markers.remove();
    };
  }, [reports, pick, colorBy, density]);
  useEffect(() => {
    if (pick || !mapRef.current) return;
    if (focusBuilding) {
      mapRef.current.fitBounds(focusBuilding.outline, {
        padding: [24, 24],
        maxZoom: 2.5,
        animate: false,
      });
      return;
    }
    if (fittedReports.current === reports) return;
    fittedReports.current = reports;
    const points = reports.filter((r) => hasMapPin(r) && isOnPlan(r)).map(planPosition);
    if (points.length) mapRef.current.fitBounds(points, { padding: [60, 60], maxZoom: 0.5 });
  }, [reports, pick, focusBuilding]);
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
        icon: pinIcon({ editable: true }),
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
          id={mapId || (pick ? 'pick-map' : 'campus-map')}
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

export function CampusMap({ reports, large = false, mapMode = null }) {
  const [view, setView] = useState('reports');
  const [selectedBuilding, setSelectedBuilding] = useState(null);
  const [selectedFloor, setSelectedFloor] = useState(''),
    [floorExpanded, setFloorExpanded] = useState(false);
  const [category, setCategory] = useState(''),
    [priority, setPriority] = useState(''),
    [status, setStatus] = useState('');
  const visible = useMemo(
    () => filterMapReports(reports, { category, priority, status }),
    [reports, category, priority, status]
  );
  const activeView = mapMode || view;
  const legend = [
    { ...statusPins.problem, label: 'Needs attention' },
    { ...statusPins.working, label: 'Work in progress' },
    { ...statusPins.resolved, label: 'Resolved or closed' },
  ];
  return (
    <>
      {!mapMode && (
        <div className="map-switch" role="group" aria-label="Campus map view">
          <button
            type="button"
            className="btn"
            data-map-view="plan"
            aria-pressed={activeView === 'plan'}
            onClick={() => setView('plan')}
          >
            Campus plan
          </button>
          <button
            type="button"
            className="btn"
            data-map-view="reports"
            aria-pressed={activeView === 'reports'}
            onClick={() => setView('reports')}
          >
            Report pins
          </button>
        </div>
      )}
      {activeView === 'reports' && (
        <>
          <div className="map-filters" role="group" aria-label="Filter report pins">
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
                <option value="active">Active concerns</option>
                <option value="completed">Completed · Resolved or closed</option>
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
            {(category || priority || status !== 'active') && (
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
        key={selectedBuilding?.id || 'campus'}
        reports={activeView === 'plan' ? emptyReports : visible}
        large={large}
        density={activeView === 'density'}
        selectBuildings
        onBuildingPick={(building) => {
          setSelectedBuilding(building);
          setSelectedFloor('');
          setFloorExpanded(false);
        }}
        focusBuilding={selectedBuilding ? {
          name: selectedBuilding.name,
          outline: selectedBuilding.outline.map(campusImagePoint),
          holes: selectedBuilding.holes?.map((ring) => ring.map(campusImagePoint)),
        } : null}
        mapFrameClassName={`location-map-stage map-building-browser ${selectedBuilding ? 'is-browsing' : ''} ${floorExpanded ? 'is-floor-focused' : ''}`}
        mapOverlay={selectedBuilding && (
          <>
            {!floorExpanded ? (
              <aside className="floor-choice-panel" aria-label={`${selectedBuilding.name} floor choices`}>
                <div className="picker-toolbar">
                  <button type="button" className="btn" onClick={() => setSelectedBuilding(null)}>
                    ← Back to campus map
                  </button>
                </div>
                <h3>{selectedBuilding.name}</h3>
                {selectedBuilding.floors.length ? (
                  <>
                    <p className="meta">Choose a floor to view its report pins.</p>
                    <div className="floor-selector floor-preview-list" role="group" aria-label="Choose a floor">
                      {selectedBuilding.floors.map((floor) => (
                        <button
                          key={floor.id}
                          type="button"
                          className="floor-preview-card"
                          aria-label={floor.name}
                          onClick={() => {
                            setSelectedFloor(floor.id);
                            setFloorExpanded(true);
                          }}
                        >
                          <span className="floor-preview-image">
                            <img className="floor-plan-image" style={floorImageStyle(floor.id)} src={floorImages[selectedBuilding.id][floor.id]} alt="" loading="lazy" />
                            {visible.filter((report) => {
                              const pin = report.indoor_location;
                              return hasIndoorPoint(pin) && pin.building_id === selectedBuilding.id && pin.floor_id === floor.id;
                            }).map((report) => (
                              <span
                                key={report.id}
                                className="floor-preview-pin"
                                title={`${report.title} · ${statusLabels[report.status]}`}
                                style={{ left: `${report.indoor_location.x * 100}%`, top: `${report.indoor_location.y * 100}%`, backgroundColor: pinAppearance(report).color }}
                              />
                            ))}
                          </span>
                          <strong>{floor.name}</strong>
                        </button>
                      ))}
                    </div>
                  </>
                ) : <p className="notice">Floor plans are not available for this building yet.</p>}
              </aside>
            ) : (
              <div className="picker-full-floor">
                <div className="picker-toolbar">
                  <button type="button" className="btn" onClick={() => setFloorExpanded(false)}>← Back to floor choices</button>
                  <button type="button" className="btn" onClick={() => setSelectedBuilding(null)}>← Back to campus map</button>
                </div>
                <div className="floor-selector" role="group" aria-label="Choose a floor">
                  {selectedBuilding.floors.map((floor) => (
                    <button key={floor.id} type="button" className="btn" aria-pressed={selectedFloor === floor.id} onClick={() => setSelectedFloor(floor.id)}>{floor.name}</button>
                  ))}
                </div>
                <FloorPlan key={`${selectedBuilding.id}/${selectedFloor}`} location={{ building_id: selectedBuilding.id, floor_id: selectedFloor }} reports={visible} />
              </div>
            )}
          </>
        )}
      />
      {activeView === 'reports' && (
        <div className="map-legend" aria-label="Report status legend">
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
        {activeView === 'reports' && 'Use Status to filter concerns by their current progress. '}
        {activeView === 'plan'
          ? 'Explore the MSU–IIT campus plan. Select Report pins to view IIT Voice concerns.'
          : activeView === 'density'
            ? 'Select a report cluster or building to explore concerns by floor.'
            : 'Select a pin for status, priority, categories and report details.'}
      </p>
    </>
  );
}
