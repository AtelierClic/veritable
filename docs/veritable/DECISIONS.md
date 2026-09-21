# Véritable — journal des décisions

Une entrée par décision, datée, jamais supprimée : une décision annulée reçoit une nouvelle entrée qui la remplace. Claude Code ajoute une entrée à chaque choix structurant pris en session (forme d'une donnée, modification de `src/core`, constante d'équilibrage majeure, écart par rapport à DESIGN.md). Format : date, décision, raison, ce que ça exclut.

## 2026-09-20 — Cadre initial (entretien 1)

- **Solo local, campagne persistante, une seule nation, bac à sable sans victoire.** Libère le déterminisme client/serveur ; exclut tout retour multijoueur sans réécriture.
- **Base OpenFront.io (AGPL-3.0), pas un mod.** Combat, économie et IA remplacés ; carte, tuiles, diplomatie, nucléaire, structures conservés.
- **Distribution Windows via Electron.** Tauri en repli.
- **Données réelles, ~195 nations, économie détaillée, politique interne complète, blocs dirigeables.**
- **Guerre libre mais sanctionnée ; nucléaire utilisable avec conséquences ; effondrement = gouvernement en exil.**
- **Événements scriptés et procéduraux ; plafond technologique spéculatif lointain.**

## 2026-09-21 — Décisions de conception (entretien 2)

- **Nom du projet : Véritable.**
- **Le joueur est l'État, pas le gouvernement.** Un changement de dirigeant, un coup ou une révolution ne terminent rien. Exclut le mode « perdre l'élection = fin ».
- **Temps : 1er janvier 2026 ; à ×1, 1 minute réelle = 1 mois de jeu ; vitesses pause / ×1 / ×2 / ×5.** Sauvegarde auto par mois de jeu, pas par jour.
- **Économie de biens en paliers : 12 biens au palier 1, ~40 au palier 2.** Un prix mondial par bien + flux bilatéraux. Exclut une économie à or unique.
- **Dette/PIB avec taux, austérité forcée ou défaut, réprimande des blocs (UE 3 % / 60 %).**
- **Sanctions = embargos par bien et par pays**, effets sur PIB, budget, opinion, tension, contournement, flux d'armes, présence militaire. Test de la sanction cosmétique au J3a.
- **Simulation politique asymétrique.** Politique complète pour le joueur ; régime + stabilité scalaire + traits du dirigeant + agenda pour l'IA. Exclut la symétrie, y compris plus tard.
- **9 archétypes de régime** : parlementaire, présidentiel, semi-présidentiel, autoritaire électoral, parti unique, monarchie absolue, junte, théocratie, État failli.
- **Élections orientables** par propagande, contrôle des médias, fraude, clientélisme — chacun avec son risque.
- **Chute de l'État** : exil tant que reconnaissance + soutien > seuil ; sous le seuil ou annexion reconnue → dissolution → baroud d'honneur sur un petit État de la même campagne.
- **Dirigeants = entités à traits, source Wikidata.** Noms parodiques par défaut, interrupteur « fictif » dans les données. Risque de droit à l'image connu et accepté.
- **Modèle de front : ensemble des tuiles frontalières, segments, divisions affectées sans position exacte, postures, résolution par rapport de force** (modèle Hearts of Iron).
- **J3 scindé** : J3a terre + réaction internationale ; J3b marine, air, logistique, effectifs.
- **Structures OpenFront conservées** : villes, postes de défense, ports, navires, silos, SAM.
- **Nucléaire : doctrine par nation dans les données ; main morte à l'annexion, probabilité visible ; tout tir = réaction internationale maximale.**
- **Blocs = entités complètes** (membres, adhésion, sortie, règle de décision par domaine, budget, compétences, leadership), en trois couches. Palier 1 : UE, OTAN, BRICS, ASEAN, UA, Mercosur, OPEP, CEDEAO, Ligue arabe, OCS, G7, G20.
- **Frontières de facto (Natural Earth), territoires occupés = tuiles du contrôleur étiquetées « contesté ».** Exclut les frontières de jure.
- **Micro-États = nations sans tuile, rattachées à une tuile hôte.**
- **Le monde démarre avec les conflits en cours**, listés dans le scénario et validés à la main.
- **Arbre technologique : tronc commun + branches de doctrine par bloc**, en paliers ; réserve du premier entretien levée.
- **Noyau opinion/stabilité dès le J2**, avant la guerre.
- **Gratuit ; contenu et interface en français, code en anglais, clés i18n dès le départ ; modding ouvert.**
- **Distribution itch.io ou GitHub Releases, binaire non signé** (avertissement SmartScreen accepté), pas de Steam. Budget hors Claude : 10 €.
- **Rupture avec l'amont OpenFront** : le fork ne fusionne plus jamais après le commit de départ.
- **RNG seedé obligatoire** dans toute la simulation.
- **Modèles Claude Code** : Fable 5.1 pour J0 et l'architecture ; Opus 5 pour les systèmes spécifiés ; Sonnet 5 pour le volume ; `opusplan` en session courante.

## À compléter par Claude Code

- Commit de départ du fork (`upstream-base`) : _à noter au J0_.
- Chaque modification de `src/core` : fichier, raison, ligne `// VERITABLE:`.
- Chaque schéma zod créé ou modifié : version de `schemaVersion` associée.
