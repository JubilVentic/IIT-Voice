import { useMemo } from 'react';
import {
  buildingExportRows,
  reportCsv,
  summarizeBuildings,
  summaryBuildingOutline,
} from '../building-reports.js';
import { filterSummaryReports, submissionDay } from '../report-summary.js';
import { Icon, Panel } from './UI.jsx';
import { isActiveReport, priorities, statusLabels } from '../lib.js';
import { ReportMap } from './Maps.jsx';
import { FloorPlan, floorImages, floorImageStyle } from './FloorPlans.jsx';
import { hasIndoorPoint, indoorBuildings } from '../indoor-location.js';
import { pinAppearance } from '../map-markers.js';

function LocationBars({ rows, selected, onSelect, label }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return (
    <div className="location-bars" role="group" aria-label={label}>
      {rows.map((row) => (
        <button
          type="button"
          className="summary-bar"
          key={row.id}
          aria-pressed={selected === row.id}
          onClick={() => onSelect(selected === row.id ? '' : row.id)}
        >
          <span className="barlabel">
            <span>{row.name}</span>
            <strong>{row.count}</strong>
          </span>
          <span className="track workload-track" aria-hidden="true">
            <span className="workload-active" style={{ width: `${(row.active / max) * 100}%` }} />
            <span
              className="workload-completed"
              style={{ width: `${(row.completed / max) * 100}%` }}
            />
            <span className="workload-other" style={{ width: `${(row.other / max) * 100}%` }} />
          </span>
          <small>
            {row.active} active · {row.completed} resolved / closed · {row.other} rejected /
            duplicate
          </small>
        </button>
      ))}
    </div>
  );
}

export function BuildingSummary({ reports, visible, filters, offices, onChange }) {
  const buildings = useMemo(
    () =>
      summarizeBuildings(filterSummaryReports(reports, { ...filters, building: '', floor: '' })),
    [reports, filters]
  );
  const selected = buildings.find((b) => b.id === filters.building);
  const comparison = buildings.filter((b) => b.count || b.id === filters.building);
  const active = visible.filter(isActiveReport).length;
  const focusBuilding = useMemo(() => summaryBuildingOutline(filters.building), [filters.building]);
  const floor = indoorBuildings
    .find((b) => b.id === filters.building)
    ?.floors.find((f) => f.id === filters.floor);
  function download(details) {
    const rows = buildingExportRows(visible, details);
    const context = [
      filters.from || 'All time',
      filters.through || 'No end date',
      filters.category || 'All categories',
      filters.office === 'unassigned'
        ? 'Not assigned'
        : offices.find((office) => String(office.id) === filters.office)?.name || 'All offices',
      statusLabels[filters.status] || 'All statuses',
      priorities[filters.priority]?.label || 'All priorities',
      selected?.name || 'All buildings',
      selected?.floors.find((f) => f.id === filters.floor)?.name || 'All floors',
    ];
    const headers = [
      'Submitted from',
      'Submitted through',
      'Category filter',
      'Office filter',
      'Status filter',
      'Priority filter',
      'Building filter',
      'Floor filter',
    ];
    const csv = reportCsv(rows.map((row, index) => [...row, ...(index === 0 ? headers : context)]));
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `iit-voice-${details ? 'report-details' : 'building-floor-summary'}-${submissionDay(new Date())}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <Panel
      title="Reports by building & floor"
      className="building-summary full"
      detail={`${visible.length} matching reports`}
    >
      <p className="meta">
        Compare buildings, then select a floor to focus the dashboard. Counts include each report
        once, even when it has several categories.
      </p>
      <div className="building-summary-toolbar">
        <div className="building-summary-downloads">
          <button
            type="button"
            className="btn primary"
            disabled={!visible.length}
            onClick={() => download(false)}
          >
            Download summary CSV
          </button>
          <button
            type="button"
            className="btn"
            disabled={!visible.length}
            onClick={() => download(true)}
          >
            Download report rows CSV
          </button>
          <small>Open in Excel or Google Sheets. Exports use the current filters.</small>
        </div>
      </div>
      <div className="building-scope" role="status">
        <span>
          <strong>{visible.length}</strong> matching reports · {active} active
        </span>
        {(filters.building || filters.floor) && (
          <button className="btn link" type="button" onClick={() => onChange('building', '')}>
            Clear building & floor
          </button>
        )}
      </div>
      <div className="workload-key" aria-label="Building report status legend">
        <span>
          <i className="chart-dot workload-active" />
          Active
        </span>
        <span>
          <i className="chart-dot workload-completed" />
          Resolved / closed
        </span>
        <span>
          <i className="chart-dot workload-other" />
          Rejected / duplicate
        </span>
      </div>
      <div className="building-comparison">
        <section>
          <h3>Building comparison</h3>
          <p className="map-caption">
            Uses the summary filters above. Other buildings stay visible for comparison.
          </p>
          {comparison.length ? (
            <LocationBars
              rows={comparison}
              selected={filters.building}
              onSelect={(id) => onChange('building', id)}
              label="Building report counts"
            />
          ) : (
            <p className="notice">No building reports match the summary filters.</p>
          )}
          <div className="building-map-preview" aria-label="Building and floor location preview">
            <h3>Location preview</h3>
            {floor ? (
              <FloorPlan
                location={{ building_id: filters.building, floor_id: floor.id, x: null, y: null }}
                reports={visible}
              />
            ) : (
              <>
                <p className="map-caption">
                  {focusBuilding
                    ? `${focusBuilding.name} · ${filters.floor === 'unspecified' ? 'Floor not recorded; showing the building.' : 'Choose a floor to see its plan, where available.'}`
                    : filters.building === 'unmapped'
                      ? 'These reports have no recognized building. Showing available campus pins.'
                      : 'Select a building on the map, then choose a floor from the floor breakdown.'}
                </p>
                <ReportMap
                  key={filters.building || 'campus'}
                  reports={visible}
                  mapId="summary-building-map"
                  focusBuilding={focusBuilding}
                  selectBuildings
                  onBuildingPick={(building) => onChange('building', building.id)}
                />
              </>
            )}
          </div>
        </section>
        <section className="floor-breakdown">
          <h3>{selected ? selected.name : 'Floor breakdown'}</h3>
          {selected ? (
            <>
              <p className="map-caption">Choose a floor to filter the dashboard and export.</p>
              {floorImages[selected.id] && (
                <div className="floor-selector floor-preview-list" role="group" aria-label={`${selected.name} floor plans`}>
                  {selected.floors.filter((item) => floorImages[selected.id][item.id]).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="floor-preview-card"
                      aria-pressed={filters.floor === item.id}
                      onClick={() => onChange('floor', item.id)}
                    >
                      <span className="floor-preview-image">
                        <img className="floor-plan-image" style={floorImageStyle(item.id)} src={floorImages[selected.id][item.id]} alt="" loading="lazy" />
                        {visible.filter((report) => {
                          const pin = report.indoor_location;
                          return hasIndoorPoint(pin) && pin.building_id === selected.id && pin.floor_id === item.id;
                        }).map((report) => (
                          <span key={report.id} className="floor-preview-pin" title={report.title} style={{ left: `${report.indoor_location.x * 100}%`, top: `${report.indoor_location.y * 100}%`, backgroundColor: pinAppearance(report).color }} />
                        ))}
                      </span>
                      <strong>{item.name}</strong>
                    </button>
                  ))}
                </div>
              )}
              <LocationBars
                rows={selected.floors}
                selected={filters.floor}
                onSelect={(id) => onChange('floor', id)}
                label="Floor report counts"
              />
            </>
          ) : (
            <div className="floor-breakdown-empty">
              <Icon name="map" />
              <strong>Explore a building</strong>
              <p>
                Choose a building on the map or from the comparison chart to see reports on each recorded floor.
              </p>
            </div>
          )}
        </section>
      </div>
      <p className="map-caption">
        Floors use saved floor-plan selections. Written floor or room notes are not inferred.
        Reports without a recognized building appear under “Other / unspecified building.”
      </p>
    </Panel>
  );
}
