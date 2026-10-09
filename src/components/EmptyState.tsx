import type { ReactNode } from 'react';
import { DashboardEmptyState, type DashboardEmptyVariant } from './DashboardEmptyState';

/** Einheitlicher leerer Zustand mit wiederverwendbaren SoloOffice-Illustrationen. */
export function EmptyState({
  variant,
  title,
  description,
  action,
  compact = false,
}: {
  variant: DashboardEmptyVariant;
  title: string;
  description?: ReactNode;
  action?: { label: string; onClick: () => void; disabled?: boolean };
  compact?: boolean;
}) {
  return <DashboardEmptyState variant={variant} title={title} description={description} action={action} compact={compact} />;
}
