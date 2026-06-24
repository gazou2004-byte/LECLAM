/* =====================================================
   LE CLAM — Configuration du carousel
   Modifiez CE FICHIER pour changer les slides.

   Chaque slide a :
   ─ id         : identifiant CSS (slide-plaisir, slide-malin…)
   ─ title      : titre affiché en grand
   ─ desc       : phrase de description
   ─ badges     : tableau de tags affichés sous le titre
   ─ particles  : émojis flottants en arrière-plan
   ─ cta        : texte du bouton
   ─ href       : lien du bouton
   ─ dark       : true = texte sombre (pour fond clair type Bébé)
   ===================================================== */

const SLIDES_CONFIG = [

  /* ─── 1. PLAISIR ─────────────────────────────── */
  {
    id:         'plaisir',
    titleKey:   'cat.plaisir_title',
    title:      'Plaisir',
    descKey:    'cat.plaisir_desc',
    desc:       'Seul ou à deux, vous trouverez tout pour vos plaisirs.',
    badges:     [],
    particles:  ['◆', '◇', '▲', '◆', '◇', '▲'],
    img:        'plaisir/hero plaisir lips.png?v=5',
    ctaKey:     'home.discover',
    cta:        'Découvrir',
    href:       'plaisir.html',
    dark:       false,
  },

  /* ─── 2. MALIN ───────────────────────────────── */
  {
    id:         'malin',
    titleKey:   'cat.malin_title',
    title:      'Malin',
    descKey:    'cat.malin_desc',
    desc:       'Les achats utiles à prix malin.',
    badges:     [],
    particles:  ['◆', '◇', '▲', '◆', '◇', '▲'],
    img:        'malin/hero malin.png',
    ctaKey:     'home.discover',
    cta:        'Découvrir',
    href:       'malin.html',
    dark:       false,
  },

  /* ─── 3. BÉBÉ ────────────────────────────────── */
  {
    id:         'bebe',
    titleKey:   'cat.bebe_title',
    title:      'Bébé à Enfant',
    descKey:    'cat.bebe_desc',
    desc:       'L\'essentiel pour bébé.',
    badges:     [],
    particles:  ['◆', '◇', '▲', '◆', '◇', '▲'],
    img:        'bebe/hero bebe.png',
    ctaKey:     'home.discover',
    cta:        'Découvrir',
    href:       'bebe.html',
    dark:       true,
  },

];
