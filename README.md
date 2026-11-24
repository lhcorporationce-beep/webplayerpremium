# IPTV Premium Player (web)

Site + servidor embutido. O cliente entra só com **servidor, usuário e senha** (Xtream Codes) ou uma lista M3U.
O servidor faz a ponte com o seu painel IPTV, então não há erro de CORS nem de HTTP/HTTPS.

## Rodar
    node server.js            # http://localhost:3000
    ALLOWED_HOSTS=seupainel.com,outro.com node server.js   # recomendado em produção

## Publicar
Precisa de uma hospedagem que rode Node (VPS, Render, Railway, Fly.io) ou Docker:
    docker build -t iptv-player . && docker run -p 80:3000 -e ALLOWED_HOSTS=seupainel.com iptv-player
Use HTTPS no domínio (o provedor geralmente dá). Wix e hospedagens só de arquivos NÃO rodam o servidor.

## Segurança
- `ALLOWED_HOSTS`: só deixa a ponte falar com os seus servidores IPTV.
- Bloqueia IPs internos e outros sites de usar a sua ponte.

## Observação
Todo o vídeo passa pelo seu servidor: o tráfego é o total assistido pelos clientes. Dimensione a hospedagem para isso.

## Recursos
- **Início** estilo streaming: destaque, continuar assistindo, minha lista, recentes, mais bem avaliados e carrosséis por categoria. Busca global.
- **Ao vivo** com Agora/Depois, **Guia** de programação, lista de categorias dentro do player.
- **Detalhes** de filmes e séries: fundo, elenco, direção, trailer, "Continuar", "Do início", favoritar.
- **Player:** qualidade, áudio, legendas (inclusive carregar .srt/.vtt), velocidade, ±10 s, janela flutuante (PiP), proporção da imagem, tela cheia, reconexão automática de canal que trava, tela sempre ligada.
- **Tela cheia do app** (botão ⛶ no topo, igual ao F11). Em tela cheia o player fica limpo: menus e controles somem em 1,5 s e voltam ao mexer o mouse, tocar na tela ou apertar uma tecla.
- **App instalável** (PWA): no celular/PC pelo botão 👤 > Instalar app (iPhone: Compartilhar > Adicionar à Tela de Início).
- **Modo TV** (liga sozinho em Smart TV/Fire TV; ou 👤 > Modo TV): navegação por setas e OK do controle remoto, foco grande.
- **Catálogo em cache** (6 h) para abrir rápido; 👤 > Atualizar catálogo força nova busca.

## Atalhos (player)
`Espaço`/`K` pausar • `←` `→` ±10 s (Shift = 60 s) • `↑` `↓` trocar canal (filme: volume) • `L` lista • `G` programação • `S` ajustes • `A` formato da imagem • `D` favoritar • `F` tela cheia • `M` mudo • `Esc` fecha painel/player
Controle remoto: setas, OK, Voltar; teclas de canal/mídia também funcionam.

## ⚙ Configurações (botão ⚙ no topo)
- **Idioma**: Português (Brasil), English, Español. Fica salvo no aparelho. As traduções estão em `public/i18n.js` (fácil de editar/adicionar idiomas).
- **Reprodução**: reprodutor de vídeo (Automático/HLS.js, Shaka, MPEG-TS, Nativo), formato da imagem, retomar de onde parou, próximo episódio automático.
  ExoPlayer só existe no app Android (fica para o app nativo); JW Player exige licença paga.
- **Aparência**: Modo TV, tela cheia.
- **Controle dos pais**: ativa uma senha de 4 números. Categorias e títulos adultos (nomes como Adultos, XXX, +18, Hentai etc., mais palavras extras que você definir) ficam escondidos em todas as telas, busca, favoritos e histórico. "Desbloquear" pede a senha e vale até fechar a aba. Alterar/desativar também pedem a senha.
  É um bloqueio familiar: quem limpar os dados do navegador remove a senha.
- **Dados**: atualizar catálogo, limpar cache/histórico/favoritos. **Conta**: trocar perfil/servidor.
