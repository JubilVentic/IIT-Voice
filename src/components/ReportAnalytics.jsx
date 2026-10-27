import { useMemo, useState } from 'react';
import { newestFirst, priorities, priorityOrder, statusLabels, useVoice } from '../lib.js';
import {
  dateWindow,
  filterSummaryReports,
  isActiveReport,
  submissionTrend,
  summarizeReports,
} from '../report-summary.js';
import { categoryPins, hasMapPin, priorityPins } from '../map-markers.js';
import { ErrorMessage, Field, Hero, Panel, ReportList, Stats } from './UI.jsx';
import { CategoryOptions } from './Categories.jsx';
import { ReportMap } from './Maps.jsx';

const defaults = {
  period: 'all',
  from: '',
  through: '',
  category: '',
  office: '',
  status: '',
  priority: '',
};
const statusColors = {
  submitted: '#7a203c',
  needs_information: '#98772a',
  validated: '#b18b34',
  in_progress: '#326fb0',
  resolved: '#357554',
  closed: '#65758a',
  rejected: '#b62f46',
  duplicate: '#88749b',
};
const shortDate = (day) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-PH', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

function ReportTrend({ trend }) {
  const max = Math.max(4, Math.ceil(Math.max(0, ...trend.bins.map((bin) => bin.count)) / 4) * 4);
  return (
    <>
      <p className="meta">New submissions grouped by {trend.grain}. Dates use Philippine time.</p>
      <div
        className="trend-plot"
        role="img"
        aria-label={`Submission trend: ${trend.bins.map((bin) => `${shortDate(bin.from)}: ${bin.count}`).join('; ') || 'no data'}`}
      >
        <div className="trend-scale" aria-hidden="true">
          <span>{max}</span>
          <span>{max / 2}</span>
          <span>0</span>
        </div>
        <div
          className="trend-bars"
          style={{ gridTemplateColumns: `repeat(${Math.max(1, trend.bins.length)},minmax(0,1fr))` }}
          aria-hidden="true"
        >
          {trend.bins.map((bin) => (
            <div
              className="trend-slot"
              key={bin.from}
              title={`${shortDate(bin.from)}${bin.from !== bin.through ? ` – ${shortDate(bin.through)}` : ''}: ${bin.count} reports`}
            >
              <div className="trend-bar" style={{ height: `${(bin.count / max) * 100}%` }}>
                <span>{bin.count || ''}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      {!!trend.bins.length && (
        <div className={`trend-dates${trend.bins.length === 1 ? ' single-date' : ''}`}>
          <span>{shortDate(trend.bins[0].from)}</span>
          {trend.bins[0].from !== trend.bins.at(-1).through && (
            <span>{shortDate(trend.bins.at(-1).through)}</span>
          )}
        </div>
      )}
      <details>
        <summary>View submission counts</summary>
        <div className="table-wrap">
          <table>
            <caption className="sr-only">Submissions in each date interval</caption>
            <thead>
              <tr>
                <th>From</th>
                <th>Through</th>
                <th>Reports</th>
              </tr>
            </thead>
            <tbody>
              {trend.bins.map((bin) => (
                <tr key={bin.from}>
                  <td>{shortDate(bin.from)}</td>
                  <td>{shortDate(bin.through)}</td>
                  <td>{bin.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}

function StatusChart({ summary, selected, onSelect }) {
  let offset = 0;
  const slices = Object.entries(summary.statuses)
    .filter(([, count]) => count)
    .map(([status, count]) => {
      const start = offset;
      offset += (count / summary.total) * 100;
      return `${statusColors[status]} ${start}% ${offset}%`;
    });
  return (
    <div className="status-summary">
      <div
        className="status-donut"
        role="img"
        aria-label={`${summary.total} reports by current status. Counts are listed beside the chart.`}
        style={{
          background: slices.length ? `conic-gradient(${slices.join(',')})` : 'var(--line)',
        }}
      >
        <div>
          <strong>{summary.total}</strong>
          <span>reports</span>
        </div>
      </div>
      <div className="status-key">
        {Object.entries(statusLabels).map(([status, label]) => (
          <button
            key={status}
            type="button"
            className="status-key-row"
            aria-pressed={selected === status}
            onClick={() => onSelect(selected === status ? '' : status)}
          >
            <span
              className="chart-dot"
              aria-hidden="true"
              style={{ background: statusColors[status] }}
            />
            <span>{label}</span>
            <strong>{summary.statuses[status]}</strong>
          </button>
        ))}
      </div>
    </div>
  );
}

export function ReportAnalytics() {
  const { data, user, setPage } = useVoice();
  const [filters, setFilters] = useState(defaults),
    [density, setDensity] = useState(true);
  const range =
    filters.period === 'custom'
      ? { from: filters.from, through: filters.through }
      : dateWindow(filters.period);
  const visible = useMemo(
    () => filterSummaryReports(data.reports, { ...filters, ...range }),
    [data.reports, filters, range.from, range.through]
  );
  const summary = summarizeReports(visible, data.categories, data.offices);
  const trend = submissionTrend(visible, range.from, range.through);
  const pinned = visible.filter(hasMapPin).length;
  const maxCategory = Math.max(1, ...summary.categories.map((row) => row.count)),
    maxOffice = Math.max(1, ...summary.offices.map((row) => row.count));
  const high = visible
    .filter((report) => isActiveReport(report) && ['high', 'urgent'].includes(report.priority))
    .sort(priorityOrder);
  const activeFilters =
    filters.period !== 'all' ||
    filters.category ||
    filters.office ||
    filters.status ||
    filters.priority;
  const invalidDates = range.from && range.through && range.from > range.through;
  function change(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }
  return (
    <div className="report-analytics">
      <Hero
        title={`Good day, ${user.name.split(' ')[0]}.`}
        question="The campus at a glance."
        sub="See what is being reported, where concerns gather, and which offices need attention."
      />
      <Panel title="Report summary" detail="Main Admin">
        <div className="summary-filters" role="group" aria-label="Report summary filters">
          <Field label="Submission period">
            <select
              aria-label="Submission period"
              value={filters.period}
              onChange={(e) => change('period', e.target.value)}
            >
              <option value="all">All time</option>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="year">This year</option>
              <option value="custom">Custom dates</option>
            </select>
          </Field>
          <Field label="Category">
            <select
              aria-label="Category"
              value={filters.category}
              onChange={(e) => change('category', e.target.value)}
            >
              <option value="">All categories</option>
              <CategoryOptions />
            </select>
          </Field>
          <Field label="Responsible office">
            <select
              aria-label="Responsible office"
              value={filters.office}
              onChange={(e) => change('office', e.target.value)}
            >
              <option value="">All offices</option>
              <option value="unassigned">Not assigned</option>
              {data.offices.map((office) => (
                <option key={office.id} value={office.id}>
                  {office.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select
              aria-label="Status"
              value={filters.status}
              onChange={(e) => change('status', e.target.value)}
            >
              <option value="">All statuses</option>
              {Object.entries(statusLabels).map(([status, label]) => (
                <option key={status} value={status}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Priority">
            <select
              aria-label="Priority"
              value={filters.priority}
              onChange={(e) => change('priority', e.target.value)}
            >
              <option value="">All priorities</option>
              {Object.entries(priorities).map(([priority, item]) => (
                <option key={priority} value={priority}>
                  {item.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {filters.period === 'custom' && (
          <div className="summary-dates">
            <Field label="Submitted from">
              <input
                type="date"
                value={filters.from}
                onChange={(e) => change('from', e.target.value)}
              />
            </Field>
            <Field label="Submitted through">
              <input
                type="date"
                value={filters.through}
                onChange={(e) => change('through', e.target.value)}
              />
            </Field>
          </div>
        )}
        <ErrorMessage>
          {invalidDates ? 'The start date must be on or before the end date.' : ''}
        </ErrorMessage>
        <div className="summary-scope">
          <p className="meta" role="status" data-summary-count>
            Showing <strong>{visible.length}</strong> of {data.reports.length} reports. All charts
            and lists below use this selection.
          </p>
          {activeFilters && (
            <button type="button" className="btn" onClick={() => setFilters(defaults)}>
              Reset summary filters
            </button>
          )}
        </div>
        <p className="map-caption">
          Date filters use the submission date. Status and office reflect the report’s current
          state. Category filters include additional categories.
        </p>
      </Panel>
      <div className="analytics-stats">
        <Stats
          values={[
            ['Reports received', summary.total, 'Within this selection'],
            ['Active concerns', summary.active, 'Awaiting review or action'],
            [
              'Resolved / closed',
              summary.completed,
              `${summary.total ? Math.round((summary.completed / summary.total) * 100) : 0}% of this selection`,
            ],
            ['Urgent open', summary.urgent, 'Needs immediate attention'],
          ]}
        />
      </div>
      {!visible.length && (
        <p className="notice" role="status">
          No reports match this selection. Adjust or reset the filters to see report activity.
        </p>
      )}
      <div className="summary-grid">
        <Panel title="Reports over time">
          <ReportTrend trend={trend} />
        </Panel>
        <Panel title="Current status">
          <p className="meta">Select a status to filter the summary.</p>
          <StatusChart
            summary={summary}
            selected={filters.status}
            onSelect={(status) => change('status', status)}
          />
        </Panel>
        <Panel title="Reports by category">
          <p className="meta">
            Select a category to filter. Counts can overlap when a report belongs to several
            categories; totals count each report once.
          </p>
          <div className="summary-bars">
            {summary.categories
              .filter((row) => row.count)
              .map((row) => (
                <button
                  type="button"
                  key={row.name}
                  className="summary-bar"
                  disabled={!row.count}
                  aria-pressed={filters.category === row.name}
                  onClick={() => change('category', filters.category === row.name ? '' : row.name)}
                >
                  <span className="barlabel">
                    <span>{row.name}</span>
                    <strong>{row.count}</strong>
                  </span>
                  <span className="track">
                    <span
                      className="chart-fill"
                      style={{
                        width: `${(row.count / maxCategory) * 100}%`,
                        background: categoryPins[row.name]?.color || 'var(--maroon)',
                      }}
                    />
                  </span>
                </button>
              ))}
          </div>
        </Panel>
        <Panel title="Office workload">
          <p className="meta">
            Select an office to filter. Only offices with reports in this selection are shown.
          </p>
          <div className="workload-key">
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
          {summary.offices
            .filter((office) => office.count)
            .map((office) => (
              <button
                type="button"
                key={office.id}
                className="summary-bar"
                disabled={!office.count}
                aria-pressed={filters.office === String(office.id)}
                onClick={() =>
                  change('office', filters.office === String(office.id) ? '' : String(office.id))
                }
              >
                <span className="barlabel">
                  <span>{office.name}</span>
                  <strong>{office.count}</strong>
                </span>
                <span className="track workload-track">
                  <span
                    className="workload-active"
                    style={{ width: `${(office.active / maxOffice) * 100}%` }}
                  />
                  <span
                    className="workload-completed"
                    style={{ width: `${(office.completed / maxOffice) * 100}%` }}
                  />
                  <span
                    className="workload-other"
                    style={{
                      width: `${((office.count - office.active - office.completed) / maxOffice) * 100}%`,
                    }}
                  />
                </span>
                <small>
                  {office.active} active · {office.completed} resolved / closed
                </small>
              </button>
            ))}
        </Panel>
      </div>
      <Panel
        title="Report hotspots"
        className="full"
        detail={`${pinned} mapped · ${visible.length - pinned} without a pin`}
      >
        <p className="meta">
          See where reports are concentrated. Nearby pins are grouped into geographic grid cells;
          darker circles mean more reports. Select a circle to open its reports.
        </p>
        <div className="map-switch" role="group" aria-label="Summary map view">
          <button
            type="button"
            className="btn"
            aria-pressed={density}
            onClick={() => setDensity(true)}
          >
            Report concentration
          </button>
          <button
            type="button"
            className="btn"
            aria-pressed={!density}
            onClick={() => setDensity(false)}
          >
            Individual pins
          </button>
        </div>
        <ReportMap reports={visible} density={density} large />
        {!pinned && <p className="notice">No reports with map pins match this selection.</p>}
        {density ? (
          <div className="map-legend" aria-label="Report concentration legend">
            {[
              ['#aa701b', '1 report'],
              ['#bb5630', '2–3 reports'],
              ['#98283d', '4+ reports'],
            ].map(([color, label]) => (
              <span key={label}>
                <i className="legend-symbol" style={{ background: color }} />
                {label}
              </span>
            ))}
          </div>
        ) : (
          <div className="map-legend" aria-label="Priority legend">
            {Object.entries(priorityPins).map(([value, pin]) => (
              <span key={value}>
                <span className="legend-symbol" style={{ background: pin.color }}>
                  {pin.symbol}
                </span>
                {priorities[value].label}
              </span>
            ))}
          </div>
        )}
      </Panel>
      <div className="summary-grid full">
        <Panel title="Latest matching reports" detail={`${visible.length} total`}>
          <ReportList reports={[...visible].sort(newestFirst).slice(0, 6)} />
        </Panel>
        <Panel title="Priority concerns" detail={`${high.length} active`}>
          <ReportList reports={high.slice(0, 4)} />
        </Panel>
      </div>
      <Panel title="Administration" className="full">
        <div className="actions">
          <button className="btn primary" onClick={() => setPage('users')}>
            Manage users & validators
          </button>
          <button className="btn" onClick={() => setPage('routing')}>
            Routing rules
          </button>
          <button className="btn" onClick={() => setPage('audit')}>
            Audit history
          </button>
        </div>
      </Panel>
    </div>
  );
}
