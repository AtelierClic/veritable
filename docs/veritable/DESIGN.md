# Véritable — document de conception

Version du 21 septembre 2026. Copie de l'artefact Claude « Véritable — document de conception » ; l'artefact est la version vivante, ce fichier se réexporte quand il change.

Véritable est un grand strategy géopolitique du monde de 2026, solo, sans condition de victoire, construit sur le code d'OpenFront.io et distribué gratuitement en application Windows. Ce document est le contrat du projet : tout ce que Claude Code construit en découle.

## Vision et périmètre

Véritable est un grand strategy géopolitique du monde contemporain, solo, jouable en campagne persistante sur plusieurs jours réels. Le joueur incarne **l'État** d'une nation parmi les 195 simulées — pas son gouvernement : les présidents passent, l'État reste — dans un bac à sable sans condition de victoire, à partir du monde tel qu'il est au 1er janvier 2026.

Le projet part du code d'OpenFront.io (dépôt `openfrontio/OpenFrontIO`, AGPL-3.0) mais **n'est pas un mod** : trois des quatre systèmes centraux d'OpenFront sont remplacés. OpenFront fournit le socle — carte tuilée calquée sur la géographie réelle, rendu, propriété des tuiles, diplomatie de base, nucléaire, structures — soit précisément le travail le plus ingrat à écrire de zéro.

**Ce que le jeu est.** Une simulation où la politique interne produit les situations, où le commerce et les sanctions se lisent dans les chiffres, où les blocs supranationaux sont des acteurs à part entière qu'on peut diriger, et où la guerre est possible à tout moment mais coûteuse. Le joueur peut aussi bien réformer une démocratie européenne qu'attaquer la première puissance mondiale, se faire annexer, perdre son territoire et finir en exil aux Bahamas.

**Ce que le jeu n'est pas.** Multijoueur, session courte, condition de victoire, serveur. Tout tourne sur la machine du joueur.

**Décisions produit.** Nom : Véritable. Gratuit. Contenu et interface en français, code en anglais. Moddable par construction : toutes les données vivent en JSON éditable. Distribution en exécutable Windows via itch.io ou GitHub Releases. Sans certificat de signature (budget hors Claude : 10 €), Windows SmartScreen affichera un avertissement au premier lancement — assumé. Pas de Steam (100 $ de frais d'inscription).

**Ordre de grandeur assumé.** Le périmètre complet dépasse un Hearts of Iron : il y ajoute une économie de biens à la Victoria, une politique interne à la Democracy et des blocs à la Superpower. Même assisté par Claude Code, cela se compte en mois pour un premier jalon jouable et en années pour le périmètre entier. Le risque principal n'est pas technique : c'est de ne jamais avoir quelque chose de jouable entre les mains. Toute la feuille de route est construite contre ce risque, et chaque grand système est découpé en paliers dont le premier est constructible seul.

## Décisions verrouillées

Trente-deux choix issus des deux entretiens de conception (20 et 21 septembre 2026). Ils sont le contrat du projet : toute remise en cause de l'une de ces lignes invalide une partie de l'architecture et se consigne dans `DECISIONS.md` avant d'être codée.

| Axe | Décision |
| --- | --- |
| Joueurs | Solo uniquement, local, sans serveur |
| Format | Campagne persistante sur plusieurs jours réels |
| Contrôle | Une seule nation ; le joueur est **l'État**, pas le gouvernement — un changement de dirigeant ne termine rien |
| Écoulement du temps | Temps réel accéléré avec pause ; à ×1, une minute réelle = un mois de jeu |
| Modèle de guerre | Hybride : fronts et divisions sur base tuilée (modèle Hearts of Iron) |
| Périmètre militaire | Terre au J3a ; marine, air, logistique, effectifs au J3b |
| Économie | Détaillée, par biens : 12 biens au palier 1, ~40 au palier 2, services en agrégat |
| Commerce | Un prix mondial par bien + flux bilatéraux modulés par distance, accords et embargos |
| Dette | Dette/PIB, taux liés à la dette et à l'instabilité, austérité forcée ou défaut, réprimande des blocs |
| Sanctions | Embargos par bien et par pays ; effets lisibles sur PIB, budget, opinion, tension, contournement, flux d'armes |
| Nations simulées | Les ~195, en simulation **asymétrique** : politique complète pour le joueur, régime + stabilité + traits du dirigeant pour l'IA |
| Chiffres de départ | Données réelles, instantané au 1er janvier 2026 |
| Frontières | De facto, jamais de jure ; territoire occupé = tuiles du contrôleur étiquetées « contesté » |
| Micro-États | Nations sans tuile, existantes grâce au découplage nation/tuiles |
| Conflits | Le monde démarre avec les guerres en cours |
| Dirigeants | Entités à traits ; données Wikidata ; noms parodiques par défaut, interrupteur « fictif » dans les données |
| Régimes | 9 archétypes : parlementaire, présidentiel, semi-présidentiel, autoritaire électoral, parti unique, monarchie absolue, junte, théocratie, État failli |
| Politiques | Curseurs continus **et** lois discrètes |
| Élections | Orientables : propagande, contrôle des médias, fraude, clientélisme — chacun avec son risque |
| Objectifs | Auto-fixés par le joueur, catalogue épinglable + journal de campagne |
| Arbre technologique | Tronc commun + branches de doctrine par bloc, construit en paliers |
| Plafond technologique | Spéculatif lointain ; seuls les deux premiers paliers livrés d'abord |
| Blocs supranationaux | Entités complètes (adhésion, sortie, vote, budget, compétences, leadership), dirigeables par le joueur |
| Fin de campagne | Aucune, bac à sable infini |
| Déclenchement de guerre | Libre mais lourdement sanctionné |
| Nucléaire | Arme utilisable ; doctrine par nation ; « main morte » possible à l'annexion |
| Événements | Scriptés **et** procéduraux, sous forme de pop-up à choix |
| Effondrement national | Gouvernement en exil, puis dissolution → baroud d'honneur sur un nouveau petit État |
| Structures OpenFront | Conservées : villes, postes de défense, ports, navires, silos, SAM |
| Distribution | Exécutable Windows gratuit, itch.io ou GitHub Releases, non signé |
| Langue | Contenu et interface en français, code en anglais, clés i18n dès le départ |
| Modding | Ouvert : dossiers JSON éditables sans recompilation |
| Suivi amont | Rupture assumée : le fork ne fusionne plus jamais depuis OpenFront après le commit de départ |

**Réserve levée sur l'arbre technologique.** La contre-proposition du premier entretien est retenue : un tronc commun partagé plus des branches de doctrine spécifiques aux blocs. Une nation qui quitte son bloc garde le tronc et perd l'accès aux nouvelles branches. Moitié de l'arbre écrite une seule fois.

**Tension assumée.** « Données réelles » et « spéculatif lointain » tirent en sens inverse : plus l'arbre s'éloigne du présent, moins il existe de repère pour l'équilibrer. Réconciliation : l'arbre est construit en paliers dans les données, seuls les deux premiers sont livrés, le reste s'étend ensuite.

## La boucle de jeu

La boucle est : régler ses politiques → laisser le temps couler → répondre aux événements → lire les conséquences dans les chiffres et l'opinion → ajuster. Rien ne pousse le joueur vers une victoire ; ce sont les situations que la simulation lui envoie et les objectifs qu'il s'est fixés qui tirent la partie.

**Une session type (année 3, 30 minutes).** Le joueur ouvre l'écran des politiques, déplace deux curseurs (fiscalité, dépenses de défense) et adopte une loi. Il relance le temps. Quelques minutes plus tard, un pop-up : crise climatique en Asie du Sud-Est. Deux choix — envoyer de l'aide (coût budgétaire, relations et image du dirigeant en hausse) ou ne rien faire (aucun coût immédiat, dégradation possible des relations et de l'opinion de certains groupes). Il choisit, lit l'effet dans le journal, vérifie que sa dette reste sous le seuil de réprimande de l'UE, et repart. Le mois suivant, une élection approche : il arbitre entre un budget de propagande et une loi sur les médias.

**Les quatre sources de situations.**

1. La politique interne : élections, opinion, groupes d'intérêt, coups d'État, contestation.
2. Les événements : scriptés pour les premières années, procéduraux ensuite.
3. Le monde : guerres, sanctions, décisions des blocs, effondrements d'autres nations.
4. Les objectifs que le joueur s'est fixés.

**Objectifs et journal.** Le joueur épingle des objectifs d'un catalogue en données (« rejoindre l'UE », « doubler le PIB », « diriger l'OTAN », « réunifier X », « sortir de la dépendance au gaz importé ») ou écrit les siens en texte libre. Le journal de campagne enregistre automatiquement les événements majeurs — guerres, changements de dirigeant, lois, crises, sanctions — et les décisions du joueur. C'est la mémoire de la partie, et ce qui rend une campagne de quarante ans racontable.

**Ce que le joueur touche.** Curseurs (fiscalité, budget par poste, conscription, ouverture commerciale…), lois (catalogue par domaine), diplomatie (relations, accords, sanctions, adhésions), guerre (fronts, postures, production militaire), blocs (votes, candidature, leadership), réponses aux événements.

## Ce qu'on garde d'OpenFront, ce qu'on remplace

### On garde

- **La carte tuilée et son rendu.** Cartes déjà calquées sur la géographie réelle, plus un dossier `map-generator` dans le dépôt pour en produire d'autres.
- **Le modèle de propriété des tuiles.** Conservé : le combat reste hybride fronts + tuiles, et les tuiles restent l'unité de territoire.
- **Les structures.** Villes, postes de défense, ports, navires, silos, SAM — toutes conservées et rebranchées sur la nouvelle économie.
- **La diplomatie de base.** Alliances, trahisons avec état de traître, embargos — étendue, pas remplacée.
- **Le nucléaire.** Ogives à plusieurs paliers, interception SAM, retombées qui altèrent le terrain — complété par une couche de doctrine.
- **Les commandes pause et vitesse.** Elles existent dans le client, désactivées en partie publique ; en solo on les réactive.

### On remplace

- **Le combat.** Le curseur travailleurs/soldats et le ratio d'attaque disparaissent au profit de fronts et de divisions.
- **L'économie entière.** Or unique, commerce maritime, trains et usines cèdent la place à une économie de biens, un budget et une dette.
- **L'IA des nations.** Celle en place joue une partie agressive de quarante-cinq minutes ; elle nucléariserait tout dans la première heure. Réécriture complète à rythme de campagne.
- **La condition de victoire.** `WinCheckExecution.ts` neutralisé, ainsi que l'Overtime et le plafond des 170 minutes.
- **La phase de spawn.** Remplacée par un chargeur de scénario à frontières fixes.

### Repères dans le dépôt

| Chemin | Rôle |
| --- | --- |
| `/src/core` | Simulation (déterministe à l'origine ; la contrainte tombe en solo) |
| `/src/client` | Client et rendu |
| `/src/server` | Serveur — hors sujet en solo |
| `/src/core/configuration/Config.ts` | Toutes les valeurs de réglage |
| `/src/core/game/Game.ts` | État de partie |
| `/resources` | Assets et cartes |
| `/zbin` | Format binaire pour schémas zod — brique de sérialisation |
| `CLAUDE.md`, `.claude/skills/run-openfront` | Contexte projet déjà écrit par les mainteneurs |

Installation : `git clone`, puis `npm run inst` — surtout pas `npm install` : le script maison lance `npm ci --ignore-scripts` pour se prémunir d'une attaque de chaîne d'approvisionnement. Lancement : `npm run dev`. Tests en Vitest via `npm test`.

## Contraintes architecturales non négociables

Ces six points doivent être posés au J0, avant toute feature. Chacun est invivable à rattraper après coup.

### 1. Découpler « nation » et « tuiles »

OpenFront repose entièrement sur l'hypothèse qu'un joueur **est** ses tuiles : l'élimination se déclenche à 0 % de terres. Un gouvernement en exil est une nation sans territoire ; un micro-État est une nation sans tuile dès le départ. Le modèle de données traite donc la nation comme une entité autonome à laquelle des tuiles sont rattachées — jamais l'inverse. À faire au premier jour.

### 2. La sauvegarde, chantier numéro un

OpenFront n'a pas de sauvegarde : c'est un jeu de session. Le dépôt sait rejouer une partie par **rejeu du journal de commandes verrouillé au commit exact**, et les parties non terminées ne sont pas rejouables en local. Ce mécanisme ne peut pas servir une campagne longue.

Ce qu'il faut : un instantané complet de l'état, sérialisé, avec un champ `schemaVersion` et une fonction de migration **dès la première version**. Le modèle de données changera des dizaines de fois ; sans versionnage, chaque changement détruit la campagne en cours. Sauvegarde automatique à chaque mois de jeu (une minute réelle à ×1), plus export fichier. `/zbin` fournit la brique de sérialisation ; la carte des tuiles se compresse à part.

### 3. Les données hors du code

Les 195 fiches pays, les dirigeants, les biens, les lois, les événements, l'arbre technologique, les blocs et les scénarios vivent en JSON validé par zod — jamais en dur dans le TypeScript. Avec des données réelles, c'est du contenu, et le contenu s'édite sans recompiler. C'est aussi ce qui rend le jeu moddable sans effort supplémentaire.

### 4. Isoler la simulation derrière une interface

Même si tout tourne d'abord dans le même processus, la simulation doit être appelable à travers une frontière nette : entrées = commandes du joueur + delta de temps, sorties = état lisible + événements. C'est ce qui permettra de la déporter vers un worker ou vers Rust le jour où les performances coincent, et ce qui rend possible le runner headless sans rendu.

### 5. Un générateur aléatoire seedé

Le déterminisme client/serveur tombe en solo, mais un RNG seedé et propagé à tous les systèmes coûte une heure et permet de rejouer exactement une campagne où un bug est apparu. Sans lui, aucun bug de campagne n'est reproductible.

### 6. Clés i18n dès la première chaîne

Le jeu est en français, mais chaque texte visible passe par une clé. Ajouter l'anglais plus tard coûtera alors une traduction, pas une refonte.

### Sur le déterminisme

En solo local, plus de désynchronisation à craindre : flottants, structures d'état libres et calculs asynchrones sont permis. C'est ce qui rend le périmètre envisageable. En contrepartie, tout retour ultérieur vers du multijoueur serait une réécriture, pas une extension.

### Cible d'exécution et licence

Sortir du navigateur débloque les threads de travail, les vrais fichiers de sauvegarde et la RAM — des gains réels pour 195 nations, pas du confort. Approche retenue : **emballer le client web existant dans Electron**, sans rien réécrire. Tauri reste l'option de repli si le poids ou les performances l'imposent ; la contrainte n° 4 garde cette porte ouverte.

Point juridique : l'AGPL-3.0 s'applique aussi à la **distribution de binaires**. Diffuser l'exécutable oblige à fournir le code source complet correspondant. Les mentions « © OpenFront and Contributors » restent visibles en pied de page et sur l'écran de chargement. Les assets sont en CC BY-SA 4.0. Le dépôt Véritable est donc public dès le premier commit.

## Le temps

La campagne démarre le 1er janvier 2026 et suit le calendrier réel (mois de 28 à 31 jours, années bissextiles). À vitesse ×1, un jour de jeu dure exactement deux secondes réelles : un mois dure donc de 56 à 62 secondes, une année ≈ 12,2 minutes (730 s), et dix heures de jeu couvrent un peu plus de quarante-neuf ans. « Une minute réelle = un mois de jeu » est l'approximation qui se retient, pas la règle : la règle est le jour de deux secondes. Vitesses : pause, ×1, ×2, ×5.

Tout ne tourne pas au même rythme. Chaque domaine a son horloge, et c'est ce qui permet une économie détaillée sur 195 nations sans étrangler le tick militaire.

| Domaine | Fréquence | À ×1 |
| --- | --- | --- |
| Militaire, tuiles, fronts | Tick d'OpenFront | continu |
| Économie (production, commerce, prix) | Une fois par jour de jeu | toutes les 2 s |
| Événements, diplomatie, réaction internationale | Une fois par jour de jeu | toutes les 2 s |
| Opinion, stabilité, groupes d'intérêt | Une fois par semaine de jeu | toutes les 14 s |
| Élections, lois, budget, blocs | Une fois par mois de jeu | toutes les 60 s |
| Sauvegarde automatique | Une fois par mois de jeu | toutes les 60 s |

Une loi adoptée prend effet au mois suivant ; un curseur agit progressivement sur plusieurs mois. Le joueur voit toujours la date, la vitesse et le prochain rendez-vous (élection, échéance de dette, vote de bloc) dans la barre supérieure.

## Économie et commerce

L'économie est une économie de biens : chaque nation produit, consomme, importe et exporte douze biens, et le PIB, le budget, la dette et les sanctions se déduisent de ces flux plutôt que de nombres posés à la main.

### Biens du palier 1

| Bien | Rôle dans la simulation |
| --- | --- |
| Pétrole | Carburant militaire, énergie, exportation majeure ; levier de sanction numéro un |
| Gaz | Chauffage, industrie, électricité ; dépendances régionales fortes (Europe) |
| Charbon | Électricité bon marché |
| Électricité | Produite à partir des trois précédents et de la capacité nucléaire/renouvelable ; consommée par tout le reste ; non stockable, échangée seulement entre voisins connectés |
| Alimentation | Population ; une pénurie produit des troubles |
| Minerais critiques | Électronique, armement, renouvelables ; concentrés dans peu de pays |
| Acier et industrie lourde | Construction, armement, infrastructures |
| Biens de consommation | Niveau de vie, opinion |
| Électronique et high-tech | Armement moderne, productivité, technologie |
| Armement | Divisions, navires, avions ; exportable, donc flux vers les belligérants |
| Pharmacie | Santé, pandémies, opinion |
| Services | Agrégat (finance, tourisme, logiciel) ; suit le développement, s'échange sans transport |

Le palier 2 éclate ces douze lignes en ~40 (brut/raffiné, blé/riz/viande, cuivre/lithium/terres rares, semi-conducteurs…). Même moteur, plus de lignes dans les données.

### Production et consommation

Chaque nation a, par bien, une capacité de production issue des données de départ, qui évolue avec l'investissement, la technologie, l'énergie disponible et les dégâts de guerre ; et une consommation qui dépend de la population, du niveau de développement et des dépenses publiques. L'écart est un surplus exporté ou un déficit importé. Une pénurie non couverte a un effet direct : sans électricité l'industrie ralentit, sans alimentation les troubles montent, sans armement les divisions sont sous-équipées.

### Marché

Un prix mondial par bien, recalculé chaque jour de jeu par l'équilibre offre/demande. Les flux bilatéraux se répartissent entre partenaires selon distance, accords commerciaux, appartenance à un bloc et embargos. Le prix mondial rend les chocs lisibles : une guerre au Moyen-Orient fait monter le pétrole pour tout le monde.

### Budget

Recettes par curseurs : impôt sur le revenu, impôt sur les sociétés, TVA, droits de douane, rentes sur ressources. Dépenses par poste et par curseurs : défense, social, santé et éducation, R&D, infrastructures, subventions, service de la dette. Le solde alimente ou creuse la dette.

### Dette

Exprimée en % du PIB. Le taux d'intérêt monte avec la dette et l'instabilité, baisse avec la crédibilité (historique de remboursement, zone monétaire). Au-delà d'un seuil qui dépend du régime et du bloc : austérité forcée (curseurs bloqués) ou défaut (crédit coupé, opinion en chute, relations dégradées). Les blocs réprimandent selon leurs règles — l'UE à 3 % de déficit et 60 % de dette.

### Sanctions

Une sanction est un embargo par bien et par pays, décidé par une nation ou un bloc. Ses effets, tous calculés à travers le marché :

- le sanctionné perd ses exportations vers les sanctionneurs et revend à prix décoté ailleurs ; il perd ses importations et paie une prime ailleurs ;
- PIB, budget et opinion encaissent ; la tension diplomatique monte des deux côtés ;
- un indice de contournement et de corruption monte avec le temps et affaiblit progressivement l'embargo ;
- soutien aux belligérants : le sanctionné oriente ses flux d'armement vers les pays en guerre contre les sanctionneurs ;
- présence militaire accrue : les deux camps renforcent leurs fronts et zones limitrophes.

Test explicite au J3 : une sanction doit se voir dans les courbes en moins d'un an de jeu. Si elle ne se voit pas, la « guerre libre mais sanctionnée » n'existe pas.

## Politique interne

C'est le moteur du jeu, pas une couche de saveur. Sans condition de victoire, ce sont les élections, l'opinion, les coups d'État et la contestation qui fabriquent les situations. Le système est complet pour le joueur et abrégé pour les 194 autres nations.

### Pour le joueur

**Opinion et stabilité.** Deux jauges globales. L'opinion est la moyenne pondérée de la satisfaction de huit groupes d'intérêt — entrepreneurs, salariés, agriculteurs, militaires, religieux, jeunes, retraités, minorités — dont les poids dépendent du pays et du régime. Chaque curseur, loi, événement et résultat économique déplace la satisfaction d'un ou plusieurs groupes. La stabilité agrège opinion, sécurité, pénuries, corruption et légitimité du pouvoir ; basse, elle ouvre la porte aux manifestations, grèves, coups et révolutions.

**Régimes.** Neuf archétypes en données : parlementaire, présidentiel, semi-présidentiel, autoritaire électoral, parti unique, monarchie absolue, junte, théocratie, État failli. Chacun définit sa règle de succession (élection à échéance, mandat à vie, hérédité, désignation par le parti), qui peut renverser qui, et quelles lois sont accessibles. Un régime change par révolution, coup ou réforme constitutionnelle.

**Élections.** À échéance fixe selon le régime. Le résultat est fonction de l'opinion par groupe, de l'offre politique (partis et acteurs en données), et de quatre leviers du joueur : budget de propagande, contrôle des médias, fraude, clientélisme. Chaque levier a son prix — une fraude visible fait chuter la légitimité et peut déclencher contestation ou coup ; le contrôle des médias coûte en relations avec les démocraties et leurs blocs. Le joueur incarne l'État : le nouveau gouvernement arrive avec son dirigeant et ses traits, et certaines lois en vigueur peuvent être remises en cause au mois suivant.

**Curseurs et lois.** Les curseurs sont des arbitrages permanents à effet progressif : fiscalité, dépenses par poste, conscription, ouverture commerciale, liberté de la presse. Les lois sont des décisions ponctuelles tirées d'un catalogue par domaine — économie, social, sécurité, institutions, environnement, défense — coûteuses en capital politique et réversibles avec difficulté. Certaines lois n'existent que dans certains régimes.

**Coups et révolutions.** Coup : militaires insatisfaits + stabilité basse + dirigeant faible → probabilité mensuelle. Révolution : plusieurs groupes en colère + pénuries. Dans les deux cas, nouveau régime, nouveau dirigeant, et le joueur continue : il est l'État.

### Pour les 194 autres nations

Une nation IA se résume à un régime, une stabilité scalaire, un dirigeant avec ses traits et un agenda de trois ou quatre objectifs pondérés (sécurité, croissance, influence régionale, idéologie). Elle n'a ni groupes d'intérêt ni lois individuelles : sa stabilité réagit aux mêmes chocs — économie, guerre, sanctions, pénuries — par des coefficients. Quand elle franchit un seuil, le dirigeant change (élection ou coup selon le régime), les traits changent, et le comportement avec eux. Une IA en crise ou en interaction avec le joueur est mise à jour plus souvent, mais jamais avec la politique complète : l'asymétrie est structurelle, c'est ce qui rend 195 nations tenables et équilibrables.

### Dirigeants

Une entité par dirigeant et par acteur politique majeur : nom, âge, parti, sept traits — trois axes idéologiques (gauche-droite économique, libéral-autoritaire, souverainiste-internationaliste), agressivité, corruption, charisme, compétence. Source : Wikidata (CC0) pour les chefs d'État et de gouvernement et les principaux partis ; traits écrits à la main pour les ~40 pays principaux, générés à partir de l'idéologie du parti pour le reste. Les dirigeants vieillissent, meurent, se succèdent. Les noms sont parodiques par défaut (« Danold Chrump », « Mastuel Microne ») avec un interrupteur « fictif » dans les données : une personne reste identifiable sous parodie, donc le droit à l'image ne disparaît pas — risque faible pour un jeu gratuit, mais connu et débrayable.

## Guerre

La guerre est possible à tout moment et coûteuse à chaque fois. Les tuiles restent l'unité de territoire, les fronts deviennent l'unité de manœuvre, et la réaction internationale en fixe le prix.

### Déclaration et prix

Une guerre se déclare avec ou sans casus belli (catalogue en données : territoire contesté, attaque d'un allié, violation de traité, prétexte humanitaire). Sans casus belli, la réaction internationale est maximale. Cette réaction est un système à part entière : l'opinion de toutes les nations envers l'agresseur chute proportionnellement à sa puissance et à l'absence de motif ; les blocs votent des sanctions ; une coalition se forme quand la puissance relative de l'agresseur dépasse un seuil ; ses propres groupes d'intérêt (jeunes, entrepreneurs) se retournent ; les prix mondiaux réagissent. Sans ce système, la décision « libre mais sanctionnée » n'existe pas.

### Fronts et divisions (J3a)

Un **front** est l'ensemble des tuiles frontalières entre deux belligérants, calculé automatiquement et découpé en segments selon la longueur et le terrain. Le joueur affecte des **divisions** à un front ou à un segment et fixe une posture : défendre, attaquer, percer vers un objectif (ville, tuile). Les divisions n'ont pas de position exacte : elles ont un front. Celles qui n'en ont pas forment la réserve.

Quatre gabarits de division — infanterie, mécanisée, blindée, artillerie — chacun consommant des effectifs (population × loi de conscription), de l'armement (le bien du même nom), un niveau d'entraînement (technologie, dépenses de défense) et du ravitaillement.

À chaque tick, par segment : rapport de force = divisions × équipement × ravitaillement × terrain × doctrine × supériorité aérienne. La ligne avance ou recule tuile par tuile à une vitesse proportionnelle au rapport ; les structures OpenFront (postes de défense, villes) multiplient la défense. Les pertes consomment effectifs et armement ; l'épuisement de guerre monte avec les pertes et le temps, pèse sur l'opinion et sur la volonté de l'IA de continuer.

### Marine, air, logistique (J3b)

**Marine.** La mer est découpée en zones. Le contrôle d'une zone découle des navires OpenFront et des ports. Il pèse sur les flux commerciaux (un blocus est une sanction militaire), conditionne les débarquements (contrôle de la zone puis prise d'un port) et permet des frappes navales.

**Air.** Une supériorité aérienne par région, issue du rapport des forces aériennes (données de départ, armement, high-tech), agit comme multiplicateur sur les segments terrestres et permet des frappes sur infrastructures et production.

**Logistique.** Chaque segment a une capacité de ravitaillement issue des ports, villes et dépenses d'infrastructure. Les divisions au-delà de cette capacité combattent à force réduite : c'est ce qui empêche d'empiler cent divisions sur un col.

### Fin de guerre

Paix négociée (l'IA accepte selon le score de guerre, son épuisement et les traits de son dirigeant) : transfert de tuiles avec étiquette « contesté », réparations, démilitarisation. Cessez-le-feu simple. Annexion partielle ou totale — qui déclenche l'effondrement de l'adversaire, décrit plus bas.

## Nucléaire

L'arme reste employable, avec conséquences. Le nucléaire d'OpenFront est tactique — ogives à paliers, interception SAM, retombées sur les tuiles — et il est conservé tel quel ; Véritable y ajoute la couche stratégique qui manque à une campagne : la doctrine.

**Doctrines.** Chaque puissance nucléaire porte une doctrine dans ses données : première frappe possible, non-usage en premier, non déclarée, imprévisible. La doctrine, les traits du dirigeant et la situation (territoire envahi, capitale menacée, régime en chute) donnent une probabilité de tir que l'IA évalue chaque jour de jeu. C'est ce qui rend le nucléaire rare et terrifiant plutôt qu'absent ou omniprésent.

**Main morte.** Quand une puissance nucléaire est annexée, le vainqueur prend possession du territoire, des silos et du droit d'en user. Mais au moment de la dissolution, l'État vaincu peut, selon sa doctrine et son dirigeant, lancer une dernière frappe sur la capitale de l'envahisseur. L'interception SAM s'applique. La probabilité est visible au joueur avant l'assaut final : il sait ce qu'il risque.

**Conséquences.** Tout tir déclenche la réaction internationale à son niveau maximal, quel que soit le motif. Les retombées altèrent le terrain et la production des tuiles touchées pour des années de jeu.

**Reconstruction.** Conséquence directe du bac à sable infini : le monde continue après un échange nucléaire. Les tuiles touchées se réhabilitent lentement, à un rythme lié aux dépenses d'infrastructure et à l'aide extérieure. S'il ne se relève jamais, la campagne se termine de fait sans jamais s'arrêter.

## Blocs supranationaux

Les blocs sont des acteurs à part entière, avec un budget, des décisions et un leadership que le joueur peut prendre. C'est ce qui distingue Véritable d'un Hearts of Iron, où l'UE n'existe pas comme acteur.

### Ce qui définit un bloc

Chaque bloc est un fichier de données avec :

- **Membres** et statuts (plein, observateur, candidat).
- **Critères d'adhésion** (régime, dette, alignement, géographie) et **procédure de sortie** (délai, coût, perte d'accès aux branches technologiques du bloc).
- **Règle de décision par domaine** : unanimité, majorité qualifiée ou simple. L'UE décide les sanctions à l'unanimité et le commerce à la majorité qualifiée ; l'OTAN engage la défense collective quasi automatiquement.
- **Budget** alimenté par contributions (part du PIB), dépensé en aides, fonds structurels, défense commune.
- **Compétences** : commerce, sanctions, défense, monnaie, libre circulation, normes.
- **Leadership** : présidence tournante, élu par les membres, ou hégémon de fait.

Une nation appartient à plusieurs blocs (UE + OTAN + G7), et leurs décisions peuvent se contredire : c'est voulu.

### Trois couches, chacune jouable seule

1. Simple modificateur diplomatique et économique : accords commerciaux, défense collective, alignement des sanctions.
2. Entité avec budget propre, votes et décisions ; l'IA des membres vote selon ses traits et ses intérêts.
3. Leadership : le joueur peut prendre la tête du bloc et proposer les décisions à ses membres.

### Blocs du palier 1

UE, OTAN, BRICS, ASEAN, Union africaine, Mercosur, OPEP, CEDEAO, Ligue arabe, OCS, G7 et G20. Le palier 2 ajoute les blocs régionaux mineurs et les alliances bilatérales formelles.

## Effondrement, exil et baroud d'honneur

Perdre son territoire ne termine pas la partie : perdre son État non plus. Trois états successifs, tous fondés sur le découplage nation/tuiles.

**Nation avec territoire.** L'état normal.

**Gouvernement en exil.** Quand la dernière tuile est perdue, la nation persiste sans territoire. Elle garde sa reconnaissance internationale (qui s'érode), le soutien de puissances tierces (qui dépend de leurs intérêts et de la réaction internationale contre l'annexeur), une résistance intérieure sur les tuiles annexées (qui pèse sur la stabilité de l'occupant) et des conditions de retour : effondrement de l'occupant, victoire d'une coalition, négociation. Le gouvernement en exil survit tant que reconnaissance + soutien extérieur restent au-dessus d'un seuil.

**Dissolution et baroud d'honneur.** Sous ce seuil, ou si l'annexion est reconnue par les blocs majeurs, l'État est dissous. Le joueur ne perd pas la campagne : il choisit un petit État parmi ceux qui existent encore et continue dans le même monde, avec l'historique intact et l'annexeur toujours en face. La revanche est possible ; elle n'est pas garantie.

Les nations IA suivent exactement les mêmes trois états — un pays annexé n'est jamais simplement effacé de la carte.

## Événements

Un événement est un pop-up daté avec un titre, un texte, deux à quatre choix, et pour chaque choix des effets sur les chiffres (budget, opinion par groupe, relations, prix, stabilité). Scriptés et procéduraux partagent le même format de données et le même moteur de déclenchement.

**Scriptés.** Écrits à la main pour les premières années : crises reconnaissables, élections majeures, catastrophes, ruptures technologiques, pandémies. Chacun a des conditions de déclenchement (date, pays, état du monde) et une probabilité. Volume visé au J5 : cinquante événements couvrant 2026-2030, puis dix à vingt par an de jeu ajoutés au fil du développement.

**Procéduraux.** Des gabarits paramétrés — « crise climatique dans {région} », « scandale de corruption impliquant {acteur} », « pénurie de {bien} après {cause} », « manifestation de {groupe} » — instanciés par le moteur à partir de l'état de la simulation. Ils prennent le relais quand les scripts s'épuisent et garantissent qu'une campagne de quarante ans reste vivante.

**Ce que le joueur voit.** Le pop-up met le temps en pause. Les effets de chaque choix sont affichés avant de choisir, sauf ceux marqués incertains. Le choix et ses conséquences entrent dans le journal.

## Arbre technologique

Un tronc commun à toutes les nations, plus des branches de doctrine propres aux blocs. Une nation est un jeu de nœuds déjà débloqués : sa position de départ est de la donnée, pas du code.

**Tronc commun.** Domaines : énergie, industrie, agriculture, numérique, santé, armement terrestre, marine, air, nucléaire, espace. Chaque nœud coûte de la R&D (budget) et du temps, et débloque des multiplicateurs de production, de nouveaux gabarits militaires ou de nouvelles lois.

**Branches de doctrine.** Rattachées à un bloc (défense intégrée OTAN, autonomie stratégique UE, doctrine BRICS…). Accessibles aux membres ; une nation qui quitte le bloc garde ce qu'elle a débloqué et perd l'accès à la suite.

**Paliers.** L'arbre est construit en paliers dans les données. Palier 1 : 2026-2035, ancré sur des technologies réelles ou annoncées. Palier 2 : 2035-2050, extrapolation prudente. Paliers suivants : spéculatif lointain, écrits plus tard, avec la liberté d'inventer. Seuls les deux premiers sont livrés au J5.

## Monde de départ et données

Le monde démarre au 1er janvier 2026, tel qu'il est et non tel que l'ONU l'officialise : frontières de facto, guerres en cours, régimes en place.

**Frontières.** Les polygones Natural Earth (version de facto) sont rasterisés sur la grille tuilée par un script rejouable — la résolution de la carte changera. Un territoire occupé ou sécessionniste appartient à celui qui le contrôle, avec une étiquette « contesté » qui pèse sur la reconnaissance du contrôleur et alimente les casus belli. Les cas connus sont listés dans le fichier de scénario : Crimée et Donbass, Taïwan, Chypre-Nord, Kosovo, Sahara occidental, Cisjordanie et Gaza, Cachemire, Somaliland, Transnistrie, Abkhazie et Ossétie du Sud — chacun avec son contrôleur de facto et sa liste de reconnaissances. Le Haut-Karabakh n'est plus contesté : l'Azerbaïdjan l'a repris en septembre 2023 et la république d'Artsakh s'est dissoute le 1er janvier 2024 (correction du J6).

**Micro-États.** Vatican, Monaco, Saint-Marin, Liechtenstein, Andorre, Malte, Singapour et les États insulaires trop petits pour une tuile existent comme nations sans territoire propre, rattachées à une tuile hôte pour l'affichage. Le découplage nation/tuiles rend cela gratuit.

**Conflits en cours.** Le scénario liste les guerres actives au 1er janvier 2026, chacune avec ses belligérants, ses fronts initiaux et son intensité, remplies au moment de la collecte depuis les données de conflits et validées à la main.

### Sources et licences

Avec un binaire distribué sous AGPL, une source à licence fermée est un blocage, pas un détail. Les licences se revérifient au moment de la collecte, et le jeu est ancré sur un instantané daté.

Licences vérifiées le 2026-09-24 sur les pages de conditions de chaque source (J6).

| Source | Usage | Licence | Traitement dans le dépôt |
| --- | --- | --- | --- |
| Natural Earth (v5.1.2) | Frontières de facto, zones contestées, provinces, capitales | Domaine public | Fichiers en cache hors git, empreintes épinglées ; produits commités |
| Banque mondiale (Open Data) | PIB, population, budget, commerce, R&D, armée (dont indicateurs de source SIPRI et IISS) | CC BY 4.0, sans restriction tierce sur MS.MIL.XPND.GD.ZS ni MS.MIL.TOTL.P1 | Instantanés commités (JSON du J2, CSV du J6) |
| Our World in Data, énergie | Production et consommation d'énergie (séries EIA, Ember, Energy Institute) | CC BY 4.0 (EIA domaine public, Ember CC BY 4.0 ; conditions propres de l'Energy Institute non vérifiées) | CSV en cache, commit épinglé |
| EIA (États-Unis) | Énergie, par Our World in Data | Domaine public | Via OWID (l'API EIA demande une clé) |
| FMI, Perspectives de l'économie mondiale et Moniteur des finances publiques | Dette publique, PIB et budget à défaut de la Banque mondiale | Tous droits réservés, permission au cas par cas | Cache hors git ; valeurs isolées attribuées dans les fiches |
| FAOSTAT | Alimentation (non utilisé au J6 : céréales par la Banque mondiale) | CC BY 4.0, avec clause contre la promotion commerciale | Utilisable avec attribution |
| V-Dem v16 (Regimes of the World), par Our World in Data | Classification des régimes de départ | **CC BY-SA 4.0 (partage à l'identique)** | Instantané dérivé `snapshots/vdem/row.csv` sous CC BY-SA 4.0 ; le champ `regime` des fiches qui en dérive l'est aussi (à valider) |
| SIPRI (dépenses, transferts, forces nucléaires) | Arsenaux nucléaires ; dépenses militaires par la Banque mondiale | Conditions propriétaires : usage non commercial, moins de 10 % d'un jeu de données | Valeurs isolées attribuées seulement, aucun fichier brut |
| FAS, « Status of World Nuclear Forces » | Recoupement des arsenaux | Aucune licence ouverte | Valeurs isolées attribuées seulement |
| Wikidata | Dirigeants, partis, dates de naissance, idéologies | CC0 | Instantanés commités |
| Votes à l'Assemblée générale de l'ONU (Voeten, Strezhnev, Bailey, Harvard Dataverse) | Relations de départ | CC0 1.0 | Utilisable librement ; citation académique par courtoisie |
| UCDP (Uppsala), version 26.1 | Conflits armés en cours | CC BY 4.0 | Utilisable avec attribution |
| Sanctions de l'UE (liste consolidée) | Sanctions de départ | CC BY 4.0 (la carte des sanctions, application, non vérifiée) | Valeurs dérivées attribuées |
| OFAC (États-Unis) | Sanctions de départ | Domaine public | Valeurs dérivées attribuées |
| Liste consolidée des sanctions de l'ONU | — | **Redistribution et dérivés interdits** | Non utilisée ; les régimes de l'ONU sont repris des listes de l'UE et de l'OFAC |
| UN Comtrade / BACI (CEPII) | Flux commerciaux bilatéraux par bien | À vérifier avant redistribution | Non utilisé |
| IISS Military Balance | Effectifs détaillés | **Payante, licence fermée — à éviter** | Non utilisé directement (effectifs par la Banque mondiale) |

**Pipeline.** Un dossier de scripts télécharge les sources, les normalise et produit les JSON validés par zod. Chaque fiche pays porte la date et la source de chaque champ. Refaire l'attribution à la main serait absurde : tout est rejouable.

## Tenir 195 nations

C'est le principal risque technique : 195 économies de biens, en temps réel accéléré, dans un environnement web. Quatre techniques le rendent viable, et elles doivent être en place avant la montée à l'échelle, pas après.

**Horloges découplées.** Décrites dans la section Le temps : l'économie tourne par jour de jeu, la politique par semaine ou par mois, le militaire au tick. Le coût de l'économie elle-même est faible — 195 nations × 12 biens par jour de jeu est trivial ; ce qui coûte, c'est le marché (appariement des flux) et l'IA.

**Échelonnement de l'IA.** L'IA stratégique ne traite jamais les 194 nations dans le même tick. Elles sont réparties en rotation, une dizaine par tick. Sans cela, le temps accéléré s'effondre au premier pic.

**Niveau de détail variable.** Les nations éloignées du joueur et sans enjeu en cours tournent en simulation abrégée : quelques agrégats, une décision IA par mois. Elles passent en simulation détaillée — mais jamais en politique complète, l'asymétrie tient — quand elles entrent en guerre, rejoignent une crise ou interagissent avec le joueur.

**Dette d'état en fin de campagne.** Spécifique au bac à sable infini : l'historique de guerre, le journal et les traces diplomatiques gonflent sans limite. Politique de compactage dès le départ : agrégation des vieux événements, purge des détails au-delà d'un horizon, sinon la sauvegarde et la mémoire dérivent après quelques dizaines d'heures.

**Mesurer tôt.** Instrumenter le temps passé par système et par tick dès le J1, sur dix nations. Une régression repérée à dix nations coûte une heure ; à 195, une refonte.

**Le runner headless.** Grâce à l'isolation de la simulation, un exécutable sans rendu joue des campagnes IA contre IA : cinquante ans de jeu en quelques minutes, cent campagnes par nuit, avec des métriques par campagne — guerres par an, tirs nucléaires, effondrements, PIB mondial, prix, stabilité moyenne, temps par système. C'est l'outil d'équilibrage du projet, et la seule façon de prouver que l'IA ne nucléarise pas le monde en année 1. Il est construit au J2 et tourne à chaque jalon ensuite.

## Feuille de route

**Principe directeur : ne jamais construire les 195 pays en premier.** Les systèmes se construisent sur **10 pays et une carte Europe**, se valident à cette échelle, et la montée à 195 vient en dernier. À chaque jalon il existe quelque chose de jouable, et chaque jalon a un critère de livraison vérifiable. Ce n'est pas un point d'arrêt : c'est le rythme qui fait survivre un projet de cette taille. Chaque système livre son écran avec lui ; le polissage de l'interface attend le J7.

### J0 — Socle

Cloner, `npm run inst`, lire `CLAUDE.md`, y ajouter la section Véritable. Poser le découplage nation/tuiles. Sauvegarde et chargement avec `schemaVersion` et migration. Neutraliser condition de victoire, Overtime, plafond des 170 minutes. RNG seedé. Frontière de simulation posée, même si tout tourne dans le même processus. Arborescence `data/` avec schémas zod et clés i18n. Rien d'autre.

Livré quand : une partie se lance, se sauvegarde, se recharge à l'identique ; une nation à zéro tuile survit ; les tests Vitest sont verts.

### J1 — On joue

Chargeur de scénario : frontières fixes, 10 pays, carte Europe, polygones Natural Earth rasterisés par script. Calendrier (1er janvier 2026, une minute par mois), pause et vitesses. Barre supérieure minimale.

Livré quand : on lance, on joue cinq ans de jeu, on sauvegarde, on reprend.

### J2 — Économie et noyau politique

Les douze biens, production et consommation, marché mondial, budget, dette, sur les dix pays. Noyau politique du joueur : opinion et stabilité avec les huit groupes ; stabilité scalaire pour l'IA. Runner headless v1 et profilage par système.

Livré quand : vingt ans de jeu sans divergence absurde des prix ni de la dette ; la perte d'un fournisseur de gaz se voit dans les courbes.

### J3a — Guerre terrestre et réaction internationale

Fronts, divisions, effectifs, postures, paix négociée, casus belli. Réaction internationale et sanctions par bien.

Livré quand : le test de la sanction cosmétique passe — une sanction se voit en moins d'un an ; une guerre sans casus belli coûte plus qu'elle ne rapporte.

### J3b — Marine, air, logistique

Zones maritimes, contrôle, blocus, débarquements. Supériorité aérienne par région. Capacité de ravitaillement par segment.

Livré quand : un blocus se lit dans le commerce du bloqué ; un débarquement sans contrôle de zone échoue.

### J4 — Le moteur

Politique interne complète : régimes, élections et leurs quatre leviers, lois, curseurs, coups, révolutions. Dirigeants Wikidata avec traits. Objectifs et journal.

Livré quand : une campagne de dix ans produit au moins une alternance, une crise politique et un choix douloureux sans aucun script.

### J5 — Profondeur

Blocs en couche 1, puis 2, puis 3. Arbre technologique paliers 1 et 2. Cinquante événements scriptés et les gabarits procéduraux. Doctrines nucléaires et main morte. IA des nations réécrite (agenda, traits, rythme de campagne).

Livré quand : sur cent campagnes headless de cinquante ans, aucune guerre nucléaire généralisée en année 1 et une distribution des guerres plausible.

### J6 — Échelle

Montée à 195 nations et carte monde : micro-États, territoires contestés, conflits initiaux. Niveau de détail variable et échelonnement de l'IA mis à l'épreuve. Compactage de l'historique.

Livré quand : la vitesse ×5 tient sans saccade sur carte monde pendant cinquante ans de jeu.

### J7 — Le reste

Empaquetage Electron, build Windows, page itch.io ou GitHub Releases. Gouvernement en exil et baroud d'honneur. Événements procéduraux élargis. Palier 2 des biens et de l'arbre. Reconstruction post-nucléaire. Polissage de l'interface, documentation de modding.

### Note sur l'empaquetage

Electron peut être repoussé sans risque jusqu'au J7 : développer dans le navigateur reste plus rapide à itérer. En revanche, l'isolation de la simulation doit être respectée dès le J0, sinon l'empaquetage et tout déport ultérieur deviennent une réécriture.

## Risques et points de rupture

**Le risque numéro un n'est pas technique.** C'est de construire dans le désordre en espérant que ça devienne un jeu à la fin. Tout le périmètre décidé est atteignable ; il ne l'est que dans l'ordre de la feuille de route, un système par session, avec un état jouable à la fin de chacune.

**Le périmètre cumulé.** Économie de biens, politique complète, fronts, marine, air, blocs totaux : chaque système pris seul est un jeu. Le découpage en paliers est la seule protection ; tout palier 2 commencé avant que le palier 1 du système suivant existe est une dérive à corriger.

**L'explosion combinatoire de l'équilibrage.** Politiques × technologies × blocs × biens : chaque axe rend l'équilibrage plus dur que le précédent, et l'effet est multiplicatif. C'est l'argument du tronc technologique commun, de l'IA asymétrique et du runner headless. Toute décision qui multiplie les combinaisons se pèse à cette aune.

**Le bac à sable sans moteur.** Une politique interne faible ou arrivée tard donnerait un jeu vide. Si un seul système doit être bien fait, c'est celui-là — d'où le noyau opinion/stabilité dès le J2, avant la guerre.

**La sanction cosmétique.** Si l'économie n'encaisse pas visiblement les sanctions, « guerre libre mais sanctionnée » se dégrade en « guerre libre ». Test explicite au J3a, sur les courbes.

**Le nucléaire absent ou omniprésent.** Sans doctrine, l'IA tire tout le temps ou jamais. Le runner headless mesure la fréquence des tirs à chaque jalon ; la cible est « rare et redouté ».

**L'IA héritée.** Calibrée pour une partie agressive de quarante-cinq minutes, elle produirait une guerre nucléaire généralisée dans la première heure. Sa réécriture n'est pas optionnelle.

**La dérive du modèle de données.** Sans `schemaVersion` et migrations dès le premier jour, chaque évolution du modèle détruit les campagnes en cours — y compris celles qui servent à tester. Le point de rupture le plus bête et le plus fréquent.

**L'interface.** Un grand strategy, c'est la moitié du travail en écrans. L'UI d'OpenFront est minimale. Chaque système livre son écran fonctionnel, même laid ; le polissage attend le J7. Une UI reportée en bloc à la fin ne se fait jamais.

**Le suivi de l'amont.** OpenFront est en développement actif (plus de 4 600 commits). Décision prise : rupture assumée, le fork ne fusionne plus jamais. Le commit de départ est tagué et noté dans `DECISIONS.md`.

**Les licences de données.** Une source fermée dans un binaire AGPL est un blocage. Chaque champ des fiches pays porte sa source, et le tableau des sources se revérifie à la collecte.

## Travailler avec Claude Code

Le dépôt contient déjà un `CLAUDE.md` à la racine et un dossier `.claude/skills/run-openfront` : le contexte de base est écrit par les mainteneurs. Véritable y ajoute sa propre section, ses documents de référence et son arborescence.

### Modèles

| Travail | Modèle | Pourquoi |
| --- | --- | --- |
| J0, toute décision d'architecture, sauvegarde/migration, découplage nation/tuiles, runner headless, rédaction de la section CLAUDE.md | Fable 5.1 (`/model fable`, effort `xhigh`) | Tâches plus grandes qu'une session, investigation avant action, vérification autonome |
| Implémenter un système déjà spécifié (économie, fronts, IA, blocs) | Opus 5 | Raisonnement complexe sur un périmètre cadré |
| Volume : fiches pays JSON, scripts d'ingestion, tests, écrans répétitifs | Sonnet 5 | Rapide, fenêtre 1M native, économe sur le forfait |
| Sessions courantes | alias `opusplan` | Opus en mode plan, Sonnet en exécution |

Avec un forfait Max, Opus 5 est le défaut et Fable se sélectionne explicitement ; selon le forfait, Fable peut être facturé en crédits d'usage avec une demande de confirmation.

### Arborescence du dépôt

```
veritable/                      fork d'OpenFrontIO, commit de départ tagué upstream-base
├── CLAUDE.md                   celui d'OpenFront + la section Véritable, qui importe les docs ci-dessous
├── docs/veritable/
│   ├── DESIGN.md               ce document, exporté
│   ├── ARCHITECTURE.md         invariants, frontière de simulation, horloges, sauvegarde, dossiers
│   ├── DATA-SCHEMAS.md         forme des JSON : nation, dirigeant, bien, loi, événement, bloc, scénario
│   ├── ROADMAP.md              J0 → J7, cases à cocher, critères de livraison
│   └── DECISIONS.md            journal daté des décisions (ADR)
├── data/veritable/             JSON validés zod : scenarios/ nations/ leaders/ goods/ laws/ events/ blocs/ tech/ i18n/
├── src/veritable/              code Véritable : sim/ save/ ai/ adapters/ (vers src/core et src/client)
├── tools/veritable/            scripts : ingest/ (sources → JSON), borders/ (Natural Earth → tuiles), headless/ (runner)
└── src/core, src/client, …     OpenFront, touché le moins possible
```

### La section Véritable de CLAUDE.md

À écrire avant d'attaquer le code. Elle consigne : les six contraintes architecturales ; les décisions verrouillées qui ne se rediscutent pas ; ce qu'on ne touche pas dans le code hérité ; les invariants du modèle de données, à commencer par le découplage nation/tuiles ; la convention données en JSON validé zod, jamais en dur ; le rythme de session. Elle importe `ARCHITECTURE.md`, `DECISIONS.md` et `ROADMAP.md` pour qu'ils soient dans chaque session, et renvoie à `DESIGN.md` pour le reste. Claude Code travaille nettement mieux avec ça qu'avec des instructions répétées à chaque session.

### Rythme de travail

Un système par session, avec un état jouable en fin de session. Une session commence par lire `ROADMAP.md` et `DECISIONS.md`, se termine par cocher ce qui est livré, noter toute décision prise et lancer les tests. Les grandes refontes transversales menées en une fois sont le mode d'échec classique sur un projet de cette taille. Décrire le résultat attendu plutôt que les étapes : Fable planifie mieux qu'on ne le dirige.

### Tests

Le dépôt impose que tout changement dans `src/core` soit testé, en Vitest. Cette exigence sert encore plus un projet solo de longue haleine : c'est elle qui permet de revenir sur le code six semaines plus tard sans tout casser. Elle s'étend à `src/veritable`. Le runner headless est le test d'intégration du jeu entier.

### Ce document

Il est vivant. Chaque décision tranchée en cours de route se répercute ici, puis dans `DECISIONS.md` et `CLAUDE.md`. `DESIGN.md` dans le dépôt est une copie de ce document, à réexporter quand il change.
