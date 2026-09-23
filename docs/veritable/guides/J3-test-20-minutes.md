# J3 — guide de test en 20 minutes

Pour Lukas, au retour. Objectif : jouer une guerre courte, voir les fronts bouger, la réaction internationale tomber, et comprendre ce que coûte une guerre d'agression. Les chiffres sont des ordres de grandeur (aléa de croissance et d'offre) ; le déroulé, lui, est déterministe dans ses grandes lignes.

## Mise en place (1 min)

```bash
npm run dev
```

Ouvrir http://localhost:9000 dans un vrai navigateur (pas le panneau intégré). **Solo** → **Nouvelle campagne** → « Europe, dix nations » → nation **France** (celle par défaut) → **Commencer**. Passer le tutoriel hérité (« Passer »). Dans la barre du haut : cinq écrans (Économie, Budget, Opinion, **Fronts et divisions**, **Diplomatie et sanctions**) et les vitesses. Rester à **×1** tant qu'on lit, passer à **×5** pour laisser courir.

Pourquoi la France : nucléaire, puissante (13 divisions, aviation 0,6, marine 0,7), membre de l'UE et de l'OTAN avec des relations à +60 avec presque tout le monde, une frontière terrestre avec l'Espagne, l'Allemagne et l'Italie, et des côtes sur quatre zones maritimes. C'est la nation où toute la réaction internationale se voit.

## 1. Lire l'état de départ (3 min)

**Diplomatie et sanctions.** Relations : +60 avec l'Allemagne, le Royaume-Uni, l'Italie, l'Espagne, la Pologne (deux ou trois blocs communs), +30 avec la Russie et la Turquie (G20), 0 avec l'Ukraine. Personne n'est en guerre avec la France. Les seuls boutons de guerre disponibles sont « Déclarer la guerre (Aucun (guerre d'agression)) » : la France n'a aucun casus belli. Contrôle des zones : Atlantique Nord ≈ 26 %, Gascogne ≈ 41 %, Manche ≈ 30 %, Méditerranée occidentale ≈ 28 % (la flotte de 0,7 est répartie sur les zones côtières, face aux voisins). Blocus subi : 0 %. En bas, la matrice d'embargos par bien : toutes les cases vides.

**Fronts et divisions.** Réserve d'effectifs ≈ 165 k (179 k sous les drapeaux : 13 divisions), conscription « armée de métier », épuisement 0 %, aucune guerre, aucun front. Les 13 divisions sont en réserve, posture « Défendre », équipement 100 %.

**Économie.** Nouvelle colonne « Prix à l'import » (prix mondial + prime quand la demande du scénario n'est pas couverte) ; ligne « Exports » en dollars. Rien d'anormal : couvertures à 100 %.

Laisser tourner un mois à ×5 (≈ 12 s). Dans **Fronts et divisions** apparaît déjà une entrée pour l'Ukraine et la Russie ? Non : seuls les fronts de la France s'affichent ; la guerre russo-ukrainienne du scénario tourne en arrière-plan (Opinion → stabilité de l'Ukraine qui glisse).

## 2. Déclarer la guerre à l'Espagne (2 min)

**Diplomatie** → ligne Espagne → « Déclarer la guerre (Aucun (guerre d'agression)) ».

Ce qui doit bouger tout de suite :

| Chiffre                         | Sens | Ordre de grandeur                                                                       |
| ------------------------------- | ---- | --------------------------------------------------------------------------------------- |
| Relations avec l'Espagne        | ↓↓   | −100                                                                                    |
| Relations avec tous les autres  | ↓    | −16 à −19 (15 × (1 + part de la France dans la puissance totale, ≈ 10 %)) : +60 → ≈ +42 |
| Opinion → Jeunes, Entrepreneurs | ↓    | −10 points chacun, immédiatement                                                        |
| Journal (panneau Véritable)     | +    | « France déclare la guerre à Espagne (casus belli : none). »                            |

Le lendemain (2 s à ×1), **Fronts et divisions** montre « Front contre Espagne » : deux segments d'une centaine de tuiles, plaine / colline / montagne (la colline vaut forêt ×1,2, la montagne ×1,5 en défense), vos divisions à 0, celles de l'Espagne à 0 le premier mois.

## 3. Mener l'offensive (5 min)

Dans **Fronts et divisions**, tableau des divisions : passer les colonnes « Affectation » de cinq ou six divisions (les blindées et les mécanisées d'abord) à « Front contre Espagne » / « Tout le front », et leur posture à « Attaquer ». Laisser à ×5.

| Chiffre                         | Sens | Ordre de grandeur                                                                                                |
| ------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------- |
| Segment → Rapport               | —    | force d'attaque / force de défense × terrain × structures ; la ligne avance au-dessus de 1,2                     |
| Segment → Avance                | —    | « France » quand la ligne avance, en vert ; « Espagne » en rouge quand elle recule                               |
| Guerre → tuiles prises          | ↑    | 200 à 400 tuiles par mois et par segment quand le rapport dépasse 2 (`v0` = 0,1, plafond 1 tuile par tick)       |
| Division → Effectif, Équipement | ↓    | quelques centaines d'hommes par mois d'attaque ; l'équipement suit, et se recomplète chaque mois avec l'armement |
| Épuisement de guerre            | ↑    | +1 point par mois de guerre, plus les pertes ; à 50 % l'IA d'en face accepte un cessez-le-feu                    |
| Réserve d'effectifs             | ↑    | +5 % du plafond par mois ; passer en « mobilisation partielle » triple le plafond                                |

Le premier mois, l'IA espagnole met ses huit divisions sur le front (au prorata de la menace, segment par segment) et passe en mobilisation partielle ; elle attaque elle-même un segment où elle pèse plus de 1,5 fois la France : si vous laissez un segment vide, elle avance dedans.

## 4. Encaisser la réaction internationale (5 min)

Laisser courir six mois à ×5 (≈ 1 min 10) en regardant **Diplomatie et sanctions** :

| Chiffre                                                | Sens | Ordre de grandeur                                                                                                                                                       |
| ------------------------------------------------------ | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Relations avec les autres                              | ↓    | −16 à −19 **chaque mois** de guerre (sans casus belli seulement) : Allemagne, Italie, Pologne, Royaume-Uni passent sous −40 vers le cinquième mois                      |
| Colonne État                                           | +    | « me sanctionne » dès que c'est le cas : l'Espagne aussitôt, puis ses partenaires de bloc ; huit à neuf nations en six mois                                             |
| Économie → couvertures                                 | ↓    | gaz, pétrole, charbon : ce qui arrivait par mer subit le blocus espagnol (Gascogne, Méditerranée) et les embargos des sanctionneurs                                     |
| Économie → « Sanctions et guerres : x % du PIB perdu » | ↑    | jusqu'à 10-12 % à deux ans (dépendance commerciale × part des partenaires perdus × (1 − contournement))                                                                 |
| Économie → PIB                                         | ↓    | −10 % la première année, −12 % la deuxième ; le témoin headless est dans `docs/veritable/reports/J3/war-fra-esp.svg`                                                     |
| Opinion → Stabilité                                    | ↓    | de 0,63 à ≈ 0,50 en un an, et elle ne remonte pas tant que les sanctions durent (témoin 0,59 à trois ans, France 0,51)                                                  |
| Diplomatie → relations < −60                           | +    | à partir du huitième mois, des nations rejoignent l'Espagne (probabilité 0,3 par mois) : « Front contre Allemagne », « Front contre Italie » apparaissent, à défendre ! |

Un débarquement ? **Diplomatie** → ligne Espagne → « Blocus » (la flotte va sur ses zones), puis « Débarquer » : refusé tant que le contrôle des zones espagnoles entre belligérants est sous 50 % (journal : « débarquement refusé chez Espagne »). Avec le blocus, la France pèse 0,7 contre 0,5 : le débarquement part, un transport apparaît et prend une tête de pont de six tuiles de rayon sur la côte espagnole la plus proche de Paris.

## 5. Faire la paix, sauvegarder (3 min)

Dans **Fronts et divisions** → Guerres → « Proposer la paix » : cessez-le-feu (coût 0 : l'Espagne accepte si elle recule depuis six mois ou si son épuisement dépasse 50 %), ou cession (les tuiles prises restent françaises, étiquetées « contesté », et l'Espagne y gagne un casus belli), réparations et plafond de divisions dont le coût doit tenir dans votre score de guerre. Une offre de l'IA vous arrive en jaune avec Accepter / Refuser. La paix termine la guerre pour tout le monde ; les sanctions restent tant que les relations ne sont pas revenues au-dessus de −40 (+2 par mois une fois la paix signée).

Panneau **Véritable** → **Sauvegarder** → **Charger** : fronts, divisions, relations, sanctions, tuiles contestées reviennent à l'identique. Une sauvegarde du J2 se charge aussi : sa diplomatie et son armée partent des fiches.

## 6. Les tests de livraison, sans jouer (1 min)

```bash
npx tsx tools/veritable/headless/reportJ3.ts --out docs/veritable/reports/J3
```

Déjà commités dans `docs/veritable/reports/J3/` (graine 42, sans bruit) : `eu-embargo`, `war-fra-esp`, `blockade-gbr-nor` (CSV témoin, CSV scénario, SVG) et `landing-ita-esp.csv` ; `summary.json` porte les chiffres des quatre critères. Les commandes rejouées sont dans `tools/veritable/headless/scripts/`.

## Ce qui est normal et ce qui ne l'est pas

Normal : des fronts qui se redécoupent d'un jour à l'autre (les segments sont relus chaque matin) ; une division « Tout le front » comptée en fractions sur chaque segment ; une couverture en gaz qui plonge dès qu'un voisin maritime vous fait la guerre ; des nations IA qui ne débarquent jamais (J5). Les offres de paix IA → IA refusées n'apparaissent plus dans le journal.

À signaler : un front qui ne bouge pas avec un rapport supérieur à 1,2 ; une division dont l'effectif ne remonte pas en réserve ; une sanction sans effet sur le PIB après trois mois ; un débarquement accepté avec moins de 50 % de contrôle ; une sauvegarde rechargée dont les fronts ont disparu.
