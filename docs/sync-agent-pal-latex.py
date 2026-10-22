#!/usr/bin/env python3
"""Generate the standalone English LaTeX manuscript from its reviewed Markdown.

Run from any directory. --check checks byte-for-byte synchronization without writes.
Supports the deliberately small Markdown subset used by this manuscript.
"""
from pathlib import Path
import argparse
import re

HERE = Path(__file__).resolve().parent
SOURCE = HERE / 'agent-pal-bench-draft.en.md'
TARGET = HERE / 'agent-pal-bench-draft.tex'


def escape(text):
    chars = {'\\': r'\textbackslash{}', '&': r'\&', '%': r'\%', '$': r'\$',
             '#': r'\#', '_': r'\_', '{': r'\{', '}': r'\}',
             '~': r'\textasciitilde{}', '^': r'\textasciicircum{}',
             '×': r'\ensuremath{\times}', '→': r'\ensuremath{\rightarrow}',
             '±': r'\ensuremath{\pm}', '°': r'\ensuremath{^\circ}',
             'Δ': r'\ensuremath{\Delta}', '<': r'\ensuremath{<}', '>': r'\ensuremath{>}',
             '–': '--', '—': '---', '’': "'", '‘': '`', '“': '``', '”': "''"}
    return ''.join(chars.get(c, c) for c in text)


def inline(text):
    pieces, at = [], 0
    pattern = r'`([^`]+)`|\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)]+)\)|\*([^*]+)\*'
    for m in re.finditer(pattern, text):
        pieces.append(escape(text[at:m.start()]))
        if m.group(1) is not None:
            pieces.append(r'\nolinkurl{' + m.group(1) + '}')
        elif m.group(2) is not None:
            pieces.append(r'\textbf{' + inline(m.group(2)) + '}')
        elif m.group(3) is not None:
            pieces.append(r'\href{' + m.group(4).replace('%', r'\%') + '}{' + inline(m.group(3)) + '}')
        else:
            pieces.append(r'\emph{' + inline(m.group(5)) + '}')
        at = m.end()
    pieces.append(escape(text[at:]))
    return ''.join(pieces)


def table(lines):
    rows = [[c.strip() for c in line.strip().strip('|').split('|')] for line in lines]
    header, body = rows[0], rows[2:]
    n = len(header)
    assert all(len(r) == n for r in body)
    if n == 3:
        widths = [.08, .39, .45] if header[0] == 'ID' else [.22, .34, .36]
    elif n == 4:
        widths = [.16, .24, .26, .26] if header[0] == 'Dimension' else [.32, .16, .22, .22]
    else:
        widths = [.92/n] * n
    spec = '@{}' + ''.join(r'>{\raggedright\arraybackslash}p{' + str(w) + r'\linewidth}' for w in widths) + '@{}'
    head = ' & '.join(inline(c) for c in header) + r' \\'
    return '\n'.join([r'{\small\setlength{\tabcolsep}{3pt}',
        r'\begin{longtable}{' + spec + '}', r'\toprule', head, r'\midrule\endfirsthead',
        r'\toprule', head, r'\midrule\endhead', r'\bottomrule\endfoot',
        *[' & '.join(inline(c) for c in row) + r' \\' for row in body],
        r'\end{longtable}', '}'])


def generate():
    lines = SOURCE.read_text().splitlines()
    title = lines[0].removeprefix('# ')
    preamble = r'''% Generated from agent-pal-bench-draft.en.md by sync-agent-pal-latex.py.
% Edit the Markdown and regenerate; this is a standalone document.
\documentclass[11pt,a4paper]{article}
\usepackage[margin=1in]{geometry}
\usepackage[T1]{fontenc}
\usepackage{lmodern}
\usepackage{microtype}
\usepackage{booktabs,longtable,array}
\usepackage{enumitem}
\usepackage{xurl}
\usepackage{hyperref}
\hypersetup{colorlinks=true,linkcolor=blue,citecolor=blue,urlcolor=blue}
\setlength{\parskip}{0.45em}
\setlength{\parindent}{0pt}
\setlength{\emergencystretch}{2em}
\setlist{nosep,leftmargin=*}
'''
    out = [preamble, r'\title{' + inline(title) + '}',
           r'\author{Working draft for anonymous review}', r'\date{20 October 2026}',
           r'\begin{document}', r'\maketitle']
    i, abstract, listing = 1, False, None
    def end_list():
        nonlocal listing
        if listing:
            out.append(r'\end{' + listing + '}')
            listing = None
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            out.append(''); i += 1; continue
        if line.startswith('> '):
            end_list(); out.append(r'{\footnotesize ' + inline(line[2:]) + r'\par}'); i += 1; continue
        if line.startswith('## Abstract'):
            out.append(r'\begin{abstract}'); abstract = True; i += 1; continue
        if abstract and line.startswith('**Keywords:'):
            out.append(r'\end{abstract}'); abstract = False
        if line.startswith('#'):
            end_list()
            m = re.match(r'(#{2,3})\s+(?:\d+(?:\.\d+)*\.?\s+)?(.+)', line)
            assert m, line
            level = 'section' if len(m[1]) == 2 else 'subsection'
            unnumbered = '*' if m[2] in ('Required Before Submission', 'References') else ''
            out.append('\\' + level + unnumbered + '{' + inline(m[2]) + '}'); i += 1; continue
        if line.startswith('|'):
            end_list(); block = []
            while i < len(lines) and lines[i].startswith('|'):
                block.append(lines[i]); i += 1
            out.append(table(block)); continue
        m = re.match(r'(?:- \[ \] |\d+\. )(.+)', line)
        if m:
            want = 'itemize' if line.startswith('- ') else 'enumerate'
            if listing != want:
                end_list(); out.append(r'\begin{' + want + '}'); listing = want
            out.append(r'\item ' + inline(m[1])); i += 1; continue
        end_list(); out.append(inline(line)); i += 1
    end_list()
    if abstract: out.append(r'\end{abstract}')
    out.append(r'\end{document}')
    return '\n'.join(out) + '\n'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    content = generate()
    if args.check:
        if not TARGET.exists() or TARGET.read_text() != content:
            raise SystemExit('LaTeX is out of sync; run sync-agent-pal-latex.py')
        print('English Markdown / LaTeX synchronization verified')
    else:
        TARGET.write_text(content)
        print(TARGET)
