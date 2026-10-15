#!/usr/bin/env python3
"""Fabrique les six modèles de document du format théâtre à partir des modèles
Word et OpenDocument du prototype (src-tauri/resources/reference.*) :
manuscrit, édition A4 et édition A5, chacun en .docx et en .odt.

Chaque modèle définit les styles nommés que l'export d'une pièce applique
(voir src/theatre-pandoc.ts), la police, le corps, la taille de la page, les
marges et le numéro de page en bas, au centre.
"""

import pathlib
import re
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
RESOURCES = ROOT / "src-tauri" / "resources"

# EB Garamond, telle que la fournit fonts.bunny.net, n'a pas de vraies
# petites capitales : à l'édition, les noms sont en capitales de corps réduit.
MODELS = {
    "manuscrit": {"font": "Courier Prime", "pitch": "fixed", "size": 12, "page": (21.0, 29.7), "margin": 2.5, "reduced": False},
    "edition-a4": {"font": "EB Garamond", "pitch": "variable", "size": 12, "page": (21.0, 29.7), "margin": 2.5, "reduced": True},
    "edition-a5": {"font": "EB Garamond", "pitch": "variable", "size": 11, "page": (14.8, 21.0), "margin": 2.0, "reduced": True},
}


def twips(cm: float) -> int:
    return round(cm * 1440 / 2.54)


def cm(value: float) -> str:
    return f"{value:g}cm"


# --- Word ---------------------------------------------------------------------

def docx_paragraph(keep=False, page=False, before=0, after=0, left=0.0, right=0.0, center=False) -> str:
    # Les éléments dans l'ordre qu'impose le schéma de Word.
    parts = []
    if keep:
        parts.append("<w:keepNext/>")
    if page:
        parts.append("<w:pageBreakBefore/>")
    parts.append(f'<w:spacing w:before="{before}" w:after="{after}"/>')
    if left or right:
        parts.append(f'<w:ind w:left="{twips(left)}" w:right="{twips(right)}"/>')
    if center:
        parts.append('<w:jc w:val="center"/>')
    return "<w:pPr>" + "".join(parts) + "</w:pPr>"


def docx_run(bold=False, italic=False, caps=False, size=None) -> str:
    parts = []
    if bold:
        parts.append("<w:b/><w:bCs/>")
    if italic:
        parts.append("<w:i/><w:iCs/>")
    if caps:
        parts.append("<w:caps/>")
    if size:
        parts.append(f'<w:sz w:val="{size * 2}"/><w:szCs w:val="{size * 2}"/>')
    return "<w:rPr>" + "".join(parts) + "</w:rPr>"


def docx_styles(model: dict) -> str:
    reduced = model["size"] - 2 if model["reduced"] else None
    definitions = {
        "Acte": (docx_paragraph(keep=True, page=True, after=480, center=True), docx_run(bold=True)),
        "Scene": (docx_paragraph(keep=True, before=360, after=240, center=True), docx_run(bold=True)),
        "Personnages": (docx_paragraph(keep=True, after=360, center=True), docx_run(bold=True)),
        "Distribution": (docx_paragraph(after=120), docx_run()),
        "Personnage": (docx_paragraph(keep=True, before=240, center=True), docx_run(caps=model["reduced"], size=reduced)),
        "Replique": (docx_paragraph(after=120), docx_run()),
        "Didascalie": (docx_paragraph(before=60, after=120, left=2.0, right=1.0), docx_run(italic=True)),
        "Texte": (docx_paragraph(after=120), docx_run()),
    }
    return "".join(
        f'<w:style w:type="paragraph" w:customStyle="1" w:styleId="{name}"><w:name w:val="{name}"/>'
        f'<w:basedOn w:val="Normal"/><w:qFormat/>{ppr}{rpr}</w:style>'
        for name, (ppr, rpr) in definitions.items()
    )


FOOTER = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>'
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r>'
    '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>'
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
    "<w:r><w:t>1</w:t></w:r>"
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>'
    "</w:p></w:ftr>"
)


def docx_part(name: str, xml: str, model: dict) -> str:
    font = model["font"]
    if name == "word/styles.xml":
        defaults = re.search(r"<w:docDefaults>.*?</w:docDefaults>", xml, re.S)
        block = re.sub(r"<w:rFonts [^>]*/>", f'<w:rFonts w:ascii="{font}" w:hAnsi="{font}" w:eastAsia="{font}" w:cs="{font}" />', defaults.group(0), count=1)
        block = re.sub(r'<w:sz w:val="\d+"\s*/>', f'<w:sz w:val="{model["size"] * 2}" />', block, count=1)
        block = re.sub(r'<w:szCs w:val="\d+"\s*/>', f'<w:szCs w:val="{model["size"] * 2}" />', block, count=1)
        block = block.replace('<w:lang w:val="en-US"', '<w:lang w:val="fr-FR"', 1)
        xml = xml[: defaults.start()] + block + xml[defaults.end():]
        return xml.replace("</w:styles>", docx_styles(model) + "</w:styles>")
    if name == "word/document.xml":
        width, height = model["page"]
        margin = twips(model["margin"])
        section = (
            '<w:sectPr><w:footerReference w:type="default" r:id="rIdTheatreFooter"/>'
            f'<w:pgSz w:w="{twips(width)}" w:h="{twips(height)}"/>'
            f'<w:pgMar w:top="{margin}" w:right="{margin}" w:bottom="{margin}" w:left="{margin}" w:header="708" w:footer="708" w:gutter="0"/>'
            "</w:sectPr>"
        )
        return re.sub(r"<w:sectPr>.*?</w:sectPr>", section, xml, count=1, flags=re.S)
    if name == "word/_rels/document.xml.rels":
        return xml.replace(
            "</Relationships>",
            '<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Id="rIdTheatreFooter" Target="footer1.xml" /></Relationships>',
        )
    if name == "[Content_Types].xml":
        return xml.replace(
            "</Types>",
            '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>',
        )
    return xml


# --- OpenDocument -------------------------------------------------------------

def odt_style(name: str, paragraph: str, text: str) -> str:
    return (
        f'<style:style style:name="{name}" style:display-name="{name}" style:family="paragraph" style:parent-style-name="Standard">'
        f"<style:paragraph-properties {paragraph} /><style:text-properties {text} /></style:style>"
    )


def odt_styles(model: dict) -> str:
    keep = 'fo:keep-with-next="always"'
    reduced = f'fo:text-transform="uppercase" fo:font-size="{model["size"] - 2}pt"' if model["reduced"] else ""
    return "".join([
        odt_style("Acte", f'fo:break-before="page" fo:text-align="center" fo:margin-top="0cm" fo:margin-bottom="0.85cm" {keep}', 'fo:font-weight="bold"'),
        odt_style("Scene", f'fo:text-align="center" fo:margin-top="0.63cm" fo:margin-bottom="0.42cm" {keep}', 'fo:font-weight="bold"'),
        odt_style("Personnages", f'fo:text-align="center" fo:margin-top="0cm" fo:margin-bottom="0.63cm" {keep}', 'fo:font-weight="bold"'),
        odt_style("Distribution", 'fo:margin-top="0cm" fo:margin-bottom="0.21cm"', ""),
        odt_style("Personnage", f'fo:text-align="center" fo:margin-top="0.42cm" fo:margin-bottom="0cm" {keep}', reduced),
        odt_style("Replique", 'fo:margin-top="0cm" fo:margin-bottom="0.21cm"', ""),
        odt_style("Didascalie", 'fo:margin-left="2cm" fo:margin-right="1cm" fo:margin-top="0.1cm" fo:margin-bottom="0.21cm"', 'fo:font-style="italic"'),
        odt_style("Texte", 'fo:margin-top="0cm" fo:margin-bottom="0.21cm"', ""),
    ])


def odt_styles_xml(xml: str, model: dict) -> str:
    font = model["font"]
    xml = xml.replace(
        "<office:font-face-decls>",
        f'<office:font-face-decls><style:font-face style:name="{font}" svg:font-family="\'{font}\'" '
        f'style:font-family-generic="roman" style:font-pitch="{model["pitch"]}" />',
        1,
    )
    default = re.search(r'<style:default-style style:family="paragraph">.*?</style:default-style>', xml, re.S)
    block = (
        default.group(0)
        .replace('style:font-name="Literata"', f'style:font-name="{font}"')
        .replace('fo:font-size="12pt"', f'fo:font-size="{model["size"]}pt"')
        .replace('fo:language="en" fo:country="US"', 'fo:language="fr" fo:country="FR"')
    )
    xml = xml[: default.start()] + block + xml[default.end():]
    page = re.search(r"<style:page-layout-properties [^>]*>", xml)
    tag = page.group(0)
    width, height = model["page"]
    for name, value in (
        ("fo:page-width", cm(width)),
        ("fo:page-height", cm(height)),
        ("fo:margin-top", cm(model["margin"])),
        ("fo:margin-bottom", cm(model["margin"])),
        ("fo:margin-left", cm(model["margin"])),
        ("fo:margin-right", cm(model["margin"])),
    ):
        tag = re.sub(rf'{name}="[^"]*"', f'{name}="{value}"', tag)
    xml = xml[: page.start()] + tag + xml[page.end():]
    return xml.replace("</office:styles>", odt_styles(model) + "</office:styles>", 1)


DOCX_PARTS = {"word/styles.xml", "word/document.xml", "word/_rels/document.xml.rels", "[Content_Types].xml"}


def main() -> None:
    for name, model in MODELS.items():
        docx = RESOURCES / f"theatre-{name}.docx"
        with zipfile.ZipFile(RESOURCES / "reference.docx") as archive, zipfile.ZipFile(docx, "w", zipfile.ZIP_DEFLATED) as out:
            for info in archive.infolist():
                data = archive.read(info.filename)
                if info.filename in DOCX_PARTS:
                    data = docx_part(info.filename, data.decode("utf-8"), model).encode("utf-8")
                out.writestr(info, data)
            out.writestr("word/footer1.xml", FOOTER)
        odt = RESOURCES / f"theatre-{name}.odt"
        # Le fichier « mimetype » reste le premier, non compressé : chaque
        # entrée garde sa place et sa méthode de compression.
        with zipfile.ZipFile(RESOURCES / "reference.odt") as archive, zipfile.ZipFile(odt, "w") as out:
            for info in archive.infolist():
                data = archive.read(info.filename)
                if info.filename == "styles.xml":
                    data = odt_styles_xml(data.decode("utf-8"), model).encode("utf-8")
                out.writestr(info, data)
        print(docx.name, odt.name)


if __name__ == "__main__":
    main()
