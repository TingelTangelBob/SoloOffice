/**
 * Zeichenfläche für die sofortige Vorlagenvorschau. Sie nimmt dieselben
 * Zeichenschritte entgegen wie jsPDF und hält sie je Seite fest; gemessen
 * (Textbreiten, Umbrüche) wird mit einem echten jsPDF-Dokument, damit die
 * Vorschau dieselben Zeilen und Positionen zeigt wie das spätere PDF.
 */

import jsPDF from 'jspdf';
import type { PdfSurface } from './documentRenderer';

const PT = 0.3528;
/** Zeilenabstand von jsPDF bei mehrzeiligem `text()` (lineHeightFactor). */
const JSPDF_LINE_HEIGHT = 1.15;

export type PreviewOperation =
  | { kind: 'rect'; x: number; y: number; width: number; height: number; fill?: string; stroke?: string; lineWidth: number }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: string; lineWidth: number }
  | {
      kind: 'text';
      lines: string[];
      x: number;
      y: number;
      fontSize: number;
      lineStep: number;
      family: string;
      style: string;
      color: string;
      align: 'left' | 'center' | 'right';
      charSpace: number;
    }
  | { kind: 'image'; href: string; x: number; y: number; width: number; height: number };

export type PreviewPage = PreviewOperation[];

function rgb(r: number, g: number, b: number): string {
  return `rgb(${r}, ${g}, ${b})`;
}

export class PreviewRecorder implements PdfSurface {
  readonly pages: PreviewPage[] = [[]];
  private current = 0;
  private readonly measure = new jsPDF();
  private family = 'helvetica';
  private style = 'normal';
  private fontSize = 16;
  private textColor = rgb(0, 0, 0);
  private fillColor = rgb(0, 0, 0);
  private drawColor = rgb(0, 0, 0);
  private lineWidth = 0.200025;

  private push(operation: PreviewOperation): void {
    this.pages[this.current].push(operation);
  }

  setFont(fontName: string, fontStyle = 'normal'): void {
    this.family = fontName;
    this.style = fontStyle;
    this.measure.setFont(fontName, fontStyle);
  }

  setFontSize(size: number): void {
    this.fontSize = size;
    this.measure.setFontSize(size);
  }

  setTextColor(r: number, g: number, b: number): void {
    this.textColor = rgb(r, g, b);
  }

  setFillColor(r: number, g: number, b: number): void {
    this.fillColor = rgb(r, g, b);
  }

  setDrawColor(r: number, g: number, b: number): void {
    this.drawColor = rgb(r, g, b);
  }

  setLineWidth(width: number): void {
    this.lineWidth = width;
  }

  rect(x: number, y: number, width: number, height: number, style?: string | null): void {
    const mode = (style || 'S').toUpperCase();
    this.push({
      kind: 'rect',
      x,
      y,
      width,
      height,
      fill: mode.includes('F') ? this.fillColor : undefined,
      stroke: mode.includes('D') || mode === 'S' ? this.drawColor : undefined,
      lineWidth: this.lineWidth,
    });
  }

  line(x1: number, y1: number, x2: number, y2: number): void {
    this.push({ kind: 'line', x1, y1, x2, y2, stroke: this.drawColor, lineWidth: this.lineWidth });
  }

  text(text: string | string[], x: number, y: number, options?: { align?: 'left' | 'center' | 'right'; charSpace?: number }): void {
    this.push({
      kind: 'text',
      lines: Array.isArray(text) ? text : [text],
      x,
      y,
      fontSize: this.fontSize * PT,
      lineStep: this.fontSize * PT * JSPDF_LINE_HEIGHT,
      family: this.family,
      style: this.style,
      color: this.textColor,
      align: options?.align ?? 'left',
      charSpace: options?.charSpace ?? 0,
    });
  }

  splitTextToSize(text: string, maxWidth: number): string[] {
    return this.measure.splitTextToSize(text, maxWidth) as string[];
  }

  getTextWidth(text: string): number {
    return this.measure.getTextWidth(text);
  }

  addImage(imageData: string, _format: string, x: number, y: number, width: number, height: number): void {
    this.push({ kind: 'image', href: imageData, x, y, width, height });
  }

  addPage(): void {
    this.pages.push([]);
    this.current = this.pages.length - 1;
  }

  setPage(pageNumber: number): void {
    this.current = Math.min(Math.max(pageNumber - 1, 0), this.pages.length - 1);
  }
}
