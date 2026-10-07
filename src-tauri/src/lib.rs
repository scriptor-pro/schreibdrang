use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, WebviewWindow, Wry};

// Fichiers nécessaires à l'export, embarqués dans l'exécutable : les modèles
// Word et OpenDocument réglés sur Literata, et la police elle-même pour le PDF.
const RESOURCES: [(&str, &[u8]); 6] = [
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

    let help = SubmenuBuilder::new(app, "Aide")
        .item(&item("help-about", "À propos de Schreibdrang", None)?)
        .build()?;

    MenuBuilder::new(app).items(&[&file, &edit, &view, &help]).build()
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
            read_text_file,
            write_text_file,
            list_monospace_fonts,
            set_menu_visible
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
