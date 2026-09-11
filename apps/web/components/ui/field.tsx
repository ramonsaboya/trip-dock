'use client';

import { cloneElement, isValidElement, useId, type ReactNode } from 'react';
import { type TripDraftFieldState, type TripDraftFieldStatus } from '../../lib/trips/types';

export const fieldStatusPresentation: Record<TripDraftFieldStatus, { icon: string; label: string }> = {
  EXPLICIT: { icon: '✓', label: 'From your prompt' },
  INTERPRETED: { icon: '≈', label: 'Interpreted' },
  SUGGESTED: { icon: '?', label: 'Suggested' },
  CONFIRMED: { icon: '✓', label: 'Confirmed' },
  MISSING: { icon: '○', label: 'Missing' },
  NEEDS_ATTENTION: { icon: '!', label: 'Needs attention' },
  INVALID: { icon: '×', label: 'Invalid' },
  CONFLICTING: { icon: '!', label: 'Conflicting' },
  PAST: { icon: '↶', label: 'Past date' },
};

export function Field({
  label,
  children,
  hint,
  fieldState,
  fillStatus,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  fieldState?: TripDraftFieldState;
  fillStatus?: 'auto' | 'suggested';
}) {
  const controlId = useId();
  const hintId = useId();
  const resolvedControlId = isValidElement<{ id?: string }>(children)
    ? children.props.id ?? controlId
    : controlId;
  const fieldMessage = fieldState &&
    ['NEEDS_ATTENTION', 'INVALID', 'CONFLICTING', 'PAST'].includes(fieldState.status)
    ? fieldState.message
    : hint;
  const control = isValidElement<{
    id?: string;
    'aria-describedby'?: string;
    'aria-invalid'?: boolean | 'false' | 'true';
  }>(children)
    ? cloneElement(children, {
        id: resolvedControlId,
        'aria-describedby': [children.props['aria-describedby'], fieldMessage ? hintId : null]
          .filter(Boolean)
          .join(' ') || undefined,
        'aria-invalid': ['INVALID', 'CONFLICTING'].includes(fieldState?.status ?? '') || undefined,
      })
    : children;
  const statusPresentation = fieldState
    ? fieldStatusPresentation[fieldState.status]
    : fillStatus === 'suggested'
      ? { icon: '≈', label: 'Suggested' }
      : fillStatus === 'auto'
        ? { icon: '↔', label: 'Auto-filled' }
        : null;
  const showsStatus = Boolean(
    statusPresentation &&
    !['EXPLICIT', 'CONFIRMED'].includes(fieldState?.status ?? '') &&
    !(fieldState?.status === 'MISSING' && !fieldState.blocking),
  );
  return (
    <div className="field" data-fill-status={fieldState?.status.toLowerCase() ?? fillStatus}>
      <div className="field-label">
        <label htmlFor={resolvedControlId}>{label}</label>
        {showsStatus && statusPresentation ? <span className="fill-status"><span aria-hidden="true">{statusPresentation.icon}</span> {statusPresentation.label}</span> : null}
      </div>
      {control}
      {fieldMessage ? <small id={hintId}>{fieldMessage}</small> : null}
    </div>
  );
}
