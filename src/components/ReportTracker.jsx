import { date, useAction } from '../lib.js';
import { reportTracking, trackingSteps } from '../report-tracker.js';

export function ReportTracker({ report, onRefresh }) {
  const state = reportTracking(report);
  const action = useAction();
  return (
    <section
      className={`report-tracker${state.stopped || state.needsInformation ? ' needs-attention' : ''}`}
      aria-label="Track your concern"
    >
      <div className="tracker-heading">
        <div>
          <p className="eyebrow">YOUR REPORT PROGRESS</p>
          <h3>{state.title}</h3>
          <p>{state.description}</p>
        </div>
        <div className="tracker-tools">
          <span className="tracker-stage">
            {state.stopped
              ? 'Validation decision'
              : `Step ${state.step + 1} of ${trackingSteps.length}`}
          </span>
          <button
            type="button"
            className="btn"
            disabled={action.busy}
            onClick={() => action.run(onRefresh)}
          >
            {action.busy ? 'Refreshing…' : 'Refresh progress'}
          </button>
        </div>
      </div>
      {action.error && (
        <p className="inline-error" role="alert">
          {action.error}
        </p>
      )}
      <ol className="tracker-steps" aria-label="Report progress stages">
        {trackingSteps.map((label, index) => {
          const done = index < state.step || state.closed;
          return (
            <li
              key={label}
              className={done ? 'is-complete' : index === state.step ? 'is-current' : ''}
              aria-current={index === state.step ? 'step' : undefined}
            >
              <span className="tracker-node" aria-hidden="true">
                {done ? '✓' : state.stopped && index === state.step ? '!' : index + 1}
              </span>
              <strong>{label}</strong>
              <small>
                {done
                  ? 'Complete'
                  : index === state.step
                    ? state.stopped
                      ? 'Stopped here'
                      : state.needsInformation
                        ? 'Your input needed'
                        : 'Current stage'
                    : 'Not reached'}
              </small>
            </li>
          );
        })}
      </ol>
      <dl className="tracker-facts">
        <div>
          <dt>Handling office</dt>
          <dd>{report.office || 'Awaiting validation & assignment'}</dd>
        </div>
        <div>
          <dt>Assigned to</dt>
          <dd>{report.assigned_admin?.name || 'Not assigned yet'}</dd>
        </div>
        <div>
          <dt>Submitted</dt>
          <dd>{date(report.created_at)}</dd>
        </div>
      </dl>
      {state.latest && (
        <div className="tracker-latest">
          <span className="eyebrow">LATEST UPDATE</span>
          <p>
            {state.latest.kind === 'status'
              ? state.latest.message.split(' — ').slice(1).join(' — ') || state.title
              : state.latest.message}
          </p>
          <small>
            {state.latest.actor} · {date(state.latest.created_at)}
          </small>
        </div>
      )}
      {state.needsInformation && (
        <a href="#comment-form" className="btn solid">
          Add requested information ↓
        </a>
      )}
      {report.duplicate_of && (
        <p className="map-caption">
          Linked concern: IV-{String(report.duplicate_of).padStart(4, '0')}. The review team can
          help you follow the related report.
        </p>
      )}
    </section>
  );
}
