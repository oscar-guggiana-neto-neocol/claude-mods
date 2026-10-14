# og-themes

Claude Code themes that tell you at a glance who you are working for: Claude's normal theme
(personal), **Neocol** and **LaGana Lion**, each in dark and light.

| Theme | Accent | Prompt border | Message background |
| --- | --- | --- | --- |
| Neocol dark / light | aqua `#00a6a5` / teal `#3d7986` | teal / aqua | navy `#0d2c39` / gray `#e6e7e8` |
| LaGana Lion dark / light | chevron red `#E8473A` | navy `#4A6080` / `#344563` | navy `#1E2D45` / `#EAECF0` |

The colors come from the design systems (`neocol-branding`, 2026, and `lagana-branding`, Lion collection).

## Usage

`/og-theme` opens a numbered menu. Press the number and the theme changes at once:

```
1. Claude dark        3. Neocol dark        5. LaGana Lion dark
2. Claude light       4. Neocol light       6. LaGana Lion light
```

You can also pick directly:

```
/og-theme 4                # Neocol light
/og-theme lagana           # changes the brand, keeps dark/light
/og-theme light            # changes only the mode
/og-theme reset            # removes the project theme: back to the global theme
```

## How it works

Each project (the session's directory) has its own theme file,
`~/.claude/themes/og-tema-<folder>-<hash>.json`, and the project's `.claude/settings.local.json`
points at it (`"theme": "custom:og-tema-..."`). Claude Code reloads `~/.claude/themes/` when a
file changes, so `/og-theme` only rewrites that file and the session changes color at once.
Sessions open in different projects each keep their own theme.

Claude Code reads the `theme` setting only at startup. So **on the first pick in a project** the
theme takes effect from the next session (the command says so). After that, every change is live.

The four brand themes also show in `/theme` ("Neocol Dark", "LaGana Lion Light"...). In a project
with `/og-theme`, `/theme` changes only the global theme, and the project keeps its own.

On Windows the file lives in `%USERPROFILE%\.claude\themes`; with `CLAUDE_CONFIG_DIR` set, in
`$CLAUDE_CONFIG_DIR/themes`.
