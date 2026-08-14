/**
 * Maße für die Aktionsspalte der Listentabellen.
 *
 * Die Werte spiegeln `.action-icon-button` aus `index.css` (32 × 32 Pixel) und
 * den in den Tabellen verwendeten Abstand `gap-1` (4 Pixel). Sie liegen hier
 * zentral, damit Spaltenbreite und Umschaltpunkt auf allen Listenseiten aus
 * derselben Rechnung stammen.
 */
export const ACTION_ICON_BUTTON_SIZE = 32;
export const ACTION_ICON_BUTTON_GAP = 4;

/** Horizontales Padding der Aktionszelle, wenn die Icon-Aktionen sichtbar sind (px-3). */
export const ACTION_CELL_PADDING = 24;

/** Breite der Aktionsspalte, solange nur der Drei-Punkte-Auslöser sichtbar ist (w-14). */
export const ACTION_MENU_COLUMN_WIDTH = 56;

/** Spaltenbreite, in der `count` Icon-Aktionen ohne Zeilenumbruch nebeneinander passen. */
export function actionColumnWidth(count: number): number {
  if (count <= 0) return ACTION_MENU_COLUMN_WIDTH;
  return count * ACTION_ICON_BUTTON_SIZE
    + (count - 1) * ACTION_ICON_BUTTON_GAP
    + ACTION_CELL_PADDING;
}

interface ListTableLayoutOptions {
  /** Summe aller festen Spaltenbreiten ohne Status- und Aktionsspalte. */
  baseColumnsWidth: number;
  /** Mindestbreite der mitwachsenden Spalte, etwa Kundenname oder Bezeichnung. */
  flexibleColumnMinWidth: number;
  /** Höchste Anzahl Icon-Aktionen, die eine Zeile dieser Liste zeigen kann. */
  maxActions: number;
  /** Breite der Statusspalte mit Textbadge; 0, wenn es keine Statusspalte gibt. */
  statusLabelWidth?: number;
  /** Breite der Statusspalte, wenn der Status nur als Punkt dargestellt wird. */
  statusDotWidth?: number;
}

export interface ListTableLayout {
  /** Breite der Aktionsspalte mit ausgeschriebenen Icon-Aktionen. */
  actionsColumnWidth: number;
  /** Ab dieser Tabellenbreite passen die Icon-Aktionen nebeneinander. */
  inlineActionsMinWidth: number;
  /** Ab dieser Tabellenbreite passt zusätzlich der ausgeschriebene Status. */
  statusLabelMinWidth: number;
}

/**
 * Berechnet die Umschaltpunkte einer Listentabelle.
 *
 * Verdichtet wird in zwei Stufen: Zuerst weicht der Statustext dem Statuspunkt,
 * erst danach wandern die Icon-Aktionen in das Drei-Punkte-Menü. Aktionen
 * bleiben so am längsten direkt erreichbar.
 */
export function listTableLayout({
  baseColumnsWidth,
  flexibleColumnMinWidth,
  maxActions,
  statusLabelWidth = 0,
  statusDotWidth = 0,
}: ListTableLayoutOptions): ListTableLayout {
  const actionsColumnWidth = actionColumnWidth(maxActions);
  const inlineActionsMinWidth = baseColumnsWidth
    + flexibleColumnMinWidth
    + statusDotWidth
    + actionsColumnWidth;

  return {
    actionsColumnWidth,
    inlineActionsMinWidth,
    statusLabelMinWidth: inlineActionsMinWidth + (statusLabelWidth - statusDotWidth),
  };
}
