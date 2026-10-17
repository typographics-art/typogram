#!/usr/bin/env python3
"""How much of each example one-pager do common PDF text extractors read?

    python3 -m venv .venv && .venv/bin/pip install pypdf pymupdf pdfminer.six
    .venv/bin/python scripts/extractor-check.py            # table on stdout, docs/extractor-check.json

Counts visible characters (no whitespace, no invisible format characters) per extractor against the
number of visible characters the example's check.json records for its source. Needs MuPDF (mutool)
and Poppler (pdftotext) on the PATH as well. docs/ai-readability.md explains the results.
"""
import json
import os
import subprocess
import unicodedata

import pdfminer.high_level
import pymupdf
import pypdf

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
EXAMPLES = os.path.join(ROOT, 'examples')


def visible(text):
    return sum(1 for c in text if not c.isspace() and unicodedata.category(c) != 'Cf')


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True, check=False).stdout


EXTRACTORS = {
    'mutool draw -F txt': lambda f: run(['mutool', 'draw', '-q', '-F', 'txt', '-o', '-', f]),
    'PyMuPDF': lambda f: ''.join(p.get_text() for p in pymupdf.open(f)),
    'pypdf': lambda f: ''.join(p.extract_text() or '' for p in pypdf.PdfReader(f).pages),
    'pdfminer.six': lambda f: pdfminer.high_level.extract_text(f),
    'pdftotext': lambda f: run(['pdftotext', f, '-']),
    'pdftotext -r 600': lambda f: run(['pdftotext', '-r', '600', f, '-']),
}

rows = []
for ex in json.load(open(os.path.join(EXAMPLES, 'sources.json'), encoding='utf-8')):
    pdf = os.path.join(EXAMPLES, ex['id'], 'onepage.pdf')
    check = json.load(open(os.path.join(EXAMPLES, ex['id'], 'check.json'), encoding='utf-8'))
    total = check['check']['visibleCharacters']
    row = {'id': ex['id'], 'visibleCharacters': total}
    for name, extract in EXTRACTORS.items():
        row[name] = round(100 * visible(extract(pdf)) / total, 2)
    rows.append(row)
    print(f"{ex['id']:20s} " + '  '.join(f'{k} {row[k]:6.2f} %' for k in EXTRACTORS), flush=True)

with open(os.path.join(ROOT, 'docs', 'extractor-check.json'), 'w', encoding='utf-8') as out:
    json.dump({'versions': {'pypdf': pypdf.__version__, 'pymupdf': pymupdf.__version__,
                            'pdftotext': run(['pdftotext', '-v']).strip() or subprocess.run(['pdftotext', '-v'], capture_output=True, text=True).stderr.split('\n')[0]},
               'results': rows}, out, indent=1)
    out.write('\n')
