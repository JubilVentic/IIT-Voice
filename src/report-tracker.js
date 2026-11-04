export const trackingSteps = ['Submitted', 'Validation', 'Office action', 'Final review', 'Closed'];

const states = {
  submitted: [
    1,
    'Your concern is awaiting validation',
    'The validator will check your report and assign valid concerns to a responsible office.',
  ],
  needs_information: [
    1,
    'The review team needs your help',
    'Read the latest update and add the requested information below so validation can continue.',
  ],
  validated: [
    2,
    'Your concern has been assigned',
    'The responsible office will review the assignment and begin work.',
  ],
  in_progress: [
    2,
    'Work is in progress',
    'The responsible office is working on your concern. Follow its progress notes below.',
  ],
  resolved: [
    3,
    'Work is complete and awaiting final review',
    'The office has marked the work complete. Main Admin still needs to review it and close the concern.',
  ],
  closed: [
    4,
    'Your concern has been closed',
    'Main Admin has completed the final review. The report and its updates remain available here.',
  ],
  rejected: [
    1,
    'Your concern was not validated',
    'Read the validation decision below for the reason. This report will not proceed to office action.',
  ],
  duplicate: [
    1,
    'This concern was marked as a duplicate',
    'The review team linked this submission to an existing concern. Read the decision below for details.',
  ],
};

export function reportTracking(report) {
  const [step, title, description] = states[report.status] || [
    0,
    'Report status unavailable',
    'Check the report activity for the latest update.',
  ];
  return {
    step,
    title,
    description,
    stopped: ['rejected', 'duplicate'].includes(report.status),
    needsInformation: report.status === 'needs_information',
    closed: report.status === 'closed',
    latest: report.events?.filter((event) => !event.internal).at(-1),
  };
}
