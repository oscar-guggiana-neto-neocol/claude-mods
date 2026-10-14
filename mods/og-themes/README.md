# og-themes

Temas do Claude Code para saber de relance para quem você está trabalhando:
o tema normal do Claude (pessoal), **Neocol** e **LaGana Lion**, cada um em dark e light.

| Tema | Destaque | Borda do prompt | Fundo da mensagem |
| --- | --- | --- | --- |
| Neocol dark / light | aqua `#00a6a5` / teal `#3d7986` | teal / aqua | navy `#0d2c39` / cinza `#e6e7e8` |
| LaGana Lion dark / light | vermelho chevron `#E8473A` | navy `#4A6080` / `#344563` | navy `#1E2D45` / `#EAECF0` |

As cores vêm dos design systems (`neocol-branding`, 2026, e `lagana-branding`, coleção Lion).

## Uso

```
/og-tema neocol            # Neocol neste projeto, mantendo dark/light atual
/og-tema lagana light      # LaGana Lion light
/og-tema dark              # troca só o modo
/og-tema claude light      # tema light do Claude, fixo neste projeto
/og-tema claude            # remove o tema do projeto: volta ao tema global
/og-tema                   # mostra o tema do projeto
```

O comando grava `"theme"` em `.claude/settings.local.json` do diretório atual, que vale
acima do `~/.claude/settings.json`. Assim cada projeto lembra o seu tema e projetos
pessoais continuam com o tema global. Os temas também aparecem em `/theme` como
"Neocol Dark", "LaGana Lion Light" etc.; o valor deles é `custom:og-themes:<slug>`.

Num projeto com tema próprio, o `/theme` muda o tema global, mas o do projeto continua
valendo. Para trocar, use `/og-tema`.
