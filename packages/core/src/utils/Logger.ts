import fs from 'fs';
import path from 'path';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

const LEVEL_NAMES = {
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.ERROR]: 'ERROR',
};

const LEVEL_COLORS = {
  [LogLevel.DEBUG]: '\x1b[90m', // Gray
  [LogLevel.INFO]: '\x1b[32m',  // Green
  [LogLevel.WARN]: '\x1b[33m',  // Yellow
  [LogLevel.ERROR]: '\x1b[31m', // Red
};

const RESET_COLOR = '\x1b[0m';
const CONTEXT_COLOR = '\x1b[36m'; // Cyan

export class Logger {
  private logDir: string;
  private minLevel: LogLevel;
  private isProduction: boolean;

  constructor() {
    this.isProduction = process.env.NODE_ENV === 'production';
    
    // Configurar directorio de logs
    const envLogDir = process.env.LOG_DIR;
    if (envLogDir) {
      this.logDir = path.resolve(envLogDir);
    } else {
      // Por defecto, usa 'logs' en el directorio de trabajo del proceso
      this.logDir = path.join(process.cwd(), 'logs');
    }

    // Configurar nivel mínimo
    const envLevel = process.env.LOG_LEVEL?.toUpperCase();
    if (envLevel && envLevel in LogLevel) {
      this.minLevel = LogLevel[envLevel as keyof typeof LogLevel];
    } else {
      this.minLevel = this.isProduction ? LogLevel.INFO : LogLevel.DEBUG;
    }

    this.ensureLogDirectory();
  }

  private ensureLogDirectory() {
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
    } catch (err) {
      console.error(`[Logger] Error al crear directorio de logs en ${this.logDir}:`, err);
    }
  }

  private getLogFiles(): { appFile: string; errorFile: string } {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;

    return {
      appFile: path.join(this.logDir, `app-${dateStr}.log`),
      errorFile: path.join(this.logDir, `error-${dateStr}.log`),
    };
  }

  private formatTimestamp(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    const ms = String(date.getMilliseconds()).padStart(3, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;
  }

  private serializeMetadata(metadata?: any): string {
    if (metadata === undefined || metadata === null) {
      return '';
    }
    if (metadata instanceof Error) {
      return `\n${metadata.stack || metadata.message}`;
    }
    try {
      if (typeof metadata === 'object') {
        // Si tiene error anidado, formatearlo
        if (metadata.error instanceof Error) {
          const { error, ...rest } = metadata;
          const restStr = Object.keys(rest).length ? ` | Metadatos: ${JSON.stringify(rest)}` : '';
          return `${restStr}\n${error.stack || error.message}`;
        }
        return ` | Metadatos: ${JSON.stringify(metadata)}`;
      }
      return ` | Metadatos: ${String(metadata)}`;
    } catch {
      return ' | Metadatos: [No serializable]';
    }
  }

  private log(level: LogLevel, message: string, context?: string, metadata?: any) {
    if (level < this.minLevel) {
      return;
    }

    const now = new Date();
    const timestamp = this.formatTimestamp(now);
    const levelName = LEVEL_NAMES[level];
    const ctx = context ? `[${context}] ` : '';
    const metaStr = this.serializeMetadata(metadata);

    // Formato de texto para el archivo (sin colores ANSI)
    const logLine = `[${timestamp}] [${levelName}] ${ctx}${message}${metaStr}\n`;

    // Formato para consola (con colores ANSI)
    const color = LEVEL_COLORS[level];
    const coloredCtx = context ? `${CONTEXT_COLOR}[${context}]${RESET_COLOR} ` : '';
    const consoleLine = `[${timestamp}] ${color}[${levelName}]${RESET_COLOR} ${coloredCtx}${message}${metaStr}`;

    // 1. Escribir a consola (stdout/stderr)
    if (level === LogLevel.ERROR) {
      console.error(consoleLine);
    } else {
      console.log(consoleLine);
    }

    // 2. Escribir a disco de forma asíncrona no bloqueante
    try {
      this.ensureLogDirectory();
      const { appFile, errorFile } = this.getLogFiles();

      // Log combinado
      fs.appendFile(appFile, logLine, (err) => {
        if (err) {
          console.error('[Logger] Error al escribir en app.log:', err);
        }
      });

      // Log de errores (WARN y ERROR)
      if (level >= LogLevel.WARN) {
        fs.appendFile(errorFile, logLine, (err) => {
          if (err) {
            console.error('[Logger] Error al escribir en error.log:', err);
          }
        });
      }
    } catch (err) {
      console.error('[Logger] Error inesperado en el proceso de escritura de logs:', err);
    }
  }

  public debug(message: string, context?: string, metadata?: any) {
    this.log(LogLevel.DEBUG, message, context, metadata);
  }

  public info(message: string, context?: string, metadata?: any) {
    this.log(LogLevel.INFO, message, context, metadata);
  }

  public warn(message: string, context?: string, metadata?: any) {
    this.log(LogLevel.WARN, message, context, metadata);
  }

  public error(message: string, error?: Error | unknown, context?: string, metadata?: any) {
    // Si error es un Error, pasarlo como metadato
    const meta = error !== undefined ? error : metadata;
    this.log(LogLevel.ERROR, message, context, meta);
  }
}

// Instancia única (Singleton) compartida por defecto
export const logger = new Logger();
