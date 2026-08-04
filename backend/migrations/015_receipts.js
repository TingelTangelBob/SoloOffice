/**
 * Migration: Receipt storage and local OCR results
 */

export const name = '015_receipts';

export async function up(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS receipts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      content TEXT NOT NULL,
      content_type VARCHAR(100) NOT NULL,
      size INTEGER NOT NULL CHECK (size > 0),
      ocr_status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (ocr_status IN ('pending', 'processing', 'completed', 'failed')),
      ocr_text TEXT,
      ocr_confidence NUMERIC(5, 2),
      ocr_error TEXT,
      extracted_data JSONB NOT NULL DEFAULT '{}'::jsonb,
      linked_euer_entry_id UUID REFERENCES euer_entries(id) ON DELETE SET NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  await client.query('CREATE INDEX IF NOT EXISTS receipts_created_at_idx ON receipts(created_at DESC)');
  await client.query('CREATE INDEX IF NOT EXISTS receipts_ocr_status_idx ON receipts(ocr_status)');
  await client.query('CREATE INDEX IF NOT EXISTS receipts_linked_euer_entry_idx ON receipts(linked_euer_entry_id)');
}

export async function down(client) {
  await client.query('DROP TABLE IF EXISTS receipts');
}
