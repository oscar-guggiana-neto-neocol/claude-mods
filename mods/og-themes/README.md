# og-themes

Temas do Claude Code para saber de relance para quem você está trabalhando:
o tema normal do Claude (pessoal), **Neocol** e **LaGana Lion**, cada um em dark e light.

| Tema | Destaque | Borda do prompt | Fundo da mensagem |
| --- | --- | --- | --- |
| Neocol dark / light | aqua `#00a6a5` / teal `#3d7986` | teal / aqua | navy `#0d2c39` / cinza `#e6e7e8` |
| LaGana Lion dark / light | vermelho chevron `#E8473A` | navy `#4A6080` / `#344563` | navy `#1E2D45` / `#EAECF0` |

As cores vêm dos design systems (`neocol-branding`, 2026, e `lagana-branding`, coleção Lion).

## Uso

`/og-tema` abre um menu numerado. Tecle o número e o tema muda na hora:

```
1. Claude dark        3. Neocol dark        5. LaGana Lion dark
2. Claude light       4. Neocol light       6. LaGana Lion light
```

Também dá para escolher direto:

```
/og-tema 4                 # Neocol light
/og-tema lagana            # troca a marca, mantém dark/light
/og-tema light             # troca só o modo
/og-tema reset             # tira o tema do projeto: volta o tema global
```

## Como funciona

Cada projeto (diretório da sessão) tem um arquivo de tema próprio,
`~/.claude/themes/og-tema-<pasta>-<hash>.json`, e o `.claude/settings.local.json` do
projeto aponta para ele (`"theme": "custom:og-tema-..."`). O Claude Code recarrega
`~/.claude/themes/` quando um arquivo muda, então o `/og-tema` só reescreve esse arquivo
e a sessão troca de cor na hora. Sessões abertas em projetos diferentes ficam cada uma
com o seu tema.

O Claude Code lê o setting `theme` só ao iniciar. Por isso, **na primeira escolha num
projeto** o tema vale a partir da próxima sessão (o comando avisa). Depois disso todas
as trocas são ao vivo.

Os quatro temas de marca também aparecem em `/theme` ("Neocol Dark", "LaGana Lion
Light"...). Num projeto com `/og-tema`, o `/theme` muda só o tema global, e o projeto
continua com o dele.
