# Publishing pi-teams

This package is currently local-first. Before publishing to npm:

1. Set package metadata in `package.json`:
   - `author`
   - `repository`
   - `homepage`
   - `bugs`
2. Confirm license and notices:
   - keep `LICENSE`
   - keep `NOTICE.md`
   - document copied/adapted MIT source if any substantial code is ported
3. Run checks:

```bash
npm run check
```

4. Verify package contents:

```bash
npm pack --dry-run
```

5. Verify local install in Pi:

```bash
pi install ./pi-teams
/team-doctor
/team-validate
```

6. Publish when ready:

```bash
npm publish
```

## Config schema

The package exports:

```text
./schema.json
```

Use this for editor validation of:

```text
~/.pi/agent/extensions/pi-teams/config.json
```
