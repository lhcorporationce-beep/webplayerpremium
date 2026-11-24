#!/usr/bin/env bash
# Instala/atualiza o IPTV PREMIUM Player numa VPS Ubuntu/Debian (como root).
# Uso:
#   ALLOWED_HOSTS=tcat2g.cc bash vps-install.sh                       -> acesso por http://IP-DA-VPS
#   DOMAIN=player.seudominio.com ALLOWED_HOSTS=tcat2g.cc bash vps-install.sh -> com HTTPS automático
# Para atualizar depois, rode o mesmo comando de novo.
set -euo pipefail

REPO="${REPO:-https://github.com/lhcorporationce-beep/webplayerpremium.git}"
ALLOWED_HOSTS="${ALLOWED_HOSTS:-}"
DOMAIN="${DOMAIN:-}"
DIR=/opt/iptv-player

[ "$(id -u)" = 0 ] || { echo "Rode como root (ou com sudo)."; exit 1; }

if ! command -v docker >/dev/null 2>&1; then
  echo ">> Instalando Docker..."
  apt-get update -y && apt-get install -y curl git ca-certificates
  curl -fsSL https://get.docker.com | sh
fi
command -v git >/dev/null 2>&1 || apt-get install -y git

echo ">> Baixando o projeto..."
if [ -d "$DIR/app/.git" ]; then git -C "$DIR/app" pull --ff-only; else mkdir -p "$DIR" && git clone "$REPO" "$DIR/app"; fi

cd "$DIR"
if [ -n "$DOMAIN" ]; then
  cat > Caddyfile <<CADDY
$DOMAIN {
  encode gzip
  reverse_proxy player:3000 {
    flush_interval -1
  }
}
CADDY
  cat > docker-compose.yml <<YML
services:
  player:
    build: ./app
    restart: always
    environment:
      - PORT=3000
      - ALLOWED_HOSTS=$ALLOWED_HOSTS
  caddy:
    image: caddy:2
    restart: always
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
    depends_on: [player]
volumes:
  caddy_data:
YML
else
  cat > docker-compose.yml <<YML
services:
  player:
    build: ./app
    restart: always
    ports: ["80:3000"]
    environment:
      - PORT=3000
      - ALLOWED_HOSTS=$ALLOWED_HOSTS
YML
fi

echo ">> Construindo e iniciando..."
docker compose up -d --build

echo
if [ -n "$DOMAIN" ]; then echo "Pronto: https://$DOMAIN (o HTTPS pode levar 1-2 minutos na primeira vez)"
else echo "Pronto: http://$(curl -s ifconfig.me || echo IP-DA-VPS)"; fi
