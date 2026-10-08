use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, WebviewWindow, Wry};

// Fichiers nécessaires à l'export, embarqués dans l'exécutable : les modèles
// Word et OpenDocument réglés sur Literata, la police elle-même pour le PDF,
// et Courier Prime pour la couverture d'un scénario.
const RESOURCES: [(&str, &[u8]); 7] = [
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

fn export(path: &Path, format: &str, markdown: &str) -> Result<(), String> {
    let resources = resources_dir()?;
    let reference = |name: &str| format!("--reference-doc={}", resources.join(name).display());

    match format {
        "md" => fs::write(path, markdown).map_err(|e| e.to_string()),
        "txt" => run_pandoc(
            markdown,
            path,
            &["--to=plain".into(), "--wrap=none".into()],
        ),
        "docx" => run_pandoc(markdown, path, &[reference("reference.docx")]),
        "odt" => run_pandoc(markdown, path, &[reference("reference.odt")]),
        "pdf" => {
            let variables = [
                "documentclass=report".to_string(),
                "lang=fr".to_string(),
                "papersize=a4".to_string(),
                "fontsize=11pt".to_string(),
                "geometry:margin=2.5cm".to_string(),
                "mainfont=Literata-Regular.ttf".to_string(),
                format!("mainfontoptions=Path={}/", resources.join("fonts").display()),
                "mainfontoptions=BoldFont=Literata-Bold.ttf".to_string(),
                "mainfontoptions=ItalicFont=Literata-Italic.ttf".to_string(),
                "mainfontoptions=BoldItalicFont=Literata-BoldItalic.ttf".to_string(),
            ];
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

#[tauri::command]
async fn export_document(path: String, format: String, markdown: String) -> Result<(), String> {
    // La conversion peut durer plusieurs dizaines de secondes : elle tourne
    // hors du fil principal pour ne pas figer l'interface.
    tauri::async_runtime::spawn_blocking(move || export(Path::new(&path), &format, &markdown))
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

/// Source LaTeX de la couverture, selon la page de titre habituelle d'un
/// scénario : Courier Prime corps 12, titre en capitales centré dans le haut
/// de la page, coordonnées en bas à gauche.
fn cover_tex(cover: &Cover, fonts: &Path) -> String {
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
        r"\documentclass[12pt,a4paper]{{article}}
\usepackage{{fontspec}}
\usepackage[a4paper,left=3.8cm,right=2.5cm,top=2.5cm,bottom=2.5cm]{{geometry}}
\setmonofont{{CourierPrime-Regular.ttf}}[Path={fonts}/]
\renewcommand{{\familydefault}}{{\ttdefault}}
\pagestyle{{empty}}
\setlength{{\parindent}}{{0pt}}
\hyphenpenalty=10000
\begin{{document}}
\vspace*{{0.28\textheight}}
\begin{{center}}
{title}\\[2\baselineskip]
écrit par\\[2\baselineskip]
{author}
\end{{center}}
\vfill
\begin{{flushleft}}
{contact}
\end{{flushleft}}
\end{{document}}
",
        fonts = fonts.display(),
        title = latex_escape(cover.title.trim()).to_uppercase(),
        author = join_names(&names),
        contact = contact,
    )
}

fn cover_pdf(path: &Path, cover: &Cover) -> Result<(), String> {
    let resources = resources_dir()?;
    let work = resources.join("couverture");
    fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    fs::write(work.join("couverture.tex"), cover_tex(cover, &resources.join("fonts"))).map_err(|e| e.to_string())?;

    let result = Command::new("xelatex")
        .args(["-interaction=nonstopmode", "-halt-on-error", "-no-shell-escape", "couverture.tex"])
        .current_dir(&work)
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("XeLaTeX est introuvable sur ce système ({e})."))?;
    if !result.status.success() {
        // Dans la sortie de XeLaTeX, les erreurs commencent par un point d'exclamation.
        let output = String::from_utf8_lossy(&result.stdout);
        let errors: Vec<&str> = output.lines().filter(|line| line.starts_with('!')).collect();
        return Err(if errors.is_empty() { "XeLaTeX a échoué.".to_string() } else { errors.join(" ") });
    }
    fs::copy(work.join("couverture.pdf"), path).map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
async fn export_cover(path: String, cover: Cover) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || cover_pdf(Path::new(&path), &cover))
        .await
        .map_err(|e| e.to_string())?
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

    let file = SubmenuBuilder::new(app, "Fichier")
        .item(&item("file-new", "Nouveau", Some("CmdOrCtrl+N"))?)
        .item(&item("file-open", "Ouvrir…", Some("CmdOrCtrl+O"))?)
        .separator()
        .item(&item("file-save", "Enregistrer", Some("CmdOrCtrl+S"))?)
        .item(&item("file-save-as", "Enregistrer sous…", Some("CmdOrCtrl+Shift+S"))?)
        .item(&item("file-export", "Exporter…", None)?)
        .separator()
        .item(&item("file-find", "Chercher et remplacer…", Some("CmdOrCtrl+F"))?)
        .separator()
        .item(&item("file-test", "Charger le texte de test", None)?)
        .separator()
        .item(&item("file-quit", "Quitter", Some("CmdOrCtrl+Q"))?)
        .build()?;

    // Les raccourcis d'édition restent gérés par l'éditeur et les champs de
    // saisie : les afficher ici déclencherait deux fois la même action.
    let edit = SubmenuBuilder::new(app, "Édition")
        .item(&item("edit-undo", "Annuler", None)?)
        .item(&item("edit-redo", "Rétablir", None)?)
        .separator()
        .item(&item("edit-cut", "Couper", None)?)
        .item(&item("edit-copy", "Copier", None)?)
        .item(&item("edit-paste", "Coller", None)?)
        .item(&item("edit-select-all", "Tout sélectionner", None)?)
        .separator()
        .item(&item("edit-settings", "Paramètres…", None)?)
        .build()?;

    let view = SubmenuBuilder::new(app, "Affichage")
        .item(&item("view-home", "Accueil", None)?)
        .item(&item("view-text", "Texte", None)?)
        .item(&item("view-board", "Cork board", None)?)
        .separator()
        .item(&item("view-fullscreen", "Plein écran", Some("F11"))?)
        .build()?;

    let screenplay = SubmenuBuilder::new(app, "Scénario")
        .item(&item("scenario-cover", "Créer la page de couverture…", None)?)
        .build()?;

    let help = SubmenuBuilder::new(app, "Aide")
        .item(&item("help-about", "À propos de Schreibdrang", None)?)
        .build()?;

    MenuBuilder::new(app).items(&[&file, &edit, &view, &screenplay, &help]).build()
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
            export_cover,
            read_text_file,
            write_text_file,
            list_monospace_fonts,
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
        Cover { title: "Cent quatre-vingt-trois marches".into(), authors }
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

    // Demande XeLaTeX : la page est réellement composée.
    #[test]
    fn la_couverture_est_un_pdf_d_une_page() {
        let path = std::env::temp_dir().join("schreibdrang-test-couverture.pdf");
        let authors = vec![represented(), author("Paul Morel", "paul@exemple.fr"), author("Anne Roy", "anne@exemple.fr")];
        cover_pdf(&path, &cover(authors)).expect("la couverture est créée");
        assert!(fs::read(&path).expect("le PDF existe").starts_with(b"%PDF"));
    }
}
