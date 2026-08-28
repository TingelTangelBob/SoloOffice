import assert from 'node:assert/strict';
import test from 'node:test';
import PDFDocument from 'pdfkit';

function createRegressionPdf() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const document = new PDFDocument({
      margin: 50,
      size: 'A4',
      layout: 'landscape',
    });

    document.on('data', chunk => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);

    document.fontSize(14).fillColor('#2563eb').text('SoloOffice PDFKit Regression');
    document.rect(50, 90, 240, 24).fillAndStroke('#e5e7eb', '#2563eb');
    document.addPage();
    document.font('Helvetica-Bold').fillColor('black').text('Zweite Seite');
    document.end();
  });
}

test('PDFKit erzeugt unter der Backend-Laufzeit ein vollständiges PDF', async () => {
  const pdf = await createRegressionPdf();

  assert.equal(pdf.subarray(0, 5).toString('ascii'), '%PDF-');
  assert.ok(pdf.includes(Buffer.from('%%EOF')));
  assert.ok(pdf.length > 1_500);
});
