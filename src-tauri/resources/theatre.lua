-- Mise en page du PDF d'une pièce de théâtre : chaque bloc qui porte un style
-- nommé (voir src/theatre-pandoc.ts) est entouré des commandes LaTeX de son
-- style. La mise en page, « manuscrit » ou « edition », est donnée par la
-- métadonnée theatre-layout. Pandoc applique les deux filtres dans l'ordre :
-- la métadonnée est lue avant les blocs.

local layout = "manuscrit"

local function wrap(before, div, after)
  local blocks = { pandoc.RawBlock("latex", before) }
  for _, block in ipairs(div.content) do
    table.insert(blocks, block)
  end
  table.insert(blocks, pandoc.RawBlock("latex", after))
  return blocks
end

local STYLES = {
  -- Chaque acte commence sur une nouvelle page ; la liste des personnages,
  -- qui le précède, a donc la sienne.
  Acte = { "\\clearpage\\begin{center}\\bfseries", "\\end{center}\\nopagebreak" },
  Scene = { "\\begin{center}\\bfseries", "\\end{center}\\nopagebreak" },
  Personnages = { "\\begin{center}\\bfseries", "\\end{center}\\nopagebreak" },
  Personnage = { "\\begin{center}", "\\end{center}\\nopagebreak" },
  Didascalie = { "\\begin{quote}\\itshape", "\\end{quote}" },
}

-- À l'édition, les noms sont en capitales de corps réduit : EB Garamond,
-- telle que la fournit fonts.bunny.net, n'a pas de vraies petites capitales.
local EDITION_NAME = { "\\begin{center}\\small", "\\end{center}\\nopagebreak" }

return {
  {
    Meta = function(meta)
      if meta["theatre-layout"] then
        layout = pandoc.utils.stringify(meta["theatre-layout"])
      end
    end,
  },
  {
    Div = function(div)
      local style = div.attributes["custom-style"]
      local commands = STYLES[style]
      if style == "Personnage" and layout == "edition" then
        commands = EDITION_NAME
      end
      if not commands then
        return nil
      end
      return wrap(commands[1], div, commands[2])
    end,
  },
}
