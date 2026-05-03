---
name: deploy
description: Deploy CACP to cloud server per runbook
---
1. Read docs/deploy-cloud.md
2. Build web (use bash env syntax, not PowerShell)
3. Package via Python/paramiko (NOT tar append on Windows)
4. Deploy and verify via /health endpoint
5. Clean up local temp files