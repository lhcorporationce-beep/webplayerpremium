# Como colocar o IPTV PREMIUM Player no ar

## Como o cliente configura (primeira vez)
Na primeira abertura aparece a tela **Configuração inicial**: o cliente digita a URL do servidor, o usuário e a senha (ou usa uma lista M3U).
Os dados ficam salvos no aparelho e das próximas vezes o player abre direto. Para trocar de servidor: botão 👤 > **Trocar servidor/conta**.

## Vários servidores
- **Digitando a URL:** o cliente pode usar qualquer um dos seus servidores. Coloque todos os domínios em `ALLOWED_HOSTS`, separados por vírgula (ex.: `srv1.com,srv2.com,srv3.com`).
- **Lista pronta (opcional):** edite `public/servers.json` (veja `servers.example.json`). O cliente passa a escolher o servidor num menu, ou deixa em **Automático**, que testa um por um até achar onde o usuário e a senha funcionam. Os domínios desse arquivo já são liberados sozinhos.
  Obs.: quem usa o site consegue ver essa lista.

Antes de tudo, descubra o **domínio** do seu servidor IPTV (a parte do endereço sem http:// e sem a porta).
Ex.: se o login é `http://painel.exemplo.com:8080`, o domínio é `painel.exemplo.com`.

## Opção A: Render (mais fácil)

1. Crie uma conta em github.com e um repositório **privado** (ex.: `iptv-premium-player`).
2. Envie para ele todo o conteúdo desta pasta (botão "Add file > Upload files").
3. Crie uma conta em render.com e clique em **New > Web Service** (ou **New > Blueprint**, que lê o `render.yaml`).
4. Escolha o repositório e confira:
   - Runtime: **Node**
   - Build Command: `echo ok`
   - Start Command: `node server.js`
5. Em **Environment**, adicione:
   - `ALLOWED_HOSTS` = o domínio do seu servidor IPTV (pode ser mais de um, separados por vírgula)
6. Clique em **Create**. Em alguns minutos o site abre em `https://iptv-premium-player.onrender.com`.
7. (Opcional) Em **Settings > Custom Domains**, adicione `player.seudominio.com.br` e crie o registro CNAME que o Render mostrar no painel do seu domínio.

Atenção: o plano grátis "dorme" quando ninguém usa e tem limite de tráfego. Para clientes assistindo de verdade, use um plano pago (confira o preço atual no site do Render).

## Opção B: VPS (melhor para muitos clientes)

Vídeo passa pelo servidor, então o que importa é a **banda**. Uma VPS com bastante tráfego liberado costuma sair mais barata que PaaS.

    # Ubuntu 22/24, como root
    apt update && apt install -y docker.io git
    git clone <seu-repositorio> /opt/player && cd /opt/player
    docker build -t iptv-player .
    docker run -d --restart=always -p 127.0.0.1:3000:3000 \
      -e ALLOWED_HOSTS=painel.exemplo.com --name player iptv-player

HTTPS automático com Caddy (aponte o domínio para o IP da VPS antes):

    apt install -y caddy
    echo 'player.seudominio.com.br { reverse_proxy 127.0.0.1:3000 }' > /etc/caddy/Caddyfile
    systemctl reload caddy

## Testar
1. Abra o endereço do site, escolha **Xtream Codes** e entre com servidor, usuário e senha de um cliente de teste.
2. Abra um canal ao vivo, um filme e um episódio de série.
3. Se algo falhar, veja os logs (Render: aba Logs; VPS: `docker logs player`).
   - "Servidor não permitido": o domínio não está em `ALLOWED_HOSTS`.
   - "Não foi possível conectar": confira endereço e porta do painel.
