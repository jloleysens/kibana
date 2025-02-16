/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import { render } from '@testing-library/react';
import { AlertsPreview } from './alerts_preview';
import { TestProviders } from '../../../common/mock/test_providers';
import type { ParsedAlertsData } from '../../../overview/components/detection_response/alerts_by_status/types';
import { useMisconfigurationPreview } from '@kbn/cloud-security-posture/src/hooks/use_misconfiguration_preview';
import { useVulnerabilitiesPreview } from '@kbn/cloud-security-posture/src/hooks/use_vulnerabilities_preview';

const mockAlertsData: ParsedAlertsData = {
  open: {
    total: 3,
    severities: [
      { key: 'low', value: 2, label: 'Low' },
      { key: 'medium', value: 1, label: 'Medium' },
    ],
  },
  acknowledged: {
    total: 2,
    severities: [
      { key: 'low', value: 1, label: 'Low' },
      { key: 'high', value: 1, label: 'High' },
    ],
  },
};

// Mock hooks
jest.mock('@kbn/cloud-security-posture/src/hooks/use_misconfiguration_preview');
jest.mock('@kbn/cloud-security-posture/src/hooks/use_vulnerabilities_preview');

describe('AlertsPreview', () => {
  const mockOpenLeftPanel = jest.fn();

  beforeEach(() => {
    (useVulnerabilitiesPreview as jest.Mock).mockReturnValue({
      data: { count: { CRITICAL: 0, HIGH: 1, MEDIUM: 1, LOW: 0, UNKNOWN: 0 } },
    });
    (useMisconfigurationPreview as jest.Mock).mockReturnValue({
      data: { count: { passed: 1, failed: 1 } },
    });
  });
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders', () => {
    const { getByTestId } = render(
      <TestProviders>
        <AlertsPreview
          alertsData={mockAlertsData}
          isLinkEnabled={true}
          openDetailsPanel={mockOpenLeftPanel}
        />
      </TestProviders>
    );

    expect(getByTestId('securitySolutionFlyoutInsightsAlertsTitleLink')).toBeInTheDocument();
  });

  it('renders correct alerts number', () => {
    const { getByTestId } = render(
      <TestProviders>
        <AlertsPreview
          alertsData={mockAlertsData}
          isLinkEnabled={true}
          openDetailsPanel={mockOpenLeftPanel}
        />
      </TestProviders>
    );

    expect(getByTestId('securitySolutionFlyoutInsightsAlertsCount').textContent).toEqual('5');
  });

  it('should render the correct number of distribution bar section based on the number of severities', () => {
    const { queryAllByTestId } = render(
      <TestProviders>
        <AlertsPreview
          alertsData={mockAlertsData}
          isLinkEnabled={true}
          openDetailsPanel={mockOpenLeftPanel}
        />
      </TestProviders>
    );

    expect(queryAllByTestId('AlertsPreviewDistributionBarTestId__part').length).toEqual(3);
  });
});
