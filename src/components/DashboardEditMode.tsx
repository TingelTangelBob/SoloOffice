import type { ReactNode } from 'react';
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowLeft, ArrowRight, EyeOff, GripVertical, Plus, RotateCcw } from 'lucide-react';
import type { DashboardItemId, DashboardSize } from '../utils/dashboardPreferences';

/*
 * Bearbeiten-Modus der Übersicht: Kacheln und Schnellzugriffe werden direkt
 * an ihrem Platz verschoben, ein- und ausgeblendet. Ziehen geht mit Maus
 * (nach 5 px), Touch (nach kurzem Halten, damit Scrollen möglich bleibt) und
 * Tastatur (Griff fokussieren, Leertaste, Pfeiltasten). Zusätzlich gibt es
 * Pfeil-Schaltflächen als Alternative ohne Ziehen.
 */

const SIZE_LABELS: Record<DashboardSize, { short: string; long: string }> = {
  quarter: { short: '1/4', long: 'ein Viertel' },
  third: { short: '1/3', long: 'ein Drittel' },
  half: { short: '1/2', long: 'halbe Breite' },
  'two-thirds': { short: '2/3', long: 'zwei Drittel' },
  'three-quarters': { short: '3/4', long: 'drei Viertel' },
  full: { short: 'Voll', long: 'volle Breite' },
};

const SCREEN_READER_INSTRUCTIONS = {
  draggable: 'Zum Verschieben Leertaste oder Eingabetaste drücken. Mit den Pfeiltasten die Position ändern, erneut Leertaste oder Eingabetaste zum Ablegen, Escape zum Abbrechen.',
};

export function DashboardSortableGroup({ ids, labelOf, onMove, children }: {
  ids: DashboardItemId[];
  labelOf: (id: DashboardItemId) => string;
  onMove: (activeId: DashboardItemId, overId: DashboardItemId) => void;
  children: ReactNode;
}) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const position = (id: UniqueIdentifier) => ids.indexOf(id as DashboardItemId) + 1;
  const label = (id: UniqueIdentifier) => labelOf(id as DashboardItemId);
  const announcements: Announcements = {
    onDragStart: ({ active }) => `${label(active.id)} aufgenommen, Position ${position(active.id)} von ${ids.length}.`,
    onDragOver: ({ active, over }) => over
      ? `${label(active.id)} ist jetzt auf Position ${position(over.id)} von ${ids.length}.`
      : `${label(active.id)} ist außerhalb des Bereichs.`,
    onDragEnd: ({ active, over }) => over
      ? `${label(active.id)} auf Position ${position(over.id)} von ${ids.length} abgelegt.`
      : `${label(active.id)} abgelegt.`,
    onDragCancel: ({ active }) => `Verschieben abgebrochen. ${label(active.id)} bleibt auf Position ${position(active.id)}.`,
  };
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) onMove(active.id as DashboardItemId, over.id as DashboardItemId);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      accessibility={{ announcements, screenReaderInstructions: SCREEN_READER_INSTRUCTIONS }}
    >
      <SortableContext items={ids} strategy={rectSortingStrategy}>{children}</SortableContext>
    </DndContext>
  );
}

/** Setzt `inert`, damit Inhalte im Bearbeiten-Modus weder Klick noch Fokus erhalten. */
const makeInert = (node: HTMLElement | null) => { node?.setAttribute('inert', ''); };

export function DashboardEditItem({ id, label, className = '', children, canMoveBack, canMoveForward, onMoveBack, onMoveForward, onHide, size, onCycleSize, compactLabel = false }: {
  id: DashboardItemId;
  label: string;
  className?: string;
  children: ReactNode;
  canMoveBack: boolean;
  canMoveForward: boolean;
  onMoveBack: () => void;
  onMoveForward: () => void;
  onHide: () => void;
  size?: DashboardSize;
  onCycleSize?: () => void;
  /** Schnellzugriffe tragen ihren Namen schon in der Karte; mobil (halbe Breite) bleibt so Platz für die Bedienelemente. */
  compactLabel?: boolean;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const sizeLabel = size ? SIZE_LABELS[size] : null;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`dashboard-edit-item flex flex-col ${className}`}
      data-dragging={isDragging ? 'true' : 'false'}
    >
      <div className="flex min-w-0 items-center gap-0.5 pb-1">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-roledescription="verschiebbare Kachel"
          aria-label={`${label} verschieben`}
          title="Ziehen zum Verschieben"
          className="dashboard-edit-control dashboard-edit-handle"
        >
          <GripVertical className="h-4 w-4" aria-hidden="true" />
        </button>
        <span className={`min-w-0 flex-1 truncate px-1 text-xs font-medium text-gray-600 ${compactLabel ? 'invisible sm:visible' : ''}`} aria-hidden={compactLabel || undefined}>{label}</span>
        <button type="button" className="dashboard-edit-control" onClick={onMoveBack} disabled={!canMoveBack}
          aria-label={`${label} nach vorne verschieben`} title="Nach vorne">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <button type="button" className="dashboard-edit-control" onClick={onMoveForward} disabled={!canMoveForward}
          aria-label={`${label} nach hinten verschieben`} title="Nach hinten">
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
        {sizeLabel && onCycleSize && (
          // Auf schmalen Bildschirmen ist jede Kachel voll breit; die Breite
          // wirkt erst ab Tablet und wird deshalb erst dort angeboten.
          <button type="button" className="dashboard-edit-control hidden tabular-nums md:inline-flex" onClick={onCycleSize}
            aria-label={`Breite von ${label}: ${sizeLabel.long}. Ändern`} title="Breite ändern">
            {sizeLabel.short}
          </button>
        )}
        <button type="button" className="dashboard-edit-control" onClick={onHide} aria-label={`${label} ausblenden`} title="Ausblenden">
          <EyeOff className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div ref={makeInert} className="dashboard-edit-item-content flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

export interface DashboardAddOption {
  id: DashboardItemId;
  label: string;
  description: string;
}

export function DashboardEditToolbar({ onReset, onCancel, onDone, canReset, addGroups, onAdd }: {
  onReset: () => void;
  onCancel: () => void;
  onDone: () => void;
  canReset: boolean;
  addGroups: { title: string; options: DashboardAddOption[] }[];
  onAdd: (id: DashboardItemId) => void;
}) {
  const hasOptions = addGroups.some(group => group.options.length > 0);
  return (
    <section aria-label="Dashboard anpassen" className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 lg:px-6">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-gray-900">Dashboard anpassen</h2>
          <p className="mt-0.5 text-xs text-gray-500">Ziehen oder die Pfeile nutzen, um die Reihenfolge zu ändern.</p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <button type="button" onClick={onReset} disabled={!canReset}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50">
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Auf Standard zurücksetzen
          </button>
          <span className="flex flex-1 justify-end gap-2 sm:flex-none">
            <button type="button" onClick={onCancel}
              className="min-h-10 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50">
              Abbrechen
            </button>
            <button type="button" onClick={onDone}
              className="btn-primary min-h-10 rounded-lg px-5 py-2 text-sm font-semibold text-white transition hover:brightness-90">
              Fertig
            </button>
          </span>
        </div>
      </div>
      <div className="border-t border-gray-200 px-4 py-3 lg:px-6">
        <h3 className="text-xs font-semibold text-gray-500">Hinzufügen</h3>
        {hasOptions ? addGroups.filter(group => group.options.length > 0).map(group => (
          <div key={group.title} className="mt-2">
            <p className="mb-1.5 text-[11px] text-gray-500" aria-hidden="true">{group.title}</p>
            <ul className="flex flex-wrap gap-2" aria-label={group.title}>
              {group.options.map(option => (
                <li key={option.id} className="min-w-0">
                  <button type="button" onClick={() => onAdd(option.id)} title={option.description}
                    aria-label={`${option.label} hinzufügen (${group.title})`}
                    className="dashboard-add-chip inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full px-3 py-1 text-sm">
                    <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">{option.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )) : (
          <p className="mt-1 text-xs text-gray-500">Alle verfügbaren Kacheln und Schnellzugriffe sind eingeblendet.</p>
        )}
      </div>
    </section>
  );
}
