#!/usr/bin/env bash
# One-time publication of Typographic Art on GitHub.
#
#   scripts/publish.sh --dry-run   # show every step
#   scripts/publish.sh             # do it
# Author defaults to d0n <d0n@tg-art.org>; override with GIT_NAME / GIT_EMAIL.
#
# Prerequisites: the GitHub organisation "typographic-art" exists, and `gh` is logged in with an
# account that owns it (`gh auth login`, or `gh auth switch` between accounts).
set -euo pipefail

ORG=typographic-art
REPO=tg-art
DOMAIN=tg-art.org
DESCRIPTION="Typographic Art: ASCII art for the age of AI. A text set character for character so that it forms a picture - people see the picture, machines read the text."
TOPICS=(typographic-art ascii-art text-art typography variable-fonts generative-art ai-readable accessibility)

DRY=0
[[ "${1:-}" == "--dry-run" ]] && DRY=1
run() { if ((DRY)); then printf '  [dry-run] %q' "$1"; shift; printf ' %q' "$@"; echo; else "$@"; fi; }

GIT_NAME="${GIT_NAME:-d0n}"
GIT_EMAIL="${GIT_EMAIL:-d0n@tg-art.org}"
cd "$(dirname "$0")/.."

echo "== Checks"
LOGIN=$(gh api user --jq .login)
echo "  gh account:   $LOGIN"
echo "  commit as:    $GIT_NAME <$GIT_EMAIL>"
if ORG_LOGIN=$(gh api "orgs/$ORG" --jq .login 2>/dev/null); then
  echo "  organisation: $ORG_LOGIN"
else
  echo "  Organisation $ORG not found or not visible to $LOGIN. Create it first: https://github.com/organizations/new"
  ((DRY)) || exit 1
fi
if gh repo view "$ORG/$REPO" >/dev/null 2>&1; then echo "Repository $ORG/$REPO already exists. Stopping."; exit 1; fi
npm test >/dev/null && echo "  tests:        pass"
if ((!DRY)); then
  read -r -p "Publish $ORG/$REPO publicly as $LOGIN? [y/N] " ok
  [[ "$ok" == "y" || "$ok" == "Y" ]] || { echo "Cancelled."; exit 1; }
fi

echo "== First commit"
run git config user.name "$GIT_NAME"
run git config user.email "$GIT_EMAIL"
run git add -A
if git rev-parse --verify HEAD >/dev/null 2>&1; then
  echo "  commits exist already, nothing to commit"
else
  run git commit -q -m "Typographic Art 0.1.0" -m "Library, web app for $DOMAIN, command line tool, gallery and definition of the technique."
fi

echo "== Repository"
run gh repo create "$ORG/$REPO" --public --source . --remote origin --push --description "$DESCRIPTION" --homepage "https://$DOMAIN"
TOPIC_ARGS=()
for t in "${TOPICS[@]}"; do TOPIC_ARGS+=(--add-topic "$t"); done
run gh repo edit "$ORG/$REPO" --enable-discussions --enable-wiki=false "${TOPIC_ARGS[@]}"

echo "== GitHub Pages ($DOMAIN, deployed by .github/workflows/pages.yml)"
run gh api -X POST "repos/$ORG/$REPO/pages" -f build_type=workflow
run gh api -X PUT "repos/$ORG/$REPO/pages" -f cname="$DOMAIN"

echo "== Security"
run gh api -X PUT "repos/$ORG/$REPO/private-vulnerability-reporting"

echo "== Labels"
label() { run gh label create "$1" --repo "$ORG/$REPO" --color "$2" --description "$3" --force; }
label "good first issue" 7057ff "A small, well-described task for newcomers"
label "help wanted" 008672 "We would love help with this"
label gallery b8145a "Artwork submissions and the gallery page"
label fonts 1d76db "Adding or improving variable fonts"
label algorithm 0e8a16 "Setting, tone mapping, colour"
label ai-readability 5319e7 "Machine readability of the works: OCR, PDF, models"
label translation fbca04 "App and documentation languages"
label docs 0075ca "Documentation"

echo
echo "Done. Next:"
echo "  1. DNS for $DOMAIN: A 185.199.108.153 185.199.109.153 185.199.110.153 185.199.111.153"
echo "     AAAA 2606:50c0:8000::153 2606:50c0:8001::153 2606:50c0:8002::153 2606:50c0:8003::153, www CNAME $ORG.github.io"
echo "  2. Verify the domain for the organisation: https://github.com/organizations/$ORG/settings/pages"
echo "  3. When DNS works: gh api -X PUT repos/$ORG/$REPO/pages -F https_enforced=true"
