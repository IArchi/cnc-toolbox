// Translate presentation only: never rewrite form values, imported names or G-code.
const languagePairs = [
  ['Vue de dessus', 'Top view'],
  ['Échelle visuelle Z', 'Z display scale'],
  ['Glisser : tourner · Maj-glisser : déplacer · Molette : zoom · Échelle Z uniquement visuelle', 'Drag to rotate · Shift-drag to move · Wheel to zoom · Z scale is visual only'],
  ['Parcours 3D. Flèches : tourner ; Maj et flèches : déplacer ; plus et moins : zoomer.', '3D toolpaths. Arrow keys rotate; Shift and arrows pan; plus and minus zoom.'],
  ['Calculateur de vitesses CNC', 'CNC Feedrate Calculator'],
  ['Mousse PVC', 'PVC Foam'], ['POM / PMMA / PC', 'POM / PMMA / PC'],
  ['Plongée verticale sous Z0 (taille symbolique)', 'Vertical plunge below Z0 (symbolic size)'],
  ['Simuler le G-code', 'Simulate G-code'], ['Simulateur G-code', 'G-code simulator'],
  ['Prévisualiser votre G-code', 'Preview your G-code'],
  ['Importez un fichier G-code pour suivre le déplacement de l’outil, contrôler les coordonnées et parcourir les lignes du programme.', 'Import a G-code file to follow tool motion, inspect coordinates and step through program lines.'],
  ['.nc, .gcode ou .tap · aperçu XY · arcs I/J', '.nc, .gcode or .tap · XY preview · I/J arcs'],
  ['Importer un fichier .nc, .gcode ou .tap.', 'Import a .nc, .gcode or .tap file.'],
  ['Fichier trop volumineux (maximum 10 Mo).', 'File too large (10 MB maximum).'],
  ['Aucun déplacement à simuler.', 'No motion to simulate.'],
  ['Trop de déplacements à simuler (maximum 200 000).', 'Too many motions to simulate (200,000 maximum).'],
  ['Ligne {0} : {1}', 'Line {0}: {1}'],
  ['Commande ou syntaxe non prise en charge.', 'Unsupported command or syntax.'],
  ['Commandes modales contradictoires.', 'Conflicting modal commands.'],
  ['Valeur numérique invalide.', 'Invalid numeric value.'],
  ['Commande non prise en charge : {0}.', 'Unsupported command: {0}.'],
  ['Mouvement après la fin du programme.', 'Motion after program end.'],
  ['Avance F positive requise avant un mouvement usiné.', 'A positive F feed rate is required before feed motion.'],
  ['Arc XY : centres I/J relatifs requis ; rayon R et hélices complètes non pris en charge.', 'XY arc: relative I/J centers required; R radius and full helical circles are not supported.'],
  ['Rayons d’arc incohérents.', 'Inconsistent arc radii.'],
  ['Paramètres d’arc sur un mouvement linéaire.', 'Arc parameters on linear motion.'],
  ['Outils CNC', 'CNC tools'],
  ['Vitesses de coupe', 'Feeds and speeds'],
  ['Convertir en G-code', 'Convert to G-code'],
  ['Usiner par sections', 'Machine in sections'],
  ['Importer un fichier C2D', 'Import a C2D file'],
  ['Convertir votre C2D en G-code', 'Convert your C2D to G-code'],
  ['Importez votre fichier Carbide Create. Prévisualisez les parcours, ajustez les paramètres et téléchargez le G-code pour votre CNC.', 'Import your Carbide Create file. Preview toolpaths, adjust settings and download G-code for your CNC.'],
  ['Choisir un fichier C2D', 'Choose a C2D file'],
  ['.c2d · parcours intégrés au fichier · export GRBL', '.c2d · embedded toolpaths · GRBL export'],
  ['Résumé', 'Summary'], ['Parcours', 'Toolpaths'], ['Aperçu 2D', '2D Preview'],
  ['Chargez un fichier pour inspecter son contenu et ses parcours.', 'Load a file to inspect its content and toolpaths.'],
  ['Chargez un fichier pour inspecter ses paramètres.', 'Load a file to inspect its document settings.'],
  ['Chargez un fichier pour gérer la visibilité des parcours.', 'Load a file to manage toolpath visibility.'],
  ['Navigation de l’aperçu', 'Preview navigation'], ['Dézoomer', 'Zoom out'], ['Zoomer', 'Zoom in'], ['Ajuster', 'Fit'],
  ['Molette : zoom · Glisser le fond : déplacer la vue', 'Scroll to zoom · Drag to pan'],
  ['Molette : zoom · Glisser : déplacer la vue', 'Scroll to zoom · Drag to pan'],
  ['L’aperçu apparaîtra ici.', 'The preview will appear here.'],
  ['Coordonnées de l’outil en millimètres', 'Tool coordinates in millimeters'],
  ['Commandes de simulation du G-code', 'G-code player controls'], ['Position de la simulation', 'Simulation position'],
  ['Recommencer', 'Restart'], ['Reculer de 5 secondes', 'Rewind 5 seconds'], ['Avancer de 5 secondes', 'Forward 5 seconds'],
  ['Lire', 'Play'], ['Pause', 'Pause'], ['Télécharger le G-code', 'Download G-code'],
  ['G-code généré', 'Generated G-code'], ['Le G-code généré apparaîtra ici.', 'Generated G-code will appear here.'],
  ['Paramètres du parcours', 'Toolpath Settings'], ['Réglages du parcours', 'Toolpath settings'], ['Modifier le parcours', 'Edit Toolpath'],
  ['Avance (mm/min)', 'Feedrate (mm/min)'], ['Plongée (mm/min)', 'Plunge rate (mm/min)'], ['Profondeur par passe (mm)', 'Depth per pass (mm)'],
  ['Entrée dans la matière', 'Entry into material'], ['Rampe 5°', 'Ramp 5°'], ['Rampe 20°', 'Ramp 20°'],
  ['Un angle faible (5°) permet une entrée plus douce dans les matériaux durs ; un angle plus élevé (20°) convient mieux aux matériaux tendres. Vérifiez l’angle de rampe maximal de votre fraise. La longueur de rampe est calculée automatiquement pour chaque passe. Sur les parcours courts, l’outil effectue des allers-retours sans traverser les attaches. La vitesse d’entrée est limitée à la vitesse de plongée.', "A shallow angle (5°) gives a gentler entry for hard materials; a steeper angle (20°) is better suited to soft materials. Check your cutter's maximum ramp angle. Ramp length is calculated automatically for each pass. On short paths, the tool moves back and forth without crossing holding-tab boundaries. Entry speed is limited to the plunge rate."],
  ['Annuler', 'Cancel'], ['Appliquer', 'Apply'], ['Zone', 'Area'], ['Origine', 'Origin'], ['Matériau', 'Material'],
  ['Z de dégagement', 'Safe Z'], ['Z de dégagement en millimètres', 'Safe Z in millimeters'], ['Durée', 'Duration'],
  ['AVANCE', 'FEED'], ['PLONG.', 'PLNG'], ['PASSE', 'PASS'], ['Aucun parcours actif.', 'No active toolpaths.'],
  ['Aucune géométrie exploitable à afficher.', 'No usable geometry is available to display.'], ['Attache', 'Holding tab'],
  ['Masquer le parcours {0}', 'Hide toolpath {0}'], ['Afficher le parcours {0}', 'Show toolpath {0}'],
  ['Modifier l’avance : {0} mm/min', 'Edit feedrate: {0} mm/min'], ['Modifier la plongée : {0} mm/min', 'Edit plunge rate: {0} mm/min'],
  ['Modifier la profondeur par passe : {0} mm', 'Edit depth per pass: {0} mm'], ['Modifier la rotation : {0} RPM', 'Edit spindle speed: {0} RPM'],
  ['Modifier l’entrée dans la matière : {0}', 'Edit entry into material: {0}'],
  ['Lecture de {0}...', 'Reading {0}...'], ['Conversion terminée pour {0}.', 'Conversion completed for {0}.'],
  ['Échec de la conversion : {0}', 'Conversion failed: {0}'], ['Erreur d’initialisation : {0}', 'Initialization error: {0}'],
  ['Aucun JSON exploitable trouvé dans le fichier.', 'No usable JSON was found in the file.'],
  ['Le JSON semble tronqué ou la fin du document est introuvable.', 'JSON appears truncated or the end of the document could not be found.'],
  ['L’élément {0} ({1}/{2}) est ignoré : son contenu n’est pas du JSON.', 'Item {0} ({1}/{2}) ignored: payload is not JSON.'],
  ['Ancien fichier JSON détecté : aucun parcours présent, un contour sur l’axe a été généré pour chaque géométrie.', 'Legacy JSON file detected: toolpaths were not present, so one centerline contour per geometry was generated.'],
  ['Le parcours "{0}" est ignoré : le type {1} n’est pas encore pris en charge.', 'Toolpath "{0}" ignored: type {1} is not supported yet.'],
  ['Le parcours "{0}" est ignoré : aucune géométrie référencée.', 'Toolpath "{0}" ignored: no referenced geometry.'],
  ['Élément {0} introuvable pour le parcours "{1}".', 'Element {0} was not found for toolpath "{1}".'],
  ['Le parcours "{0}" est ignoré : aucun parcours usinable n’a pu être généré.', 'Toolpath "{0}" ignored: no machinable path could be generated.'],
  ['Aucune coupe générée. Vérifiez les types de parcours du fichier.', 'No cuts were generated. Check the toolpath types present in the file.'],
  ['La géométrie {0} ({1}) n’est pas prise en charge.', 'Geometry {0} ({1}) is not supported.'],
  ['Ancien rectangle {0} : les coins spéciaux ont été simplifiés en polylignes arrondies.', 'Legacy rectangle {0}: special corners were simplified as rounded polylines.'],
  ['Parcours "{0}" : un décalage a été demandé sur une courbe ouverte ; la coupe sur l’axe a été conservée.', 'Toolpath "{0}": an offset was requested on an open curve, so centerline cutting was kept.'],
  ['Parcours "{0}" : échec du calcul de décalage ; la coupe sur l’axe a été conservée.', 'Toolpath "{0}": offset computation failed, so centerline cutting was kept.'],
  ['Importer le G-code', 'Import G-code'], ['Usiner plus grand que sa CNC', 'Machine beyond your CNC’s limits'],
  ['Déposez votre G-code complet. Nous proposons les sections et un repère pour repositionner la plaque contre votre guide latéral.', 'Drop your complete G-code file here. We suggest sections and a reference hole to reposition the workpiece against your side fence.'],
  ['Choisir un G-code', 'Choose a G-code file'], ['.nc ou .gcode · un seul outil · mm · Z0 dessus panneau', '.nc or .gcode · single tool · mm · Z0 on top of stock'],
  ['Votre machine et votre plaque', 'Your machine and workpiece'], ['Surface utile de la CNC', 'CNC working area'],
  ['Largeur utile X (mm)', 'Usable X width (mm)'], ['Hauteur utile Y (mm)', 'Usable Y height (mm)'],
  ['Outil et repère', 'Tool and reference hole'], ['Diamètre de la fraise actuelle (mm)', 'Current cutter diameter (mm)'],
  ['Profondeur du trou de référence (mm)', 'Reference hole depth (mm)'], ['Plaque à usiner (workpiece)', 'Workpiece'],
  ['Largeur de la plaque X (mm)', 'Workpiece X width (mm)'], ['Hauteur de la plaque Y (mm)', 'Workpiece Y height (mm)'],
  ['Ex. 900', 'e.g. 900'], ['Ex. 2400', 'e.g. 2400'],
  ['Les minima de plaque proviennent des parcours, pas du brut déclaré par la FAO. La plaque reste à gauche en X0. La hauteur utile peut être inférieure à la hauteur usinée : le tiling prend le relais.', 'Minimum workpiece dimensions come from the toolpaths, not the stock defined in CAM. Keep the workpiece against the left fence at X0. The usable Y travel can be shorter than the job: sectioning handles the rest.'],
  ['Changer de fichier', 'Change file'], ['Voir mon plan', 'View my plan'], ['Aperçu des sections', 'Section preview'],
  ["Plan d'usinage", 'Machining plan'], ['Modifier les dimensions', 'Edit dimensions'],
  ['Glissez un repère orange : tous se déplacent ensemble. Les cases affichent ou masquent les sections, sans changer les exports.', 'Drag an orange marker to move all reference holes together. Checkboxes show or hide sections without changing the exported files.'],
  ['Navigation du plan de tiling', 'Section plan navigation'],
  ['Gardez le même zéro XY. Les trous doivent rester dans une partie du panneau qui ne sera pas détachée. Pour repositionner : broche arrêtée, alignez le trou avec une pige lisse, rebridez puis dégagez l’outil avant de bouger en XY. Vérifiez que la hauteur de dégagement passe au-dessus des brides et faites un essai à vide.', 'Keep the same XY zero. Reference holes must stay in stock that will not be cut free. To reposition: stop the spindle, align the hole with a smooth pin, reclamp, then retract the tool before any XY movement. Check clearance above all clamps and perform a dry run.'],
  ['Repère et téléchargement', 'Reference hole and download'], ['Coordonnées du repère', 'Reference hole coordinates'],
  ['X du repère (mm)', 'Reference X (mm)'], ['Y du repère dans la première section (mm)', 'Reference Y in the first section (mm)'],
  ['Télécharger les sections (.zip)', 'Download sections (.zip)'], ['G-code source importé', 'Imported source G-code'],
  ['Glisser le repère orange pour le déplacer, ou saisir X et Y dans les champs prévus.', 'Drag the orange reference marker, or enter X and Y in the fields.'],
  ['Saisir le halo et glisser pour déplacer tous les repères', 'Drag the halo to move all reference holes'],
  ['Minimum {0} mm (plaque comprise)', 'Minimum {0} mm (including workpiece)'],
  ['Minimum théorique pour le repère : {0} mm ; sans tiling : {1} mm', 'Theoretical reference minimum: {0} mm; without sectioning: {1} mm'],
  ['Minimum selon le G-code : {0} mm', 'Minimum from G-code: {0} mm'],
  ['{0} · parcours X0–{1} / Y0–{2} mm', '{0} · toolpaths X0–{1} / Y0–{2} mm'],
  ['{0} section(s) prévues · avancement {1} mm · recouvrement {2} mm. Les dimensions et le nombre de sections sont actualisés en direct.', '{0} planned section(s) · advance {1} mm · overlap {2} mm. Dimensions and section count update live.'],
  ['Plan refusé : {0}', 'Plan rejected: {0}'],
  ['Trouvez vos vitesses de coupe', 'Find your feeds and speeds'], ['Vitesses de coupe CNC', 'CNC feeds and speeds'],
  ['Renseignez votre outil, votre matériau et votre broche. Les estimations se mettent à jour à chaque modification, sans bouton de calcul.', 'Enter your tool, material and spindle settings. Estimates update as you type — no calculate button needed.'],
  ['Vos paramètres', 'Your settings'], ['Unités de mesure', 'Measurement units'], ['Millimètres', 'Millimeters'], ['Pouces', 'Inches'], ['(pouces)', '(inches)'],
  ['1. Votre outil', '1. Your tool'], ['Type d’outil', 'Tool type'], ['Fraise droite', 'End mill'], ['Fraise en V', 'V-bit'], ['Foret', 'Drill'],
  ['Nombre de dents', 'Flute count'], ['Diamètre', 'Diameter'], ['2. Votre matériau', '2. Your material'], ['Épaisseur', 'Thickness'],
  ['3. Votre broche', '3. Your spindle'], ['Modèle de broche', 'Spindle model'], ['Autre broche', 'Other spindle'],
  ['Vitesse de rotation (tr/min)', 'Spindle speed (RPM)'], ['Position de la molette', 'Speed dial position'], ['Choisissez une position', 'Choose a dial position'],
  ['Vos réglages de départ', 'Your starting settings'], ['À reporter dans votre logiciel de FAO. Les valeurs suivent les unités choisies.', 'Use these in your CAM software. Values follow your selected units.'],
  ['Complétez les champs avec des valeurs valides pour obtenir une estimation.', 'Enter valid values in all fields to get an estimate.'],
  ['Vitesse d’avance XY', 'XY feed rate'], ['Profondeur par passe', 'Depth per pass'], ['Vitesse de plongée Z', 'Z plunge rate'],
  ['Une estimation, pas une garantie.', 'An estimate, not a guarantee.'],
  ['Vérifiez les préconisations du fabricant de l’outil et les limites de votre CNC. Commencez par un essai prudent ; les graduations de la broche donnent une vitesse approximative.', 'Check the tool manufacturer’s recommendations and your CNC’s limits. Start with a cautious test; spindle dial markings only give an approximate speed.'],
  ['{0} % du diamètre, sans dépasser l’épaisseur du matériau.', '{0}% of the diameter, capped by material thickness.'],
  ['Rotation × nombre de dents × avance par dent.', 'RPM × flute count × chip load.'],
  ['Avance par dent réduite pour le foret.', 'Reduced chip load for drills.'], ['Avance par dent réduite pour la fraise en V.', 'Reduced chip load for V-bits.'],
  ['20 % de l’avance XY, avec réduction supplémentaire pour les plongées profondes.', '20% of the XY feed rate, reduced further for deep plunges.'],
  ['Valeur relevée au minimum du calculateur : {0}. Vérifiez l’avance par dent avec le fabricant.', 'Raised to the calculator minimum: {0}. Check chip load with the manufacturer.'],
  ['Valeur plafonnée par le calculateur à {0} ; ce n’est pas la limite de votre machine.', 'Capped by the calculator at {0}; this is not your machine’s limit.'],
  ['Position {0} · {1} tr/min (par défaut)', 'Position {0} · {1} RPM (default)'], ['Position {0} · {1} tr/min', 'Position {0} · {1} RPM'],
  ['Environ {0} tr/min ; à vérifier sur votre modèle.', 'Approximately {0} RPM; check your specific model.'],
  ['Choisissez une position de la molette.', 'Choose a speed dial position.'],
  ['Bois tendre / MDF', 'Softwood / MDF'], ['Bois dur / Contreplaqué', 'Hardwood / Plywood'], ['PVC expansé', 'PVC foam'],
  ['POM / PMMA / Polycarbonate', 'POM / PMMA / Polycarbonate'], ['Cuivre / Laiton', 'Copper / Brass'],
  ['Le fichier ne définit pas de Z de dégagement positif. Corriger le G-code source avant le découpage.', 'The file has no positive clearance Z. Correct the source G-code before sectioning.'],
  ['Les usinages doivent être du côté X/Y positif du zéro G54 initial. Exporter le fichier avec cette origine.', 'Cuts must be on the positive X/Y side of the initial G54 zero. Export the file using this origin.'],
  ['Renseigner la largeur et la hauteur réelles de la plaque, en mm.', 'Enter the actual workpiece width and height in mm.'],
  ['La plaque dépasse la largeur utile X : le déplacement est possible uniquement suivant Y.', 'The workpiece exceeds usable X travel: repositioning is only supported along Y.'],
  ['La largeur utile X doit être positive.', 'Usable X width must be positive.'], ['Valeur positive requise : {0}.', 'A positive value is required: {0}.'], ['Marge invalide.', 'Invalid margin.'],
  ['Le repère doit avoir des coordonnées finies et un X positif ou nul.', 'Reference coordinates must be finite, with X greater than or equal to zero.'],
  ['Le repère dépasse la largeur utile X.', 'The reference exceeds usable X travel.'],
  ["Placer le repère plus haut dans la première section pour permettre le glissement. La position d'alignement et le dégagement sont calculés automatiquement.", 'Place the reference higher in the first section to allow repositioning. Alignment and clearance are calculated automatically.'],
  ['Le centre du repère ne peut pas dépasser la hauteur utile Y maximale.', 'The reference center cannot exceed maximum usable Y travel.'],
  ["Le parcours dépasse les dimensions de la plaque. Vérifier les dimensions et l'origine du G-code.", 'The toolpath exceeds the workpiece dimensions. Check the dimensions and G-code origin.'],
  ["Plus de 100 sections : vérifier les positions d'indexation et la course Y.", 'More than 100 sections: check indexing positions and Y travel.'],
  ["Aucune descente d'usinage exploitable dans le G-code pour déduire la plongée et les passes du repère.", 'No usable cutting descent in the G-code to determine reference-hole plunge rate and stepdown.'],
  ['Plongée ou profondeur par passe invalide, ou plus de 1000 passes de perçage.', 'Invalid plunge rate or stepdown, or more than 1,000 drilling passes.'],
  ['Le trou entier doit rester dans la largeur de la plaque.', 'The entire hole must stay within the workpiece width.'],
  ['Un trou de référence dépasse la hauteur de la plaque. Descendre le repère.', 'A reference hole exceeds the workpiece height. Move the reference down.'],
  ['Le repère croise ou approche un usinage. Veuillez le déplacer.', 'The reference intersects or is too close to a cut. Move it.'],
  ['Renseigner les coordonnées du repère avant de générer les sections.', 'Enter reference coordinates before generating sections.'],
  ['Importer un fichier .nc ou .gcode exporté depuis Carbide Create.', 'Import a .nc or .gcode file exported from Carbide Create.'],
  ['Compléter les six informations et respecter les minima indiqués sous les champs.', 'Complete all six fields and respect the minimum values shown below them.'],
  ['Aucune bande libre commune trouvée automatiquement. Renseignez les coordonnées du repère ou réservez une bande de matière dans le dessin.', 'No common clear strip was found automatically. Enter reference coordinates or reserve a strip of stock in the drawing.'],
  ["Calculer les sections d'abord.", 'Calculate the sections first.'],
  ['Ligne {0} : {1}', 'Line {0}: {1}'], ['commande après la fin du programme.', 'command after program end.'], ['syntaxe non prise en charge.', 'unsupported syntax.'],
  ['commandes {0} contradictoires.', 'conflicting {0} commands.'], ['nombre invalide.', 'invalid number.'],
  ['mouvement', 'motion'], ['unités', 'units'], ['coordonnées', 'coordinates'], ['broche', 'spindle'], ['fin', 'end'],
  ['G{0} non pris en charge (mm, absolu, plan XY uniquement).', 'G{0} is not supported (mm, absolute, XY plane only).'],
  ['{0} non pris en charge.', '{0} is not supported.'], ['{0} répété.', 'repeated {0}.'],
  ["sélection d'outil après le début des usinages : fournir un fichier par fraise.", 'tool selection after cutting starts: provide one file per cutter.'],
  ["changement d'outil : fournir un fichier par fraise.", 'tool change: provide one file per cutter.'],
  ['avance non positive.', 'feed rate must be positive.'], ['vitesse de broche non positive.', 'spindle speed must be positive.'],
  ['mouvement combiné à une fin de programme.', 'motion combined with program end.'],
  ['G21, G90 et G0/G1 requis avant les déplacements.', 'G21, G90 and G0/G1 are required before motion.'],
  ['Z source supérieur au Z de sécurité configuré.', 'Source Z exceeds the configured safe Z.'],
  ["paramètres d'arc sur mouvement rapide.", 'arc parameters on rapid motion.'], ['rapide sous la surface du panneau.', 'rapid motion below the stock surface.'],
  ["avance et broche M3/M4 S… requises pour l'usinage.", 'feed rate and M3/M4 S… spindle commands are required for cutting.'],
  ['arc : centres I/J relatifs requis, rayon R non pris en charge.', 'arc: relative I/J centers required; R radius is not supported.'],
  ["rayons d'arc incohérents.", 'inconsistent arc radii.'], ['arc trop volumineux.', 'arc requires too many segments.'],
  ["paramètres d'arc sur mouvement linéaire.", 'arc parameters on linear motion.'], ['Aucun usinage sous Z=0 dans le G-code.', 'No cuts below Z=0 in the G-code.'],
  ['Coordonnée invalide : {0}.', 'Invalid coordinate: {0}.'],
  ['La fraise doit être plus petite que les trous.', 'The cutter must be smaller than the holes.'],
  ['Le Y des nouveaux trous doit dépasser le Y de réception.', 'New-hole Y must be greater than receiving-hole Y.'],
  ['Le panneau dépasse la course X (tilling suivant Y uniquement).', 'The workpiece exceeds X travel (sectioning along Y only).'],
  ["Les trous d'indexation doivent traverser le panneau pour recevoir les tourillons du martyr.", 'Indexing holes must pass through the workpiece to accept the spoilboard pins.'],
  ['Coordonnées des trous latéraux invalides.', 'Invalid side-hole coordinates.'],
  ["Indiquer exactement deux abscisses d'indexation.", 'Enter exactly two indexing X coordinates.'],
  ['Un trou dépasse les courses de la machine.', 'A hole exceeds the machine travel.'],
  ['Le guidage latéral doit rester à gauche du panneau.', 'The side guide must stay to the left of the workpiece.'],
  ["Les trous d'indexation doivent être à l'intérieur du panneau.", 'Indexing holes must stay inside the workpiece.'],
  ['Deux trous se chevauchent.', 'Two holes overlap.'],
  ['Paramètres trop fins : plus de 1000 sections/passes ou rapport trou/fraise > 100.', 'Parameters are too fine: more than 1,000 sections/passes or hole/cutter ratio > 100.'],
  ['Le G-code dépasse les dimensions du panneau (origine attendue en bas à gauche).', 'G-code exceeds the workpiece dimensions (origin expected at the bottom left).'],
  ['La fraise dépasse la course X.', 'The cutter exceeds X travel.'],
  ['Le G-code descend de plus de 1 mm sous le panneau.', 'G-code goes more than 1 mm below the workpiece.'],
  ["La fraise dépasse la course Y : ajuster la réception et l'avancement.", 'The cutter exceeds Y travel: adjust receiving position and advance.'],
  ["Section {0} : un usinage croise un trou de guidage ou d'indexation. Déplacer les trous ou le parcours.", 'Section {0}: a cut intersects a guide or indexing hole. Move the holes or toolpath.'],
  ["Le panneau est trop court pour les derniers trous d'indexation complets.", 'The workpiece is too short for the final complete indexing holes.'],
];

const normalizeLanguageText = (text) => text.replace(/\s+/g, ' ').trim();
const languageRules = languagePairs.map((pair) => pair.map((text) => {
  const normalized = normalizeLanguageText(text);
  const pattern = normalized.split(/(\{\d+\})/).map((part) => /^\{\d+\}$/.test(part) ? '(.+?)' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
  return { text: normalized, pattern: new RegExp(`^${pattern}$`) };
}));
const orderedLanguageRules = [0, 1].map((target) => [...languageRules].sort((a, b) =>
  b[1 - target].text.replace(/\{\d+\}/g, '').length - a[1 - target].text.replace(/\{\d+\}/g, '').length));

function translateLanguageText(text, language, depth = 0) {
  const normalized = normalizeLanguageText(text);
  const target = language === 'fr' ? 0 : 1;
  for (const rule of orderedLanguageRules[target]) {
    const match = normalized.match(rule[1 - target].pattern);
    if (match) return rule[target].text.replace(/\{(\d+)\}/g, (_, index) => depth < 3 ? translateLanguageText(match[Number(index) + 1], language, depth + 1) : match[Number(index) + 1]);
  }
  // Help text is composed of independent sentences; retain each sentence's meaning.
  if (depth === 0 && normalized.includes('. ')) return normalized.split(/(?<=\.) /).map((part) => translateLanguageText(part, language, 1)).join(' ');
  return text;
}

if (typeof module !== 'undefined') module.exports = { translateLanguageText, languagePairs };

if (typeof window !== 'undefined' && typeof MutationObserver !== 'undefined') {
  let language = 'en';
  try { language = localStorage.getItem('cnc-language') === 'fr' ? 'fr' : 'en'; } catch { /* Storage may be unavailable on local files. */ }
  const originals = new WeakMap();
  const attributes = ['aria-label', 'title', 'placeholder', 'aria-valuetext'];
  function translateSlot(node, key, value, write) {
    let slots = originals.get(node);
    if (!slots) { slots = {}; originals.set(node, slots); }
    if (!slots[key] || slots[key].rendered !== value) slots[key] = { source: value, rendered: value };
    const slot = slots[key];
    const translated = translateLanguageText(slot.source, language);
    const next = translated === slot.source ? slot.source : slot.source.replace(slot.source.trim(), translated.trim());
    slot.rendered = next;
    if (value !== next) write(next);
  }
  function translateTree(root) {
    if (root.nodeType === 3) {
      if (!root.parentElement?.closest('script, style, textarea, [data-no-translate], .toolpath-name, #toolpath-modal-title')) {
        translateSlot(root, 'text', root.nodeValue, (value) => { root.nodeValue = value; });
      }
      return;
    }
    if (root.nodeType !== 1 && root.nodeType !== 9) return;
    if (root.nodeType === 1) {
      if (root.matches('script, style, [data-no-translate]')) return;
      for (const attribute of attributes) if (root.hasAttribute(attribute)) translateSlot(root, attribute, root.getAttribute(attribute), (value) => root.setAttribute(attribute, value));
      if (root.hasAttribute('lang')) root.lang = language;
    }
    for (const child of root.childNodes) translateTree(child);
  }
  function setLanguage(value, persist = true) {
    language = value === 'fr' ? 'fr' : 'en';
    if (persist) try { localStorage.setItem('cnc-language', language); } catch { /* Keep the switch usable without storage. */ }
    document.documentElement.lang = language;
    translateTree(document.documentElement);
    const button = document.getElementById('language-toggle');
    if (button) {
      button.textContent = language === 'en' ? 'EN / fr' : 'en / FR';
      button.setAttribute('aria-label', language === 'en' ? 'Switch to French' : 'Passer en anglais');
      button.title = language === 'en' ? 'Passer en français' : 'Switch to English';
    }
    for (const frame of document.querySelectorAll('iframe')) syncFrameLanguage(frame);
  }
  function syncFrameLanguage(frame) {
    // Local-file iframes may have opaque origins: messaging works without DOM access.
    frame.contentWindow?.postMessage({ type: 'cnc-language', language }, '*');
  }
  window.CncLanguage = { setLanguage, get language() { return language; } };
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList') for (const node of mutation.addedNodes) translateTree(node);
      else translateTree(mutation.target);
    }
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: attributes });
  document.getElementById('language-toggle')?.addEventListener('click', () => setLanguage(language === 'en' ? 'fr' : 'en'));
  for (const frame of document.querySelectorAll('iframe')) frame.addEventListener('load', () => syncFrameLanguage(frame));
  window.addEventListener('message', (event) => {
    if (event.data?.type === 'cnc-language' && event.source === window.parent && window.parent !== window
      && ['en', 'fr'].includes(event.data.language)) setLanguage(event.data.language, false);
    if (event.data?.type === 'cnc-language-ready') {
      for (const frame of document.querySelectorAll('iframe')) if (event.source === frame.contentWindow) syncFrameLanguage(frame);
    }
  });
  window.addEventListener('storage', (event) => { if (event.key === 'cnc-language') setLanguage(event.newValue, false); });
  setLanguage(language, false);
  if (window.parent && window.parent !== window) window.parent.postMessage({ type: 'cnc-language-ready' }, '*');
}
