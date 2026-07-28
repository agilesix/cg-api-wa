import type { WaGrant } from '../../src/adapter';

/** Based on FundHubWA record 2080, trimmed for deterministic tests. */
export const waFixture: WaGrant = {
  id: 2080,
  date_gmt: '2026-07-28T20:34:40',
  modified_gmt: '2026-07-28T20:34:40',
  slug: 'connecting-housing-to-infrastructure-program',
  link: 'https://fundhub.wa.gov/funding/connecting-housing-to-infrastructure-program/',
  title: {
    rendered: 'Connecting Housing &amp; Infrastructure Program',
  },
  acf: {
    funding_status: 'active',
    featured_funding: true,
    internal_reference_id: 'WAFHW2080',
    external_reference_id: 'commercewagov_276366',
    application_open_date: '20260701',
    application_close_date: '20260930',
    application_close_time: '15:00',
    expiry_date: null,
    period_of_performance_start: '20261001',
    period_of_performance_end: '20270630',
    fund_published_date: '20260701',
    open_date: null,
    federal_or_state: 'state',
    source: 'WA Department of Commerce',
    total_amount: '31,000,000',
    number_of_awards: 'Multiple',
    award_start: '1000000',
    ending_amount: '2000000',
    disbursement_notes: 'Reimbursement',
    cost_share: 'no',
    description: 'Supports <strong>affordable housing</strong> infrastructure.',
    pre_application: 'no',
    eligibility: '<h4>Eligible entities</h4><p>Cities, counties, and utilities.</p>',
    requirements: 'Funds must be spent by June 30, 2027.',
    application_link: {
      title: 'Apply Now',
      url: 'https://example.wa.gov/apply',
      target: '_blank',
    },
    contact:
      'Mischa Venables, Program Manager, Email: <a href="mailto:mischa@example.wa.gov">mischa@example.wa.gov</a>',
    technical_assistance_contact: 'Technical help: help@example.wa.gov',
    resources: '<ul><li><a href="https://example.wa.gov/nofo.pdf">NOFO</a></li></ul>',
    score: 6,
    score_reason: 'Strong Washington infrastructure alignment.',
  },
  'funding-type': [6],
  'funding-audience': [19, 22],
  'funding-sector': [29],
  'funding-disbursement-method': [8],
  'funding-activity': [43],
  'funding-location': [11],
  _embedded: {
    'wp:term': [
      [{ id: 6, name: 'Grant', slug: 'grant', taxonomy: 'funding-type' }],
      [
        {
          id: 22,
          name: 'Local Government',
          slug: 'local-government',
          taxonomy: 'funding-audience',
        },
        { id: 19, name: 'Businesses', slug: 'businesses', taxonomy: 'funding-audience' },
      ],
      [
        {
          id: 29,
          name: 'Buildings &amp; Infrastructure',
          slug: 'buildings-infrastructure',
          taxonomy: 'funding-sector',
        },
      ],
      [
        {
          id: 8,
          name: 'Reimbursement',
          slug: 'reimbursement',
          taxonomy: 'funding-disbursement-method',
        },
      ],
      [
        {
          id: 43,
          name: 'Program Management',
          slug: 'program-management',
          taxonomy: 'funding-activity',
        },
      ],
      [{ id: 11, name: 'WA', slug: 'wa', taxonomy: 'funding-location' }],
    ],
  },
};

export const federalFixture: WaGrant = {
  ...waFixture,
  id: 2081,
  acf: { ...waFixture.acf, federal_or_state: 'federal' },
};
