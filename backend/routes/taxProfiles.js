import express from 'express';
import { hasPermission } from '../middleware/auth.js';
import { requireExtension } from '../middleware/extensions.js';
import {
  acceptTaxDisclaimer,
  copyTaxProfile,
  getTaxProfile,
  saveTaxProfile,
  setChurchTaxConsent,
} from '../services/taxProfiles.js';
import { validateTaxProfilePayload } from '../utils/taxProfileValidation.js';

const router = express.Router();
router.use(requireExtension('taxes'));

function parseYear(value) {
  if (!/^\d{4}$/.test(String(value))) return null;
  const year = Number(value);
  return Number.isInteger(year) && year >= 2000 && year <= 2200 ? year : null;
}

function requireSettings(req, res) {
  if (hasPermission(req.auth, 'workspace.settings')) return true;
  res.status(403).json({ error: 'Nur Administratoren dürfen Steuerprofile öffnen.', code: 'FORBIDDEN' });
  return false;
}

router.get('/:year', async (req, res, next) => {
  if (!requireSettings(req, res)) return;
  const year = parseYear(req.params.year);
  if (!year) return res.status(400).json({ error: 'Ungültiges Steuerjahr.' });
  try { return res.json(await getTaxProfile(year)); } catch (error) { return next(error); }
});

router.put('/:year', async (req, res, next) => {
  if (!requireSettings(req, res)) return;
  const year = parseYear(req.params.year);
  if (!year) return res.status(400).json({ error: 'Ungültiges Steuerjahr.' });
  const validation = validateTaxProfilePayload(req.body, year);
  if (!validation.valid) return res.status(400).json({ error: 'Das Steuerprofil ist ungültig.', details: validation.errors });
  if (typeof validation.value.churchTaxLiable === 'boolean') {
    // Einwilligungen werden ausschließlich über den separaten Endpunkt erteilt.
    try {
      const current = await getTaxProfile(year);
      if (!current.churchTaxConsentAt) return res.status(400).json({ error: 'Für diese Angabe ist zuerst eine gesonderte Einwilligung erforderlich.', code: 'CHURCH_TAX_CONSENT_REQUIRED' });
    } catch (error) { return next(error); }
  }
  try { return res.json(await saveTaxProfile(year, validation.value)); } catch (error) {
    if (error.code === 'CHURCH_TAX_CONSENT_REQUIRED') {
      return res.status(400).json({ error: error.message, code: error.code });
    }
    return next(error);
  }
});

router.post('/:year/copy', async (req, res, next) => {
  if (!requireSettings(req, res)) return;
  const year = parseYear(req.params.year);
  const targetYear = parseYear(req.body?.targetYear);
  if (!year || !targetYear || targetYear === year) return res.status(400).json({ error: 'Ungültiges Zieljahr.' });
  try { return res.json(await copyTaxProfile(year, targetYear)); } catch (error) { return next(error); }
});

router.post('/:year/disclaimer', async (req, res, next) => {
  if (!requireSettings(req, res)) return;
  const year = parseYear(req.params.year);
  if (!year) return res.status(400).json({ error: 'Ungültiges Steuerjahr.' });
  if (!req.body || Object.keys(req.body).length !== 1 || req.body.accepted !== true) {
    return res.status(400).json({ error: 'Die Bestätigung muss ausdrücklich erfolgen.' });
  }
  try { return res.json(await acceptTaxDisclaimer(year)); } catch (error) { return next(error); }
});

router.post('/:year/church-consent', async (req, res, next) => {
  if (!requireSettings(req, res)) return;
  const year = parseYear(req.params.year);
  if (!year) return res.status(400).json({ error: 'Ungültiges Steuerjahr.' });
  const body = req.body;
  if (!body || typeof body.consented !== 'boolean'
    || Object.keys(body).some(key => !['consented', 'liable'].includes(key))
    || (body.consented && typeof body.liable !== 'boolean')
    || (!body.consented && Object.hasOwn(body, 'liable'))) {
    return res.status(400).json({ error: 'Ungültige Einwilligungsangabe.' });
  }
  try { return res.json(await setChurchTaxConsent(year, body.consented, body.liable)); } catch (error) { return next(error); }
});

export default router;
