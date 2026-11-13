import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ChildCaseList, formatAge } from '../components/case/ChildCaseList';
import { caseAPI } from '../api';

vi.mock('../api', () => ({
  caseAPI: {
    list: vi.fn(),
  },
}));

const mockedCaseAPI = vi.mocked(caseAPI);

const domain = (name: string, score: number | null, zone: string, referralCutoff: number | null = 25) => ({
  domain: name,
  score,
  maxScore: 60,
  referralCutoff,
  monitorCutoff: referralCutoff != null ? referralCutoff + 3 : null,
  status: null,
  zone,
});

describe('ChildCaseList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows child age and gender, M-CHAT-R score + risk, and ASQ-3 domain zones', async () => {
    mockedCaseAPI.list.mockResolvedValue({
      data: {
        data: [
          {
            _id: 'case-1',
            childId: 'child-1',
            childName: 'Amna Khan',
            child: { dateOfBirth: '2024-10-01', ageMonths: 25, gender: 'female' },
            parentName: 'Sara Khan',
            parentEmail: 'sara@example.com',
            riskLevel: 'high',
            status: 'REVIEW',
            updatedAt: '2026-11-10T09:00:00.000Z',
            screenings: {
              mchat: { totalScore: 20, maxScore: 20, result: 'Fail', riskLevel: 'high' },
              asq3: {
                intervalMonths: 24,
                result: 'Fail',
                riskLevel: 'high',
                domains: [
                  domain('Communication', 20, 'refer', 25),
                  domain('Gross Motor', 40, 'monitor', 38),
                  domain('Fine Motor', 60, 'ok', 35),
                  domain('Problem Solving', 60, 'ok', 30),
                  domain('Personal-Social', null, 'incomplete', 32),
                ],
              },
            },
          },
          {
            _id: 'case-2',
            childId: 'child-2',
            childName: 'Sana Ali',
            child: { dateOfBirth: null, ageMonths: null, gender: 'female' },
            parentName: 'Ali Raza',
            parentEmail: null,
            riskLevel: 'unknown',
            status: 'NEW',
            updatedAt: '2026-11-10T09:00:00.000Z',
            screenings: { mchat: null, asq3: null },
          },
        ],
      },
    } as any);

    render(<ChildCaseList onOpenCase={() => {}} />);

    expect(await screen.findByText('Amna Khan')).toBeInTheDocument();
    expect(screen.getByText('2 y 1 m · Female')).toBeInTheDocument();
    expect(screen.getByText('M-CHAT-R 20/20 · High')).toBeInTheDocument();
    expect(screen.getByText(/ASQ-3 \(24 mo\)/)).toBeInTheDocument();

    const chips = within(screen.getByLabelText('ASQ-3 domain results'));
    const comm = chips.getByText('Comm 20');
    expect(comm).toHaveAttribute('data-zone', 'refer');
    expect(comm).toHaveAttribute('title', 'Communication 20/60 — below referral cutoff 25');
    expect(chips.getByText('GM 40')).toHaveAttribute('data-zone', 'monitor');
    expect(chips.getByText('FM 60')).toHaveAttribute('data-zone', 'ok');
    expect(chips.getByText('P-S —')).toHaveAttribute('data-zone', 'incomplete');

    // A case with no screening yet: gender only, both questionnaires marked as not done.
    expect(screen.getByText('Sana Ali')).toBeInTheDocument();
    expect(screen.getByText('Female')).toBeInTheDocument();
    expect(screen.getByText('M-CHAT-R not done')).toBeInTheDocument();
    expect(screen.getByText('ASQ-3 not done')).toBeInTheDocument();
  });

  it('formats ages in years and months', () => {
    expect(formatAge(7)).toBe('7 m');
    expect(formatAge(24)).toBe('2 y');
    expect(formatAge(25)).toBe('2 y 1 m');
    expect(formatAge(null)).toBeNull();
  });
});
