/**
 * Migration: keep the original OCR values separate from manually corrected receipt data.
 */

export const name = '020_receipt_ocr_baseline';

export async function up(client) {
  await client.query(`
    ALTER TABLE receipts
      ADD COLUMN IF NOT EXISTS ocr_extracted_data JSONB NOT NULL DEFAULT '{}'::jsonb
  `);

  await client.query(`
    UPDATE receipts
    SET ocr_extracted_data = extracted_data
    WHERE ocr_extracted_data = '{}'::jsonb
      AND extracted_data <> '{}'::jsonb
  `);
}

export async function down(client) {
  await client.query(`
    ALTER TABLE receipts
      DROP COLUMN IF EXISTS ocr_extracted_data
  `);
}
