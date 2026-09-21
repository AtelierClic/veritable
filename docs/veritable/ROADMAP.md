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

- [ ] `goods.json` palier 1 (12 biens) ; production/consommation par nation depuis les fiches
- [ ] Marché : prix mondial par bien, flux bilatéraux (distance, accords, blocs, embargos)
- [ ] Budget : recettes et dépenses par curseurs ; dette/PIB ; taux ; seuils austérité/défaut
- [ ] Pénuries : effets directs (électricité → industrie, alimentation → troubles, armement → divisions)
- [ ] Noyau politique joueur : 8 groupes, opinion, stabilité, réaction aux curseurs et aux chocs
- [ ] Stabilité scalaire des nations IA
- [ ] Écrans : économie (biens, prix, flux), budget, opinion
- [ ] `tools/veritable/headless/` v1 : boucle `advance`, métriques de base, sortie JSON
- [ ] `tools/veritable/ingest/` : Banque mondiale, OWID/EIA → fiches des 10 nations

**Livré quand** : vingt ans de jeu headless sans divergence absurde des prix ni de la dette ; couper un fournisseur de gaz se voit dans les courbes.

## J3a — Guerre terrestre et réaction internationale

Modèle recommandé : Fable 5.1 pour la conception du module, Opus 5 pour l'implémentation.

- [ ] Fronts calculés automatiquement, segments, postures (défendre / attaquer / percer)
- [ ] Divisions : 4 gabarits, effectifs (population × conscription), armement, entraînement, ravitaillement
- [ ] Résolution par segment (rapport de force × terrain × doctrine × structures OpenFront)
- [ ] Épuisement de guerre ; pertes → effectifs, armement, opinion
- [ ] Casus belli (catalogue) ; déclaration de guerre
- [ ] Réaction internationale : opinion des nations, coalitions, votes de sanctions par les blocs (couche 1)
- [ ] Sanctions par bien et par pays ; contournement ; flux d'armes vers les belligérants
- [ ] Paix : négociée, cessez-le-feu, annexion ; tuiles transférées étiquetées « contesté »
- [ ] Écrans : fronts et divisions, diplomatie et sanctions

**Livré quand** : une sanction se voit dans les courbes en moins d'un an de jeu ; une guerre sans casus belli coûte plus qu'elle ne rapporte (mesuré headless).

## J3b — Marine, air, logistique

- [ ] Zones maritimes ; contrôle par navires et ports ; blocus → commerce
- [ ] Débarquements (contrôle de zone puis prise d'un port)
- [ ] Supériorité aérienne par région ; multiplicateur terrestre ; frappes
- [ ] Capacité de ravitaillement par segment ; force réduite au-delà

**Livré quand** : un blocus se lit dans le commerce du bloqué ; un débarquement sans contrôle de zone échoue.

## J4 — Le moteur

- [ ] `regimes.json` : 9 archétypes, succession, coups, lois accessibles
- [ ] Élections : offre politique, opinion par groupe, 4 leviers (propagande, médias, fraude, clientélisme) et leurs risques
- [ ] Catalogue de lois par domaine ; capital politique ; réversibilité ; curseurs à effet progressif
- [ ] Coups et révolutions ; changement de régime ; le joueur continue
- [ ] Dirigeants : ingestion Wikidata, traits, vieillissement, succession ; interrupteur parodie/fictif
- [ ] Objectifs épinglables (catalogue) + texte libre ; journal de campagne automatique
- [ ] Écrans : politique (groupes, élections, lois, curseurs), dirigeants, journal

**Livré quand** : une campagne de dix ans produit au moins une alternance, une crise politique et un choix douloureux sans aucun script.

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
