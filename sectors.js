// Business sectors: how to find them in OpenStreetMap, how to name them in French,
// and which email template to use. Order matters: a business goes to the first sector it matches.

const BUILDING_CRAFTS = 'plumber|electrician|painter|carpenter|roofer|tiler|plasterer|builder|hvac|glaziery|locksmith|stonemason|insulation|floorer|joiner|metal_construction|window_construction|gardener|landscaper|parquet_layer|scaffolder|heating_engineer|chimney_sweeper|blacksmith|cabinet_maker|kitchen_fitter';
const FOOD_SHOPS = 'bakery|pastry|butcher|cheese|deli|greengrocer|confectionery|chocolate|wine|alcohol|seafood|coffee|tea|farm|spices|convenience|beverages|health_food|organic';
// No hairdressers, barbers, beauty institutes or nail salons: they mostly book through Planity already
// (Sacha's call, 2026-10-30/31). Perfume and cosmetics shops are plain retail, so they live in Commerces.
const BEAUTY_SHOPS = 'massage|tattoo';
const AUTO_SHOPS = 'car_repair|tyres|car|motorcycle|car_parts|motorcycle_repair|caravan';
const RETAIL_SHOPS = 'perfumery|cosmetics|clothes|shoes|florist|gift|books|jewelry|optician|toys|furniture|interior_decoration|bicycle|sports|pet|garden_centre|second_hand|antiques|music|musical_instrument|art|craft|stationery|hardware|kitchen|bed|fabric|watches|bag|boutique|computer|mobile_phone|electronics|photo|variety_store|newsagent|tobacco|games|video_games|outdoor|fishing|lighting|frame|houseware|leather|baby_goods|e-cigarette|herbalist';
const SERVICE_SHOPS = 'dry_cleaning|laundry|tailor|travel_agency|copyshop|pet_grooming|shoe_repair|locksmith|funeral_directors|rental|storage_rental|repair';

const re = (alts) => new RegExp(`^(${alts})$`);

window.SECTORS = [
  {
    id: 'restaurants', place: 'votre établissement', scan: 'les restaurants et bars', label: 'Restaurants & bars', icon: '🍽️', default: true,
    query: ['nwr["amenity"~"^(restaurant|cafe|fast_food|bar|pub|ice_cream|biergarten)$"]["name"]'],
    match: (t) => /^(restaurant|cafe|fast_food|bar|pub|ice_cream|biergarten)$/.test(t.amenity),
    pitch: 'votre carte, vos horaires et l’accès, et à réserver une table',
  },
  {
    id: 'alimentation', place: 'votre commerce', scan: 'les commerces de bouche', label: 'Boulangeries & alimentation', icon: '🥖', default: true,
    query: [`nwr["shop"~"^(${FOOD_SHOPS})$"]["name"]`],
    match: (t) => re(FOOD_SHOPS).test(t.shop),
    pitch: 'vos produits, vos horaires et l’accès, et à passer commande',
  },
  {
    id: 'beaute', place: 'votre salon', scan: 'les salons de tatouage et de massage', label: 'Tatouage & massage', icon: '💆', default: true,
    query: [`nwr["shop"~"^(${BEAUTY_SHOPS})$"]["name"]`],
    match: (t) => re(BEAUTY_SHOPS).test(t.shop),
    pitch: 'vos prestations et vos tarifs, et à prendre rendez-vous en ligne',
  },
  {
    id: 'batiment', place: 'votre entreprise', scan: 'les artisans', label: 'Artisans du bâtiment', icon: '🛠️', default: true,
    query: [`nwr["craft"~"^(${BUILDING_CRAFTS})$"]["name"]`],
    match: (t) => re(BUILDING_CRAFTS).test(t.craft),
    pitch: 'vos chantiers en photos et votre zone d’intervention, et à vous demander un devis',
  },
  {
    id: 'auto', place: 'votre garage', scan: 'les garages', label: 'Garages & auto', icon: '🚗', default: true,
    query: [`nwr["shop"~"^(${AUTO_SHOPS})$"]["name"]`, 'nwr["amenity"~"^(car_wash|driving_school)$"]["name"]'],
    match: (t) => re(AUTO_SHOPS).test(t.shop) || /^(car_wash|driving_school)$/.test(t.amenity),
    pitch: 'vos prestations et vos horaires, et à vous demander un devis',
  },
  {
    id: 'commerces', place: 'votre boutique', scan: 'les commerces', label: 'Commerces', icon: '🛍️', default: true,
    query: [`nwr["shop"~"^(${RETAIL_SHOPS})$"]["name"]`],
    match: (t) => re(RETAIL_SHOPS).test(t.shop),
    pitch: 'vos produits, vos horaires et l’accès à votre boutique',
  },
  {
    id: 'services', place: 'votre entreprise', scan: 'les entreprises', label: 'Services & artisanat', icon: '🧰', default: true,
    query: [
      `nwr["shop"~"^(${SERVICE_SHOPS})$"]["name"]`,
      'nwr["craft"]["name"]',
      'nwr["office"~"^(estate_agent|insurance|accountant|architect|lawyer|notary|tax_advisor)$"]["name"]',
    ],
    match: (t) => re(SERVICE_SHOPS).test(t.shop) || !!t.craft || !!t.office,
    pitch: 'vos services et vos coordonnées, et à vous contacter facilement',
  },
  {
    id: 'sante', place: 'votre cabinet', scan: 'les professionnels de santé et de bien-être', label: 'Santé & bien-être', icon: '🧘', default: false,
    query: ['nwr["healthcare"]["healthcare"!="pharmacy"]["name"]', 'nwr["leisure"="fitness_centre"]["name"]'],
    match: (t) => (!!t.healthcare && t.healthcare !== 'pharmacy') || t.leisure === 'fitness_centre',
    pitch: 'vos consultations et vos informations pratiques, et à prendre rendez-vous',
  },
];

// French names for the most common OpenStreetMap types. Anything missing falls back to the raw tag.
window.TYPE_LABELS = {
  restaurant: 'Restaurant', cafe: 'Café', fast_food: 'Restauration rapide', bar: 'Bar', pub: 'Pub', ice_cream: 'Glacier', biergarten: 'Brasserie',
  bakery: 'Boulangerie', pastry: 'Pâtisserie', butcher: 'Boucherie', cheese: 'Fromagerie', deli: 'Traiteur', greengrocer: 'Primeur',
  confectionery: 'Confiserie', chocolate: 'Chocolatier', wine: 'Cave à vin', alcohol: 'Cave', seafood: 'Poissonnerie', coffee: 'Torréfacteur',
  tea: 'Salon de thé', farm: 'Produits de la ferme', convenience: 'Épicerie', health_food: 'Bio', organic: 'Bio', spices: 'Épices', beverages: 'Boissons',
  hairdresser: 'Coiffeur', beauty: 'Institut de beauté', cosmetics: 'Cosmétiques', massage: 'Massage', tattoo: 'Tatoueur', perfumery: 'Parfumerie',
  plumber: 'Plombier', electrician: 'Électricien', painter: 'Peintre', carpenter: 'Charpentier', roofer: 'Couvreur', tiler: 'Carreleur',
  plasterer: 'Plâtrier', builder: 'Maçon', hvac: 'Chauffagiste', glaziery: 'Vitrier', locksmith: 'Serrurier', stonemason: 'Tailleur de pierre',
  insulation: 'Isolation', floorer: 'Solier', joiner: 'Menuisier', metal_construction: 'Métallier', window_construction: 'Menuiserie',
  gardener: 'Jardinier', landscaper: 'Paysagiste', cabinet_maker: 'Ébéniste', kitchen_fitter: 'Cuisiniste', chimney_sweeper: 'Ramoneur', blacksmith: 'Forgeron',
  car_repair: 'Garage', tyres: 'Pneus', car: 'Concession auto', motorcycle: 'Moto', car_parts: 'Pièces auto', motorcycle_repair: 'Garage moto',
  car_wash: 'Lavage auto', driving_school: 'Auto-école',
  clothes: 'Vêtements', shoes: 'Chaussures', florist: 'Fleuriste', gift: 'Cadeaux', books: 'Librairie', jewelry: 'Bijouterie', optician: 'Opticien',
  toys: 'Jouets', furniture: 'Meubles', interior_decoration: 'Décoration', bicycle: 'Vélos', sports: 'Sport', pet: 'Animalerie',
  garden_centre: 'Jardinerie', second_hand: 'Dépôt-vente', antiques: 'Antiquaire', music: 'Disquaire', musical_instrument: 'Instruments',
  art: 'Galerie d’art', craft: 'Loisirs créatifs', stationery: 'Papeterie', hardware: 'Quincaillerie', computer: 'Informatique',
  mobile_phone: 'Téléphonie', electronics: 'Électronique', photo: 'Photo', newsagent: 'Presse', tobacco: 'Tabac', fabric: 'Tissus',
  dry_cleaning: 'Pressing', laundry: 'Laverie', tailor: 'Retouches', travel_agency: 'Agence de voyages', copyshop: 'Imprimerie',
  pet_grooming: 'Toilettage', shoe_repair: 'Cordonnier', funeral_directors: 'Pompes funèbres', estate_agent: 'Agence immobilière',
  insurance: 'Assurance', accountant: 'Expert-comptable', architect: 'Architecte', lawyer: 'Avocat', notary: 'Notaire',
  photographer: 'Photographe', caterer: 'Traiteur', dressmaker: 'Couturière', upholsterer: 'Tapissier', shoemaker: 'Cordonnier',
  watchmaker: 'Horloger', key_cutter: 'Clés minute', fitness_centre: 'Salle de sport', physiotherapist: 'Kinésithérapeute',
  psychotherapist: 'Psychothérapeute', doctor: 'Médecin', dentist: 'Dentiste', osteopath: 'Ostéopathe', alternative: 'Médecine douce',
  electronics_repair: 'Réparation électronique', computer_repair: 'Réparation informatique', jeweller: 'Bijoutier', brewery: 'Brasserie artisanale',
  winery: 'Domaine viticole', beekeeper: 'Apiculteur', bookbinder: 'Relieur', confectionery_craft: 'Confiseur', pottery: 'Potier', glass: 'Verrier',
  printer: 'Imprimeur', sign_maker: 'Enseignes', tattoo_artist: 'Tatoueur', nail_salon: 'Onglerie', repair: 'Réparation', variety_store: 'Bazar',
};
