const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const dotenv = require('dotenv');
const ftp = require('basic-ftp');

const ROOT_DIR = path.resolve(__dirname, '..');
const TEMP_DEPLOY_DIR = path.join(ROOT_DIR, 'deploy_dist');
const OUTPUT_FILE = path.join(ROOT_DIR, 'abitia-deploy.tar.gz');

// Helper para copiar directorios de forma recursiva
function copyDirSync(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      // Ignorar node_modules o carpetas de desarrollo dentro de las carpetas copiadas
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Helper para copiar un archivo si existe
function copyFileSync(src, dest) {
  if (fs.existsSync(src)) {
    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    fs.copyFileSync(src, dest);
  }
}

function cleanDirectory(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  console.log('\n======================================================================');
  console.log('         INICIANDO PROCESO DE PREPARACIÓN DE DESPLIEGUE');
  console.log('======================================================================\n');

  // 1. Compilar todo el monorepo
  console.log('1. Compilando el proyecto (npm run build)...');
  try {
    execSync('npm run build', { cwd: ROOT_DIR, stdio: 'inherit' });
    console.log('✓ Compilación exitosa.\n');
  } catch (err) {
    console.error('✗ Error durante la compilación. Despliegue cancelado.');
    process.exit(1);
  }

  // 2. Limpiar directorios previos
  console.log('2. Limpiando carpetas temporales previas...');
  cleanDirectory(TEMP_DEPLOY_DIR);
  if (fs.existsSync(OUTPUT_FILE)) {
    fs.unlinkSync(OUTPUT_FILE);
  }
  fs.mkdirSync(TEMP_DEPLOY_DIR);
  console.log('✓ Limpieza completada.\n');

  // 3. Copiar archivos requeridos
  console.log('3. Agrupando archivos requeridos para producción...');
  
  // Archivos del raíz
  copyFileSync(path.join(ROOT_DIR, 'package.json'), path.join(TEMP_DEPLOY_DIR, 'package.json'));
  copyFileSync(path.join(ROOT_DIR, 'package-lock.json'), path.join(TEMP_DEPLOY_DIR, 'package-lock.json'));
  copyFileSync(path.join(ROOT_DIR, '.env.production.example'), path.join(TEMP_DEPLOY_DIR, '.env.production.example'));
  // Copiar y convertir clean-deploy.sh a formato LF (Unix)
  if (fs.existsSync(path.join(ROOT_DIR, 'clean-deploy.sh'))) {
    const shContent = fs.readFileSync(path.join(ROOT_DIR, 'clean-deploy.sh'), 'utf8');
    const lfContent = shContent.replace(/\r\n/g, '\n');
    fs.writeFileSync(path.join(TEMP_DEPLOY_DIR, 'clean-deploy.sh'), lfContent, { encoding: 'utf8', mode: 0o755 });
  }
  
  // Base de datos SQL
  copyDirSync(path.join(ROOT_DIR, 'sql'), path.join(TEMP_DEPLOY_DIR, 'sql'));

  // Paquetes del Monorepo
  const packages = ['core', 'data', 'services', 'api', 'web'];
  for (const pkg of packages) {
    const pkgSrcDir = path.join(ROOT_DIR, 'packages', pkg);
    const pkgDestDir = path.join(TEMP_DEPLOY_DIR, 'packages', pkg);

    // Copiar el package.json de cada workspace
    copyFileSync(path.join(pkgSrcDir, 'package.json'), path.join(pkgDestDir, 'package.json'));

    // Copiar carpetas compiladas (dist o public según corresponda)
    if (pkg === 'api') {
      copyDirSync(path.join(pkgSrcDir, 'dist'), path.join(pkgDestDir, 'dist'));
      copyDirSync(path.join(pkgSrcDir, 'public'), path.join(pkgDestDir, 'public'));
      // Copiar .env de producción si existe en dist
      copyFileSync(path.join(pkgSrcDir, 'dist', '.env'), path.join(pkgDestDir, 'dist', '.env'));
      copyFileSync(path.join(pkgSrcDir, 'src', '.env'), path.join(pkgDestDir, 'dist', '.env.local.bak'));
    } else if (pkg === 'web') {
      copyDirSync(path.join(pkgSrcDir, 'dist'), path.join(pkgDestDir, 'dist'));
    } else {
      copyDirSync(path.join(pkgSrcDir, 'dist'), path.join(pkgDestDir, 'dist'));
    }
  }
  console.log('✓ Archivos agrupados exitosamente.\n');

  // 4. Crear el archivo comprimido (.tar.gz)
  console.log('4. Comprimiendo paquete de despliegue (abitia-deploy.tar.gz)...');
  try {
    // Usamos tar nativo disponible de forma estándar en Windows 10+ y Linux
    execSync(`tar -czf "${OUTPUT_FILE}" -C "${TEMP_DEPLOY_DIR}" .`, { stdio: 'inherit' });
    console.log('✓ Archivo comprimido creado con éxito.\n');
  } catch (err) {
    console.error('✗ Error al comprimir el archivo. Asegúrate de tener "tar" instalado.');
    console.log('Generando carpeta "deploy_dist" sin comprimir para copia manual.');
    process.exit(1);
  }

  // 5. Limpieza final de la carpeta temporal
  console.log('5. Limpiando archivos temporales...');
  cleanDirectory(TEMP_DEPLOY_DIR);
  console.log('✓ Archivos temporales eliminados.\n');

  // 6. Subir al servidor FTP si existe .env.deploy
  const deployEnvPath = path.join(ROOT_DIR, '.env.deploy');
  let uploadExito = false;
  if (fs.existsSync(deployEnvPath)) {
    console.log('6. Detectado .env.deploy. Iniciando subida al servidor remoto...');
    try {
      dotenv.config({ path: deployEnvPath });
      const { FTP_HOST, FTP_USER, FTP_PASS, FTP_REMOTE_PATH } = process.env;
      
      if (FTP_HOST && FTP_USER && FTP_PASS) {
        console.log(`Conectando a: ftp://${FTP_HOST}${FTP_REMOTE_PATH || ''}...`);
        const client = new ftp.Client();
        client.ftp.verbose = false;
        try {
          let connected = false;
          try {
            await client.access({
              host: FTP_HOST,
              user: FTP_USER,
              password: FTP_PASS,
              secure: true,
              secureOptions: { rejectUnauthorized: false }
            });
            connected = true;
            console.log('✓ Conexión segura (FTPS) establecida.');
          } catch (ftpsErr) {
            console.warn('⚠️ Falló conexión segura (FTPS). Reintentando conexión estándar (no cifrada)...');
            await client.access({
              host: FTP_HOST,
              user: FTP_USER,
              password: FTP_PASS,
              secure: false
            });
            connected = true;
            console.log('✓ Conexión estándar (no cifrada) establecida.');
          }

          if (connected) {
            const remoteDir = FTP_REMOTE_PATH || '/';
            await client.ensureDir(remoteDir);
            await client.cd(remoteDir);
            console.log(`Subiendo ${path.basename(OUTPUT_FILE)}...`);
            await client.uploadFrom(OUTPUT_FILE, path.basename(OUTPUT_FILE));
            console.log('✓ Archivo subido con éxito al servidor remoto.\n');
            uploadExito = true;
          }
        } finally {
          client.close();
        }
      } else {
        console.warn('⚠️ Variables de configuración incompletas en .env.deploy. Se omitió la subida.');
      }
    } catch (err) {
      console.error('✗ Error durante la subida al servidor FTP:', err.message);
    }
  } else {
    console.log('6. No se detectó .env.deploy. Omisión de la subida automática.');
  }

  const stats = fs.statSync(OUTPUT_FILE);
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

  console.log('======================================================================');
  console.log('         ¡PAQUETE DE DESPLIEGUE CREADO CON ÉXITO!');
  console.log('======================================================================');
  console.log(` Archivo:   ${path.basename(OUTPUT_FILE)}`);
  console.log(` Ruta:      ${OUTPUT_FILE}`);
  console.log(` Tamaño:    ${sizeMB} MB`);
  if (uploadExito) {
    console.log(' Estado:    SUBIDO AL SERVIDOR REMOTO');
  }
  console.log('======================================================================');
  console.log('\nINSTRUCCIONES PARA EL SERVIDOR REMOTO:');
  console.log('1. Ubica "abitia-deploy.tar.gz" en el directorio de destino en tu servidor Linux.');
  console.log('2. Ejecuta el script de despliegue (este respaldará la versión anterior a .bak, extraerá y reiniciará):');
  console.log('   chmod +x clean-deploy.sh && ./clean-deploy.sh');
  console.log('   (Nota: Si es el primer despliegue, descomprime manualmente usando: tar -xzf abitia-deploy.tar.gz)');
  console.log('======================================================================\n');
}

main().catch(err => {
  console.error('✗ Error inesperado en el proceso de despliegue:', err);
  process.exit(1);
});
