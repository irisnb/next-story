#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Generate acceptance-complex.docx for OpenSpec fix-import-fidelity (Task 1).

Hand-built minimal-but-valid OOXML. Python standard library only.
No Word/WPS involved, and NOTHING is derived from the project importer
(docx_import.rs is never read). All expected values below are frozen from
this source design.

Deterministic: fixed zip entry order, fixed timestamps (2026-10-03), fixed
XML strings, so regeneration is byte-identical on the same Python.

Usage:
  python generate-acceptance-docx.py             # generate + verify
  python generate-acceptance-docx.py --verify-only  # verify existing file
"""
import hashlib
import io
import sys
import zipfile
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

DOCX_PATH = r"D:\Next Story\src-tauri\tests\fixtures\docx\acceptance-complex.docx"
W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
ZIP_DATE = (2026, 10, 3, 0, 0, 0)

# --------------------------------------------------------------------------
# Frozen design tables (source of truth for BOTH emission and verification)
# --------------------------------------------------------------------------


def R(text, rstyle=False, b=None, color=None, sz=None):
    return {"kind": "t", "text": text, "rstyle": rstyle, "b": b,
            "color": color, "sz": sz}


def SYM(font, char):
    return {"kind": "sym", "font": font, "char": char}


PARAS = [
    {"pid": "P01", "style": None, "num": None,
     "runs": [R("BEGIN marker paragraph A01 plain docDefaults baseline.")]},
    {"pid": "P02", "style": None, "num": None,
     "runs": [R("Run A02a inherits docDefaults. "),
              R("A02b 中文运行保持原样。")]},
    {"pid": "P03", "style": "AcceptanceBase", "num": None,
     "runs": [R("A03 AcceptanceBase expects 12pt color 1F4E79 not bold.")]},
    {"pid": "P04", "style": "AcceptanceMid", "num": None,
     "runs": [R("A04 AcceptanceMid expects bold italic 12pt color 7030A0.")]},
    {"pid": "P05", "style": "AcceptanceLeaf", "num": None,
     "runs": [R("A05 AcceptanceLeaf expects bold italic underline 14pt color C00000.")]},
    # Run-level precedence: paragraph chain -> character style -> direct rPr
    {"pid": "P06", "style": "AcceptanceLeaf", "num": None,
     "runs": [R("A06R1 chain "),
              R("A06R2 charstyle ", rstyle=True),
              R("A06R3 direct", rstyle=True, b="1", color="FFC000", sz=32)]},
    # Known and unknown w:sym. Symbol font uses both hex forms on purpose:
    # plain (006C) and F0-prefixed private-use form (F0B7 == 00B7 glyph).
    {"pid": "P07", "style": None, "num": None,
     "runs": [R("SYM01 wingdings F0FC then "), SYM("Wingdings", "F0FC"),
              R(" then wingdings F0FB then "), SYM("Wingdings", "F0FB"),
              R(" then symbol 006C then "), SYM("Symbol", "006C"),
              R(" then symbol F0B7 then "), SYM("Symbol", "F0B7"),
              R(" then wingdings F0A7 then "), SYM("Wingdings", "F0A7"),
              R(" then unknown unmappedfont 0047 then "), SYM("UnmappedFont", "0047"),
              R(" then unknown bogussymbol 002A then "), SYM("BogusSymbol", "002A"),
              R(" SYM01 end")]},
    # Interleaved numId 10 (decimal) / numId 11 (upperLetter)
    {"pid": "P08", "style": "AcceptanceMid", "num": (10, 0),
     "runs": [R("C01 first decimal item")]},
    {"pid": "P09", "style": "AcceptanceMid", "num": (11, 0),
     "runs": [R("C02 first alpha interleave item")]},
    {"pid": "P10", "style": "AcceptanceMid", "num": (10, 0),
     "runs": [R("C03 second decimal item")]},
    {"pid": "P11", "style": "AcceptanceMid", "num": (11, 0),
     "runs": [R("C04 second alpha interleave item")]},
    {"pid": "P12", "style": "AcceptanceMid", "num": (10, 0),
     "runs": [R("C05 third decimal item before interruption")]},
    # Interruption: no numPr, breaks both running lists
    {"pid": "P13", "style": "AcceptanceLeaf", "num": None,
     "runs": [R("C06 interruption paragraph without list numbering.")]},
    # Both lists must CONTINUE (not restart) after the interruption
    {"pid": "P14", "style": "AcceptanceMid", "num": (10, 0),
     "runs": [R("C07 decimal resumes after interruption")]},
    {"pid": "P15", "style": "AcceptanceMid", "num": (11, 0),
     "runs": [R("C08 alpha resumes after interruption")]},
    {"pid": "P16", "style": None, "num": None,
     "runs": [R("MIDDLE marker paragraph M00 for middle inspection.")]},
    # Nesting: L0 5. -> L1 a. b. -> L2 i. -> L1 c. (continues, no reset)
    {"pid": "P17", "style": "AcceptanceMid", "num": (10, 0),
     "runs": [R("C09 parent item five")]},
    {"pid": "P18", "style": "AcceptanceMid", "num": (10, 1),
     "runs": [R("C10 first child under five")]},
    {"pid": "P19", "style": "AcceptanceMid", "num": (10, 1),
     "runs": [R("C11 second child under five")]},
    {"pid": "P20", "style": "AcceptanceMid", "num": (10, 2),
     "runs": [R("C12 grandchild under second child")]},
    {"pid": "P21", "style": "AcceptanceMid", "num": (10, 1),
     "runs": [R("C13 third child after grandchild")]},
    # New parent (L0 6.) -> L1 must RESET to a.
    {"pid": "P22", "style": "AcceptanceMid", "num": (10, 0),
     "runs": [R("C14 parent item six")]},
    {"pid": "P23", "style": "AcceptanceMid", "num": (10, 1),
     "runs": [R("C15 first child under six resets")]},
    {"pid": "P24", "style": "AcceptanceMid", "num": (10, 0),
     "runs": [R("C16 last parent item seven")]},
    {"pid": "P25", "style": "AcceptanceLeaf", "num": None,
     "runs": [R("Z01 final chain paragraph.")]},
    # Direct rPr on a Normal paragraph (overrides docDefaults color, adds bold)
    {"pid": "P26", "style": None, "num": None,
     "runs": [R("END marker paragraph Z02 with direct bold black.",
                b="1", color="000000")]},
]

# Expected symbol mapping, frozen INDEPENDENTLY of the importer from public
# font-encoding knowledge. Unknown entries are allowed loss.
SYM_PRIMARY = {
    ("Wingdings", "F0FC"): "\u2713",   # CHECK MARK, high confidence
    ("Wingdings", "F0FB"): "\u2717",   # BALLOT X, medium-high confidence
    ("Symbol", "006C"): "\u03BB",      # GREEK SMALL LAMBDA, high confidence
    ("Symbol", "F0B7"): "\u2022",      # BULLET; codepoint ambiguity U+2022/U+2219
    ("Wingdings", "F0A7"): "\u25AA",   # BLACK SMALL SQUARE, medium-high confidence
}

# Expected numbering marker sequence (independent simulation expectation)
EXPECT_MARKERS = [("P08", "1."), ("P09", "A."), ("P10", "2."), ("P11", "B."),
                  ("P12", "3."), ("P14", "4."), ("P15", "C."), ("P17", "5."),
                  ("P18", "a."), ("P19", "b."), ("P20", "i."), ("P21", "c."),
                  ("P22", "6."), ("P23", "a."), ("P24", "7.")]

# Expected resolved run formatting per paragraph/run (only keys that must exist)
EXPECT_RESOLVED = {
    "P01": {"color": "262626", "sz": "22"},
    "P02": {"color": "262626", "sz": "22"},
    "P03": {"color": "1F4E79", "sz": "24"},
    "P04": {"color": "7030A0", "sz": "24", "b": "1", "i": "1"},
    "P05": {"color": "C00000", "sz": "28", "b": "1", "i": "1", "u": "single"},
    "P06": [
        {"color": "C00000", "sz": "28", "b": "1", "i": "1", "u": "single"},
        {"color": "00B050", "sz": "26", "b": "0", "i": "1", "u": "single"},
        {"color": "FFC000", "sz": "32", "b": "1", "i": "1", "u": "single"},
    ],
    "P13": {"color": "C00000", "sz": "28", "b": "1", "i": "1", "u": "single"},
    "P25": {"color": "C00000", "sz": "28", "b": "1", "i": "1", "u": "single"},
    "P26": {"color": "000000", "sz": "22", "b": "1"},
}

DOC_DEFAULTS_RPR = {"color": "262626", "sz": "22"}
CHAR_STYLE_RPR = {"b": "0", "color": "00B050", "sz": "26"}

ZIP_ENTRIES = ["[Content_Types].xml", "_rels/.rels", "docProps/app.xml",
               "docProps/core.xml", "word/document.xml", "word/numbering.xml",
               "word/styles.xml", "word/_rels/document.xml.rels"]

# --------------------------------------------------------------------------
# XML emission
# --------------------------------------------------------------------------

NS_W = f'xmlns:w="{W}"'
NS_R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'


def emit_rpr(run):
    parts = []
    if run.get("rstyle"):
        parts.append('<w:rStyle w:val="AcceptanceChar"/>')
    if run.get("b") is not None:
        parts.append('<w:b/>' if run["b"] == "1" else '<w:b w:val="0"/>')
    if run.get("color"):
        parts.append(f'<w:color w:val="{run["color"]}"/>')
    if run.get("sz"):
        parts.append(f'<w:sz w:val="{run["sz"]}"/><w:szCs w:val="{run["sz"]}"/>')
    if not parts:
        return ""
    return "<w:rPr>" + "".join(parts) + "</w:rPr>"


def emit_para(p):
    lines = ["<w:p>"]
    ppr = []
    if p["style"]:
        ppr.append(f'    <w:pStyle w:val="{p["style"]}"/>')
    if p["num"]:
        num, ilvl = p["num"]
        ppr.append("    <w:numPr>")
        ppr.append(f'      <w:ilvl w:val="{ilvl}"/>')
        ppr.append(f'      <w:numId w:val="{num}"/>')
        ppr.append("    </w:numPr>")
    if ppr:
        lines.append("  <w:pPr>")
        lines.extend(ppr)
        lines.append("  </w:pPr>")
    for run in p["runs"]:
        rpr = emit_rpr(run)
        if run["kind"] == "t":
            inner = f'<w:t xml:space="preserve">{escape(run["text"])}</w:t>'
        else:
            inner = f'<w:sym w:font="{run["font"]}" w:char="{run["char"]}"/>'
        if rpr:
            lines.append(f"  <w:r>\n    {rpr}\n    {inner}\n  </w:r>")
        else:
            lines.append(f"  <w:r>\n    {inner}\n  </w:r>")
    lines.append("</w:p>")
    return "\n".join(lines)


def emit_document():
    out = [f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
           f'<w:document {NS_W} {NS_R}>',
           "<w:body>"]
    for p in PARAS:
        out.append(emit_para(p))
    out.append("  <w:sectPr>")
    out.append('    <w:pgSz w:w="11906" w:h="16838"/>')
    out.append('    <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" '
               'w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>')
    out.append('    <w:cols w:space="720"/>')
    out.append('    <w:docGrid w:linePitch="360"/>')
    out.append("  </w:sectPr>")
    out.append("</w:body>")
    out.append("</w:document>")
    return "\n".join(out) + "\n"


def emit_styles():
    out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
           f'<w:styles {NS_W}>',
           "<w:docDefaults>",
           "  <w:rPrDefault>",
           "    <w:rPr>",
           '      <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" '
           'w:eastAsia="Microsoft YaHei" w:cs="Calibri"/>',
           '      <w:color w:val="262626"/>',
           '      <w:sz w:val="22"/><w:szCs w:val="22"/>',
           "    </w:rPr>",
           "  </w:rPrDefault>",
           "  <w:pPrDefault>",
           "    <w:pPr>",
           '      <w:spacing w:after="120" w:line="276" w:lineRule="auto"/>',
           "    </w:pPr>",
           "  </w:pPrDefault>",
           "</w:docDefaults>",
           '<w:style w:type="paragraph" w:default="1" w:styleId="Normal">',
           '  <w:name w:val="Normal"/>',
           "</w:style>",
           # Base: 12pt, blue -> overrides docDefaults sz/color
           '<w:style w:type="paragraph" w:styleId="AcceptanceBase">',
           '  <w:name w:val="Acceptance Base"/>',
           '  <w:basedOn w:val="Normal"/>',
           "  <w:pPr>",
           '    <w:spacing w:after="80"/>',
           "  </w:pPr>",
           "  <w:rPr>",
           '    <w:color w:val="1F4E79"/>',
           '    <w:sz w:val="24"/><w:szCs w:val="24"/>',
           "  </w:rPr>",
           "</w:style>",
           # Mid: adds bold+italic+purple, inherits sz 24 from Base
           '<w:style w:type="paragraph" w:styleId="AcceptanceMid">',
           '  <w:name w:val="Acceptance Mid"/>',
           '  <w:basedOn w:val="AcceptanceBase"/>',
           "  <w:rPr>",
           "    <w:b/><w:bCs/><w:i/><w:iCs/>",
           '    <w:color w:val="7030A0"/>',
           "  </w:rPr>",
           "</w:style>",
           # Leaf: overrides color+size, adds underline; bold/italic inherited
           '<w:style w:type="paragraph" w:styleId="AcceptanceLeaf">',
           '  <w:name w:val="Acceptance Leaf"/>',
           '  <w:basedOn w:val="AcceptanceMid"/>',
           "  <w:rPr>",
           '    <w:color w:val="C00000"/>',
           '    <w:sz w:val="28"/><w:szCs w:val="28"/>',
           '    <w:u w:val="single"/>',
           "  </w:rPr>",
           "</w:style>",
           # Character style: turns bold OFF, green, 13pt
           '<w:style w:type="character" w:styleId="AcceptanceChar">',
           '  <w:name w:val="Acceptance Char"/>',
           "  <w:rPr>",
           '    <w:b w:val="0"/><w:bCs w:val="0"/>',
           '    <w:color w:val="00B050"/>',
           '    <w:sz w:val="26"/><w:szCs w:val="26"/>',
           "  </w:rPr>",
           "</w:style>",
           "</w:styles>"]
    return "\n".join(out) + "\n"


def emit_lvl(ilvl, num_fmt, lvl_text, left, hanging=None):
    ind = (f'<w:ind w:left="{left}" w:hanging="{hanging}"/>'
           if hanging else f'<w:ind w:left="{left}"/>')
    return ("    <w:lvl w:ilvl=\"%d\">\n"
            "      <w:start w:val=\"1\"/>\n"
            "      <w:numFmt w:val=\"%s\"/>\n"
            "      <w:lvlText w:val=\"%s\"/>\n"
            "      <w:lvlJc w:val=\"left\"/>\n"
            "      <w:pPr>%s</w:pPr>\n"
            "    </w:lvl>" % (ilvl, num_fmt, lvl_text, ind))


def emit_abstract(aid, name, level_specs, filler_from=3):
    out = [f'  <w:abstractNum w:abstractNumId="{aid}">',
           '    <w:multiLevelType w:val="multilevel"/>',
           f'    <w:name w:val="{name}"/>']
    for ilvl, fmt, text, left, hang in level_specs:
        out.append(emit_lvl(ilvl, fmt, text, left, hang))
    for ilvl in range(filler_from, 9):
        out.append(emit_lvl(ilvl, "decimal", "%%%d." % (ilvl + 1), 720 * (ilvl + 1)))
    out.append("  </w:abstractNum>")
    return "\n".join(out)


def emit_numbering():
    out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
           f'<w:numbering {NS_W}>']
    # abstractNum 100 -> numId 10: decimal / lowerLetter / lowerRoman
    out.append(emit_abstract(100, "Acceptance Decimal", [
        (0, "decimal", "%1.", 720, 360),
        (1, "lowerLetter", "%2.", 1440, 360),
        (2, "lowerRoman", "%3.", 2160, 360),
    ]))
    # abstractNum 101 -> numId 11: upperLetter top level
    out.append(emit_abstract(101, "Acceptance Alpha", [
        (0, "upperLetter", "%1.", 720, 360),
        (1, "lowerLetter", "%2.", 1440, 360),
        (2, "lowerRoman", "%3.", 2160, 360),
    ]))
    out.append('  <w:num w:numId="10">\n    <w:abstractNumId w:val="100"/>\n  </w:num>')
    out.append('  <w:num w:numId="11">\n    <w:abstractNumId w:val="101"/>\n  </w:num>')
    out.append("</w:numbering>")
    return "\n".join(out) + "\n"


def emit_content_types():
    return ("\n".join([
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
        '<Default Extension="xml" ContentType="application/xml"/>',
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
        '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>',
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
        '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
        '</Types>']) + "\n")


def emit_root_rels():
    return ("\n".join([
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>',
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>',
        '</Relationships>']) + "\n")


def emit_doc_rels():
    return ("\n".join([
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>',
        '</Relationships>']) + "\n")


def emit_core():
    return ("\n".join([
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
        '<dc:title>fix-import-fidelity acceptance complex sample</dc:title>',
        '<dc:creator>Next Story acceptance tooling (hand-built OOXML, Python stdlib)</dc:creator>',
        '<cp:lastModifiedBy>Next Story acceptance tooling</cp:lastModifiedBy>',
        '<dcterms:created xsi:type="dcterms:W3CDTF">2026-10-03T00:00:00Z</dcterms:created>',
        '<dcterms:modified xsi:type="dcterms:W3CDTF">2026-10-03T00:00:00Z</dcterms:modified>',
        '</cp:coreProperties>']) + "\n")


def emit_app():
    return ("\n".join([
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">',
        '<Application>Next Story acceptance generator (Python stdlib)</Application>',
        '</Properties>']) + "\n")


PARTS = {
    "[Content_Types].xml": emit_content_types(),
    "_rels/.rels": emit_root_rels(),
    "docProps/app.xml": emit_app(),
    "docProps/core.xml": emit_core(),
    "word/document.xml": emit_document(),
    "word/numbering.xml": emit_numbering(),
    "word/styles.xml": emit_styles(),
    "word/_rels/document.xml.rels": emit_doc_rels(),
}


def build_zip_bytes():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name in ZIP_ENTRIES:
            data = PARTS[name].encode("utf-8")
            info = zipfile.ZipInfo(name, date_time=ZIP_DATE)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o600 << 16
            info.create_system = 0
            zf.writestr(info, data)
    return buf.getvalue()


# --------------------------------------------------------------------------
# Independent verification (parses the file from disk, never the importer)
# --------------------------------------------------------------------------


def wtag(local):
    return f"{{{W}}}{local}"


def parse_rpr(rpr):
    out = {}
    if rpr is None:
        return out
    b = rpr.find(wtag("b"))
    if b is not None:
        out["b"] = b.get(wtag("val"), "1")
    i = rpr.find(wtag("i"))
    if i is not None:
        out["i"] = i.get(wtag("val"), "1")
    u = rpr.find(wtag("u"))
    if u is not None:
        out["u"] = u.get(wtag("val"), "single")
    c = rpr.find(wtag("color"))
    if c is not None:
        out["color"] = c.get(wtag("val"))
    sz = rpr.find(wtag("sz"))
    if sz is not None:
        out["sz"] = sz.get(wtag("val"))
    return out


def verify(path):
    failures = []

    def check(cond, msg):
        if not cond:
            failures.append(msg)
        return cond

    with open(path, "rb") as f:
        raw = f.read()
    sha = hashlib.sha256(raw).hexdigest()
    print(f"file: {path}")
    print(f"size: {len(raw)} bytes")
    print(f"sha256: {sha}")

    zf = zipfile.ZipFile(io.BytesIO(raw))
    check(zf.testzip() is None, "zip integrity test failed")
    check(zf.namelist() == ZIP_ENTRIES,
          f"entry list mismatch: {zf.namelist()}")
    for name in zf.namelist():
        zf.read(name).decode("utf-8")  # must decode
    print("entries (order, uncompressed, CRC32):")
    for info in zf.infolist():
        print(f"  {info.filename}  {info.file_size}B  crc={info.CRC:08X}")

    styles_root = ET.fromstring(zf.read("word/styles.xml"))
    doc_root = ET.fromstring(zf.read("word/document.xml"))
    num_root = ET.fromstring(zf.read("word/numbering.xml"))

    # ---- structure negatives: no elements outside declared coverage
    for bad in ("br", "tab", "tbl", "drawing", "hyperlink", "footnoteReference"):
        found = doc_root.findall(f".//{wtag(bad)}")
        check(not found, f"unexpected w:{bad} x{len(found)}")

    # ---- docDefaults + style chain resolution
    dd_rpr = styles_root.find(f"{wtag('docDefaults')}/{wtag('rPrDefault')}/{wtag('rPr')}")
    docdefaults = parse_rpr(dd_rpr)
    check(docdefaults == {"color": "262626", "sz": "22"},
          f"docDefaults rPr mismatch: {docdefaults}")
    dd_fonts = dd_rpr.find(wtag("rFonts"))
    check(dd_fonts.get(wtag("ascii")) == "Calibri"
          and dd_fonts.get(wtag("eastAsia")) == "Microsoft YaHei",
          "docDefaults rFonts mismatch")
    check(styles_root.find(f"{wtag('docDefaults')}/{wtag('pPrDefault')}") is not None,
          "missing pPrDefault")

    styles = {}
    for st in styles_root.findall(wtag("style")):
        sid = st.get(wtag("styleId"))
        based = st.find(wtag("basedOn"))
        styles[sid] = {
            "type": st.get(wtag("type")),
            "based": based.get(wtag("val")) if based is not None else None,
            "rpr": parse_rpr(st.find(wtag("rPr"))),
        }
    check(styles["AcceptanceBase"]["based"] == "Normal"
          and styles["AcceptanceMid"]["based"] == "AcceptanceBase"
          and styles["AcceptanceLeaf"]["based"] == "AcceptanceMid",
          "basedOn chain mismatch")
    check(styles["AcceptanceChar"]["type"] == "character",
          "AcceptanceChar is not a character style")

    def resolve_paragraph_style(sid):
        chain = []
        cur = sid if sid else "Normal"
        seen = set()
        while cur and cur not in seen:
            seen.add(cur)
            chain.append(cur)
            cur = styles.get(cur, {}).get("based")
        merged = dict(docdefaults)
        for s in reversed(chain):
            merged.update(styles.get(s, {}).get("rpr", {}))
        return merged

    # ---- paragraphs / runs vs frozen table
    body = doc_root.find(wtag("body"))
    paras = body.findall(wtag("p"))
    check(len(paras) == len(PARAS),
          f"paragraph count {len(paras)} != {len(PARAS)}")
    total_runs = 0
    sym_seen = []
    doc_paragraphs = []
    for idx, (xml_p, spec) in enumerate(zip(paras, PARAS)):
        pid = spec["pid"]
        ppr = xml_p.find(wtag("pPr"))
        style = ppr.find(wtag("pStyle")).get(wtag("val")) if (
            ppr is not None and ppr.find(wtag("pStyle")) is not None) else None
        numpr = ppr.find(wtag("numPr")) if ppr is not None else None
        num = None
        if numpr is not None:
            num = (int(numpr.find(wtag("numId")).get(wtag("val"))),
                   int(numpr.find(wtag("ilvl")).get(wtag("val"))))
        check(style == spec["style"], f"{pid} pStyle {style} != {spec['style']}")
        check(num == spec["num"], f"{pid} numPr {num} != {spec['num']}")
        runs = xml_p.findall(wtag("r"))
        check(len(runs) == len(spec["runs"]),
              f"{pid} run count {len(runs)} != {len(spec['runs'])}")
        total_runs += len(runs)
        doc_paragraphs.append({"pid": pid, "num": num, "runs": []})
        for r_idx, (xml_r, run_spec) in enumerate(zip(runs, spec["runs"])):
            if run_spec["kind"] == "t":
                t = xml_r.find(wtag("t"))
                ok = check(t is not None and t.text == run_spec["text"],
                           f"{pid} run{r_idx} text {t.text if t is not None else None!r}"
                           f" != {run_spec['text']!r}")
                doc_paragraphs[-1]["runs"].append(("t", run_spec["text"]))
            else:
                s = xml_r.find(wtag("sym"))
                check(s is not None
                      and s.get(wtag("font")) == run_spec["font"]
                      and s.get(wtag("char")) == run_spec["char"],
                      f"{pid} run{r_idx} sym mismatch: "
                      f"{s.attrib if s is not None else None}")
                sym_seen.append((run_spec["font"], run_spec["char"]))
                doc_paragraphs[-1]["runs"].append(
                    ("sym", run_spec["font"], run_spec["char"]))
            # direct rPr must round-trip
            rstyle = xml_r.find(f"{wtag('rPr')}/{wtag('rStyle')}")
            has_rstyle = rstyle is not None
            expected_rstyle = bool(run_spec.get("rstyle"))
            check(has_rstyle == expected_rstyle,
                  f"{pid} run{r_idx} rStyle {has_rstyle} != {expected_rstyle}")
            direct = parse_rpr(xml_r.find(wtag("rPr")))
            if run_spec.get("b") is None:
                direct.pop("b", None)
            if run_spec.get("color"):
                check(direct.get("color") == run_spec["color"],
                      f"{pid} run{r_idx} direct color mismatch")
            if run_spec.get("sz"):
                check(direct.get("sz") == str(run_spec["sz"]),
                      f"{pid} run{r_idx} direct sz mismatch")
            if run_spec.get("b") is not None:
                check(direct.get("b") == run_spec["b"],
                      f"{pid} run{r_idx} direct b mismatch")
            # resolved formatting expectation
            resolved = resolve_paragraph_style(style)
            if has_rstyle:
                resolved.update(styles["AcceptanceChar"]["rpr"])
            if run_spec.get("color"):
                resolved["color"] = run_spec["color"]
            if run_spec.get("sz"):
                resolved["sz"] = str(run_spec["sz"])
            if run_spec.get("b") is not None:
                resolved["b"] = run_spec["b"]
            if pid in ("P06",):
                exp = EXPECT_RESOLVED[pid][r_idx]
            elif pid in EXPECT_RESOLVED:
                exp = EXPECT_RESOLVED[pid]
            else:
                exp = None
            if exp is not None:
                check(resolved == exp,
                      f"{pid} run{r_idx} resolved {resolved} != {exp}")

    print(f"paragraphs: {len(paras)}  runs: {total_runs}  syms: {len(sym_seen)}")
    check(len(sym_seen) == 7, f"sym count {len(sym_seen)} != 7")
    print("sym sequence:", " ".join(f"{f}/{c}" for f, c in sym_seen))

    # ---- independent numbering simulation (frozen rule, not importer):
    # per numId counters; using level L resets counters of levels > L in the
    # same num instance; same level continues across interruptions and
    # interleaved use of other numIds.
    fmts = {}
    for an in num_root.findall(wtag("abstractNum")):
        aid = an.get(wtag("abstractNumId"))
        for lvl in an.findall(wtag("lvl")):
            fmts[(aid, lvl.get(wtag("ilvl")))] = (
                lvl.find(wtag("numFmt")).get(wtag("val")),
                lvl.find(wtag("lvlText")).get(wtag("val")))
    num2abs = {}
    for n in num_root.findall(wtag("num")):
        num2abs[n.get(wtag("numId"))] = n.find(wtag("abstractNumId")).get(wtag("val"))
    check(num2abs == {"10": "100", "11": "101"}, f"num->abstract map {num2abs}")

    def roman(n):
        vals = [(10, "x"), (9, "ix"), (5, "v"), (4, "iv"), (1, "i")]
        out = ""
        for v, s in vals:
            while n >= v:
                out += s
                n -= v
        return out

    def fmt_marker(aid, ilvl, n):
        fmt, text = fmts[(aid, str(ilvl))]
        if fmt == "decimal":
            s = str(n)
        elif fmt == "lowerLetter":
            s = chr(ord("a") + n - 1)
        elif fmt == "upperLetter":
            s = chr(ord("A") + n - 1)
        elif fmt == "lowerRoman":
            s = roman(n)
        else:
            s = f"?{fmt}?{n}"
        return text.replace(f"%{ilvl + 1}", s)

    counters = {}
    simulated = []
    for p in doc_paragraphs:
        if p["num"] is None:
            continue
        num, ilvl = p["num"]
        state = counters.setdefault(str(num), {})
        for il in list(state.keys()):
            if int(il) > ilvl:
                state[il] = 0
        state[str(ilvl)] = state.get(str(ilvl), 0) + 1
        simulated.append((p["pid"], fmt_marker(num2abs[str(num)], ilvl, state[str(ilvl)])))
    check(simulated == EXPECT_MARKERS,
          f"numbering simulation mismatch:\n  got      {simulated}\n  expected {EXPECT_MARKERS}")
    print("numbering markers:", " ".join(f"{pid}={m}" for pid, m in simulated))

    # ---- expected stored text (primary mappings, unknown syms dropped)
    print("\nexpected stored text per paragraph (primary symbol mapping, unknowns dropped):")
    total_len = 0
    for p in doc_paragraphs:
        parts = []
        for run in p["runs"]:
            if run[0] == "t":
                parts.append(run[1])
            else:
                mapped = SYM_PRIMARY.get((run[1], run[2]))
                if mapped is not None:
                    parts.append(mapped)
        text = "".join(parts)
        total_len += len(text)
        print(f"  {p['pid']}: {text}")
    print(f"total stored characters (primary mapping, unknowns dropped): {total_len}")

    if failures:
        print(f"\nVERIFY FAILED ({len(failures)}):")
        for msg in failures:
            print(f"  - {msg}")
        return 1, sha
    print("\nVERIFY PASSED: all frozen expectations match the built file.")
    return 0, sha


def main():
    verify_only = "--verify-only" in sys.argv
    if not verify_only:
        import os
        data = build_zip_bytes()
        with open(DOCX_PATH, "wb") as f:
            f.write(data)
        print(f"wrote {DOCX_PATH} ({len(data)} bytes)")
        # determinism: rebuild and compare
        check_again = build_zip_bytes()
        assert check_again == data, "non-deterministic build"
        print("determinism: rebuild produced identical bytes")
    code, sha = verify(DOCX_PATH)
    with open(__file__, "rb") as f:
        print(f"generator sha256: {hashlib.sha256(f.read()).hexdigest()}")
    sys.exit(code)


if __name__ == "__main__":
    main()
