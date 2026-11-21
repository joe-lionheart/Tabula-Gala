#!/bin/bash
# Tabula Gala starten (macOS): Doppelklick im Finder.
cd "$(dirname "$0")"
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

if ! command -v npm >/dev/null 2>&1; then
  echo ""
  echo "Node.js fehlt. Bitte den Installer von https://nodejs.org (LTS) ausführen"
  echo "und danach start.command noch einmal doppelklicken."
  echo ""
  read -r -p "Enter drücken zum Schließen …"
  exit 1
fi

[ -f .env ] || cp .env.example .env
[ -d node_modules ] || npm install
(sleep 2 && open http://localhost:3000) &
npm start
