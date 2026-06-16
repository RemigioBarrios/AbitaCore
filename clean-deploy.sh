#!/bin/bash

# clean-deploy.sh - Script para limpieza y despliegue limpio en el servidor Linux (AAPanel compatible)

echo "======================================================================"
echo "         INICIANDO INSTALACIÓN LIMPIA Y REINICIO EN EL SERVIDOR"
echo "======================================================================"

# 1. Resolver comandos locales (AAPanel) si no están globales
NPM_CMD="npm"
if ! command -v npm &> /dev/null; then
    echo "⚠️ 'npm' no está en el PATH global. Buscando en rutas de AAPanel..."
    for path in /www/server/nodejs/v*/bin/npm; do
        if [ -f "$path" ]; then
            NPM_CMD="$path"
            echo "✓ Encontrado npm en: $NPM_CMD"
            export PATH="$(dirname "$path"):$PATH"
            break
        fi
    done
fi

PM2_CMD="pm2"
if ! command -v pm2 &> /dev/null; then
    echo "⚠️ 'pm2' no está en el PATH global. Buscando en rutas de AAPanel..."
    for path in /www/server/nodejs/v*/bin/pm2; do
        if [ -f "$path" ]; then
            PM2_CMD="$path"
            echo "✓ Encontrado pm2 en: $PM2_CMD"
            break
        fi
    done
fi

# 2. Descompresión y Respaldo (.bak) de la versión anterior
if [ -f "abitia-deploy.tar.gz" ]; then
    echo "1. 📦 Creando respaldo (.bak) y descomprimiendo paquete..."
    
    # Eliminar respaldos previos si existen
    rm -rf packages.bak
    rm -rf sql.bak
    rm -f package.json.bak
    rm -f package-lock.json.bak
    
    # Renombrar versión actual a .bak si existen los directorios/archivos
    if [ -d "packages" ]; then
        mv packages packages.bak
        echo "✓ Directorio 'packages' respaldado en 'packages.bak'."
    fi
    if [ -d "sql" ]; then
        mv sql sql.bak
        echo "✓ Directorio 'sql' respaldado en 'sql.bak'."
    fi
    if [ -f "package.json" ]; then
        cp package.json package.json.bak
        echo "✓ 'package.json' respaldado en 'package.json.bak'."
    fi
    if [ -f "package-lock.json" ]; then
        cp package-lock.json package-lock.json.bak
        echo "✓ 'package-lock.json' respaldado en 'package-lock.json.bak'."
    fi

    # Extraer el nuevo paquete
    echo "📂 Descomprimiendo 'abitia-deploy.tar.gz'..."
    if tar -xzf abitia-deploy.tar.gz; then
        echo "✓ Descompresión exitosa."
        rm -f abitia-deploy.tar.gz
    else
        echo "❌ Error al descomprimir 'abitia-deploy.tar.gz'. Restaurando respaldo..."
        # Restaurar
        [ -d "packages.bak" ] && rm -rf packages && mv packages.bak packages
        [ -d "sql.bak" ] && rm -rf sql && mv sql.bak sql
        [ -f "package.json.bak" ] && mv package.json.bak package.json
        [ -f "package-lock.json.bak" ] && mv package-lock.json.bak package-lock.json
        exit 1
    fi
else
    echo "⚠️ No se encontró 'abitia-deploy.tar.gz' en el directorio actual. Omitiendo respaldo y descompresión."
fi

# 3. Limpieza de node_modules duplicados
echo "2. 🧹 Limpiando carpetas node_modules duplicadas..."
find . -name "node_modules" -type d -exec rm -rf {} +
echo "✓ Limpieza completada."

# 4. Instalación de dependencias de producción (forzando el registro oficial de npm)
echo "3. 📦 Instalando dependencias de producción..."
if ! $NPM_CMD ci --omit=dev --registry=https://registry.npmjs.org/; then
    echo "⚠️ 'npm ci' falló. Intentando con 'npm install --omit=dev --registry=https://registry.npmjs.org/'..."
    if ! $NPM_CMD install --omit=dev --registry=https://registry.npmjs.org/; then
        echo "❌ Falló la instalación de dependencias."
        echo "Sugerencia: Si es un problema de permisos, ejecuta: chown -R www:www /www/wwwroot/abitia.app"
        exit 1
    fi
fi
echo "✓ Dependencias instaladas con éxito."

# 5. Reinicio del proceso en PM2
echo "4. 🚀 Reiniciando servidor en PM2..."
# Intentar reiniciar bajo el nombre 'AbitiaCore'
if $PM2_CMD restart AbitiaCore &> /dev/null; then
    echo "✓ Servidor 'AbitiaCore' reiniciado con éxito."
else
    echo "⚠️ No se encontró un proceso PM2 activo. Iniciando uno nuevo..."
    $PM2_CMD start packages/api/dist/server.js --name AbitiaCore
    echo "✓ Proceso 'AbitiaCore' iniciado en PM2."
fi

echo "======================================================================"
echo "         ¡DESPLIEGUE FINALIZADO CON ÉXITO!"
echo "======================================================================"
