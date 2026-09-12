import { Package } from 'lucide-react';
import { PageHeader } from './PageHeader';
import { PositionTemplatesPanel } from './PositionTemplatesPanel';

/** Eigenständiger Verwaltungsbereich für wiederverwendbare Positionen. */
export function PositionTemplatesManagement() {
  return (
    <div className="space-y-8">
      <PageHeader
        icon={Package}
        title="Positionen"
        subtitle="Stundensätze und Materialvorlagen zentral verwalten"
      />
      <PositionTemplatesPanel />
    </div>
  );
}
