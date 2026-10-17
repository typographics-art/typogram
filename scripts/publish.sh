#!/usr/bin/env bash
# Publication of Typographic Art on GitHub, in two stages.
#
#   scripts/publish.sh --dry-run        # show every step
#   scripts/publish.sh                  # create the repository PRIVATE and push
#   scripts/publish.sh --make-public    # later, once everything looks right: switch to public
#
# Prerequisites: `gh` logged in as the owner account (gh auth login), SSH key for the host alias
# github-tg-art in ~/.ssh/config. The website itself is served by Cloudflare (wrangler.jsonc), so
# GitHub Pages is not configured for typographics-art.org here.
set -euo pipefail

OWNER=typ0graphic5
REPO=tg-art
REMOTE="git@github-tg-art:$OWNER/$REPO.git"
DESCRIPTION="Typographic Art: ASCII art for the age of AI. A text set character for character so that it forms a picture - people see the picture, machines read the text."
TOPICS=(typographic-art ascii-art text-art typography variable-fonts generative-art ai-readable accessibility)

MODE=private DRY=0
case "${1:-}" in
  --dry-run) DRY=1 ;;
  --make-public) MODE=public ;;
  "") ;;
  *) echo "unknown option $1"; exit 1 ;;
esac
run() { if ((DRY)); then printf '  [dry-run] %q' "$1"; shift; printf ' %q' "$@"; echo; else "$@"; fi; }
cd "$(dirname "$0")/.."

echo "== Checks"
LOGIN=$(gh api user --jq .login 2>/dev/null || echo "?")
echo "  gh account: $LOGIN (needed: $OWNER)"
if [[ "$LOGIN" != "$OWNER" ]]; then
  echo "  gh is not logged in as $OWNER. Run: gh auth login --hostname github.com --git-protocol ssh --skip-ssh-key --web"
  ((DRY)) || exit 1
fi
# GitHub answers `ssh -T` with exit code 1 even on success ("no shell access"); check the greeting instead.
SSH_GREETING=$(ssh -o BatchMode=yes -T git@github-tg-art 2>&1 || true)
if [[ "$SSH_GREETING" == *"Hi $OWNER!"* ]]; then
  echo "  ssh key:    ok ($OWNER)"
else
  echo "  ssh key for github-tg-art does not authenticate as $OWNER"
  ((DRY)) || exit 1
fi

if [[ "$MODE" == public ]]; then
  echo "== Switch $OWNER/$REPO to public"
  if ((!DRY)); then
    read -r -p "Make $OWNER/$REPO PUBLIC now? Everything in its history becomes visible. [y/N] " ok
    [[ "$ok" == "y" || "$ok" == "Y" ]] || { echo "Cancelled."; exit 1; }
  fi
  run gh repo edit "$OWNER/$REPO" --visibility public --accept-visibility-change-consequences
  run gh api -X PUT "repos/$OWNER/$REPO/private-vulnerability-reporting"
  echo "Done: https://github.com/$OWNER/$REPO is public."
  exit 0
fi

npm test >/dev/null && echo "  tests:      pass"
if gh repo view "$OWNER/$REPO" >/dev/null 2>&1; then echo "  repository exists already, only pushing"; EXISTS=1; else EXISTS=0; fi

echo "== Repository (private)"
if ((!EXISTS)); then
  run gh repo create "$OWNER/$REPO" --private --description "$DESCRIPTION" --homepage "https://typographics-art.org"
fi
TOPIC_ARGS=()
for t in "${TOPICS[@]}"; do TOPIC_ARGS+=(--add-topic "$t"); done
run gh repo edit "$OWNER/$REPO" --enable-discussions --enable-wiki=false "${TOPIC_ARGS[@]}"

echo "== Push over SSH"
git remote get-url origin >/dev/null 2>&1 || run git remote add origin "$REMOTE"
run git push -u origin main

echo "== Labels"
label() { run gh label create "$1" --repo "$OWNER/$REPO" --color "$2" --description "$3" --force; }
label "good first issue" 7057ff "A small, well-described task for newcomers"
label "help wanted" 008672 "We would love help with this"
label gallery b8145a "Artwork submissions and the gallery page"
label fonts 1d76db "Adding or improving variable fonts"
label algorithm 0e8a16 "Setting, tone mapping, colour"
label ai-readability 5319e7 "Machine readability of the works: OCR, PDF, models"
label translation fbca04 "App and documentation languages"
label docs 0075ca "Documentation"

echo
echo "Done: https://github.com/$OWNER/$REPO (private). Check it, then: scripts/publish.sh --make-public"
