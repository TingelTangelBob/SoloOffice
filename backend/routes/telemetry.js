import express from 'express';
import { relayTelemetry } from '../services/telemetry.js';

const router = express.Router();

router.post('/', async (req, res, next) => {
  try {
    const result = await relayTelemetry(req.body?.events, process.env, globalThis.fetch, {
      workspaceId: req.auth?.workspace?.id || null,
    });
    // A disabled or unreachable optional hook must never break the product.
    return res.status(202).json({ accepted: result.accepted, sent: result.sent });
  } catch (error) {
    return next(error);
  }
});

export default router;
