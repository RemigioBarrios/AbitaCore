import { Router, Request, Response } from 'express';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.json({
    app: 'Abitia',
    tagline: 'Gestión Integral Multi-Condominio',
    version: '0.1.0',
    landing: 'https://abitia.co',
    appUrl: 'https://app.abitia.app',
  });
});

router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'AbitiaCore', version: '0.1.0' });
});

export default router;
