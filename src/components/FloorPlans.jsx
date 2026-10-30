import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { ReportMap, pinIcon } from './Maps.jsx';
import {
  buildingPin,
  hasIndoorPoint,
  indoorArea,
  indoorBuildings,
  indoorLabel,
} from '../indoor-location.js';
import ground from '../assets/floor-plans/cass-ground.png';
import second from '../assets/floor-plans/cass-second.png';
import third from '../assets/floor-plans/cass-third.png';
import fourth from '../assets/floor-plans/cass-fourth.png';

const images = { 'old-cass': { ground, second, third, fourth } };
// Page margins are hidden visually; keep the source coordinates unchanged for saved pins.
const floorInsets = {
  ground: [5.5, 2.5, 9.5, 2.5],
  second: [4.5, 2, 7, 2],
  third: [3, 2, 9.5, 2],
  fourth: [4.5, 3, 11, 3],
};
const floorImageStyle = (id) => ({ clipPath: `inset(${floorInsets[id].join('% ')}%)` });
const bounds = [
  [0, 0],
  [750, 1000],
];

export function FloorPlan({ location, onPick }) {
  const container = useRef(null),
    mapRef = useRef(null),
    marker = useRef(null),
    areaHighlight = useRef(null),
    choosePoint = useRef(null),
    selectedPoint = useRef(null);
  const callbacks = useRef({ onPick });
  callbacks.current = { onPick };
  const [error, setError] = useState('');
  const label = indoorLabel({ ...location, x: null, y: null });
  const area = indoorArea(location);
  const editable = Boolean(onPick);
  const [top, right, bottom, left] = floorInsets[location.floor_id];
  const visibleBounds = [
    [(750 * bottom) / 100, (1000 * left) / 100],
    [750 * (1 - top / 100), 1000 * (1 - right / 100)],
  ];
  useEffect(() => {
    const animate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const map = L.map(container.current, {
      crs: L.CRS.Simple,
      minZoom: -3,
      maxZoom: 3,
      maxBounds: L.latLngBounds(bounds).pad(0.1),
      maxBoundsViscosity: 1,
      zoomSnap: 0,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 180,
      wheelDebounceTime: 120,
      zoomAnimation: animate,
      fadeAnimation: animate,
      markerZoomAnimation: animate,
    }).setView([375, 500], -1);
    mapRef.current = map;
    const overlay = L.imageOverlay(images[location.building_id][location.floor_id], bounds, {
      alt: `${label} floor plan`,
      className: 'floor-plan-image',
    })
      .on('error', () => setError('Floor plan unavailable. Use the written location details.'))
      .addTo(map);
    Object.assign(overlay.getElement().style, floorImageStyle(location.floor_id));
    function choose(point) {
      const x = point.lng / 1000,
        y = 1 - point.lat / 750;
      if (x < 0 || x > 1 || y < 0 || y > 1) {
        setError('Place the pin inside the floor-plan image.');
        return false;
      }
      setError('');
      callbacks.current.onPick?.({ x: +x.toFixed(6), y: +y.toFixed(6) });
      return true;
    }
    if (editable) map.on('click', (e) => choose(e.latlng));
    let fitted = false;
    const observer = new ResizeObserver(() => {
      map.invalidateSize();
      if (!fitted && container.current?.clientWidth && container.current?.clientHeight) {
        map.fitBounds(visibleBounds, { padding: [12, 12], animate: false });
        fitted = true;
      }
    });
    observer.observe(container.current);
    choosePoint.current = choose;
    return () => {
      observer.disconnect();
      map._animatingZoom = false;
      map.remove();
      mapRef.current = null;
      marker.current = null;
      areaHighlight.current = null;
      choosePoint.current = null;
      selectedPoint.current = null;
    };
  }, [location.building_id, location.floor_id, editable]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    areaHighlight.current?.remove();
    areaHighlight.current = null;
    if (!hasIndoorPoint(location)) {
      marker.current?.remove();
      marker.current = null;
      selectedPoint.current = null;
      return;
    }
    const point = [750 * (1 - location.y), 1000 * location.x];
    selectedPoint.current = point;
    if (marker.current) {
      marker.current.getElement()?.classList.add('pin-glide');
      marker.current.setLatLng(point);
    } else
      marker.current = L.marker(point, {
        icon: pinIcon(),
        draggable: editable,
        autoPan: true,
        title: editable ? 'Drag to adjust indoor location' : 'Reported indoor location',
        alt: 'Selected indoor report location',
      })
        .on('dragstart', (e) => e.target.getElement()?.classList.remove('pin-glide'))
        .on('dragend', (e) => {
          if (!choosePoint.current(e.target.getLatLng())) e.target.setLatLng(selectedPoint.current);
        })
        .addTo(map);
    marker.current.unbindTooltip();
    if (area) {
      marker.current.bindTooltip(area.name, { direction: 'top', offset: [0, -30] });
      areaHighlight.current = L.polygon(
        area.outline.map(([x, y]) => [750 * (1 - y), 1000 * x]),
        {
          color: '#7a203c',
          weight: 1.5,
          fillOpacity: 0.08,
          interactive: false,
          className: 'indoor-area-highlight',
        }
      ).addTo(map);
    }
  }, [location, editable]);
  return (
    <div className="floor-plan-panel">
      <div className="panel-head">
        <strong>{label}</strong>
        {editable && (
          <button
            type="button"
            className="btn"
            aria-label="Place indoor pin at map center"
            onClick={() => choosePoint.current?.(mapRef.current.getCenter())}
          >
            Pin at center
          </button>
        )}
        <button
          type="button"
          className="btn"
          onClick={() => mapRef.current?.fitBounds(visibleBounds, { padding: [12, 12] })}
        >
          Fit floor
        </button>
      </div>
      <div ref={container} className="map floor-plan-map" aria-label={`${label} floor plan`} />
      <p className="map-caption" role="status">
        {editable
          ? hasIndoorPoint(location)
            ? area
              ? `Selected area: ${area.name}. Drag the pin to refine the exact spot.`
              : 'Indoor pin selected. This area has no confirmed label; add the room or area in Location details.'
            : 'Tap the room, corridor, or area where the concern is located. Zoom in for detail.'
          : area
            ? `Reported area: ${area.name}. Zoom in to inspect the location.`
            : 'Reported indoor position. Zoom in to inspect the location.'}
      </p>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <p className="map-caption">
        Cleaned photo of the supplied plan. Some labels are unverified; add the room or office name
        in Location details.
      </p>
    </div>
  );
}

export function ReportLocationPicker({ pin, indoor, onPick }) {
  const [buildingId, setBuildingId] = useState(indoor?.building_id || ''),
    [floorId, setFloorId] = useState(indoor?.floor_id || ''),
    [floorExpanded, setFloorExpanded] = useState(Boolean(indoor?.floor_id));
  const building = indoorBuildings.find((b) => b.id === buildingId);
  useEffect(() => {
    if (!pin) {
      setBuildingId('');
      setFloorId('');
      setFloorExpanded(false);
    }
  }, [pin]);
  function openBuilding(selected) {
    setBuildingId(selected.id);
    setFloorExpanded(false);
    const previous = indoor?.building_id === selected.id;
    setFloorId(previous ? indoor.floor_id : '');
    if (!previous) onPick({ ...buildingPin(selected), location: selected.name });
  }
  function selectFloor(id) {
    setFloorExpanded(true);
    if (id === floorId && indoor?.floor_id === id) return;
    setFloorId(id);
    onPick({
      ...buildingPin(building),
      indoor_location: { building_id: building.id, floor_id: id, x: null, y: null },
    });
  }
  function closeBuilding() {
    setBuildingId('');
    setFloorExpanded(false);
  }
  function pickCampusLocation(point) {
    closeBuilding();
    setFloorId('');
    onPick(point);
  }
  return (
    <section className="report-location-picker" aria-label="Report location picker">
      {building && (
        <div className="picker-toolbar">
          <button type="button" className="btn" onClick={closeBuilding}>
            ← Back to campus map
          </button>
          {floorExpanded && (
            <button type="button" className="btn" onClick={() => setFloorExpanded(false)}>
              ← Back to floor choices
            </button>
          )}
        </div>
      )}
      {!floorExpanded && (
        <p className="map-caption">
          Hover over a supported building to enlarge it slightly, then click to select it. Old CASS
          also has floor plans. Pin outdoor concerns anywhere else on the campus plan.
        </p>
      )}
      <ReportMap
        pick
        pin={pin}
        onPick={pickCampusLocation}
        onBuildingPick={openBuilding}
        hidePickControls={floorExpanded}
        fitCampusOnResize={Boolean(building) && !floorExpanded}
        mapFrameClassName={`location-map-stage ${building ? 'is-browsing' : ''} ${floorExpanded ? 'is-floor-focused' : ''}`}
        mapOverlay={
          <>
            {building && !floorExpanded && (
              <aside className="floor-choice-panel" aria-label={`${building.name} floor choices`}>
                <h3>{building.name}</h3>
                {building.floors.length ? (
                  <>
                    <p className="meta">Choose a floor to focus on its plan.</p>
                    <div
                      className="floor-selector floor-preview-list"
                      role="group"
                      aria-label="Choose a floor"
                    >
                      {building.floors.map((floor) => (
                        <button
                          key={floor.id}
                          type="button"
                          className="floor-preview-card"
                          aria-label={floor.name}
                          aria-pressed={floorId === floor.id}
                          onClick={() => selectFloor(floor.id)}
                        >
                          <img
                            className="floor-plan-image"
                            style={floorImageStyle(floor.id)}
                            src={images[building.id][floor.id]}
                            alt=""
                            loading="lazy"
                          />
                          <strong>{floor.name}</strong>
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <p className="notice" role="status">
                      {building.name} is selected on the campus map. Floor plans are not available
                      for this building yet. Enter the floor and room in Location details.
                    </p>
                    <button type="button" className="btn" onClick={closeBuilding}>
                      Use this building
                    </button>
                  </>
                )}
              </aside>
            )}
            {building && floorExpanded && (
              <div className="picker-full-floor">
                <div className="floor-selector" role="group" aria-label="Choose a floor">
                  {building.floors.map((floor) => (
                    <button
                      key={floor.id}
                      type="button"
                      className="btn"
                      aria-pressed={floorId === floor.id}
                      onClick={() => selectFloor(floor.id)}
                    >
                      {floor.name}
                    </button>
                  ))}
                </div>
                <FloorPlan
                  key={`${building.id}/${floorId}`}
                  location={indoor || { building_id: building.id, floor_id: floorId }}
                  onPick={(point) =>
                    onPick({
                      ...buildingPin(building),
                      indoor_location: { building_id: building.id, floor_id: floorId, ...point },
                    })
                  }
                />
              </div>
            )}
          </>
        }
      />
      {indoor && (
        <p className="map-caption" role="status">
          Selected: {indoorLabel(indoor)}
          {hasIndoorPoint(indoor)
            ? ' · Indoor point selected.'
            : ' · Select a point on the floor plan before submitting.'}
        </p>
      )}
    </section>
  );
}
