import 'reflect-metadata';
import path from 'path'; // <-- Importación del módulo nativo para rutas
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';

try {
  const fs = require('fs');
  const path = require('path');

  // Apunta directamente a la carpeta donde vive el archivo actual
  const envPath = path.join(__dirname, '.env');

  if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
    console.log('[Abitia API] dotenv OK');
  }
} catch (err) {
  // Ignorar pacíficamente si dotenv no está instalado (producción pura en AAPanel)
}

import { configureDataContainer, DataMode, MySQLConnection } from '@abitia/data';
import { configureServicesContainer } from '@abitia/services';
import { container } from 'tsyringe';
import type { Pool } from 'mysql2/promise';
import { logger } from '@abitia/core';
import {
  hstsMiddleware,
  multiTenantMiddleware,
  logMiddleware,
} from './middleware';
import publicRoutes from './routes/public';
import createAuthRoutes from './routes/auth';
import tenantRoutes from './routes/index';

let dbMode: DataMode = DataMode.MySQL;
configureDataContainer(dbMode);
configureServicesContainer();

// Loggear variables de entorno íntegramente
logger.info('Variables de entorno cargadas íntegramente:', 'Config', process.env);

const mysqlConnection = container.resolve(MySQLConnection);
if (dbMode === DataMode.MySQL) {
  mysqlConnection.connect({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'abitia_db',
  }).catch((err) => {
    logger.error('Error al conectar a MariaDB/MySQL', err, 'Abitia API');
  });
}

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);
app.use(logMiddleware);
app.use(cors());
app.use(express.json());

// ============================================================================
// SERVIDOR DE ARCHIVOS ESTÁTICOS (El Monolito Ligero)
// ============================================================================
// ¡IMPORTANTE! index: false evita que Express sirva index.html en todos los dominios
app.use(express.static(path.join(__dirname, '../public'), { index: false }));

// ============================================================================
// 1. HSTS + CLASIFICACION Y RESOLUCION DE HOST (todas las peticiones)
// ============================================================================
app.use(hstsMiddleware);

app.use(multiTenantMiddleware(mysqlConnection));

// ============================================================================
// 2. ROUTERS POR DOMINIO (Despacho de Pantallas Estáticas)
// ============================================================================

const publicRouter = express.Router();
// El dominio .co carga la landing
publicRouter.get('/', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));
publicRouter.use('/', publicRoutes);

const globalAppRouter = express.Router();
// El subdominio 'app' carga el Login general
globalAppRouter.get('/', (req, res) => res.sendFile(path.join(__dirname, '../public/app/login.html')));
globalAppRouter.use('/api/auth', createAuthRoutes(mysqlConnection.getPoolSafe() as Pool | undefined));

const tenantAppRouter = express.Router();
// Los condominios (xyz) cargan el Dashboard
tenantAppRouter.get('/', (req, res) => res.sendFile(path.join(__dirname, '../public/app/dashboard.html')));
tenantAppRouter.use('/api/auth', createAuthRoutes(mysqlConnection.getPoolSafe() as Pool | undefined));
tenantAppRouter.use('/api', tenantRoutes);

// ============================================================================
// 3. DESPACHO POR TIPO DE HOST
// ============================================================================
app.use((req: Request, res: Response, next: NextFunction) => {
  // Dev seed endpoint — available regardless of host type
  if (req.path === '/api/seed' && req.method === 'POST') {
    return next();
  }
  switch (req.hostType) {
    case 'public':
      return publicRouter(req, res, next);
    case 'global':
      return globalAppRouter(req, res, next);
    case 'tenant':
      return tenantAppRouter(req, res, next);
    default:
      res.status(400).json({
        error: 'Host no reconocido',
        hint: 'Use abitia.co, app.abitia.app, o [slug].abitia.app',
      });
  }
});

// Dev seed route — crea datos de prueba para la bandeja de pagos
app.post('/api/seed', async (_req, res) => {
  try {
    if ((dbMode as any) === DataMode.Local) {
      const { LocalStore } = require('@abitia/data');
      const store: any = container.resolve(LocalStore);
      store.reset();
    } else {
      const pool = mysqlConnection.getPoolSafe();
      if (pool) {
        await pool.execute('SET FOREIGN_KEY_CHECKS = 0');
        await pool.execute('TRUNCATE TABLE CuentaCorrientePropiedad');
        await pool.execute('TRUNCATE TABLE PagoReportado');
        await pool.execute('TRUNCATE TABLE ReciboMensual');
        await pool.execute('TRUNCATE TABLE GastoCondominio');
        await pool.execute('TRUNCATE TABLE Propiedad');
        await pool.execute('TRUNCATE TABLE UsuarioCondominioRol');
        await pool.execute('TRUNCATE TABLE Usuario');
        await pool.execute('TRUNCATE TABLE Condominio');
        await pool.execute('SET FOREIGN_KEY_CHECKS = 1');
      }
    }

    const cRepo = container.resolve('ICondominioRepository') as any;
    const uRepo = container.resolve('IUsuarioRepository') as any;
    const pRepo = container.resolve('IPropiedadRepository') as any;
    const gRepo = container.resolve('IGastoCondominioRepository') as any;
    const pagoRepo = container.resolve('IPagoReportadoRepository') as any;
    const reciboSvc = container.resolve('IReciboService') as any;

    const idCondo = await cRepo.create({
      Nombre: 'Residencias Casa-10', Rif_IdFiscal: 'J-12345678-9',
      Direccion: 'Av. Principal, Casa-10', Subdominio_Slug: 'casa10',
      Porcentaje_Fondo_Reserva: 5.00, Configuracion_JSON: null,
    });

    const idAdmin = await uRepo.create({
      Nombre: 'Admin', Apellido: 'Principal', Email: 'admin@casa10.com',
      Password_Hash: bcrypt.hashSync('admin123', 10), Telefono: null, Estatus: 1,
    });
    await uRepo.assignRole(idCondo, idAdmin, 2);

    const idOwner = await uRepo.create({
      Nombre: 'Maria', Apellido: 'Gonzalez', Email: 'owner@casa10.com',
      Password_Hash: bcrypt.hashSync('owner123', 10), Telefono: '+58 412 1234567', Estatus: 1,
    });
    await uRepo.assignRole(idCondo, idOwner, 3);

    const idProp = await pRepo.create({
      IdCondominio: idCondo, Codigo_Nro: 'Casa-10', Alicuota: 0.10,
      IdPropietario_Actual: idOwner, Estatus: 1,
    });

    await gRepo.create({
      IdCondominio: idCondo, Periodo_MesAnio: '2025-06',
      Descripcion: 'Mantenimiento general junio', Monto: 1500.00,
      Tipo_Gasto: 1, Fecha_Gasto: new Date('2025-06-01'),
    });

    await reciboSvc.emitirRecibosPeriodo(idCondo, '2025-06', new Date('2025-07-15'));

    const refs = [
      { monto: 100, ref: 'REF-001-20250610', fecha: '2025-06-10', comp: 'https://ejemplo.com/c1.pdf' },
      { monto: 200, ref: 'REF-002-20250611', fecha: '2025-06-11', comp: null },
      { monto: 150, ref: 'REF-003-20250612', fecha: '2025-06-12', comp: 'https://ejemplo.com/c3.pdf' },
    ];
    for (const p of refs) {
      await pagoRepo.create({
        IdCondominio: idCondo, IdPropiedad: idProp, IdUsuario_Reporta: idOwner,
        Monto: p.monto, Fecha_Transferencia: new Date(p.fecha), Referencia_Bancaria: p.ref,
        IdBanco_Destino: 1, Forma_Pago: 1,
        Comprobante_Url: p.comp || null,
        Observaciones_User: 'Pago reportado desde app',
        Estatus_Verificacion: 0,
        Fecha_Verificacion: null, IdUsuario_Verifica: null, Motivo_Rechazo: null,
      });
    }

    res.json({ ok: true, condominio: { id: idCondo, slug: 'casa10' }, admin: { email: 'admin@casa10.com', password: 'admin123' }, propiedad: { id: idProp, codigo: 'Casa-10' }, pagosPendientes: 3, url: 'http://casa10.localhost:5173/bandeja-pagos.html' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ error: msg });
  }
});


// Health check global
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'AbitiaCore',
    version: '0.1.0',
    hostType: _req.hostType || 'unknown',
  });
});

app.listen(PORT, () => {
  const mode = process.env.NODE_ENV === 'production' ? 'PROD' : 'DEV';
  logger.info(`Puerto ${PORT} | Modo: ${mode} | Persistencia: ${dbMode}`, 'Abitia API');
  logger.info('abitia.co        -> Landing publico', 'Abitia');
  logger.info('app.abitia.app   -> Login global unificado', 'Abitia');
  logger.info('[slug].abitia.app -> Tenant multi-condominio', 'Abitia');
});

export default app;

function alert(arg0: string) {
  throw new Error('Function not implemented.');
}
