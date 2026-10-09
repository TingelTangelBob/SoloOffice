import express from 'express';
import { requireExtension } from '../middleware/extensions.js';
import { computeVatForYear } from '../services/vatComputation.js';
import { bookVatPayment, createVatPayment, deleteVatPayment, listVatPayments, updateVatPayment } from '../services/vatPayments.js';

const router = express.Router();
router.use(requireExtension('taxes'));

function parseYear(value) {
  if (!/^\d{4}$/.test(String(value || ''))) return null;
  const year = Number(value);
  return year >= 2000 && year <= 2200 ? year : null;
}

router.get('/payments', async (req, res, next) => {
  try {
    const year = req.query.year === undefined ? undefined : parseYear(req.query.year);
    if (req.query.year !== undefined && !year) return res.status(400).json({ error: 'Ungültiges Steuerjahr.' });
    return res.json(await listVatPayments(year));
  } catch (error) { return next(error); }
});

router.post('/payments', async (req, res, next) => {
  try {
    const result = await createVatPayment(req.body || {});
    if (result.error) return res.status(400).json({ error: result.error });
    return res.status(201).json({ ...result.payment, warnings: result.warnings });
  } catch (error) { return next(error); }
});

router.put('/payments/:id', async (req, res, next) => {
  try {
    const result = await updateVatPayment(req.params.id, req.body || {});
    if (result.missing) return res.status(404).json({ error: 'Umsatzsteuer-Zahlung nicht gefunden.' });
    if (result.error) return res.status(400).json({ error: result.error });
    return res.json({ ...result.payment, warnings: result.warnings });
  } catch (error) { return next(error); }
});

router.delete('/payments/:id', async (req, res, next) => {
  try {
    const result = await deleteVatPayment(req.params.id, req.body?.correctionReason);
    if (result.missing) return res.status(404).json({ error: 'Umsatzsteuer-Zahlung nicht gefunden.' });
    return res.json({ deleted: true });
  } catch (error) { return next(error); }
});

router.post('/payments/:id/book', async (req, res, next) => {
  try {
    const result = await bookVatPayment(req.params.id);
    if (result.missing) return res.status(404).json({ error: 'Umsatzsteuer-Zahlung nicht gefunden.' });
    if (result.error) return res.status(409).json({ error: result.error });
    return res.json(result.payment);
  } catch (error) { return next(error); }
});

router.get('/:year', async (req, res, next) => {
  const year = parseYear(req.params.year);
  if (!year) return res.status(400).json({ error: 'Ungültiges Umsatzsteuerjahr.' });
  try { return res.json(await computeVatForYear(year)); }
  catch (error) { return next(error); }
});

export default router;
