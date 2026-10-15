use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::menu::{CheckMenuItemBuilder, Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, WebviewWindow, Wry};

// Fichiers nécessaires à l'export, embarqués dans l'exécutable : les modèles
// Word et OpenDocument réglés sur Literata, en A4 avec des marges de 2,5 cm,
// la police elle-même pour le PDF, et Courier Prime pour la couverture et le
// PDF d'un scénario.
const RESOURCES: [(&str, &[u8]); 10] = [
    ("reference.docx", include_bytes!("../resources/reference.docx")),
    ("reference.odt", include_bytes!("../resources/reference.odt")),
    (
        "fonts/Literata-Regular.ttf",
        include_bytes!("../resources/fonts/Literata-Regular.ttf"),
    ),
    (
        "fonts/Literata-Italic.ttf",
        include_bytes!("../resources/fonts/Literata-Italic.ttf"),
    ),
    (
        "fonts/Literata-Bold.ttf",
        include_bytes!("../resources/fonts/Literata-Bold.ttf"),
    ),
    (
        "fonts/Literata-BoldItalic.ttf",
        include_bytes!("../resources/fonts/Literata-BoldItalic.ttf"),
    ),
    (
        "fonts/CourierPrime-Regular.ttf",
        include_bytes!("../resources/fonts/CourierPrime-Regular.ttf"),
    ),
    (
        "fonts/CourierPrime-Bold.ttf",
        include_bytes!("../resources/fonts/CourierPrime-Bold.ttf"),
    ),
    (
        "fonts/CourierPrime-Italic.ttf",
        include_bytes!("../resources/fonts/CourierPrime-Italic.ttf"),
    ),
    (
        "fonts/CourierPrime-BoldItalic.ttf",
        include_bytes!("../resources/fonts/CourierPrime-BoldItalic.ttf"),
    ),
];

/// Copie les fichiers embarqués dans un dossier temporaire, où Pandoc peut les lire.
fn resources_dir() -> Result<PathBuf, String> {
    let dir = std::env::temp_dir().join(concat!("schreibdrang-prototype-", env!("CARGO_PKG_VERSION")));
    fs::create_dir_all(dir.join("fonts")).map_err(|e| e.to_string())?;
    for (name, bytes) in RESOURCES {
        fs::write(dir.join(name), bytes).map_err(|e| e.to_string())?;
    }
    Ok(dir)
}

fn run_pandoc(markdown: &str, output: &Path, args: &[String]) -> Result<(), String> {
    let mut child = Command::new("pandoc")
        // « -smart » : le texte est exporté tel qu'il a été saisi, sans
        // remplacement automatique des apostrophes ou des tirets.
        .args(["--from", "markdown-smart", "--output"])
        .arg(output)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Pandoc est introuvable sur ce système ({e})."))?;

    child
        .stdin
        .take()
        .expect("stdin is piped")
        .write_all(markdown.as_bytes())
        .map_err(|e| e.to_string())?;

    let result = child.wait_with_output().map_err(|e| e.to_string())?;
    if result.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&result.stderr).trim().to_string())
    }
}

/// Mise en page d'un texte vanilla : l'interligne, en nombre de lignes, et les
/// quatre marges, en centimètres.
#[derive(serde::Deserialize, Clone, Copy)]
struct Layout {
    spacing: f64,
    top: f64,
    bottom: f64,
    left: f64,
    right: f64,
}

/// Un nombre au dixième, sans zéro inutile : « 2.5 », « 3 ».
fn tenths(value: f64) -> String {
    let text = format!("{value:.1}");
    text.strip_suffix(".0").unwrap_or(&text).to_string()
}

/// Les variables de Pandoc qui donnent au PDF ses marges et son interligne.
fn pdf_layout(layout: Option<Layout>) -> Vec<String> {
    match layout {
        None => vec!["geometry:margin=2.5cm".to_string()],
        Some(layout) => vec![
            format!(
                "geometry:top={}cm,bottom={}cm,left={}cm,right={}cm",
                tenths(layout.top),
                tenths(layout.bottom),
                tenths(layout.left),
                tenths(layout.right)
            ),
            format!("linestretch={}", tenths(layout.spacing)),
        ],
    }
}

/// Une longueur en vingtièmes de point, l'unité de Word.
fn twips(cm: f64) -> i64 {
    (cm * 1440.0 / 2.54).round() as i64
}

/// Insère ce texte juste après le premier `anchor` qui suit `after`.
fn insert_after(xml: &str, after: &str, anchor: &str, text: &str) -> Result<String, String> {
    let from = xml.find(after).ok_or_else(|| format!("Modèle de document inattendu : « {after} » est introuvable."))?;
    let at = xml[from..]
        .find(anchor)
        .ok_or_else(|| format!("Modèle de document inattendu : « {anchor} » est introuvable."))?
        + from
        + anchor.len();
    Ok(format!("{}{}{}", &xml[..at], text, &xml[at..]))
}

/// Remplace la valeur d'un attribut, dans la balise qui commence à `from`.
fn set_attribute(xml: &mut String, from: usize, name: &str, value: &str) -> Result<(), String> {
    let missing = || format!("Modèle de document inattendu : « {name} » est introuvable.");
    let end = xml[from..].find('>').ok_or_else(missing)? + from;
    let start = xml[from..end].find(&format!("{name}=\"")).ok_or_else(missing)? + from + name.len() + 2;
    let stop = xml[start..].find('"').ok_or_else(missing)? + start;
    xml.replace_range(start..stop, value);
    Ok(())
}

/// Le corps du modèle Word, avec les marges : la feuille est déjà en A4.
fn docx_document(xml: &str, layout: Layout) -> Result<String, String> {
    let mut xml = xml.to_string();
    let margins = xml.find("<w:pgMar ").ok_or("Modèle Word inattendu : les marges sont introuvables.")?;
    for (name, cm) in [("w:top", layout.top), ("w:right", layout.right), ("w:bottom", layout.bottom), ("w:left", layout.left)] {
        set_attribute(&mut xml, margins, name, &twips(cm).to_string())?;
    }
    Ok(xml)
}

/// Les styles du modèle Word, avec l'interligne : 240 pour une ligne.
fn docx_styles(xml: &str, layout: Layout) -> Result<String, String> {
    let line = (layout.spacing * 240.0).round() as i64;
    insert_after(xml, "<w:pPrDefault>", "<w:spacing ", &format!(r#"w:line="{line}" w:lineRule="auto" "#))
}

/// Les styles du modèle OpenDocument, avec une feuille A4, ses marges et
/// l'interligne.
fn odt_styles(xml: &str, layout: Layout) -> Result<String, String> {
    let mut xml = insert_after(
        xml,
        r#"<style:default-style style:family="paragraph">"#,
        "<style:paragraph-properties ",
        &format!(r#"fo:line-height="{}%" "#, (layout.spacing * 100.0).round() as i64),
    )?;
    let page = xml
        .find("<style:page-layout-properties ")
        .ok_or("Modèle OpenDocument inattendu : la page est introuvable.")?;
    let cm = |value: f64| format!("{}cm", tenths(value));
    for (name, value) in [
        ("fo:page-width", "21cm".to_string()),
        ("fo:page-height", "29.7cm".to_string()),
        ("fo:margin-top", cm(layout.top)),
        ("fo:margin-bottom", cm(layout.bottom)),
        ("fo:margin-left", cm(layout.left)),
        ("fo:margin-right", cm(layout.right)),
    ] {
        set_attribute(&mut xml, page, name, &value)?;
    }
    Ok(xml)
}

/// Copie un modèle Word ou OpenDocument en lui donnant cette mise en page. Les
/// autres fichiers de l'archive sont repris tels quels, dans le même ordre.
fn reference_with_layout(source: &Path, target: &Path, layout: Layout) -> Result<(), String> {
    let text = |e: zip::result::ZipError| e.to_string();
    let mut archive = zip::ZipArchive::new(fs::File::open(source).map_err(|e| e.to_string())?).map_err(text)?;
    let mut writer = zip::ZipWriter::new(fs::File::create(target).map_err(|e| e.to_string())?);
    for index in 0..archive.len() {
        let name = archive.by_index_raw(index).map_err(text)?.name().to_string();
        let patch: Option<fn(&str, Layout) -> Result<String, String>> = match name.as_str() {
            "word/document.xml" => Some(docx_document),
            "word/styles.xml" => Some(docx_styles),
            "styles.xml" => Some(odt_styles),
            _ => None,
        };
        match patch {
            Some(patch) => {
                let mut xml = String::new();
                std::io::Read::read_to_string(&mut archive.by_index(index).map_err(text)?, &mut xml).map_err(|e| e.to_string())?;
                writer
                    .start_file(name, zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated))
                    .map_err(text)?;
                writer.write_all(patch(&xml, layout)?.as_bytes()).map_err(|e| e.to_string())?;
            }
            None => writer.raw_copy_file(archive.by_index_raw(index).map_err(text)?).map_err(text)?,
        }
    }
    writer.finish().map_err(text)?;
    Ok(())
}

fn export(path: &Path, format: &str, markdown: &str, layout: Option<Layout>) -> Result<(), String> {
    let resources = resources_dir()?;
    // Le modèle de document : celui de l'app, ou sa copie à la mise en page
    // d'un texte vanilla.
    let reference = |name: &str| -> Result<String, String> {
        let model = resources.join(name);
        let Some(layout) = layout else {
            return Ok(format!("--reference-doc={}", model.display()));
        };
        let copy = resources.join(format!("mise-en-page-{name}"));
        reference_with_layout(&model, &copy, layout)?;
        Ok(format!("--reference-doc={}", copy.display()))
    };

    match format {
        // Markdown et Fountain : le texte est écrit tel quel.
        "md" | "fountain" => fs::write(path, markdown).map_err(|e| e.to_string()),
        "txt" => run_pandoc(
            markdown,
            path,
            &["--to=plain".into(), "--wrap=none".into()],
        ),
        "docx" => run_pandoc(markdown, path, &[reference("reference.docx")?]),
        "odt" => run_pandoc(markdown, path, &[reference("reference.odt")?]),
        "pdf" => {
            let mut variables = vec![
                "documentclass=report".to_string(),
                "lang=fr".to_string(),
                "papersize=a4".to_string(),
                "fontsize=11pt".to_string(),
                "mainfont=Literata-Regular.ttf".to_string(),
                format!("mainfontoptions=Path={}/", resources.join("fonts").display()),
                "mainfontoptions=BoldFont=Literata-Bold.ttf".to_string(),
                "mainfontoptions=ItalicFont=Literata-Italic.ttf".to_string(),
                "mainfontoptions=BoldItalicFont=Literata-BoldItalic.ttf".to_string(),
            ];
            variables.extend(pdf_layout(layout));
            let mut args = vec![
                "--pdf-engine=xelatex".to_string(),
                "--top-level-division=chapter".to_string(),
            ];
            for variable in variables {
                args.push("--variable".to_string());
                args.push(variable);
            }
            run_pandoc(markdown, path, &args)
        }
        "epub" => {
            // Un EPUB exige un titre : c'est le nom du fichier exporté. Chaque
            // chapitre (titre de niveau 1) y forme un fichier distinct.
            let title = path
                .file_stem()
                .map(|stem| stem.to_string_lossy().into_owned())
                .unwrap_or_else(|| "Sans titre".to_string());
            run_pandoc(
                markdown,
                path,
                &[
                    "--to=epub3".to_string(),
                    "--metadata".to_string(),
                    format!("title={title}"),
                    "--metadata".to_string(),
                    "lang=fr".to_string(),
                ],
            )
        }
        other => Err(format!("Format d'export inconnu : {other}")),
    }
}

// Filtre Pandoc de l'import : les images sont retirées, et avec elles les
// paragraphes qu'elles laissent vides.
const IMPORT_FILTER: &str = "function Image() return {} end\nfunction Para(el) if #el.content == 0 then return {} end end\n";

/// Convertit un document Word (.docx) ou OpenDocument (.odt) en Markdown : les
/// titres, l'italique, le gras et les notes sont gardés ; la mise en forme
/// propre au traitement de texte est abandonnée. Le document n'est pas modifié.
fn import(path: &Path) -> Result<String, String> {
    let filter = resources_dir()?.join("import.lua");
    fs::write(&filter, IMPORT_FILTER).map_err(|e| e.to_string())?;
    let result = Command::new("pandoc")
        .arg(path)
        .args([
            // Du Markdown sans attributs ni balises, et sans remplacement des
            // apostrophes ou des tirets : le texte est repris tel qu'il a été saisi.
            "--to=markdown-smart-bracketed_spans-native_spans-native_divs-fenced_divs-raw_html-raw_attribute-header_attributes-link_attributes-fenced_code_attributes",
            "--wrap=none",
            "--markdown-headings=atx",
        ])
        .arg(format!("--lua-filter={}", filter.display()))
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("Pandoc est introuvable sur ce système ({e})."))?;
    if result.status.success() {
        String::from_utf8(result.stdout).map_err(|e| e.to_string())
    } else {
        Err(String::from_utf8_lossy(&result.stderr).trim().to_string())
    }
}

#[tauri::command]
async fn import_document(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || import(Path::new(&path)))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn export_document(path: String, format: String, markdown: String, layout: Option<Layout>) -> Result<(), String> {
    // La conversion peut durer plusieurs dizaines de secondes : elle tourne
    // hors du fil principal pour ne pas figer l'interface.
    tauri::async_runtime::spawn_blocking(move || export(Path::new(&path), &format, &markdown, layout))
        .await
        .map_err(|e| e.to_string())?
}

/// Un auteur du scénario et ses coordonnées. L'agent est facultatif : ses
/// champs sont vides s'il n'y en a pas.
#[derive(serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Author {
    name: String,
    email: String,
    phone: String,
    agent_first_name: String,
    agent_last_name: String,
    agency: String,
    agency_email: String,
    agency_phone: String,
}

/// Contenu de la page de couverture d'un scénario, écrit par un ou plusieurs
/// auteurs.
#[derive(serde::Deserialize)]
struct Cover {
    title: String,
    /// Œuvre dont le scénario est l'adaptation ; vide s'il n'y en a pas.
    #[serde(default)]
    source: String,
    authors: Vec<Author>,
}

/// « A », « A et B », « A, B et C ».
fn join_names(names: &[String]) -> String {
    match names {
        [] => String::new(),
        [only] => only.clone(),
        [first @ .., last] => format!("{} et {}", first.join(", "), last),
    }
}

/// Rend un texte saisi inoffensif pour LaTeX : il est composé tel quel.
fn latex_escape(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    for character in text.chars() {
        match character {
            '\\' => escaped.push_str(r"\textbackslash{}"),
            '~' => escaped.push_str(r"\textasciitilde{}"),
            '^' => escaped.push_str(r"\textasciicircum{}"),
            '{' | '}' | '$' | '&' | '#' | '_' | '%' => {
                escaped.push('\\');
                escaped.push(character);
            }
            '\n' | '\r' | '\t' => escaped.push(' '),
            other => escaped.push(other),
        }
    }
    escaped
}

/// Marges de la couverture.
const COVER_GEOMETRY: &str = "left=3.8cm,right=2.5cm,top=2.5cm,bottom=2.5cm";

/// Début d'un document en Courier Prime corps 12, sur une page A4.
fn courier_preamble(geometry: &str, fonts: &Path) -> String {
    format!(
        r"\documentclass[12pt,a4paper]{{article}}
\usepackage{{fontspec}}
\usepackage[a4paper,{geometry}]{{geometry}}
\setmonofont{{CourierPrime-Regular.ttf}}[Path={fonts}/,BoldFont=CourierPrime-Bold.ttf,ItalicFont=CourierPrime-Italic.ttf,BoldItalicFont=CourierPrime-BoldItalic.ttf]
\renewcommand{{\familydefault}}{{\ttdefault}}
\pagestyle{{empty}}
\setlength{{\parindent}}{{0pt}}
\hyphenpenalty=10000
",
        fonts = fonts.display(),
    )
}

/// Source LaTeX de la couverture, selon la page de titre habituelle d'un
/// scénario : Courier Prime corps 12, titre en capitales centré dans le haut
/// de la page, coordonnées en bas à gauche.
fn cover_tex(cover: &Cover, fonts: &Path) -> String {
    format!(
        "{}\\begin{{document}}\n{}\\end{{document}}\n",
        courier_preamble(COVER_GEOMETRY, fonts),
        cover_body(cover)
    )
}

/// La page de couverture elle-même, sans le document qui la porte.
fn cover_body(cover: &Cover) -> String {
    let lines = |values: &[&str]| -> String {
        values
            .iter()
            .filter(|value| !value.trim().is_empty())
            .map(|value| latex_escape(value.trim()))
            .collect::<Vec<_>>()
            .join("\\\\\n")
    };
    // Un bloc par auteur, son agent à la suite ; une ligne vide entre deux auteurs.
    let contact = cover
        .authors
        .iter()
        .map(|author| {
            let agent = format!("{} {}", author.agent_first_name.trim(), author.agent_last_name.trim());
            let represented = if agent.trim().is_empty() {
                String::new()
            } else {
                format!("Représenté par {}", agent.trim())
            };
            lines(&[
                &author.name,
                &author.email,
                &author.phone,
                &represented,
                &author.agency,
                &author.agency_email,
                &author.agency_phone,
            ])
        })
        .collect::<Vec<_>>()
        .join("\\\\[\\baselineskip]\n");
    let names: Vec<String> = cover.authors.iter().map(|author| latex_escape(author.name.trim())).collect();
    format!(
        r"\vspace*{{0.28\textheight}}
\begin{{center}}
{title}\\[2\baselineskip]
écrit par\\[2\baselineskip]
{author}{source}
\end{{center}}
\vfill
\begin{{flushleft}}
{contact}
\end{{flushleft}}
",
        title = latex_escape(cover.title.trim()).to_uppercase(),
        author = join_names(&names),
        source = if cover.source.trim().is_empty() {
            String::new()
        } else {
            format!("\\\\[2\\baselineskip]\nd'après {}", latex_escape(cover.source.trim()))
        },
        contact = contact,
    )
}

/// Compose `<name>.tex`, déjà écrit dans ce dossier, et rend le nombre de
/// pages du PDF obtenu.
fn run_xelatex(work: &Path, name: &str) -> Result<usize, String> {
    let result = Command::new("xelatex")
        .args(["-interaction=nonstopmode", "-halt-on-error", "-no-shell-escape", &format!("{name}.tex")])
        .current_dir(work)
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("XeLaTeX est introuvable sur ce système ({e})."))?;
    let output = String::from_utf8_lossy(&result.stdout);
    if !result.status.success() {
        // Dans la sortie de XeLaTeX, les erreurs commencent par un point d'exclamation.
        let errors: Vec<&str> = output.lines().filter(|line| line.starts_with('!')).collect();
        return Err(if errors.is_empty() { "XeLaTeX a échoué.".to_string() } else { errors.join(" ") });
    }
    // « Output written on scenario.pdf (112 pages). »
    Ok(output
        .split("Output written on")
        .nth(1)
        .and_then(|rest| rest.split('(').nth(1))
        .and_then(|rest| rest.split_whitespace().next())
        .and_then(|count| count.parse().ok())
        .unwrap_or(0))
}

fn cover_pdf(path: &Path, cover: &Cover) -> Result<(), String> {
    let resources = resources_dir()?;
    let work = resources.join("couverture");
    fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    fs::write(work.join("couverture.tex"), cover_tex(cover, &resources.join("fonts"))).map_err(|e| e.to_string())?;
    run_xelatex(&work, "couverture")?;
    fs::copy(work.join("couverture.pdf"), path).map(|_| ()).map_err(|e| e.to_string())
}

/// Un passage d'une ligne du scénario, dans une seule graisse : maigre (""),
/// gras ("b"), italique ("i") ou gras italique ("bi").
#[derive(serde::Deserialize, Clone)]
struct Run {
    text: String,
    #[serde(default)]
    style: String,
}

/// Une ligne du scénario, composée telle quelle : ses espaces sont gardées,
/// retrait compris, et elle n'est jamais coupée.
fn screenplay_line(runs: &[Run]) -> String {
    let mut line = String::new();
    for run in runs {
        // Courier Prime n'a pas d'espace fine insécable.
        let text = latex_escape(&run.text.replace('\u{202f}', "\u{a0}")).replace(' ', "\\ ");
        match run.style.as_str() {
            "b" => line.push_str(&format!("{{\\bfseries {text}}}")),
            "i" => line.push_str(&format!("{{\\itshape {text}}}")),
            "bi" => line.push_str(&format!("{{\\bfseries\\itshape {text}}}")),
            _ => line.push_str(&text),
        }
    }
    format!("\\hbox to\\hsize{{{line}\\hss}}")
}

/// Source LaTeX d'un scénario à la mise en page standard, sur A4 : Courier
/// Prime corps 12, soit dix caractères au pouce et six lignes au pouce, les
/// intitulés de scène en gras ;
/// marge de 1,5 pouce à gauche, 60 caractères par ligne, 55 lignes par page.
/// Les pages sont déjà découpées, ligne par ligne : rien n'est remis en page.
/// Le numéro est en haut à droite, suivi d'un point, sauf sur la première
/// page ; la couverture, s'il y en a une, précède le texte et ne compte pas.
fn screenplay_tex(pages: &[Vec<Vec<Run>>], cover: Option<&Cover>, fonts: &Path) -> String {
    let mut tex = courier_preamble("left=1.5in,textwidth=6in,top=1in,textheight=661pt,headheight=12pt,headsep=24pt", fonts);
    tex.push_str(
        r"\makeatletter
\def\ps@scenario{\def\@oddhead{\hfill\thepage.}\let\@evenhead\@oddhead\def\@oddfoot{}\let\@evenfoot\@oddfoot}
\makeatother
\begin{document}
",
    );
    if let Some(cover) = cover {
        tex.push_str(&format!("\\newgeometry{{{COVER_GEOMETRY}}}\n{}\\restoregeometry\n", cover_body(cover)));
    }
    // Les lignes se suivent à 12 points l'une de l'autre, quelle que soit la
    // hauteur de leurs caractères.
    tex.push_str("\\setcounter{page}{1}\n\\pagestyle{scenario}\\thispagestyle{empty}\n\\fontsize{12pt}{12pt}\\selectfont\\lineskiplimit=-\\maxdimen\n");
    let composed: Vec<String> = pages
        .iter()
        .map(|page| {
            if page.is_empty() {
                screenplay_line(&[])
            } else {
                page.iter().map(|line| screenplay_line(line)).collect::<Vec<_>>().join("\n")
            }
        })
        .collect();
    tex.push_str(&composed.join("\n\\newpage\n"));
    tex.push_str("\n\\end{document}\n");
    tex
}

/// Crée le PDF du scénario et rend son nombre de pages, couverture comprise.
fn screenplay_pdf(path: &Path, pages: &[Vec<Vec<Run>>], cover: Option<&Cover>) -> Result<usize, String> {
    let resources = resources_dir()?;
    let work = resources.join("scenario");
    fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    fs::write(work.join("scenario.tex"), screenplay_tex(pages, cover, &resources.join("fonts"))).map_err(|e| e.to_string())?;
    let count = run_xelatex(&work, "scenario")?;
    fs::copy(work.join("scenario.pdf"), path).map_err(|e| e.to_string())?;
    Ok(count)
}

#[tauri::command]
async fn export_screenplay(path: String, pages: Vec<Vec<Vec<Run>>>, cover: Option<Cover>) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || screenplay_pdf(Path::new(&path), &pages, cover.as_ref()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn export_cover(path: String, cover: Cover) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || cover_pdf(Path::new(&path), &cover))
        .await
        .map_err(|e| e.to_string())?
}

/// Dernier enregistrement d'un fichier, en millisecondes depuis 1970.
#[tauri::command]
fn file_modified(path: String) -> Result<u64, String> {
    let modified = fs::metadata(&path).and_then(|metadata| metadata.modified()).map_err(|e| e.to_string())?;
    let since = modified.duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?;
    Ok(since.as_millis() as u64)
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    // Écriture dans un fichier voisin, puis renommage : une panne en cours
    // d'écriture ne laisse pas un texte tronqué à la place de l'ancien.
    let target = Path::new(&path);
    let mut name = target.file_name().ok_or("Nom de fichier invalide")?.to_os_string();
    name.push(".tmp");
    let temp = target.with_file_name(name);
    fs::write(&temp, contents).map_err(|e| e.to_string())?;
    fs::rename(&temp, target).map_err(|e| {
        let _ = fs::remove_file(&temp);
        e.to_string()
    })
}

/// Noms des polices à chasse fixe installées sur l'ordinateur, triés.
#[tauri::command]
async fn list_monospace_fonts() -> Result<Vec<String>, String> {
    // Le parcours des polices du système peut prendre une fraction de
    // seconde : il tourne hors du fil principal.
    tauri::async_runtime::spawn_blocking(|| {
        let mut db = fontdb::Database::new();
        db.load_system_fonts();
        let mut names: Vec<String> = db
            .faces()
            .filter(|face| face.monospaced)
            .filter_map(|face| face.families.first().map(|(name, _)| name.clone()))
            .collect();
        names.sort_by_key(|name| name.to_lowercase());
        names.dedup();
        names
    })
    .await
    .map_err(|e| e.to_string())
}

/// Barre de menu native. Chaque entrée porte un identifiant, transmis à la
/// page par l'événement « menu » : c'est la page qui exécute l'action.
fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let item = |id: &str, label: &str, shortcut: Option<&str>| {
        let builder = MenuItemBuilder::with_id(id, label);
        match shortcut {
            Some(keys) => builder.accelerator(keys),
            None => builder,
        }
        .build(app)
    };

    // Inactive au lancement : la page l'active quand le texte est vanilla.
    let layout = MenuItemBuilder::with_id("file-layout", "Mise en page…")
        .enabled(false)
        .build(app)?;

    let file = SubmenuBuilder::new(app, "Fichier")
        .item(&item("file-new", "Nouveau", Some("CmdOrCtrl+N"))?)
        .item(&item("file-open", "Ouvrir…", Some("CmdOrCtrl+O"))?)
        .separator()
        .item(&item("file-save", "Enregistrer", Some("CmdOrCtrl+S"))?)
        .item(&item("file-save-as", "Enregistrer sous…", Some("CmdOrCtrl+Shift+S"))?)
        .item(&item("file-export", "Exporter…", None)?)
        .separator()
        .item(&item("file-format", "Format du texte…", None)?)
        .item(&layout)
        .separator()
        .item(&item("file-find", "Chercher et remplacer…", Some("CmdOrCtrl+F"))?)
        .separator()
        .item(&item("file-test", "Charger le texte de test", None)?)
        .separator()
        .item(&item("file-quit", "Quitter", Some("CmdOrCtrl+Q"))?)
        .build()?;

    // Les raccourcis d'édition restent gérés par l'éditeur et les champs de
    // saisie : les afficher ici déclencherait deux fois la même action.
    // Case cochée au lancement : la page la règle ensuite sur le réglage retenu.
    let nbsp = CheckMenuItemBuilder::with_id("edit-nbsp", "Signaler les espaces insécables")
        .checked(true)
        .build(app)?;

    let edit = SubmenuBuilder::new(app, "Édition")
        .item(&item("edit-undo", "Annuler", None)?)
        .item(&item("edit-redo", "Rétablir", None)?)
        .separator()
        .item(&item("edit-cut", "Couper", None)?)
        .item(&item("edit-copy", "Copier", None)?)
        .item(&item("edit-paste", "Coller", None)?)
        .item(&item("edit-select-all", "Tout sélectionner", None)?)
        .separator()
        .item(&nbsp)
        .separator()
        .item(&item("edit-settings", "Paramètres…", None)?)
        .build()?;

    // Case cochée et inactive au lancement : la page la règle sur le réglage
    // retenu, et l'active quand le texte est un scénario.
    let consignes = CheckMenuItemBuilder::with_id("view-consignes", "Afficher les consignes")
        .checked(true)
        .enabled(false)
        .build(app)?;

    let view = SubmenuBuilder::new(app, "Affichage")
        .item(&item("view-home", "Accueil", None)?)
        .item(&item("view-text", "Texte", None)?)
        .item(&item("view-board", "Cork board", None)?)
        .separator()
        .item(&item("view-fullscreen", "Plein écran", Some("F11"))?)
        .separator()
        .item(&consignes)
        .build()?;

    // Inactives au lancement : la page les active quand le texte est un scénario.
    let model = MenuItemBuilder::with_id("scenario-model", "Modèle…")
        .enabled(false)
        .build(app)?;
    let cover = MenuItemBuilder::with_id("scenario-cover", "Créer la page de couverture…")
        .enabled(false)
        .build(app)?;
    let screenplay = SubmenuBuilder::new(app, "Scénario").item(&model).item(&cover).build()?;

    // Inactives au lancement, sur l'accueil : la page les active sur la vue Texte.
    let correction_item = |id: &str, label: &str, shortcut: Option<&str>| {
        let builder = MenuItemBuilder::with_id(id, label).enabled(false);
        match shortcut {
            Some(keys) => builder.accelerator(keys),
            None => builder,
        }
        .build(app)
    };
    // Décochée au lancement : la page la règle ensuite sur le réglage retenu.
    let typing = CheckMenuItemBuilder::with_id("correction-typing", "Vérifier pendant la frappe")
        .checked(false)
        .enabled(false)
        .build(app)?;
    let correction = SubmenuBuilder::new(app, "Correction")
        .item(&correction_item("correction-check", "Vérifier", Some("F7"))?)
        .item(&correction_item("correction-next", "Remarque suivante", Some("F8"))?)
        .item(&correction_item("correction-previous", "Remarque précédente", Some("Shift+F8"))?)
        .item(&correction_item("correction-clear", "Effacer les remarques", None)?)
        .separator()
        .item(&correction_item("correction-apostrophes", "Utiliser l'apostrophe typographique", None)?)
        .separator()
        .item(&typing)
        .separator()
        .item(&correction_item("correction-dictionaries", "Dictionnaires…", None)?)
        .build()?;

    let help = SubmenuBuilder::new(app, "Aide")
        .item(&item("help-about", "À propos de Schreibdrang", None)?)
        .build()?;

    MenuBuilder::new(app).items(&[&file, &edit, &view, &correction, &screenplay, &help]).build()
}

/// Active ou désactive une entrée de la barre de menu, cherchée dans chaque menu.
#[tauri::command]
fn set_menu_item_enabled(app: AppHandle, id: String, enabled: bool) -> Result<(), String> {
    let menu = app.menu().ok_or("Barre de menu introuvable")?;
    for entry in menu.items().map_err(|e| e.to_string())? {
        let Some(submenu) = entry.as_submenu() else { continue };
        if let Some(found) = submenu.get(&id) {
            if let Some(item) = found.as_menuitem() {
                return item.set_enabled(enabled).map_err(|e| e.to_string());
            }
            if let Some(item) = found.as_check_menuitem() {
                return item.set_enabled(enabled).map_err(|e| e.to_string());
            }
        }
    }
    Err(format!("Entrée de menu inconnue : {id}"))
}

/// Coche ou décoche une case de la barre de menu, cherchée dans chaque menu.
#[tauri::command]
fn set_menu_item_checked(app: AppHandle, id: String, checked: bool) -> Result<(), String> {
    let menu = app.menu().ok_or("Barre de menu introuvable")?;
    for entry in menu.items().map_err(|e| e.to_string())? {
        let Some(submenu) = entry.as_submenu() else { continue };
        if let Some(found) = submenu.get(&id) {
            if let Some(item) = found.as_check_menuitem() {
                return item.set_checked(checked).map_err(|e| e.to_string());
            }
        }
    }
    Err(format!("Case de menu inconnue : {id}"))
}

/// Affiche ou masque la barre de menu (masquée en plein écran).
#[tauri::command]
fn set_menu_visible(window: WebviewWindow, visible: bool) -> Result<(), String> {
    if visible { window.show_menu() } else { window.hide_menu() }.map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Sous Linux, WebKitGTK dessine la page par zones, certaines par le
    // processeur et d'autres par la carte graphique, et les deux méthodes ne
    // donnent pas la même graisse au texte. On impose le rendu par le
    // processeur pour que tout le texte soit dessiné de la même façon.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_SKIA_ENABLE_CPU_RENDERING").is_none() {
        std::env::set_var("WEBKIT_SKIA_ENABLE_CPU_RENDERING", "1");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .menu(build_menu)
        .on_menu_event(|app, event| {
            let _ = app.emit("menu", event.id().as_ref());
        })
        .invoke_handler(tauri::generate_handler![
            export_document,
            import_document,
            export_cover,
            export_screenplay,
            read_text_file,
            file_modified,
            write_text_file,
            list_monospace_fonts,
            set_menu_item_enabled,
            set_menu_item_checked,
            set_menu_visible
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn author(name: &str, email: &str) -> Author {
        Author {
            name: name.into(),
            email: email.into(),
            phone: "06 00 00 00 00".into(),
            agent_first_name: String::new(),
            agent_last_name: String::new(),
            agency: String::new(),
            agency_email: String::new(),
            agency_phone: String::new(),
        }
    }

    fn represented() -> Author {
        let mut with_agent = author("Élise Kœnig", "elise_koenig@exemple.fr");
        with_agent.agent_first_name = "Jeanne".into();
        with_agent.agent_last_name = "Martin".into();
        with_agent.agency = "Agence Plume & Cie".into();
        with_agent.agency_email = "contact@agence-plume.exemple".into();
        with_agent.agency_phone = "01 00 00 00 00".into();
        with_agent
    }

    fn cover(authors: Vec<Author>) -> Cover {
        Cover { title: "Cent quatre-vingt-trois marches".into(), source: String::new(), authors }
    }

    #[test]
    fn un_texte_saisi_est_rendu_inoffensif() {
        assert_eq!(latex_escape(r"a_b & 50 % #1 {x} $ ~ ^ \fin"), r"a\_b \& 50 \% \#1 \{x\} \$ \textasciitilde{} \textasciicircum{} \textbackslash{}fin");
        assert_eq!(latex_escape("deux\nlignes"), "deux lignes");
    }

    #[test]
    fn les_noms_des_auteurs_sont_relies_par_et() {
        let names = |list: &[&str]| join_names(&list.iter().map(|name| name.to_string()).collect::<Vec<_>>());
        assert_eq!(names(&["A"]), "A");
        assert_eq!(names(&["A", "B"]), "A et B");
        assert_eq!(names(&["A", "B", "C"]), "A, B et C");
    }

    #[test]
    fn la_couverture_sans_agent_ne_le_mentionne_pas() {
        let tex = cover_tex(&cover(vec![author("Élise Kœnig", "elise_koenig@exemple.fr")]), Path::new("/polices"));
        assert!(tex.contains("CENT QUATRE-VINGT-TROIS MARCHES"));
        assert!(tex.contains(r"elise\_koenig@exemple.fr"));
        assert!(!tex.contains("Représenté par"));
    }

    #[test]
    fn chaque_auteur_a_son_bloc_et_son_agent() {
        let tex = cover_tex(&cover(vec![represented(), author("Paul Morel", "paul@exemple.fr")]), Path::new("/polices"));
        assert!(tex.contains("Élise Kœnig et Paul Morel\n\\end{center}"));
        assert!(tex.contains("06 00 00 00 00\\\\\nReprésenté par Jeanne Martin\\\\\nAgence Plume \\& Cie\\\\\ncontact@agence-plume.exemple\\\\\n01 00 00 00 00\\\\[\\baselineskip]\nPaul Morel\\\\\npaul@exemple.fr"));
    }

    #[test]
    fn l_oeuvre_d_origine_suit_les_auteurs() {
        let mut adapted = cover(vec![author("Élise Kœnig", "elise_koenig@exemple.fr")]);
        adapted.source = "« Le Horla », de Guy de Maupassant".into();
        let tex = cover_tex(&adapted, Path::new("/polices"));
        assert!(tex.contains("Élise Kœnig\\\\[2\\baselineskip]\nd'après « Le Horla », de Guy de Maupassant\n\\end{center}"));
        assert!(!cover_tex(&cover(vec![author("A", "a@b.c")]), Path::new("/polices")).contains("d'après"));
    }

    // Demande XeLaTeX : la page est réellement composée.
    #[test]
    fn la_couverture_est_un_pdf_d_une_page() {
        let path = std::env::temp_dir().join("schreibdrang-test-couverture.pdf");
        let authors = vec![represented(), author("Paul Morel", "paul@exemple.fr"), author("Anne Roy", "anne@exemple.fr")];
        let mut adapted = cover(authors);
        adapted.source = "« Le Horla », de Guy de Maupassant".into();
        cover_pdf(&path, &adapted).expect("la couverture est créée");
        assert!(fs::read(&path).expect("le PDF existe").starts_with(b"%PDF"));
    }

    fn run(text: &str, style: &str) -> Run {
        Run { text: text.into(), style: style.into() }
    }

    #[test]
    fn une_ligne_de_scenario_garde_son_retrait_et_ses_caracteres() {
        assert_eq!(screenplay_line(&[run("  Élise & Paul", "")]), r"\hbox to\hsize{\ \ Élise\ \&\ Paul\hss}");
        // L'espace fine insécable, absente de Courier Prime, devient une espace insécable.
        assert_eq!(screenplay_line(&[run("Quoi\u{202f}?", "")]), "\\hbox to\\hsize{Quoi\u{a0}?\\hss}");
        assert_eq!(screenplay_line(&[]), r"\hbox to\hsize{\hss}");
    }

    #[test]
    fn une_ligne_de_scenario_porte_le_gras_et_l_italique() {
        let line = [run("Elle ", ""), run("crie", "i"), run(" et ", ""), run("frappe", "b"), run(" fort", "bi")];
        assert_eq!(
            screenplay_line(&line),
            r"\hbox to\hsize{Elle\ {\itshape crie}\ et\ {\bfseries frappe}{\bfseries\itshape \ fort}\hss}"
        );
    }

    #[test]
    fn le_scenario_est_compose_page_par_page() {
        let pages = vec![vec![vec![run("INT. CUISINE - JOUR", "b")], vec![], vec![run("Élise entre.", "")]], vec![vec![run("FIN", "")]]];
        let tex = screenplay_tex(&pages, None, Path::new("/polices"));
        assert!(tex.contains("\\hbox to\\hsize{Élise\\ entre.\\hss}\n\\newpage\n\\hbox to\\hsize{FIN\\hss}\n\\end{document}"));
        assert!(!tex.contains("écrit par"));
        let with_cover = screenplay_tex(&pages, Some(&cover(vec![author("Élise Kœnig", "elise@exemple.fr")])), Path::new("/polices"));
        assert!(with_cover.contains("écrit par"));
        // La page de titre ne compte pas : le texte commence à la page 1.
        assert!(with_cover.contains("\\setcounter{page}{1}"));
    }

    // Demande XeLaTeX : chaque page de 55 lignes tient sur une page du PDF, et
    // la page de titre s'y ajoute.
    #[test]
    fn le_pdf_du_scenario_a_les_pages_demandees() {
        // Toutes les graisses, pour que chacune garde la hauteur de ligne.
        let full: Vec<Vec<Run>> = (1..=55)
            .map(|line| vec![run(&format!("Ligne {line} : É, p, q, _ et {}", "x".repeat(30)), ["", "b", "i", "bi"][line % 4])])
            .collect();
        let pages = vec![full.clone(), full.clone(), vec![vec![run("FIN", "")]]];
        let path = std::env::temp_dir().join("schreibdrang-test-scenario.pdf");
        assert_eq!(screenplay_pdf(&path, &pages, None).expect("le PDF est créé"), 3);
        assert!(fs::read(&path).expect("le PDF existe").starts_with(b"%PDF"));
        let titled = cover(vec![represented()]);
        assert_eq!(screenplay_pdf(&path, &pages, Some(&titled)).expect("le PDF est créé"), 4);
    }

    #[test]
    fn un_fichier_qu_on_vient_d_ecrire_date_de_maintenant() {
        let path = std::env::temp_dir().join("schreibdrang-test-date.txt");
        fs::write(&path, "texte").expect("le fichier est écrit");
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64;
        let modified = file_modified(path.to_string_lossy().into_owned()).expect("la date est lue");
        assert!(now.abs_diff(modified) < 60_000);
        assert!(file_modified("/aucun/fichier/ici".into()).is_err());
    }

    // Demande Pandoc : un document Word ou OpenDocument devient du Markdown.
    #[test]
    fn un_document_importe_garde_ses_titres_et_sa_mise_en_valeur() {
        let source = "# Chapitre 1\n\n## La cuisine\n\nUn *italique*, un **gras** et « l’apostrophe ».\n\nAvant ![](image.png) après.\n";
        for extension in ["docx", "odt"] {
            let path = std::env::temp_dir().join(format!("schreibdrang-test-import.{extension}"));
            run_pandoc(source, &path, &[]).expect("le document d'essai est créé");
            let text = import(&path).expect("le document est importé");
            assert!(text.starts_with("# Chapitre 1\n\n## La cuisine\n\n"), "{extension} : {text}");
            assert!(text.contains("Un *italique*, un **gras** et « l’apostrophe »."), "{extension} : {text}");
            // Ni image, ni balise, ni attribut de traitement de texte.
            assert!(text.contains("Avant après.") || text.contains("Avant  après."), "{extension} : {text}");
            assert!(!text.contains("image") && !text.contains('{') && !text.contains('<'), "{extension} : {text}");
        }
        assert!(import(Path::new("/aucun/fichier.docx")).is_err());
    }

    const LAYOUT: Layout = Layout { spacing: 1.5, top: 2.0, bottom: 3.0, left: 2.5, right: 1.2 };

    /// Un fichier d'une archive embarquée, en texte.
    fn entry(archive: &[u8], name: &str) -> String {
        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(archive)).unwrap();
        let mut text = String::new();
        std::io::Read::read_to_string(&mut zip.by_name(name).unwrap(), &mut text).unwrap();
        text
    }

    fn resource(name: &str) -> &'static [u8] {
        RESOURCES.iter().find(|(file, _)| *file == name).unwrap().1
    }

    #[test]
    fn pdf_garde_ses_marges_sans_mise_en_page() {
        assert_eq!(pdf_layout(None), ["geometry:margin=2.5cm"]);
    }

    #[test]
    fn pdf_reprend_les_marges_et_l_interligne() {
        assert_eq!(pdf_layout(Some(LAYOUT)), ["geometry:top=2cm,bottom=3cm,left=2.5cm,right=1.2cm", "linestretch=1.5"]);
    }

    #[test]
    fn modele_word_recoit_la_feuille_a4_les_marges_et_l_interligne() {
        let document = docx_document(&entry(resource("reference.docx"), "word/document.xml"), LAYOUT).unwrap();
        // 2 cm font 1 134 vingtièmes de point.
        assert!(document.contains(r#"<w:pgSz w:w="11906" w:h="16838" /><w:pgMar w:top="1134" w:right="680" w:bottom="1701" w:left="1417" "#));
        let styles = docx_styles(&entry(resource("reference.docx"), "word/styles.xml"), LAYOUT).unwrap();
        assert!(styles.contains(r#"<w:spacing w:line="360" w:lineRule="auto" w:after="200" />"#));
    }

    #[test]
    fn modele_opendocument_recoit_la_feuille_a4_les_marges_et_l_interligne() {
        let styles = odt_styles(&entry(resource("reference.odt"), "styles.xml"), LAYOUT).unwrap();
        for attribute in [
            r#"fo:page-width="21cm""#,
            r#"fo:page-height="29.7cm""#,
            r#"fo:margin-top="2cm""#,
            r#"fo:margin-bottom="3cm""#,
            r#"fo:margin-left="2.5cm""#,
            r#"fo:margin-right="1.2cm""#,
            r#"<style:paragraph-properties fo:line-height="150%" fo:hyphenation-ladder-count"#,
        ] {
            assert!(styles.contains(attribute), "{attribute}");
        }
        // Les marges du pied de page, plus loin dans le modèle, ne changent pas.
        assert!(styles.contains(r#"fo:margin-left="0in" fo:margin-right="0in""#));
    }

    #[test]
    fn modeles_word_et_opendocument_sont_en_a4_avec_des_marges_de_2_5_cm() {
        // 2,5 cm font 1 417 vingtièmes de point.
        assert!(entry(resource("reference.docx"), "word/document.xml")
            .contains(r#"<w:pgSz w:w="11906" w:h="16838" /><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" "#));
        let styles = entry(resource("reference.odt"), "styles.xml");
        for attribute in [
            r#"fo:page-width="21cm""#,
            r#"fo:page-height="29.7cm""#,
            r#"fo:margin-top="2.5cm""#,
            r#"fo:margin-bottom="2.5cm""#,
            r#"fo:margin-left="2.5cm""#,
            r#"fo:margin-right="2.5cm""#,
        ] {
            assert!(styles.contains(attribute), "{attribute}");
        }
    }

    #[test]
    fn modele_inattendu_est_refuse() {
        assert!(docx_document("<w:body></w:body>", LAYOUT).is_err());
        assert!(docx_styles("<w:styles></w:styles>", LAYOUT).is_err());
        assert!(odt_styles("<office:styles></office:styles>", LAYOUT).is_err());
    }

    #[test]
    fn copie_du_modele_garde_ses_fichiers_dans_l_ordre() {
        let dir = std::env::temp_dir().join(format!("schreibdrang-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        for name in ["reference.docx", "reference.odt"] {
            let source = dir.join(name);
            let target = dir.join(format!("copie-{name}"));
            fs::write(&source, resource(name)).unwrap();
            reference_with_layout(&source, &target, LAYOUT).unwrap();
            let names = |bytes: &[u8]| {
                let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes.to_vec())).unwrap();
                (0..zip.len()).map(|index| zip.by_index_raw(index).unwrap().name().to_string()).collect::<Vec<_>>()
            };
            let copy = fs::read(&target).unwrap();
            assert_eq!(names(&copy), names(resource(name)));
            let styles = if name == "reference.odt" { "styles.xml" } else { "word/styles.xml" };
            assert!(entry(&copy, styles).contains(if name == "reference.odt" { "fo:line-height=\"150%\"" } else { "w:line=\"360\"" }));
        }
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn les_exports_d_un_texte_vanilla_portent_sa_mise_en_page() {
        let dir = std::env::temp_dir().join(format!("schreibdrang-test-export-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let text = "Un premier paragraphe.\n\nUn second paragraphe.\n";
        export(&dir.join("texte.docx"), "docx", text, Some(LAYOUT)).unwrap();
        let docx = fs::read(dir.join("texte.docx")).unwrap();
        assert!(entry(&docx, "word/document.xml").contains(r#"w:top="1134""#));
        assert!(entry(&docx, "word/styles.xml").contains(r#"w:line="360""#));
        export(&dir.join("texte.odt"), "odt", text, Some(LAYOUT)).unwrap();
        let odt = fs::read(dir.join("texte.odt")).unwrap();
        assert!(entry(&odt, "styles.xml").contains(r#"fo:margin-top="2cm""#));
        assert!(entry(&odt, "styles.xml").contains(r#"fo:line-height="150%""#));
        export(&dir.join("texte.pdf"), "pdf", text, Some(LAYOUT)).unwrap();
        assert!(fs::read(dir.join("texte.pdf")).unwrap().starts_with(b"%PDF"));
        fs::remove_dir_all(&dir).unwrap();
    }
}
