# Véritable — feuille de route

Principe : ne jamais construire les 195 pays en premier. Tout se construit sur 10 pays et une carte Europe ; la montée à 195 vient au J6. Un jalon est livré quand son critère est vérifié, pas quand son code est écrit. Chaque système livre son écran fonctionnel avec lui, même laid.

Claude Code coche ici en fin de session et note la date. Une tâche non listée qui s'avère nécessaire s'ajoute au jalon en cours ; une tâche d'un jalon futur ne se commence pas.

## J0 — Socle

Modèle recommandé : Fable 5.1, effort xhigh.

- [x] Fork cloné, `npm run inst`, `npm run dev` et `npm test` verts sur le code d'origine _(2026-09-21 — base : 3 échecs connus hors jeu, voir DECISIONS.md ; `npm run inst` déjà fait avant la session, non relancé)_
- [x] Commit de départ tagué `upstream-base`, noté dans DECISIONS.md _(2026-09-21)_
- [x] Section Véritable ajoutée à `CLAUDE.md` (imports ARCHITECTURE, DECISIONS, ROADMAP) _(2026-09-21)_
- [x] Arborescence `docs/veritable/`, `data/veritable/`, `src/veritable/`, `tools/veritable/` créée _(2026-09-21)_
- [x] `Nation` entité autonome ; propriété des tuiles référence une nation ; aucune élimination à 0 tuile _(2026-09-21)_
- [x] Condition de victoire, Overtime et plafond 170 min neutralisés (`// VERITABLE:`) _(2026-09-21)_
- [x] `Rng` seedé injecté ; état du RNG dans la sauvegarde _(2026-09-21)_
- [x] Interface `VeritableSim` posée ; le client passe par elle _(2026-09-21 — sim dans le worker, client via `RemoteVeritableSim`)_
- [x] Sauvegarde/chargement : `schemaVersion: 1`, chaîne de migrations vide mais câblée, IndexedDB + export fichier _(2026-09-21 — conteneur `.vsave`, vérifié dans le navigateur (sauvegarde, rechargement en jeu et depuis le menu))_
- [x] Schémas zod pour `nation`, `scenario`, `save`, `config` ; `data/veritable/i18n/fr.json` amorcé _(2026-09-21)_
- [x] Tests : sauvegarde → chargement → état identique ; nation à zéro tuile survit _(2026-09-21)_

**Livré quand** : une partie se lance, se sauvegarde, se recharge à l'identique ; une nation à zéro tuile survit ; tests verts. — **Livré le 2026-09-21** (« à l'identique » = identité du fichier de sauvegarde, voir DECISIONS.md).

## J1 — On joue

- [x] `tools/veritable/borders/` : Natural Earth (de facto) → tuiles, rejouable _(2026-09-21 — auto-calibration sur le trait de côte (équirectangulaire, IoU 0,956), Natural Earth v5.1.2 épinglé, surcharges de facto)_
- [x] Scénario `europe-10.json` : 10 nations à frontières fixes sur la carte Europe _(2026-09-21 — FRA, DEU, GBR, ITA, ESP, POL, UKR, RUS, TUR, NOR ; 1 331 874 tuiles, le reste neutre)_
- [x] Phase de spawn remplacée par le chargeur de scénario _(2026-09-21 — `adHocNations` supprimé, plus aucune nation « exilée » au départ)_
- [x] Calendrier : 1er janvier 2026, 1 min réelle = 1 mois à ×1 ; pause, ×1, ×2, ×5 _(2026-09-21 — calendrier réel, un jour = 2 s à ×1 ; ×5 mesuré à 49,95 ticks/s sur la carte Europe)_
- [x] `Scheduler` central avec les horloges par domaine (vides pour l'instant) _(2026-09-21 — sans état, six domaines enregistrés et vides)_
- [x] Barre supérieure : date, vitesse, nation jouée _(2026-09-21 — plus l'écran de départ avec choix de la nation)_
- [x] Instrumentation `perf.mark` par domaine _(2026-09-21 — sonde injectée, `performance.mark`/`measure` par domaine dans le worker)_
- [x] Rotation des six sauvegardes automatiques mensuelles _(2026-09-21 — tâche reportée du J0, ajoutée au jalon en cours)_

**Livré quand** : on lance, on joue cinq ans de jeu, on sauvegarde, on reprend. — **Livré le 2026-09-21** (cinq ans joués d'une traite en headless sur la carte Europe, sauvegarde et reprise à l'identique ; dans le navigateur : 17 mois de jeu, sauvegardes automatiques, sauvegarde manuelle et reprise).

## J2 — Économie et noyau politique

- [x] `goods.json` palier 1 (12 biens) ; production/consommation par nation depuis les fiches _(2026-09-22 — énergie en TWh, alimentation en Mt, sept biens en indice ; élasticités et prix de base dans `goods.json`)_
- [x] Marché : prix mondial par bien, flux bilatéraux (distance, accords, blocs, embargos) _(2026-09-22 — plus le reste du monde (`ROW`), trois passes de rationnement, embargos avec revente décotée)_
- [x] Budget : recettes et dépenses par curseurs ; dette/PIB ; taux ; seuils austérité/défaut _(2026-09-22 — plus la règle UE 3 % / 60 % et une règle budgétaire IA minimale)_
- [x] Pénuries : effets directs (électricité → industrie, alimentation → troubles, armement → divisions) _(2026-09-22 — `armsShort` posé pour le J3a, sans effet au J2)_
- [x] Noyau politique joueur : 8 groupes, opinion, stabilité, réaction aux curseurs et aux chocs _(2026-09-22)_
- [x] Stabilité scalaire des nations IA _(2026-09-22 — opinion proxy (croissance, pénuries, prix))_
- [x] Écrans : économie (biens, prix, flux), budget, opinion _(2026-09-22 — ouverts depuis la barre supérieure)_
- [x] `tools/veritable/headless/` v1 : boucle `advance`, métriques de base, sortie JSON _(2026-09-22 — sans le cœur OpenFront au J2 ; `--runs`, `--seed`, `--shock`, JSON + CSV, temps CPU par domaine)_
- [x] `tools/veritable/ingest/` : Banque mondiale, OWID/EIA → fiches des 10 nations _(2026-09-22 — instantanés commités, sha256 ; estimations marquées et justifiées)_
- [x] Sauvegarde `schemaVersion: 2` et migration `v1-to-v2.ts` testée sur une vraie sauvegarde J1 _(2026-09-22 — tâche ajoutée au jalon)_

**Livré quand** : vingt ans de jeu headless sans divergence absurde des prix ni de la dette ; couper un fournisseur de gaz se voit dans les courbes. — **Livré le 2026-09-22** (20 ans × 10 graines : prix entre 0,95 et 1,04 × base, aucun défaut ; choc gazier contre témoin dans `docs/veritable/reports/J2/`).

## J3a — Guerre terrestre et réaction internationale

Modèle recommandé : Fable 5.1 pour la conception du module, Opus 5 pour l'implémentation.

- [x] Fronts calculés automatiquement, segments, postures (défendre / attaquer / percer) _(2026-09-22 — géométrie lue par le monde une fois par jour, segments d'environ 200 tuiles le long de la ligne)_
- [x] Divisions : 4 gabarits, effectifs (population × conscription), armement, entraînement, ravitaillement _(2026-09-22 — `war/divisions.json`, armée de départ selon `startingMix`)_
- [x] Résolution par segment (rapport de force × terrain × doctrine × structures OpenFront) _(2026-09-22 — doctrine remplacée par la posture (défendre / attaquer / percer) ; colline OpenFront tenue pour forêt)_
- [x] Épuisement de guerre ; pertes → effectifs, armement, opinion _(2026-09-22)_
- [x] Casus belli (catalogue) ; déclaration de guerre _(2026-09-22 — `war/casus-belli.json`, quatre entrées)_
- [x] Réaction internationale : opinion des nations, coalitions, votes de sanctions par les blocs (couche 1) _(2026-09-22 — coût de relations à la déclaration et chaque mois, sanctions IA, alignement de l'UE, coalitions)_
- [x] Sanctions par bien et par pays ; contournement ; flux d'armes vers les belligérants _(2026-09-22 — contournement et sanctions non cosmétiques (dépendance commerciale) ; flux d'armes vers les belligérants reportés au J5 avec l'IA)_
- [x] Paix : négociée, cessez-le-feu, annexion ; tuiles transférées étiquetées « contesté » _(2026-09-22 — cession, réparations, démilitarisation, annexion → exil)_
- [x] Écrans : fronts et divisions, diplomatie et sanctions _(2026-09-22 — vérifiés dans le navigateur)_
- [x] Corrections du J2 : exportations dans le PIB, substitution différée, prime régionale, règle UE révisée, dette FMI, liaison par identifiant _(2026-09-22 — tâches ajoutées au jalon)_
- [x] Runner headless sur le cœur OpenFront, `--script` ; sauvegarde `schemaVersion: 3` et migration `v2-to-v3.ts` testée sur une vraie sauvegarde v2 _(2026-09-22 — tâches ajoutées au jalon)_

**Livré quand** : une sanction se voit dans les courbes en moins d'un an de jeu ; une guerre sans casus belli coûte plus qu'elle ne rapporte (mesuré headless). — **Livré le 2026-09-22** (embargo UE : prix du gaz à l'import +32 % en un an, Russie −8 % à deux ans ; France → Espagne : 8 sanctions en six mois, perte de PIB 311 Md$ contre 186 Md$ de tuiles prises à trois ans ; `docs/veritable/reports/J3/`).

## J3b — Marine, air, logistique

- [x] Zones maritimes ; contrôle par navires et ports ; blocus → commerce _(2026-09-22 — germes + partition par parcours sur l'eau, `borders/europe-10.zones.bin` ; présence = fiche projetée + navires + ports)_
- [x] Débarquements (contrôle de zone puis prise d'un port) _(2026-09-22 — tête de pont par crochet du cœur ; contrôle mesuré entre belligérants)_
- [x] Supériorité aérienne par région ; multiplicateur terrestre ; frappes _(2026-09-22 — par paire de belligérants, frappes mensuelles sur l'industrie et le ravitaillement)_
- [x] Capacité de ravitaillement par segment ; force réduite au-delà _(2026-09-22 — base + infrastructures ; ports et villes à portée comptés sur le cœur le 2026-09-23)_

**Livré quand** : un blocus se lit dans le commerce du bloqué ; un débarquement sans contrôle de zone échoue. — **Livré le 2026-09-22** (blocus britannique : commerce maritime norvégien −48 % à six mois ; débarquement italien en Espagne refusé).

## J4 — Le moteur

- [x] `regimes.json` : 9 archétypes, succession, coups, lois accessibles _(2026-09-23 — plus intervalle d'élection, formation du gouvernement, presse et médias structurels, drapeau `democratic`)_
- [x] Élections : offre politique, opinion par groupe, 4 leviers (propagande, médias, fraude, clientélisme) et leurs risques _(2026-09-23 — projection sans tirage exposée à l'écran ; 20 % de fraude avec presse libre détectés dans ~72 % des cas)_
- [x] Catalogue de lois par domaine ; capital politique ; réversibilité ; curseurs à effet progressif _(2026-09-23 — 46 lois, fenêtres idéologiques, abrogation différée par le gouvernement suivant, rampe exponentielle des curseurs)_
- [x] Coups et révolutions ; changement de régime ; le joueur continue _(2026-09-23 — formule de la consigne, période de grâce de 36 mois, junte qui rend le pouvoir après quatre ans, suspension par l'UE)_
- [x] Dirigeants : ingestion Wikidata, traits, vieillissement, succession ; interrupteur parodie/fictif _(2026-09-23 — instantanés SPARQL épinglés, 71 acteurs et 60 partis, traits des dix-neuf chefs d'État et de gouvernement écrits à la main (Erdoğan cumule les deux))_
- [x] Objectifs épinglables (catalogue) + texte libre ; journal de campagne automatique _(2026-09-23 — 14 objectifs, notes, journal filtrable par catégorie)_
- [x] Écrans : politique (groupes, élections, lois, curseurs), dirigeants, journal _(2026-09-23 — quatre écrans : Politique, Élection, Dirigeants, Objectifs et journal ; vérifiés dans le navigateur)_

**Livré quand** : une campagne de dix ans produit au moins une alternance, une crise politique et un choix douloureux sans aucun script. — **Livré le 2026-09-23** (10 ans × 10 graines : les dix nations connaissent une alternance, 9 ou 10 par campagne ; crises dans les dix campagnes (31 coups, 25 tentatives, 13 troubles) ; aucune junte sans cause ; `docs/veritable/reports/J4/`).

## J5 — Profondeur

- [ ] Blocs couche 2 (budget, votes, décisions) puis couche 3 (leadership joueur) ; 12 blocs du palier 1
- [ ] Arbre technologique : tronc commun paliers 1 et 2 ; branches de doctrine par bloc
- [ ] 50 événements scriptés 2026-2030 ; gabarits procéduraux ; moteur de déclenchement unique
- [ ] Doctrines nucléaires ; probabilité de tir ; main morte ; retombées → production
- [ ] IA des nations réécrite : agenda, traits, échelonnement, niveau de détail variable
- [ ] Écrans : blocs, arbre, événements

**Livré quand** : sur 100 campagnes headless de 50 ans, aucune guerre nucléaire généralisée en année 1 et une distribution des guerres plausible.

## J6 — Échelle

- [ ] Ingestion des 195 fiches ; scénario `world-2026.json` ; carte monde
- [ ] Micro-États ; territoires contestés ; conflits initiaux validés à la main
- [ ] Compactage du journal ; profil de performance à 195
- [ ] Réglages LOD et échelonnement mis à l'épreuve

**Livré quand** : ×5 tient sans saccade sur carte monde pendant 50 ans de jeu.

## J7 — Le reste

- [ ] Electron : empaquetage, sauvegardes dans le dossier utilisateur, build Windows
- [ ] Page itch.io ou GitHub Releases ; mentions AGPL et © OpenFront and Contributors ; sources publiées
- [ ] Gouvernement en exil ; dissolution ; baroud d'honneur
- [ ] Événements procéduraux élargis ; palier 2 des biens et de l'arbre
- [ ] Reconstruction post-nucléaire
- [ ] Polissage UI ; documentation de modding
