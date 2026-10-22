/**
 * Gemeinsamer Renderer für Rechnungen, Angebote, Bestätigungen und Mahnungen.
 *
 * Die Generatoren beschreiben nur den Inhalt (Kopfdaten, Tabelle, Summen,
 * Texte); Platzierung, Umbrüche, Seitenwechsel und das Design entstehen hier.
 * Jede Textzeile wird vor dem Zeichnen auf ihre Spaltenbreite umbrochen und
 * jede Höhe vorab gemessen, damit sich keine Inhalte überlagern.
 *
 * Maße in mm (A4). Der Empfänger steht nach DIN 5008 Form B im Sichtfenster:
 * Anschriftfeld 45–90 mm von oben, 20 mm vom linken Rand.
 */

import type { Company, Customer, DocumentDesignId, DocumentFontFamily } from '../../types';
import { hexToRgb, type RgbColor } from './colorUtils';
import { loadPdfImage } from './imageHelpers';
import logger from '../logger';
import { getEffectivePaymentInformation } from '../paymentInformation';

export interface PdfField {
  label: string;
  value: string;
}

export interface PdfTableColumn {
  label: string;
  /** Feste Breite in mm; genau eine Spalte ohne Breite füllt den Rest. */
  width?: number;
  align?: 'left' | 'right';
}

export interface PdfTable {
  columns: PdfTableColumn[];
  rows: string[][];
}

export interface PdfAmountLine {
  label: string;
  value: string;
  tone?: 'default' | 'negative' | 'positive';
}

export interface PdfDocumentModel {
  /** Dokumentart in normaler Schreibweise, z. B. „Rechnung“. */
  title: string;
  number?: string;
  meta: PdfField[];
  recipient: Customer;
  notice?: { title: string; text: string };
  intro?: string;
  blocks?: Array<{ heading: string; text: string }>;
  table?: PdfTable;
  totals?: { lines: PdfAmountLine[]; grand: PdfAmountLine };
  clauses?: string[];
  notes?: { heading: string; text: string };
  payment?: { heading: string; emphasis?: string; intro?: string; fields: PdfField[] };
  texts?: string[];
  signature?: { heading: string; lines: string[]; image?: string };
}

/**
 * Zeichenfläche des Renderers: die von jsPDF genutzten Methoden. Für die
 * Vorschau zeichnet eine Aufzeichnung dieselben Schritte als SVG nach.
 */
export interface PdfSurface {
  setFont(fontName: string, fontStyle?: string): unknown;
  setFontSize(size: number): unknown;
  setTextColor(r: number, g: number, b: number): unknown;
  setFillColor(r: number, g: number, b: number): unknown;
  setDrawColor(r: number, g: number, b: number): unknown;
  setLineWidth(width: number): unknown;
  rect(x: number, y: number, width: number, height: number, style?: string | null): unknown;
  line(x1: number, y1: number, x2: number, y2: number): unknown;
  text(text: string | string[], x: number, y: number, options?: { align?: 'left' | 'center' | 'right'; charSpace?: number }): unknown;
  splitTextToSize(text: string, maxWidth: number): string[];
  getTextWidth(text: string): number;
  addImage(imageData: string, format: string, x: number, y: number, width: number, height: number): unknown;
  addPage(): unknown;
  setPage(pageNumber: number): unknown;
}

export interface PdfRenderSettings {
  design: DocumentDesignId;
  font: DocumentFontFamily;
  accentColor: string;
  showLogo: boolean;
  showFooter: boolean;
  /** Bankverbindung zusätzlich im Fuß, wenn Zahlungsinformationen aktiv sind. */
  showBankDetails: boolean;
}

type FontStyle = 'normal' | 'bold' | 'italic';
type TableHeaderStyle = 'light' | 'accent' | 'dark' | 'rule' | 'accentRule';
type GrandTotalStyle = 'rule' | 'ruleLarge' | 'box' | 'accentRule' | 'double';
type HeadingStyle = 'dark' | 'accent' | 'label';
type FooterStyle = 'columns' | 'columnsHeadings' | 'centered';

interface DesignConfig {
  titleInHeader: boolean;
  tableHeader: TableHeaderStyle;
  zebra: boolean;
  rowLines: boolean;
  grandTotal: GrandTotalStyle;
  heading: HeadingStyle;
  footer: FooterStyle;
}

const designs: Record<DocumentDesignId, DesignConfig> = {
  classic: { titleInHeader: false, tableHeader: 'light', zebra: false, rowLines: true, grandTotal: 'rule', heading: 'dark', footer: 'columns' },
  modern: { titleInHeader: true, tableHeader: 'accent', zebra: true, rowLines: false, grandTotal: 'box', heading: 'accent', footer: 'columnsHeadings' },
  minimal: { titleInHeader: false, tableHeader: 'rule', zebra: false, rowLines: true, grandTotal: 'ruleLarge', heading: 'label', footer: 'columns' },
  elegant: { titleInHeader: false, tableHeader: 'accentRule', zebra: false, rowLines: false, grandTotal: 'double', heading: 'accent', footer: 'centered' },
  bold: { titleInHeader: true, tableHeader: 'dark', zebra: false, rowLines: true, grandTotal: 'accentRule', heading: 'dark', footer: 'columnsHeadings' },
};

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const LEFT = 20;
const RIGHT = 190;
const CONTENT_WIDTH = RIGHT - LEFT;
const META_LEFT = 125;
const SENDER_Y = 57;
const RECIPIENT_Y = 63.5;
const FOOTER_TOP = 271;
const PT = 0.3528;

const INK: RgbColor = { r: 17, g: 24, b: 39 };
const TEXT: RgbColor = { r: 31, g: 41, b: 55 };
const MUTED: RgbColor = { r: 107, g: 114, b: 128 };
const LINE: RgbColor = { r: 229, g: 231, b: 235 };
const LINE_STRONG: RgbColor = { r: 209, g: 213, b: 219 };
const FILL: RgbColor = { r: 243, g: 244, b: 246 };
const WHITE: RgbColor = { r: 255, g: 255, b: 255 };
const NEGATIVE: RgbColor = { r: 185, g: 28, b: 28 };
const POSITIVE: RgbColor = { r: 21, g: 128, b: 61 };

function mix(color: RgbColor, target: RgbColor, amount: number): RgbColor {
  return {
    r: Math.round(color.r + (target.r - color.r) * amount),
    g: Math.round(color.g + (target.g - color.g) * amount),
    b: Math.round(color.b + (target.b - color.b) * amount),
  };
}

/** Text auf farbiger Fläche: dunkel auf hellen, weiß auf kräftigen Farben. */
function readableOn(color: RgbColor): RgbColor {
  const luminance = (0.299 * color.r + 0.587 * color.g + 0.114 * color.b) / 255;
  return luminance > 0.62 ? INK : WHITE;
}

function lineHeight(fontSize: number, factor = 1.4): number {
  return fontSize * PT * factor;
}

interface FooterLayout {
  size: number;
  columns: Array<{ heading: string; lines: string[]; x: number; width: number }>;
  height: number;
  withHeadings: boolean;
  centered: boolean;
}

class DocumentWriter {
  readonly pdf: PdfSurface;
  readonly model: PdfDocumentModel;
  readonly settings: PdfRenderSettings;
  readonly company: Company;
  readonly config: DesignConfig;
  readonly accent: RgbColor;
  readonly footerLayout: FooterLayout | null;
  readonly footerTop: number;
  readonly bottomLimit: number;
  y = 0;
  pageCount = 1;

  constructor(pdf: PdfSurface, model: PdfDocumentModel, settings: PdfRenderSettings, company: Company) {
    this.pdf = pdf;
    this.model = model;
    this.settings = settings;
    this.company = company;
    this.config = designs[settings.design] || designs.classic;
    this.accent = hexToRgb(settings.accentColor);
    this.footerLayout = this.layoutFooter();
    this.footerTop = this.footerLayout ? Math.min(FOOTER_TOP, PAGE_HEIGHT - 10 - this.footerLayout.height) : PAGE_HEIGHT - 12;
    this.bottomLimit = this.footerLayout ? this.footerTop - 6 : PAGE_HEIGHT - 18;
  }

  // ---------------------------------------------------------------- Grundlagen

  font(style: FontStyle, size: number): void {
    this.pdf.setFont(this.settings.font, style);
    this.pdf.setFontSize(size);
  }

  color(value: RgbColor): void {
    this.pdf.setTextColor(value.r, value.g, value.b);
  }

  fill(value: RgbColor): void {
    this.pdf.setFillColor(value.r, value.g, value.b);
  }

  stroke(value: RgbColor, width: number): void {
    this.pdf.setDrawColor(value.r, value.g, value.b);
    this.pdf.setLineWidth(width);
  }

  wrap(text: string, width: number): string[] {
    const lines = this.pdf.splitTextToSize(text, Math.max(width, 4));
    return lines.length > 0 ? lines : [''];
  }

  /** Verkleinert die Schrift, bis der Text in die Breite passt. */
  fitSize(text: string, style: FontStyle, size: number, maxWidth: number, minSize: number): number {
    let current = size;
    this.font(style, current);
    while (current > minSize && this.pdf.getTextWidth(text) > maxWidth) {
      current -= 1;
      this.font(style, current);
    }
    return current;
  }

  /**
   * Firmenname ohne Logo: erst verkleinern, dann höchstens zweizeilig
   * umbrechen, damit lange Namen weder abgeschnitten noch überlagert werden.
   */
  brandName(x: number, baseline: number, align: 'left' | 'center' | 'right', style: FontStyle, size: number, minSize: number, maxWidth: number, color: RgbColor): void {
    const name = this.company.name || '';
    const fitted = this.fitSize(name, style, size, maxWidth, minSize);
    this.font(style, fitted);
    this.color(color);
    const lines = this.wrap(name, maxWidth).slice(0, 2);
    const step = lineHeight(fitted, 1.2);
    const start = baseline - (lines.length - 1) * step / 2;
    lines.forEach((line, index) => {
      this.pdf.text(line, x, start + index * step, align === 'left' ? undefined : { align });
    });
  }

  displayTitle(): string {
    return this.settings.design === 'modern' || this.settings.design === 'elegant'
      ? this.model.title.toLocaleUpperCase('de-DE')
      : this.model.title;
  }

  ensure(height: number): boolean {
    if (this.y + height <= this.bottomLimit) return false;
    this.newPage();
    return true;
  }

  newPage(): void {
    this.pdf.addPage();
    this.pageCount += 1;
    this.decoratePage();
    this.font('normal', 8);
    this.color(MUTED);
    const label = [this.model.title, this.model.number].filter(Boolean).join(' ');
    this.pdf.text(label, RIGHT, 16, { align: 'right' });
    const nameWidth = CONTENT_WIDTH - this.pdf.getTextWidth(label) - 8;
    this.pdf.text(this.wrap(this.company.name || '', nameWidth)[0], LEFT, 16);
    this.stroke(LINE, 0.2);
    this.pdf.line(LEFT, 19.5, RIGHT, 19.5);
    this.y = 29;
  }

  /** Flächen, die auf jeder Seite stehen. */
  decoratePage(): void {
    if (this.settings.design === 'modern') {
      this.fill(this.accent);
      this.pdf.rect(0, 0, PAGE_WIDTH, 5, 'F');
    } else if (this.settings.design === 'bold') {
      this.fill(this.accent);
      this.pdf.rect(0, 0, 7, PAGE_HEIGHT, 'F');
    }
  }

  // ---------------------------------------------------------------- Briefkopf

  async brand(x: number, y: number, maxWidth: number, maxHeight: number, align: 'left' | 'center' | 'right', fallback: () => void): Promise<void> {
    const logo = this.company.logo;
    if (logo && this.settings.showLogo) {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const image = await Promise.race([
          loadPdfImage(logo),
          new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Logo loading timeout')), 5000); }),
        ]);
        const ratio = image.width / image.height;
        const width = ratio > maxWidth / maxHeight ? maxWidth : maxHeight * ratio;
        const height = width / ratio;
        const startX = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;
        this.pdf.addImage(image.source, image.format, startX, y + (maxHeight - height) / 2, width, height);
        return;
      } catch (error) {
        logger.warn('Logo konnte nicht geladen werden:', { error: String(error) });
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
      }
    }
    fallback();
  }

  async letterhead(): Promise<void> {
    const { company } = this;
    switch (this.settings.design) {
      case 'modern': {
        await this.brand(LEFT, 13, 70, 20, 'left', () => this.brandName(LEFT, 24, 'left', 'bold', 15, 10, 80, INK));
        const title = this.displayTitle();
        const size = this.fitSize(title, 'bold', 22, 92, 13);
        this.font('bold', size);
        this.color(this.accent);
        this.pdf.text(title, RIGHT, 25, { align: 'right' });
        if (this.model.number) {
          this.font('normal', 10);
          this.color(MUTED);
          this.pdf.text(this.model.number, RIGHT, 31.5, { align: 'right' });
        }
        break;
      }
      case 'minimal': {
        await this.brand(LEFT, 14, 55, 15, 'left', () => this.brandName(LEFT, 22, 'left', 'bold', 12, 9, 95, INK));
        const contact = [
          company.address,
          [company.postalCode, company.city].filter(Boolean).join(' '),
          company.phone,
          company.email,
          company.website,
        ].filter((line): line is string => Boolean(line && line.trim()));
        this.font('normal', 7.5);
        this.color(MUTED);
        contact.slice(0, 5).forEach((line, index) => {
          this.pdf.text(this.wrap(line, 60)[0], RIGHT, 16 + index * 3.6, { align: 'right' });
        });
        break;
      }
      case 'elegant': {
        await this.brand(PAGE_WIDTH / 2, 11, 70, 20, 'center', () => this.brandName(PAGE_WIDTH / 2, 23, 'center', 'normal', 20, 12, 150, this.accent));
        const address = [company.address, [company.postalCode, company.city].filter(Boolean).join(' ')].filter(Boolean).join('  ·  ');
        if (address) {
          this.font('normal', 7.5);
          this.color(MUTED);
          this.pdf.text(this.wrap(address, 150)[0], PAGE_WIDTH / 2, 35.5, { align: 'center' });
        }
        this.stroke(this.accent, 0.4);
        this.pdf.line(LEFT, 39.5, RIGHT, 39.5);
        this.stroke(this.accent, 0.15);
        this.pdf.line(LEFT, 40.6, RIGHT, 40.6);
        break;
      }
      case 'bold': {
        const title = this.model.title;
        const size = this.fitSize(title, 'bold', 28, 100, 16);
        this.font('bold', size);
        this.color(INK);
        this.pdf.text(title, LEFT, 29);
        if (this.model.number) {
          this.font('bold', 11);
          this.color(this.accent);
          this.pdf.text(this.model.number, LEFT, 36.5);
        }
        await this.brand(RIGHT, 13, 60, 22, 'right', () => this.brandName(RIGHT, 24, 'right', 'bold', 13, 9, 70, INK));
        break;
      }
      case 'classic':
      default: {
        await this.brand(RIGHT, 12, 70, 22, 'right', () => this.brandName(RIGHT, 24, 'right', 'bold', 16, 10, 100, this.accent));
        break;
      }
    }
  }

  /** Absenderzeile und Anschrift im Sichtfenster; liefert das Ende des Blocks. */
  recipient(): number {
    const { company, model } = this;
    // Rücksendeangabe: Passt sie auch verkleinert nicht in das Fenster, wird
    // der Firmenname gekürzt, nie die Anschrift.
    const addressPart = [company.address, [company.postalCode, company.city].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
    let name = company.name || '';
    let senderSize = 7;
    const senderText = () => [name, addressPart].filter(Boolean).join(' · ');
    this.font('normal', senderSize);
    while (senderSize > 5.5 && this.pdf.getTextWidth(senderText()) > 85) {
      senderSize -= 0.5;
      this.font('normal', senderSize);
    }
    while (name.length > 8 && this.pdf.getTextWidth(senderText()) > 85) {
      name = `${name.slice(0, -2).trimEnd()}…`;
    }
    const senderLine = this.wrap(senderText(), 85)[0];
    this.color(MUTED);
    this.pdf.text(senderLine, LEFT, SENDER_Y);
    this.stroke(LINE_STRONG, 0.2);
    this.pdf.line(LEFT, SENDER_Y + 1.3, LEFT + Math.min(this.pdf.getTextWidth(senderLine), 85), SENDER_Y + 1.3);

    const customer = model.recipient;
    const lines = [
      customer.name,
      customer.addressSupplement,
      customer.address,
      [customer.postalCode, customer.city].filter(Boolean).join(' '),
      customer.country && customer.country !== 'Deutschland' ? customer.country : '',
    ].filter((line): line is string => Boolean(line && line.trim()));
    this.font('normal', 10);
    this.color(INK);
    let y = RECIPIENT_Y;
    for (const line of lines) {
      for (const part of this.wrap(line, 85).slice(0, 2)) {
        this.pdf.text(part, LEFT, y);
        y += 4.6;
      }
    }
    return y;
  }

  /** Informationsblock rechts neben dem Sichtfenster. */
  meta(): number {
    const width = RIGHT - META_LEFT;
    let y = SENDER_Y;
    this.model.meta.forEach((field, index) => {
      this.font('normal', 8.5);
      const labelWidth = this.pdf.getTextWidth(field.label);
      this.color(MUTED);
      this.pdf.text(field.label, META_LEFT, y);
      this.font(index === 0 ? 'bold' : 'normal', 8.5);
      this.color(INK);
      const valueLines = this.wrap(field.value || '–', Math.max(width - labelWidth - 4, 22));
      valueLines.forEach((line, lineIndex) => {
        this.pdf.text(line, RIGHT, y + lineIndex * 3.8, { align: 'right' });
      });
      y += valueLines.length * 3.8 + 1;
    });
    return y;
  }

  title(): void {
    const title = this.displayTitle();
    const number = this.model.number || '';
    switch (this.settings.design) {
      case 'minimal': {
        const size = this.fitSize(title, 'normal', 24, CONTENT_WIDTH, 16);
        this.font('normal', size);
        this.color(INK);
        this.pdf.text(title, LEFT, this.y + 7);
        this.y += 7;
        if (number) {
          this.font('normal', 10);
          this.color(this.accent);
          this.pdf.text(number, LEFT, this.y + 6);
          this.y += 6;
        }
        this.y += 9;
        break;
      }
      case 'elegant': {
        this.font('normal', 15);
        this.color(this.accent);
        this.pdf.text(title, LEFT, this.y + 5, { charSpace: 0.8 });
        this.y += 5;
        if (number) {
          this.font('normal', 9.5);
          this.color(MUTED);
          this.pdf.text(number, LEFT, this.y + 5.5);
          this.y += 5.5;
        }
        this.y += 9;
        break;
      }
      case 'classic':
      default: {
        const size = this.fitSize(title, 'bold', 16, 110, 12);
        this.font('bold', size);
        this.color(INK);
        this.pdf.text(title, LEFT, this.y + 5);
        if (number) {
          const titleWidth = this.pdf.getTextWidth(title);
          this.font('normal', 11);
          this.color(MUTED);
          const numberX = LEFT + titleWidth + 3;
          if (numberX + this.pdf.getTextWidth(number) <= RIGHT) {
            this.pdf.text(number, numberX, this.y + 5);
          } else {
            this.pdf.text(number, LEFT, this.y + 10.5);
            this.y += 5.5;
          }
        }
        this.y += 13;
        break;
      }
    }
  }

  // ---------------------------------------------------------------- Inhalt

  heading(text: string): void {
    const { heading } = this.config;
    this.ensure(10);
    if (heading === 'label') {
      this.font('bold', 7.5);
      this.color(MUTED);
      this.pdf.text(text.toLocaleUpperCase('de-DE'), LEFT, this.y, { charSpace: 0.3 });
    } else {
      this.font('bold', 9.5);
      this.color(heading === 'accent' ? this.accent : INK);
      this.pdf.text(text, LEFT, this.y);
    }
    this.y += 5;
  }

  paragraph(text: string, options: { size?: number; color?: RgbColor; style?: FontStyle; width?: number; x?: number } = {}): void {
    const size = options.size ?? 9.5;
    const step = lineHeight(size, 1.45);
    this.font(options.style ?? 'normal', size);
    const lines = text.split('\n').flatMap(line => this.wrap(line, options.width ?? CONTENT_WIDTH));
    for (const line of lines) {
      if (this.ensure(step)) this.font(options.style ?? 'normal', size);
      this.color(options.color ?? TEXT);
      this.pdf.text(line, options.x ?? LEFT, this.y);
      this.y += step;
    }
  }

  notice(notice: { title: string; text: string }): void {
    this.font('normal', 8);
    const lines = this.wrap(notice.text, CONTENT_WIDTH - 8);
    const height = 11 + lines.length * 3.7;
    this.ensure(height + 4);
    this.fill(FILL);
    this.stroke(LINE_STRONG, 0.3);
    this.pdf.rect(LEFT, this.y - 4, CONTENT_WIDTH, height, 'FD');
    this.font('bold', 9);
    this.color(INK);
    this.pdf.text(notice.title, LEFT + 4, this.y + 1.5);
    this.font('normal', 8);
    this.color(MUTED);
    this.pdf.text(lines, LEFT + 4, this.y + 6.5);
    this.y += height + 4;
  }

  tableHeader(columns: Array<PdfTableColumn & { x: number; width: number }>): void {
    const style = this.config.tableHeader;
    const height = 8;
    const top = this.y;
    let textColor = INK;
    if (style === 'light') {
      this.fill(FILL);
      this.pdf.rect(LEFT, top, CONTENT_WIDTH, height, 'F');
    } else if (style === 'accent') {
      this.fill(this.accent);
      this.pdf.rect(LEFT, top, CONTENT_WIDTH, height, 'F');
      textColor = readableOn(this.accent);
    } else if (style === 'dark') {
      this.fill(INK);
      this.pdf.rect(LEFT, top, CONTENT_WIDTH, height, 'F');
      textColor = WHITE;
    } else if (style === 'accentRule') {
      this.stroke(this.accent, 0.5);
      this.pdf.line(LEFT, top, RIGHT, top);
      this.stroke(this.accent, 0.25);
      this.pdf.line(LEFT, top + height, RIGHT, top + height);
      textColor = this.accent;
    } else {
      this.stroke(INK, 0.3);
      this.pdf.line(LEFT, top + height, RIGHT, top + height);
      textColor = MUTED;
    }

    const uppercase = style === 'rule';
    this.font('bold', uppercase ? 7 : 8);
    this.color(textColor);
    for (const column of columns) {
      const label = uppercase ? column.label.toLocaleUpperCase('de-DE') : column.label;
      const text = this.wrap(label, column.width - 3)[0];
      if (column.align === 'right') {
        this.pdf.text(text, column.x + column.width - 2, top + 5.3, { align: 'right' });
      } else {
        this.pdf.text(text, column.x + 2, top + 5.3);
      }
    }
    this.y = top + height;
  }

  table(table: PdfTable): void {
    const fixed = table.columns.reduce((sum, column) => sum + (column.width ?? 0), 0);
    const flexible = Math.max(CONTENT_WIDTH - fixed, 30);
    let x = LEFT;
    const columns = table.columns.map(column => {
      const width = column.width ?? flexible;
      const positioned = { ...column, x, width };
      x += width;
      return positioned;
    });

    const fontSize = 9;
    const step = lineHeight(fontSize, 1.35);
    const fullPageRowHeight = this.bottomLimit - 29 - 8;
    this.font('normal', fontSize);
    const firstRowLines = table.rows[0]
      ? Math.max(...columns.map((column, index) => this.wrap(table.rows[0][index] ?? '', column.width - 4).length))
      : 0;
    const firstRowHeight = firstRowLines * step + 3.4;
    // Kopf und erste normale Position zusammenhalten. Bei einer überlangen
    // Position mindestens den ersten Abschnitt beim Kopf beginnen lassen.
    this.ensure(8 + (firstRowHeight <= fullPageRowHeight ? firstRowHeight : 12));
    this.tableHeader(columns);

    const zebraFill = mix(this.accent, WHITE, 0.93);
    table.rows.forEach((row, rowIndex) => {
      this.font('normal', fontSize);
      const cells = columns.map((column, index) => this.wrap(row[index] ?? '', column.width - 4));
      const lines = Math.max(...cells.map(cell => cell.length));
      const rowHeight = lines * step + 3.4;
      // Normale Positionen zusammenhalten. Überlange Positionen werden in
      // Zeilenpakete geteilt, statt sie außerhalb des Blatts zu zeichnen.
      if (rowHeight <= fullPageRowHeight && this.ensure(rowHeight)) this.tableHeader(columns);
      let offset = 0;
      while (offset < lines) {
        if (this.ensure(step + 3.4)) this.tableHeader(columns);
        const capacity = Math.max(1, Math.floor((this.bottomLimit - this.y - 3.4) / step));
        const count = Math.min(lines - offset, capacity);
        const height = count * step + 3.4;
        const top = this.y;
        if (this.config.zebra && rowIndex % 2 === 1) {
          this.fill(zebraFill);
          this.pdf.rect(LEFT, top, CONTENT_WIDTH, height, 'F');
        }
        this.font('normal', fontSize);
        this.color(TEXT);
        cells.forEach((cellLines, index) => {
          const column = columns[index];
          cellLines.slice(offset, offset + count).forEach((line, lineIndex) => {
            const baseline = top + 1.7 + step * 0.78 + lineIndex * step;
            if (column.align === 'right') {
              this.pdf.text(line, column.x + column.width - 2, baseline, { align: 'right' });
            } else {
              this.pdf.text(line, column.x + 2, baseline);
            }
          });
        });
        if (this.config.rowLines) {
          this.stroke(LINE, 0.2);
          this.pdf.line(LEFT, top + height, RIGHT, top + height);
        }
        this.y = top + height;
        offset += count;
      }
    });

    if (this.config.tableHeader === 'accentRule') {
      this.stroke(this.accent, 0.25);
      this.pdf.line(LEFT, this.y, RIGHT, this.y);
    } else if (!this.config.rowLines) {
      this.stroke(LINE_STRONG, 0.2);
      this.pdf.line(LEFT, this.y, RIGHT, this.y);
    }
    this.y += 7;
  }

  totals(totals: NonNullable<PdfDocumentModel['totals']>): void {
    const left = 100;
    const labelX = left + 2;
    const valueX = RIGHT - 2;
    const step = 5.2;
    const style = this.config.grandTotal;
    const grandHeight = style === 'box' ? 14 : style === 'accentRule' ? 12 : 11;
    this.ensure(totals.lines.length * step + grandHeight + 4);

    for (const line of totals.lines) {
      this.font('normal', 9);
      const valueWidth = this.pdf.getTextWidth(line.value);
      this.color(MUTED);
      this.pdf.text(this.wrap(line.label, valueX - labelX - valueWidth - 4)[0], labelX, this.y);
      this.color(line.tone === 'negative' ? NEGATIVE : line.tone === 'positive' ? POSITIVE : TEXT);
      this.pdf.text(line.value, valueX, this.y, { align: 'right' });
      this.y += step;
    }

    // Beschriftung und Betrag der Gesamtsumme teilen sich eine Zeile; passt
    // beides nicht, wird die Schrift kleiner statt abgeschnitten.
    const grand = totals.grand;
    const size = style === 'accentRule' ? 12.5 : style === 'ruleLarge' ? 13 : style === 'box' ? 10.5 : 11;
    this.font('bold', size);
    const fitted = this.fitSize(`${grand.label}  ${grand.value}`, 'bold', size, valueX - labelX - (style === 'box' ? 2 : 0), 8);
    const labelStyle: FontStyle = style === 'ruleLarge' ? 'normal' : 'bold';
    const labelSize = style === 'ruleLarge' ? Math.min(9.5, fitted) : fitted;

    const drawGrand = (labelColor: RgbColor, valueColor: RgbColor, inset = 0) => {
      this.font(labelStyle, labelSize);
      this.color(labelColor);
      this.pdf.text(grand.label, labelX + inset, this.y);
      this.font('bold', fitted);
      this.color(valueColor);
      this.pdf.text(grand.value, valueX - inset, this.y, { align: 'right' });
    };

    switch (style) {
      case 'box': {
        const top = this.y - 2;
        this.fill(this.accent);
        this.pdf.rect(left, top, RIGHT - left, 10, 'F');
        const textColor = readableOn(this.accent);
        this.y = top + 6.6;
        drawGrand(textColor, textColor, 1);
        this.y = top + 14;
        break;
      }
      case 'accentRule': {
        this.stroke(this.accent, 1);
        this.pdf.line(left, this.y - 1.5, RIGHT, this.y - 1.5);
        this.y += 5;
        drawGrand(INK, this.accent);
        this.y += 5;
        break;
      }
      case 'double': {
        this.stroke(this.accent, 0.3);
        this.pdf.line(left, this.y - 1.5, RIGHT, this.y - 1.5);
        this.y += 4.5;
        drawGrand(this.accent, this.accent);
        this.y += 2.8;
        this.stroke(this.accent, 0.25);
        this.pdf.line(left, this.y, RIGHT, this.y);
        this.pdf.line(left, this.y + 0.9, RIGHT, this.y + 0.9);
        this.y += 5;
        break;
      }
      case 'ruleLarge': {
        this.stroke(INK, 0.3);
        this.pdf.line(left, this.y - 1.5, RIGHT, this.y - 1.5);
        this.y += 5.5;
        drawGrand(MUTED, INK);
        this.y += 5;
        break;
      }
      case 'rule':
      default: {
        this.stroke(INK, 0.35);
        this.pdf.line(left, this.y - 1.5, RIGHT, this.y - 1.5);
        this.y += 4.5;
        drawGrand(INK, this.accent);
        this.y += 5;
        break;
      }
    }
  }

  payment(payment: NonNullable<PdfDocumentModel['payment']>): void {
    const labelWidth = 34;
    const step = 4.3;
    this.font('normal', 9);
    const fields = payment.fields.map((field, index) => {
      this.font('normal', 9);
      const label = this.wrap(field.label, labelWidth - 2);
      this.font(index === payment.fields.length - 1 ? 'bold' : 'normal', 9);
      const value = this.wrap(field.value, CONTENT_WIDTH - labelWidth);
      return { label, value, lines: Math.max(label.length, value.length) };
    });
    const paragraphHeight = (text: string | undefined, style: FontStyle): number => {
      if (!text) return 0;
      this.font(style, 9);
      return text.split('\n').reduce((sum, line) => sum + this.wrap(line, CONTENT_WIDTH).length, 0) * lineHeight(9, 1.45);
    };
    const height = 5 + paragraphHeight(payment.emphasis, 'bold') + paragraphHeight(payment.intro, 'normal')
      + fields.reduce((sum, field) => sum + field.lines * step, 0);
    // Einen kurzen Zahlungsblock zusammenhalten; lange Absätze dürfen über
    // mehrere Seiten laufen. Überschrift und erste Inhaltszeile bleiben zusammen.
    this.ensure(height <= this.bottomLimit - 29 ? height : 10);
    this.heading(payment.heading);
    if (payment.emphasis) this.paragraph(payment.emphasis, { size: 9, color: this.accent, style: 'bold' });
    if (payment.intro) this.paragraph(payment.intro, { size: 9, color: MUTED });
    fields.forEach((field, index) => {
      for (let lineIndex = 0; lineIndex < field.lines; lineIndex += 1) {
        this.ensure(step);
        this.font('normal', 9);
        this.color(MUTED);
        if (field.label[lineIndex]) this.pdf.text(field.label[lineIndex], LEFT, this.y);
        this.font(index === fields.length - 1 ? 'bold' : 'normal', 9);
        this.color(INK);
        if (field.value[lineIndex]) this.pdf.text(field.value[lineIndex], LEFT + labelWidth, this.y);
        this.y += step;
      }
    });
  }

  signature(signature: NonNullable<PdfDocumentModel['signature']>): void {
    this.font('normal', 9);
    const textLines = signature.lines.reduce((sum, text) => sum
      + text.split('\n').reduce((count, line) => count + this.wrap(line, CONTENT_WIDTH).length, 0), 0);
    const height = 5 + textLines * lineHeight(9, 1.45) + (signature.image ? 30 : 0);
    this.ensure(height <= this.bottomLimit - 29 ? height : 10);
    this.heading(signature.heading);
    for (const line of signature.lines) this.paragraph(line, { size: 9, color: MUTED });
    if (!signature.image) return;
    // Absätze können selbst auf die nächste Seite gewechselt haben. Das
    // Bild braucht deshalb unmittelbar vor dem Zeichnen seine eigene Prüfung.
    this.ensure(30);
    this.y += 1;
    try {
      this.pdf.addImage(signature.image, 'PNG', LEFT, this.y, 80, 25);
      this.stroke(LINE_STRONG, 0.3);
      this.pdf.rect(LEFT, this.y, 80, 25);
      this.y += 29;
    } catch (error) {
      logger.warn('Could not add signature image to PDF:', { error });
      this.paragraph('[Unterschrift vorhanden, konnte nicht geladen werden]', { size: 9, color: MUTED });
    }
  }

  // ---------------------------------------------------------------- Fuß

  footerColumns(): Array<{ heading: string; lines: string[] }> {
    const { company } = this;
    const payment = getEffectivePaymentInformation(company);
    const columns = [
      {
        heading: 'Anschrift',
        lines: [company.name, company.address, [company.postalCode, company.city].filter(Boolean).join(' ')],
      },
      {
        heading: 'Kontakt',
        lines: [company.phone ? `Tel. ${company.phone}` : '', company.email, company.website || ''],
      },
      {
        heading: 'Steuern',
        lines: [
          company.taxIdentificationNumber ? `Steuernr. ${company.taxIdentificationNumber}` : '',
          company.taxId ? `USt-IdNr. ${company.taxId}` : '',
        ],
      },
      {
        heading: 'Bankverbindung',
        lines: this.settings.showBankDetails && payment.bankAccount
          ? [payment.bankName || '', `IBAN ${payment.bankAccount}`, payment.bic ? `BIC ${payment.bic}` : '']
          : [],
      },
    ];
    return columns
      .map(column => ({ ...column, lines: column.lines.filter((line): line is string => Boolean(line && line.trim())) }))
      .filter(column => column.lines.length > 0);
  }

  /**
   * Misst den Fuß vorab: Schriftgröße und Spaltenbreiten richten sich nach dem
   * längsten Eintrag, damit IBAN, E-Mail und Steuernummern nicht mitten im
   * Wort umbrechen. Die Höhe bestimmt, wo der Inhalt jeder Seite endet.
   */
  layoutFooter(): FooterLayout | null {
    if (!this.settings.showFooter) return null;
    const columns = this.footerColumns();
    if (columns.length === 0) return null;
    const withHeadings = this.config.footer === 'columnsHeadings';
    const centered = this.config.footer === 'centered';
    const gap = 4;

    for (const size of [7, 6.5, 6]) {
      this.font('normal', size);
      if (centered) {
        const lines = columns.map(column => column.lines.join('  ·  '));
        if (size > 6 && lines.some(line => this.pdf.getTextWidth(line) > CONTENT_WIDTH)) continue;
        const wrapped = lines.flatMap(line => this.wrap(line, CONTENT_WIDTH));
        return { size, columns: [{ heading: '', lines: wrapped, x: PAGE_WIDTH / 2, width: CONTENT_WIDTH }], height: 4.5 + wrapped.length * 3.4, withHeadings: false, centered };
      }
      const natural = columns.map(column => Math.max(...column.lines.map(line => this.pdf.getTextWidth(line))) + gap);
      const naturalSum = natural.reduce((sum, width) => sum + width, 0);
      if (naturalSum > CONTENT_WIDTH && size > 6) continue;
      // Reicht der Platz nicht, umbricht die Anschrift an Wortgrenzen; IBAN,
      // E-Mail und Steuernummern behalten ihre volle Breite.
      const othersWidth = naturalSum - natural[0];
      const widths = naturalSum <= CONTENT_WIDTH
        ? natural.map(width => width + (CONTENT_WIDTH - naturalSum) / columns.length)
        : CONTENT_WIDTH - othersWidth >= 32
          ? natural.map((width, index) => (index === 0 ? CONTENT_WIDTH - othersWidth : width))
          : columns.map(() => CONTENT_WIDTH / columns.length);
      let x = LEFT;
      const placed = columns.map((column, index) => {
        const width = widths[index];
        const lines = column.lines.flatMap(line => this.wrap(line, width - gap + 1));
        const entry = { heading: column.heading, lines, x, width };
        x += width;
        return entry;
      });
      const rows = Math.max(...placed.map(column => column.lines.length));
      return { size, columns: placed, height: 4.5 + (withHeadings ? 3.6 : 0) + rows * 3.2, withHeadings, centered };
    }
    return null;
  }

  footer(page: number, layout: FooterLayout | null): void {
    const top = this.footerTop;
    if (layout) {
      this.stroke(layout.centered ? this.accent : LINE_STRONG, 0.2);
      this.pdf.line(LEFT, top, RIGHT, top);
      for (const column of layout.columns) {
        let y = top + 4.5;
        if (layout.withHeadings) {
          this.font('bold', 6.5);
          this.color(this.settings.design === 'modern' ? this.accent : INK);
          this.pdf.text(column.heading.toLocaleUpperCase('de-DE'), column.x, y, { charSpace: 0.2 });
          y += 3.6;
        }
        this.font('normal', layout.size);
        this.color(MUTED);
        for (const line of column.lines) {
          if (layout.centered) {
            this.pdf.text(line, column.x, y, { align: 'center' });
            y += 3.4;
          } else {
            this.pdf.text(line, column.x, y);
            y += 3.2;
          }
        }
      }
    }
    if (this.pageCount > 1) {
      this.font('normal', 7);
      this.color(MUTED);
      this.pdf.text(`Seite ${page} von ${this.pageCount}`, RIGHT, PAGE_HEIGHT - 6, { align: 'right' });
    }
  }

  // ---------------------------------------------------------------- Ablauf

  async render(): Promise<void> {
    const { model } = this;
    this.decoratePage();
    await this.letterhead();
    const recipientEnd = this.recipient();
    const metaEnd = this.meta();
    this.y = Math.max(recipientEnd, metaEnd, 90) + 10;
    if (!this.config.titleInHeader) this.title();

    if (model.notice) this.notice(model.notice);
    if (model.intro?.trim()) {
      this.paragraph(model.intro.trim(), { size: 9.5 });
      this.y += 4;
    }
    for (const block of model.blocks || []) {
      this.heading(block.heading);
      this.paragraph(block.text, { size: 9.5 });
      this.y += 4;
    }
    if (model.table) this.table(model.table);
    if (model.totals) this.totals(model.totals);
    if (model.clauses?.length) {
      this.y += 3;
      for (const clause of model.clauses) {
        this.paragraph(clause, { size: 9, style: 'bold', color: INK });
      }
    }
    if (model.notes?.text.trim()) {
      this.y += 6;
      this.heading(model.notes.heading);
      this.paragraph(model.notes.text.trim(), { size: 9, color: MUTED });
    }
    if (model.payment) {
      this.y += 6;
      this.payment(model.payment);
    }
    const texts = (model.texts || []).map(text => text.trim()).filter(Boolean);
    if (texts.length > 0) {
      this.y += 6;
      texts.forEach((text, index) => {
        if (index > 0) this.y += 2.5;
        this.paragraph(text, { size: 9, color: MUTED });
      });
    }
    if (model.signature) {
      this.y += 8;
      this.signature(model.signature);
    }

    for (let page = 1; page <= this.pageCount; page += 1) {
      this.pdf.setPage(page);
      this.footer(page, this.footerLayout);
    }
  }
}

export async function renderBusinessDocument(
  pdf: PdfSurface,
  model: PdfDocumentModel,
  settings: PdfRenderSettings,
  company: Company,
): Promise<void> {
  await new DocumentWriter(pdf, model, settings, company).render();
}
