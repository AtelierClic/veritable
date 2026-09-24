# world-2026 — entités de facto et régions contestées au 1er janvier 2026

Écrit le 2026-09-24 par Claude Code (J6b), en l'absence de Lukas. **Tout ce fichier est « à valider ».**

## Règle

Une entité qui contrôle durablement — au moins un an au 1er janvier 2026 — un territoire peuplé d'au moins une tuile de la carte est une nation du scénario, reconnue ou non, avec sa liste de reconnaissances (consigne du 2026-09-24). Le critère est le contrôle, pas la revendication d'indépendance : une autorité rivale qui se dit gouvernement de tout le pays (Yémen, Libye, Soudan) est une nation au même titre qu'une sécession. Les tuiles qu'elle contrôle lui appartiennent ; celles que revendique quelqu'un d'autre forment une région contestée (contrôleur lu sur la carte, revendiquants, reconnaissances).

Un conflit interne sans entité de facto ne crée pas de nation : il réduit la stabilité de la nation touchée, sans guerre (`internalConflicts` du scénario, 24 nations).

Deux précisions de lecture, prises en session :

- **« Durablement »** s'applique à l'entité, pas à chaque tuile : une entité qui tient un territoire depuis plus d'un an garde au 1er janvier 2026 ses prises plus récentes (Goma pour l'AFC/M23, El-Facher pour les Forces de soutien rapide).
- **Une autonomie accordée par l'État** (Kurdistan irakien, États fédérés de Somalie, Bougainville, région Wa du Myanmar dans sa part reconnue) n'est pas une entité de facto : le territoire reste à l'État.

Sources des polygones : Natural Earth v5.1.2 (zones contestées `ne_10m_admin_0_disputed_areas`, pays `ne_10m_admin_0_countries`, provinces `ne_10m_admin_1_states_provinces`). Les lignes de contrôle récentes absentes de Natural Earth sont tracées à la main et marquées `approximate` dans `data/veritable/borders/overrides/giantworldmap.geojson`.

Sources des reconnaissances : tableaux des articles « International recognition of … » de Wikipédia en anglais. L'outil lit le texte wiki et retient les reconnaissances et les retraits datés d'avant le 1er janvier 2026. Ces listes sont recoupées avec les ministères qui publient la leur. Les chiffres économiques des entités sont des estimations (`estimates.json → defacto`) : une part de la nation mère pour celles que couvrent ses séries, des ordres de grandeur publics pour les autres.

## Entités retenues (13)

| Code  | Entité                                                    | Contrôle depuis    | Tuiles | Revendiquée par | Reconnue par                               | Protecteur (garantie du scénario)                 |
| ----- | --------------------------------------------------------- | ------------------ | -----: | --------------- | ------------------------------------------ | ------------------------------------------------- |
| `TWN` | Taïwan (République de Chine)                              | 1949               |    364 | Chine           | 12 (11 membres de l'ONU et le Saint-Siège) | États-Unis, 0,5                                   |
| `XKX` | Kosovo                                                    | 1999 (2008)        |    160 | Serbie          | 105 membres de l'ONU                       | États-Unis, 0,3                                   |
| `CYN` | Chypre du Nord                                            | 1974 (1983)        |     33 | Chypre          | Turquie                                    | Turquie, 0,95                                     |
| `ABK` | Abkhazie                                                  | 1993               |    110 | Géorgie         | Russie, Nicaragua, Venezuela, Syrie        | Russie, 0,9                                       |
| `SOS` | Ossétie du Sud                                            | 1992 (2008)        |     66 | Géorgie         | Russie, Nicaragua, Venezuela, Syrie        | Russie, 0,9                                       |
| `PMR` | Transnistrie                                              | 1992               |     49 | Moldavie        | aucun membre de l'ONU                      | Russie, 0,4                                       |
| `SOL` | Somaliland                                                | 1991               |  1 828 | Somalie         | Israël (26 décembre 2025)                  | —                                                 |
| `ESH` | République arabe sahraouie démocratique (Front Polisario) | 1991 (est du mur)  |  1 075 | Maroc           | 34 membres de l'ONU, membre de l'UA        | Algérie, 0,3                                      |
| `YEH` | Yémen (Ansar Allah)                                       | 2014-2015          |  1 356 | Yémen           | aucun                                      | — (Iran : relations +70)                          |
| `LBE` | Libye orientale (Chambre des représentants, ANL)          | 2014 (Fezzan 2019) | 16 940 | Libye           | aucun                                      | — (Égypte, Émirats, Russie : relations +50 à +60) |
| `SDR` | Soudan (Forces de soutien rapide, alliance Tasis)         | 2023               |  6 595 | Soudan          | aucun                                      | — (en guerre contre le Soudan)                    |
| `RJV` | Nord-Est syrien (AANES, Forces démocratiques syriennes)   | 2012-2015          |    674 | Syrie           | aucun                                      | — (États-Unis : relations +50)                    |
| `M23` | Congo oriental (Alliance Fleuve Congo / M23)              | 2022 (Goma 2025)   |    215 | RD Congo        | aucun                                      | Rwanda, 0,5 (en guerre contre la RD Congo)        |

Justification entité par entité :

- **Taïwan.** La République de Chine administre Taïwan, les Penghu, Kinmen et Matsu depuis 1949. C'est un État de fait complet (armée, monnaie, élections), et la Chine le revendique. Reconnaissances au 1er janvier 2026 : onze États membres de l'ONU et le Saint-Siège (Nauru a rompu en janvier 2024). Absent des séries de la Banque mondiale : chiffres publics 2024-2025.
- **Kosovo.** Administré hors de l'autorité serbe depuis 1999 (MINUK), indépendant depuis la déclaration du 17 février 2008. Reconnu par 105 membres de l'ONU ; huit retraits signalés par la Serbie ont été écartés faute de confirmation par les États eux-mêmes. La KFOR de l'OTAN (camp Bondsteel) justifie une garantie américaine faible.
- **Chypre du Nord.** Tenue depuis l'intervention turque de 1974, proclamée en 1983. Reconnue par la seule Turquie, qui stationne environ 35 000 soldats dans l'île (comptés pour la Turquie).
- **Abkhazie, Ossétie du Sud.** Sécessions de 1992-1993, reconnues par la Russie après la guerre de 2008, avec des bases russes et des accords d'assistance mutuelle. Leur budget est en grande partie financé par la Russie, ce que le jeu ne modélise pas : recettes et dépenses sont équilibrées. La reconnaissance syrienne date du régime Assad (2018) ; aucun retrait n'était formalisé au 1er janvier 2026.
- **Transnistrie.** De facto depuis la guerre de 1992. Aucun État membre de l'ONU ne la reconnaît, pas même la Russie, qui y garde environ 1 500 hommes (garantie de 0,4 : pas de continuité territoriale).
- **Somaliland.** Indépendant de fait depuis 1991, avec ses institutions et ses élections (alternance en 2024). Israël l'a reconnu le 26 décembre 2025. Il reçoit un quart de la population et 30 % de l'activité de la Somalie dans ses séries.
- **République arabe sahraouie démocratique.** Le Front Polisario tient la zone à l'est du mur des sables depuis le cessez-le-feu de 1991, qu'il a rompu en novembre 2020. Membre de l'Union africaine, reconnu par 34 membres de l'ONU. Sa population administrée vit surtout dans les camps de Tindouf, en Algérie : elle est comptée avec la zone (environ 180 000 personnes). Le Sahara à l'ouest du mur est une région contestée tenue par le Maroc.
- **Yémen (Ansar Allah).** Le Conseil politique suprême de Sanaa tient le nord-ouest peuplé depuis septembre 2014 (Sanaa) et 2015. Sept Yéménites sur dix y vivent, mais aucun champ de pétrole ou de gaz ne s'y trouve. Le territoire est découpé par gouvernorats entiers ; Taëz, Marib et Dhalea, partagés sur la ligne de front, restent au gouvernement reconnu. La trêve saoudo-houthie dure depuis avril 2022 : pas de guerre au scénario, relations −70 avec le Yémen.
- **Libye orientale.** Chambre des représentants, gouvernement de stabilité nationale et Armée nationale libyenne de Khalifa Haftar : Cyrénaïque depuis 2014-2016, Fezzan depuis 2019, Syrte et Joufra depuis 2020. Elle tient l'essentiel du croissant pétrolier. Le gouvernement de Tripoli, reconnu par l'ONU, est la Libye du scénario. Le cessez-le-feu d'octobre 2020 exclut toute guerre au scénario (relations −30).
- **Soudan (Forces de soutien rapide).** La guerre dure depuis avril 2023. Les FSR tiennent le Darfour depuis fin 2023 (El-Facher depuis le 26 octobre 2025) et le Kordofan-Occidental (Babanusa et Heglig en décembre 2025). Un gouvernement « de paix et d'unité » a été investi à Nyala le 30 août 2025. Guerre `sdr-sdn-2023` au scénario. Les enclaves du SPLM-N (monts Nouba) ne sont pas représentées.
- **Nord-Est syrien.** L'Administration autonome et les Forces démocratiques syriennes tiennent Hassaké, Raqqa et la rive est de l'Euphrate depuis 2012-2015, avec l'essentiel du pétrole syrien. L'accord d'intégration du 10 mars 2025 n'était pas appliqué au 1er janvier 2026, d'où des relations adoucies avec Damas (−30) plutôt qu'une guerre. La bande de Tell Abyad à Ras al-Aïn reste à la Syrie.
- **Congo oriental (AFC/M23).** Le M23 tient Rutshuru, Bunagana et Masisi depuis 2022, Goma depuis janvier 2025, Bukavu depuis février 2025. Le soutien militaire du Rwanda est documenté par le groupe d'experts de l'ONU. Guerre `m23-cod-2022` au scénario, malgré les accords de Washington (décembre 2025) et de Doha, non appliqués sur le terrain.

La **Palestine** (`PSE`) n'est pas une entité ajoutée : elle fait partie des 195 nations, État observateur à l'ONU reconnu par 158 membres, dont la vague de septembre 2025. Son territoire est la Cisjordanie hors de la vallée du Jourdain, plus Gaza. La vallée du Jourdain et Jérusalem-Est, tenues par Israël, sont des régions qu'elle revendique.

## Entités examinées et écartées

- **Haut-Karabakh** : la république d'Artsakh s'est dissoute le 1er janvier 2024 après l'offensive azerbaïdjanaise de septembre 2023. Le territoire est azerbaïdjanais et n'est plus contesté (DESIGN.md corrigé au J6a).
- **Républiques populaires de Donetsk et de Louhansk, oblasts occupés de Zaporijjia et de Kherson** : annexés par la Russie en septembre 2022 et administrés comme des sujets russes. Ils sont russes au scénario, dans les régions contestées `crimea` et `ukraine-occupied-mainland` revendiquées par l'Ukraine. La Russie revendique en retour le reste des quatre oblasts (`ukraine-oblasts-claimed-by-russia`, validé par Lukas le 2026-09-24).
- **Hamas à Gaza** : Gaza tient en 4 ou 5 tuiles et reste palestinienne. Le contrôle israélien d'environ la moitié de la bande depuis le cessez-le-feu d'octobre 2025 a moins d'un an et n'est pas représentable. Il est rendu par le conflit interne de la Palestine (intensité 0,5).
- **Myanmar** (Armée d'Arakan, KIA, TNLA, MNDAA, Forces de défense du peuple, État wa de l'UWSA) : une dizaine de groupes, des lignes mouvantes (Lashio rendue à la junte en avril 2025 sous pression chinoise), aucune source cartographique. Conflit interne d'intensité 0,8. **À valider en priorité** : l'État wa et le nord de l'Arakan remplissent le critère de durée, ils sont écartés pour la seule raison qu'on ne sait pas tracer leurs lignes.
- **Al-Chabab** (Somalie), **JNIM et État islamique au Sahel** (Mali, Burkina Faso, Niger), **ISWAP et Boko Haram** (Nigeria, lac Tchad) : contrôle diffus des campagnes, sans administration ni ligne délimitable à cette résolution. Rendus par des conflits internes.
- **Puntland, Jubaland** : États fédérés de Somalie qui ne revendiquent pas l'indépendance, même si le Puntland ne reconnaît plus le gouvernement fédéral depuis mars 2024. Ils restent somaliens (conflit interne de la Somalie).
- **Kurdistan irakien** : autonomie constitutionnelle de l'Irak.
- **Soueïda** (factions druzes depuis juillet 2025) : moins d'un an.
- **Conseil de transition du Sud** (Yémen) : membre du Conseil présidentiel du gouvernement reconnu ; son offensive de décembre 2025 dans le Hadramaout et le Mahra a moins d'un an. Territoire du Yémen, avec un conflit interne.
- **Tigré** : administration intérimaire dans l'Éthiopie depuis l'accord de Pretoria (2022) ; conflit interne de l'Éthiopie.
- **Gangs d'Haïti** (Viv Ansanm) : aucune administration de type étatique ; conflit interne.
- **Bougainville** : région autonome de Papouasie-Nouvelle-Guinée, indépendance non proclamée.
- **Idlib** : le pouvoir de Hayat Tahrir al-Cham est devenu le gouvernement syrien en décembre 2024.
- **Cabinda** : aucun contrôle territorial durable du FLEC.

## Régions contestées (31)

Le contrôleur est lu sur la carte chaque jour. « Reconnue » liste les nations qui reconnaissent la souveraineté du contrôleur sur la région ; pour le territoire d'une entité de facto, celles qui reconnaissent l'entité.

| Région                              | Contrôleur  | Revendiquants | Reconnue par                        | Tuiles | Source                                                          |
| ----------------------------------- | ----------- | ------------- | ----------------------------------- | -----: | --------------------------------------------------------------- |
| `crimea`                            | Russie      | Ukraine       | —                                   |    305 | Natural Earth                                                   |
| `ukraine-occupied-mainland`         | Russie      | Ukraine       | —                                   |  1 309 | tracé à la main (J1)                                            |
| `ukraine-oblasts-claimed-by-russia` | Ukraine     | Russie        | —                                   |  1 533 | Natural Earth, provinces                                        |
| `abkhazia`                          | `ABK`       | Géorgie       | Russie, Nicaragua, Venezuela, Syrie |    110 | Natural Earth                                                   |
| `south-ossetia`                     | `SOS`       | Géorgie       | Russie, Nicaragua, Venezuela, Syrie |     66 | Natural Earth                                                   |
| `transnistria`                      | `PMR`       | Moldavie      | —                                   |     49 | Natural Earth                                                   |
| `kosovo`                            | `XKX`       | Serbie        | 105 membres de l'ONU                |    160 | Natural Earth                                                   |
| `northern-cyprus`                   | `CYN`       | Chypre        | Turquie                             |     33 | Natural Earth                                                   |
| `taiwan`                            | `TWN`       | Chine         | 12                                  |    364 | Natural Earth                                                   |
| `somaliland`                        | `SOL`       | Somalie       | Israël                              |  1 828 | Natural Earth                                                   |
| `sadr-free-zone`                    | `ESH`       | Maroc         | 34 membres de l'ONU                 |  1 075 | Natural Earth                                                   |
| `western-sahara-moroccan`           | Maroc       | `ESH`         | États-Unis, Israël                  |  2 053 | Natural Earth                                                   |
| `yemen-ansar-allah`                 | `YEH`       | Yémen         | —                                   |  1 356 | Natural Earth, provinces                                        |
| `libya-east`                        | `LBE`       | Libye         | —                                   | 16 940 | Natural Earth, provinces                                        |
| `sudan-rsf`                         | `SDR`       | Soudan        | —                                   |  6 595 | Natural Earth, provinces ; Kordofan à la main                   |
| `syria-northeast`                   | `RJV`       | Syrie         | —                                   |    674 | Natural Earth, provinces ; Euphrate à la main                   |
| `kivu-afc-m23`                      | `M23`       | RD Congo      | —                                   |    215 | tracé à la main                                                 |
| `golan`                             | Israël      | Syrie         | États-Unis                          |     15 | Natural Earth                                                   |
| `syria-buffer-zone`                 | Israël      | Syrie         | —                                   |      4 | Natural Earth (zone de l'UNDOF, depuis décembre 2024)           |
| `east-jerusalem`                    | Israël      | Palestine     | —                                   |      2 | Natural Earth                                                   |
| `jordan-valley`                     | Israël      | Palestine     | —                                   |     12 | tracé à la main                                                 |
| `kashmir-indian-administered`       | Inde        | Pakistan      | —                                   |  1 340 | Natural Earth                                                   |
| `azad-kashmir`                      | Pakistan    | Inde          | —                                   |    160 | Natural Earth                                                   |
| `gilgit-baltistan`                  | Pakistan    | Inde          | —                                   |    828 | Natural Earth                                                   |
| `aksai-chin`                        | Chine       | Inde          | —                                   |    486 | Natural Earth (avec la vallée de Shaksgam)                      |
| `arunachal-pradesh`                 | Inde        | Chine         | —                                   |    866 | Natural Earth (avec les secteurs du Ladakh et de l'Uttarakhand) |
| `falkland-islands`                  | Royaume-Uni | Argentine     | —                                   |    137 | Natural Earth (avec la Géorgie du Sud)                          |
| `essequibo`                         | Guyana      | Venezuela     | —                                   |  1 539 | Natural Earth                                                   |
| `halaib-triangle`                   | Égypte      | Soudan        | —                                   |    190 | Natural Earth                                                   |
| `ilemi-triangle`                    | Kenya       | Soudan du Sud | —                                   |     31 | Natural Earth                                                   |
| `abyei`                             | Soudan      | Soudan du Sud | —                                   |    121 | Natural Earth                                                   |

Absentes faute de tuile sur la carte `giantworldmap` : les **Kouriles du Sud** (russes, revendiquées par le Japon), les **Senkaku / Diaoyu** (japonaises, revendiquées par la Chine et Taïwan) et les **fermes de Chebaa**. Ces revendications ne pèsent que dans les relations de départ (Japon–Russie −60, Japon–Chine −45).

Les revendications anciennes et apaisées (Malouines, triangles de Halaïb et d'Ilemi, Abyei, frontière sino-indienne) gardent leur région et leur casus belli. Les relations de départ n'appliquent pas la règle du revendicateur (−60) à ces paires (`estimates.json → relations`).

## Guerres en cours au 1er janvier 2026

Seules les guerres entre États ou entités de la liste figurent au scénario, d'après le programme de données sur les conflits d'Uppsala (UCDP, CC BY 4.0) et la situation connue fin 2025 :

- `rus-ukr-2022` : Russie contre Ukraine, depuis le 24 février 2022 ;
- `sdr-sdn-2023` : Forces de soutien rapide contre Soudan, depuis le 15 avril 2023 ;
- `m23-cod-2022` : AFC/M23 contre RD Congo, depuis mars 2022.

Écartées, avec la raison :

- Israël contre le Hamas : cessez-le-feu d'octobre 2025, rendu par le conflit interne de la Palestine.
- Israël contre le Hezbollah : cessez-le-feu de novembre 2024, malgré les frappes (relations Israël–Liban −60).
- Israël contre l'Iran : cessez-le-feu du 24 juin 2025 (relations −95).
- Inde contre Pakistan : cessez-le-feu du 10 mai 2025 (−70).
- Thaïlande contre Cambodge : cessez-le-feu du 27 décembre 2025 (−60).
- Maroc contre Polisario : combats de basse intensité depuis novembre 2020, sous le seuil de l'UCDP (−80, à valider).
- Yémen contre Ansar Allah : trêve depuis avril 2022 (−70).
- Syrie contre les Forces démocratiques syriennes : accord du 10 mars 2025 (−30).
- États-Unis contre le Venezuela : frappes sur des embarcations depuis septembre 2025 et blocus pétrolier de décembre 2025, sans guerre entre États (−80, à valider).

Les autres conflits actifs de l'UCDP sont internes et figurent dans `internalConflicts`.
