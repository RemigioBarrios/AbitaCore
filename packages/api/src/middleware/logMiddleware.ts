import { Request, Response, NextFunction } from 'express';
import { logger } from '@abitia/core';

export function logMiddleware(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  const { method, originalUrl, ip } = req;
  
  // Registrar cuando finaliza la respuesta
  res.on('finish', () => {
    const duration = Date.now() - start;
    const { statusCode } = res;
    const hostType = (req as any).hostType || 'unknown';
    
    const message = `${method} ${originalUrl} ${statusCode} - ${duration}ms [HostType: ${hostType}] [IP: ${ip}]`;
    
    if (statusCode >= 500) {
      logger.error(message, undefined, 'HTTP');
    } else if (statusCode >= 400) {
      logger.warn(message, 'HTTP');
    } else {
      logger.info(message, 'HTTP');
    }
  });

  next();
}
