"""Read-only comparison of source XML and an existing imported document.

Does not import application code, call its backend, or change source/work files.
Outputs counts and locations only; no private manuscript excerpts.
Direct-format checks are deliberately limited; inherited formats are not resolved.
"""
import collections
import hashlib
import json
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

SOURCE = Path(r'C:\Users\Administrator\Desktop\导入测试-短剧剧本.docx')
TARGET = Path(r'C:\Users\Administrator\Desktop\test\导出验收-20261001\作品文本\documents\node-1790933502585839300-1.json')
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def text_of(element):
    out = []
    for node in element.iter():
        if node.tag == W + 't':
            out.append(node.text or '')
        elif node.tag == W + 'tab':
            out.append('\t')
        elif node.tag in (W + 'br', W + 'cr'):
            out.append('\n')
    return ''.join(out)


def leaves(node):
    if node.get('type') in ('paragraph', 'heading'):
        yield node
    else:
        for child in node.get('content', []):
            yield from leaves(child)


def target_chars(node):
    for child in node.get('content', []):
        if child.get('type') == 'text':
            marks = {m['type']: m.get('attrs', {}) for m in child.get('marks', [])}
            for char in child['text']:
                yield char, marks
        elif child.get('type') == 'hardBreak':
            yield '\n', {}
        else:
            raise ValueError('Unaccounted inline node: ' + child.get('type', '?'))


def main():
    raw_source, raw_target = SOURCE.read_bytes(), TARGET.read_bytes()
    with zipfile.ZipFile(SOURCE) as archive:
        root = ET.fromstring(archive.read('word/document.xml'))
    body = root.find(W + 'body')
    source_paras = list(body.iter(W + 'p'))
    saved = json.loads(raw_target)
    target_paras = list(leaves(saved['document']))
    source_text = [text_of(p) for p in source_paras]
    target_data = [list(target_chars(p)) for p in target_paras]
    target_text = [''.join(c for c, _ in data) for data in target_data]
    # Archived add-word-import design explicitly requires w:br -> adjacent paragraphs.
    # Retain strict/raw comparison separately. Do not trim or normalize other text.
    expected_paragraphs = [part for text in source_text for part in text.split('\n')]
    contract_equal = expected_paragraphs == target_text
    # Negative controls operate on copies in memory, never on saved documents.
    changed = list(target_text)
    changed[len(changed) // 2] += '[audit mutation]'
    removed = target_text[:100] + target_text[101:]
    duplicated = target_text[:100] + target_text[99:]
    reordered = list(target_text)
    swap = next(i for i in range(len(reordered) - 1) if reordered[i] != reordered[i + 1])
    reordered[swap], reordered[swap + 1] = reordered[swap + 1], reordered[swap]
    controls = {name: expected_paragraphs != values for name, values in
                [('changed_text', changed), ('missing_paragraph', removed),
                 ('duplicated_paragraph', duplicated), ('reordered_paragraphs', reordered)]}
    assert all(controls.values()), 'Negative control failed'
    aligned_data = []
    cursor = 0
    for text in source_text:
        pieces = text.split('\n')
        data = []
        for part_index, part in enumerate(pieces):
            if part_index:
                data.append(('\n', {}))
            if cursor < len(target_data):
                data.extend(target_data[cursor])
            cursor += 1
        aligned_data.append(data)
    mismatches = []
    for i in range(max(len(source_text), len(target_text))):
        a = source_text[i] if i < len(source_text) else None
        b = target_text[i] if i < len(target_text) else None
        if a != b:
            mismatches.append({'paragraph_1based': i + 1,
                               'source_length': len(a) if a is not None else None,
                               'target_length': len(b) if b is not None else None})
    counts = collections.Counter(n.tag.removeprefix(W) for n in body.iter())
    direct_counts, checked, failed = collections.Counter(), collections.Counter(), collections.Counter()
    examples = []
    for i, p in enumerate(source_paras):
        if not contract_equal:
            continue
        offset = 0
        for run in p.iter(W + 'r'):
            text = text_of(run)
            props = run.find(W + 'rPr')
            expectations = {}
            if props is not None:
                for prop in props:
                    key = prop.tag.removeprefix(W)
                    direct_counts[key] += 1
                    value = prop.get(W + 'val')
                    if key in ('b', 'i', 'strike'):
                        expectations[{'b': 'bold', 'i': 'italic', 'strike': 'strike'}[key]] = value not in ('0', 'false', 'off')
                    elif key == 'u' and value is not None:
                        expectations['underline'] = value != 'none'
                    elif key == 'sz' and value is not None:
                        expectations['fontSize'] = f'{int(value) / 2:g}pt'
                    elif key == 'color' and value and len(value) == 6:
                        expectations['color'] = '#' + value.lower()
            for j, char in enumerate(text):
                if offset + j >= len(aligned_data[i]):
                    raise ValueError('Run text and paragraph text disagree')
                actual_char, marks = aligned_data[i][offset + j]
                if actual_char != char:
                    raise ValueError('Run order and paragraph order disagree')
                if char == '\n':
                    continue
                for key, expected in expectations.items():
                    actual = key in marks if isinstance(expected, bool) else marks.get('textStyle', {}).get(key)
                    checked[key] += 1
                    if actual != expected:
                        failed[key] += 1
                        if len(examples) < 12:
                            examples.append({'paragraph_1based': i + 1, 'char_offset': offset + j,
                                             'property': key, 'expected': expected, 'actual': actual})
            offset += len(text)
        if offset != len(source_text[i]):
            raise ValueError('Text outside accounted runs; comparison incomplete')
    result = {
        'kind': 'existing_saved_artifact_not_fresh_import',
        'source_sha256': digest(raw_source), 'target_sha256': digest(raw_target),
        'source_paragraphs': len(source_paras), 'target_paragraphs': len(target_paras),
        'source_characters': sum(map(len, source_text)), 'target_characters': sum(map(len, target_text)),
        'source_empty_paragraphs': source_text.count(''), 'target_empty_paragraphs': target_text.count(''),
        'source_whitespace_only_including_empty': sum(not s.strip() for s in source_text),
        'target_whitespace_only_including_empty': sum(not s.strip() for s in target_text),
        'in_memory_negative_controls_detected': controls,
        'exact_paragraph_array_equal': source_text == target_text,
        'contract_expected_paragraphs': len(expected_paragraphs),
        'exact_paragraph_array_equal_after_documented_break_split': contract_equal,
        'break_locations': [{'source_paragraph_1based': i + 1,
                             'break_types': [n.get(W + 'type', 'textWrapping') for n in p.iter(W + 'br')]}
                            for i, p in enumerate(source_paras) if p.find('.//' + W + 'br') is not None],
        'text_mismatch_count': len(mismatches), 'text_mismatch_examples': mismatches[:12],
        'source_elements': {k: counts[k] for k in ['p', 'r', 'pStyle', 'rStyle', 'sym', 'numPr', 'tbl', 'drawing', 'hyperlink', 'ins', 'del', 'br', 'tab']},
        'direct_property_counts': dict(direct_counts), 'direct_format_character_checks': dict(checked),
        'direct_format_character_mismatches': dict(failed), 'format_mismatch_examples': examples,
        'limits': ['Existing import provenance may predate the current fix.',
                   'No inherited-style, font-resolution, highlight, paragraph-layout or rendered-UI assertion.',
                   'Direct-format mismatches are investigation leads, not automatic defect attribution.'],
        'inputs_unchanged': SOURCE.read_bytes() == raw_source and TARGET.read_bytes() == raw_target,
    }
    print(json.dumps(result, ensure_ascii=True, indent=2))
    return 1 if not contract_equal or failed or not result['inputs_unchanged'] else 0


if __name__ == '__main__':
    sys.exit(main())
