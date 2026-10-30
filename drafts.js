// Message generator: a ready-to-paste email, Facebook/Instagram message, phone script or
// walk-in script for one business. Every part has several wordings; the one used depends on
// the business (so neighbours never get identical emails) and on the "Autre version" counter.
(() => {
  'use strict';

  const deTown = (c) => /^Le /.test(c) ? `du ${c.slice(3)}` : /^Les /.test(c) ? `des ${c.slice(4)}` : /^[aeiouyhâéèêîôû]/i.test(c) ? `d'${c}` : `de ${c}`;
  const aTown = (c) => /^Le /.test(c) ? `au ${c.slice(3)}` : /^Les /.test(c) ? `aux ${c.slice(4)}` : `à ${c}`;
  const queName = (n) => /^[aeiouyhâéèêîôû]/i.test(n) ? `qu'${n}` : `que ${n}`;

  // Small stable hash so each business gets its own default wording.
  const hash = (str) => [...str].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const pick = (options, seed, salt) => options[(seed + salt * 7) % options.length];

  function context(lead, settings, sectors, defaultDemo) {
    const sector = sectors.find((s) => s.id === lead.sector);
    const ownDemo = settings.demos?.[lead.sector];
    return {
      me: settings.name || '[votre nom]',
      area: settings.area ? ` ${settings.area}` : '',
      name: lead.name,
      city: lead.city,
      sector,
      net: lead.facebook ? 'Facebook' : lead.instagram ? 'Instagram' : '',
      demo: ownDemo || defaultDemo,
      demoIsOwnSector: !!ownDemo,
      signature: [settings.name || '[votre nom]', settings.phone, settings.page].filter(Boolean),
    };
  }

  // Short on purpose (~80 words): who I am, why them, one example, one yes/no question.
  function email(c, seed) {
    const subject = pick([
      `Site internet pour ${c.name}`,
      `Question pour ${c.name}`,
      `${c.name} : une petite idée`,
    ], seed, 1);

    const intro = pick([
      `Je m'appelle ${c.me}, je crée des sites internet pour les entreprises locales${c.area}. En regardant ${c.sector.scan} ${deTown(c.city)} sur OpenStreetMap, j'ai vu ${queName(c.name)} n'avait pas encore de site.`,
      `Je suis ${c.me}, je fais des sites internet pour les commerçants et artisans${c.area}. J'ai vu sur OpenStreetMap ${queName(c.name)} n'avait pas encore de site internet.`,
      `Je m'appelle ${c.me} et je crée des sites internet${c.area}. En cherchant ${c.sector.scan} ${deTown(c.city)} sur OpenStreetMap, j'ai remarqué ${queName(c.name)} n'avait pas de site.`,
    ], seed, 2);

    // One concrete benefit; a nod to their Facebook/Instagram page when they have one.
    const value = c.net
      ? pick([
        `Votre page ${c.net} est déjà là : un site la complète, et aide vos clients à découvrir ${c.sector.pitch}.`,
        `Un site, en plus de votre page ${c.net}, aiderait vos clients à découvrir ${c.sector.pitch}.`,
      ], seed, 3)
      : pick([
        `Un site simple aiderait vos clients à découvrir ${c.sector.pitch}.`,
        `Un site clair aide les gens qui vous cherchent à découvrir ${c.sector.pitch}.`,
      ], seed, 3);

    const example = pick([
      `Un exemple de mon travail : ${c.demo}`,
      `Pour vous faire une idée, un site que j'ai réalisé : ${c.demo}`,
    ], seed, 5);

    // A question that can be answered with "oui" in two seconds.
    const ask = pick([
      `Voulez-vous que je vous prépare une maquette gratuite pour ${c.sector.place}, sans engagement ?`,
      `Je peux vous préparer une maquette gratuite pour ${c.sector.place}, sans engagement. Ça vous dirait ?`,
      `Seriez-vous d'accord pour que je vous montre une maquette gratuite, sans engagement ?`,
    ], seed, 6);

    const closing = pick(['Bonne journée,', 'Belle journée,'], seed, 7);

    const body = [
      'Bonjour,', '',
      intro, '',
      value, example, '',
      ask, '',
      closing,
      ...c.signature,
    ].join('\n');
    return { subject, body };
  }

  function dm(c, seed) {
    const body = pick([
      `Bonjour ! Je m'appelle ${c.me}, je crée des sites internet pour les entreprises ${deTown(c.city)}. J'ai vu ${queName(c.name)} n'avait pas encore de site : je peux vous préparer une maquette gratuite pour ${c.sector.place}, sans engagement. Un exemple de ce que je fais : ${c.demo}\n\nÇa pourrait vous intéresser ? Si ce n'est pas le moment, pas de souci.`,
      `Bonjour, je suis ${c.me}, je fais des sites internet pour les commerçants et les artisans ${deTown(c.city)}. ${c.name} n'a pas encore de site : si vous voulez, je vous montre gratuitement à quoi il pourrait ressembler. Exemple : ${c.demo}\n\nBonne journée, et pas de souci si ce n'est pas le moment !`,
    ], seed, 8);
    return { subject: '', body };
  }

  function phone(c) {
    return {
      subject: '',
      body: [
        `« Bonjour, je suis bien chez ${c.name} ? Je m'appelle ${c.me}, je crée des sites internet pour les entreprises ${deTown(c.city)}. Je vous dérange deux minutes ? »`,
        '',
        `→ « J'ai vu que vous n'aviez pas encore de site internet. C'est quelque chose auquel vous avez déjà pensé ? »`,
        '',
        `→ Si oui : « Je peux vous préparer une maquette gratuite, sans engagement. Je vous envoie un exemple par e-mail ou par SMS ? » (exemple : ${c.demo})`,
        '',
        '→ Si non : « Pas de souci, merci de votre temps, bonne journée ! » (et marquez « Pas intéressé »)',
        '',
        'Conseil : appelez à une heure calme, jamais pendant le rush.',
      ].join('\n'),
    };
  }

  function visit(c) {
    return {
      subject: '',
      body: [
        `« Bonjour ! Je m'appelle ${c.me}, je crée des sites internet pour les entreprises ${deTown(c.city)}. Je passais vous montrer un exemple, ça prend une minute. »`,
        '',
        `→ Montrez le site sur votre téléphone : ${c.demo}`,
        '',
        `→ « Vous avez déjà pensé à avoir un site pour ${c.sector.place} ? Si ça vous intéresse, je vous prépare une maquette gratuite, sans engagement, et je repasse vous la montrer. »`,
        '',
        'Conseil : passez à une heure calme, et laissez votre contact (une carte ou un papier avec votre e-mail).',
      ].join('\n'),
    };
  }

  window.Drafts = {
    KINDS: [
      ['email', '✉️ E-mail'],
      ['dm', '💬 Facebook / Instagram'],
      ['phone', '📞 Téléphone'],
      ['visit', '🚶 Sur place'],
    ],
    /** Message kinds that make sense for this business, best first. */
    kindsFor: (lead) => [
      lead.emails.length && 'email',
      (lead.facebook || lead.instagram) && 'dm',
      lead.phones.length && 'phone',
      // Walk-in only where there is a shopfront: not for builders and tradespeople.
      lead.sector !== 'batiment' && lead.street && 'visit',
    ].filter(Boolean),
    generate(lead, kind, variant, settings, sectors, defaultDemo) {
      const c = context(lead, settings, sectors, defaultDemo);
      const seed = hash(lead.id) + variant;
      return { email, dm, phone, visit }[kind](c, seed);
    },
    deTown, aTown, queName,
  };
})();
