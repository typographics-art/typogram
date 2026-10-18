#!/usr/bin/env python3
"""tg_extract — a standalone reference reader and verifier for Typograms (docs/typogram-file.md, docs/canonical-text.md).

Mirrors cli/tg.mjs with the Python standard library only (optional `pypdf` for PDF). A Typogram is a picture made of its own
readable text (the IMAGE layer) that also carries, in a DATA layer, the exact source and a JSON-LD record whose tgart.hash
binds the two.

    tg_extract.py verify  <file>
    tg_extract.py extract <file> [--markdown | --json | --text] [--from-glyphs]

Formats: .svg and .html need nothing beyond the standard library; .pdf needs `pip install pypdf`.
"""
import sys
import re
import json
import html
import hashlib
import unicodedata

# The default-ignorable code points the canonical form removes — the same list as docs/canonical-text.md (kept in sync there).
_INVISIBLE = re.compile(
    '[­͏؜ᅟᅠ឴឵᠋-᠏'
    '​-‏‪-‮⁠-⁯﻿￰-￸'
    '\U000e0000-\U000e0fff]'
)


def canonical_text(s: str) -> str:
    """The canonical form of a text (docs/canonical-text.md §2): drop invisibles, NFC, collapse whitespace, trim."""
    s = _INVISIBLE.sub('', s)
    s = unicodedata.normalize('NFC', s)
    return re.sub(r'\s+', ' ', s).strip()


def sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode('utf-8')).hexdigest()


def first_heading(md):
    for raw in (md or '').split('\n'):
        line = raw.strip()
        if not line:
            continue
        m = re.match(r'^(#{1,6})\s+(.+?)\s*#*$', line)
        return m.group(2).strip() if m else None
    return None


# ---- the data layer and the image layer, per format ------------------------------------------------------------------
def _cdata_unescape(s):
    return s.replace(']]]]><![CDATA[>', ']]>')


def _strip_data_layer(text):
    """Remove the SVG data-layer <metadata> block CDATA-safely (mirror of src/typogram.js stripDataLayer)."""
    meta = text.find('<metadata>')
    if meta < 0:
        return text
    cdata_end = text.find(']]></tgart:source>', meta)
    start = cdata_end if cdata_end >= 0 else meta
    close = text.find('</metadata>', start)
    if close < 0:
        return text
    return text[:meta] + text[close + len('</metadata>'):]


def _strip_tags(s):
    return re.sub(r'<[^>]+>', '', s)


def svg_layers(text):
    stripped = _strip_data_layer(text)
    end = stripped.rfind('</text>')
    start = stripped.find('<text')
    image = html.unescape(_strip_tags(stripped[start:end] if start >= 0 and end >= 0 else stripped))
    m = re.search(r'<tgart:source\b[^>]*>\s*<!\[CDATA\[(.*?)\]\]></tgart:source>', text, re.S)
    markdown = _cdata_unescape(m.group(1)) if m else None
    j = re.search(r'<script type="application/ld\+json">(.*?)</script>', text, re.S)
    jsonld = json.loads(j.group(1)) if j else None
    title = re.search(r'<title>(.*?)</title>', stripped, re.S)
    return image, markdown, jsonld, (html.unescape(title.group(1)).strip() if title else None)


def html_layers(text):
    body = re.sub(r'<article class="tg-article">.*?</article>', '', text, flags=re.S)
    body = re.sub(r'<head\b.*?</head>', '', body, flags=re.S)
    body = re.sub(r'<(script|style)\b.*?</\1>', '', body, flags=re.S)
    image = html.unescape(_strip_tags(body))
    m = re.search(r'<script type="text/markdown">(.*?)</script>', text, re.S)
    markdown = re.sub(r'<\\/(script)', r'</\1', m.group(1)) if m else None
    j = re.search(r'<script type="application/ld\+json">(.*?)</script>', text, re.S)
    jsonld = json.loads(j.group(1)) if j else None
    h1 = re.search(r'<h1\b[^>]*>(.*?)</h1>', text, re.S | re.I)
    return image, markdown, jsonld, (html.unescape(_strip_tags(h1.group(1))).strip() if h1 else None)


def pdf_layers(path):
    try:
        import pypdf
    except ImportError:
        sys.exit('tg_extract: reading a PDF needs pypdf (pip install pypdf)')
    reader = pypdf.PdfReader(path)
    image = '\n'.join(page.extract_text() or '' for page in reader.pages)
    att = {}
    try:
        for name, data in (reader.attachments or {}).items():
            att[name] = data[0] if isinstance(data, list) else data
    except Exception:
        pass
    src = att.get('source.md') or att.get('source.txt')
    markdown = src.decode('utf-8') if src else None
    jsonld = json.loads(att['metadata.json'].decode('utf-8')) if 'metadata.json' in att else None
    return image, markdown, jsonld, None  # a PDF has no in-page title (the /Info title is checked by the JS tool)


def layers(path):
    low = path.lower()
    if low.endswith('.svg'):
        return svg_layers(open(path, encoding='utf-8').read())
    if low.endswith('.html') or low.endswith('.htm'):
        return html_layers(open(path, encoding='utf-8').read())
    if low.endswith('.pdf'):
        return pdf_layers(path)
    head = open(path, 'rb').read(400)
    if head[:5] == b'%PDF-':
        return pdf_layers(path)
    text = head.decode('utf-8', 'ignore').lstrip()
    if '<svg' in text:
        return svg_layers(open(path, encoding='utf-8').read())
    if re.search(r'<!doctype html|<html\b', text, re.I):
        return html_layers(open(path, encoding='utf-8').read())
    sys.exit(f'tg_extract: unknown format for {path} (expected .svg, .html or .pdf)')


# ---- commands --------------------------------------------------------------------------------------------------------
def verify(path):
    image, markdown, jsonld, title = layers(path)
    if markdown is None and jsonld is None:
        sys.exit(f'tg_extract: no data layer found in {path} — is it a Typogram?')
    img_canon = canonical_text(image)
    img_hash = sha256_hex(img_canon)
    md_canon = canonical_text(markdown) if markdown is not None else None
    md_hash = sha256_hex(md_canon) if md_canon is not None else None
    stored = (jsonld or {}).get('tgart', {}).get('hash')

    problems = []
    if not stored:
        problems.append('the data layer carries no identity hash (tgart.hash)')
    elif img_hash != stored:
        problems.append(f'image-layer hash {img_hash} != stored hash {stored}')
    if md_hash is None:
        problems.append('the data layer carries no embedded source')
    elif img_hash != md_hash:
        problems.append(f'image-layer hash {img_hash} != embedded-source hash {md_hash}')
    if md_canon is not None and img_canon != md_canon:
        i = next((k for k in range(min(len(img_canon), len(md_canon))) if img_canon[k] != md_canon[k]), min(len(img_canon), len(md_canon)))
        problems.append(f'image and source first differ at character {i}:\n    image : ...{img_canon[max(0,i-20):i+20]!r}...\n    source: ...{md_canon[max(0,i-20):i+20]!r}...')
    heading = first_heading(markdown)
    if title and heading and canonical_text(title) != canonical_text(heading):
        problems.append(f'the visible title {title!r} is not the start of the data layer (first heading {heading!r})')

    if problems:
        sys.stderr.write('tg_extract: FAIL — %s\n  - %s\n' % (path, '\n  - '.join(problems)))
        sys.exit(1)
    print(f'tg_extract: OK — {path}')
    print(f'  image layer, embedded source and stored hash all carry one text (sha256 {img_hash})')


def plain_text(md):
    md = re.sub(r'^ {0,3}(#{1,6})\s+', '', md, flags=re.M)
    md = re.sub(r'^ {0,3}[-*+]\s+', '', md, flags=re.M)
    md = re.sub(r'^ {0,3}\d+[.)]\s+', '', md, flags=re.M)
    md = re.sub(r'^ {0,3}(`{3,}|~{3,}).*$', '', md, flags=re.M)
    md = re.sub(r'`([^`]+)`', r'\1', md)
    md = re.sub(r'\*\*([^*]+)\*\*', r'\1', md)
    md = re.sub(r'\*([^*]+)\*', r'\1', md)
    md = re.sub(r'!\[([^\]]*)\]\([^)]*\)', r'\1', md)
    md = re.sub(r'\[([^\]]+)\]\([^)]*\)', r'\1', md)
    return md


def extract(path, mode, from_glyphs):
    image, markdown, jsonld, _ = layers(path)
    if from_glyphs:
        if mode == 'json':
            sys.exit('tg_extract: --json cannot be read from the glyphs (the image layer has no JSON-LD record)')
        sys.stdout.write((canonical_text(image) if mode == 'text' else image) + '\n')
        return
    if mode == 'json':
        if not jsonld:
            sys.exit(f'tg_extract: {path} carries no JSON-LD record')
        sys.stdout.write(json.dumps(jsonld, indent=2, ensure_ascii=False) + '\n')
        return
    if markdown is None:
        sys.exit(f'tg_extract: {path} carries no embedded source (try --from-glyphs)')
    out = plain_text(markdown) if mode == 'text' else markdown
    sys.stdout.write(out if out.endswith('\n') else out + '\n')


def main(argv):
    if len(argv) < 2:
        sys.exit('usage: tg_extract.py verify <file>  |  tg_extract.py extract <file> [--markdown|--json|--text] [--from-glyphs]')
    cmd = argv[0]
    flags = {a for a in argv[1:] if a.startswith('--')}
    positionals = [a for a in argv[1:] if not a.startswith('--')]
    if not positionals:
        sys.exit('tg_extract: give a file')
    path = positionals[0]
    mode = 'json' if '--json' in flags else 'text' if '--text' in flags else 'markdown'
    if cmd == 'verify':
        verify(path)
    elif cmd == 'extract':
        extract(path, mode, '--from-glyphs' in flags)
    else:
        sys.exit('usage: tg_extract.py verify <file>  |  tg_extract.py extract <file> [--markdown|--json|--text] [--from-glyphs]')


if __name__ == '__main__':
    main(sys.argv[1:])
