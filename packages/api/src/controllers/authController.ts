import { Request, Response } from 'express';
import { container } from 'tsyringe';
import type { Pool } from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2';
import bcrypt from 'bcryptjs';
import {
  IUsuarioRepository,
  ICondominioRepository,
  UserCondominioOption,
  Rol,
  logger,
} from '@abitia/core';
import { generateGlobalToken, generateTenantToken } from '../middleware/auth';

const ROL_NAMES: Record<number, string> = {
  [Rol.SuperAdmin]: 'SuperAdmin',
  [Rol.Administrador]: 'Administrador',
  [Rol.Propietario]: 'Propietario',
  [Rol.Inquilino]: 'Inquilino',
};

export type AuthPool = Pick<Pool, 'execute'>;

type UsuarioLoginRow = {
  IdUsuario: number;
  Nombre: string;
  Apellido: string;
  Email: string;
  Password_Hash: string;
  Estatus: number;
};

function getRepo<T>(token: string): T {
  return container.resolve<T>(token);
}

function rowToUsuario(row: Record<string, unknown>): UsuarioLoginRow {
  return {
    IdUsuario: Number(row.IdUsuario),
    Nombre: String(row.Nombre),
    Apellido: String(row.Apellido),
    Email: String(row.Email),
    Password_Hash: String(row.Password_Hash),
    Estatus: Number(row.Estatus),
  };
}

export class AuthController {
  constructor(private readonly pool?: AuthPool | null) { }

  async login(req: Request, res: Response): Promise<void> {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        res.status(400).json({ error: 'Email y contraseña requeridos' });
        return;
      }

      let usuario: UsuarioLoginRow | null = null;

      if (this.pool) {
        const [rows] = await this.pool.execute<RowDataPacket[]>(
          'SELECT IdUsuario, Nombre, Apellido, Email, Password_Hash, Estatus FROM Usuario WHERE Email = ? LIMIT 1',
          [email],
        );
        usuario = rows[0] ? rowToUsuario(rows[0] as unknown as Record<string, unknown>) : null;
      } else {
        const usuarioRepo = getRepo<IUsuarioRepository>('IUsuarioRepository');
        const found = await usuarioRepo.findByEmail(email);
        usuario = found
          ? {
            IdUsuario: found.IdUsuario,
            Nombre: found.Nombre,
            Apellido: found.Apellido,
            Email: found.Email,
            Password_Hash: found.Password_Hash,
            Estatus: found.Estatus,
          }
          : null;
      }

      // Usuario no encontrado o inactivo
      if (!usuario || usuario.Estatus === 0) {
        res.status(401).json({ error: 'Credenciales inválidas o usuario inactivo' });
        return;
      }

      // Verificación de contraseña
      const isValidPassword = await bcrypt.compare(password, usuario.Password_Hash);
      if (!isValidPassword) {
        res.status(401).json({ error: 'Credenciales inválidas' });
        return;
      }

      const usuarioRepo = getRepo<IUsuarioRepository>('IUsuarioRepository');
      const condominioRepo = getRepo<ICondominioRepository>('ICondominioRepository');

      const roles = await usuarioRepo.getRolesByUsuario(usuario.IdUsuario);

      if (roles.length === 0) {
        res.status(403).json({ error: 'El usuario no tiene condominios asignados' });
        return;
      }

      // Condominio único: token de tenant directo
      if (roles.length === 1) {
        const rol = roles[0];
        const condominio = await condominioRepo.findById(rol.IdCondominio);
        const token = generateTenantToken(
          usuario.IdUsuario,
          usuario.Email,
          rol.IdCondominio,
          rol.Rol,
        );

        res.json({
          token,
          usuario: {
            IdUsuario: usuario.IdUsuario,
            email: usuario.Email,
            nombre: `${usuario.Nombre} ${usuario.Apellido}`,
          },
          singleCondominio: true,
          condominio: {
            idCondominio: rol.IdCondominio,
            slug: condominio?.Subdominio_Slug || '',
            nombreCondominio: condominio?.Nombre || '',
            rol: rol.Rol,
            nombreRol: ROL_NAMES[rol.Rol] || 'Desconocido',
          },
        });
        return;
      }

      // Múltiples condominios: token global + lista de opciones con slugs
      const token = generateGlobalToken(usuario.IdUsuario, usuario.Email);

      const opciones: UserCondominioOption[] = [];
      for (const r of roles) {
        const condominio = await condominioRepo.findById(r.IdCondominio);
        opciones.push({
          idCondominio: r.IdCondominio,
          nombreCondominio: condominio?.Nombre || `Condominio #${r.IdCondominio}`,
          slug: condominio?.Subdominio_Slug || '',
          rol: r.Rol,
          nombreRol: ROL_NAMES[r.Rol] || 'Desconocido',
        });
      }

      res.json({
        token,
        usuario: {
          IdUsuario: usuario.IdUsuario,
          email: usuario.Email,
          nombre: `${usuario.Nombre} ${usuario.Apellido}`,
        },
        singleCondominio: false,
        condominios: opciones,
      });
    } catch (err) {
      logger.error('Error en login de usuario', err, 'AuthController');
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }

  async selectCondominio(req: Request, res: Response): Promise<void> {
    try {
      const { idCondominio } = req.body;
      const idUsuario = req.usuarioId ?? req.idUsuario;

      if (!idUsuario) {
        res.status(401).json({ error: 'Usuario no autenticado' });
        return;
      }

      if (!idCondominio) {
        res.status(400).json({ error: 'idCondominio requerido' });
        return;
      }

      const usuarioRepo = getRepo<IUsuarioRepository>('IUsuarioRepository');
      const condominioRepo = getRepo<ICondominioRepository>('ICondominioRepository');

      const roles = await usuarioRepo.getRolesByUsuario(idUsuario);
      const rolAsignado = roles.find((r) => r.IdCondominio === idCondominio);

      if (!rolAsignado) {
        res.status(403).json({ error: 'El usuario no tiene acceso a este condominio' });
        return;
      }

      const usuario = await usuarioRepo.findById(idUsuario);
      if (!usuario) {
        res.status(404).json({ error: 'Usuario no encontrado' });
        return;
      }

      const condominio = await condominioRepo.findById(idCondominio);

      const token = generateTenantToken(
        idUsuario,
        usuario.Email,
        idCondominio,
        rolAsignado.Rol,
      );

      res.json({
        token,
        idCondominio,
        slug: condominio?.Subdominio_Slug || '',
        nombreCondominio: condominio?.Nombre || '',
        rol: rolAsignado.Rol,
        nombreRol: ROL_NAMES[rolAsignado.Rol] || 'Desconocido',
        redirectUrl: condominio
          ? `https://${condominio.Subdominio_Slug}.abitia.app`
          : null,
      });
    } catch (err) {
      logger.error('Error al seleccionar condominio', err, 'AuthController');
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }

  async me(req: Request, res: Response): Promise<void> {
    try {
      const usuarioId = req.usuarioId ?? req.idUsuario;
      if (!usuarioId) {
        res.status(401).json({ error: 'No autenticado' });
        return;
      }

      const usuarioRepo = getRepo<IUsuarioRepository>('IUsuarioRepository');
      const usuario = await usuarioRepo.findById(usuarioId);

      if (!usuario) {
        res.status(404).json({ error: 'Usuario no encontrado' });
        return;
      }

      const roles = await usuarioRepo.getRolesByUsuario(usuarioId);

      res.json({
        idUsuario: usuario.IdUsuario,
        email: usuario.Email,
        nombre: `${usuario.Nombre} ${usuario.Apellido}`,
        telefono: usuario.Telefono,
        roles: roles.map((r) => ({
          idCondominio: r.IdCondominio,
          rol: r.Rol,
          nombreRol: ROL_NAMES[r.Rol] || 'Desconocido',
        })),
      });
    } catch (err) {
      logger.error('Error en método me de usuario', err, 'AuthController');
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }
}
