#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node is not installed. Get the LTS version from https://nodejs.org, then double-click this file again."
  read -p "Press Enter to close."; exit 1
fi
if [ ! -f .env.local ] || grep -q "paste-your-key-here" .env.local; then
  echo "First run: paste your Anthropic API key (starts with sk-ant-) and press Enter."
  echo "(Nothing will show as you paste. That's normal.)"
  read -s KEY; echo
  KEY="$(echo "$KEY" | tr -d '[:space:]')"
  if [ -z "$KEY" ]; then echo "No key entered."; read -p "Press Enter to close."; exit 1; fi
  printf 'ANTHROPIC_API_KEY=%s\n' "$KEY" > .env.local
  chmod 600 .env.local
  echo "Key saved in .env.local. You won't be asked again."
fi
(sleep 1; open "http://localhost:3000") &
node dev-server.js
