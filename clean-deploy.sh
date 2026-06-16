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

# 2. Limpieza de node_modules duplicados
echo "1. 🧹 Limpiando carpetas node_modules duplicadas..."
find . -name "node_modules" -type d -exec rm -rf {} +
echo "✓ Limpieza completada."

# 3. Instalación de dependencias de producción (forzando el registro oficial de npm)
echo "2. 📦 Instalando dependencias de producción..."
if ! $NPM_CMD ci --omit=dev --registry=https://registry.npmjs.org/; then
    echo "⚠️ 'npm ci' falló. Intentando con 'npm install --omit=dev --registry=https://registry.npmjs.org/'..."
    if ! $NPM_CMD install --omit=dev --registry=https://registry.npmjs.org/; then
        echo "❌ Falló la instalación de dependencias."
        echo "Sugerencia: Si es un problema de permisos, ejecuta: chown -R www:www /www/wwwroot/abitia.app"
        exit 1
    fi
fi
echo "✓ Dependencias instaladas con éxito."

# 4. Reinicio del proceso en PM2
echo "3. 🚀 Reiniciando servidor en PM2..."
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
